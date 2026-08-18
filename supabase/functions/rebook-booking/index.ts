// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createServiceClient,
  formatTenantDateTime,
  getAdminAppOrigins,
  getBusinessDisplayName,
  getTenantByBusinessId,
  normalizePhone,
  sendWhatsappTextForTenant,
} from "../_shared/tenant.ts";
import { verifyCustomerSession } from "../_shared/customer-session.ts";
import { getPaidPortions } from "../_shared/vouchers.ts";
import { getComboLegPolicy, validateComboDates } from "../_shared/combo.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createServiceClient();

function getCors(req?: any) {
  const origin = (req && req.headers) ? req.headers.get("origin") || "" : "";
  // Allow any origin — this is a customer-facing function invoked from booking sites
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-business-id, x-tenant-subdomain, x-tenant-origin, x-voucher-code, x-booking-success-token, x-booking-id, x-booking-waiver-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

function genVoucherCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

// Insert a voucher with retry on unique constraint violation (code collision)
async function insertVoucherWithRetry(payload: any, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) payload.code = genVoucherCode();
    const { data, error } = await supabase.from("vouchers").insert(payload).select().single();
    if (!error) return { data, error: null };
    // Postgres unique_violation error code
    if (error.code === "23505" && attempt < maxRetries - 1) continue;
    return { data: null, error };
  }
  return { data: null, error: { message: "Failed to generate unique voucher code after " + maxRetries + " attempts" } };
}

function ok(req: any, data: any) {
  return new Response(JSON.stringify(data), { status: 200, headers: getCors(req) });
}

function fail(req: any, msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), { status: status, headers: getCors(req) });
}

// ───── Caller authorization ─────
// This function performs money-moving operations (refunds, cancellations,
// guest changes) as service_role, so every caller must prove they own the
// booking. Three legitimate caller classes:
//   1. Internal cross-function calls (wa-webhook, web-chat) — authenticate
//      the customer themselves and call with the service-role key as Bearer.
//   2. Customers on /my-bookings — send the HMAC-signed customer_session
//      token issued by my-bookings-lookup after OTP verification.
//   3. Admin dashboard / magic-link customers — Supabase Auth JWT. Admins
//      must belong to the booking's business (SUPER_ADMIN exempt); other
//      authenticated users must match the booking's email.
type CallerAuthz = { ok: true } | { ok: false; status: number; message: string };

async function authorizeCaller(req: any, body: any, booking: any): Promise<CallerAuthz> {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (token && token === SUPABASE_KEY) return { ok: true };

  const bookingEmail = String(booking.email || "").toLowerCase();

  const sessionToken = typeof body.customer_session === "string" ? body.customer_session : "";
  if (sessionToken) {
    const session = await verifyCustomerSession(sessionToken);
    if (!session.valid) {
      return { ok: false, status: 401, message: "Your session has expired. Please sign in again." };
    }
    const emailMatches = !!bookingEmail && String(session.email || "").toLowerCase() === bookingEmail;
    if (!emailMatches || session.businessId !== booking.business_id) {
      return { ok: false, status: 403, message: "This booking does not belong to your account." };
    }
    return { ok: true };
  }

  if (token) {
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    const user = userData?.user;
    if (!userErr && user) {
      const { data: admin } = await supabase
        .from("admin_users")
        .select("business_id, role, suspended")
        .eq("user_id", user.id)
        .maybeSingle();
      if (admin && !admin.suspended) {
        if (admin.role === "SUPER_ADMIN" || admin.business_id === booking.business_id) return { ok: true };
        return { ok: false, status: 403, message: "This booking belongs to a different business." };
      }
      const userEmail = String(user.email || "").toLowerCase();
      if (userEmail && bookingEmail && userEmail === bookingEmail) return { ok: true };
      return { ok: false, status: 403, message: "This booking does not belong to your account." };
    }
  }

  return { ok: false, status: 401, message: "Please sign in to manage this booking." };
}

// ───── RESCHEDULE ─────
// Unpaid bookings hold no money, so amendments never trigger refunds,
// vouchers, or uplift payment links — just repricing + capacity moves.
function isUnpaidBooking(booking: any): boolean {
  return ["PENDING", "PENDING PAYMENT", "HELD"].includes(String(booking.status || ""));
}

// Release `qtyDelta` seats of an unpaid booking's ACTIVE hold (or move the
// whole hold to a new slot). Admin-created pending bookings historically have
// no hold row — then there is nothing reserved and nothing to release.
async function releaseUnpaidHold(booking: any, qtyDelta: number, newSlotId?: string) {
  const holdRes = await supabase.from("holds").select("id, qty").eq("booking_id", booking.id).eq("status", "ACTIVE").limit(1).maybeSingle();
  if (!holdRes.data) return;
  await supabase.rpc("adjust_slot_capacity", { p_slot_id: booking.slot_id, p_business_id: booking.business_id, p_booked_delta: 0, p_held_delta: -qtyDelta });
  if (newSlotId) {
    await supabase.rpc("adjust_slot_capacity", { p_slot_id: newSlotId, p_business_id: booking.business_id, p_booked_delta: 0, p_held_delta: qtyDelta });
    await supabase.from("holds").update({ slot_id: newSlotId }).eq("id", holdRes.data.id);
  } else {
    await supabase.from("holds").update({ qty: Math.max(1, Number(holdRes.data.qty || booking.qty) - qtyDelta) }).eq("id", holdRes.data.id);
  }
}

