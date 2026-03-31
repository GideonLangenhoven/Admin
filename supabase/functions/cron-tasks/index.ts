import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, formatTenantDateTime, getTenantByBusinessId, sendWhatsappTextForTenant } from "../_shared/tenant.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createServiceClient();

function headers() {
  return { "Content-Type": "application/json" };
}

async function cleanupExpiredHolds() {
  const results = { hold_cleanup: 0, skipped_paid: 0, reschedule_hold_cleanup: 0 };
  // Grace period: only expire holds 5 minutes AFTER their expires_at timestamp.
  // Holds are set to expire at created_at + 15 min, but we wait an extra 5 min
  // (total 20 min) before releasing. This prevents the race condition where the
  // cron releases spots seconds before Yoco’s webhook arrives with a payment.
  const graceMs = 5 * 60 * 1000;
  const cutoffIso = new Date(Date.now() - graceMs).toISOString();
  const { data: expiredHolds } = await supabase
    .from("holds")
    .select("id, booking_id, slot_id, business_id, hold_type, bookings(phone, qty, status, yoco_payment_id), slots(start_time), tours(name)")
    .eq("status", "ACTIVE")
    .lt("expires_at", cutoffIso);

  for (const hold of expiredHolds || []) {
    // Check if the booking has already been paid — if so, convert the hold
    // instead of expiring it. This handles the case where a webhook arrived
    // but the hold wasn’t converted yet (or a manual mark-paid happened).
    const bookingStatus = (hold.bookings as any)?.status;
    const hasPaid = (hold.bookings as any)?.yoco_payment_id;
    if (bookingStatus === "PAID" || bookingStatus === "COMPLETED" || hasPaid) {
      // For reschedule holds, check if the pending_reschedule was already completed
      if ((hold as any).hold_type === "RESCHEDULE") {
        const { data: prCheck } = await supabase
          .from("pending_reschedules")
          .select("id, status")
          .eq("hold_id", hold.id)
          .single();
        if (prCheck && prCheck.status === "COMPLETED") {
          await supabase.from("holds").update({ status: "CONVERTED" }).eq("id", hold.id);
          console.log("RESCHEDULE_HOLD_EXPIRY_SKIP_COMPLETED hold=" + hold.id);
          results.skipped_paid += 1;
          continue;
        }
      }
      await supabase.from("holds").update({ status: "CONVERTED" }).eq("id", hold.id);
      console.log("HOLD_EXPIRY_SKIP_PAID hold=" + hold.id + " booking=" + hold.booking_id + " status=" + bookingStatus);
      results.skipped_paid += 1;
      continue;
    }

    await supabase.from("holds").update({ status: "EXPIRED" }).eq("id", hold.id);

    // ── RESCHEDULE hold expiry: cancel the pending reschedule, release new slot hold, keep original booking intact ──
    if ((hold as any).hold_type === "RESCHEDULE") {
      const { data: pendingReschedules } = await supabase
        .from("pending_reschedules")
        .select("id, booking_id, new_slot_id, business_id")
        .eq("hold_id", hold.id)
        .eq("status", "PENDING");

      for (const pr of pendingReschedules || []) {
        await supabase.from("pending_reschedules").update({
          status: "EXPIRED",
          expired_at: cutoffIso,
        }).eq("id", pr.id);

        // Release held capacity on the new slot
        const qty = (hold.bookings as any)?.qty || 0;
        if (qty > 0) {
          const slotData = await supabase.from("slots").select("held").eq("id", pr.new_slot_id).single();
          if (slotData.data) {
            await supabase.from("slots").update({
              held: Math.max(0, (slotData.data.held || 0) - qty),
            }).eq("id", pr.new_slot_id);
          }
        }

        await supabase.from("logs").insert({
          business_id: pr.business_id,
          booking_id: pr.booking_id,
          event: "reschedule_upgrade_expired",
          payload: { hold_id: hold.id, pending_reschedule_id: pr.id },
        });
      }

      console.log("RESCHEDULE_HOLD_EXPIRED hold=" + hold.id + " booking=" + hold.booking_id);
      results.reschedule_hold_cleanup += 1;
      results.hold_cleanup += 1;
      // No WhatsApp notification — original booking stays intact
      continue;
    }

    // ── Regular booking hold expiry ──
    if (hold.bookings?.phone && hold.business_id) {
      try {
        const tenant = await getTenantByBusinessId(supabase, hold.business_id);
        const slotLabel = hold.slots?.start_time ? formatTenantDateTime(tenant.business, hold.slots.start_time) : "your selected slot";
        const message =
          "Your held booking for " + (hold.tours?.name || "the experience") + " at " + slotLabel + " has expired.\n\n" +
          "If you still want those spots, start a new booking and we’ll help from there.";
        await sendWhatsappTextForTenant(tenant, hold.bookings.phone, message);
      } catch (error) {
        console.error("HOLD_EXPIRY_WA_ERR", hold.id, error);
      }
    }
    results.hold_cleanup += 1;
  }

  return results;
}

