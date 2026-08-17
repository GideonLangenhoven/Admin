// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, getBusinessDisplayName, getTenantByBusinessId, sendWhatsappTextForTenant, getAdminAppOrigins, isAllowedOrigin } from "../_shared/tenant.ts";
import { reissueVoucherPortion } from "../_shared/vouchers.ts";
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
      .select("business_id, role, suspended")
      .eq("user_id", userRes.user.id)
      .maybeSingle();
    if (!admin || admin.suspended) return { ok: false, status: 403, message: "Admin access required" };
    if (/super/i.test(admin.role || "") || admin.business_id === booking.business_id) return { ok: true };
    return { ok: false, status: 403, message: "You can only refund bookings for your own business" };
  } catch {
    return { ok: false, status: 401, message: "Admin session required" };
  }
}

Deno.serve(async (req: any) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCors(req) });

  try {
    const body = await req.json();
    const { booking_id, amount } = body;
    if (!booking_id) return new Response(JSON.stringify({ error: "booking_id required" }), { status: 400, headers: getCors(req) });

    // Reject tokenless calls before touching the DB so anonymous callers
    // can't probe which booking IDs exist.
    const rawAuth = (req.headers.get("authorization") || req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!rawAuth) return new Response(JSON.stringify({ error: "Admin session required" }), { status: 401, headers: getCors(req) });

    const { data: booking, error: bErr } = await supabase.from("bookings")
      .select("*, slots(start_time), tours(name)")
      .eq("id", booking_id)
      .single();
    if (bErr || !booking) return new Response(JSON.stringify({ error: "Booking not found" }), { status: 404, headers: getCors(req) });

    const authz = await authorizeRefund(req, booking);
    if (authz.ok !== true) {
      const denied = authz as { status: number; message: string };
      return new Response(JSON.stringify({ error: denied.message }), { status: denied.status, headers: getCors(req) });
    }

    // Guard: voucher-paid bookings must not hit Yoco — they should be refunded via voucher
    const pm = (booking.payment_method || "").toUpperCase();
    if (pm === "VOUCHER" || pm === "GIFT_VOUCHER") {
      return new Response(JSON.stringify({ error: "This booking was paid via voucher. Refunds for voucher-paid bookings must be issued as vouchers, not via Yoco. Use the cancel-to-voucher flow instead." }), { status: 400, headers: getCors(req) });
    }

    // Guard: manual payments (cash/EFT) cannot be refunded via Yoco — flag for manual processing
    if (pm === "MANUAL" || pm === "CASH" || pm === "EFT") {
      const manualRefundAmount = amount != null ? Number(amount) : Number(booking.refund_amount || booking.total_amount || 0);
      await supabase.from("bookings").update({
        refund_status: "MANUAL_EFT_REQUIRED",
        refund_amount: manualRefundAmount,
        refund_notes: "Manual/EFT refund required. Payment was made via " + pm + ". Admin must process refund manually.",
      }).eq("id", booking.id);

      await supabase.from("logs").insert({
        business_id: booking.business_id,
        booking_id: booking.id,
        event: "refund_manual_required",
        payload: { amount: manualRefundAmount, payment_method: pm },
      });

      return new Response(JSON.stringify({ ok: true, refund_status: "MANUAL_EFT_REQUIRED", amount: manualRefundAmount, message: "This booking was paid via " + pm + ". An admin must process the refund manually." }), { status: 200, headers: getCors(req) });
    }

    // Combo legs: the offer's cancellation policy decides the FORM of
    // compensation. Cash only when the offer says POLICY_REFUND; the default
    // VOUCHER_ONLY routes through the voucher flow instead.
    const comboCtx = await getComboLegPolicy(supabase, booking);
    if (comboCtx && comboCtx.cancellation_policy !== "POLICY_REFUND") {
      const why = comboCtx.cancellation_policy === "NO_CANCEL"
        ? "This booking is part of a non-cancellable combo package."
        : "This combo package is refundable as a credit voucher only.";
      return new Response(JSON.stringify({ error: why + " Use the cancel-to-voucher flow instead of a cash refund." }), { status: 400, headers: getCors(req) });
    }

    const totalAmount = Number(booking.total_amount || 0);
    const totalCaptured = Number(booking.total_captured || totalAmount);
    const totalRefunded = Number(booking.total_refunded || 0);

    // Voucher-funded portion must never be paid out as cash. Older bookings
    // recorded total_captured as the full total (incl. voucher portion), so cap
    // at whichever is lower: recorded capture, or total minus voucher.
    const voucherPaid = Number(booking.voucher_amount_paid || 0);
    const maxCashRefund = Math.max(0, Math.min(totalCaptured, totalAmount - voucherPaid) - totalRefunded);

    // Nothing cash-refundable but a voucher portion exists (fully or mostly
    // voucher-funded booking): the refund IS the voucher reissue. Capping the
    // cash without reissuing was a black hole — the operator saw a refund
    // "processed", the customer's voucher value simply vanished.
    if (maxCashRefund <= 0 && voucherPaid > 0) {
      const reissued = await reissueVoucherPortion(supabase, booking);
      if (!reissued) {
        return new Response(JSON.stringify({ error: "Nothing left to refund: cash portion already refunded and the voucher portion was already reissued." }), { status: 400, headers: getCors(req) });
      }
      await supabase.from("bookings").update({
        status: "CANCELLED",
        refund_status: "REFUNDED",
        refund_notes: "Voucher-funded booking: portion of " + reissued.amount.toFixed(2) + " reissued as voucher " + reissued.code + " (no cash movement)",
        cancellation_reason: booking.cancellation_reason || "Auto-cancelled: refund processed by admin",
        cancelled_at: booking.cancelled_at || new Date().toISOString(),
      }).eq("id", booking.id);
      await supabase.from("logs").insert({
        business_id: booking.business_id,
        booking_id: booking.id,
        event: "refund_voucher_reissued",
        payload: { voucher_code: reissued.code, amount: reissued.amount, cash_refunded: 0 },
      });
      if (booking.email) {
        try {
          await fetch(SUPABASE_URL + "/functions/v1/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
            body: JSON.stringify({
              type: "CANCELLATION",
              data: {
                business_id: booking.business_id,
                email: booking.email,
                customer_name: booking.customer_name,
                ref: booking.id.substring(0, 8).toUpperCase(),
                tour_name: booking.tours?.name || "Booking",
                start_time: booking.slots?.start_time || "",
                reason: "Refund processed: voucher reissued",
                voucher_code: reissued.code,
                voucher_amount: reissued.amount.toFixed(2),
                total_amount: totalAmount.toFixed(2),
                is_partial: false,
              },
            }),
          });
        } catch (e) { console.error("Email voucher-reissue notify err:", e); }
      }
      return new Response(JSON.stringify({ ok: true, amount: 0, voucher_code: reissued.code, voucher_amount: reissued.amount, channel: "voucher" }), { status: 200, headers: getCors(req) });
    }

    // Combo money is collected on ONE operator's Yoco account (the collector's
    // leg is the only booking stamped with yoco_checkout_id), so a cash refund
    // for any other leg must run against the collector's checkout + creds.
    let refundCheckoutId: string = booking.yoco_checkout_id || "";
    let refundCredsBusinessId: string = booking.business_id;
    if (comboCtx && !refundCheckoutId) {
      const collectorLeg = comboCtx.legs.find((l: any) => l.yoco_checkout_id);
      refundCheckoutId = collectorLeg?.yoco_checkout_id || comboCtx.combo.yoco_checkout_id || "";
      if (collectorLeg) refundCredsBusinessId = collectorLeg.business_id;
    }
    if (!refundCheckoutId) return new Response(JSON.stringify({ error: "No Yoco checkout ID on this booking; manual refund only" }), { status: 400, headers: getCors(req) });

    const tenant = await getTenantByBusinessId(supabase, refundCredsBusinessId);
    const brandName = getBusinessDisplayName(tenant.business);
    let refundAmount = amount != null ? Number(amount) : Number(booking.refund_amount || booking.total_amount || 0);
    if (refundAmount <= 0) return new Response(JSON.stringify({ error: "Invalid refund amount" }), { status: 400, headers: getCors(req) });

    if (refundAmount > maxCashRefund) refundAmount = maxCashRefund;
    if (refundAmount <= 0) {
      return new Response(JSON.stringify({ error: "Nothing cash-refundable: already fully refunded." }), { status: 400, headers: getCors(req) });
    }

    // S2: reserve BEFORE calling Yoco. reserve_refund locks the booking row and
    // atomically increments total_refunded by the clamped reservable amount,
    // returning what it actually reserved. A concurrent refund waits on the lock
    // then can only reserve the remainder (or 0) -> Yoco is never double-charged.
    const { data: reservedRaw, error: reserveErr } = await supabase.rpc("reserve_refund", {
      p_booking_id: booking.id,
      p_amount: refundAmount,
    });
    if (reserveErr) {
      return new Response(JSON.stringify({ error: "Refund reservation failed: " + reserveErr.message }), { status: 500, headers: getCors(req) });
    }
    const reservedAmount = Number(reservedRaw || 0);
    if (reservedAmount <= 0) {
      return new Response(JSON.stringify({ error: "Nothing left to refund (captured: " + totalCaptured + ", already refunded: " + totalRefunded + ")" }), { status: 400, headers: getCors(req) });
    }
    refundAmount = reservedAmount; // Yoco is refunded exactly what we reserved
    const isPartial = refundAmount < totalCaptured;

    const refundAmountCents = Math.round(refundAmount * 100);
    const yocoBody: any = {};
    // Combo legs ALWAYS send an explicit amount: the checkout's Yoco total
    // spans every leg, so a bodyless "full refund" would refund the whole
    // combo, not this leg's share.
    if (isPartial || comboCtx) yocoBody.amount = refundAmountCents;

    // Test-mode aware: refunds follow the tenant's CURRENT mode. A payment made
    // in the other mode fails loud at Yoco ("not found") rather than crossing accounts.
    const yocoRes = await fetch("https://payments.yoco.com/api/checkouts/" + refundCheckoutId + "/refund", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + tenant.credentials.activeYocoSecretKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(yocoBody),
    });

    const yocoData = await yocoRes.json();

    if (!yocoRes.ok || (yocoData.status && yocoData.status !== "successful")) {
      const errMsg = yocoData.displayMessage || yocoData.message || yocoData.errorMessage || JSON.stringify(yocoData);
      // S2: Yoco refund failed after we reserved — release the reservation so the
      // amount becomes refundable again (no money moved).
      await supabase.rpc("release_refund_reservation", { p_booking_id: booking.id, p_amount: refundAmount });
      await supabase.from("bookings").update({
        refund_status: "FAILED",
        refund_amount: refundAmount,
        refund_error: errMsg,
        refund_notes: (isPartial ? "Partial" : "Full") + " Yoco refund failed: " + errMsg,
      }).eq("id", booking.id);

      await supabase.from("logs").insert({
        business_id: booking.business_id,
        booking_id: booking.id,
        event: "refund_failed",
        payload: { amount: refundAmount, yoco_response: yocoData },
      });

      return new Response(JSON.stringify({ ok: false, error: errMsg }), { status: 200, headers: getCors(req) });
    }

    // Split tender: the cash just went back via Yoco; the voucher-funded
    // portion comes back as a fresh CREDIT voucher. Idempotent — flows that
    // already reissued (rebook-booking, CLAIM_CREDIT) stamped
    // converted_to_voucher_id, so this is a no-op for them.
    const reissued = await reissueVoucherPortion(supabase, booking);

    // S2: total_refunded was already set atomically by reserve_refund — do NOT
    // re-add it here (that would double-count).
    await supabase.from("bookings").update({
      status: "CANCELLED",
      refund_status: "REFUNDED",
      refund_amount: refundAmount,
      refund_notes: (isPartial ? "Partial" : "Full") + " Yoco refund: " + refundAmount.toFixed(2) + " of " + totalCaptured.toFixed(2) + " (previously refunded: " + totalRefunded.toFixed(2) + ")"
        + (reissued ? "; voucher portion " + reissued.amount.toFixed(2) + " reissued as " + reissued.code : ""),
      cancellation_reason: "Auto-cancelled: refund processed by admin",
      cancelled_at: new Date().toISOString(),
    }).eq("id", booking.id);

    await supabase.from("logs").insert({
      business_id: booking.business_id,
      booking_id: booking.id,
      event: "refund_processed",
      payload: { amount: refundAmount, partial: isPartial, yoco_refund: yocoData, ...(reissued ? { voucher_code: reissued.code, voucher_amount: reissued.amount } : {}) },
    });

    const ref = booking.id.substring(0, 8).toUpperCase();
    const tourName = booking.tours?.name || "Booking";
    // Email is the canonical notice; WhatsApp only when no email on file.
    if (!booking.email && booking.phone) {
      try {
        await sendWhatsappTextForTenant(tenant, booking.phone,
          "Refund processed\n\n" +
          "Hi " + (booking.customer_name?.split(" ")[0] || "there") + ", your " +
          (isPartial ? "partial " : "") + "refund of " + (tenant.business.currency || "ZAR") + " " + refundAmount.toFixed(2) +
          " for " + tourName + " (Ref: " + ref + ") has been processed.\n\n" +
          (reissued ? "Your voucher portion of " + (tenant.business.currency || "ZAR") + " " + reissued.amount.toFixed(2) + " has been reissued as voucher " + reissued.code + ".\n\n" : "") +
          "Please allow 5 to 10 business days for the amount to reflect in your account.\n\n" +
          "Thanks for choosing " + brandName + "."
        );
      } catch (e) { console.error("WA refund notify err:", e); }
    }

    if (booking.email) {
      try {
        await fetch(SUPABASE_URL + "/functions/v1/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
          body: JSON.stringify({
            type: "CANCELLATION",
            data: {
              business_id: booking.business_id,
              email: booking.email,
              customer_name: booking.customer_name,
              ref: ref,
              tour_name: tourName,
              start_time: booking.slots?.start_time || "",
              reason: (isPartial ? "Partial" : "Full") + " refund processed",
              refund_amount: refundAmount.toFixed(2),
              total_amount: totalAmount.toFixed(2),
              is_partial: isPartial,
              ...(reissued ? { voucher_code: reissued.code, voucher_amount: reissued.amount.toFixed(2) } : {}),
            },
          }),
        });
      } catch (e) { console.error("Email refund notify err:", e); }
    }

    return new Response(JSON.stringify({ ok: true, amount: refundAmount, partial: isPartial, ...(reissued ? { voucher_code: reissued.code, voucher_amount: reissued.amount } : {}) }), { status: 200, headers: getCors(req) });
  } catch (err: any) {
    console.error("PROCESS_REFUND_ERROR:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: getCors(req) });
  }
});
