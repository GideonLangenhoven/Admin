// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, getTenantByBusinessId, getBusinessDisplayName, sendWhatsappWithWindowReopen, resolveManageBookingsUrl, getAdminAppOrigins, isAllowedOrigin, formatTenantDateTime } from "../_shared/tenant.ts";
import { requireAuth, type AuthResult } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createServiceClient();

function getCors(req?: any) {
  const origins = getAdminAppOrigins();
  const origin = req?.headers?.get("origin") || "";
  const allowed = isAllowedOrigin(origin, origins) ? origin : origins[0];
  return { "Access-Control-Allow-Origin": allowed, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-business-id, x-tenant-subdomain, x-tenant-origin, x-voucher-code, x-booking-success-token, x-booking-id, x-booking-waiver-token", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
}

function canWeatherCancel(auth: AuthResult, businessId: string) {
  if (auth.isServiceRole) return true;
  // SUPER_ADMIN is platform-wide (see roles in .claude/CLAUDE.md) — requiring a
  // business match first 403'd super-admins acting on any tenant but their own.
  if (auth.role === "SUPER_ADMIN") return true;
  return auth.businessId === businessId && auth.role === "MAIN_ADMIN";
}

Deno.serve(async (req: any) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCors(req) });

  try {
    let auth: AuthResult;
    try {
      auth = await requireAuth(req);
    } catch (authErr: any) {
      return new Response(JSON.stringify({ error: authErr?.message || "Unauthorized" }), { status: 401, headers: getCors(req) });
    }

    const body = await req.json();
    let { slot_ids, business_id, booking_ids, reason } = body;

    if (!business_id && !auth.isServiceRole) business_id = auth.businessId;

    if (!business_id) return new Response(JSON.stringify({ error: "business_id required" }), { status: 400, headers: getCors(req) });
    if (!canWeatherCancel(auth, business_id)) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: getCors(req) });

    if ((!Array.isArray(slot_ids) || slot_ids.length === 0) && Array.isArray(booking_ids) && booking_ids.length > 0) {
      const { data: bookingSlots, error: bookingSlotErr } = await supabase
        .from("bookings")
        .select("slot_id")
        .eq("business_id", business_id)
        .in("id", booking_ids)
        .not("slot_id", "is", null);
      if (bookingSlotErr) throw bookingSlotErr;
      slot_ids = [...new Set((bookingSlots || []).map((b: any) => b.slot_id).filter(Boolean))];
    }

    if (!Array.isArray(slot_ids) || slot_ids.length === 0) return new Response(JSON.stringify({ error: "slot_ids array required" }), { status: 400, headers: getCors(req) });

    const tenant = await getTenantByBusinessId(supabase, business_id);
    const brandName = getBusinessDisplayName(tenant.business);
    // This function is the shared "cancel a slot, notify everyone, start the
    // refund flow" backend. It began weather-only; item 20 uses it for a
    // generic operator cancellation too. is_weather defaults to true so every
    // existing weather caller is unchanged; pass is_weather:false for a plain
    // operator cancel (different reason text + email framing, same mechanics).
    const isWeather = body.is_weather !== false;
    const cancelReason = reason || (isWeather ? "weather conditions" : "an operational change");
    const manageBookingUrl = resolveManageBookingsUrl(tenant.business);

    // 1. Close all slots
    await supabase.from("slots").update({ status: "CLOSED" }).eq("business_id", business_id).in("id", slot_ids);

    // 2. Fetch all active bookings on these slots
    const { data: bookings } = await supabase
      .from("bookings")
      .select("id, customer_name, phone, email, qty, total_amount, status, yoco_checkout_id, source, tours(name), slots(start_time), slot_id")
      .eq("business_id", business_id)
      .in("slot_id", slot_ids)
      .in("status", ["PAID", "CONFIRMED", "HELD", "PENDING"]);

    const affected = bookings || [];
    const nowIso = new Date().toISOString();

    // ── Phase 1: Cancel all bookings and compute per-slot capacity deltas ──
    const slotDeltas: Record<string, { booked: number; held: number }> = {};
    const failedCancels: { id: string; error: string }[] = [];
    for (let i = 0; i < affected.length; i++) {
      const b = affected[i] as any;
      const isPaid = ["PAID", "CONFIRMED"].includes(b.status);
      // OTA-sourced bookings (Viator/GetYourGuide): the OTA holds the money,
      // so we can't offer self-service refund/voucher — the customer must go
      // through the OTA. Don't mark ACTION_REQUIRED for them.
      const isOta = String(b.source || "").startsWith("OTA_");
      const refundAmount = isPaid && !isOta ? Number(b.total_amount || 0) : 0;

      // Cancel the booking
      const { error: cancelErr } = await supabase.from("bookings").update({
        status: "CANCELLED",
        cancellation_reason: (isWeather ? "Weather cancellation: " : "Cancelled by operator: ") + cancelReason,
        cancelled_at: nowIso,
        ...(isPaid && refundAmount > 0 ? {
          refund_status: "ACTION_REQUIRED",
          refund_amount: refundAmount,
          refund_notes: "Weather cancellation — customer to choose: reschedule, voucher, or refund via My Bookings",
        } : {}),
      }).eq("business_id", business_id).eq("id", b.id);

      // If the cancel did not persist (e.g. a DB trigger rejected it), the booking
      // is still active — do NOT release its capacity or notify, and surface it so
      // a PAID booking never silently survives on a CLOSED slot.
      if (cancelErr) {
        console.error("WEATHER_CANCEL_BOOKING_ERR", b.id, cancelErr.message);
        failedCancels.push({ id: b.id, error: cancelErr.message });
        continue;
      }

      // Accumulate capacity deltas per slot (avoids read-then-write race)
      if (!slotDeltas[b.slot_id]) slotDeltas[b.slot_id] = { booked: 0, held: 0 };
      slotDeltas[b.slot_id].booked += Number(b.qty || 0);
      if (b.status === "HELD") slotDeltas[b.slot_id].held += Number(b.qty || 0);

      // Cancel any active holds
      await supabase.from("holds").update({ status: "CANCELLED" }).eq("business_id", business_id).eq("booking_id", b.id).eq("status", "ACTIVE");
    }

    const failedIds = new Set(failedCancels.map((f) => f.id));

    // ── Phase 2: Release slot capacity in one atomic update per slot ──
    for (const slotId of Object.keys(slotDeltas)) {
      const delta = slotDeltas[slotId];
      const rpcRes = await supabase.rpc("adjust_slot_capacity", {
        p_slot_id: slotId,
        p_business_id: business_id,
        p_booked_delta: -delta.booked,
        p_held_delta: -delta.held,
      });
      if (rpcRes.error) {
        const { data: slotData } = await supabase.from("slots").select("booked, held").eq("business_id", business_id).eq("id", slotId).maybeSingle();
        if (slotData) {
          await supabase.from("slots").update({
            booked: Math.max(0, (slotData.booked || 0) - delta.booked),
            held: Math.max(0, (slotData.held || 0) - delta.held),
          }).eq("business_id", business_id).eq("id", slotId);
        }
      }
    }

    // ── Phase 3: Send notifications (after all DB state is consistent) ──
    for (let i = 0; i < affected.length; i++) {
      const b = affected[i] as any;
      if (failedIds.has(b.id)) continue;
      const isPaid = ["PAID", "CONFIRMED"].includes(b.status);
      const isOta = String(b.source || "").startsWith("OTA_");
      const refundAmount = isPaid && !isOta ? Number(b.total_amount || 0) : 0;
      const ref = b.id.substring(0, 8).toUpperCase();
      const tourName = b.tours?.name || "Tour";
      const startTime = b.slots?.start_time
        ? formatTenantDateTime(tenant.business, b.slots.start_time, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
        : "";

      // WhatsApp notification — paid customers get compensation options, unpaid get simple notice
      if (b.phone) {
        try {
          const firstName = b.customer_name?.split(" ")[0] || "there";
          const waMessage = isPaid && isOta
            ? "Trip Cancelled \u26C5\n\n" +
              "Hi " + firstName + ", we\u2019re sorry but your " + tourName + " on " + startTime +
              " has been cancelled due to " + cancelReason + ".\n\n" +
              "Ref: " + ref + "\n\n" +
              "You booked through a travel platform (e.g. Viator/GetYourGuide) \u2014 they will handle your refund or rebooking. Please contact them directly.\n\n" +
              ((tenant.business as any).location_phrase ? "We hope to see you " + (tenant.business as any).location_phrase + " soon \u2014 " : "We hope to see you again soon \u2014 ") + brandName
            : isPaid
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

      // Email notification — always attempted alongside WhatsApp; log the
      // outcome either way so a missing email is diagnosable from logs.
      if (b.email) {
        try {
          const emailRes = await fetch(SUPABASE_URL + "/functions/v1/send-email", {
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
                is_weather: isWeather,
                is_unpaid: !isPaid,
              },
            }),
          });
          console.log("CANCEL_EMAIL", b.id, emailRes.status, await emailRes.text().catch(() => ""));
        } catch (e) { console.error("Email weather-cancel err:", e); }
      } else {
        console.warn("CANCEL_EMAIL_SKIP no email on booking", b.id);
      }
    }

    // Log the operation
    await supabase.from("logs").insert({
      business_id,
      event: "weather_cancel",
      payload: {
        slot_ids,
        reason: cancelReason,
        bookings_cancelled: affected.length - failedCancels.length,
        paid_action_required: affected.filter((b: any) => ["PAID", "CONFIRMED"].includes(b.status) && !failedIds.has(b.id)).length,
        failed_cancels: failedCancels,
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      slots_closed: slot_ids.length,
      bookings_cancelled: affected.length - failedCancels.length,
      failed_cancels: failedCancels,
    }), { status: 200, headers: getCors(req) });
  } catch (err: any) {
    console.error("WEATHER_CANCEL_ERROR:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: getCors(req) });
  }
});
