import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient } from "../_shared/tenant.ts";

const supabase = createServiceClient();

/**
 * marketing-unsubscribe: one-click unsubscribe handler.
 *
 * GET  ?token=xxx       → shows unsubscribe confirmation page
 * POST ?token=xxx       → processes unsubscribe + shows success
 */
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return htmlRes("<h2>Invalid link</h2><p>This unsubscribe link is invalid or has expired.</p>", 400);
  }

  // Look up token
  const { data: tokenRow } = await supabase
    .from("marketing_unsubscribe_tokens")
    .select("id, contact_id, campaign_id, business_id, used_at, created_at")
    .eq("token", token)
    .maybeSingle();

  if (!tokenRow) {
    return htmlRes("<h2>Link expired</h2><p>This unsubscribe link is no longer valid.</p>", 404);
  }

  // Check if token was already used
  if (tokenRow.used_at) {
    return htmlRes("<h2>Already processed</h2><p>This unsubscribe link has already been used.</p>", 200);
  }

  // Reject tokens older than 90 days
  if (tokenRow.created_at) {
    const tokenAge = Date.now() - new Date(tokenRow.created_at).getTime();
    if (tokenAge > 90 * 24 * 60 * 60 * 1000) {
      return htmlRes("<h2>Link expired</h2><p>This unsubscribe link has expired. Please contact us directly to manage your preferences.</p>", 410);
    }
  }

  // Get contact info
  const { data: contact } = await supabase
    .from("marketing_contacts")
    .select("email, first_name, status")
    .eq("id", tokenRow.contact_id)
    .maybeSingle();

  if (!contact) {
    return htmlRes("<h2>Contact not found</h2><p>We could not find your subscription.</p>", 404);
  }

  // Already unsubscribed
  if (contact.status === "unsubscribed") {
    return htmlRes("<h2>Already unsubscribed</h2><p>You have already been unsubscribed from our emails. No further action is needed.</p>", 200);
  }

  // GET = show confirmation page
  if (req.method === "GET") {
    const safeFirstName = escapeHtml(contact.first_name || "there");
    const safeEmail = escapeHtml(contact.email);
    const safeToken = encodeURIComponent(token);
    return htmlRes(`
      <h2>Unsubscribe</h2>
      <p>Hi ${safeFirstName}, are you sure you want to unsubscribe <strong>${safeEmail}</strong> from our marketing emails?</p>
      <form method="POST" action="?token=${safeToken}">
        <label style="display:block;margin:16px 0 8px;font-size:14px;color:#6b7280;">Reason (optional):</label>
        <select name="reason" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
          <option value="">-- Select a reason --</option>
          <option value="too_frequent">Too many emails</option>
          <option value="not_relevant">Content isn't relevant to me</option>
          <option value="never_subscribed">I never subscribed</option>
          <option value="other">Other</option>
        </select>
        <button type="submit" style="display:block;margin-top:20px;width:100%;padding:12px;background:#dc2626;color:white;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;">
          Unsubscribe
        </button>
      </form>
      <p style="margin-top:16px;font-size:12px;color:#9ca3af;">You will stop receiving marketing emails. Transactional emails (booking confirmations, etc.) are not affected.</p>
    `, 200);
  }

  // POST = process unsubscribe
  if (req.method === "POST") {
    let reason = "";
    try {
      const formData = await req.formData();
      reason = (formData.get("reason") as string) || "";
    } catch { /* no form data */ }

    // Update contact status
    await supabase.from("marketing_contacts")
      .update({ status: "unsubscribed", updated_at: new Date().toISOString() })
      .eq("id", tokenRow.contact_id);

    // Mark token as used
    await supabase.from("marketing_unsubscribe_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("id", tokenRow.id);

    // Record unsubscribe event
    await supabase.from("marketing_events").insert({
      business_id: tokenRow.business_id,
      campaign_id: tokenRow.campaign_id,
      contact_id: tokenRow.contact_id,
      event_type: "unsubscribe",
      metadata: { reason, token },
    });

    // Atomic increment campaign unsubscribe counter
    if (tokenRow.campaign_id) {
      await supabase.rpc("increment_campaign_counter", {
        p_campaign_id: tokenRow.campaign_id,
        p_column: "total_unsubscribes",
      });
    }

    return htmlRes(`
      <h2>Unsubscribed</h2>
      <p>You have been successfully unsubscribed. You will no longer receive marketing emails from us.</p>
      <p style="margin-top:12px;font-size:13px;color:#6b7280;">Booking confirmations and transactional emails are not affected.</p>
    `, 200);
  }

  return htmlRes("<p>Method not allowed</p>", 405);
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlRes(body: string, status: number) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Email Preferences</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:480px;margin:60px auto;padding:32px;background:white;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
${body}
</div></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
