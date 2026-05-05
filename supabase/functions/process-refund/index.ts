// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, getBusinessDisplayName, getTenantByBusinessId, sendWhatsappTextForTenant, getAdminAppOrigins } from "../_shared/tenant.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createServiceClient();

function getCors(req?: any) {
  const origins = getAdminAppOrigins();
  const origin = req?.headers?.get("origin") || "";
  const allowed = origins.includes(origin) ? origin : origins[0];
  return { "Access-Control-Allow-Origin": allowed, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
}

Deno.serve(async (req: any) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCors(req) });

  try {
    const body = await req.json();
    const { booking_id, amount } = body;
    if (!booking_id) return new Response(JSON.stringify({ error: "booking_id required" }), { status: 400, headers: getCors(req) });

    const { data: booking, error: bErr } = await supabase.from("bookings")
      .select("*, slots(start_time), tours(name)")
      .eq("id", booking_id)
      .single();
    if (bErr || !booking) return new Response(JSON.stringify({ error: "Booking not found" }), { status: 404, headers: getCors(req) });

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
        refund_notes: "Manual/EFT refund required — payment was made via " + pm + ". Admin must process refund manually.",
      }).eq("id", booking.id);

      await supabase.from("logs").insert({
        business_id: booking.business_id,
        booking_id: booking.id,
        event: "refund_manual_required",
        payload: { amount: manualRefundAmount, payment_method: pm },
      });

      return new Response(JSON.stringify({ ok: true, refund_status: "MANUAL_EFT_REQUIRED", amount: manualRefundAmount, message: "This booking was paid via " + pm + ". An admin must process the refund manually." }), { status: 200, headers: getCors(req) });
    }

    if (!booking.yoco_checkout_id) return new Response(JSON.stringify({ error: "No Yoco checkout ID on this booking — manual refund only" }), { status: 400, headers: getCors(req) });

    const tenant = await getTenantByBusinessId(supabase, booking.business_id);
    const brandName = getBusinessDisplayName(tenant.business);
    const refundAmount = amount != null ? Number(amount) : Number(booking.refund_amount || booking.total_amount || 0);
    if (refundAmount <= 0) return new Response(JSON.stringify({ error: "Invalid refund amount" }), { status: 400, headers: getCors(req) });

    const totalAmount = Number(booking.total_amount || 0);
    const totalCaptured = Number(booking.total_captured || totalAmount);
    const totalRefunded = Number(booking.total_refunded || 0);
    const refundableAmount = totalCaptured - totalRefunded;

    // Cap at what was actually captured via Yoco (prevents refunding more than the Yoco portion in split-tender)
    if (refundAmount > refundableAmount) refundAmount = refundableAmount;
    if (refundAmount <= 0) return new Response(JSON.stringify({ error: "Nothing left to refund (captured: " + totalCaptured + ", already refunded: " + totalRefunded + ")" }), { status: 400, headers: getCors(req) });
    const isPartial = refundAmount < totalCaptured;

    const refundAmountCents = Math.round(refundAmount * 100);
    const yocoBody: any = {};
    if (isPartial) yocoBody.amount = refundAmountCents;

    const yocoRes = await fetch("https://payments.yoco.com/api/checkouts/" + booking.yoco_checkout_id + "/refund", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + tenant.credentials.yocoSecretKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(yocoBody),
    });

    const yocoData = await yocoRes.json();

    if (!yocoRes.ok || (yocoData.status && yocoData.status !== "successful")) {
      const errMsg = yocoData.displayMessage || yocoData.message || yocoData.errorMessage || JSON.stringify(yocoData);
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

    const newTotalRefunded = totalRefunded + refundAmount;
    await supabase.from("bookings").update({
      status: "CANCELLED",
      refund_status: "REFUNDED",
      refund_amount: refundAmount,
      total_refunded: newTotalRefunded,
      refund_notes: (isPartial ? "Partial" : "Full") + " Yoco refund — " + refundAmount.toFixed(2) + " of " + totalCaptured.toFixed(2) + " (previously refunded: " + totalRefunded.toFixed(2) + ")",
      cancellation_reason: "Auto-cancelled — refund processed by admin",
      cancelled_at: new Date().toISOString(),
    }).eq("id", booking.id);

    await supabase.from("logs").insert({
      business_id: booking.business_id,
      booking_id: booking.id,
      event: "refund_processed",
      payload: { amount: refundAmount, partial: isPartial, yoco_refund: yocoData },
    });

    const ref = booking.id.substring(0, 8).toUpperCase();
    const tourName = booking.tours?.name || "Booking";
    if (booking.phone) {
      try {
        await sendWhatsappTextForTenant(tenant, booking.phone,
          "Refund processed\n\n" +
          "Hi " + (booking.customer_name?.split(" ")[0] || "there") + ", your " +
          (isPartial ? "partial " : "") + "refund of " + (tenant.business.currency || "ZAR") + " " + refundAmount.toFixed(2) +
          " for " + tourName + " (Ref: " + ref + ") has been processed.\n\n" +
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
            },
          }),
        });
      } catch (e) { console.error("Email refund notify err:", e); }
    }

    return new Response(JSON.stringify({ ok: true, amount: refundAmount, partial: isPartial }), { status: 200, headers: getCors(req) });
  } catch (err: any) {
    console.error("PROCESS_REFUND_ERROR:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: getCors(req) });
  }
});
