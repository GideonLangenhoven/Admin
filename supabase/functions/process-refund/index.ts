import { withSentry } from "../_shared/sentry.ts";
// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, getTenantByBusinessId, sendWhatsappTextForTenant, getAdminAppOrigins, isAllowedOrigin } from "../_shared/tenant.ts";
import { getPaidPortions, reissueVoucherPortion } from "../_shared/vouchers.ts";
import { getComboLegPolicy } from "../_shared/combo.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createServiceClient();

function getCors(req?: any) {
  const origins = getAdminAppOrigins();
  const origin = req?.headers?.get("origin") || "";
  const allowed = isAllowedOrigin(origin, origins) ? origin : origins[0];
  return { "Access-Control-Allow-Origin": allowed, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-business-id, x-tenant-subdomain, x-tenant-origin, x-voucher-code, x-booking-success-token, x-booking-id, x-booking-waiver-token", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
}

// Caller authorization — this function moves money, so it must never be
// callable anonymously (verify_jwt is false for internal cross-function
// calls, which use the service-role key as Bearer). Two caller classes:
//   1. Internal (yoco-webhook, batch-refund, weather flows) — service key.
//   2. Admin dashboard — Supabase Auth JWT of an active admin whose
//      business matches the booking (SUPER_ADMIN exempt).
async function authorizeRefund(req: any, booking: any): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (token && token === SUPABASE_KEY) return { ok: true };
  if (!token) return { ok: false, status: 401, message: "Admin session required" };
  try {
    const { data: userRes, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !userRes?.user) return { ok: false, status: 401, message: "Admin session required" };
    const { data: admin } = await supabase
      .from("admin_users")
      .select("business_id, role, suspended, read_only")
      .eq("user_id", userRes.user.id)
      .maybeSingle();
    if (!admin || admin.suspended) return { ok: false, status: 403, message: "Admin access required" };
    if (admin.read_only) return { ok: false, status: 403, message: "This demonstration account is read-only." };
    if (/super/i.test(admin.role || "") || admin.business_id === booking.business_id) return { ok: true };
    return { ok: false, status: 403, message: "You can only refund bookings for your own business" };
  } catch {
    return { ok: false, status: 401, message: "Admin session required" };
  }
}

