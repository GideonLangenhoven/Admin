// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAdminAppOrigins, isAllowedOrigin, getTenantByBusinessId, getBusinessDisplayName, sendWhatsappTextForTenant } from "../_shared/tenant.ts";
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
    const { action, message, target_group, slot_ids } = body;

    const business_id = (auth.isServiceRole || auth.role === "SUPER_ADMIN")
      ? String(body.business_id || "")
      : auth.businessId;

    if (!business_id) {
      return new Response(JSON.stringify({ error: "business_id is required" }), { status: 400, headers: getCors(req) });
    }

    if (action !== "broadcast_targeted" || !message) {
      return new Response(JSON.stringify({ error: "Invalid parameters" }), { status: 400, headers: getCors(req) });
    }

    // A departure message goes to the guests booked on the operator's own
    // departures, about that trip. Anything wider is promotion, which stays
    // with Marketing (consent, unsubscribe, frequency limits).
    const slotIds: string[] = Array.isArray(slot_ids) ? [...new Set(slot_ids.map(String))] : [];
    if (target_group !== "SLOT" || slotIds.length === 0 || slotIds.length > 50) {
      return new Response(JSON.stringify({ error: "Pick the departures to message. Promotions go out from Marketing. No messages sent." }), { status: 409, headers: getCors(req) });
    }
    const text = String(message).trim();
    if (text.length > 2000) {
      return new Response(JSON.stringify({ error: "Keep the message under 2,000 characters. No messages sent." }), { status: 400, headers: getCors(req) });
    }
    // One id per composed message, so a retried send never reaches a guest twice.
    const broadcastId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(body.broadcast_id || ""))
      ? String(body.broadcast_id).toLowerCase()
      : crypto.randomUUID();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: slots, error: sErr } = await supabase.from("slots").select("id")
      .eq("business_id", business_id).in("id", slotIds);
    if (sErr || (slots || []).length !== slotIds.length) {
      return new Response(JSON.stringify({ error: "Departure not found. No messages sent." }), { status: 404, headers: getCors(req) });
    }

    const { data: bookings, error: bErr } = await supabase.from("bookings")
      .select("id, customer_name, email, phone, whatsapp_booking_updates_opt_in")
      .eq("business_id", business_id)
      .in("slot_id", slotIds)
      .in("status", ["PAID", "CONFIRMED"])
      .limit(500);
    if (bErr || !bookings) {
      console.error("BROADCAST_BOOKINGS_ERR:", bErr);
      return new Response(JSON.stringify({ error: "Could not load the guests. No messages sent." }), { status: 500, headers: getCors(req) });
    }

    const tenant = await getTenantByBusinessId(supabase, business_id);
    const firstName = (b: any) => String(b.customer_name || "").trim().split(" ")[0] || "there";
    const personal = (b: any) => text.replace(/\{name\}/gi, firstName(b));
    const reached = new Set<string>();

    // Guests who unsubscribed from this operator's emails stay unsubscribed.
    const emails = [...new Set(bookings.map((b: any) => String(b.email || "").trim().toLowerCase()).filter((e) => e.includes("@")))];
    const { data: unsubRows, error: uErr } = emails.length > 0
      ? await supabase.from("marketing_contacts").select("email").eq("business_id", business_id).eq("status", "unsubscribed").in("email", emails)
      : { data: [], error: null };
    if (uErr) {
      console.error("BROADCAST_UNSUB_LOOKUP_ERR:", uErr);
      return new Response(JSON.stringify({ error: "Could not check email preferences. No messages sent." }), { status: 500, headers: getCors(req) });
    }
    const unsubscribed = new Set((unsubRows || []).map((r: any) => String(r.email).toLowerCase()));
    const withEmail = bookings.filter((b: any) => String(b.email || "").includes("@"));

    // Email: the durable notification queue every other guest email uses, so
    // each one is retried, logged, and listed under Failed Notifications if it
    // never goes out. Queued before any WhatsApp so a queue failure sends nothing.
    const emailJobs = withEmail.filter((b: any) => !unsubscribed.has(String(b.email).trim().toLowerCase())).map((b: any) => ({
      business_id,
      booking_id: b.id,
      source_type: "DEPARTURE_BROADCAST",
      source_id: broadcastId,
      template_type: "BROADCAST",
      recipient: String(b.email).trim().toLowerCase(),
      payload: { business_id, booking_id: b.id, customer_name: b.customer_name, message: personal(b) },
      dedupe_key: "departure-broadcast/" + broadcastId + "/" + b.id,
    }));
    let newEmails = 0;
    if (emailJobs.length > 0) {
      const { data: newJobs, error: qErr } = await supabase.from("notification_jobs")
        .upsert(emailJobs, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
      if (qErr) {
        console.error("BROADCAST_QUEUE_ERR:", qErr);
        return new Response(JSON.stringify({ error: "The emails could not be queued. No messages sent." }), { status: 500, headers: getCors(req) });
      }
      for (const job of emailJobs) reached.add(job.booking_id);
      newEmails = (newJobs || []).length;
    }

    // WhatsApp: only on the operator's connected number, to guests who opted in
    // to WhatsApp booking updates. Everyone else is skipped with the reason.
    const waConnected = Boolean(tenant.credentials.waToken && tenant.credentials.waPhoneId);
    const reopenerName = Deno.env.get("WA_REOPENER_TEMPLATE_NAME") || "booking_update_reopener";
    const whatsapp = { sent: 0, waiting: 0, failed: 0, skipped: { not_connected: 0, no_number: 0, no_opt_in: 0 } };
    for (const b of bookings as any[]) {
      if (!waConnected) { whatsapp.skipped.not_connected++; continue; }
      if (!b.phone) { whatsapp.skipped.no_number++; continue; }
      if (!b.whatsapp_booking_updates_opt_in) { whatsapp.skipped.no_opt_in++; continue; }
      let phone = String(b.phone).replace(/\D/g, "");
      if (phone.startsWith("0")) phone = "27" + phone.substring(1);
      // Claim before calling Meta so a repeated send cannot message twice.
      const key = "departure-broadcast-wa/" + broadcastId + "/" + b.id;
      const claim = await supabase.from("idempotency_keys").insert({ key, status: "processing" });
      if (claim.error?.code === "23505") { whatsapp.sent++; reached.add(b.id); continue; }
      try {
        if (claim.error) throw new Error("WhatsApp send could not be recorded");
        const res = await sendWhatsappTextForTenant(tenant, phone, personal(b), {
          name: reopenerName,
          params: [firstName(b), getBusinessDisplayName(tenant.business) || "our team"],
          language: "en",
        });
        if (res?.channel === "template") {
          // Outside the 24-hour window the guest got the approved "please
          // reply" template; wa-webhook delivers the message when they do.
          await supabase.from("outbox").insert({
            business_id, booking_id: b.id, phone, message_type: "BROADCAST_FOLLOWUP", message_body: personal(b),
            scheduled_for: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), status: "WAITING_WINDOW",
          });
          whatsapp.waiting++;
        } else whatsapp.sent++;
        reached.add(b.id);
        await supabase.from("idempotency_keys").update({ status: "completed" }).eq("key", key);
      } catch (e) {
        whatsapp.failed++;
        await supabase.from("idempotency_keys").update({ status: "failed", last_error: String((e as Error)?.message || e).slice(0, 500) }).eq("key", key);
        // Listed under Failed Notifications, where the operator can retry it.
        await supabase.from("outbox").insert({
          business_id, booking_id: b.id, phone, message_type: "BROADCAST", message_body: personal(b),
          scheduled_for: new Date().toISOString(), status: "FAILED", attempts: 1,
          error: String((e as Error)?.message || e).slice(0, 500),
        });
      }
    }
    console.log("BROADCAST business=" + business_id + " id=" + broadcastId + " emails=" + emailJobs.length + " whatsapp=" + JSON.stringify(whatsapp));

    // Billing: broadcast emails count towards the same usage as campaigns
    // (only newly queued ones, so a repeated send is not billed twice).
    if (newEmails > 0) {
      const currentPeriod = new Date().toISOString().slice(0, 7); // "2026-03"
      await supabase.rpc("increment_marketing_email_usage", { p_business_id: business_id, p_amount: newEmails });
      await supabase.rpc("increment_marketing_monthly_usage", { p_business_id: business_id, p_period: currentPeriod, p_amount: newEmails });
    }

    if (newEmails > 0 || whatsapp.sent + whatsapp.waiting > 0) {
      await supabase.from("broadcasts").insert({
        business_id,
        message: text,
        target_group: "SLOT",
        sent_count: reached.size,
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      broadcast_id: broadcastId,
      guests: bookings.length,
      reached: reached.size,
      email: { queued: emailJobs.length, no_email: bookings.length - withEmail.length, unsubscribed: withEmail.length - emailJobs.length },
      whatsapp,
    }), { status: 200, headers: getCors(req) });

  } catch (err: any) {
    console.error("BROADCAST ERR:", err);
    return new Response(JSON.stringify({ error: "The broadcast could not be sent. Please try again." }), { status: 500, headers: getCors(req) });
  }
});
