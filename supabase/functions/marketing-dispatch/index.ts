// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient } from "../_shared/tenant.ts";
import { withSentry } from "../_shared/sentry.ts";
import { nonTradingBusinessIds } from "../_shared/subscription.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const RAW_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "";
// Refuse to ever use the Resend dev sandbox as the platform fallback — it
// kills deliverability on bulk mail. See send-email/index.ts for context.
const FROM_EMAIL = RAW_FROM_EMAIL && !/onboarding@resend\.dev|@resend\.dev/i.test(RAW_FROM_EMAIL)
  ? RAW_FROM_EMAIL
  : "BookingTours <noreply@bookingtours.co.za>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
// Throughput budget. At 50 per run on a 5-minute cron this was 14,400 emails a
// day for the WHOLE platform — about 7 per tenant per day at 2,000 tenants, and
// a single 5,000-contact campaign ate a third of it. The ceiling was never
// Resend: the send already uses the batch endpoint, so a run costs one API call
// per 100 recipients regardless of batch size. What actually capped it was two
// sequential DB round trips per email inside the loop, both now batched.
//
// 500 is the maximum claim_marketing_queue will hand out in one call. Paired
// with a per-minute cron that is 720,000 emails/day, which is roughly 5x what
// 2,000 tenants sending two 1,000-contact campaigns a month would need — the
// headroom is deliberate, because campaigns burst rather than trickle.
const BATCH_SIZE = 500;

// Resend's /emails/batch accepts at most 100 messages per request, so a run's
// claim is split into chunks of this size and the chunks go out in parallel.
const RESEND_BATCH_MAX = 100;

// Cap on simultaneous PostgREST writes when recording per-email results. High
// enough to collapse hundreds of sequential round trips into a few, low enough
// not to exhaust the isolate's socket pool.
const DB_WRITE_CONCURRENCY = 50;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
const MAX_RETRIES = 3;

const supabase = createServiceClient();

async function claimPendingQueueItems() {
  const { data, error } = await supabase.rpc("claim_marketing_queue", {
    p_limit: BATCH_SIZE,
    p_max_retries: MAX_RETRIES,
  });

  if (!error) return { items: data || [], error: null };

  console.warn("CLAIM_MARKETING_QUEUE_RPC_FALLBACK:", error.message);

  const { data: fallbackItems, error: fetchErr } = await supabase
    .from("marketing_queue")
    .select("id, business_id, campaign_id, contact_id, email, first_name, retry_count")
    .eq("status", "pending")
    .lt("retry_count", MAX_RETRIES)
    .or("next_retry_at.is.null,next_retry_at.lte." + new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchErr) return { items: [], error: fetchErr };
  if (!fallbackItems || fallbackItems.length === 0) return { items: [], error: null };

  const itemIds = fallbackItems.map((i: any) => i.id);
  await supabase.from("marketing_queue").update({ status: "processing" }).in("id", itemIds).eq("status", "pending");
  return { items: fallbackItems, error: null };
}