async function cleanupExpiredManualBookings() {
  const results = { expired_manual: 0 };

  // Find PENDING bookings with a payment_deadline that has passed
  const { data: expiredBookings } = await supabase
    .from("bookings")
    .select("id, slot_id, qty, business_id, customer_name, phone, email, tours(name), slots(start_time)")
    .eq("status", "PENDING")
    .eq("source", "ADMIN")
    .not("payment_deadline", "is", null)
    .lt("payment_deadline", new Date().toISOString());

  for (const booking of expiredBookings || []) {
    // Cancel the booking
    await supabase.from("bookings").update({
      status: "CANCELLED",
      cancellation_reason: "Auto-cancelled: payment deadline exceeded",
      cancelled_at: new Date().toISOString(),
    }).eq("id", booking.id);

    // Release the capacity (decrement slot.booked)
    const { data: slotData } = await supabase.from("slots").select("booked").eq("id", booking.slot_id).single();
    if (slotData) {
      await supabase.from("slots").update({
        booked: Math.max(0, (slotData.booked || 0) - booking.qty),
      }).eq("id", booking.slot_id);
    }

    // Log the expiry
    await supabase.from("logs").insert({
      business_id: booking.business_id,
      booking_id: booking.id,
      event: "manual_booking_deadline_expired",
      payload: {
        customer_name: booking.customer_name,
        tour_name: (booking.tours as any)?.name || null,
        slot_time: (booking.slots as any)?.start_time || null,
        qty: booking.qty,
      },
    });

    // Send admin notification via WhatsApp
    try {
      const tenant = await getTenantByBusinessId(supabase, booking.business_id);
      const slotLabel = (booking.slots as any)?.start_time
        ? formatTenantDateTime(tenant.business, (booking.slots as any).start_time)
        : "unknown slot";
      const tourName = (booking.tours as any)?.name || "Booking";
      const ref = booking.id.substring(0, 8).toUpperCase();

      // Notify admin (operator email lookup)
      const { data: adminUser } = await supabase
        .from("admin_users")
        .select("phone")
        .eq("business_id", booking.business_id)
        .eq("role", "MAIN_ADMIN")
        .limit(1)
        .maybeSingle();

      if (adminUser?.phone) {
        await sendWhatsappTextForTenant(tenant, adminUser.phone,
          "Manual booking expired\n\n" +
          "Ref: " + ref + "\n" +
          tourName + " — " + slotLabel + "\n" +
          "Customer: " + (booking.customer_name || "Unknown") + "\n" +
          booking.qty + " spot" + (booking.qty === 1 ? "" : "s") + " released.\n\n" +
          "Payment was not received before the deadline."
        );
      }
    } catch (notifyErr) {
      console.error("MANUAL_BOOKING_EXPIRY_NOTIFY_ERR", booking.id, notifyErr);
    }

    results.expired_manual += 1;
  }

  return results;
}

async function cleanupAbandonedVouchers() {
  const results = { vouchers_cleaned: 0 };

  // Delete PENDING vouchers older than 24 hours (abandoned checkout flows)
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: abandoned } = await supabase
    .from("vouchers")
    .select("id")
    .eq("status", "PENDING")
    .lt("created_at", cutoff);

  if (abandoned && abandoned.length > 0) {
    const ids = abandoned.map((v: any) => v.id);
    await supabase.from("vouchers").delete().in("id", ids);
    results.vouchers_cleaned = ids.length;
    console.log("VOUCHER_CLEANUP: deleted " + ids.length + " abandoned PENDING vouchers");
  }

  return results;
}

Deno.serve(async (_req) => {
  const results: any = { reminders: null, hold_cleanup: 0, expired_manual: 0, vouchers_cleaned: 0, errors: [] };

  try {
    const reminderRes = await fetch(SUPABASE_URL + "/functions/v1/auto-messages", {
      method: "POST",
      headers: { ...headers(), Authorization: "Bearer " + SUPABASE_KEY },
      body: JSON.stringify({ action: "all" }),
    });
    results.reminders = await reminderRes.json().catch(() => null);
  } catch (error) {
    console.error("AUTO_MESSAGES_INVOKE_ERR", error);
    results.errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    const cleanup = await cleanupExpiredHolds();
    results.hold_cleanup = cleanup.hold_cleanup;
  } catch (error) {
    console.error("HOLD_CLEANUP_ERR", error);
    results.errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    const manualCleanup = await cleanupExpiredManualBookings();
    results.expired_manual = manualCleanup.expired_manual;
  } catch (error) {
    console.error("MANUAL_BOOKING_CLEANUP_ERR", error);
    results.errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    const voucherCleanup = await cleanupAbandonedVouchers();
    results.vouchers_cleaned = voucherCleanup.vouchers_cleaned;
  } catch (error) {
    console.error("VOUCHER_CLEANUP_ERR", error);
    results.errors.push(error instanceof Error ? error.message : String(error));
  }

  return new Response(JSON.stringify(results), { headers: headers(), status: results.errors.length ? 500 : 200 });
});
