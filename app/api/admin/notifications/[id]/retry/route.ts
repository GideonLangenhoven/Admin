import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin, isPrivilegedRole } from "@/app/lib/api-auth";
import { createClient } from "@supabase/supabase-js";

// AM3: retry a failed outbox message by SENDING IT NOW with the tenant's own
// WhatsApp credentials. (The old behaviour — reset to PENDING for the
// outbox-send cron — queued into a cron that was unscheduled on 2026-05-02,
// so Retry silently never delivered.)
// Outcomes:
//   sent                 → delivered, row marked SENT
//   queued_window_closed → Meta 24h window closed; row parked as
//                          WAITING_WINDOW, which wa-webhook drains the next
//                          time this customer messages in
//   (non-2xx)            → row marked FAILED with Meta's error
// Per-business scoping is enforced — admin can only retry rows in their own tenant.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isPrivilegedRole(caller.role)) return NextResponse.json({ error: "MAIN_ADMIN required" }, { status: 403 });

  const { id } = await params;
  const db = adminClient();

  const { data: row } = await db.from("outbox")
    .select("id, status, business_id, phone, message_body, attempts")
    .eq("id", id)
    .eq("business_id", caller.business_id)
    .maybeSingle();

  if (!row) {
    const { data: emailJob, error: emailError } = await db.from("notification_jobs")
      .select("id, status, business_id")
      .eq("id", id)
      .eq("business_id", caller.business_id)
      .maybeSingle();
    if (emailError) return NextResponse.json({ error: emailError.message }, { status: 500 });
    if (!emailJob) return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    if (emailJob.status !== "FAILED") return NextResponse.json({ error: "Only FAILED email jobs can be retried" }, { status: 400 });
    const { data: retryResult, error: retryError } = await db.rpc("retry_notification_job", {
      p_job_id: emailJob.id,
      p_business_id: caller.business_id,
      p_actor_id: caller.id,
    });
    if (retryError) return NextResponse.json({ error: retryError.message }, { status: 500 });
    if (!retryResult?.ok) {
      if (retryResult?.status === "RECONCILIATION_REQUIRED") {
        return NextResponse.json({ error: "Provider acceptance is uncertain and the idempotency window expired. Reconcile this email in Resend before retrying." }, { status: 409 });
      }
      if (retryResult?.status === "RETRY_WINDOW_EXPIRED") {
        return NextResponse.json({ error: "The provider idempotency window expired. Create a new notification instead of retrying this delivery." }, { status: 409 });
      }
      if (retryResult?.status === "FORBIDDEN") return NextResponse.json({ error: "Not authorized to retry this notification" }, { status: 403 });
      if (retryResult?.status === "RETRY_LIMIT") return NextResponse.json({ error: "Manual retry limit reached" }, { status: 409 });
      return NextResponse.json({ error: "Notification can no longer be retried" }, { status: retryResult?.status === "NOT_FOUND" ? 404 : 409 });
    }
    return NextResponse.json({ ok: true, outcome: "queued" });
  }
  const encryptionKey = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!encryptionKey || encryptionKey.length < 32) {
    return NextResponse.json({ error: "SETTINGS_ENCRYPTION_KEY is not configured on the server." }, { status: 500 });
  }
  if (!["FAILED", "EXPIRED"].includes(row.status)) {
    return NextResponse.json({ error: "Only FAILED or EXPIRED rows can be retried" }, { status: 400 });
  }
  if (!row.phone || !row.message_body) {
    return NextResponse.json({ error: "Row has no phone or message body to send" }, { status: 400 });
  }

  // Tenant WhatsApp credentials — same encrypted RPC the edge functions use.
  const { data: creds, error: credErr } = await db.rpc("get_business_credentials", {
    p_business_id: row.business_id,
    p_key: encryptionKey,
  });
  const credRow = Array.isArray(creds) ? creds[0] : creds;
  const waToken = String(credRow?.wa_token || "");
  const waPhoneId = String(credRow?.wa_phone_id || "");
  if (credErr || !waToken || !waPhoneId) {
    return NextResponse.json({ error: "WhatsApp is not configured for this business (Settings → Integration Credentials)." }, { status: 400 });
  }

  const attempts = (Number(row.attempts) || 0) + 1;
  let outcome: "sent" | "queued_window_closed" | "failed" = "failed";
  let metaError = "";
  try {
    const res = await fetch("https://graph.facebook.com/v19.0/" + encodeURIComponent(waPhoneId) + "/messages", {
      method: "POST",
      headers: { Authorization: "Bearer " + waToken, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: row.phone, type: "text", text: { body: row.message_body } }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (res.ok) {
      outcome = "sent";
      await db.from("outbox").update({
        status: "SENT", sent_at: new Date().toISOString(), attempts, error: null,
      }).eq("id", row.id);
    } else if (data?.error?.code === 131047 || data?.error?.code === 131026) {
      // 24h window closed — park for wa-webhook's drain-on-reply.
      outcome = "queued_window_closed";
      await db.from("outbox").update({
        status: "WAITING_WINDOW",
        scheduled_for: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // far future; drained on reply
        attempts, error: null,
      }).eq("id", row.id);
    } else {
      metaError = String(data?.error?.message || "WhatsApp send failed (" + res.status + ")");
      await db.from("outbox").update({ status: "FAILED", attempts, error: metaError }).eq("id", row.id);
    }
  } catch (e: any) {
    metaError = String(e?.message || "WhatsApp send failed (network)");
    await db.from("outbox").update({ status: "FAILED", attempts, error: metaError }).eq("id", row.id);
  }

  const { error: auditError } = await db.from("audit_logs").insert({
    actor_id: caller.id,
    business_id: caller.business_id,
    action_type: "OUTBOX_RETRY",
    target_entity: "outbox",
    target_id: id,
    metadata: { outcome },
  });
  if (auditError) return NextResponse.json({ error: "Notification retry completed, but its audit log could not be recorded: " + auditError.message }, { status: 500 });

  if (outcome === "failed") {
    console.error("OUTBOX_RETRY_ERR", id, metaError);
    return NextResponse.json({ error: metaError || "Send failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, outcome });
}