Deno.serve(withSentry("marketing-dispatch", async (_req: Request) => {
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

    // ── 1. Atomically claim pending queue items (oldest first, respecting retry backoff) ──
    const { items, error: fetchErr } = await claimPendingQueueItems();

    if (fetchErr) {
      console.error("QUEUE_FETCH_ERR:", fetchErr.message);
      return jsonRes({ error: fetchErr.message }, 500);
    }
    if (!items || items.length === 0) {
      return jsonRes({ ok: true, processed: 0, message: "Queue empty" }, 200);
    }

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

    // ── 2b. Load per-business brand name for sender + brand replacement ──
    const bizIds = [...new Set(Object.values(campaignMap).map((c) => c.businessId))];
    const bizFromMap: Record<string, string> = {};
    const bizBrandMap: Record<string, string> = {};
    const bizSiteMap: Record<string, string> = {};
    if (bizIds.length > 0) {
      const { data: bizRows } = await supabase.from("businesses").select("id, business_name, name, subdomain, booking_site_url").in("id", bizIds);
      for (const b of (bizRows || []) as any[]) {
        const name = b.business_name || b.name || "Marketing";
        bizBrandMap[b.id] = name;
        bizSiteMap[b.id] = String(b.booking_site_url || (b.subdomain ? "https://" + b.subdomain + ".booking.bookingtours.co.za" : "")).replace(/\/+$/, "");
        // V-12: send from the verified ROOT domain bookingtours.co.za with the
        // tenant's brand name as the display label. Per-subdomain From would
        // need each tenant subdomain DNS-verified in Resend, which isn't done,
        // and Resend returned HTTP 403 "domain not verified" for them.
        bizFromMap[b.id] = name + " <noreply@bookingtours.co.za>";
      }
    }

    // ── 3. Generate unsubscribe tokens + prepare emails ──
    const sentIds: string[] = [];
    const failedIds: { id: string; error: string; retryable: boolean }[] = [];
    const deferredIds: string[] = [];
    const businessCounts: Record<string, number> = {};
    const trackingBaseUrl = SUPABASE_URL + "/functions/v1/marketing-track";

    const emailPayloads: Array<{ from: string; to: string[]; subject: string; html: string; queueId: string; contactId: string; campaignId: string; businessId: string; unsubscribeUrl: string }> = [];
    const tokenRows: Array<{ business_id: string; campaign_id: string; contact_id: string; token: string }> = [];

    // A contact's status was only ever checked once, at queue-build time
    // (app/marketing/templates/page.tsx). Anyone who unsubscribed after being
    // queued — or before this cron tick caught up — still got emailed. One
    // batch lookup here re-verifies status right before actually sending.
    const contactIds = Array.from(new Set((items as any[]).map((i) => i.contact_id).filter(Boolean)));
    let unsubscribedContactIds = new Set<string>();
    if (contactIds.length > 0) {
      const { data: unsubContacts, error: unsubErr } = await supabase.from("marketing_contacts")
        .select("id")
        .eq("status", "unsubscribed")
        .in("id", contactIds);
      if (unsubErr) console.error("MARKETING_DISPATCH_UNSUB_LOOKUP_ERR:", unsubErr.message);
      else unsubscribedContactIds = new Set((unsubContacts || []).map((c: any) => c.id));
    }

    // Fix 3b: a paused or suspended operator sends no new marketing. Deferred,
    // not failed — the rows go back to `pending`, so a campaign queued before a
    // seasonal pause sends when the operator resumes rather than being lost.
    const pausedBusinessIds = await nonTradingBusinessIds(
      supabase,
      (items as any[]).map((i) => i.business_id),
    );
    if (pausedBusinessIds.size > 0) {
      console.log("MARKETING_DISPATCH_SKIP_NON_TRADING businesses=" + [...pausedBusinessIds].join(","));
    }

    for (const item of items as any[]) {
      if (pausedBusinessIds.has(String(item.business_id))) {
        deferredIds.push(item.id);
        continue;
      }

      const camp = campaignMap[item.campaign_id];
      if (!camp) {
        failedIds.push({ id: item.id, error: "Campaign/template not found", retryable: false });
        continue;
      }

      if (unsubscribedContactIds.has(item.contact_id)) {
        failedIds.push({ id: item.id, error: "Recipient unsubscribed before send", retryable: false });
        continue;
      }

      // Skip items for campaigns that are NOT in "sending" status (cancelled, paused, etc.)
      if (camp.status !== "sending") {
        // U9: scheduled/paused campaigns become "sending" later — release the
        // claim so these rows return to "pending" instead of stranding in
        // "processing", and send when the campaign's scheduled time arrives.
        if (camp.status === "scheduled" || camp.status === "paused") {
          deferredIds.push(item.id);
        }
        continue;
      }

      // Unsubscribe token. Generated locally here and written in one bulk
      // insert after the loop — this used to be a round trip per email, which
      // is half of what capped the batch size. The invariant is unchanged: the
      // insert still happens before anything is handed to Resend, so no email
      // can go out without a working unsubscribe link behind it.
      const unsubToken = crypto.randomUUID();
      tokenRows.push({
        business_id: item.business_id,
        campaign_id: item.campaign_id,
        contact_id: item.contact_id,
        token: unsubToken,
      });

      const unsubscribeUrl = SUPABASE_URL + "/functions/v1/marketing-unsubscribe?token=" + unsubToken;

      // Variable replacement — including brand tokens. Older templates that
      // were seeded with a literal "Cape Kayak" string get rewritten to the
      // tenant's actual business_name so multi-tenant tenants don't leak the
      // origin tenant's brand to their own customers (U-7 / U-12).
      const brand = bizBrandMap[item.business_id] || "Our Team";
      let html = camp.html
        .replace(/\{first_name\}/g, item.first_name || "there")
        .replace(/\{\{?\s*(company_name|business_name|brand_name)\s*\}?\}/g, brand)
        .replace(/Cape Kayak Adventures/g, brand)
        .replace(/Cape Kayak/g, brand)
        .replace(/\{site_url\}/g, bizSiteMap[item.business_id] || "")
        .replace(/\{\{unsubscribe_url\}\}/g, unsubscribeUrl);

      const subject = camp.subject
        .replace(/\{first_name\}/g, item.first_name || "there")
        .replace(/\{\{?\s*(company_name|business_name|brand_name)\s*\}?\}/g, brand)
        .replace(/Cape Kayak/g, brand);

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
        unsubscribeUrl,
      });
    }

    // Release claims on not-yet-due campaign items (see U9 note above)
    if (deferredIds.length > 0) {
      await supabase.from("marketing_queue")
        .update({ status: "pending", updated_at: new Date().toISOString() })
        .in("id", deferredIds).eq("status", "processing");
    }

    // ── 4. Send via Resend batch API ──
    // Persist every unsubscribe token in one insert, before anything is sent.
    // All-or-nothing on purpose: if this fails we do not know which links would
    // work, so the whole batch goes back to the queue rather than risk mailing
    // anyone a dead unsubscribe link.
    if (tokenRows.length > 0) {
      const { error: tokenErr } = await supabase.from("marketing_unsubscribe_tokens").insert(tokenRows);
      if (tokenErr) {
        console.error("MARKETING_DISPATCH_TOKEN_INSERT_ERR:", tokenErr.message);
        for (const p of emailPayloads) {
          failedIds.push({ id: p.queueId, error: "Failed to create unsubscribe token: " + tokenErr.message, retryable: true });
        }
        emailPayloads.length = 0;
      }
    }

    if (emailPayloads.length > 0) {
      // RFC 8058 one-click unsubscribe header — mailbox providers require it
      // for bulk mail. Without it Gmail / Yahoo route most of these to spam.
      const toResendMessage = (p: typeof emailPayloads[number]) => ({
        from: p.from,
        to: p.to,
        subject: p.subject,
        html: p.html,
        headers: {
          "List-Unsubscribe": "<" + p.unsubscribeUrl + ">",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });

      // One request per 100 recipients (Resend's per-request maximum), all in
      // flight together. A run of 500 is 5 requests, not 500.
      const groups = chunk(emailPayloads, RESEND_BATCH_MAX);
      const responses = await Promise.all(groups.map((group) =>
        fetch("https://api.resend.com/emails/batch", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + RESEND_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(group.map(toResendMessage)),
        })
          .then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) }))
          // A network failure on one chunk must not lose the other four.
          .catch((e) => ({ ok: false, status: 0, data: { message: e instanceof Error ? e.message : String(e) } }))
      ));

      // Recorded after the sends land, batched rather than one round trip per
      // email — the other half of what capped the old batch size.
      const idUpdates: Array<{ queueId: string; emailId: string }> = [];

      for (let gi = 0; gi < groups.length; gi++) {
        const group = groups[gi];
        const res = responses[gi];

        if (res.ok) {
          const resData = res.data as any;
          const results = resData.data || resData || [];
          if (Array.isArray(results)) {
            for (let i = 0; i < group.length; i++) {
              const payload = group[i];
              const result = results[i];
              if (result?.id) {
                sentIds.push(payload.queueId);
                businessCounts[payload.businessId] = (businessCounts[payload.businessId] || 0) + 1;
                // Store resend email ID for later bounce matching
                idUpdates.push({ queueId: payload.queueId, emailId: result.id });
              } else {
                failedIds.push({ id: payload.queueId, error: result?.message || "Send failed", retryable: true });
              }
            }
          } else {
            // Unexpected response shape — mark as retryable rather than optimistically marking sent
            console.warn("RESEND_UNEXPECTED_RESPONSE:", JSON.stringify(resData).substring(0, 500));
            for (const p of group) {
              failedIds.push({ id: p.queueId, error: "Unexpected Resend response shape", retryable: true });
            }
          }
        } else {
          // This chunk failed — mark retryable. Scoped to the chunk, so one bad
          // request no longer condemns the other four hundred recipients.
          const errMsg = (res.data as any)?.message || "Batch API error " + res.status;
          for (const p of group) {
            failedIds.push({ id: p.queueId, error: errMsg, retryable: res.status >= 500 || res.status === 429 || res.status === 0 });
          }
      }
      }

      // Bounce-matching ids, written concurrently in bounded waves instead of
      // one blocking round trip per email.
      for (const wave of chunk(idUpdates, DB_WRITE_CONCURRENCY)) {
        await Promise.all(wave.map((u) =>
          supabase.from("marketing_queue").update({ resend_email_id: u.emailId }).eq("id", u.queueId)
        ));
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
}));

function jsonRes(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
