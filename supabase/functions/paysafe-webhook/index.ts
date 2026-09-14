// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient } from "../_shared/tenant.ts";
import { confirmComboAndNotify, releaseFailedCombo } from "../_shared/combo.ts";
import { withSentry } from "../_shared/sentry.ts";

const PAYSAFE_WEBHOOK_SECRET = Deno.env.get("PAYSAFE_WEBHOOK_SECRET") || "";
const supabase = createServiceClient();

/* ───── Paysafe webhook signature verification ───── */
async function verifyPaysafeSignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!PAYSAFE_WEBHOOK_SECRET) {
    console.error("PAYSAFE_SIGNATURE_VERIFY: PAYSAFE_WEBHOOK_SECRET not set — rejecting request");
    return false;
  }
  if (!signatureHeader) return false;
  const key = new TextEncoder().encode(PAYSAFE_WEBHOOK_SECRET);
  const data = new TextEncoder().encode(rawBody);
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, data);
  const expectedHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  // Constant-time comparison
  const receivedHex = signatureHeader.toLowerCase();
  if (receivedHex.length !== expectedHex.length) return false;
  let mismatch = 0;
  for (let i = 0; i < receivedHex.length; i++) mismatch |= receivedHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return mismatch === 0;
}

async function findCombo(paymentId: string, merchantRefNum: string) {
  // merchantRefNum is the combo_bookings.id (uuid); guard the uuid filter so a
  // non-uuid ref can't 400 the whole query.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(merchantRefNum);
  const filter = isUuid
    ? "paysafe_payment_id.eq." + paymentId + ",id.eq." + merchantRefNum
    : "paysafe_payment_id.eq." + paymentId;
  const { data } = await supabase
    .from("combo_bookings")
    .select("*, combo_offers(*)")
    .or(filter)
    .maybeSingle();
  return data;
}

async function handlePaymentCompleted(paymentId: string, merchantRefNum: string) {
  // Idempotency check
  const idempotencyKey = "paysafe_payment:" + paymentId;
  const idempInsert = await supabase.from("idempotency_keys").insert({ key: idempotencyKey }).select("id").maybeSingle();
  if (idempInsert.error && idempInsert.error.code === "23505") {
    console.log("IDEMPOTENCY_SKIP: already processed key=" + idempotencyKey);
    return;
  }

  const combo = await findCombo(paymentId, merchantRefNum);
  if (!combo) {
    console.error("PAYSAFE_WEBHOOK: No combo_booking found for payment=" + paymentId + " merchantRef=" + merchantRefNum);
    return;
  }
  if (combo.payment_status === "PAID") {
    console.log("PAYSAFE_WEBHOOK: combo_booking already PAID: " + combo.id);
    return;
  }

  await supabase.from("combo_bookings").update({ paysafe_payment_id: paymentId }).eq("id", combo.id);

  // Atomic N-party confirmation + per-operator invoices/notifications.
  const confirm = await confirmComboAndNotify(supabase, combo.id, "PAYSAFE_" + paymentId, "PAYSAFE_COMBO");
  if (!confirm.ok) {
    console.error("COMBO_CONFIRM_ATOMIC_ERR:", confirm.error);
    const lg = await supabase.from("logs").insert({
      business_id: combo?.combo_offers?.business_a_id || null,
      event: "combo_payment_confirm_failed",
      payload: { combo_booking_id: combo.id, paysafe_payment_id: paymentId, error: confirm.error },
    });
    if (lg.error) console.error("LOG_ERR:", lg.error.message);
    return;
  }

  const lg = await supabase.from("logs").insert({
    business_id: combo?.combo_offers?.business_a_id || null,
    event: "combo_payment_completed",
    payload: { combo_booking_id: combo.id, paysafe_payment_id: paymentId, bookings_confirmed: confirm.bookingsConfirmed },
  });
  if (lg.error) console.error("LOG_ERR:", lg.error.message);
}

async function handlePaymentFailed(paymentId: string, merchantRefNum: string) {
  // Idempotency: a replayed PAYMENT_FAILED must not release capacity twice.
  // (releaseFailedCombo is also hold-guarded — belt and braces.)
  const idempotencyKey = "paysafe_payment_failed:" + (paymentId || merchantRefNum);
  const idempInsert = await supabase.from("idempotency_keys").insert({ key: idempotencyKey }).select("id").maybeSingle();
  if (idempInsert.error && idempInsert.error.code === "23505") {
    console.log("IDEMPOTENCY_SKIP: already processed key=" + idempotencyKey);
    return;
  }

  const combo = await findCombo(paymentId, merchantRefNum);
  if (!combo) {
    console.error("PAYSAFE_WEBHOOK_FAILED: No combo_booking found for payment=" + paymentId);
    return;
  }
  if (combo.payment_status === "PAID") {
    // A late FAILED after a successful payment must not tear anything down.
    console.log("PAYSAFE_WEBHOOK_FAILED: combo already PAID, ignoring: " + combo.id);
    return;
  }

  await releaseFailedCombo(supabase, combo);

  const lg = await supabase.from("logs").insert({
    business_id: combo.combo_offers?.business_a_id || null,
    event: "combo_payment_failed",
    payload: {
      combo_booking_id: combo.id,
      paysafe_payment_id: paymentId,
      booking_a_id: combo.booking_a_id,
      booking_b_id: combo.booking_b_id,
    },
  });
  if (lg.error) console.error("LOG_ERR:", lg.error.message);
}

Deno.serve(withSentry("paysafe-webhook", async (req: any) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  try {
    const rawBody = await req.text();

    // Verify Paysafe webhook signature
    const sigHeader = req.headers.get("x-paysafe-signature") || req.headers.get("signature");
    const sigValid = await verifyPaysafeSignature(rawBody, sigHeader);
    if (!sigValid) {
      console.error("PAYSAFE_WEBHOOK_SIGNATURE_INVALID: rejected request with bad or missing signature");
      return new Response("Unauthorized", { status: 401 });
    }

    const body = rawBody ? JSON.parse(rawBody) : {};
    console.log("PAYSAFE_WEBHOOK:" + JSON.stringify(body).substring(0, 500));

    const eventType = body.eventType || body.type || "";
    const paymentId = body.id || body.paymentId || body.data?.id || "";
    const merchantRefNum = body.merchantRefNum || body.data?.merchantRefNum || "";

    if (eventType === "PAYMENT_COMPLETED" || eventType === "payment.completed") {
      await handlePaymentCompleted(paymentId, merchantRefNum);
      return new Response("OK", { status: 200 });
    }

    if (eventType === "PAYMENT_FAILED" || eventType === "payment.failed") {
      await handlePaymentFailed(paymentId, merchantRefNum);
      return new Response("OK", { status: 200 });
    }

    console.log("PAYSAFE_WEBHOOK: Ignoring event type: " + eventType);
    return new Response("OK", { status: 200 });
  } catch (err: any) {
    console.error("PAYSAFE_WEBHOOK_ERROR:", err);
    // Always return 200 to webhooks to prevent retries on server errors
    return new Response("OK", { status: 200 });
  }
}));
