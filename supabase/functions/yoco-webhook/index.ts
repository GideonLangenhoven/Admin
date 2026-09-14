// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { bookingVoucherBalances } from "../_shared/voucher-balances.ts";
import { Webhook } from "npm:standardwebhooks";
import { createServiceClient, formatTenantDate, formatTenantDateTime, getBusinessDisplayName, getTenantByBusinessId, resolveManageBookingsUrl, sendWhatsappTextForTenant, sendWhatsappFreeformOrSignal } from "../_shared/tenant.ts";
import { getWaiverContext } from "../_shared/waiver.ts";
import { confirmComboAndNotify, releaseFailedCombo } from "../_shared/combo.ts";
import { withSentry } from "../_shared/sentry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createServiceClient();
function topupQuota(amount: number) {
  if (amount === 100) return 10;
  if (amount === 500) return 60;
  if (amount === 1000) return 140;
  return 0;
}

async function resolveWebhookBusinessId(checkoutId: string, payload: any) {
  const metadata = payload?.metadata || {};
  const metaType = String(metadata.type || "");
  const metaBookingId = String(metadata.booking_id || "");
  const metaVoucherId = String(metadata.voucher_id || "");
  const metaBusinessId = String(metadata.business_id || "");

  if (payload?.type === "refund" && checkoutId) {
    const refund = await supabase.from("refund_operations").select("source_business_id").eq("checkout_id", checkoutId).limit(1).maybeSingle();
    if (refund.error) throw new Error(refund.error.message);
    if (refund.data?.source_business_id) return String(refund.data.source_business_id);
  }

  if (metaType === "TOPUP" && metaBusinessId) return metaBusinessId;

  if (metaBookingId) {
    const bookingLookup = await supabase.from("bookings").select("business_id").eq("id", metaBookingId).maybeSingle();
    if (bookingLookup.data?.business_id) return String(bookingLookup.data.business_id);
  }

  if (metaVoucherId) {
    const voucherLookup = await supabase.from("vouchers").select("business_id").eq("id", metaVoucherId).maybeSingle();
    if (voucherLookup.data?.business_id) return String(voucherLookup.data.business_id);
  }

  // Settlement payment links: the checkout was created on the OWED business's
  // Yoco account (operator B), so their webhook secret must verify it.
  const metaSettlementId = String(metadata.settlement_id || "");
  if (metaSettlementId) {
    const settlementLookup = await supabase.from("combo_settlements").select("owed_business_id").eq("id", metaSettlementId).maybeSingle();
    if (settlementLookup.data?.owed_business_id) return String(settlementLookup.data.owed_business_id);
  }

  if (checkoutId) {
    const bookingByCheckout = await supabase.from("bookings").select("business_id").eq("yoco_checkout_id", checkoutId).maybeSingle();
    if (bookingByCheckout.data?.business_id) return String(bookingByCheckout.data.business_id);

    const voucherByCheckout = await supabase.from("vouchers").select("business_id").eq("yoco_checkout_id", checkoutId).maybeSingle();
    if (voucherByCheckout.data?.business_id) return String(voucherByCheckout.data.business_id);

    const settlementByCheckout = await supabase.from("combo_settlements").select("owed_business_id").eq("yoco_checkout_id", checkoutId).maybeSingle();
    if (settlementByCheckout.data?.owed_business_id) return String(settlementByCheckout.data.owed_business_id);
  }

  return "";
}

// Verify the Yoco webhook signature. Throws on any failure.
//
// Hardening (post-MVP audit): we used to "skip and warn" when businessId
// could not be resolved or the tenant had no webhook_secret. That left a
// path for an attacker to send a forged payment.succeeded event for any
// known checkoutId and have it processed, since the resolver still finds
// the booking row by checkoutId and proceeds to mark it PAID.
//
// New rule: any payment.succeeded webhook MUST verify against a configured
// per-tenant secret. Other event types (payment.failed, etc.) follow the
// same rule for parity. If verification cannot be performed, reject.
async function verifyWebhookSignature(
  req: Request,
  rawBody: string,
  businessId: string,
  eventType: string,
  paymentMode = "",
) {
  if (!businessId) {
    throw new Error(
      "YOCO_WEBHOOK_VERIFY: cannot resolve business for this webhook — rejecting (event=" + eventType + ")",
    );
  }

  let tenant: any;
  try {
    tenant = await getTenantByBusinessId(supabase, businessId);
  } catch (credErr) {
    throw new Error(
      "YOCO_WEBHOOK_VERIFY: failed to load credentials for business " +
        businessId +
        ": " +
        (credErr instanceof Error ? credErr.message : String(credErr)),
    );
  }

  if (paymentMode && paymentMode !== "live" && paymentMode !== "test") {
    throw new Error("YOCO_WEBHOOK_VERIFY: unsupported payment mode");
  }
  // Yoco signs the payment's original mode. Switching the storefront's mode
  // must not invalidate outstanding payments from the other environment.
  const webhookSecret = paymentMode === "test"
    ? tenant.credentials.yocoTestWebhookSecret
    : paymentMode === "live"
    ? tenant.credentials.yocoWebhookSecret
    : tenant.credentials.activeYocoWebhookSecret;
  if (!webhookSecret) {
    throw new Error(
      "YOCO_WEBHOOK_VERIFY: no webhook secret configured for business " +
        businessId +
        " — rejecting until secret is set in Settings → Integration Credentials",
    );
  }

  const webhook = new Webhook(webhookSecret);
  await webhook.verify(rawBody, {
    "webhook-id": req.headers.get("webhook-id") || "",
    "webhook-timestamp": req.headers.get("webhook-timestamp") || "",
    "webhook-signature": req.headers.get("webhook-signature") || "",
  });
}