async function handleReschedule(req: any, booking: any, body: any, claimEligible: boolean) {
  const newSlotId = body.new_slot_id;
  if (!newSlotId) return fail(req, "new_slot_id required for RESCHEDULE", 400);

  // Credit-claim remediation (operator-cancelled booking being revived): the
  // customer may move to a DIFFERENT tour and/or reduce the party size — the
  // price difference is settled below (pay uplift / refund or voucher excess),
  // so a smaller party automatically refunds the no-longer-attending guests.
  const isCreditClaim = booking.status === "CANCELLED";
  const newQty = Math.floor(Number(body.new_qty ?? booking.qty));
  if (!Number.isFinite(newQty) || newQty < 1 || newQty > Number(booking.qty)) {
    return fail(req, "new_qty must be between 1 and " + booking.qty, 400);
  }
  if (!isCreditClaim && newQty !== Number(booking.qty)) {
    return fail(req, "Use ADD_GUESTS / REMOVE_GUESTS to change party size on an active booking", 400);
  }

  const slotRes = await supabase
    .from("slots")
    .select("id, tour_id, start_time, capacity_total, booked, held, price_per_person_override, last_minute_at")
    .eq("id", newSlotId)
    .single();
  if (slotRes.error || !slotRes.data) return fail(req, "New slot not found", 404);
  const newSlot = slotRes.data;

  // Enforce same-activity rescheduling on active bookings; credit claims may
  // rebook onto any tour.
  if (newSlot.tour_id !== booking.tour_id && !isCreditClaim) {
    return fail(req, "Cannot reschedule to a different activity", 400);
  }

  const available = newSlot.capacity_total - (newSlot.booked || 0) - (newSlot.held || 0);
  if (available < newQty) return fail(req, "Not enough capacity on new slot (" + available + " available, need " + newQty + ")", 400);

  // Calculate price diff
  const oldUnitPrice = Number(booking.unit_price || 0);
  const newTourRes = await supabase.from("tours").select("base_price_per_person, name").eq("id", newSlot.tour_id).single();
  const newBasePrice = (newTourRes.data && newTourRes.data.base_price_per_person) ? Number(newTourRes.data.base_price_per_person) : oldUnitPrice;
  // Last-minute deals are for filling unsold seats, not for existing customers
  // to reschedule into and claim the difference back — price those at base.
  // Only a genuine discount is skipped: if the flag outlived its deal (slot
  // re-priced upward), the slot's own price stands, or we would undercharge.
  const slotOverride = newSlot.price_per_person_override != null ? Number(newSlot.price_per_person_override) : null;
  const isLastMinuteDeal = !!newSlot.last_minute_at && slotOverride != null && slotOverride < newBasePrice;
  const newUnitPrice = (slotOverride != null && !isLastMinuteDeal) ? slotOverride : newBasePrice;
  const newTotalAmount = newUnitPrice * newQty;
  // A cancelled booking only carries credit while its payout is still parked
  // (refund_status ACTION_REQUIRED). Once the refund/voucher was issued the
  // money already left — rebooking charges the full new price.
  // Credit counts what the customer actually paid: cash AND voucher portions.
  // Counting total_amount alone made voucher-paid bookings owe the full new
  // price on reschedule. A booking whose voucher portion was already reissued
  // as a CREDIT voucher (converted_to_voucher_id, stamped by cancel flows) no
  // longer holds that money — it never counts as credit twice.
  const portions = getPaidPortions(booking);
  const liveVoucherPaid = booking.converted_to_voucher_id ? 0 : portions.voucherPaid;
  const credit = isCreditClaim && !claimEligible ? 0 : portions.cashPaid + liveVoucherPaid;
  const diff = newTotalAmount - credit;

  const result: any = { ok: true, action: "RESCHEDULE", diff: diff };

  if (isUnpaidBooking(booking)) {
    // Unpaid: immediate swap, reprice at the new slot, no money mechanics.
    // Any previously-generated payment link is priced at the old slot — clear
    // it so the admin/cron generates a fresh one for the new total.
    await releaseUnpaidHold(booking, Number(booking.qty), newSlotId);
    await supabase.from("bookings").update({
      slot_id: newSlotId,
      tour_id: newSlot.tour_id,
      unit_price: newUnitPrice,
      // total_amount is the cash still due — any voucher already applied
      // keeps covering its share of the new price.
      total_amount: Math.max(0, newTotalAmount - liveVoucherPaid),
      yoco_checkout_id: null,
      payment_url: null,
    }).eq("id", booking.id);

    await supabase.from("logs").insert({
      business_id: booking.business_id,
      booking_id: booking.id,
      event: "booking_rescheduled",
      payload: { old_slot_id: booking.slot_id, new_slot_id: newSlotId, old_total: booking.total_amount, new_total: newTotalAmount, unpaid: true },
    });

    booking.slots = { ...(booking.slots || {}), start_time: newSlot.start_time };
    await sendRebookNotification(booking, "rescheduled", "Your booking has been moved to a new date/time.");
    return ok(req, { ...result, diff: 0, new_total: newTotalAmount });
  }

  if (diff > 0) {
    // ── UPGRADE: customer owes more ──
    // Do NOT release old slot or update booking yet.
    // Create a hold on the new slot and a pending_reschedule record.
    // The actual swap happens only when payment is confirmed (yoco-webhook).

    // 1. Create a 15-minute hold on the new slot
    const holdExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const holdRes = await supabase.from("holds").insert({
      booking_id: booking.id,
      slot_id: newSlotId,
      expires_at: holdExpiry,
      status: "ACTIVE",
      hold_type: "RESCHEDULE",
      metadata: {
        old_slot_id: booking.slot_id,
        new_unit_price: newUnitPrice,
        new_total_amount: newTotalAmount,
        diff: diff,
      },
    }).select().single();

    if (holdRes.error) {
      console.error("RESCHEDULE_HOLD_ERR:", holdRes.error);
      return fail(req, "Failed to create hold on new slot", 500);
    }

    // 2. Increment held count on new slot (S3: atomic, no read-modify-write)
    await supabase.rpc("adjust_slot_capacity", { p_slot_id: newSlotId, p_business_id: booking.business_id, p_booked_delta: 0, p_held_delta: Number(newQty) });

    // 3. Create pending_reschedule record
    const pendingRes = await supabase.from("pending_reschedules").insert({
      booking_id: booking.id,
      business_id: booking.business_id,
      old_slot_id: booking.slot_id,
      new_slot_id: newSlotId,
      hold_id: holdRes.data.id,
      diff: diff,
      new_unit_price: newUnitPrice,
      new_total_amount: newTotalAmount,
      new_tour_id: newSlot.tour_id,
      new_qty: newQty !== Number(booking.qty) ? newQty : null,
      status: "PENDING",
    }).select().single();

    if (pendingRes.error) {
      console.error("PENDING_RESCHEDULE_INSERT_ERR:", pendingRes.error);
      // Clean up the hold we just created, and roll back the held increment
      // atomically (S3; the previous code set held to itself and never rolled back).
      await supabase.from("holds").update({ status: "CANCELLED" }).eq("id", holdRes.data.id);
      await supabase.rpc("adjust_slot_capacity", { p_slot_id: newSlotId, p_business_id: booking.business_id, p_booked_delta: 0, p_held_delta: -Number(newQty) });
      return fail(req, "Failed to create pending reschedule", 500);
    }

    // 4. Create checkout with reschedule metadata
    const checkoutRes = await fetch(SUPABASE_URL + "/functions/v1/create-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
      body: JSON.stringify({
        amount: diff,
        booking_id: booking.id,
        business_id: booking.business_id,
        type: "RESCHEDULE",
        pending_reschedule_id: pendingRes.data.id,
      }),
    });
    const checkoutData = await checkoutRes.json();
    if (checkoutData && checkoutData.redirectUrl) {
      result.payment_url = checkoutData.redirectUrl;
    }

    await supabase.from("logs").insert({
      business_id: booking.business_id,
      booking_id: booking.id,
      event: "reschedule_upgrade_pending",
      payload: {
        old_slot_id: booking.slot_id,
        new_slot_id: newSlotId,
        old_total: booking.total_amount,
        new_total: newTotalAmount,
        diff: diff,
        hold_id: holdRes.data.id,
        pending_reschedule_id: pendingRes.data.id,
        hold_expires_at: holdExpiry,
      },
    });

    result.pending_reschedule_id = pendingRes.data.id;
    result.hold_expires_at = holdExpiry;
  } else {
    // ── SAME PRICE OR DOWNGRADE: immediate swap ──
    // Credit-claim reschedule (weather/admin-cancelled booking): the old slot's
    // capacity was already released at cancellation, so don't release it again;
    // reactivate the booking and consume the credit.

    // Decrement old slot booked count (S3: atomic)
    if (!isCreditClaim) {
      await supabase.rpc("adjust_slot_capacity", { p_slot_id: booking.slot_id, p_business_id: booking.business_id, p_booked_delta: -Number(booking.qty), p_held_delta: 0 });
    }

    // Increment new slot booked count (S3: atomic)
    await supabase.rpc("adjust_slot_capacity", { p_slot_id: newSlotId, p_business_id: booking.business_id, p_booked_delta: Number(newQty), p_held_delta: 0 });

    // Update booking. Keep the cash/voucher split intact: total_amount stays
    // the cash portion and the voucher-funded portion rides along. A
    // downgrade's excess draws down the voucher portion first — it is
    // returned as voucher credit (never cash) in the excess handling below.
    const swapExcess = Math.max(0, -diff);
    const swapVoucherShare = Math.min(swapExcess, liveVoucherPaid);
    const swapCashShare = swapExcess - swapVoucherShare;
    const newVoucherPaid = liveVoucherPaid - swapVoucherShare;
    const updateData: any = {
      slot_id: newSlotId,
      tour_id: newSlot.tour_id,
      unit_price: newUnitPrice,
      total_amount: Math.max(0, newTotalAmount - newVoucherPaid),
      qty: newQty,
    };
    if (portions.voucherPaid > 0) {
      updateData.voucher_amount_paid = newVoucherPaid;
    }
    if (isCreditClaim) {
      updateData.status = "CONFIRMED";
      updateData.refund_status = null;
      updateData.refund_amount = 0;
      updateData.cancellation_reason = null;
      updateData.cancelled_at = null;
    }
    await supabase.from("bookings").update(updateData).eq("id", booking.id);

    await supabase.from("logs").insert({
      business_id: booking.business_id,
      booking_id: booking.id,
      event: "booking_rescheduled",
      payload: {
        old_slot_id: booking.slot_id,
        new_slot_id: newSlotId,
        old_total: booking.total_amount,
        new_total: newTotalAmount,
        diff: diff,
      },
    });

    let rebookNotifyMsg = "Your booking has been moved to a new date/time.";

    if (diff < 0 && body.excess_action === "REFUND") {
      // The voucher-funded share of the excess always comes back as a
      // full-value CREDIT voucher (never cash); only the cash share is
      // refunded. Legacy voucher-paid rows without voucher_amount_paid
      // stamped treat the whole excess as voucher-funded.
      let diffVoucherCredit = swapVoucherShare;
      let diffCashRefund = swapCashShare;
      if (diffVoucherCredit === 0 && isVoucherPayment(booking)) {
        diffVoucherCredit = swapExcess;
        diffCashRefund = 0;
      }
      // Credit-claim excess refunds are fee-free: the operator cancelled the
      // trip, so the customer never absorbs the 5% processing fee.
      const diffFeeFactor = isCreditClaim ? 1 : 0.95;
      if (diffVoucherCredit > 0) {
        const vResult = await insertVoucherWithRetry({
          business_id: booking.business_id,
          code: genVoucherCode(),
          status: "ACTIVE",
          type: "CREDIT",
          value: diffVoucherCredit,
          current_balance: diffVoucherCredit,
          source_booking_id: booking.id,
          expires_at: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString(),
        });
        if (vResult.error) return fail(req, "Voucher creation failed: " + vResult.error.message, 500);
        result.voucher_amount = diffVoucherCredit;
        result.voucher_code = vResult.data.code;
        rebookNotifyMsg = "Your booking has been moved to a new date/time. Since the new slot costs less, we've issued you a credit voucher for the difference. Voucher code: " + vResult.data.code + " (valid for 3 years).";
      }
      if (diffCashRefund > 0 && isManualPayment(booking)) {
        const manualDiffRefund = diffCashRefund * diffFeeFactor;
        await supabase.from("bookings").update({
          refund_status: "MANUAL_EFT_REQUIRED",
          refund_amount: manualDiffRefund,
          total_refunded: Number(booking.total_refunded || 0) + manualDiffRefund,
        }).eq("id", booking.id);
        result.refund_amount = manualDiffRefund;
        result.refund_status = "MANUAL_EFT_REQUIRED";
      } else if (diffCashRefund > 0) {
        const rescheduleTotalCaptured = Number(booking.total_captured || booking.total_amount || 0);
        const rescheduleTotalRefunded = Number(booking.total_refunded || 0);
        const rescheduleRefundable = rescheduleTotalCaptured - rescheduleTotalRefunded;
        const refundAmount = Math.min(diffCashRefund * diffFeeFactor, rescheduleRefundable);
        // total_refunded is NOT bumped here — process-refund adds it when the
        // money actually moves; pre-counting made the queue see 0 refundable.
        await supabase.from("bookings").update({
          refund_status: "REQUESTED",
          refund_amount: refundAmount,
        }).eq("id", booking.id);
        result.refund_amount = refundAmount;
      }
    } else if (diff < 0 && body.excess_action === "VOUCHER") {
      const voucherAmount = Math.abs(diff);
      const vcode = genVoucherCode();
      const vResult = await insertVoucherWithRetry({
        business_id: booking.business_id,
        code: vcode,
        status: "ACTIVE",
        type: "CREDIT",
        value: voucherAmount,
        current_balance: voucherAmount,
        source_booking_id: booking.id,
        expires_at: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString(),
      });
      if (vResult.error) return fail(req, "Voucher creation failed: " + vResult.error.message, 500);
      result.voucher_amount = voucherAmount;
      result.voucher_code = vResult.data.code;

      await supabase.from("logs").insert({
        business_id: booking.business_id,
        booking_id: booking.id,
        event: "reschedule_downgrade_voucher",
        payload: { diff: diff, voucher_amount: voucherAmount, voucher_code: vResult.data.code, voucher_id: vResult.data.id, old_total: booking.total_amount, new_total: newTotalAmount },
      });

      rebookNotifyMsg = "Your booking has been moved to a new date/time. Since the new slot costs less, we've issued you a credit voucher for the difference. Voucher code: " + vResult.data.code + " (valid for 3 years).";
    }

    // Send notifications only for immediate swaps. The in-memory relations
    // still point at the pre-swap slot/tour — refresh them so the customer
    // sees the NEW date/time, not the one they just moved off.
    booking.slots = { ...(booking.slots || {}), start_time: newSlot.start_time };
    if (newTourRes.data && newTourRes.data.name) {
      booking.tours = { ...(booking.tours || {}), name: newTourRes.data.name };
    }
    await sendRebookNotification(booking, "rescheduled", rebookNotifyMsg);
  }

  return ok(req, result);
}

