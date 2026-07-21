// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createServiceClient,
  getTenantByBusinessId,
  getBusinessDisplayName,
  sendWhatsappWithWindowReopen,
  resolveManageBookingsUrl,
  getAdminAppOrigins,
  isAllowedOrigin,
  formatTenantDateTime,
} from "../_shared/tenant.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createServiceClient();

function getCors(req?: any) {
  const origins = getAdminAppOrigins();
  const origin = req?.headers?.get("origin") || "";
  const allowed = isAllowedOrigin(origin, origins) ? origin : origins[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-business-id, x-tenant-subdomain, x-tenant-origin, x-voucher-code, x-booking-success-token, x-booking-id, x-booking-waiver-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

/**
 * Verify the caller is an authenticated admin and return their business_id + role.
 * Returns null on any failure (missing header, invalid token, no admin row, suspended).
 */
async function verifyAdminSession(req: any) {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  try {
    const { data: userRes, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !userRes?.user) return null;
    const { data: admin } = await supabase
      .from("admin_users")
      .select("id, business_id, role, suspended")
      .eq("user_id", userRes.user.id)
      .maybeSingle();
    if (!admin || admin.suspended) return null;
    return {
      user_id: userRes.user.id as string,
      business_id: admin.business_id as string,
      role: admin.role as string,
    };
  } catch {
    return null;
  }
}

/**
 * POST /functions/v1/cancel-booking
 *
 * Atomically cancels a single booking: status → CANCELLED, holds → CANCELLED,
 * slot counters released. If the booking was PAID/CONFIRMED, sets
 * refund_status = ACTION_REQUIRED so the customer chooses their preferred
 * compensation (reschedule / voucher / refund) from /my-bookings.
 *
 * 24h forfeit rule: if the cancellation happens within 24 hours of the trip
 * start, the customer forfeits the booking (no compensation choice) unless
 * the admin passes allow_late_choice: true to grant it anyway.
 *
 * Customer notification uses the two-step WhatsApp flow (reopener template +
 * queued full message when the 24h service window is closed) — see
 * sendWhatsappWithWindowReopen in _shared/tenant.ts.
 *
 * Requires: Authorization: Bearer <admin_access_token>. The authenticated
 * admin's business_id must match the booking's business_id — unless they
 * are SUPER_ADMIN, who may cancel any booking.
 *
 * Body: { booking_id: uuid, reason?: string }
 * Returns: { ok: true, booking_id, refund_action_required, refund_amount }
 */
Deno.serve(async (req: any) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCors(req) });

  try {
    const body = await req.json().catch(() => ({}));
    const { booking_id, reason, allow_late_choice } = body as { booking_id?: string; reason?: string; allow_late_choice?: boolean };

    if (!booking_id) {
      return new Response(JSON.stringify({ error: "booking_id required" }), { status: 400, headers: getCors(req) });
    }

    const session = await verifyAdminSession(req);
    if (!session) {
      return new Response(JSON.stringify({ error: "Admin session required" }), { status: 401, headers: getCors(req) });
    }

    const { data: booking, error: loadErr } = await supabase
      .from("bookings")
      .select("id, business_id, customer_name, phone, email, qty, total_amount, status, slot_id, yoco_checkout_id, tours(name), slots(start_time)")
      .eq("id", booking_id)
      .maybeSingle();

    if (loadErr || !booking) {
      return new Response(JSON.stringify({ error: "Booking not found" }), { status: 404, headers: getCors(req) });
    }

    // Tenant guard: non-super admins can only cancel their own tenant's bookings
    if (!/super/i.test(session.role || "") && session.business_id !== booking.business_id) {
      return new Response(JSON.stringify({ error: "You can only cancel bookings for your own business" }), { status: 403, headers: getCors(req) });
    }

    if (booking.status === "CANCELLED") {
      return new Response(JSON.stringify({ error: "Booking is already cancelled" }), { status: 400, headers: getCors(req) });
    }

    const tenant = await getTenantByBusinessId(supabase, booking.business_id);
    const brandName = getBusinessDisplayName(tenant.business);
    const cancelReason = String(reason || "Cancelled by admin").trim() || "Cancelled by admin";
    const manageBookingUrl = resolveManageBookingsUrl(tenant.business);
    const isPaid = ["PAID", "CONFIRMED"].includes(booking.status);
    const refundAmount = isPaid ? Number(booking.total_amount || 0) : 0;
    const nowIso = new Date().toISOString();

    // 24h forfeit rule: a cancellation within 24 hours of the trip start (or
    // after it) forfeits the booking — no reschedule/voucher/refund choice —
    // unless the admin explicitly grants it via allow_late_choice.
    const slotStartIso = (booking as any).slots?.start_time as string | undefined;
    const isLate = !!slotStartIso && new Date(slotStartIso).getTime() - Date.now() < 24 * 60 * 60 * 1000;
    const offerChoice = isPaid && refundAmount > 0 && (!isLate || allow_late_choice === true);
    const isForfeit = isPaid && refundAmount > 0 && !offerChoice;

    // Update booking row (mirrors weather-cancel's refund_status=ACTION_REQUIRED pattern)
    const { error: updErr } = await supabase.from("bookings").update({
      status: "CANCELLED",
      cancellation_reason: cancelReason,
      cancelled_at: nowIso,
      ...(offerChoice ? {
        refund_status: "ACTION_REQUIRED",
        refund_amount: refundAmount,
        refund_notes: "Admin cancellation. Customer to choose: reschedule, voucher, or refund via My Bookings",
      } : {}),
      ...(isForfeit ? {
        refund_notes: "Cancelled within 24h of trip start. Booking forfeited per cancellation policy",
      } : {}),
    }).eq("id", booking_id);

    if (updErr) {
      return new Response(JSON.stringify({ error: "Failed to update booking: " + updErr.message }), { status: 500, headers: getCors(req) });
    }

    // Cancel any active holds
    await supabase.from("holds").update({ status: "CANCELLED" }).eq("booking_id", booking_id).eq("status", "ACTIVE");

    // Release slot capacity (atomic single update)
    if (booking.slot_id) {
      // S3: atomic RPC, no read-modify-write
      const qty = Number(booking.qty || 0);
      await supabase.rpc("adjust_slot_capacity", {
        p_slot_id: booking.slot_id,
        p_business_id: booking.business_id,
        p_booked_delta: -qty,
        p_held_delta: booking.status === "HELD" ? -qty : 0,
      });
    }

    const ref = String(booking_id).substring(0, 8).toUpperCase();
    const tourName = (booking as any).tours?.name || "Tour";
    const startTime = (booking as any).slots?.start_time
      ? formatTenantDateTime(tenant.business, (booking as any).slots.start_time, {
          weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
        })
      : "";

    // WhatsApp notification — two-step flow if 24h window is closed
    if (booking.phone) {
      try {
        const firstName = String(booking.customer_name || "").split(" ")[0] || "there";
        const waMessage = offerChoice
          ? "Booking Cancelled\n\n" +
            "Hi " + firstName + ", your " + tourName + (startTime ? " on " + startTime : "") +
            " has been cancelled.\n\n" +
            "Reason: " + cancelReason + "\n" +
            "Ref: " + ref + "\n\n" +
            "You can reschedule, get a voucher, or request a full refund from your bookings page:\n" +
            manageBookingUrl + "\n\n" +
            "We're sorry for the inconvenience. " + brandName
          : isForfeit
          ? "Booking Cancelled\n\n" +
            "Hi " + firstName + ", your " + tourName + (startTime ? " on " + startTime : "") +
            " has been cancelled.\n\n" +
            "Reason: " + cancelReason + "\n" +
            "Ref: " + ref + "\n\n" +
            "As the cancellation is within 24 hours of the trip start, the booking amount is forfeited per our cancellation policy. If you have any questions, just reply to this message.\n\n" +
            brandName
          : "Booking Cancelled\n\n" +
            "Hi " + firstName + ", your " + tourName + (startTime ? " on " + startTime : "") +
            " has been cancelled.\n\n" +
            "Reason: " + cancelReason + "\n" +
            "Ref: " + ref + "\n\n" +
            "No payment was taken, so no action is needed.\n\n" +
            "Thanks. " + brandName;

        await sendWhatsappWithWindowReopen(supabase, tenant, {
          to: booking.phone,
          booking_id: booking_id,
          full_message: waMessage,
          customer_first_name: firstName,
        });
      } catch (waErr: any) {
        console.error("cancel-booking WA err:", waErr?.message || waErr);
      }
    }

    // Email notification (independent from WA — always attempted)
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
              customer_name: booking.customer_name || "Guest",
              ref,
              tour_name: tourName,
              start_time: startTime,
              reason: cancelReason,
              total_amount: isPaid && refundAmount > 0 ? refundAmount : null,
              is_weather: false,
              is_unpaid: !isPaid,
              is_forfeit: isForfeit,
              // Only the offer-choice cancel re-offers reschedule/voucher/refund.
              offer_choice: offerChoice,
            },
          }),
        });
      } catch (emailErr: any) {
        console.error("cancel-booking email err:", emailErr?.message || emailErr);
      }
    }

    // Audit log — best-effort; PostgREST builders have no .catch, so await
    // and inspect the error instead (the old .catch() threw a TypeError that
    // turned every successful cancellation into a 500 response).
    const { error: logErr } = await supabase.from("logs").insert({
      business_id: booking.business_id,
      booking_id: booking_id,
      event: "booking_cancelled",
      payload: {
        admin_user_id: session.user_id,
        admin_business_id: session.business_id,
        admin_role: session.role,
        reason: cancelReason,
        was_paid: isPaid,
        refund_amount_action_required: offerChoice ? refundAmount : 0,
        late_forfeit: isForfeit,
        allow_late_choice: allow_late_choice === true,
      },
    });
    if (logErr) console.error("LOG_ERR:", logErr.message);

    return new Response(JSON.stringify({
      ok: true,
      booking_id,
      refund_action_required: offerChoice,
      refund_amount: offerChoice ? refundAmount : 0,
      late_forfeit: isForfeit,
    }), { status: 200, headers: getCors(req) });

  } catch (err: any) {
    console.error("CANCEL_BOOKING_ERROR:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: getCors(req) });
  }
});