// A signature authenticates one merchant, not arbitrary IDs in metadata. Bind
// every referenced object to that merchant and the checkout before any writes.
async function validateWebhookReferences(checkoutId: string, payload: any, businessId: string, eventType = "payment.succeeded") {
  const meta = payload.metadata || {};
  const type = String(meta.type || "BOOKING");
  const row = async (query: any) => {
    const result = await query.maybeSingle();
    if (result.error) throw new Error(result.error.message);
    return result.data;
  };
  const modeMatches = (record: any) => !record?.yoco_mode || record.yoco_mode === payload.mode;
  const amountMatches = (record: any, amount: number) => eventType !== "payment.succeeded" || (
    Number(payload.amount) === Number(record.expected_amount_cents ?? Math.round(amount * 100))
    && String(payload.currency || "") === String(record.expected_currency || "ZAR")
  );
  if (!checkoutId || !["BOOKING", "RESEND", "GIFT_VOUCHER", "RESCHEDULE", "ADD_GUESTS", "COMBO", "COMBO_SETTLEMENT"].includes(type)) return false;

  if (type === "COMBO_SETTLEMENT") {
    const settlement = await row(supabase.from("combo_settlements").select("*")
      .eq("yoco_checkout_id", checkoutId).eq("owed_business_id", businessId));
    if (!settlement || settlement.owed_business_id !== businessId || (meta.settlement_id && settlement.id !== meta.settlement_id)
      || (meta.business_id && meta.business_id !== businessId) || !amountMatches(settlement, Number(settlement.amount_owed))) return false;
    for (const comboId of settlement.combo_booking_ids || []) {
      const combo = await row(supabase.from("combo_bookings")
        .select("id, combo_offers(business_a_id, business_b_id, created_by_business_id), combo_booking_items(business_id, position)").eq("id", comboId));
      const offer = combo?.combo_offers;
      const items = combo?.combo_booking_items || [];
      const collector = offer?.business_a_id || offer?.created_by_business_id || items.find((item: any) => item.position === 1)?.business_id;
      if (collector !== settlement.collector_business_id) return false;
      if (items.length ? !items.some((item: any) => item.business_id === businessId) : offer?.business_b_id !== businessId) return false;
    }
    return true;
  }
  if (type === "GIFT_VOUCHER" || meta.voucher_id) {
    const voucher = await row(supabase.from("vouchers").select("*")
      .eq("yoco_checkout_id", checkoutId).eq("business_id", businessId));
    return !!voucher && voucher.business_id === businessId && (!meta.voucher_id || voucher.id === meta.voucher_id)
      && modeMatches(voucher) && amountMatches(voucher, Number(voucher.value ?? voucher.purchase_amount));
  }

  const bookingQuery = supabase.from("bookings").select("*").eq("business_id", businessId);
  const booking = await row(meta.booking_id ? bookingQuery.eq("id", meta.booking_id) : bookingQuery.eq("yoco_checkout_id", checkoutId));
  if (!booking || booking.business_id !== businessId) return false;
  if (type === "RESCHEDULE") {
    if (!meta.pending_reschedule_id) return false;
    const pending = await row(supabase.from("pending_reschedules").select("*")
      .eq("id", meta.pending_reschedule_id).eq("booking_id", booking.id).eq("business_id", businessId));
    return !!pending && pending.booking_id === booking.id && pending.business_id === businessId
      && pending.yoco_checkout_id === checkoutId && modeMatches(pending);
  }
  if (type === "ADD_GUESTS") {
    if (!meta.hold_id || !Number.isSafeInteger(Number(meta.new_qty))) return false;
    const hold = await row(supabase.from("holds").select("*").eq("id", meta.hold_id).eq("booking_id", booking.id));
    return !!hold && hold.booking_id === booking.id && hold.slot_id === booking.slot_id
      && hold.metadata?.yoco_checkout_id === checkoutId
      && (!hold.metadata?.yoco_mode || hold.metadata.yoco_mode === payload.mode);
  }
  if (type === "COMBO") {
    const combo = await row(supabase.from("combo_bookings").select("*").eq("yoco_checkout_id", checkoutId));
    return !!combo && (!meta.combo_booking_id || combo.id === meta.combo_booking_id)
      && booking.yoco_checkout_id === checkoutId && (!meta.business_id || meta.business_id === businessId)
      && amountMatches(combo, Number(combo.combo_total));
  }
  return booking.yoco_checkout_id === checkoutId && modeMatches(booking);
}

async function createInvoice(booking: any, tourName: string, slotTime: string, paymentRef: string) {
  const existing = await supabase.from("invoices").select("*").eq("booking_id", booking.id).order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (existing.data) {
    if (existing.data.payment_reference !== paymentRef) {
      await supabase.from("invoices").update({ payment_method: "Yoco", payment_reference: paymentRef }).eq("id", existing.data.id);
      existing.data.payment_method = "Yoco";
      existing.data.payment_reference = paymentRef;
    }
    return existing.data;
  }

  let invNumR: { data: any; error: { message: string } | null };
  try {
    invNumR = await supabase.rpc("next_invoice_number", { p_business_id: booking.business_id });
  } catch (_e) {
    invNumR = { data: null, error: { message: "RPC not found" } };
  }
  if (invNumR.error) {
    console.warn("next_invoice_number RPC failed (using fallback):", invNumR.error.message);
  }
  const invNum = invNumR.data || ("INV-" + Date.now());
  const subtotal = Number(booking.original_total || booking.total_amount);
  let discountAmt = subtotal - Number(booking.total_amount);
  if (discountAmt < 0) discountAmt = 0;

  const inv = await supabase.from("invoices").insert({
    business_id: booking.business_id, booking_id: booking.id,
    invoice_number: invNum,
    customer_name: booking.customer_name, customer_email: booking.email, customer_phone: booking.phone,
    customer_company_name: booking.customer_company_name || null, customer_vat_number: booking.customer_vat_number || null,
    tour_name: tourName, tour_date: booking.slots?.start_time || null,
    qty: booking.qty, unit_price: booking.unit_price,
    subtotal: subtotal,
    discount_type: booking.discount_type || null,
    discount_percent: booking.discount_percent || 0,
    discount_amount: discountAmt,
    total_amount: booking.total_amount,
    payment_method: "Yoco", payment_reference: paymentRef,
  }).select().single();

  if (inv.data) {
    await supabase.from("bookings").update({ invoice_id: inv.data.id }).eq("id", booking.id);
  }
  return { ...inv.data, invoice_number: invNum };
}