// ───── ADD_GUESTS ─────
async function handleAddGuests(req: any, booking: any, body: any) {
  const newQty = Number(body.new_qty || 0);
  if (newQty <= booking.qty) return fail(req, "new_qty must be greater than current qty (" + booking.qty + ")", 400);

  const additionalGuests = newQty - booking.qty;
  const unitPrice = Number(booking.unit_price || 0);
  const additionalCost = additionalGuests * unitPrice;
  const newTotal = Number(booking.total_amount || 0) + additionalCost;

  // Atomic capacity check + hold for the additional guests. Unpaid bookings
  // keep the hold until their payment deadline (not just 15 minutes) since
  // no uplift checkout is being started.
  const deadlineMs = booking.payment_deadline ? new Date(booking.payment_deadline).getTime() : 0;
  const holdExpiry = (isUnpaidBooking(booking) && deadlineMs > Date.now())
    ? new Date(deadlineMs).toISOString()
    : new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const holdResult = await supabase.rpc("create_hold_with_capacity_check", {
    p_booking_id: booking.id,
    p_slot_id: booking.slot_id,
    p_qty: additionalGuests,
    p_expires_at: holdExpiry,
  });

  if (holdResult.error || !holdResult.data?.success) {
    return fail(req, holdResult.data?.error || "Not enough spots available", 400);
  }

  const holdId = holdResult.data.hold_id;

  if (isUnpaidBooking(booking)) {
    // Unpaid: no uplift checkout — the whole (new) total is still unpaid.
    // Reprice and invalidate the stale payment link.
    await supabase.from("bookings").update({
      qty: newQty,
      total_amount: newTotal,
      yoco_checkout_id: null,
      payment_url: null,
    }).eq("id", booking.id);
    await supabase.from("logs").insert({
      business_id: booking.business_id,
      booking_id: booking.id,
      event: "guests_added",
      payload: { old_qty: booking.qty, new_qty: newQty, additional_cost: additionalCost, hold_id: holdId, unpaid: true },
    });
    return ok(req, { ok: true, action: "ADD_GUESTS", diff: 0, new_total: newTotal, hold_id: holdId });
  }

  await supabase.from("logs").insert({
    business_id: booking.business_id,
    booking_id: booking.id,
    event: "guests_added_pending_payment",
    payload: { old_qty: booking.qty, new_qty: newQty, additional_cost: additionalCost, hold_id: holdId },
  });

  const result: any = { ok: true, action: "ADD_GUESTS", diff: additionalCost, hold_id: holdId };

  // Create checkout for additional amount — pass hold_id so yoco-webhook can convert it
  const checkoutRes = await fetch(SUPABASE_URL + "/functions/v1/create-checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
    body: JSON.stringify({
      amount: additionalCost,
      booking_id: booking.id,
      business_id: booking.business_id,
      type: "ADD_GUESTS",
      hold_id: holdId,
      new_qty: newQty,
    }),
  });
  const checkoutData = await checkoutRes.json();
  if (checkoutData && checkoutData.redirectUrl) {
    result.payment_url = checkoutData.redirectUrl;
  }

  return ok(req, result);
}

