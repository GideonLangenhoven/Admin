import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, getBusinessDisplayName, getTenantByBusinessId, sendWhatsappTextForTenant, getAdminAppOrigins } from "../_shared/tenant.ts";

var SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
var SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
var supabase = createServiceClient();

function getCors(req?: any) {
  var origins = getAdminAppOrigins();
  var origin = req?.headers?.get("origin") || "";
  var allowed = origins.includes(origin) ? origin : origins[0];
  return { "Access-Control-Allow-Origin": allowed, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
}

Deno.serve(async (req: any) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCors(req) });

  try {
    var body = await req.json();
    var { booking_id, amount } = body;
    if (!booking_id) return new Response(JSON.stringify({ error: "booking_id required" }), { status: 400, headers: getCors(req) });

    var { data: booking, error: bErr } = await supabase.from("bookings")
      .select("*, slots(start_time), tours(name)")
      .eq("id", booking_id)
      .single();
    if (bErr || !booking) return new Response(JSON.stringify({ error: "Booking not found" }), { status: 404, headers: getCors(req) });
    if (!booking.yoco_checkout_id) return new Response(JSON.stringify({ error: "No Yoco checkout ID on this booking — manual refund only" }), { status: 400, headers: getCors(req) });

    var tenant = await getTenantByBusinessId(supabase, booking.business_id);
    var brandName = getBusinessDisplayName(tenant.business);
    var refundAmount = amount != null ? Number(amount) : Number(booking.refund_amount || booking.total_amount || 0);
    if (refundAmount <= 0) return new Response(JSON.stringify({ error: "Invalid refund amount" }), { status: 400, headers: getCors(req) });

    var totalAmount = Number(booking.total_amount || 0);
    if (refundAmount > totalAmount) refundAmount = totalAmount;
    var isPartial = refundAmount < totalAmount;

    var refundAmountCents = Math.round(refundAmount * 100);
    var yocoBody: any = {};
    if (isPartial) yocoBody.amount = refundAmountCents;

    var yocoRes = await fetch("https://payments.yoco.com/api/checkouts/" + booking.yoco_checkout_id + "/refund", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + tenant.credentials.yocoSecretKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(yocoBody),
    });

    var yocoData = await yocoRes.json();

    if (!yocoRes.ok || (yocoData.status && yocoData.status !== "successful")) {
      var errMsg = yocoData.displayMessage || yocoData.message || yocoData.errorMessage || JSON.stringify(yocoData);
      await supabase.from("bookings").update({
        refund_status: "FAILED",
        refund_amount: refundAmount,
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

    await supabase.from("bookings").update({
      status: "CANCELLED",
      refund_status: "REFUNDED",
      refund_amount: refundAmount,
      refund_notes: (isPartial ? "Partial" : "Full") + " Yoco refund — " + refundAmount.toFixed(2) + " of " + totalAmount.toFixed(2),
      cancellation_reason: "Auto-cancelled — refund processed by admin",
      cancelled_at: new Date().toISOString(),
    }).eq("id", booking.id);

    await supabase.from("logs").insert({
      business_id: booking.business_id,
      booking_id: booking.id,
      event: "refund_processed",
      payload: { amount: refundAmount, partial: isPartial, yoco_refund: yocoData },
    });

    var ref = booking.id.substring(0, 8).toUpperCase();
    var tourName = booking.tours?.name || "Booking";
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
