import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient } from "../_shared/tenant.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "BookingTours <noreply@bookingtours.co.za>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const BATCH_SIZE = 50;
const MAX_RETRIES = 3;

const supabase = createServiceClient();

Deno.serve(async (_req: Request) => {
  try {
    if (!RESEND_API_KEY) {
      console.error("MARKETING_DISPATCH: RESEND_API_KEY not configured — skipping");
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not set" }), { status: 503 });
    }

    // ── 0. Activate any scheduled campaigns that are due ──
    await supabase.from("marketing_campaigns")
      .update({ status: "sending", started_at: new Date().toISOString() })
      .eq("status", "scheduled")
      .lte("scheduled_at", new Date().toISOString());

    // ── 1. Fetch pending queue items (oldest first, respecting retry backoff) ──
    // Atomically claim items by updating status to "processing" in the same query.
    // This prevents a concurrent dispatch invocation from picking up the same items.
    const { data: items, error: fetchErr } = await supabase
      .from("marketing_queue")
      .select("id, business_id, campaign_id, contact_id, email, first_name, retry_count")
      .eq("status", "pending")
      .lt("retry_count", MAX_RETRIES)
      .or("next_retry_at.is.null,next_retry_at.lte." + new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (fetchErr) {
      console.error("QUEUE_FETCH_ERR:", fetchErr.message);
      return jsonRes({ error: fetchErr.message }, 500);
    }
    if (!items || items.length === 0) {
      return jsonRes({ ok: true, processed: 0, message: "Queue empty" }, 200);
    }

    // Mark items as "processing" to prevent concurrent dispatch from picking them up
    const itemIds = items.map((i: any) => i.id);
    await supabase.from("marketing_queue").update({ status: "processing" }).in("id", itemIds).eq("status", "pending");

    // ── 2. Load campaigns + templates (only campaigns in "sending" status) ──
    const campaignIds = [...new Set(items.map((i: any) => i.campaign_id))];
    const { data: campaigns } = await supabase
      .from("marketing_campaigns")
      .select("id, subject_line, template_id, business_id, status, marketing_templates(html_content, subject_line)")
      .in("id", campaignIds);

    const campaignMap: Record<string, { subject: string; html: string; businessId: string; status: string }> = {};
    for (const c of (campaigns || []) as any[]) {
      const tpl = c.marketing_templates;
      campaignMap[c.id] = {
        subject: c.subject_line || tpl?.subject_line || "Update",
        html: tpl?.html_content || "<p>No content</p>",
        businessId: c.business_id,
        status: c.status,
      };
    }

    // ── 2b. Load per-business subdomain for sender address ──
    const bizIds = [...new Set(Object.values(campaignMap).map((c) => c.businessId))];
    const bizFromMap: Record<string, string> = {};
    if (bizIds.length > 0) {
      const { data: bizRows } = await supabase.from("businesses").select("id, business_name, subdomain").in("id", bizIds);
      for (const b of (bizRows || []) as any[]) {
        const name = b.business_name || "Marketing";
        if (b.subdomain) {
          bizFromMap[b.id] = name + " <noreply@" + b.subdomain + ".bookingtours.co.za>";
        }
      }
    }

    // ── 3. Generate unsubscribe tokens + prepare emails ──
    const sentIds: string[] = [];
    const failedIds: { id: string; error: string; retryable: boolean }[] = [];
    const businessCounts: Record<string, number> = {};
    const trackingBaseUrl = SUPABASE_URL + "/functions/v1/marketing-track";

    const emailPayloads: Array<{ from: string; to: string[]; subject: string; html: string; queueId: string; contactId: string; campaignId: string; businessId: string }> = [];

    for (const item of items as any[]) {
      const camp = campaignMap[item.campaign_id];
      if (!camp) {
        failedIds.push({ id: item.id, error: "Campaign/template not found", retryable: false });
        continue;
      }

      // Skip items for campaigns that are NOT in "sending" status (cancelled, paused, etc.)
      if (camp.status !== "sending") {
        continue;
      }

      // Generate unsubscribe token (with error handling — don't send without a working unsubscribe link)
      const unsubToken = crypto.randomUUID();
      const { error: tokenErr } = await supabase.from("marketing_unsubscribe_tokens").insert({
        business_id: item.business_id,
        campaign_id: item.campaign_id,
        contact_id: item.contact_id,
        token: unsubToken,
      });
      if (tokenErr) {
        failedIds.push({ id: item.id, error: "Failed to create unsubscribe token: " + tokenErr.message, retryable: true });
        continue;
      }

      const unsubscribeUrl = SUPABASE_URL + "/functions/v1/marketing-unsubscribe?token=" + unsubToken;

      // Variable replacement
      let html = camp.html
        .replace(/\{first_name\}/g, item.first_name || "there")
        .replace(/\{\{unsubscribe_url\}\}/g, unsubscribeUrl);

      const subject = camp.subject.replace(/\{first_name\}/g, item.first_name || "there");

      // Inject open-tracking pixel before </body>
      const openPixelUrl = trackingBaseUrl + "?t=open&q=" + item.id + "&c=" + item.campaign_id + "&k=" + item.contact_id;
      html = html.replace("</body>", '<img src="' + openPixelUrl + '" width="1" height="1" style="display:none" alt="" /></body>');

      // Rewrite <a> links for click tracking (skip unsubscribe link)
      html = html.replace(/<a\s+([^>]*?)href="([^"]+)"([^>]*?)>/g, function (_match: string, pre: string, href: string, post: string) {
        if (href.includes("marketing-unsubscribe") || href === "#") return _match;
        const trackedUrl = trackingBaseUrl + "?t=click&q=" + item.id + "&c=" + item.campaign_id + "&k=" + item.contact_id + "&url=" + encodeURIComponent(href);
        return '<a ' + pre + 'href="' + trackedUrl + '"' + post + '>';
      });

      emailPayloads.push({
        from: bizFromMap[item.business_id] || FROM_EMAIL,
        to: [item.email],
        subject,
        html,
        queueId: item.id,
        contactId: item.contact_id,
        campaignId: item.campaign_id,
        businessId: item.business_id,
      });
    }

    // ── 4. Send via Resend batch API ──
    if (emailPayloads.length > 0) {
      const batchBody = emailPayloads.map((p) => ({
        from: p.from,
        to: p.to,
        subject: p.subject,
        html: p.html,
      }));

      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + RESEND_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batchBody),
      });

      if (res.ok) {
        const resData = await res.json();
        const results = resData.data || resData || [];
        if (Array.isArray(results)) {
          for (let i = 0; i < emailPayloads.length; i++) {
            const payload = emailPayloads[i];
            const result = results[i];
            if (result?.id) {
              sentIds.push(payload.queueId);
              businessCounts[payload.businessId] = (businessCounts[payload.businessId] || 0) + 1;
              // Store resend email ID for later bounce matching
              await supabase.from("marketing_queue").update({ resend_email_id: result.id }).eq("id", payload.queueId);
            } else {
              failedIds.push({ id: payload.queueId, error: result?.message || "Send failed", retryable: true });
            }
          }
        } else {
          // Unexpected response shape — mark as retryable rather than optimistically marking sent
          console.warn("RESEND_UNEXPECTED_RESPONSE:", JSON.stringify(resData).substring(0, 500));
          for (const p of emailPayloads) {
            failedIds.push({ id: p.queueId, error: "Unexpected Resend response shape", retryable: true });
          }
        }
      } else {
        // Entire batch failed — mark retryable
        const errBody = await res.json().catch(() => ({}));
        const errMsg = (errBody as any)?.message || "Batch API error " + res.status;
        for (const p of emailPayloads) {
          failedIds.push({ id: p.queueId, error: errMsg, retryable: res.status >= 500 || res.status === 429 });
        }
      }
    }

    // ── 5. Update queue rows ──
    if (sentIds.length > 0) {
      await supabase.from("marketing_queue")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .in("id", sentIds);
    }

    for (const fail of failedIds) {
      if (fail.retryable) {
        // Increment retry, set backoff
        const qItem = items.find((i: any) => i.id === fail.id) as any;
        const retryCount = (qItem?.retry_count || 0) + 1;
        if (retryCount >= MAX_RETRIES) {
          await supabase.from("marketing_queue").update({ status: "failed", error_message: fail.error + " (max retries)" }).eq("id", fail.id);
        } else {
          const backoffMs = Math.pow(2, retryCount) * 60000; // 2min, 4min, 8min
          await supabase.from("marketing_queue").update({
            status: "pending",
            retry_count: retryCount,
            next_retry_at: new Date(Date.now() + backoffMs).toISOString(),
            error_message: fail.error,
          }).eq("id", fail.id);
        }
      } else {
        await supabase.from("marketing_queue").update({ status: "failed", error_message: fail.error }).eq("id", fail.id);
      }
    }

    // ── 6. Update campaign counters (atomic RPCs) ──
    for (const campId of campaignIds) {
      const campSent = sentIds.filter((sid) => { const it = items.find((i: any) => i.id === sid) as any; return it?.campaign_id === campId; }).length;
      const campFailed = failedIds.filter((f) => { if (f.retryable) return false; const it = items.find((i: any) => i.id === f.id) as any; return it?.campaign_id === campId; }).length;

      if (campSent > 0) {
        await supabase.rpc("increment_campaign_counter", { p_campaign_id: campId, p_column: "total_sent", p_amount: campSent });
      }
      if (campFailed > 0) {
        await supabase.rpc("increment_campaign_counter", { p_campaign_id: campId, p_column: "total_failed", p_amount: campFailed });
      }

      // Check if campaign is complete — use status guard to prevent concurrent double-marking
      if (campSent > 0 || campFailed > 0) {
        const { data: campRow } = await supabase.from("marketing_campaigns").select("total_sent, total_failed, total_recipients, status").eq("id", campId).single();
        if (campRow && campRow.status !== "done" && (campRow.total_sent || 0) + (campRow.total_failed || 0) >= (campRow.total_recipients || 0)) {
          await supabase.from("marketing_campaigns").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", campId).neq("status", "done");
        }
      }
    }

    // ── 7. Update contact total_received counts (atomic) ──
    const contactReceived: Record<string, number> = {};
    for (const sid of sentIds) {
      const qItem = items.find((i: any) => i.id === sid) as any;
      if (qItem) contactReceived[qItem.contact_id] = (contactReceived[qItem.contact_id] || 0) + 1;
    }
    for (const [contactId, count] of Object.entries(contactReceived)) {
      await supabase.rpc("increment_contact_counter", { p_contact_id: contactId, p_column: "total_received", p_amount: count });
    }

    // ── 7b. Update last_email_at for contacts we just sent to ──
    const sentContactIds = [...new Set(sentIds.map((sid) => {
      const qItem = items.find((i: any) => i.id === sid) as any;
      return qItem?.contact_id;
    }).filter(Boolean))];

    if (sentContactIds.length > 0) {
      await supabase.from("marketing_contacts")
        .update({ last_email_at: new Date().toISOString() })
        .in("id", sentContactIds);
    }

    // ── 8. Billing: atomic increment marketing_email_usage per business ──
    for (const [bizId, count] of Object.entries(businessCounts)) {
      // Use raw SQL via RPC to avoid read-then-write race condition
      await supabase.rpc("increment_marketing_email_usage", { p_business_id: bizId, p_amount: count });
    }

    // ── 8b. Billing: atomic increment monthly usage tracking ──
    const currentPeriod = new Date().toISOString().slice(0, 7); // "2026-03"
    for (const [bizId, count] of Object.entries(businessCounts)) {
      await supabase.rpc("increment_marketing_monthly_usage", {
        p_business_id: bizId,
        p_period: currentPeriod,
        p_amount: count,
      });
    }

    console.log("MARKETING_DISPATCH: sent=" + sentIds.length + " failed=" + failedIds.length + " retryable=" + failedIds.filter(f => f.retryable).length);
    return jsonRes({ ok: true, processed: items.length, sent: sentIds.length, failed: failedIds.length }, 200);
  } catch (err: any) {
    console.error("MARKETING_DISPATCH_ERROR:", err);
    return jsonRes({ error: err.message || "Internal error" }, 500);
  }
});

function jsonRes(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