// ───── REMOVE_GUESTS ─────
async function handleRemoveGuests(req: any, booking: any, body: any) {
  const newQty = Number(body.new_qty || 0);
  if (newQty < 1) return fail(req, "new_qty must be at least 1", 400);
  if (newQty >= booking.qty) return fail(req, "new_qty must be less than current qty (" + booking.qty + ")", 400);

  const removedGuests = booking.qty - newQty;
  // Use pro-rata discount math over the booking's full paid value: the cash
  // portion (total_amount = cash due after voucher) PLUS the voucher-funded
  // portion (voucher_amount_paid). Pricing off total_amount alone priced the
  // excess at R0 on voucher-paid bookings and the voucher money vanished.
  const { cashPaid, voucherPaid, paidValue } = getPaidPortions(booking);
  const discountedUnitPrice = booking.qty > 0 ? paidValue / booking.qty : Number(booking.unit_price || 0);
  const excessAmount = removedGuests * discountedUnitPrice;
  // The excess draws down the voucher-funded portion first; voucher money
  // comes back as voucher credit, never cash.
  const voucherShare = Math.min(excessAmount, voucherPaid);
  const cashShare = excessAmount - voucherShare;
  const newTotal = cashPaid - cashShare;

  // Removing guests close to the trip used to be blocked outright, because a full
  // refund here would undercut the cancellation policy (remove-all-but-one to dodge
  // the cancel penalty). Instead we now allow it at any time and refund the removed
  // guests' portion at the SAME cancellation-policy percentage a cancel would apply
  // — policy-aligned and no loophole. Vouchers stay full value (as with cancel).
  let removePolicyPercent = 95;
  if (booking.slots?.start_time && booking.business_id) {
    const { data: pctData } = await supabase.rpc("calculate_refund_percent", {
      p_business_id: booking.business_id,
      p_tour_start: booking.slots.start_time,
    });
    if (typeof pctData === "number") removePolicyPercent = pctData;
  }
  const removePolicyFraction = removePolicyPercent / 100;

  if (isUnpaidBooking(booking)) {
    // Unpaid: reprice, release the removed guests' held seats (if this
    // booking ever reserved any), invalidate the stale payment link. No
    // refund/voucher — nothing has been paid.
    await supabase.from("bookings").update({
      qty: newQty,
      total_amount: newTotal,
      yoco_checkout_id: null,
      payment_url: null,
    }).eq("id", booking.id);
    await releaseUnpaidHold(booking, removedGuests);
    await supabase.from("logs").insert({
      business_id: booking.business_id,
      booking_id: booking.id,
      event: "guests_removed",
      payload: { old_qty: booking.qty, new_qty: newQty, excess_amount: 0, excess_action: "NONE", unpaid: true },
    });
    await sendRebookNotification(booking, "guests_removed", removedGuests + " guest" + (removedGuests === 1 ? "" : "s") + " removed from your booking.");
    return ok(req, { ok: true, action: "REMOVE_GUESTS", new_total: newTotal });
  }

  await supabase.from("bookings").update({
    qty: newQty,
    total_amount: newTotal,
    ...(voucherPaid > 0 ? { voucher_amount_paid: voucherPaid - voucherShare } : {}),
  }).eq("id", booking.id);

  // Decrement slot booked count (S3: atomic)
  await supabase.rpc("adjust_slot_capacity", { p_slot_id: booking.slot_id, p_business_id: booking.business_id, p_booked_delta: -removedGuests, p_held_delta: 0 });

  await supabase.from("logs").insert({
    business_id: booking.business_id,
    booking_id: booking.id,
    event: "guests_removed",
    payload: { old_qty: booking.qty, new_qty: newQty, excess_amount: excessAmount, voucher_share: voucherShare, cash_share: cashShare, excess_action: body.excess_action },
  });

  const result: any = { ok: true, action: "REMOVE_GUESTS" };

  if (body.excess_action === "REFUND") {
    // The voucher-funded share always comes back as a full-value CREDIT voucher
    // (no penalty), never cash. Legacy voucher-paid rows without
    // voucher_amount_paid stamped treat the whole excess as voucher-funded.
    let voucherCredit = voucherShare;
    let cashRefund = cashShare;
    if (voucherCredit === 0 && isVoucherPayment(booking)) {
      voucherCredit = excessAmount;
      cashRefund = 0;
    }
    if (voucherCredit > 0) {
      const vcode = genVoucherCode();
      const vResult = await insertVoucherWithRetry({
        business_id: booking.business_id,
        code: vcode,
        status: "ACTIVE",
        type: "CREDIT",
        value: voucherCredit,
        current_balance: voucherCredit,
        source_booking_id: booking.id,
        expires_at: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString(),
      });
      if (vResult.error) return fail(req, "Voucher creation failed: " + vResult.error.message, 500);
      result.voucher_amount = voucherCredit;
      result.voucher_code = vResult.data.code;
      result.payment_method = booking.payment_method;
    }
    if (cashRefund > 0 && isManualPayment(booking)) {
      const manualRefund = cashRefund * removePolicyFraction;
      await supabase.from("bookings").update({
        refund_status: "MANUAL_EFT_REQUIRED",
        refund_amount: manualRefund,
        total_refunded: Number(booking.total_refunded || 0) + manualRefund,
      }).eq("id", booking.id);
      result.refund_amount = manualRefund;
      result.refund_status = "MANUAL_EFT_REQUIRED";
    } else if (cashRefund > 0) {
      const guestTotalCaptured = Number(booking.total_captured || booking.total_amount || 0);
      const guestTotalRefunded = Number(booking.total_refunded || 0);
      const guestRefundable = guestTotalCaptured - guestTotalRefunded;
      const refundAmount = Math.min(cashRefund * removePolicyFraction, guestRefundable);
      // No total_refunded bump at request time — see process-refund
      await supabase.from("bookings").update({
        refund_status: "REQUESTED",
        refund_amount: refundAmount,
      }).eq("id", booking.id);
      result.refund_amount = refundAmount;
    }
  } else if (body.excess_action === "VOUCHER") {
    const vcode = genVoucherCode();
    const vResult = await insertVoucherWithRetry({
      business_id: booking.business_id,
      code: vcode,
      status: "ACTIVE",
      type: "CREDIT",
      value: excessAmount,
      current_balance: excessAmount,
      source_booking_id: booking.id,
      expires_at: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (vResult.error) return fail(req, "Voucher creation failed: " + vResult.error.message, 500);
    result.voucher_amount = excessAmount;
    result.voucher_code = vResult.data.code;
  }

  await sendRebookNotification(booking, "guests_removed", removedGuests + " guest" + (removedGuests === 1 ? "" : "s") + " removed from your booking.");

  return ok(req, result);
}

// ───── UPDATE_CONTACT ─────
async function handleUpdateContact(req: any, booking: any, body: any) {
  const updateData: any = {};
  if (body.contact_name) updateData.customer_name = body.contact_name;
  if (body.contact_email) updateData.email = body.contact_email;
  if (body.contact_phone) updateData.phone = normalizePhone(body.contact_phone);

  if (Object.keys(updateData).length === 0) return fail(req, "At least one contact field required", 400);

  await supabase.from("bookings").update(updateData).eq("id", booking.id);

  await supabase.from("logs").insert({
    business_id: booking.business_id,
    booking_id: booking.id,
    event: "contact_updated",
    payload: updateData,
  });

  return ok(req, { ok: true, action: "UPDATE_CONTACT" });
}

// ───── SPECIAL_REQUEST ─────
async function handleSpecialRequest(req: any, booking: any, body: any) {
  const specialRequests = body.special_requests || "";
  if (!specialRequests) return fail(req, "special_requests required", 400);

  let existingFields = booking.custom_fields || {};
  if (typeof existingFields !== "object" || Array.isArray(existingFields)) {
    existingFields = {};
  }
  existingFields.special_requests = specialRequests;

  await supabase.from("bookings").update({ custom_fields: existingFields }).eq("id", booking.id);

  await supabase.from("logs").insert({
    business_id: booking.business_id,
    booking_id: booking.id,
    event: "special_request_added",
    payload: { special_requests: specialRequests },
  });

  return ok(req, { ok: true, action: "SPECIAL_REQUEST" });
}

// ───── REQUEST_CHANGE ─────
// A customer asking the operator to make a change they can't self-serve
// (typically inside the 12–24h window). Previously the customer page inserted
// a chat_messages row directly with the ANON key — but chat_messages has no
// anon INSERT policy, so RLS silently dropped it while the UI said "Request
// sent!". Nothing ever reached the operator. This runs as service_role and
// guarantees three things: the message lands in the inbox thread, the
// conversation flips to HUMAN (so it shows in the inbox list AND the sidebar
// badge), and the operator gets an email so it's seen even if nobody's
// watching the dashboard.
async function handleRequestChange(req: any, booking: any, body: any) {
  const note = String(body.note || body.special_requests || "").trim();
  const requestedAction = String(body.requested_action || "change").trim();
  const ref = String(booking.id).substring(0, 8).toUpperCase();
  const phone = booking.phone;

  if (!phone) return fail(req, "This booking has no phone number on file, so we can't route your request. Please contact the operator directly.", 400);

  let hrsLabel = "";
  if (booking.slots?.start_time) {
    const hrs = (new Date(booking.slots.start_time).getTime() - Date.now()) / (1000 * 60 * 60);
    hrsLabel = hrs >= 0 ? " (trip in ~" + Math.round(hrs) + "h)" : "";
  }
  const tourName = booking.tours?.name || "their tour";
  const messageBody = "\u{1F514} CHANGE REQUEST: " + (booking.customer_name || "Customer")
    + " has requested to " + requestedAction.toUpperCase() + " booking " + ref
    + " (" + tourName + ")" + hrsLabel + "."
    + (note ? "\n\nMessage: “" + note + "”" : "");

  // 1) Thread message so the operator sees it in the inbox conversation.
  await supabase.from("chat_messages").insert({
    business_id: booking.business_id,
    phone,
    direction: "IN",
    body: messageBody,
    sender: (booking.customer_name || "Customer") + " · change request",
  });

  // 2) Flip/ensure the conversation to HUMAN so it surfaces in the inbox list
  //    and the sidebar badge (which counts status='HUMAN').
  const { data: convo } = await supabase.from("conversations")
    .select("id").eq("business_id", booking.business_id).eq("phone", phone).maybeSingle();
  if (convo?.id) {
    await supabase.from("conversations").update({
      status: "HUMAN",
      customer_name: booking.customer_name || null,
      email: booking.email || null,
      updated_at: new Date().toISOString(),
    }).eq("id", convo.id);
  } else {
    await supabase.from("conversations").insert({
      business_id: booking.business_id,
      phone,
      status: "HUMAN",
      current_state: "IDLE",
      state_data: {},
      customer_name: booking.customer_name || null,
      email: booking.email || null,
    });
  }

  // 3) Email the operator (guaranteed delivery even if the dashboard is closed).
  let emailQueued = false;
  try {
    const { data: biz } = await supabase.from("businesses")
      .select("notification_email").eq("id", booking.business_id).maybeSingle();
    const opsEmail = String(biz?.notification_email || "").trim();
    if (opsEmail) {
      const emailRes = await fetch(SUPABASE_URL + "/functions/v1/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
        body: JSON.stringify({
          type: "OPERATOR_ALERT",
          data: {
            business_id: booking.business_id,
            email: opsEmail,
            heading: "Booking change request",
            intro: (booking.customer_name || "A customer") + " has asked to " + requestedAction + " their booking.",
            ref,
            tour_name: tourName,
            customer_name: booking.customer_name || "",
            customer_phone: phone,
            customer_email: booking.email || "",
            note: note || "",
            cta_label: "Open inbox",
            cta_path: "/inbox",
          },
        }),
      });
      emailQueued = emailRes.ok;
      if (!emailRes.ok) console.error("REQUEST_CHANGE_EMAIL_ERR status:" + emailRes.status);
    } else {
      console.warn("REQUEST_CHANGE: no notification_email for business " + booking.business_id);
    }
  } catch (e) {
    console.error("REQUEST_CHANGE_EMAIL_ERR:", e instanceof Error ? e.message : e);
  }

  await supabase.from("logs").insert({
    business_id: booking.business_id,
    booking_id: booking.id,
    event: "change_request",
    payload: { requested_action: requestedAction, note, email_queued: emailQueued },
  });

  return ok(req, { ok: true, action: "REQUEST_CHANGE", email_queued: emailQueued });
}

// ───── Helper: check if booking was paid via voucher ─────
function isVoucherPayment(booking: any): boolean {
  const pm = (booking.payment_method || "").toUpperCase();
  if (pm === "VOUCHER" || pm === "GIFT_VOUCHER") return true;
  // confirm_voucher_booking RPC stamps yoco_payment_id but never payment_method
  if (String(booking.yoco_payment_id || "") === "VOUCHER_WEB") return true;
  // payment_method is not reliably written — detect full-voucher funding from the data
  const voucherPaid = Number(booking.voucher_amount_paid || 0);
  return voucherPaid > 0 && voucherPaid >= Number(booking.total_amount || 0);
}

// ───── Helper: check if booking was paid via manual method (cash/EFT) ─────
function isManualPayment(booking: any): boolean {
  const pm = (booking.payment_method || "").toUpperCase();
  return pm === "MANUAL" || pm === "CASH" || pm === "EFT";
}

// ───── Helper: check if booking was paid via split tender (voucher + cash/Yoco) ─────
function isSplitTenderPayment(booking: any): boolean {
  const pm = (booking.payment_method || "").toUpperCase();
  if (pm === "SPLIT" || pm === "SPLIT_TENDER" || pm === "VOUCHER_PARTIAL") return true;
  // payment_method is not reliably written — detect a voucher+cash mix from the data.
  // Without this, mixed bookings fell through to the pure-cash branch and the
  // voucher portion was paid out as a Yoco cash refund.
  const voucherPaid = Number(booking.voucher_amount_paid || 0);
  return voucherPaid > 0 && voucherPaid < Number(booking.total_amount || 0);
}

// ───── Helper: derive voucher and cash portions from a booking ─────
function getSplitTenderAmounts(booking: any): { voucherPortion: number; cashPortion: number } {
  let voucherPortion = Number(booking.voucher_amount_paid || 0);
  let cashPortion = Number(booking.cash_amount_paid || 0);
  // cash_amount_paid is not reliably written — the cash portion is whatever the
  // voucher didn't cover of the full total.
  if (cashPortion === 0 && voucherPortion > 0) {
    cashPortion = Math.max(0, Number(booking.total_amount || 0) - voucherPortion);
  }
  // If split amounts are not explicitly stored, try to derive from total
  if (voucherPortion === 0 && cashPortion === 0) {
    const totalAmount = Number(booking.total_amount || 0);
    const totalCaptured = Number(booking.total_captured || 0);
    // total_captured represents Yoco portion; the rest was voucher
    if (totalCaptured > 0 && totalCaptured < totalAmount) {
      cashPortion = totalCaptured;
      voucherPortion = totalAmount - totalCaptured;
    }
  }
  return { voucherPortion, cashPortion };
}

// ───── CANCEL_REFUND ─────
async function handleCancelRefund(req: any, booking: any) {
  const totalAmount = Number(booking.total_amount || 0);

  // If paid via voucher only, issue a voucher at full value (no 5% penalty) instead of Yoco refund
  if (isVoucherPayment(booking)) {
    return await handleCancelRefundVoucher(req, booking, totalAmount);
  }

  // Calculate refund percent from policy tiers
  let policyPercent = 95;
  const tourStart = booking.slots?.start_time;
  if (tourStart && booking.business_id) {
    const { data: pctData } = await supabase.rpc("calculate_refund_percent", {
      p_business_id: booking.business_id,
      p_tour_start: tourStart,
    });
    if (typeof pctData === "number") policyPercent = pctData;
  }
  const policyFraction = policyPercent / 100;

  // If paid via split tender (voucher + Yoco), pro-rata the refund
  if (isSplitTenderPayment(booking)) {
    return await handleCancelRefundSplitTender(req, booking, totalAmount, policyPercent);
  }

  // If paid via manual method (cash/EFT), skip Yoco and flag for manual refund
  if (isManualPayment(booking)) {
    const totalCaptured = Number(booking.total_captured || totalAmount);
    const totalRefunded = Number(booking.total_refunded || 0);
    const refundableAmount = totalCaptured - totalRefunded;
    const manualRefundAmount = refundableAmount * policyFraction;

    await supabase.from("bookings").update({
      status: "CANCELLED",
      cancellation_reason: "Cancelled via web: manual/EFT refund required",
      cancelled_at: new Date().toISOString(),
      refund_status: "MANUAL_EFT_REQUIRED",
      refund_amount: manualRefundAmount,
      total_refunded: totalRefunded + manualRefundAmount,
    }).eq("id", booking.id);

    if (booking.slot_id) {
      const slotRes = await supabase.from("slots").select("booked").eq("id", booking.slot_id).single();
      if (slotRes.data) {
        // S7: atomic booked release (no read-modify-write)
        await supabase.rpc("adjust_slot_capacity", { p_slot_id: booking.slot_id, p_business_id: booking.business_id, p_booked_delta: -Number(booking.qty), p_held_delta: 0 });
      }
    }

    await supabase.from("holds").update({ status: "CANCELLED" }).eq("booking_id", booking.id).eq("status", "ACTIVE");

    await supabase.from("logs").insert({
      business_id: booking.business_id,
      booking_id: booking.id,
      event: "booking_cancelled_manual_refund",
      payload: { refund_amount: manualRefundAmount, total_amount: totalAmount, payment_method: booking.payment_method, policy_percent: policyPercent },
    });

    return ok(req, { ok: true, action: "CANCEL_REFUND", refund_status: "MANUAL_EFT_REQUIRED", refund_amount: manualRefundAmount, message: "Booking cancelled. Admin must process refund manually (payment was " + booking.payment_method + ")." });
  }

  const totalCaptured = Number(booking.total_captured || totalAmount);
  const totalRefunded = Number(booking.total_refunded || 0);
  const refundableAmount = totalCaptured - totalRefunded;
  const refundAmount = refundableAmount * policyFraction;

  // total_refunded is NOT bumped here — process-refund adds it when the money
  // actually moves; pre-counting made the refund queue see 0 refundable.
  await supabase.from("bookings").update({
    status: "CANCELLED",
    cancellation_reason: "Cancelled via web",
    cancelled_at: new Date().toISOString(),
    refund_status: "REQUESTED",
    refund_amount: refundAmount,
  }).eq("id", booking.id);

  // Release slot capacity
  if (booking.slot_id) {
    const slotRes = await supabase.from("slots").select("booked").eq("id", booking.slot_id).single();
    if (slotRes.data) {
      // S7: atomic booked release (no read-modify-write)
      await supabase.rpc("adjust_slot_capacity", { p_slot_id: booking.slot_id, p_business_id: booking.business_id, p_booked_delta: -Number(booking.qty), p_held_delta: 0 });
    }
  }

  // Cancel active holds
  await supabase.from("holds").update({ status: "CANCELLED" }).eq("booking_id", booking.id).eq("status", "ACTIVE");

  await supabase.from("logs").insert({
    business_id: booking.business_id,
    booking_id: booking.id,
    event: "booking_cancelled_refund",
    payload: { refund_amount: refundAmount, total_amount: totalAmount, policy_percent: policyPercent },
  });

  // Send cancellation notifications
  const tenant = await getTenantByBusinessId(supabase, booking.business_id);
  const ref = booking.id.substring(0, 8).toUpperCase();
  const tourName = (booking.tours && booking.tours.name) ? booking.tours.name : "Booking";
  const brandName = getBusinessDisplayName(tenant.business);
  const currency = tenant.business.currency || "ZAR";

  if (!booking.email && booking.phone) {
    try {
      await sendWhatsappTextForTenant(tenant, booking.phone,
        "Booking cancelled\n\n" +
        "Hi " + ((booking.customer_name && booking.customer_name.split(" ")[0]) || "there") + ", your booking " +
        tourName + " (Ref: " + ref + ") has been cancelled.\n\n" +
        "A refund of " + currency + " " + refundAmount.toFixed(2) + " has been requested.\n" +
        "Please allow 5 to 10 business days for it to reflect.\n\n" +
        "Thanks for choosing " + brandName + "."
      );
    } catch (e) { console.error("REBOOK_CANCEL_WA_ERR:", e); }
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
            start_time: (booking.slots && booking.slots.start_time) ? formatTenantDateTime(tenant.business, booking.slots.start_time) : "",
            reason: "Cancelled via web: refund requested",
            refund_amount: refundAmount.toFixed(2),
            total_amount: String(totalAmount.toFixed(2)),
            is_partial: false,
          },
        }),
      });
    } catch (e) { console.error("REBOOK_CANCEL_EMAIL_ERR:", e); }
  }

  return ok(req, { ok: true, action: "CANCEL_REFUND", refund_amount: refundAmount, policy_percent: policyPercent });
}

