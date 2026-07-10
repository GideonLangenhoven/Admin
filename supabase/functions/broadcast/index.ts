// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAdminAppOrigins, isAllowedOrigin } from "../_shared/tenant.ts";
import { requireAuth } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function getCors(req: Request) {
  const allowed = getAdminAppOrigins();
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(origin, allowed) ? origin : allowed[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-business-id, x-tenant-subdomain, x-tenant-origin, x-voucher-code, x-booking-success-token, x-booking-id, x-booking-waiver-token",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCors(req) });

  try {
    // Mass-messaging a tenant's customers: only that tenant's admins (or the
    // platform SUPER_ADMIN / internal service calls) may trigger it, and the
    // target business is derived from the caller — never trusted from the body.
    let auth;
    try {
      auth = await requireAuth(req);
    } catch (_e) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: getCors(req) });
    }

    const body = await req.json();
    const { action, message, target_group, slot_ids, send_email, send_whatsapp } = body;

    const business_id = (auth.isServiceRole || auth.role === "SUPER_ADMIN")
      ? String(body.business_id || "")
      : auth.businessId;

    if (!business_id) {
      return new Response(JSON.stringify({ error: "business_id is required" }), { status: 400, headers: getCors(req) });
    }

    if (action !== "broadcast_targeted" || !message) {
      return new Response(JSON.stringify({ error: "Invalid parameters" }), { status: 400, headers: getCors(req) });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Default limit
    const limit = 500;

    // Get bookings scoped to this business
    let query = supabase.from("bookings")
      .select("id, customer_name, email, phone, slot_id, status")
      .eq("business_id", business_id)
      .in("status", ["PAID", "CONFIRMED"]);

    if (target_group === "SLOT" && Array.isArray(slot_ids) && slot_ids.length > 0) {
      query = query.in("slot_id", slot_ids);
    }

    const { data: bookings, error: bErr } = await query.limit(limit);

    if (bErr || !bookings) {
      return new Response(JSON.stringify({ error: "Could not fetch bookings" }), { status: 500, headers: getCors(req) });
    }

    // Broadcast sourced recipients straight from paid bookings and never once
    // checked marketing_contacts.status — an unsubscribed customer kept
    // receiving every broadcast indefinitely. One batch lookup up front avoids
    // an extra query per recipient.
    const candidateEmails = Array.from(new Set(bookings.map((b) => String(b.email || "").toLowerCase()).filter(Boolean)));
    let unsubscribedEmails = new Set<string>();
    if (candidateEmails.length > 0) {
      const { data: unsubRows, error: unsubErr } = await supabase.from("marketing_contacts")
        .select("email")
        .eq("business_id", business_id)
        .eq("status", "unsubscribed")
        .in("email", candidateEmails);
      if (unsubErr) console.error("BROADCAST_UNSUB_LOOKUP_ERR:", unsubErr.message);
      else unsubscribedEmails = new Set((unsubRows || []).map((r: any) => String(r.email).toLowerCase()));
    }

    let waSent = 0;
    let waAttempted = 0;
    let emailSent = 0;
    let emailAttempted = 0;
    let totalSent = 0;
    const errors: string[] = [];
    // Per-recipient channel accounting (item 19). WhatsApp's 24h free-form
    // window is enforced by Meta: inside the window we can send free-form text;
    // outside it we must use an approved template. sendWhatsappTextForTenant
    // handles that routing reactively (free-form → catch 131047/131026 → the
    // admin_outreach template), and reports back which channel it used.
    const channelCounts = { wa_freeform: 0, wa_template: 0, email: 0, email_fallback: 0, failed: 0 };
    const channelLog: Array<{ to: string; channel: string }> = [];

    for (const b of bookings) {
      let sentToCustomer = false;
      let channelUsed = "none";
      let waOk = false;
      const firstName = (b.customer_name || "Guest").split(" ")[0];
      const parsedMessage = message.replace(/\{name\}/gi, firstName);
      const emailLowerRaw = String(b.email || "").toLowerCase();
      const isUnsubscribed = !!emailLowerRaw && unsubscribedEmails.has(emailLowerRaw);

      // WhatsApp — send with an approved-template fallback so out-of-window
      // recipients still get the message (as a template) rather than silently
      // dropping. send-whatsapp-text returns {ok, channel}; trust the body.
      if (send_whatsapp && b.phone) {
        waAttempted++;
        try {
          const waRes = await fetch(`${SUPABASE_URL}/functions/v1/send-whatsapp-text`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
            body: JSON.stringify({
              to: b.phone,
              message: parsedMessage,
              business_id,
              template_fallback: { name: "admin_outreach", params: [firstName, parsedMessage], language: "en" },
            }),
          });
          const waBody = await waRes.json().catch(() => ({} as any));
          if (waRes.ok && waBody?.ok === true) {
            waOk = true;
            waSent++;
            sentToCustomer = true;
            channelUsed = waBody.channel === "template" ? "wa_template" : "wa_freeform";
            channelCounts[channelUsed === "wa_template" ? "wa_template" : "wa_freeform"]++;
          } else {
            errors.push(`WA to ${b.phone}: ${waBody?.error || ("HTTP " + waRes.status)}`);
          }
        } catch (e) {
          errors.push(`WA to ${b.phone}: ${e}`);
        }
      }

      // Email is sent when the operator explicitly chose email, OR as an
      // automatic fallback when a requested WhatsApp send failed entirely
      // (so the customer isn't left with no communication). Deduped so we
      // never email the same recipient twice.
      const wantEmailPrimary = send_email && !!b.email;
      const wantEmailFallback = send_whatsapp && !!b.phone && !waOk && !!b.email;
      if ((wantEmailPrimary || wantEmailFallback) && b.email && isUnsubscribed) {
        // Skip silently — an unsubscribed recipient isn't a send failure.
      } else if ((wantEmailPrimary || wantEmailFallback) && b.email) {
        const isFallback = wantEmailFallback && !wantEmailPrimary;
        emailAttempted++;
        try {
          // Compliance: generate a one-click unsubscribe token per recipient.
          // POPIA / CAN-SPAM / GDPR all require an opt-out path on every mass
          // commercial communication. Broadcasts target bookings (not
          // marketing_contacts), so we upsert a contact row first and tie the
          // token to it — reusing the existing marketing-unsubscribe handler.
          let unsubscribeUrl = "";
          try {
            const emailLower = String(b.email).toLowerCase();
            const { data: contactRow } = await supabase.from("marketing_contacts")
              .upsert({
                business_id,
                email: emailLower,
                first_name: (b.customer_name || "").split(" ")[0] || null,
                source: "booking",
              }, { onConflict: "business_id,email", ignoreDuplicates: false })
              .select("id")
              .maybeSingle();
            const contactId = contactRow?.id || null;
            if (contactId) {
              const token = crypto.randomUUID();
              const { error: tokenErr } = await supabase.from("marketing_unsubscribe_tokens").insert({
                business_id,
                contact_id: contactId,
                token,
              });
              if (!tokenErr) {
                unsubscribeUrl = `${SUPABASE_URL}/functions/v1/marketing-unsubscribe?token=${token}`;
              }
            }
          } catch (e) {
            console.warn("BROADCAST_UNSUB_TOKEN_ERR for", b.email, ":", e);
          }

          // Fail closed: POPIA/CAN-SPAM/GDPR require an opt-out path on every
          // mass commercial email. This used to send anyway with a blank
          // unsubscribe link whenever token creation failed above.
          if (!unsubscribeUrl) {
            errors.push(`Email to ${b.email}: skipped — could not generate an unsubscribe token`);
            continue;
          }

          const emailRes = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
            body: JSON.stringify({
              type: "BROADCAST",
              business_id,
              data: {
                email: b.email,
                customer_name: b.customer_name,
                message: parsedMessage,
                unsubscribe_url: unsubscribeUrl,
              }
            })
          });
          const emailBody = await emailRes.json().catch(() => ({} as any));
          if (emailRes.ok && emailBody?.ok === true) {
            emailSent++;
            sentToCustomer = true;
            if (isFallback) { channelCounts.email_fallback++; if (channelUsed === "none") channelUsed = "email_fallback"; }
            else { channelCounts.email++; if (channelUsed === "none") channelUsed = "email"; }
          } else {
            errors.push(`Email to ${b.email}: ${emailBody?.error || emailBody?.message || ("HTTP " + emailRes.status)}`);
          }
        } catch (e) {
          errors.push(`Email to ${b.email}: ${e}`);
        }
      }

      if (sentToCustomer) totalSent++;
      else channelCounts.failed++;
      channelLog.push({ to: b.phone || b.email || "unknown", channel: channelUsed });
    }

    // Per-recipient channel routing summary (item 19): clear record of which
    // channel actually delivered to each recipient, so out-of-window template
    // routing and email fallbacks are auditable rather than invisible.
    console.log("BROADCAST_CHANNELS business=" + business_id + " " + JSON.stringify(channelCounts));

    // Billing: every broadcast email is a real Resend send with a real cost,
    // but broadcast never fed the same usage counters campaigns/automations
    // do — a tenant sending everything via Broadcast paid nothing extra
    // regardless of volume, and the marketing dashboard's tally undercounted.
    if (emailSent > 0) {
      const currentPeriod = new Date().toISOString().slice(0, 7); // "2026-03"
      await supabase.rpc("increment_marketing_email_usage", { p_business_id: business_id, p_amount: emailSent });
      await supabase.rpc("increment_marketing_monthly_usage", { p_business_id: business_id, p_period: currentPeriod, p_amount: emailSent });
    }

    // Log broadcast
    if (totalSent > 0) {
      await supabase.from("broadcasts").insert({
        business_id,
        message: message,
        target_group: target_group || "CUSTOM",
        sent_count: totalSent
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      wa_sent: waSent,
      wa_attempted: waAttempted,
      email_sent: emailSent,
      email_attempted: emailAttempted,
      total_customers: totalSent,
      // Per-channel routing breakdown so operators can see how many went via
      // free-form WhatsApp vs the out-of-window template vs email fallback.
      channels: channelCounts,
      errors: errors.length > 0 ? errors : undefined
    }), { status: 200, headers: getCors(req) });

  } catch (err: any) {
    console.error("BROADCAST ERR:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: getCors(req) });
  }
});
