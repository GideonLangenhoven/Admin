// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, formatTenantDateTime, getTenantByBusinessId, sendWhatsappTextForTenant } from "../_shared/tenant.ts";
import { withSentry } from "../_shared/sentry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const supabase = createServiceClient();
const CRON_BATCH_SIZE = 500;

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
    .lt("expires_at", cutoffIso)
    .order("expires_at", { ascending: true })
    .limit(CRON_BATCH_SIZE);

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
          const rpcRes = await supabase.rpc("adjust_slot_capacity", {
            p_slot_id: pr.new_slot_id,
            p_business_id: pr.business_id,
            p_booked_delta: 0,
            p_held_delta: -qty,
          });
          if (rpcRes.error) {
            const { data: slotHeldData } = await supabase.from("slots").select("held").eq("business_id", pr.business_id).eq("id", pr.new_slot_id).maybeSingle();
            if (slotHeldData) {
              await supabase.from("slots").update({
                held: Math.max(0, (slotHeldData.held || 0) - qty),
              }).eq("business_id", pr.business_id).eq("id", pr.new_slot_id);
            }
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
    const holdBooking = Array.isArray(hold.bookings) ? hold.bookings[0] : hold.bookings as { phone?: string } | null;
    const holdSlot = Array.isArray(hold.slots) ? hold.slots[0] : hold.slots as { start_time?: string } | null;
    const holdTour = Array.isArray(hold.tours) ? hold.tours[0] : hold.tours as { name?: string } | null;
    if (holdBooking?.phone && hold.business_id) {
      try {
        const tenant = await getTenantByBusinessId(supabase, hold.business_id);
        const slotLabel = holdSlot?.start_time ? formatTenantDateTime(tenant.business, holdSlot.start_time) : "your selected slot";
        const message =
          "Your held booking for " + (holdTour?.name || "the experience") + " at " + slotLabel + " has expired.\n\n" +
          "If you still want those spots, start a new booking and we’ll help from there.";
        await sendWhatsappTextForTenant(tenant, holdBooking.phone, message);
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
    .lt("payment_deadline", new Date().toISOString())
    .order("payment_deadline", { ascending: true })
    .limit(CRON_BATCH_SIZE);

  for (const booking of expiredBookings || []) {
    // Cancel the booking
    await supabase.from("bookings").update({
      status: "CANCELLED",
      cancellation_reason: "Auto-cancelled: payment deadline exceeded",
      cancelled_at: new Date().toISOString(),
    }).eq("id", booking.id);

    // Release the capacity (decrement slot.booked)
    const rpcRes = await supabase.rpc("adjust_slot_capacity", {
      p_slot_id: booking.slot_id,
      p_business_id: booking.business_id,
      p_booked_delta: -Number(booking.qty || 0),
      p_held_delta: 0,
    });
    if (rpcRes.error) {
      const { data: slotData } = await supabase.from("slots").select("booked").eq("business_id", booking.business_id).eq("id", booking.slot_id).single();
      if (slotData) {
        await supabase.from("slots").update({
          booked: Math.max(0, (slotData.booked || 0) - booking.qty),
        }).eq("business_id", booking.business_id).eq("id", booking.slot_id);
      }
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

async function cleanupExpiredOtpAttempts() {
  const cutoffIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("otp_attempts")
    .delete({ count: "exact" })
    .lt("expires_at", cutoffIso);
  if (error) throw error;
  return { otp_attempts_cleaned: count || 0 };
}

async function cleanupAbandonedVouchers() {
  const results = { vouchers_cleaned: 0 };

  // Delete PENDING vouchers older than 24 hours (abandoned checkout flows)
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: abandoned } = await supabase
    .from("vouchers")
    .select("id")
    .eq("status", "PENDING")
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(CRON_BATCH_SIZE);

  if (abandoned && abandoned.length > 0) {
    const ids = abandoned.map((v: any) => v.id);
    await supabase.from("vouchers").delete().in("id", ids);
    results.vouchers_cleaned = ids.length;
    console.log("VOUCHER_CLEANUP: deleted " + ids.length + " abandoned PENDING vouchers");
  }

  return results;
}

// ─── AUTO-TAGGING: Sync booking behaviour to marketing contact tags ───
// Runs daily via cron. Assigns tags that power automations:
//   completed-tour   — booking slot has passed, status PAID/CONFIRMED
//   lapsed-90-days   — last booking was 90+ days ago, no recent activity
//   vip              — 3+ completed paid bookings
//   new-booker       — exactly 1 paid booking
//   voucher-expiring — has a voucher expiring within 30 days
async function autoTagContacts() {
  const results = { synced: 0, tagged: 0, errors: 0 };
  const now = new Date();

  // Get all businesses with their automation config
  const { data: businesses } = await supabase.from("businesses").select("id, automation_config");

  for (const biz of (businesses || [])) {
    try {
      // Load configurable thresholds (admin can change these in Settings → Automation Tag Rules)
      const ac = (biz as any).automation_config || {};
      const VIP_BOOKINGS = ac.vip_bookings ?? 3;
      const VIP_WINDOW_DAYS = ac.vip_window_days ?? 90;
      const VIP_VALID_DAYS = ac.vip_valid_days ?? 365;
      const VIP_RENEWAL_BOOKINGS = ac.vip_renewal_bookings ?? 3;
      const LAPSED_DAYS = ac.lapsed_days ?? 90;
      const NEW_BOOKER_ENABLED = ac.new_booker_enabled ?? true;
      const COMPLETED_TOUR_ENABLED = ac.completed_tour_enabled ?? true;
      const VOUCHER_EXPIRY_DAYS = ac.voucher_expiry_days ?? 30;

      // Get all marketing contacts for this business
      const { data: contacts } = await supabase
        .from("marketing_contacts")
        .select("id, email, phone, tags")
        .eq("business_id", biz.id)
        .eq("status", "active");

      if (!contacts || contacts.length === 0) continue;

      // Build email→contact lookup
      const emailMap: Record<string, any> = {};
      for (const c of contacts) {
        if (c.email) emailMap[c.email.toLowerCase()] = c;
      }
      const emails = Object.keys(emailMap);
      if (emails.length === 0) continue;

      // Get all paid bookings for these emails
      const { data: bookings } = await supabase
        .from("bookings")
        .select("id, email, status, slot_id, created_at, slots(start_time)")
        .eq("business_id", biz.id)
        .in("status", ["PAID", "CONFIRMED", "COMPLETED"])
        .in("email", emails);

      // Get vouchers expiring within configured window
      const voucherCutoff = new Date(now.getTime() + VOUCHER_EXPIRY_DAYS * 86400000).toISOString();
      const { data: expiringVouchers } = await supabase
        .from("vouchers")
        .select("id, buyer_email, recipient_email, expires_at")
        .eq("business_id", biz.id)
        .eq("status", "ACTIVE")
        .lt("expires_at", voucherCutoff)
        .gt("expires_at", now.toISOString());

      // Build per-contact booking stats
      const vipWindowStart = new Date(now.getTime() - VIP_WINDOW_DAYS * 86400000);
      const stats: Record<string, { total: number; recentCount: number; lastBooking: Date | null; hasCompletedTour: boolean }> = {};
      for (const b of (bookings || [])) {
        const key = (b.email || "").toLowerCase();
        if (!stats[key]) stats[key] = { total: 0, recentCount: 0, lastBooking: null, hasCompletedTour: false };
        stats[key].total += 1;
        const createdAt = new Date(b.created_at);
        if (createdAt >= vipWindowStart) stats[key].recentCount += 1;
        if (!stats[key].lastBooking || createdAt > stats[key].lastBooking!) stats[key].lastBooking = createdAt;
        const slotTime = (b as any).slots?.start_time;
        if (slotTime && new Date(slotTime) < now) stats[key].hasCompletedTour = true;
      }

      // Build expiring voucher set (check both buyer and recipient emails)
      const voucherEmails = new Set<string>();
      for (const v of (expiringVouchers || [])) {
        if (v.buyer_email) voucherEmails.add(v.buyer_email.toLowerCase());
        if (v.recipient_email) voucherEmails.add(v.recipient_email.toLowerCase());
      }

      // Apply tags
      const lapsedCutoff = new Date(now.getTime() - LAPSED_DAYS * 86400000);
      const lapsedTagName = "lapsed-" + LAPSED_DAYS + "-days";

      for (const email of emails) {
        const contact = emailMap[email];
        const s = stats[email];
        const currentTags: string[] = contact.tags || [];
        const newTags = new Set(currentTags);
        let changed = false;

        // completed-tour
        if (COMPLETED_TOUR_ENABLED && s?.hasCompletedTour && !currentTags.includes("completed-tour")) {
          newTags.add("completed-tour");
          changed = true;
        }

        // lapsed — configurable days, dynamic tag name
        // Also clean up old lapsed tags with different day counts
        const oldLapsedTags = currentTags.filter(t => /^lapsed-\d+-days$/.test(t));
        if (s && s.lastBooking && s.lastBooking < lapsedCutoff) {
          if (!currentTags.includes(lapsedTagName)) {
            // Remove any old lapsed tags with different thresholds
            for (const old of oldLapsedTags) { if (old !== lapsedTagName) { newTags.delete(old); changed = true; } }
            newTags.add(lapsedTagName);
            changed = true;
          }
        } else {
          // Remove lapsed tag if they've booked recently
          for (const old of oldLapsedTags) { newTags.delete(old); changed = true; }
        }

        // VIP — configurable: N bookings within M days, valid for X days, renews with Y more bookings
        // Check if contact has enough recent bookings to qualify
        const qualifiesForVip = s && s.recentCount >= VIP_BOOKINGS;
        const hasVip = currentTags.includes("vip");
        const hasVipExpiry = currentTags.find(t => t.startsWith("vip-expires:"));
        if (qualifiesForVip) {
          if (!hasVip) {
            newTags.add("vip");
            changed = true;
          }
          // Set/refresh expiry marker: vip-expires:YYYY-MM-DD
          const expiryDate = new Date(now.getTime() + VIP_VALID_DAYS * 86400000);
          const expiryTag = "vip-expires:" + expiryDate.toISOString().split("T")[0];
          if (hasVipExpiry && hasVipExpiry !== expiryTag) { newTags.delete(hasVipExpiry); }
          if (!hasVipExpiry || hasVipExpiry !== expiryTag) { newTags.add(expiryTag); changed = true; }
        } else if (hasVip) {
          // Check if VIP has expired
          if (hasVipExpiry) {
            const expiryStr = hasVipExpiry.split(":")[1];
            if (expiryStr && new Date(expiryStr) < now) {
              // Check if they earned renewal (N bookings since VIP was granted)
              if (!s || s.recentCount < VIP_RENEWAL_BOOKINGS) {
                newTags.delete("vip");
                newTags.delete(hasVipExpiry);
                changed = true;
              }
            }
          }
        }

        // new-booker — exactly 1 booking
        if (NEW_BOOKER_ENABLED) {
          if (s && s.total === 1 && !currentTags.includes("new-booker")) {
            newTags.add("new-booker");
            changed = true;
          }
          if (s && s.total > 1 && currentTags.includes("new-booker")) {
            newTags.delete("new-booker");
            changed = true;
          }
        }

        // voucher-expiring
        if (voucherEmails.has(email) && !currentTags.includes("voucher-expiring")) {
          newTags.add("voucher-expiring");
          changed = true;
        }

        if (changed) {
          const tagArray = Array.from(newTags);
          await supabase.from("marketing_contacts").update({ tags: tagArray }).eq("id", contact.id);
          results.tagged += 1;

          // Trigger automation enrollments for newly added tags
          const addedTags = tagArray.filter(t => !currentTags.includes(t));
          for (const tag of addedTags) {
            // Check for matching tag_added automations
            const { data: autos } = await supabase
              .from("marketing_automations")
              .select("id, trigger_config")
              .eq("business_id", biz.id)
              .eq("status", "active")
              .eq("trigger_type", "tag_added");

            for (const auto of (autos || [])) {
              if ((auto.trigger_config as any)?.tag !== tag) continue;
              // Check if already enrolled
              const { data: existing } = await supabase
                .from("marketing_automation_enrollments")
                .select("id")
                .eq("automation_id", auto.id)
                .eq("contact_id", contact.id)
                .maybeSingle();

              if (!existing) {
                await supabase.from("marketing_automation_enrollments").insert({
                  automation_id: auto.id,
                  contact_id: contact.id,
                  business_id: biz.id,
                  status: "active",
                  next_action_at: new Date().toISOString(),
                });
                await supabase.rpc("increment_automation_counter", {
                  p_automation_id: auto.id,
                  p_column: "enrolled_count",
                  p_amount: 1,
                });
              }
            }
          }
        }
      }

      results.synced += contacts.length;
    } catch (err) {
      console.error("AUTO_TAG_ERR biz=" + biz.id, err);
      results.errors += 1;
    }
  }

  console.log("AUTO_TAG_DONE synced=" + results.synced + " tagged=" + results.tagged + " errors=" + results.errors);
  return results;
}

Deno.serve(withSentry("cron-tasks", async (_req) => {
  const results: any = { reminders: null, hold_cleanup: 0, expired_manual: 0, vouchers_cleaned: 0, otp_attempts_cleaned: 0, auto_tags: null, errors: [] };

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

  try {
    const otpCleanup = await cleanupExpiredOtpAttempts();
    results.otp_attempts_cleaned = otpCleanup.otp_attempts_cleaned;
  } catch (error) {
    console.error("OTP_ATTEMPT_CLEANUP_ERR", error);
    results.errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    results.auto_tags = await autoTagContacts();
  } catch (error) {
    console.error("AUTO_TAG_ERR", error);
    results.errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    results.popia = await processPOPIARequests();
  } catch (error) {
    console.error("POPIA_CRON_ERR", error);
    results.errors.push(error instanceof Error ? error.message : String(error));
  }

  return new Response(JSON.stringify(results), { headers: headers(), status: results.errors.length ? 500 : 200 });
}));

async function processPOPIARequests() {
  const result = { promoted_to_review: 0, expired_unconfirmed: 0, expired_exports: 0 };

  // Promote confirmed requests past their scheduled_for date to IN_REVIEW
  const { data: due } = await supabase
    .from("data_subject_requests")
    .select("id, business_id")
    .eq("status", "CONFIRMED")
    .lte("scheduled_for", new Date().toISOString());

  if (due && due.length > 0) {
    await supabase
      .from("data_subject_requests")
      .update({ status: "IN_REVIEW", updated_at: new Date().toISOString() })
      .in("id", due.map((d: { id: string }) => d.id));
    result.promoted_to_review = due.length;
    console.log("POPIA_PROMOTE_TO_REVIEW count=" + due.length);
  }

  // Expire unconfirmed requests after 24h
  const { data: expired } = await supabase
    .from("data_subject_requests")
    .update({ status: "CANCELLED", cancellation_reason: "Confirmation expired", updated_at: new Date().toISOString() })
    .eq("status", "PENDING_CONFIRMATION")
    .lt("confirmation_expires_at", new Date().toISOString())
    .select("id");
  result.expired_unconfirmed = expired?.length ?? 0;

  // Expire old export URLs
  const { data: expiredExports } = await supabase
    .from("data_subject_requests")
    .update({ export_url: null, updated_at: new Date().toISOString() })
    .lt("export_expires_at", new Date().toISOString())
    .not("export_url", "is", null)
    .select("id");
  result.expired_exports = expiredExports?.length ?? 0;

  return result;
}