// ───── CANCEL_REFUND for voucher-paid bookings (issue voucher, no 5% penalty) ─────
async function handleCancelRefundVoucher(req: any, booking: any, totalAmount: number) {
  const vcode = genVoucherCode();

  const vr = await insertVoucherWithRetry({
    business_id: booking.business_id,
    code: vcode,
    status: "ACTIVE",
    type: "CREDIT",
    value: totalAmount,
    current_balance: totalAmount,
    source_booking_id: booking.id,
    expires_at: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (vr.error) return fail(req, "Voucher creation failed: " + vr.error.message, 500);

  const voucherId = (vr.data && vr.data.id) ? vr.data.id : null;

  await supabase.from("bookings").update({
    status: "CANCELLED",
    cancellation_reason: "Cancelled via web: voucher-paid, converted back to voucher",
    cancelled_at: new Date().toISOString(),
    converted_to_voucher_id: voucherId,
  }).eq("id", booking.id);

  // Release slot capacity
  if (booking.slot_id) {
    const slotRes = await supabase.from("slots").select("booked").eq("id", booking.slot_id).single();
    if (slotRes.data) {
      // S7: atomic booked release (no read-modify-write)
      await supabase.rpc("adjust_slot_capacity", { p_slot_id: booking.slot_id, p_business_id: booking.business_id, p_booked_delta: -Number(booking.qty), p_held_delta: 0 });
    }
  }

  // Cancel active holds
  await supabase.from("holds").update({ status: "CANCELLED" }).eq("booking_id", booking.id).eq("status", "ACTIVE");

  await supabase.from("logs").insert({
    business_id: booking.business_id,
    booking_id: booking.id,
    event: "booking_cancelled_voucher_refund",
    payload: { voucher_code: vcode, voucher_amount: totalAmount, voucher_id: voucherId, original_payment_method: booking.payment_method },
  });

  // Send voucher notification
  const tenant = await getTenantByBusinessId(supabase, booking.business_id);
  const ref = booking.id.substring(0, 8).toUpperCase();
  const tourName = (booking.tours && booking.tours.name) ? booking.tours.name : "Booking";
  const brandName = getBusinessDisplayName(tenant.business);
  const currency = tenant.business.currency || "ZAR";

  if (!booking.email && booking.phone) {
    try {
      await sendWhatsappTextForTenant(tenant, booking.phone,
        "Booking cancelled, voucher issued\n\n" +
        "Hi " + ((booking.customer_name && booking.customer_name.split(" ")[0]) || "there") + ", your booking " +
        tourName + " (Ref: " + ref + ") has been cancelled.\n\n" +
        "Since you paid with a voucher, a new voucher has been issued:\n" +
        "Voucher code: " + vcode + "\n" +
        "Value: " + currency + " " + totalAmount.toFixed(2) + "\n\n" +
        "Use this code when making your next booking with " + brandName + "."
      );
    } catch (e) { console.error("REBOOK_CANCEL_VOUCHER_WA_ERR:", e); }
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
            start_time: (booking.slots && booking.slots.start_time) ? formatTenantDateTime(tenant.business, booking.slots.start_time) : "",
            reason: "Cancelled via web: voucher issued (original payment was voucher)",
            voucher_code: vcode,
            voucher_amount: totalAmount.toFixed(2),
            total_amount: String(totalAmount.toFixed(2)),
            is_partial: false,
          },
        }),
      });
    } catch (e) { console.error("REBOOK_CANCEL_VOUCHER_EMAIL_ERR:", e); }
  }

  return ok(req, { ok: true, action: "CANCEL_REFUND", voucher_code: vcode, voucher_amount: totalAmount, payment_method: booking.payment_method });
}

