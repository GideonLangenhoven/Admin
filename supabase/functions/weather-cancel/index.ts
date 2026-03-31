import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, getTenantByBusinessId, getBusinessDisplayName, sendWhatsappTextForTenant, getAdminAppOrigins, formatTenantDateTime } from "../_shared/tenant.ts";

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
    var { slot_ids, business_id, reason } = body;

    if (!business_id) return new Response(JSON.stringify({ error: "business_id required" }), { status: 400, headers: getCors(req) });
    if (!Array.isArray(slot_ids) || slot_ids.length === 0) return new Response(JSON.stringify({ error: "slot_ids array required" }), { status: 400, headers: getCors(req) });

    var tenant = await getTenantByBusinessId(supabase, business_id);
    var brandName = getBusinessDisplayName(tenant.business);
    var cancelReason = reason || "weather conditions";
    var manageBookingUrl = tenant.business.manage_bookings_url || "https://book.capekayak.co.za/my-bookings";

    // 1. Close all slots
    await supabase.from("slots").update({ status: "CLOSED" }).in("id", slot_ids);

    // 2. Fetch all active bookings on these slots
    var { data: bookings } = await supabase
      .from("bookings")
      .select("id, customer_name, phone, email, qty, total_amount, status, yoco_checkout_id, tours(name), slots(start_time), slot_id")
      .eq("business_id", business_id)
      .in("slot_id", slot_ids)
      .in("status", ["PAID", "CONFIRMED", "HELD", "PENDING"]);

    var affected = bookings || [];

    for (var i = 0; i < affected.length; i++) {
      var b = affected[i] as any;
      var isPaid = ["PAID", "CONFIRMED"].includes(b.status);
      var refundAmount = isPaid ? Number(b.total_amount || 0) : 0;

      // Cancel the booking
      await supabase.from("bookings").update({
        status: "CANCELLED",
        cancellation_reason: "Weather cancellation: " + cancelReason,
        cancelled_at: new Date().toISOString(),
        ...(isPaid && refundAmount > 0 ? {
          refund_status: "ACTION_REQUIRED",
          refund_amount: refundAmount,
          refund_notes: "Weather cancellation — customer to choose: reschedule, voucher, or refund via My Bookings",
        } : {}),
      }).eq("id", b.id);

      // Release slot capacity
      var slotData = await supabase.from("slots").select("booked, held").eq("id", b.slot_id).single();
      if (slotData.data) {
        await supabase.from("slots").update({
          booked: Math.max(0, slotData.data.booked - b.qty),
          held: Math.max(0, (slotData.data.held || 0) - (b.status === "HELD" ? b.qty : 0)),
        }).eq("id", b.slot_id);
      }

      // Cancel any active holds
      await supabase.from("holds").update({ status: "CANCELLED" }).eq("booking_id", b.id).eq("status", "ACTIVE");

      var ref = b.id.substring(0, 8).toUpperCase();
      var tourName = b.tours?.name || "Tour";
      var startTime = b.slots?.start_time
        ? formatTenantDateTime(tenant.business, b.slots.start_time, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
        : "";

      // WhatsApp notification — paid customers get compensation options, unpaid get simple notice
      if (b.phone) {
        try {
          var waMessage = isPaid
            ? "Trip Cancelled — Weather\n\n" +
              "Hi " + (b.customer_name?.split(" ")[0] || "there") + ", unfortunately your " + tourName + " on " + startTime +
              " has been cancelled due to " + cancelReason + ".\n\n" +
              "Ref: " + ref + "\n\n" +
              "Visit your My Bookings page to reschedule, get a voucher, or request a refund:\n" +
              manageBookingUrl + "\n\n" +
              "Thanks for your understanding — " + brandName
            : "Trip Cancelled — Weather\n\n" +
              "Hi " + (b.customer_name?.split(" ")[0] || "there") + ", unfortunately your " + tourName + " on " + startTime +
              " has been cancelled due to " + cancelReason + ".\n\n" +
              "Ref: " + ref + "\n\n" +
              "No payment was taken so no further action is needed.\n\n" +
              "Thanks for your understanding — " + brandName;
          await sendWhatsappTextForTenant(tenant, b.phone, waMessage);
        } catch (e) { console.error("WA weather-cancel err:", e); }
      }

      // Email notification
      if (b.email) {
        try {
          await fetch(SUPABASE_URL + "/functions/v1/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
            body: JSON.stringify({
              type: "CANCELLATION",
              data: {
                business_id,
                email: b.email,
                customer_name: b.customer_name || "Guest",
                ref,
                tour_name: tourName,
                start_time: startTime,
                reason: cancelReason,
                total_amount: isPaid && refundAmount > 0 ? refundAmount : null,
                is_weather: true,
                is_unpaid: !isPaid,
              },
            }),
          });
        } catch (e) { console.error("Email weather-cancel err:", e); }
      }
    }

    // Log the operation
    await supabase.from("logs").insert({
      business_id,
      event: "weather_cancel",
      payload: {
        slot_ids,
        reason: cancelReason,
        bookings_cancelled: affected.length,
        paid_action_required: affected.filter((b: any) => ["PAID", "CONFIRMED"].includes(b.status)).length,
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      slots_closed: slot_ids.length,
      bookings_cancelled: affected.length,
    }), { status: 200, headers: getCors(req) });
  } catch (err: any) {
    console.error("WEATHER_CANCEL_ERROR:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: getCors(req) });
  }
});
