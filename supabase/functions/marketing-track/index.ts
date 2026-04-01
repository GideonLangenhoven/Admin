import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient } from "../_shared/tenant.ts";

const supabase = createServiceClient();

// 1x1 transparent GIF for open tracking pixel
const PIXEL = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), c => c.charCodeAt(0));

/**
 * marketing-track: handles open pixels and click redirects.
 *
 * Open:  GET ?t=open&q=queue_id&c=campaign_id&k=contact_id  → returns 1x1 GIF
 * Click: GET ?t=click&q=queue_id&c=campaign_id&k=contact_id&url=... → 302 redirect
 */
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const type = url.searchParams.get("t");       // "open" or "click"
  const queueId = url.searchParams.get("q");
  const campaignId = url.searchParams.get("c");
  const contactId = url.searchParams.get("k");
  const clickUrl = url.searchParams.get("url");
  const automationId = url.searchParams.get("a");
  const enrollmentId = url.searchParams.get("e");

  if (!type || (!campaignId && !automationId) || !contactId) {
    return new Response("Bad request", { status: 400 });
  }

  // Look up business_id from queue or campaign
  let businessId: string | null = null;
  if (queueId) {
    const { data: qRow } = await supabase.from("marketing_queue").select("business_id").eq("id", queueId).maybeSingle();
    businessId = qRow?.business_id || null;
  }
  if (!businessId && campaignId) {
    const { data: cRow } = await supabase.from("marketing_campaigns").select("business_id").eq("id", campaignId).maybeSingle();
    businessId = cRow?.business_id || null;
  }

  // For automation-sourced events, resolve business from automation
  if (!businessId && automationId) {
    const { data: autoRow } = await supabase.from("marketing_automations").select("business_id").eq("id", automationId).maybeSingle();
    businessId = autoRow?.business_id || null;
  }

  if (!businessId) {
    // Can't resolve business — return gracefully (don't break user experience)
    if (type === "open") {
      return new Response(PIXEL, { status: 200, headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" } });
    }
    if (type === "click" && clickUrl && (clickUrl.startsWith("https://") || clickUrl.startsWith("http://"))) {
      return new Response(null, { status: 302, headers: { Location: clickUrl } });
    }
    return new Response("Not found", { status: 404 });
  }

  if (type === "open") {
    // Record open event
    await supabase.from("marketing_events").insert({
      business_id: businessId,
      campaign_id: campaignId,
      contact_id: contactId,
      queue_id: queueId,
      event_type: "open",
      metadata: { user_agent: req.headers.get("user-agent") || "" },
    });

    // Atomic increment contact opens
    await supabase.rpc("increment_contact_counter", { p_contact_id: contactId, p_column: "total_opens" });
    await supabase.from("marketing_contacts").update({
      last_open_at: new Date().toISOString(),
    }).eq("id", contactId);

    // Log to automation logs if this is an automation-sourced event
    if (automationId) {
      await supabase.from("marketing_automation_logs").insert({
        enrollment_id: enrollmentId,
        automation_id: automationId,
        contact_id: contactId,
        business_id: businessId,
        step_type: "send_email",
        action: "email_opened",
        metadata: {},
      });
    }

    // Increment campaign unique open counter (count unique opens per contact)
    if (campaignId) {
      const { count } = await supabase.from("marketing_events")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .eq("contact_id", contactId)
        .eq("event_type", "open");

      if (count === 1) {
        // First open by this contact — increment unique open counter atomically
        await supabase.rpc("increment_campaign_counter", { p_campaign_id: campaignId, p_column: "total_opens" });
      }
    }

    return new Response(PIXEL, {
      status: 200,
      headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  }

  if (type === "click" && clickUrl) {
    // Validate redirect URL to prevent open redirect attacks
    if (!clickUrl.startsWith("https://") && !clickUrl.startsWith("http://")) {
      return new Response("Invalid URL", { status: 400 });
    }

    // Record click event
    await supabase.from("marketing_events").insert({
      business_id: businessId,
      campaign_id: campaignId,
      contact_id: contactId,
      queue_id: queueId,
      event_type: "click",
      metadata: { url: clickUrl, user_agent: req.headers.get("user-agent") || "" },
    });

    // Log to automation logs if this is an automation-sourced event
    if (automationId) {
      await supabase.from("marketing_automation_logs").insert({
        enrollment_id: enrollmentId,
        automation_id: automationId,
        contact_id: contactId,
        business_id: businessId,
        step_type: "send_email",
        action: "link_clicked",
        metadata: { url: clickUrl },
      });
    }

    // Atomic increment contact clicks
    await supabase.rpc("increment_contact_counter", { p_contact_id: contactId, p_column: "total_clicks" });
    await supabase.from("marketing_contacts").update({
      last_click_at: new Date().toISOString(),
    }).eq("id", contactId);

    // Increment campaign unique click counter
    if (campaignId) {
      const { count: clickCount } = await supabase.from("marketing_events")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .eq("contact_id", contactId)
        .eq("event_type", "click");

      if (clickCount === 1) {
        await supabase.rpc("increment_campaign_counter", { p_campaign_id: campaignId, p_column: "total_clicks" });
      }
    }

    // 302 redirect to actual URL
    return new Response(null, { status: 302, headers: { Location: clickUrl } });
  }

  return new Response("Not found", { status: 404 });
});