// ───── CANCEL_REFUND for split-tender bookings (voucher + Yoco) ─────
// Pro-rata: restore voucher portion fully, deduct 5% cancellation fee from cash (Yoco) portion only
async function handleCancelRefundSplitTender(req: any, booking: any, totalAmount: number, policyPercent: number) {
  const split = getSplitTenderAmounts(booking);
  const cancellationFee = totalAmount * ((100 - policyPercent) / 100);
  let yocoRefundAmount = Math.max(0, split.cashPortion - cancellationFee);
  const totalRefunded = Number(booking.total_refunded || 0);

  // Cap Yoco refund at actual Yoco capture amount
  const totalCaptured = Number(booking.total_captured || split.cashPortion);
  const yocoRefundable = totalCaptured - totalRefunded;
  yocoRefundAmount = Math.min(yocoRefundAmount, yocoRefundable);

  // 1. Restore voucher portion fully (create new voucher)
  const vcode = genVoucherCode();
  const vr = await insertVoucherWithRetry({
    business_id: booking.business_id,
    code: vcode,
    status: "ACTIVE",
    type: "CREDIT",
    value: split.voucherPortion,
    current_balance: split.voucherPortion,
    source_booking_id: booking.id,
    expires_at: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (vr.error) return fail(req, "Voucher creation failed: " + vr.error.message, 500);

  const voucherId = (vr.data && vr.data.id) ? vr.data.id : null;

  // 2. Update booking status
  // total_refunded is NOT bumped here — process-refund adds it when the Yoco
  // refund actually executes; pre-counting made the queue see 0 refundable.
  await supabase.from("bookings").update({
    status: "CANCELLED",
    cancellation_reason: "Cancelled via web: split-tender refund (voucher restored + Yoco refund minus 5% fee)",
    cancelled_at: new Date().toISOString(),
    refund_status: yocoRefundAmount > 0 ? "REQUESTED" : "REFUNDED",
    refund_amount: yocoRefundAmount,
    converted_to_voucher_id: voucherId,
  }).eq("id", booking.id);

  // 3. Release slot capacity
  if (booking.slot_id) {
    const slotRes = await supabase.from("slots").select("booked").eq("id", booking.slot_id).single();
    if (slotRes.data) {
      // S7: atomic booked release (no read-modify-write)
      await supabase.rpc("adjust_slot_capacity", { p_slot_id: booking.slot_id, p_business_id: booking.business_id, p_booked_delta: -Number(booking.qty), p_held_delta: 0 });
    }
  }

  // 4. Cancel active holds
  await supabase.from("holds").update({ status: "CANCELLED" }).eq("booking_id", booking.id).eq("status", "ACTIVE");

  await supabase.from("logs").insert({
    business_id: booking.business_id,
    booking_id: booking.id,
    event: "booking_cancelled_split_tender_refund",
    payload: {
      total_amount: totalAmount,
      voucher_portion: split.voucherPortion,
      cash_portion: split.cashPortion,
      cancellation_fee: cancellationFee,
      yoco_refund_amount: yocoRefundAmount,
      voucher_code: vcode,
      voucher_id: voucherId,
      voucher_restored: split.voucherPortion,
      policy_percent: policyPercent,
    },
  });

  // 5. Send notifications
  const tenant = await getTenantByBusinessId(supabase, booking.business_id);
  const ref = booking.id.substring(0, 8).toUpperCase();
  const tourName = (booking.tours && booking.tours.name) ? booking.tours.name : "Booking";
  const brandName = getBusinessDisplayName(tenant.business);
  const currency = tenant.business.currency || "ZAR";

  if (!booking.email && booking.phone) {
    try {
      await sendWhatsappTextForTenant(tenant, booking.phone,
        "Booking cancelled, split refund\n\n" +
        "Hi " + ((booking.customer_name && booking.customer_name.split(" ")[0]) || "there") + ", your booking " +
        tourName + " (Ref: " + ref + ") has been cancelled.\n\n" +
        "Voucher restored: " + vcode + " (" + currency + " " + split.voucherPortion.toFixed(2) + ")\n" +
        (yocoRefundAmount > 0 ? "Card refund: " + currency + " " + yocoRefundAmount.toFixed(2) + " (after 5% cancellation fee)\nPlease allow 5 to 10 business days for the card refund to reflect.\n\n" : "\n") +
        "Thanks for choosing " + brandName + "."
      );
    } catch (e) { console.error("REBOOK_CANCEL_SPLIT_WA_ERR:", e); }
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
            start_time: (booking.slots && booking.slots.start_time) ? formatTenantDateTime(tenant.business, booking.slots.start_time) : "",
            reason: "Cancelled via web: split-tender refund",
            refund_amount: yocoRefundAmount.toFixed(2),
            voucher_code: vcode,
            voucher_amount: split.voucherPortion.toFixed(2),
            total_amount: String(totalAmount.toFixed(2)),
            is_partial: false,
          },
        }),
      });
    } catch (e) { console.error("REBOOK_CANCEL_SPLIT_EMAIL_ERR:", e); }
  }

  return ok(req, {
    ok: true,
    action: "CANCEL_REFUND",
    refund_amount: yocoRefundAmount,
    voucher_code: vcode,
    voucher_amount: split.voucherPortion,
    cancellation_fee: cancellationFee,
    payment_method: booking.payment_method,
  });
}

