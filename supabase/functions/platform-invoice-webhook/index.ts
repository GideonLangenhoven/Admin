// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Webhook for BookingTours' OWN Yoco merchant account (platform invoices) —
// a completely different merchant context from any tenant's own Yoco
// account, so it cannot share yoco-webhook's per-tenant secret lookup.
// Same order of operations as yoco-webhook: verify signature BEFORE any
// business logic, zero DB writes on a bad/missing signature, then an
// idempotency check before processing.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Webhook } from "npm:standardwebhooks";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { restoreTenantIfSettled } from "../_shared/billing.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY")!;
const PLATFORM_YOCO_WEBHOOK_SECRET = Deno.env.get("PLATFORM_YOCO_WEBHOOK_SECRET") || "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  const rawBody = await req.text();
  const body = rawBody ? JSON.parse(rawBody) : {};
  const type = body.type;
  const payload = body.payload || {};

  if (type !== "payment.succeeded") {
    console.log("PLATFORM_INVOICE_WEBHOOK: ignoring event type " + type);
    return new Response("OK", { status: 200 });
  }

  const platformInvoiceId = String(payload.metadata?.platform_invoice_id || "");
  const yocoPaymentId = String(payload.id || "");
  if (!platformInvoiceId) {
    console.log("PLATFORM_INVOICE_WEBHOOK: no platform_invoice_id in metadata, ignoring");
    return new Response("OK", { status: 200 });
  }

  if (!PLATFORM_YOCO_WEBHOOK_SECRET) {
    console.error("PLATFORM_INVOICE_WEBHOOK_VERIFY_ERROR: PLATFORM_YOCO_WEBHOOK_SECRET not configured — rejecting");
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const webhook = new Webhook(PLATFORM_YOCO_WEBHOOK_SECRET);
    await webhook.verify(rawBody, {
      "webhook-id": req.headers.get("webhook-id") || "",
      "webhook-timestamp": req.headers.get("webhook-timestamp") || "",
      "webhook-signature": req.headers.get("webhook-signature") || "",
    });
  } catch (verifyError) {
    // Console-only — zero DB writes on an invalid/missing signature.
    console.error("PLATFORM_INVOICE_WEBHOOK_VERIFY_ERROR:", verifyError, {
      platform_invoice_id: platformInvoiceId,
      yoco_payment_id: yocoPaymentId || null,
    });
    return new Response("Unauthorized", { status: 401 });
  }

  // ── IDEMPOTENCY CHECK ──
  if (yocoPaymentId) {
    const idempotencyKey = "platform_invoice_yoco:" + yocoPaymentId;
    const idempInsert = await supabase.from("idempotency_keys").insert({ key: idempotencyKey }).select("id").maybeSingle();
    if (idempInsert.error && idempInsert.error.code === "23505") {
      console.log("IDEMPOTENCY_SKIP: already processed key=" + idempotencyKey);
      return new Response("OK", { status: 200 });
    }
  }

  const { error: updateErr } = await supabase.from("platform_invoices").update({
    status: "PAID",
    paid_at: new Date().toISOString(),
    paid_method: "YOCO",
    yoco_payment_id: yocoPaymentId || null,
  }).eq("id", platformInvoiceId);

  if (updateErr) {
    console.error("PLATFORM_INVOICE_WEBHOOK_UPDATE_ERR:", updateErr.message, { platform_invoice_id: platformInvoiceId });
  } else {
    // Fix 4: the money landed, so lift a non-payment lockout. Only restores a
    // tenant this system suspended (PAST_DUE, or SUSPENDED/NON_PAYMENT) and
    // only once every other issued invoice is settled. A manual suspension is
    // a human decision and is never auto-reversed. Best-effort: a webhook that
    // recorded the payment must still return 200.
    try {
      const { data: inv } = await supabase.from("platform_invoices").select("business_id").eq("id", platformInvoiceId).maybeSingle();
      if (inv?.business_id) await restoreTenantIfSettled(supabase, inv.business_id, { exceptInvoiceId: platformInvoiceId });
    } catch (e) {
      console.error("PLATFORM_INVOICE_WEBHOOK_RESTORE_ERR:", e instanceof Error ? e.message : String(e));
    }
  }

  return new Response("OK", { status: 200 });
});
