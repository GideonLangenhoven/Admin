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
    const closed = await supabase.from("slots").update({ status: "CLOSED" }).eq("business_id", business_id).in("id", slot_ids);
    if (closed.error) throw closed.error;

    // 2. Fetch all active bookings on these slots
    const { data: bookings, error: bookingsError } = await supabase
      .from("bookings")
      .select("id, customer_name, phone, email, qty, total_amount, voucher_amount_paid, original_total, converted_to_voucher_id, status, yoco_checkout_id, source, tours(name), slots(start_time), slot_id")
      .eq("business_id", business_id)
      .in("slot_id", slot_ids)
      .in("status", ["PAID", "CONFIRMED", "HELD", "PENDING", "PENDING PAYMENT"]);

    if (bookingsError) throw bookingsError;
    const affected = bookings || [];
    const failedCancels: { id: string; error: string }[] = [];
    const outcomes = new Map<string, any>();
    for (const b of affected) {
      const cancelled = await supabase.rpc("cancel_booking_transaction", {
        p_booking_id: b.id, p_business_id: business_id,
        p_reason: (isWeather ? "Weather cancellation: " : "Cancelled by operator: ") + cancelReason,
        p_allow_late_choice: true, p_weather: true,
      });
      if (cancelled.error || !cancelled.data?.ok) {
        failedCancels.push({ id: b.id, error: cancelled.data?.error || cancelled.error?.message || "Cancellation failed" });
      } else outcomes.set(b.id, cancelled.data);
    }
    const failedIds = new Set(failedCancels.map(f => f.id));

    // ── Phase 3: Send notifications (after all DB state is consistent) ──
    // `notified` counts successful sends (one per channel), which the Broadcasts
    // page surfaces and logs as the broadcast's sent_count.
    let notified = 0;
    for (let i = 0; i < affected.length; i++) {
      const b = affected[i] as any;
      if (failedIds.has(b.id) || outcomes.get(b.id)?.already_cancelled) continue;
      const isPaid = ["PAID", "CONFIRMED"].includes(b.status);
      const isOta = String(b.source || "").startsWith("OTA_");
      const refundAmount = Number(outcomes.get(b.id)?.refund_amount || 0);
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
              "You booked through a travel platform (e.g. Viator/GetYourGuide). They will handle your refund or rebooking. Please contact them directly.\n\n" +
              ((tenant.business as any).location_phrase ? "We hope to see you " + (tenant.business as any).location_phrase + " soon. " : "We hope to see you again soon. ") + brandName
            : refundAmount > 0
            ? "Trip Cancelled \u26C5\n\n" +
              "Hi " + firstName + ", we\u2019re sorry but your " + tourName + " on " + startTime +
              " has been cancelled due to " + cancelReason + ".\n\n" +
              "Ref: " + ref + "\n\n" +
              "You can reschedule, get a voucher, or request a full refund from your bookings page:\n" +
              manageBookingUrl + "\n\n" +
              ((tenant.business as any).location_phrase ? "We hope to see you " + (tenant.business as any).location_phrase + " soon. " : "We hope to see you again soon. ") + brandName
            : "Trip Cancelled \u26C5\n\n" +
              "Hi " + firstName + ", we\u2019re sorry but your " + tourName + " on " + startTime +
              " has been cancelled due to " + cancelReason + ".\n\n" +
              "Ref: " + ref + "\n\n" +
              "No payment was taken, so no action is needed on your side.\n\n" +
              ((tenant.business as any).location_phrase ? "We hope to see you " + (tenant.business as any).location_phrase + " soon. " : "We hope to see you again soon. ") + brandName;
          // Two-step flow: if 24h window is closed, send reopener template and queue
          // the full cancellation message for drain on next customer reply.
          await sendWhatsappWithWindowReopen(supabase, tenant, {
            to: b.phone,
            booking_id: b.id,
            full_message: waMessage,
            customer_first_name: firstName,
          });
          notified++;
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
                offer_choice: refundAmount > 0,
                is_ota: isOta,
              },
            }),
          });
          console.log("CANCEL_EMAIL", b.id, emailRes.status, await emailRes.text().catch(() => ""));
          if (emailRes.ok) notified++;
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

    // Opt-in broadcast-history row. The Broadcasts page shows weather
    // cancellations in its history feed; recorded here rather than client-side
    // so that page keeps no direct table writes. Best-effort: a failure here
    // must not fail a cancellation that already happened.
    if (body.log_broadcast) {
      try {
        await supabase.from("broadcasts").insert({
          business_id,
          message: (isWeather ? "⛈ Weather cancellation: " : "Cancelled by operator: ") + cancelReason,
          target_group: "AFFECTED_BOOKINGS",
          sent_count: notified,
        });
      } catch (e) { console.error("WEATHER_CANCEL_BROADCAST_LOG_ERR:", e); }
    }

    return new Response(JSON.stringify({
      ok: failedCancels.length === 0,
      slots_closed: slot_ids.length,
      bookings_cancelled: affected.length - failedCancels.length,
      notified,
      failed_cancels: failedCancels,
    }), { status: failedCancels.length ? 409 : 200, headers: getCors(req) });
  } catch (err: any) {
    console.error("WEATHER_CANCEL_ERROR:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: getCors(req) });
  }
});
