import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, getTenantByBusinessId, getBusinessDisplayName, sendWhatsappWithWindowReopen, resolveManageBookingsUrl, getAdminAppOrigins, isAllowedOrigin, formatTenantDateTime } from "../_shared/tenant.ts";

var SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
var SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
var supabase = createServiceClient();

function getCors(req?: any) {
  var origins = getAdminAppOrigins();
  var origin = req?.headers?.get("origin") || "";
  var allowed = isAllowedOrigin(origin, origins) ? origin : origins[0];
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
    var manageBookingUrl = resolveManageBookingsUrl(tenant.business);

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
    var nowIso = new Date().toISOString();

    // ── Phase 1: Cancel all bookings and compute per-slot capacity deltas ──
    var slotDeltas: Record<string, { booked: number; held: number }> = {};
    for (var i = 0; i < affected.length; i++) {
      var b = affected[i] as any;
      var isPaid = ["PAID", "CONFIRMED"].includes(b.status);
      var refundAmount = isPaid ? Number(b.total_amount || 0) : 0;

      // Cancel the booking
      await supabase.from("bookings").update({
        status: "CANCELLED",
        cancellation_reason: "Weather cancellation: " + cancelReason,
        cancelled_at: nowIso,
        ...(isPaid && refundAmount > 0 ? {
          refund_status: "ACTION_REQUIRED",
          refund_amount: refundAmount,
          refund_notes: "Weather cancellation — customer to choose: reschedule, voucher, or refund via My Bookings",
        } : {}),
      }).eq("id", b.id);

      // Accumulate capacity deltas per slot (avoids read-then-write race)
      if (!slotDeltas[b.slot_id]) slotDeltas[b.slot_id] = { booked: 0, held: 0 };
      slotDeltas[b.slot_id].booked += Number(b.qty || 0);
      if (b.status === "HELD") slotDeltas[b.slot_id].held += Number(b.qty || 0);

      // Cancel any active holds
      await supabase.from("holds").update({ status: "CANCELLED" }).eq("booking_id", b.id).eq("status", "ACTIVE");
    }

    // ── Phase 2: Release slot capacity in one atomic update per slot ──
    for (var slotId of Object.keys(slotDeltas)) {
      var delta = slotDeltas[slotId];
      var { data: slotData } = await supabase.from("slots").select("booked, held").eq("id", slotId).maybeSingle();
      if (slotData) {
        await supabase.from("slots").update({
          booked: Math.max(0, (slotData.booked || 0) - delta.booked),
          held: Math.max(0, (slotData.held || 0) - delta.held),
        }).eq("id", slotId);
      }
    }

    // ── Phase 3: Send notifications (after all DB state is consistent) ──
    for (var i = 0; i < affected.length; i++) {
      var b = affected[i] as any;
      var isPaid = ["PAID", "CONFIRMED"].includes(b.status);
      var refundAmount = isPaid ? Number(b.total_amount || 0) : 0;
      var ref = b.id.substring(0, 8).toUpperCase();
      var tourName = b.tours?.name || "Tour";
      var startTime = b.slots?.start_time
        ? formatTenantDateTime(tenant.business, b.slots.start_time, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
        : "";

      // WhatsApp notification — paid customers get compensation options, unpaid get simple notice
      if (b.phone) {
        try {
          var firstName = b.customer_name?.split(" ")[0] || "there";
          var waMessage = isPaid
            ? "Trip Cancelled \u26C5\n\n" +
              "Hi " + firstName + ", we\u2019re sorry but your " + tourName + " on " + startTime +
              " has been cancelled due to " + cancelReason + ".\n\n" +
              "Ref: " + ref + "\n\n" +
              "You can reschedule, get a voucher, or request a full refund from your bookings page:\n" +
              manageBookingUrl + "\n\n" +
              ((tenant.business as any).location_phrase ? "We hope to see you " + (tenant.business as any).location_phrase + " soon \u2014 " : "We hope to see you again soon \u2014 ") + brandName
            : "Trip Cancelled \u26C5\n\n" +
              "Hi " + firstName + ", we\u2019re sorry but your " + tourName + " on " + startTime +
              " has been cancelled due to " + cancelReason + ".\n\n" +
              "Ref: " + ref + "\n\n" +
              "No payment was taken, so no action is needed on your side.\n\n" +
              ((tenant.business as any).location_phrase ? "We hope to see you " + (tenant.business as any).location_phrase + " soon \u2014 " : "We hope to see you again soon \u2014 ") + brandName;
          // Two-step flow: if 24h window is closed, send reopener template and queue
          // the full cancellation message for drain on next customer reply.
          await sendWhatsappWithWindowReopen(supabase, tenant, {
            to: b.phone,
            booking_id: b.id,
            full_message: waMessage,
            customer_first_name: firstName,
          });
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