// ───── CANCEL_VOUCHER ─────
async function handleCancelVoucher(req: any, booking: any) {
  const totalAmount = Number(booking.total_amount || 0);
  const vcode = genVoucherCode();

  const vr = await insertVoucherWithRetry({
    business_id: booking.business_id,
    code: vcode,
    status: "ACTIVE",
    type: "CREDIT",
    value: totalAmount,
    current_balance: totalAmount,
    source_booking_id: booking.id,
    expires_at: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (vr.error) return fail(req, "Voucher creation failed: " + vr.error.message, 500);

  const voucherId = (vr.data && vr.data.id) ? vr.data.id : null;

  await supabase.from("bookings").update({
    status: "CANCELLED",
    cancellation_reason: "Converted to voucher via web",
    cancelled_at: new Date().toISOString(),
    converted_to_voucher_id: voucherId,
  }).eq("id", booking.id);

  // Release slot capacity
  if (booking.slot_id) {
    const slotRes = await supabase.from("slots").select("booked").eq("id", booking.slot_id).single();
    if (slotRes.data) {
      // S7: atomic booked release (no read-modify-write)
      await supabase.rpc("adjust_slot_capacity", { p_slot_id: booking.slot_id, p_business_id: booking.business_id, p_booked_delta: -Number(booking.qty), p_held_delta: 0 });
    }
  }

  // Cancel active holds
  await supabase.from("holds").update({ status: "CANCELLED" }).eq("booking_id", booking.id).eq("status", "ACTIVE");

  await supabase.from("logs").insert({
    business_id: booking.business_id,
    booking_id: booking.id,
    event: "booking_cancelled_voucher",
    payload: { voucher_code: vcode, voucher_amount: totalAmount, voucher_id: voucherId },
  });

  // Send voucher notification
  const tenant = await getTenantByBusinessId(supabase, booking.business_id);
  const ref = booking.id.substring(0, 8).toUpperCase();
  const tourName = (booking.tours && booking.tours.name) ? booking.tours.name : "Booking";
  const brandName = getBusinessDisplayName(tenant.business);
  const currency = tenant.business.currency || "ZAR";

  if (!booking.email && booking.phone) {
    try {
      await sendWhatsappTextForTenant(tenant, booking.phone,
        "Booking converted to voucher\n\n" +
        "Hi " + ((booking.customer_name && booking.customer_name.split(" ")[0]) || "there") + ", your booking " +
        tourName + " (Ref: " + ref + ") has been converted to a voucher.\n\n" +
        "Voucher code: " + vcode + "\n" +
        "Value: " + currency + " " + totalAmount.toFixed(2) + "\n\n" +
        "Use this code when making your next booking with " + brandName + "."
      );
    } catch (e) { console.error("REBOOK_VOUCHER_WA_ERR:", e); }
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
            start_time: (booking.slots && booking.slots.start_time) ? formatTenantDateTime(tenant.business, booking.slots.start_time) : "",
            reason: "Converted to voucher via web",
            voucher_code: vcode,
            voucher_amount: totalAmount.toFixed(2),
            total_amount: String(totalAmount.toFixed(2)),
            is_partial: false,
          },
        }),
      });
    } catch (e) { console.error("REBOOK_VOUCHER_EMAIL_ERR:", e); }
  }

  return ok(req, { ok: true, action: "CANCEL_VOUCHER", voucher_code: vcode, voucher_amount: totalAmount });
}

// ───── Notification helper ─────
async function sendRebookNotification(booking: any, event: string, message: string) {
  try {
    const tenant = await getTenantByBusinessId(supabase, booking.business_id);
    const ref = booking.id.substring(0, 8).toUpperCase();
    const tourName = (booking.tours && booking.tours.name) ? booking.tours.name : "Booking";
    const brandName = getBusinessDisplayName(tenant.business);
    const slotTime = (booking.slots && booking.slots.start_time)
      ? formatTenantDateTime(tenant.business, booking.slots.start_time)
      : "";

    if (!booking.email && booking.phone) {
      try {
        await sendWhatsappTextForTenant(tenant, booking.phone,
          "Booking updated\n\n" +
          "Hi " + ((booking.customer_name && booking.customer_name.split(" ")[0]) || "there") + ", " +
          message + "\n\n" +
          "Ref: " + ref + "\n" +
          tourName + (slotTime ? "\n" + slotTime : "") + "\n\n" +
          "Thanks, " + brandName + "."
        );
      } catch (e) { console.error("REBOOK_WA_ERR_" + event + ":", e); }
    }

    if (booking.email) {
      try {
        await fetch(SUPABASE_URL + "/functions/v1/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
          body: JSON.stringify({
            type: "BOOKING_UPDATED",
            data: {
              business_id: booking.business_id,
              email: booking.email,
              customer_name: booking.customer_name,
              ref: ref,
              tour_name: tourName,
              start_time: (booking.slots && booking.slots.start_time) ? formatTenantDateTime(tenant.business, booking.slots.start_time) : "",
              message: message,
              event: event,
            },
          }),
        });
      } catch (e) { console.error("REBOOK_EMAIL_ERR_" + event + ":", e); }
    }
  } catch (e) {
    console.error("REBOOK_NOTIFY_ERR_" + event + ":", e);
  }
}

// ───── CLAIM_CREDIT (weather/admin-cancelled booking — customer chooses voucher or refund) ─────
// The booking is already CANCELLED and its slot capacity already released, so this
// only resolves the outstanding credit (refund_amount) — no capacity changes here.
async function handleClaimCredit(req: any, booking: any, body: any) {
  const creditAction = String(body.credit_action || "");
  if (creditAction !== "VOUCHER" && creditAction !== "REFUND") {
    return fail(req, "credit_action must be VOUCHER or REFUND", 400);
  }
  const creditAmount = Number(booking.refund_amount || 0);

  const tenant = await getTenantByBusinessId(supabase, booking.business_id);
  const ref = booking.id.substring(0, 8).toUpperCase();
  const tourName = (booking.tours && booking.tours.name) ? booking.tours.name : "Booking";
  const brandName = getBusinessDisplayName(tenant.business);
  const currency = tenant.business.currency || "ZAR";

  // Cash refunds are impossible on voucher-paid bookings — issue a voucher instead.
  if (creditAction === "VOUCHER" || (creditAction === "REFUND" && isVoucherPayment(booking))) {
    const vcode = genVoucherCode();
    const vr = await insertVoucherWithRetry({
      business_id: booking.business_id,
      code: vcode,
      status: "ACTIVE",
      type: "CREDIT",
      value: creditAmount,
      current_balance: creditAmount,
      source_booking_id: booking.id,
      expires_at: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (vr.error) return fail(req, "Voucher creation failed: " + vr.error.message, 500);
    const voucherId = (vr.data && vr.data.id) ? vr.data.id : null;

    await supabase.from("bookings").update({
      refund_status: null,
      converted_to_voucher_id: voucherId,
      refund_notes: "Credit claimed as voucher " + vcode,
    }).eq("id", booking.id);

    await supabase.from("logs").insert({
      business_id: booking.business_id,
      booking_id: booking.id,
      event: "credit_claimed_voucher",
      payload: { voucher_code: vcode, voucher_amount: creditAmount, voucher_id: voucherId },
    });

    if (!booking.email && booking.phone) {
      try {
        await sendWhatsappTextForTenant(tenant, booking.phone,
          "Voucher issued\n\n" +
          "Hi " + ((booking.customer_name && booking.customer_name.split(" ")[0]) || "there") + ", the credit for your cancelled booking " +
          tourName + " (Ref: " + ref + ") has been converted to a voucher:\n" +
          "Voucher code: " + vcode + "\n" +
          "Value: " + currency + " " + creditAmount.toFixed(2) + "\n\n" +
          "Use this code when making your next booking with " + brandName + "."
        );
      } catch (e) { console.error("CLAIM_CREDIT_VOUCHER_WA_ERR:", e); }
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
              start_time: (booking.slots && booking.slots.start_time) ? formatTenantDateTime(tenant.business, booking.slots.start_time) : "",
              reason: "Credit claimed: voucher issued",
              voucher_code: vcode,
              voucher_amount: creditAmount.toFixed(2),
              total_amount: String(creditAmount.toFixed(2)),
              is_partial: false,
            },
          }),
        });
      } catch (e) { console.error("CLAIM_CREDIT_VOUCHER_EMAIL_ERR:", e); }
    }

    return ok(req, { ok: true, action: "CLAIM_CREDIT", voucher_code: vcode, voucher_amount: creditAmount });
  }

  // REFUND — request against the amount set at cancellation time (weather = 100%)
  // Split-tender: the voucher-funded portion can never be cash-refunded (it was
  // never captured by Yoco), so reissue it as a voucher first and only refund
  // the cash portion. Without this the voucher value was silently lost.
  const voucherPortion = isSplitTenderPayment(booking)
    ? Math.min(getSplitTenderAmounts(booking).voucherPortion, creditAmount)
    : 0;
  let splitVoucherCode: string | null = null;
  let splitVoucherId: string | null = null;
  if (voucherPortion > 0) {
    const svCode = genVoucherCode();
    const svr = await insertVoucherWithRetry({
      business_id: booking.business_id,
      code: svCode,
      status: "ACTIVE",
      type: "CREDIT",
      value: voucherPortion,
      current_balance: voucherPortion,
      source_booking_id: booking.id,
      expires_at: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (svr.error) return fail(req, "Voucher creation failed: " + svr.error.message, 500);
    splitVoucherCode = svCode;
    splitVoucherId = (svr.data && svr.data.id) ? svr.data.id : null;
  }

  const cashCredit = Math.max(0, creditAmount - voucherPortion);
  const totalCaptured = Number(booking.total_captured || booking.total_amount || 0);
  const totalRefunded = Number(booking.total_refunded || 0);
  const refundAmount = isManualPayment(booking)
    ? cashCredit
    : Math.min(cashCredit, Math.max(0, totalCaptured - totalRefunded));
  if (refundAmount <= 0 && !splitVoucherCode) {
    return fail(req, "No refundable amount remaining on this booking", 400);
  }
  const refundStatus = refundAmount <= 0 ? null : isManualPayment(booking) ? "MANUAL_EFT_REQUIRED" : "REQUESTED";

  // total_refunded is NOT bumped here — process-refund adds it on success
  await supabase.from("bookings").update({
    refund_status: refundStatus,
    refund_amount: refundAmount,
    ...(splitVoucherId ? {
      converted_to_voucher_id: splitVoucherId,
      refund_notes: "Voucher portion reissued as " + splitVoucherCode + "; cash portion " + (refundAmount > 0 ? "refund requested" : "already refunded"),
    } : {}),
  }).eq("id", booking.id);

  await supabase.from("logs").insert({
    business_id: booking.business_id,
    booking_id: booking.id,
    event: "credit_claimed_refund",
    payload: {
      refund_amount: refundAmount,
      refund_status: refundStatus,
      payment_method: booking.payment_method || null,
      voucher_restored: voucherPortion,
      voucher_code: splitVoucherCode,
      voucher_id: splitVoucherId,
    },
  });

  if (!booking.email && booking.phone) {
    try {
      await sendWhatsappTextForTenant(tenant, booking.phone,
        "Refund requested\n\n" +
        "Hi " + ((booking.customer_name && booking.customer_name.split(" ")[0]) || "there") + ", a refund of " +
        currency + " " + refundAmount.toFixed(2) + " has been requested for your cancelled booking " +
        tourName + " (Ref: " + ref + ").\n" +
        "Please allow 5 to 10 business days for it to reflect.\n\n" +
        (splitVoucherCode
          ? "The " + currency + " " + voucherPortion.toFixed(2) + " you paid by voucher has been restored as a new voucher:\n" +
            "Voucher code: " + splitVoucherCode + "\n" +
            "Use it on your next booking with " + brandName + ".\n\n"
          : "") +
        "Thanks for choosing " + brandName + "."
      );
    } catch (e) { console.error("CLAIM_CREDIT_REFUND_WA_ERR:", e); }
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
            start_time: (booking.slots && booking.slots.start_time) ? formatTenantDateTime(tenant.business, booking.slots.start_time) : "",
            // No "weather" in the reason: this confirms the customer's refund
            // choice, so the email must show the refund confirmation, not options.
            reason: "Credit claimed: refund requested",
            refund_amount: refundAmount.toFixed(2),
            ...(splitVoucherCode ? {
              voucher_code: splitVoucherCode,
              voucher_amount: voucherPortion.toFixed(2),
            } : {}),
            total_amount: String(creditAmount.toFixed(2)),
            is_partial: false,
          },
        }),
      });
    } catch (e) { console.error("CLAIM_CREDIT_REFUND_EMAIL_ERR:", e); }
  }

  return ok(req, {
    ok: true,
    action: "CLAIM_CREDIT",
    refund_status: refundStatus,
    refund_amount: refundAmount,
    ...(splitVoucherCode ? { voucher_code: splitVoucherCode, voucher_amount: voucherPortion } : {}),
  });
}