async function sendBookingConfirmation(booking: any, yocoPaymentId: string, checkoutId: string, amount: number) {
  // Idempotency: check logs table first (always exists)
  const existingLog = await supabase
    .from("logs")
    .select("id")
    .eq("booking_id", booking.id)
    .eq("event", "booking_confirmation_notifications_sent")
    .limit(1)
    .maybeSingle();
  if (existingLog.data?.id) {
    console.log("CONFIRM_ALREADY_SENT (log exists) booking:" + booking.id);
    return;
  }

  // Try atomic lock via confirmation_sent_at column (if migration was run).
  // If column doesn't exist or update fails, proceed anyway — logs check above is the primary guard.
  try {
    const claimLock = await supabase
      .from("bookings")
      .update({ confirmation_sent_at: new Date().toISOString() })
      .eq("id", booking.id)
      .is("confirmation_sent_at", null)
      .select("id")
      .maybeSingle();
    if (claimLock.data === null && !claimLock.error) {
      // Column exists and lock was already claimed by another webhook
      console.log("CONFIRM_ALREADY_SENT (lock claimed by another webhook) booking:" + booking.id);
      return;
    }
    if (claimLock.error) {
      console.warn("CONFIRM_LOCK_WARN (proceeding anyway):", claimLock.error.message);
    }
  } catch (lockErr) {
    console.warn("CONFIRM_LOCK_ERR (proceeding anyway):", lockErr);
  }

  // Upsert customer profile (best-effort — never fail the confirmation)
  if (booking.email) {
    try {
      const { data: customerId } = await supabase.rpc("upsert_customer", {
        p_business_id: booking.business_id,
        p_email: booking.email,
        p_name: booking.customer_name || null,
        p_phone: booking.phone || null,
        p_marketing_consent: booking.marketing_opt_in || false,
      });
      if (customerId) {
        await supabase.from("bookings").update({ customer_id: customerId }).eq("id", booking.id);
        await supabase.rpc("recompute_customer_stats", { p_customer_id: customerId });
      }
    } catch (custErr) {
      console.error("CUSTOMER_UPSERT_ERR:", custErr);
    }
  }

  let tenant: any = null;
  try {
    tenant = await getTenantByBusinessId(supabase, booking.business_id);
  } catch (tenantErr) {
    console.error("CONFIRM_TENANT_ERR (will still attempt email via send-email):", tenantErr);
  }
  const ref = booking.id.substring(0, 8).toUpperCase();
  const slotTime = booking.slots?.start_time
    ? (tenant ? formatTenantDateTime(tenant.business, booking.slots.start_time) : new Date(booking.slots.start_time).toLocaleString())
    : "See email";
  const tourName = booking.tours?.name || "Booking";
  const brandName = tenant ? getBusinessDisplayName(tenant.business) : "Your Booking";
  let waiver: any = { waiverStatus: "PENDING", waiverLink: "" };
  try {
    waiver = await getWaiverContext(supabase, { bookingId: booking.id, businessId: booking.business_id });
  } catch (waiverErr) {
    console.error("CONFIRM_WAIVER_ERR (proceeding without waiver info):", waiverErr);
  }

  // Last-minute booking: if trip is within 24 hours, always include waiver link prominently
  let isLastMinute = false;
  if (booking.slots?.start_time) {
    const hoursUntilTrip = (new Date(booking.slots.start_time).getTime() - Date.now()) / (1000 * 60 * 60);
    isLastMinute = hoursUntilTrip < 24 && hoursUntilTrip > 0;
  }

  let invoice: any = null;
  try {
    invoice = await createInvoice(booking, tourName, slotTime, yocoPaymentId);
  } catch (invErr) {
    console.error("INVOICE_CREATE_ERR (continuing to send notifications):", invErr);
  }

  let waSent = false;
  let emailSent = false;
  let waError = "";
  let emailError = "";

  // Email is the canonical confirmation. WhatsApp fires only for bookings with
  // no email on file, so a customer never gets the email + WhatsApp double.
  if (!booking.email && booking.phone && tenant) {
    try {
      const currency = tenant.business.currency || "ZAR";
      // Still window-gated: outside the 24h window a phone-only booking gets no
      // WA (sendWhatsappFreeformOrSignal reports windowClosed, no template fallback).
      const waRes = await sendWhatsappFreeformOrSignal(
        tenant,
        booking.phone,
        "Booking confirmed\n\n" +
        "Ref: " + ref + "\n" +
        tourName + "\n" +
        slotTime + "\n" +
        booking.qty + " guest" + (booking.qty === 1 ? "" : "s") + "\n" +
        currency + " " + booking.total_amount + " paid\n" +
        "Invoice: " + (invoice?.invoice_number || "pending") + "\n\n" +
        (waiver.waiverStatus !== "SIGNED" && waiver.waiverLink
          ? (isLastMinute ? "IMPORTANT - Please sign your waiver before the trip:\n" : "Waiver: ") + waiver.waiverLink + "\n\n"
          : "") +
        "Thanks for booking with " + brandName + ".",
      );
      waSent = waRes.ok;
    } catch (e) {
      waError = e instanceof Error ? e.message : String(e);
      console.error("WA confirm err:", e);
    }
  }

  if (booking.email) {
    try {
      const emailRes = await fetch(SUPABASE_URL + "/functions/v1/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
        body: JSON.stringify({
          type: "BOOKING_CONFIRM",
          data: {
            email: booking.email,
            booking_id: booking.id,
            business_id: booking.business_id,
            waiver_status: waiver.waiverStatus,
            waiver_url: waiver.waiverLink,
            is_last_minute: isLastMinute,
            customer_name: booking.customer_name,
            customer_email: booking.email,
            customer_company_name: booking.customer_company_name || "",
            customer_vat_number: booking.customer_vat_number || "",
            ref: ref,
            payment_reference: invoice?.payment_reference || yocoPaymentId,
            tour_name: tourName,
            tour_date: slotTime,
            start_time: slotTime,
            qty: booking.qty,
            total_amount: booking.total_amount,
            invoice_number: invoice?.invoice_number || "",
            invoice_date: tenant ? formatTenantDate(tenant.business, invoice?.created_at || slotTime || new Date().toISOString()) : "",
          }
        }),
      });
      const emailData = await emailRes.json().catch(() => ({}));
      if (!emailRes.ok || emailData?.error) {
        emailError = String(emailData?.error || emailRes.statusText || "Email send failed");
        console.error("CONFIRM_EMAIL_ERR:", emailError);
      } else {
        emailSent = true;
      }
    } catch (e) {
      emailError = e instanceof Error ? e.message : String(e);
      console.error("confirm email err", e);
    }
  }

  await supabase.from("logs").insert({
    business_id: booking.business_id,
    booking_id: booking.id,
    event: "booking_confirmation_notifications_sent",
    payload: {
      yoco_payment_id: yocoPaymentId,
      checkout_id: checkoutId,
      amount,
      wa_sent: waSent,
      email_sent: emailSent,
      wa_error: waError || null,
      email_error: emailError || null,
    },
  });
}