Deno.serve(withSentry("process-refund", async (req: any) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCors(req) });
  const respond = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: getCors(req) });
  try {
    const body = await req.json();
    if (!body.booking_id) return respond({ error: "booking_id required" }, 400);
    if (!req.headers.get("authorization")) return respond({ error: "Admin session required" }, 401);
    const loaded = await supabase.from("bookings").select("*, slots(start_time), tours(name)").eq("id", body.booking_id).single();
    const booking = loaded.data;
    if (loaded.error || !booking) return respond({ error: "Booking not found" }, 404);
    const authorized = await authorizeRefund(req, booking);
    if (authorized.ok === false) return respond({ error: authorized.message }, authorized.status);
    if (body.amount != null && (!Number.isFinite(Number(body.amount)) || Number(body.amount) <= 0)) return respond({ error: "Invalid refund amount" }, 400);
    const combo = await getComboLegPolicy(supabase, booking);
    if (combo && combo.cancellation_policy !== "POLICY_REFUND") return respond({ error: "This combo must use its voucher cancellation flow." }, 400);
    const { cashPaid, voucherPaid } = getPaidPortions(booking);
    const totalCaptured = Number(booking.total_captured ?? 0);
    if (cashPaid > 0 && (!Number.isFinite(totalCaptured) || totalCaptured <= 0)) {
      return respond({ error: "No cash capture is recorded. Reconcile the original payment before refunding." }, 409);
    }
    const totalRefunded = Number(booking.total_refunded || 0);
    const keepBooking = body.keep_booking === true || (booking.status !== "CANCELLED" && ["REQUESTED", "MANUAL_EFT_REQUIRED", "FAILED"].includes(booking.refund_status));
    const pm = String(booking.payment_method || "").toUpperCase();
    let manual = /MANUAL|CASH|EFT|CARD \(TERMINAL\)|OTHER/.test(pm) || (!booking.yoco_checkout_id && cashPaid > 0 && !combo);
    // A late payment that never confirmed the booking did not consume its voucher.
    const voucherWasSpent = voucherPaid > 0 && (booking.payment_status === "CAPTURED" || ["PAID", "CONFIRMED"].includes(booking.status)
      || String(booking.yoco_payment_id || "").startsWith("VOUCHER"));
    if (totalCaptured <= 0 && voucherPaid > 0) {
      if (keepBooking) return respond({ error: "Use the guest-change voucher credit for a partial booking refund." }, 409);
      if (booking.refund_status === "REFUNDED" && booking.converted_to_voucher_id) return respond({ ok: true, already_refunded: true, amount: 0 });
      const cancelled = await supabase.rpc("cancel_booking_transaction", { p_booking_id: booking.id, p_business_id: booking.business_id, p_reason: "Refund requested", p_allow_late_choice: true });
      if (cancelled.error || !cancelled.data?.ok) return respond({ error: "Could not cancel the booking" }, 409);
      const reissued = voucherWasSpent ? await reissueVoucherPortion(supabase, booking) : null;
      if (voucherWasSpent && !reissued && !booking.converted_to_voucher_id) return respond({ error: "Voucher reissue could not be confirmed. Please retry." }, 503);
      const saved = await supabase.from("bookings").update({ refund_status: "REFUNDED", refund_processed_at: new Date().toISOString() }).eq("id", booking.id).eq("business_id", booking.business_id);
      if (saved.error) throw saved.error;
      return respond({ ok: true, amount: 0, channel: "voucher", voucher_code: reissued?.code, voucher_amount: reissued?.amount });
    }

    let operations: any[];
    let requestId: string;
    if (booking.refund_request_id && (body.resume_refund || ["REFUND_PENDING", "REFUNDED", "MANUAL_EFT_REQUIRED"].includes(booking.refund_status))) {
      const existing = await supabase.from("refund_operations").select("*").eq("booking_id", booking.id).eq("business_id", booking.business_id).eq("request_id", booking.refund_request_id);
      if (existing.error) throw existing.error;
      operations = existing.data || []; requestId = booking.refund_request_id;
    } else {
      const holds = await supabase.from("holds").select("metadata").eq("booking_id", booking.id);
      if (holds.error) throw holds.error;
      const upgrades = (holds.data || []).filter((h: any) => Number(h.metadata?.captured_cents) > 0 && h.metadata?.yoco_checkout_id);
      if (upgrades.length && !/MANUAL|CASH|EFT|CARD \(TERMINAL\)|OTHER/.test(pm)) manual = false;
      const upgradeCaptured = upgrades.reduce((sum: number, h: any) => sum + Number(h.metadata.captured_cents) / 100, 0);
      const collector = combo?.legs.find((leg: any) => leg.yoco_checkout_id);
      const originalCheckout = manual ? "MANUAL" : booking.yoco_checkout_id || collector?.yoco_checkout_id || combo?.combo.yoco_checkout_id;
      if (!originalCheckout && !upgrades.length) return respond({ error: "The original checkout is missing. Reconcile this payment before refunding." }, 409);
      const sources = [
        ...(originalCheckout ? [{ checkout_id: originalCheckout, captured: Math.max(0, totalCaptured - upgradeCaptured), business_id: collector?.business_id || booking.business_id, mode: manual ? "manual" : booking.yoco_mode }] : []),
        ...upgrades.map((h: any) => ({ checkout_id: h.metadata.yoco_checkout_id, captured: Number(h.metadata.captured_cents) / 100, business_id: booking.business_id, mode: h.metadata.yoco_mode })),
      ];
      let maxCashRefund = Math.max(0, totalCaptured - totalRefunded);
      if (Number(booking.original_total) > 0 && Number(booking.total_amount) + voucherPaid > Number(booking.original_total)) maxCashRefund = Math.min(maxCashRefund, cashPaid);
      const requested = Number(body.amount ?? booking.refund_amount ?? cashPaid);
      const amount = Math.min(requested, maxCashRefund);
      if (!(amount > 0)) return respond({ error: "Nothing left to refund" }, 409);
      const reserved = await supabase.rpc("reserve_refund_request", {
        p_booking_id: booking.id, p_business_id: booking.business_id, p_amount: amount, p_sources: sources, p_keep_booking: keepBooking,
      });
      if (reserved.error || !reserved.data?.ok) return respond({ error: reserved.data?.error || reserved.error?.message || "Could not reserve refund" }, 409);
      operations = reserved.data.operations || []; requestId = reserved.data.request_id;
    }
    if (!operations.length) return respond({ error: "Refund records are missing. Please reconcile this payment." }, 409);
    for (const operation of operations) {
      if (operation.status !== "PENDING") continue;
      if (operation.mode === "manual" && body.action !== "confirm_manual") {
        const saved = await supabase.from("bookings").update({ refund_status: "MANUAL_EFT_REQUIRED", refund_notes: "Refund reserved. Complete the bank transfer, then mark it as paid." }).eq("id", booking.id).eq("business_id", booking.business_id);
        if (saved.error) throw saved.error;
        return respond({ ok: true, pending: true, refund_status: "MANUAL_EFT_REQUIRED", amount: operation.amount });
      }
      let status = "SUCCEEDED", providerId: string | null = null, error: string | null = null;
      if (operation.mode !== "manual") {
        const tenant = await getTenantByBusinessId(supabase, operation.source_business_id);
        const key = operation.mode === "test" ? tenant.credentials.yocoTestSecretKey : operation.mode === "live" ? tenant.credentials.yocoSecretKey : tenant.credentials.activeYocoSecretKey;
        if (!key) return respond({ error: "Payment credentials for the original payment mode are missing", pending: true }, 503);
        try {
          const response = await fetch("https://payments.yoco.com/api/checkouts/" + operation.checkout_id + "/refund", {
            method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", "Idempotency-Key": operation.id },
            body: JSON.stringify({ amount: Math.round(Number(operation.amount) * 100), metadata: { refund_operation_id: operation.id } }),
          });
          const data = await response.json();
          providerId = data.refundId || null;
          const providerStatus = String(data.status || "").toLowerCase();
          status = response.ok && ["succeeded", "successful"].includes(providerStatus) ? "SUCCEEDED"
            : providerStatus === "failed" || (response.status >= 400 && response.status < 500 && ![408,409,429].includes(response.status)) ? "FAILED" : "PENDING";
          if (status !== "SUCCEEDED") error = data.displayMessage || data.message || data.errorMessage || "Waiting for payment provider confirmation";
        } catch (cause) {
          status = "PENDING"; error = "Provider response unavailable; this refund remains reserved and can be checked again.";
          console.error("REFUND_RESPONSE_UNKNOWN", operation.id, cause);
        }
      }
      const finished = await supabase.rpc("finish_refund_operation", { p_operation_id: operation.id, p_status: status, p_provider_id: providerId, p_error: error });
      if (finished.error || !finished.data?.ok) return respond({ error: "Could not record provider result. Retry safely with the same refund reference.", pending: true }, 503);
    }
    const current = await supabase.from("refund_operations").select("*").eq("booking_id", booking.id).eq("business_id", booking.business_id).eq("request_id", requestId);
    if (current.error) throw current.error;
    operations = current.data || [];
    const amount = operations.filter(op => op.status !== "FAILED").reduce((sum, op) => sum + Number(op.amount), 0);
    if (operations.some(op => op.status === "PENDING")) return respond({ ok: true, pending: true, refund_status: "REFUND_PENDING", amount, request_id: requestId }, 202);
    if (operations.some(op => op.status === "FAILED")) return respond({ ok: false, error: "The payment provider declined part or all of this refund. Review the refund queue before retrying.", refund_status: "FAILED", amount }, 502);

    const reissued = !operations[0].keep_booking && voucherWasSpent ? await reissueVoucherPortion(supabase, booking) : null;
    if (!operations[0].keep_booking && voucherWasSpent && !reissued && !booking.converted_to_voucher_id) {
      await supabase.from("bookings").update({ refund_status: "REFUND_PENDING", refund_error: "Cash refunded; voucher reissue pending" }).eq("id", booking.id).eq("business_id", booking.business_id);
      return respond({ error: "Cash refunded; voucher credit still needs to be reissued. Please retry.", pending: true }, 503);
    }
    const completed = await supabase.from("bookings").update({ refund_status: "REFUNDED", refund_error: null }).eq("id", booking.id).eq("business_id", booking.business_id);
    if (completed.error) throw completed.error;
    const noticeKey = "refund_notice:" + requestId;
    const claim = await supabase.rpc("claim_yoco_payment", { p_key: noticeKey });
    if (claim.error) throw claim.error;
    if (claim.data === "claimed") {
      try {
        if (booking.email) {
          const email = await fetch(SUPABASE_URL + "/functions/v1/send-email", {
            method: "POST", headers: { Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({ type: "BOOKING_UPDATED", data: {
              booking_id: booking.id, business_id: booking.business_id, email: booking.email, customer_name: booking.customer_name,
              ref: booking.id.substring(0,8).toUpperCase(), tour_name: booking.tours?.name || "Booking", event: "refund_processed",
              message: "Your refund of R" + amount.toFixed(2) + " has been processed. Allow 5 to 10 business days for it to reach your account."
                + (reissued ? " Voucher credit: " + reissued.code + " (R" + reissued.amount.toFixed(2) + ")." : ""),
            } }),
          });
          if (!email.ok) throw new Error("Refund email failed");
        } else if (booking.phone) {
          const tenant = await getTenantByBusinessId(supabase, booking.business_id);
          await sendWhatsappTextForTenant(tenant, booking.phone, "Your refund of R" + amount.toFixed(2) + " has been processed. Allow 5 to 10 business days for it to reach your account.");
        }
        await supabase.rpc("finish_yoco_payment", { p_key: noticeKey, p_ok: true });
      } catch (error) { await supabase.rpc("finish_yoco_payment", { p_key: noticeKey, p_ok: false, p_error: String(error) }); }
    }
    return respond({ ok: true, amount, refund_status: "REFUNDED", partial: operations[0].keep_booking, voucher_code: reissued?.code, voucher_amount: reissued?.amount });
  } catch (error: any) {
    console.error("PROCESS_REFUND_ERROR:", error);
    return respond({ error: error.message || "Internal error" }, 500);
  }
}));