// ───── Main handler ─────
Deno.serve(async function (req: any) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCors(req) });

  try {
    const body = await req.json();
    const bookingId = String(body.booking_id || "");
    const action = String(body.action || "");

    if (!bookingId) return fail(req, "booking_id required", 400);
    if (!action) return fail(req, "action required", 400);

    const validActions = ["RESCHEDULE", "ADD_GUESTS", "REMOVE_GUESTS", "UPDATE_CONTACT", "SPECIAL_REQUEST", "REQUEST_CHANGE", "CANCEL_REFUND", "CANCEL_VOUCHER", "CLAIM_CREDIT"];
    if (validActions.indexOf(action) === -1) {
      return fail(req, "Invalid action. Must be one of: " + validActions.join(", "), 400);
    }

    const br = await supabase
      .from("bookings")
      .select("*, slots(start_time, capacity_total, booked, held, price_per_person_override), tours(name, base_price_per_person)")
      .eq("id", bookingId)
      .single();

    if (br.error || !br.data) return fail(req, "Booking not found", 404);
    const booking = br.data;

    const authz = await authorizeCaller(req, body, booking);
    if (authz.ok !== true) return fail(req, authz.message, authz.status);

    // Combo legs: the offer's cancellation policy and date rules govern
    // self-service changes. Ordinary bookings resolve to null and fall
    // straight through — this is the single enforcement point for every
    // customer-reachable cancel/reschedule door.
    const comboCtx = (booking.is_combo || booking.combo_booking_id)
      ? await getComboLegPolicy(supabase, booking)
      : null;
    if (comboCtx) {
      const policy = comboCtx.cancellation_policy;
      if (policy === "NO_CANCEL" && (action === "CANCEL_REFUND" || action === "CANCEL_VOUCHER")) {
        return fail(req, "This booking is part of a non-cancellable combo package. Contact the operator if your plans have changed.", 400);
      }
      if (policy !== "POLICY_REFUND") {
        if (action === "CANCEL_REFUND") {
          return fail(req, "This combo package is refundable as a credit voucher only. Choose the voucher option instead.", 400);
        }
        // Operator-cancelled leg: compensation choice still excludes cash.
        // (Voucher-paid bookings already convert REFUND to a voucher inside
        // the handler, so they pass through untouched.)
        if (action === "CLAIM_CREDIT" && String(body.credit_action || "") === "REFUND" && !isVoucherPayment(booking)) {
          return fail(req, "This combo package is refundable as a credit voucher only. Choose the voucher option.", 400);
        }
      }
      if (action === "RESCHEDULE" && body.new_slot_id) {
        // The new date must still satisfy the offer's gap/order rules against
        // the OTHER legs' current dates.
        const { data: proposedSlot } = await supabase
          .from("slots").select("id, start_time").eq("id", String(body.new_slot_id)).maybeSingle();
        if (proposedSlot?.start_time) {
          const legDates: string[] = [];
          for (const leg of comboCtx.legs) {
            if (String(leg.id) === String(booking.id)) legDates.push(String(proposedSlot.start_time));
            else if (leg.slots?.start_time && leg.status !== "CANCELLED") legDates.push(String(leg.slots.start_time));
          }
          const dateCheck = validateComboDates(comboCtx.combo_rules, legDates);
          if (!dateCheck.ok) {
            return fail(req, dateCheck.error + " Your other combo booking stays as it is, so pick a date that fits.", 400);
          }
        }
      }
    }

    // Weather/admin-cancelled bookings awaiting a customer decision may claim
    // their credit (voucher/refund) or pick a new date with it.
    const claimEligible = booking.status === "CANCELLED"
      && String(booking.refund_status || "") === "ACTION_REQUIRED"
      && Number(booking.refund_amount || 0) > 0
      && !booking.converted_to_voucher_id;

    if (action === "CLAIM_CREDIT") {
      if (!claimEligible) return fail(req, "No claimable credit on this booking", 400);
      return await handleClaimCredit(req, booking, body);
    }

    // For modification actions, booking must be in a modifiable state.
    // UPDATE_CONTACT / SPECIAL_REQUEST / REQUEST_CHANGE are messages/metadata,
    // not booking mutations, so they're allowed on any active booking.
    if (action !== "UPDATE_CONTACT" && action !== "SPECIAL_REQUEST" && action !== "REQUEST_CHANGE") {
      // RESCHEDULE is allowed on any cancelled booking: claim-eligible ones
      // consume their parked credit; settled ones (refund/voucher already
      // issued) pay the full new price via the upgrade payment-link path.
      // Unpaid bookings (admin-created PENDING etc.) may be rescheduled and
      // have their party size changed — no money has moved, so those paths
      // skip all refund/uplift mechanics (see isUnpaidBooking branches).
      if (!["PAID", "CONFIRMED", "COMPLETED"].includes(booking.status)
        && !(action === "RESCHEDULE" && booking.status === "CANCELLED")
        && !(isUnpaidBooking(booking) && ["RESCHEDULE", "ADD_GUESTS", "REMOVE_GUESTS"].includes(action))) {
        return fail(req, "Booking is not in a modifiable state (status: " + booking.status + ")", 400);
      }
    }

    if (action === "RESCHEDULE") return await handleReschedule(req, booking, body, claimEligible);
    if (action === "ADD_GUESTS") return await handleAddGuests(req, booking, body);
    if (action === "REMOVE_GUESTS") return await handleRemoveGuests(req, booking, body);
    if (action === "UPDATE_CONTACT") return await handleUpdateContact(req, booking, body);
    if (action === "SPECIAL_REQUEST") return await handleSpecialRequest(req, booking, body);
    if (action === "REQUEST_CHANGE") return await handleRequestChange(req, booking, body);
    if (action === "CANCEL_REFUND") return await handleCancelRefund(req, booking);
    if (action === "CANCEL_VOUCHER") return await handleCancelVoucher(req, booking);

    return fail(req, "Unhandled action", 400);
  } catch (err: any) {
    console.error("REBOOK_BOOKING_ERR:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: getCors(req) });
  }
});