// Payment is real even when the requested seats are no longer available.
async function refundUnfulfilledPayment(bookingId: string, paymentId: string, checkoutId: string, cents: number, holdId: string | null = null) {
  const recorded = await supabase.rpc("record_unfulfilled_payment", {
    p_booking_id: bookingId, p_payment_id: paymentId, p_checkout_id: checkoutId, p_amount_cents: cents, p_hold_id: holdId,
  });
  if (recorded.error || !recorded.data?.ok) throw new Error("Could not record unfulfilled payment");
  const response = await fetch(SUPABASE_URL + "/functions/v1/process-refund", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
    body: JSON.stringify({ booking_id: bookingId, amount: cents / 100, keep_booking: Boolean(holdId) }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "Automatic refund needs retry");
}

Deno.serve(withSentry("yoco-webhook", async (req: any) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });
  let idempotencyKey = "";
  let leaseClaimed = false;
  const finishLease = async (ok: boolean, error?: string) => {
    if (!leaseClaimed) return;
    const result = await supabase.rpc("finish_yoco_payment", { p_key: idempotencyKey, p_ok: ok, p_error: error || null });
    if (result.error) throw new Error(result.error.message);
    leaseClaimed = false;
  };
  const processPayment = async () => {
  try {
    const rawBody = await req.text();
    const body = rawBody ? JSON.parse(rawBody) : {};
    console.log("YOCO_WEBHOOK:" + JSON.stringify(body).substring(0, 500));
    const type = body.type; const payload = body.payload;
    if (!["payment.succeeded", "payment.failed", "refund.succeeded", "refund.failed"].includes(type)) { console.log("Ignoring:" + type); return new Response("OK", { status: 200 }); }
    const checkoutId = payload.metadata?.checkoutId || payload.checkoutId || payload.checkout_id || "";
    const yocoPaymentId = payload.id || "";
    const metaBookingId = payload.metadata?.booking_id || "";
    const metaType = String(payload.metadata?.type || "");
    if (!checkoutId && !metaBookingId) { console.log("No checkoutId or booking_id in payload"); return new Response("OK", { status: 200 }); }
    const businessId = await resolveWebhookBusinessId(checkoutId, payload);
    try {
      await verifyWebhookSignature(req, rawBody, businessId, type, String(payload.mode || ""));
    } catch (verifyError) {
      // Console-only: CLAUDE.md requires zero DB writes on an invalid/missing
      // signature. A DB log insert here (even audit-only) violated that on
      // this path; console.error is still fully visible in function logs.
      console.error("YOCO_WEBHOOK_VERIFY_ERROR:", verifyError, {
        event_type: type,
        checkout_id: checkoutId || null,
        booking_id: metaBookingId || null,
        yoco_payment_id: yocoPaymentId || null,
      });
      return new Response("Unauthorized", { status: 401 });
    }

    if (type === "refund.succeeded" || type === "refund.failed") {
      const cents = Number(payload.amount);
      if (!Number.isSafeInteger(cents) || cents <= 0 || payload.currency !== "ZAR") return new Response("Invalid refund amount", { status: 400 });
      const eventKey = "yoco_refund:" + businessId + ":" + String(body.id || payload.id || "");
      const claim = await supabase.rpc("claim_yoco_payment", { p_key: eventKey });
      if (claim.error) throw new Error(claim.error.message);
      if (claim.data === "duplicate") return new Response("OK", { status: 200 });
      if (claim.data !== "claimed") return new Response("Refund processing", { status: 503 });
      let query = supabase.from("refund_operations").select("*").eq("checkout_id", checkoutId)
        .eq("source_business_id", businessId).eq("amount", cents / 100);
      if (payload.metadata?.refund_operation_id) query = query.eq("id", payload.metadata.refund_operation_id);
      else query = query.order("created_at", { ascending: false }).limit(1);
      const found = await query.maybeSingle();
      if (found.error || !found.data || (found.data.mode && found.data.mode !== payload.mode)) {
        await supabase.rpc("finish_yoco_payment", { p_key: eventKey, p_ok: false, p_error: "Refund reference missing or ambiguous" });
        return new Response("Refund reference missing or ambiguous", { status: 503 });
      }
      const finished = await supabase.rpc("finish_refund_operation", {
        p_operation_id: found.data.id, p_status: type === "refund.succeeded" ? "SUCCEEDED" : "FAILED",
        p_provider_id: found.data.provider_id || payload.id, p_error: payload.failureReason || null,
      });
      if (finished.error || !finished.data?.ok) {
        await supabase.rpc("finish_yoco_payment", { p_key: eventKey, p_ok: false, p_error: "Could not record refund result" });
        return new Response("Refund processing error", { status: 503 });
      }
      // The refund handler also completes voucher reissue and notification.
      const resumed = await fetch(SUPABASE_URL + "/functions/v1/process-refund", {
        method: "POST", headers: { Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ booking_id: found.data.booking_id, resume_refund: true }),
      });
      const followupOk = resumed.ok || type === "refund.failed";
      await supabase.rpc("finish_yoco_payment", { p_key: eventKey, p_ok: followupOk, p_error: followupOk ? null : "Refund follow-up needs retry" });
      return new Response(followupOk ? "OK" : "Refund follow-up needs retry", { status: followupOk ? 200 : 503 });
    }

    if (!await validateWebhookReferences(checkoutId, payload, businessId, type)) {
      console.error("YOCO_WEBHOOK_REFERENCE_MISMATCH", { checkout_id: checkoutId, business_id: businessId, type: metaType });
      return new Response("Invalid payment reference", { status: 400 });
    }

    // Gateway amounts are integer cents. Validate before claiming the event so
    // malformed data cannot poison retries or become a guessed cash capture.
    const capturedCents = Number(payload.amount);
    if (type === "payment.succeeded" && (!Number.isSafeInteger(capturedCents) || capturedCents <= 0)) {
      return new Response("Invalid payment amount", { status: 400 });
    }

    // ── R11: PROCESSING LEASE ──
    // claim_yoco_payment returns 'duplicate' only for completed work.
    // 'failed' or stale 'processing' rows are re-claimed so a crashed
    // booking update retries instead of ACK-and-drop. Notifications stay
    // outside the lease: only financial completion is gated here.
    if (type === "payment.succeeded" && (yocoPaymentId || checkoutId)) {
      idempotencyKey = "yoco_payment:" + businessId + ":" + String(payload.mode || "legacy") + ":" + (yocoPaymentId || checkoutId);
      const claim = await supabase.rpc("claim_yoco_payment", { p_key: idempotencyKey });
      const state = String(claim.data || "claimed");
      if (state === "duplicate") {
        console.log("IDEMPOTENCY_SKIP: already processed key=" + idempotencyKey);
        return new Response("OK", { status: 200 });
      }
      if (state === "in_progress") {
        return new Response("Payment processing; retry later", { status: 503 });
      }
      if (claim.error) {
        console.error("IDEMPOTENCY_CLAIM_ERR key=" + idempotencyKey + ": " + claim.error.message);
        return new Response("Temporary processing error", { status: 503 });
      }
      leaseClaimed = true;
    }

    // ── COMBO SETTLEMENT payment link (operator A pays operator B's share) ──
    // The checkout was created on B's Yoco account by combo-settlement-link.
    // On success: settlement row → PAID and the underlying combo bookings are
    // marked settled. Signature was verified against B's webhook secret above.
    if (metaType === "COMBO_SETTLEMENT") {
      const settlementId = String(payload.metadata?.settlement_id || "");
      let settlement: any = null;
      if (settlementId) {
        const r = await supabase.from("combo_settlements").select("*").eq("id", settlementId).eq("owed_business_id", businessId).maybeSingle();
        if (r.error) throw new Error(r.error.message);
        settlement = r.data;
      }
      if (!settlement && checkoutId) {
        const r = await supabase.from("combo_settlements").select("*").eq("yoco_checkout_id", checkoutId).eq("owed_business_id", businessId).maybeSingle();
        if (r.error) throw new Error(r.error.message);
        settlement = r.data;
      }
      if (!settlement) {
        console.error("YOCO_SETTLEMENT: no combo_settlements row for settlement_id=" + settlementId + " checkout=" + checkoutId);
        return new Response("OK", { status: 200 });
      }

      if (type === "payment.succeeded") {
        if (settlement.status === "PAID") return new Response("OK", { status: 200 });
        const nowIso = new Date().toISOString();
        // Settle per pair: only the owed operator's legs are marked settled;
        // the combo-wide flag flips once no non-collector leg remains open.
        // Legacy combos without items rows settle whole (2-party, one pair).
        const comboIds: string[] = Array.isArray(settlement.combo_booking_ids) ? settlement.combo_booking_ids : [];
        for (const cid of comboIds) {
          const { data: legItems, error: itemsError } = await supabase.from("combo_booking_items")
            .select("id, business_id, settled_at").eq("combo_booking_id", cid);
          if (itemsError) throw new Error(itemsError.message);
          if (!legItems || legItems.length === 0) {
            const legacyUpdate = await supabase.from("combo_bookings").update({
              settled: true, settled_at: nowIso, settlement_notes: "Paid via Yoco settlement link",
            }).eq("id", cid).eq("settled", false);
            if (legacyUpdate.error) throw new Error(legacyUpdate.error.message);
            continue;
          }
          const itemsUpdate = await supabase.from("combo_booking_items").update({ settled_at: nowIso })
            .eq("combo_booking_id", cid).eq("business_id", settlement.owed_business_id).is("settled_at", null);
          if (itemsUpdate.error) throw new Error(itemsUpdate.error.message);
          const stillOpen = legItems.some((it: any) =>
            it.business_id !== settlement.collector_business_id &&
            it.business_id !== settlement.owed_business_id && !it.settled_at);
          if (!stillOpen) {
            const comboUpdate = await supabase.from("combo_bookings").update({
              settled: true, settled_at: nowIso, settlement_notes: "Paid via Yoco settlement link",
            }).eq("id", cid).eq("settled", false);
            if (comboUpdate.error) throw new Error(comboUpdate.error.message);
          }
        }

        // Mark the settlement complete LAST. Each preceding update is
        // idempotent, so a partial database failure can be retried safely.
        const settlementUpdate = await supabase.from("combo_settlements").update({
          status: "PAID", paid_at: nowIso, settled_at: nowIso,
          notes: ((settlement.notes ? settlement.notes + " · " : "") + "Paid via Yoco " + (yocoPaymentId || checkoutId)),
        }).eq("id", settlement.id).eq("owed_business_id", businessId);
        if (settlementUpdate.error) throw new Error(settlementUpdate.error.message);

        await supabase.from("logs").insert({
          business_id: settlement.owed_business_id,
          event: "combo_settlement_paid",
          payload: {
            settlement_id: settlement.id,
            collector_business_id: settlement.collector_business_id,
            amount_owed: Number(settlement.amount_owed || 0),
            combo_booking_count: comboIds.length,
            yoco_payment_id: yocoPaymentId || null,
          },
        });
        console.log("YOCO_SETTLEMENT PAID settlement=" + settlement.id + " amount=" + settlement.amount_owed);
        return new Response("OK", { status: 200 });
      }

      // payment.failed — leave the link live (retryable), just record it.
      await supabase.from("logs").insert({
        business_id: settlement.owed_business_id,
        event: "combo_settlement_payment_failed",
        payload: { settlement_id: settlement.id, yoco_payment_id: yocoPaymentId || null },
      });
      return new Response("OK", { status: 200 });
    }

    // ── COMBO (manual-settlement model) ──
    // Operator A collected the FULL combo amount via their own Yoco account.
    // Confirm every leg atomically; operators settle shares between themselves
    // (combo_bookings.settled + combo_settlements register).
    if (metaType === "COMBO") {
      const comboId = String(payload.metadata?.combo_booking_id || "");
      let combo: any = null;
      if (comboId) {
        const r = await supabase.from("combo_bookings").select("*, combo_offers(business_a_id)").eq("id", comboId).maybeSingle();
        if (r.error) throw new Error(r.error.message);
        combo = r.data;
      }
      if (!combo && checkoutId) {
        const r = await supabase.from("combo_bookings").select("*, combo_offers(business_a_id)").eq("yoco_checkout_id", checkoutId).maybeSingle();
        if (r.error) throw new Error(r.error.message);
        combo = r.data;
      }
      if (!combo) {
        console.error("YOCO_COMBO: no combo_booking found for combo_id=" + comboId + " checkout=" + checkoutId);
        return new Response("OK", { status: 200 });
      }

      if (type === "payment.succeeded") {
        if (combo.payment_status === "PAID") return new Response("OK", { status: 200 });
        const paymentUpdate = await supabase.from("combo_bookings").update({ yoco_payment_id: yocoPaymentId }).eq("id", combo.id);
        if (paymentUpdate.error) throw new Error(paymentUpdate.error.message);
        const confirm = await confirmComboAndNotify(supabase, combo.id, yocoPaymentId || checkoutId, "YOCO_COMBO");
        const lg = await supabase.from("logs").insert({
          business_id: combo.combo_offers?.business_a_id || businessId || null,
          event: confirm.ok ? "combo_payment_completed" : "combo_payment_confirm_failed",
          payload: { combo_booking_id: combo.id, yoco_payment_id: yocoPaymentId, provider: "yoco", bookings_confirmed: confirm.bookingsConfirmed, error: confirm.error || null },
        });
        if (lg.error) console.error("LOG_ERR:", lg.error.message);
        return new Response(confirm.ok ? "OK" : "Temporary processing error", { status: confirm.ok ? 200 : 503 });
      }

      // payment.failed — release both legs (hold-guarded, replay-safe)
      if (combo.payment_status !== "PAID") {
        await releaseFailedCombo(supabase, combo);
        const lg = await supabase.from("logs").insert({
          business_id: combo.combo_offers?.business_a_id || businessId || null,
          event: "combo_payment_failed",
          payload: { combo_booking_id: combo.id, yoco_payment_id: yocoPaymentId, provider: "yoco" },
        });
        if (lg.error) console.error("LOG_ERR:", lg.error.message);
      }
      return new Response("OK", { status: 200 });
    }

    if (type === "payment.failed") {
      // A failed attempt may be retried on the same checkout. Preserve its
      // reservation until expiry; duplicate failure events must not release
      // capacity owned by another hold or invalidate a later success.
      if (metaType === "RESCHEDULE" || metaType === "ADD_GUESTS") {
        const failureLog = await supabase.from("logs").insert({
          business_id: businessId,
          booking_id: metaBookingId,
          event: metaType === "RESCHEDULE" ? "reschedule_upgrade_payment_failed" : "add_guests_payment_failed",
          payload: {
            pending_reschedule_id: payload.metadata?.pending_reschedule_id || null,
            hold_id: payload.metadata?.hold_id || null,
            checkout_id: checkoutId,
            yoco_payment_id: yocoPaymentId,
          },
        });
        if (failureLog.error) throw new Error(failureLog.error.message);
        return new Response("OK", { status: 200 });
      }

      const fbCols = "id, status, email, payment_url, customer_name, qty, total_amount, business_id, slots(start_time), tours(name)";
      let fb = checkoutId
        ? await supabase.from("bookings").select(fbCols).eq("yoco_checkout_id", checkoutId).maybeSingle()
        : { data: null } as any;
      if (!fb.data && metaBookingId) {
        fb = await supabase.from("bookings").select(fbCols).eq("id", metaBookingId).maybeSingle();
      }
      const fbk = fb.data as any;
      if (fbk && (fbk.status === "HELD" || fbk.status === "PENDING" || fbk.status === "CONFIRMED")) {
        await supabase.from("bookings").update({ status: "PENDING PAYMENT" }).eq("id", fbk.id);
        console.log("PAYMENT FAILED - Marking as PENDING PAYMENT for booking:" + fbk.id);
      }

      // Email the payment link on the 3rd distinct failed attempt (the timeout
      // path in cron-tasks covers the abandon case). Dedup each attempt via
      // idempotency_keys — payment.failed is NOT deduped above like succeeded —
      // then count booking_payment_failed logs. ponytail: log-count as the
      // counter avoids a schema change; distinct Yoco payment IDs make it exact.
      const paidStatuses = ["PAID", "CONFIRMED", "COMPLETED", "CANCELLED"];
      if (fbk && (yocoPaymentId || checkoutId) && fbk.email && fbk.payment_url && !paidStatuses.includes(fbk.status)) {
        const failKey = "yoco_failed:" + businessId + ":" + String(payload.mode || "legacy") + ":" + (yocoPaymentId || checkoutId);
        const dedup = await supabase.from("idempotency_keys").insert({ key: failKey }).select("id").maybeSingle();
        if (!(dedup.error && dedup.error.code === "23505")) {
          await supabase.from("logs").insert({ business_id: fbk.business_id, booking_id: fbk.id, event: "booking_payment_failed", payload: { checkout_id: checkoutId, payment_id: yocoPaymentId } });
          const failCount = await supabase.from("logs").select("id", { count: "exact", head: true }).eq("booking_id", fbk.id).eq("event", "booking_payment_failed");
          if ((failCount.count || 0) === 3) {
            try {
              const tenant = await getTenantByBusinessId(supabase, fbk.business_id);
              const slot = Array.isArray(fbk.slots) ? fbk.slots[0] : fbk.slots;
              const tour = Array.isArray(fbk.tours) ? fbk.tours[0] : fbk.tours;
              await fetch(SUPABASE_URL + "/functions/v1/send-email", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
                body: JSON.stringify({
                  type: "PAYMENT_LINK",
                  data: {
                    business_id: fbk.business_id,
                    email: fbk.email,
                    booking_id: fbk.id,
                    customer_name: fbk.customer_name || "there",
                    ref: String(fbk.id || "").slice(0, 8).toUpperCase(),
                    tour_name: tour?.name || "your tour",
                    tour_date: slot?.start_time ? formatTenantDateTime(tenant.business, slot.start_time) : "",
                    qty: Number(fbk.qty || 1),
                    total_amount: Number(fbk.total_amount || 0).toFixed(2),
                    payment_url: fbk.payment_url,
                  },
                }),
              });
              console.log("PAYMENT_FAILED_3X_PAYLINK_SENT booking=" + fbk.id);
            } catch (e) {
              console.error("PAYMENT_FAILED_3X_EMAIL_ERR booking=" + fbk.id, e);
            }
          }
        }
      }
      return new Response("OK", { status: 200 });
    }

    if (metaType === "TOPUP") {
      const topupBusinessId = String(payload.metadata?.business_id || "");
      const amountZar = Number(payload.metadata?.amount_zar || Math.round((Number(payload.amount) || 0) / 100));
      const extraQuota = topupQuota(amountZar);
      const periodStart = new Date();
      periodStart.setDate(1);
      periodStart.setHours(0, 0, 0, 0);
      if (topupBusinessId && amountZar > 0 && extraQuota > 0) {
        const existingByPayment = yocoPaymentId
          ? await supabase.from("topup_orders").select("id").eq("yoco_payment_id", yocoPaymentId).limit(1).maybeSingle()
          : { data: null as any };
        if (existingByPayment.data?.id) return new Response("OK", { status: 200 });

        const existingByCheckout = checkoutId
          ? await supabase.from("topup_orders").select("id").eq("yoco_checkout_id", checkoutId).limit(1).maybeSingle()
          : { data: null as any };
        if (existingByCheckout.data?.id) return new Response("OK", { status: 200 });

        await supabase.from("topup_orders").insert({
          business_id: topupBusinessId,
          period_key: periodStart.toISOString().slice(0, 10),
          amount_zar: amountZar,
          extra_quota: extraQuota,
          status: "PAID",
          source: "YOCO",
          paid_at: new Date().toISOString(),
          yoco_payment_id: yocoPaymentId,
          yoco_checkout_id: checkoutId,
          metadata: { yoco_payment_id: yocoPaymentId, checkout_id: checkoutId },
        });
        await supabase.from("logs").insert({
          business_id: topupBusinessId,
          event: "topup_payment_confirmed",
          payload: { amount_zar: amountZar, extra_quota: extraQuota, yoco_payment_id: yocoPaymentId, checkout_id: checkoutId },
        });
      }
      return new Response("OK", { status: 200 });
    }

    // ── RESCHEDULE UPGRADE PAYMENT ──
    if (metaType === "RESCHEDULE") {
      const pendingRescheduleId = String(payload.metadata?.pending_reschedule_id || "");
      if (!pendingRescheduleId) {
        console.log("RESCHEDULE webhook but no pending_reschedule_id in metadata");
        return new Response("OK", { status: 200 });
      }

      const prRes = await supabase
        .from("pending_reschedules")
        .select("*")
        .eq("id", pendingRescheduleId)
        .eq("business_id", businessId)
        .maybeSingle();

      if (prRes.error) throw new Error(prRes.error.message);

      if (!prRes.data) {
        console.log("RESCHEDULE: pending_reschedule not found or already processed: " + pendingRescheduleId);
        return new Response("OK", { status: 200 });
      }

      const pr = prRes.data;
      const prBooking = await supabase
        .from("bookings")
        .select("*, slots(start_time), tours(name)")
        .eq("id", pr.booking_id)
        .eq("business_id", businessId)
        .single();

      if (prBooking.error) throw new Error(prBooking.error.message);

      if (!prBooking.data) {
        console.log("RESCHEDULE: booking not found for pending reschedule: " + pr.booking_id);
        return new Response("OK", { status: 200 });
      }

      const rBooking = prBooking.data;

      const confirmed = await supabase.rpc("confirm_booking_uplift", {
        p_booking_id: pr.booking_id, p_payment_id: yocoPaymentId, p_checkout_id: checkoutId,
        p_captured_cents: capturedCents, p_currency: String(payload.currency || "ZAR"),
        p_hold_id: pr.hold_id, p_pending_reschedule_id: pr.id, p_new_qty: null,
      });
      if (confirmed.error || !confirmed.data?.ok) {
        if (!confirmed.error && ["no_capacity", "slot_closed", "bad_status", "amendment_changed"].includes(confirmed.data?.error)) {
          await refundUnfulfilledPayment(pr.booking_id, yocoPaymentId, checkoutId, capturedCents, pr.hold_id);
          await finishLease(true);
          return new Response("Change unavailable; refund recorded", { status: 200 });
        }
        await finishLease(false, confirmed.error?.message || confirmed.data?.error || "reschedule_confirmation_failed");
        return new Response("Temporary processing error", { status: 503 });
      }
      await finishLease(true);

      // 6. Log the completed reschedule
      await supabase.from("logs").insert({
        business_id: pr.business_id,
        booking_id: pr.booking_id,
        event: "reschedule_upgrade_completed",
        payload: {
          pending_reschedule_id: pr.id,
          old_slot_id: pr.old_slot_id,
          new_slot_id: pr.new_slot_id,
          diff: pr.diff,
          yoco_payment_id: yocoPaymentId,
          checkout_id: checkoutId,
        },
      });

      // 7. Send reschedule confirmation notification
      try {
        const rTenant = await getTenantByBusinessId(supabase, pr.business_id);
        const rRef = pr.booking_id.substring(0, 8).toUpperCase();
        // Re-fetch booking with new slot info for notification
        const updatedBooking = await supabase
          .from("bookings")
          .select("*, slots(start_time), tours(name)")
          .eq("id", pr.booking_id)
          .single();
        const rBk = updatedBooking.data || rBooking;
        const rTourName = rBk.tours?.name || "Booking";
        const rSlotTime = rBk.slots?.start_time ? formatTenantDateTime(rTenant.business, rBk.slots.start_time) : "";
        const rBrandName = getBusinessDisplayName(rTenant.business);

        if (!rBk.email && rBk.phone) {
          try {
            await sendWhatsappTextForTenant(rTenant, rBk.phone,
              "Booking rescheduled\n\n" +
              "Hi " + ((rBk.customer_name && rBk.customer_name.split(" ")[0]) || "there") +
              ", your booking has been moved to a new date/time.\n\n" +
              "Ref: " + rRef + "\n" +
              rTourName + (rSlotTime ? "\n" + rSlotTime : "") + "\n\n" +
              "Thanks, " + rBrandName + "."
            );
          } catch (e) { console.error("RESCHEDULE_CONFIRM_WA_ERR:", e); }
        }

        if (rBk.email) {
          try {
            await fetch(SUPABASE_URL + "/functions/v1/send-email", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
              body: JSON.stringify({
                type: "BOOKING_UPDATED",
                data: {
                  business_id: pr.business_id,
                  email: rBk.email,
                  customer_name: rBk.customer_name,
                  ref: rRef,
                  tour_name: rTourName,
                  start_time: rSlotTime || rBk.slots?.start_time || "",
                  message: "Your booking has been moved to a new date/time.",
                  event: "rescheduled",
                },
              }),
            });
          } catch (e) { console.error("RESCHEDULE_CONFIRM_EMAIL_ERR:", e); }
        }
      } catch (notifyErr) {
        console.error("RESCHEDULE_NOTIFY_ERR:", notifyErr);
      }

      console.log("RESCHEDULE UPGRADE COMPLETED booking:" + pr.booking_id + " pending_reschedule:" + pr.id);
      return new Response("OK", { status: 200 });
    }

    // ── ADD_GUESTS PAYMENT ──
    if (metaType === "ADD_GUESTS") {
      const agHoldId = String(payload.metadata?.hold_id || "");
      const agNewQty = Number(payload.metadata?.new_qty || 0);
      const agBookingId = String(payload.metadata?.booking_id || "");

      if (agBookingId && agNewQty > 0) {
        const agBooking = await supabase
          .from("bookings")
          .select("*, slots(start_time), tours(name)")
          .eq("id", agBookingId)
          .eq("business_id", businessId)
          .single();

        if (agBooking.error) throw new Error(agBooking.error.message);

        if (agBooking.data) {
          const agBk = agBooking.data;
          const agDelta = agNewQty - agBk.qty;
          const confirmed = await supabase.rpc("confirm_booking_uplift", {
            p_booking_id: agBookingId, p_payment_id: yocoPaymentId, p_checkout_id: checkoutId,
            p_captured_cents: capturedCents, p_currency: String(payload.currency || "ZAR"),
            p_hold_id: agHoldId, p_pending_reschedule_id: null, p_new_qty: agNewQty,
          });
          if (confirmed.error || !confirmed.data?.ok) {
            if (!confirmed.error && ["no_capacity", "slot_closed", "bad_status", "amendment_changed"].includes(confirmed.data?.error)) {
              await refundUnfulfilledPayment(agBookingId, yocoPaymentId, checkoutId, capturedCents, agHoldId);
              await finishLease(true);
              return new Response("Change unavailable; refund recorded", { status: 200 });
            }
            await finishLease(false, confirmed.error?.message || confirmed.data?.error || "guest_confirmation_failed");
            return new Response("Temporary processing error", { status: 503 });
          }
          await finishLease(true);

          await supabase.from("logs").insert({
            business_id: agBk.business_id,
            booking_id: agBookingId,
            event: "guests_added_payment_confirmed",
            payload: { old_qty: agBk.qty, new_qty: agNewQty, hold_id: agHoldId, yoco_payment_id: yocoPaymentId },
          });

          // Invalidate waiver if previously signed — new guests are uninsured
          if (agBk.waiver_status === "SIGNED") {
            const newWaiverToken = confirmed.data.waiver_token;

            // Send INDEMNITY email so the lead booker can update the waiver
            if (agBk.email) {
              try {
                const agWaiverTenant = await getTenantByBusinessId(supabase, agBk.business_id);
                const agWaiverRef = agBookingId.substring(0, 8).toUpperCase();
                await fetch(SUPABASE_URL + "/functions/v1/send-email", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
                  body: JSON.stringify({
                    type: "INDEMNITY",
                    data: {
                      booking_id: agBookingId,
                      business_id: agBk.business_id,
                      waiver_status: "PENDING",
                      waiver_token: newWaiverToken,
                      email: agBk.email,
                      customer_name: agBk.customer_name || "Guest",
                      ref: agWaiverRef,
                      tour_name: agBk.tours?.name || "Experience",
                      start_time: agBk.slots?.start_time ? formatTenantDateTime(agWaiverTenant.business, agBk.slots.start_time) : "TBC",
                      qty: agNewQty,
                      message: "You've added new guests, so please update your waiver",
                    },
                  }),
                });
              } catch (e) { console.error("ADD_GUESTS_WAIVER_EMAIL_ERR:", e); }
            }

            await supabase.from("logs").insert({
              business_id: agBk.business_id,
              booking_id: agBookingId,
              event: "waiver_invalidated_guests_added",
              payload: { old_waiver_status: "SIGNED", new_waiver_status: "PENDING", new_waiver_token: newWaiverToken },
            });
          }

          // Send notification (email canonical; WhatsApp only when no email on file)
          try {
            const agTenant = await getTenantByBusinessId(supabase, agBk.business_id);
            const agRef = agBookingId.substring(0, 8).toUpperCase();
            const agTourName = agBk.tours?.name || "Booking";
            const agBrandName = getBusinessDisplayName(agTenant.business);
            const agSlotTime = agBk.slots?.start_time ? formatTenantDateTime(agTenant.business, agBk.slots.start_time) : "";

            if (!agBk.email && agBk.phone) {
              try {
                await sendWhatsappTextForTenant(agTenant, agBk.phone,
                  "Booking updated\n\n" +
                  "Hi " + ((agBk.customer_name && agBk.customer_name.split(" ")[0]) || "there") + ", " +
                  agDelta + " guest" + (agDelta === 1 ? "" : "s") + " added to your booking.\n\n" +
                  "Ref: " + agRef + "\n" +
                  agTourName + "\n\n" +
                  "Thanks, " + agBrandName + "."
                );
              } catch (e) { console.error("ADD_GUESTS_WA_ERR:", e); }
            }

            if (agBk.email) {
              try {
                await fetch(SUPABASE_URL + "/functions/v1/send-email", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
                  body: JSON.stringify({
                    type: "BOOKING_UPDATED",
                    data: {
                      business_id: agBk.business_id,
                      email: agBk.email,
                      customer_name: agBk.customer_name,
                      ref: agRef,
                      tour_name: agTourName,
                      start_time: agSlotTime || agBk.slots?.start_time || "",
                      message: agDelta + " guest" + (agDelta === 1 ? "" : "s") + " added. Your booking now has " + agNewQty + " guest" + (agNewQty === 1 ? "" : "s") + " total.",
                      event: "guests_added",
                    },
                  }),
                });
              } catch (e) { console.error("ADD_GUESTS_EMAIL_ERR:", e); }
            }
          } catch (e) { console.error("ADD_GUESTS_NOTIFY_ERR:", e); }

          console.log("ADD_GUESTS PAYMENT CONFIRMED booking:" + agBookingId + " new_qty:" + agNewQty);
        }
      }
      return new Response("OK", { status: 200 });
    }

    // Check if this is a gift voucher payment
    const gvr = await supabase.from("vouchers").select("*").eq("yoco_checkout_id", checkoutId).eq("business_id", businessId).maybeSingle();
    if (gvr.error) throw new Error(gvr.error.message);
    if (gvr.data && gvr.data.status === "PENDING") {
      const gv = gvr.data;
      const activation = await supabase.from("vouchers").update({ status: "ACTIVE", current_balance: gv.value || gv.purchase_amount || 0 })
        .eq("id", gv.id).eq("business_id", businessId);
      if (activation.error) throw new Error(activation.error.message);
      // Send voucher email(s). recipient_email exists on the vouchers table
      // but no purchase flow ever populated it before now — every gift email
      // went to the BUYER, addressed to the buyer ("Hi {buyer_name}, your
      // gift voucher for {recipient_name} is ready"), never delivered as an
      // actual gift experience to the recipient. When a buyer supplies the
      // recipient's email, send the gift there directly plus a short receipt
      // to the buyer; otherwise fall back to one buyer-addressed email
      // explicitly framed for forwarding, not as a purchase receipt.
      try {
        const gvTenantCtx = await getTenantByBusinessId(supabase, gv.business_id);
        const expiresLabel = formatTenantDate(gvTenantCtx.business, gv.expires_at);
        const baseData = {
          business_id: gv.business_id,
          code: gv.code,
          recipient_name: gv.recipient_name,
          gift_message: gv.gift_message,
          buyer_name: gv.buyer_name,
          tour_name: gv.tour_name,
          value: gv.value || gv.purchase_amount,
          expires_at: expiresLabel,
        };
        const recipientEmail = String(gv.recipient_email || "").trim().toLowerCase();
        const buyerEmail = String(gv.buyer_email || "").trim().toLowerCase();

        if (recipientEmail && recipientEmail !== buyerEmail) {
          await fetch(SUPABASE_URL + "/functions/v1/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
            body: JSON.stringify({ type: "GIFT_VOUCHER", data: { ...baseData, email: recipientEmail, gift_recipient_mode: "recipient" } }),
          });
          await fetch(SUPABASE_URL + "/functions/v1/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
            body: JSON.stringify({ type: "GIFT_VOUCHER", data: { ...baseData, email: buyerEmail, gift_recipient_mode: "buyer_receipt", recipient_email: recipientEmail } }),
          });
        } else {
          await fetch(SUPABASE_URL + "/functions/v1/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
            body: JSON.stringify({ type: "GIFT_VOUCHER", data: { ...baseData, email: buyerEmail, gift_recipient_mode: "buyer_forward" } }),
          });
        }
      } catch (e) { console.log("gv email err"); }
      // WhatsApp confirmation only when there is no buyer email — the voucher
      // email above is the canonical confirmation. The conversation state reset
      // stays unconditional so a bot-initiated purchase always unlocks the chat.
      if (gv.buyer_phone) {
        if (!gv.buyer_email) {
          const gvTenant = await getTenantByBusinessId(supabase, gv.business_id);
          await sendWhatsappTextForTenant(gvTenant, gv.buyer_phone,
            "Gift voucher purchased\n\n" +
            "Code: " + gv.code + "\n" +
            (gv.tour_name || "Any activity") + "\n" +
            "For: " + (gv.recipient_name || "Your guest") + "\n" +
            "Value: " + (gvTenant.business.currency || "ZAR") + " " + (gv.value || gv.purchase_amount) + "\n\n" +
            "Keep this code safe."
          );
        }
        await supabase.from("conversations").update({ current_state: "IDLE", state_data: {} }).eq("phone", gv.buyer_phone).eq("business_id", gv.business_id);
      }
      console.log("GV PAYMENT CONFIRMED voucher:" + gv.code);
      return new Response("OK", { status: 200 });
    }

    let br = checkoutId
      ? await supabase.from("bookings").select("*, slots(start_time), tours(name)").eq("yoco_checkout_id", checkoutId).eq("business_id", businessId).maybeSingle()
      : { data: null, error: null };
    if (br.error) throw new Error(br.error.message);
    if (!br.data && metaBookingId) {
      console.log("Fallback: lookup by metadata.booking_id=" + metaBookingId);
      br = await supabase.from("bookings").select("*, slots(start_time), tours(name)").eq("id", metaBookingId).eq("business_id", businessId).maybeSingle();
      if (br.error) throw new Error(br.error.message);
    }
    if (!br.data) { console.log("No booking found. checkoutId=" + checkoutId + " bookingId=" + metaBookingId); return new Response("OK", { status: 200 }); }
    const booking = br.data;
    if (booking.status === "PAID" || booking.status === "COMPLETED") {
      console.log("Already paid, ensuring confirmation delivery:" + booking.id);
      try {
        await sendBookingConfirmation(booking, booking.yoco_payment_id || yocoPaymentId, checkoutId, payload.amount);
      } catch (confirmErr) {
        console.error("CONFIRM_RESEND_ERR booking=" + booking.id + ":", confirmErr);
      }
      return new Response("OK", { status: 200 });
    }

    // ── R12/R15/R14: single-writer financial confirmation ──
    // confirm_booking_payment serializes on the booking row: reconciles gateway
    // cents against the immutable expected charge, settles reserved vouchers,
    // then converts capacity — all-or-nothing. No partial PAID state.
    const confirm = await supabase.rpc("confirm_booking_payment", {
      p_booking_id: booking.id, p_payment_id: yocoPaymentId,
      p_captured_cents: capturedCents, p_currency: String(payload.currency || "ZAR"),
    });
    if (confirm.error) {
      console.error("BOOKING_CONFIRM_RPC_ERR booking=" + booking.id + ": " + confirm.error.message);
      await finishLease(false, confirm.error.message);
      return new Response("Temporary processing error", { status: 503 });
    }
    const cres = confirm.data || {};
    if (cres.already_paid) {
      await finishLease(true);
      console.log("Already processed (concurrent webhook), ensuring confirmation delivery:" + booking.id);
      try {
        await sendBookingConfirmation(booking, booking.yoco_payment_id || yocoPaymentId, checkoutId, payload.amount);
      } catch (confirmErr) {
        console.error("CONFIRM_CONCURRENT_ERR booking=" + booking.id + ":", confirmErr);
      }
      return new Response("OK", { status: 200 });
    }
    if (!cres.ok) {
      const errCode = String(cres.error || "confirm_failed");
      console.warn("BOOKING_CONFIRM_REJECTED booking=" + booking.id + " reason=" + errCode);
      if (errCode === "amount_mismatch" || errCode === "voucher_shortfall") {
        // Money arrived but does not match the expected charge: quarantine for
        // manual review, release reservations, do NOT mark PAID.
        await supabase.from("bookings").update({
          status: "PENDING PAYMENT", yoco_payment_id: yocoPaymentId,
          payment_status: "MISMATCH_QUARANTINE",
        }).eq("id", booking.id);
        await supabase.rpc("release_voucher_reservations", { p_booking_id: booking.id });
        await supabase.from("logs").insert({
          business_id: booking.business_id, booking_id: booking.id,
          event: "payment_amount_mismatch",
          payload: { error: errCode, expected_cents: cres.expected_cents || null, captured_cents: capturedCents, yoco_payment_id: yocoPaymentId, checkout_id: checkoutId },
        });
        await finishLease(true);
        return new Response("OK", { status: 200 });
      }
      if (["no_capacity", "slot_closed", "bad_status"].includes(errCode)) {
        await refundUnfulfilledPayment(booking.id, yocoPaymentId, checkoutId, capturedCents);
        await finishLease(true);
        return new Response("Reservation unavailable; refund recorded", { status: 200 });
      }
      await finishLease(false, errCode);
      return new Response("Temporary processing error", { status: 503 });
    }
    await finishLease(true);

    // R14: vouchers were reserved at checkout and settled inside
    // confirm_booking_payment. Notify on remaining balances only.
    try {
      const settledV = await bookingVoucherBalances(supabase, booking.id, booking.business_id);
      for (const voucher of settledV) {
        if (!booking.email) break;
        try {
          await fetch(SUPABASE_URL + "/functions/v1/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
            body: JSON.stringify({
              type: "VOUCHER_BALANCE",
              data: {
                email: booking.email, customer_name: booking.customer_name,
                voucher_code: voucher.code, remaining_balance: voucher.current_balance,
                original_value: voucher.value, amount_used: voucher.amount_used,
                booking_ref: booking.id.substring(0, 8).toUpperCase(),
                tour_name: booking.tours?.name || "Booking",
                business_id: booking.business_id,
              },
            }),
          });
        } catch (vbErr) { console.error("VOUCHER_BALANCE_EMAIL_ERR:", vbErr); }
      }
    } catch (vbErr) { console.error("VOUCHER_BALANCE_LOOKUP_ERR:", vbErr); }

    // Apply promo code usage if one was used during checkout
    const metaPromoId = payload?.metadata?.promo_id;
    const metaPromoEmail = payload?.metadata?.customer_email || booking.customer_email || "";
    if (metaPromoId) {
      try {
        await supabase.rpc("apply_promo_code", { p_promo_id: metaPromoId, p_customer_email: metaPromoEmail, p_booking_id: booking.id, p_customer_phone: booking.phone || null });
        console.log("PROMO_USAGE_RECORDED: promo=" + metaPromoId + " booking=" + booking.id);
      } catch (promoErr) { console.error("PROMO_APPLY_ERR:", promoErr); }
    }

    await supabase.from("logs").insert({ business_id: booking.business_id, booking_id: booking.id, event: "payment_confirmed", payload: { yoco_payment_id: yocoPaymentId, checkout_id: checkoutId, amount: payload.amount, promo_code: payload?.metadata?.promo_code || null } });
    await supabase.from("conversations").update({ current_state: "IDLE", state_data: {}, updated_at: new Date().toISOString() }).eq("phone", booking.phone).eq("business_id", booking.business_id);

    // Send confirmation email + WhatsApp — wrapped in try-catch so a notification failure
    // does NOT prevent the webhook from returning 200 (booking is already marked PAID above)
    try {
      await sendBookingConfirmation({ ...booking, status: "PAID", yoco_payment_id: yocoPaymentId }, yocoPaymentId, checkoutId, payload.amount);
    } catch (confirmErr) {
      console.error("CONFIRM_SEND_ERR booking=" + booking.id + ":", confirmErr);
      // Log the failure so it can be retried manually from admin
      try {
        await supabase.from("logs").insert({
          business_id: booking.business_id,
          booking_id: booking.id,
          event: "booking_confirmation_failed",
          payload: { error: confirmErr instanceof Error ? confirmErr.message : String(confirmErr), yoco_payment_id: yocoPaymentId },
        });
      } catch (_logErr) { /* best-effort */ }
    }

    console.log("PAYMENT CONFIRMED booking:" + booking.id);
    return new Response("OK", { status: 200 });
  } catch (err) { console.error("YOCO_WEBHOOK_ERROR:", err); return new Response("Temporary processing error", { status: 503 }); }
  };
  const response = await processPayment();
  try {
    await finishLease(response.ok, response.ok ? undefined : "HTTP " + response.status);
  } catch (error) {
    console.error("YOCO_WEBHOOK_FINISH_ERROR:", error);
    return new Response("Temporary processing error", { status: 503 });
  }
  return response;
}));
