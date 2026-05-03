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

var SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
var SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
var supabase = createServiceClient();

function getCors(req?: any) {
  var origin = (req && req.headers) ? req.headers.get("origin") || "" : "";
  // Allow any origin — this is a customer-facing function invoked from booking sites
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

function genVoucherCode() {
  var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var code = "";
  for (var i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

// Insert a voucher with retry on unique constraint violation (code collision)
async function insertVoucherWithRetry(payload: any, maxRetries = 5) {
  for (var attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) payload.code = genVoucherCode();
    var { data, error } = await supabase.from("vouchers").insert(payload).select().single();
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

// ───── RESCHEDULE ─────
async function handleReschedule(req: any, booking: any, body: any) {
  var newSlotId = body.new_slot_id;
  if (!newSlotId) return fail(req, "new_slot_id required for RESCHEDULE", 400);

  var slotRes = await supabase
    .from("slots")
    .select("id, tour_id, start_time, capacity_total, booked, held, price_per_person_override")
    .eq("id", newSlotId)
    .single();
  if (slotRes.error || !slotRes.data) return fail(req, "New slot not found", 404);
  var newSlot = slotRes.data;

  // Enforce same-activity rescheduling: new slot must be for the same tour
  if (newSlot.tour_id !== booking.tour_id) {
    return fail(req, "Cannot reschedule to a different activity", 400);
  }

  var available = newSlot.capacity_total - (newSlot.booked || 0) - (newSlot.held || 0);
  if (available < booking.qty) return fail(req, "Not enough capacity on new slot (" + available + " available, need " + booking.qty + ")", 400);

  // Calculate price diff
  var oldUnitPrice = Number(booking.unit_price || 0);
  var newTourRes = await supabase.from("tours").select("base_price_per_person").eq("id", newSlot.tour_id).single();
  var newBasePrice = (newTourRes.data && newTourRes.data.base_price_per_person) ? Number(newTourRes.data.base_price_per_person) : oldUnitPrice;
  var newUnitPrice = (newSlot.price_per_person_override != null) ? Number(newSlot.price_per_person_override) : newBasePrice;
  var newTotalAmount = newUnitPrice * booking.qty;
  var diff = newTotalAmount - Number(booking.total_amount || 0);

  var result: any = { ok: true, action: "RESCHEDULE", diff: diff };

  if (diff > 0) {
    // ── UPGRADE: customer owes more ──
    // Do NOT release old slot or update booking yet.
    // Create a hold on the new slot and a pending_reschedule record.
    // The actual swap happens only when payment is confirmed (yoco-webhook).

    // 1. Create a 15-minute hold on the new slot
    var holdExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    var holdRes = await supabase.from("holds").insert({
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

    // 2. Increment held count on new slot
    var heldSlotRes = await supabase.from("slots").select("held").eq("id", newSlotId).single();
    if (heldSlotRes.data) {
      await supabase.from("slots").update({ held: (heldSlotRes.data.held || 0) + booking.qty }).eq("id", newSlotId);
    }

    // 3. Create pending_reschedule record
    var pendingRes = await supabase.from("pending_reschedules").insert({
      booking_id: booking.id,
      business_id: booking.business_id,
      old_slot_id: booking.slot_id,
      new_slot_id: newSlotId,
      hold_id: holdRes.data.id,
      diff: diff,
      new_unit_price: newUnitPrice,
      new_total_amount: newTotalAmount,
      new_tour_id: newSlot.tour_id,
      status: "PENDING",
    }).select().single();

    if (pendingRes.error) {
      console.error("PENDING_RESCHEDULE_INSERT_ERR:", pendingRes.error);
      // Clean up the hold we just created
      await supabase.from("holds").update({ status: "CANCELLED" }).eq("id", holdRes.data.id);
      if (heldSlotRes.data) {
        await supabase.from("slots").update({ held: Math.max(0, (heldSlotRes.data.held || 0)) }).eq("id", newSlotId);
      }
      return fail(req, "Failed to create pending reschedule", 500);
    }

    // 4. Create checkout with reschedule metadata
    var checkoutRes = await fetch(SUPABASE_URL + "/functions/v1/create-checkout", {
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
    var checkoutData = await checkoutRes.json();
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

    // Decrement old slot booked count
    var oldSlotRes = await supabase.from("slots").select("booked").eq("id", booking.slot_id).single();
    if (oldSlotRes.data) {
      await supabase.from("slots").update({ booked: Math.max(0, oldSlotRes.data.booked - booking.qty) }).eq("id", booking.slot_id);
    }

    // Increment new slot booked count
    await supabase.from("slots").update({ booked: (newSlot.booked || 0) + booking.qty }).eq("id", newSlotId);

    // Update booking
    var updateData: any = {
      slot_id: newSlotId,
      tour_id: newSlot.tour_id,
      unit_price: newUnitPrice,
      total_amount: newTotalAmount,
    };
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

    if (diff < 0 && body.excess_action === "REFUND") {
      // If paid via voucher, block cash refund — must use voucher credit
      if (isVoucherPayment(booking)) {
        return fail(req, "Cannot issue a cash refund on a voucher-paid booking. Use VOUCHER as the excess_action instead.", 400);
      }
      // If paid via manual method, flag for manual refund
      if (isManualPayment(booking)) {
        var manualDiffRefund = Math.abs(diff) * 0.95;
        await supabase.from("bookings").update({
          refund_status: "MANUAL_EFT_REQUIRED",
          refund_amount: manualDiffRefund,
          total_refunded: Number(booking.total_refunded || 0) + manualDiffRefund,
        }).eq("id", booking.id);
        result.refund_amount = manualDiffRefund;
        result.refund_status = "MANUAL_EFT_REQUIRED";
      } else {
        var rescheduleTotalCaptured = Number(booking.total_captured || booking.total_amount || 0);
        var rescheduleTotalRefunded = Number(booking.total_refunded || 0);
        var rescheduleRefundable = rescheduleTotalCaptured - rescheduleTotalRefunded;
        var refundAmount = Math.min(Math.abs(diff) * 0.95, rescheduleRefundable);
        await supabase.from("bookings").update({
          refund_status: "REQUESTED",
          refund_amount: refundAmount,
          total_refunded: rescheduleTotalRefunded + refundAmount,
        }).eq("id", booking.id);
        result.refund_amount = refundAmount;
      }
    } else if (diff < 0 && body.excess_action === "VOUCHER") {
      var voucherAmount = Math.abs(diff);
      var vcode = genVoucherCode();
      var vResult = await insertVoucherWithRetry({
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
    }

    // Send notifications only for immediate swaps
    await sendRebookNotification(booking, "rescheduled", "Your booking has been moved to a new date/time.");
  }

  return ok(req, result);
}

// ───── ADD_GUESTS ─────
async function handleAddGuests(req: any, booking: any, body: any) {
  var newQty = Number(body.new_qty || 0);
  if (newQty <= booking.qty) return fail(req, "new_qty must be greater than current qty (" + booking.qty + ")", 400);

  var additionalGuests = newQty - booking.qty;
  var unitPrice = Number(booking.unit_price || 0);
  var additionalCost = additionalGuests * unitPrice;
  var newTotal = Number(booking.total_amount || 0) + additionalCost;

  // Atomic capacity check + hold for the additional guests
  var holdExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  var holdResult = await supabase.rpc("create_hold_with_capacity_check", {
    p_booking_id: booking.id,
    p_slot_id: booking.slot_id,
    p_qty: additionalGuests,
    p_expires_at: holdExpiry,
  });

  if (holdResult.error || !holdResult.data?.success) {
    return fail(req, holdResult.data?.error || "Not enough spots available", 400);
  }

  var holdId = holdResult.data.hold_id;

  await supabase.from("logs").insert({
    business_id: booking.business_id,
    booking_id: booking.id,
    event: "guests_added_pending_payment",
    payload: { old_qty: booking.qty, new_qty: newQty, additional_cost: additionalCost, hold_id: holdId },
  });

  var result: any = { ok: true, action: "ADD_GUESTS", diff: additionalCost, hold_id: holdId };

  // Create checkout for additional amount — pass hold_id so yoco-webhook can convert it
  var checkoutRes = await fetch(SUPABASE_URL + "/functions/v1/create-checkout", {
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
  var checkoutData = await checkoutRes.json();
  if (checkoutData && checkoutData.redirectUrl) {
    result.payment_url = checkoutData.redirectUrl;
  }

  return ok(req, result);
}

// ───── REMOVE_GUESTS ─────
async function handleRemoveGuests(req: any, booking: any, body: any) {
  var newQty = Number(body.new_qty || 0);
  if (newQty < 1) return fail(req, "new_qty must be at least 1", 400);
  if (newQty >= booking.qty) return fail(req, "new_qty must be less than current qty (" + booking.qty + ")", 400);

  // Block guest removal within 24 hours of departure (prevents cancellation loophole)
  if (booking.slots?.start_time) {
    var hoursUntilTrip = (new Date(booking.slots.start_time).getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursUntilTrip < 24 && hoursUntilTrip > 0) {
      return fail(req, "Guest changes are not allowed within 24 hours of departure", 400);
    }
  }

  var removedGuests = booking.qty - newQty;
  // Use pro-rata discount math: divide total_amount by current guest count
  // to find the true discounted per-person price (not the base unit_price)
  var totalAmountPaid = Number(booking.total_amount || 0);
  var discountedUnitPrice = booking.qty > 0 ? totalAmountPaid / booking.qty : Number(booking.unit_price || 0);
  var excessAmount = removedGuests * discountedUnitPrice;
  var newTotal = totalAmountPaid - excessAmount;

  await supabase.from("bookings").update({
    qty: newQty,
    total_amount: newTotal,
  }).eq("id", booking.id);

  // Decrement slot booked count
  var slotRes = await supabase.from("slots").select("booked").eq("id", booking.slot_id).single();
  if (slotRes.data) {
    await supabase.from("slots").update({
      booked: Math.max(0, (slotRes.data.booked || 0) - removedGuests),
    }).eq("id", booking.slot_id);
  }

  await supabase.from("logs").insert({
    business_id: booking.business_id,
    booking_id: booking.id,
    event: "guests_removed",
    payload: { old_qty: booking.qty, new_qty: newQty, excess_amount: excessAmount, excess_action: body.excess_action },
  });

  var result: any = { ok: true, action: "REMOVE_GUESTS" };

  if (body.excess_action === "REFUND") {
    // If paid via voucher, issue voucher at full value (no 5% penalty) instead of Yoco refund
    if (isVoucherPayment(booking)) {
      var vcode = genVoucherCode();
      var vResult = await insertVoucherWithRetry({
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
      result.payment_method = booking.payment_method;
    } else if (isManualPayment(booking)) {
      var manualRefund = excessAmount * 0.95;
      await supabase.from("bookings").update({
        refund_status: "MANUAL_EFT_REQUIRED",
        refund_amount: manualRefund,
        total_refunded: Number(booking.total_refunded || 0) + manualRefund,
      }).eq("id", booking.id);
      result.refund_amount = manualRefund;
      result.refund_status = "MANUAL_EFT_REQUIRED";
    } else {
      var guestTotalCaptured = Number(booking.total_captured || booking.total_amount || 0);
      var guestTotalRefunded = Number(booking.total_refunded || 0);
      var guestRefundable = guestTotalCaptured - guestTotalRefunded;
      var refundAmount = Math.min(excessAmount * 0.95, guestRefundable);
      await supabase.from("bookings").update({
        refund_status: "REQUESTED",
        refund_amount: refundAmount,
        total_refunded: guestTotalRefunded + refundAmount,
      }).eq("id", booking.id);
      result.refund_amount = refundAmount;
    }
  } else if (body.excess_action === "VOUCHER") {
    var vcode = genVoucherCode();
    var vResult = await insertVoucherWithRetry({
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
  var updateData: any = {};
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
  var specialRequests = body.special_requests || "";
  if (!specialRequests) return fail(req, "special_requests required", 400);

  var existingFields = booking.custom_fields || {};
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

// ───── Helper: check if booking was paid via voucher ─────
function isVoucherPayment(booking: any): boolean {
  var pm = (booking.payment_method || "").toUpperCase();
  return pm === "VOUCHER" || pm === "GIFT_VOUCHER";
}

// ───── Helper: check if booking was paid via manual method (cash/EFT) ─────
function isManualPayment(booking: any): boolean {
  var pm = (booking.payment_method || "").toUpperCase();
  return pm === "MANUAL" || pm === "CASH" || pm === "EFT";
}

// ───── Helper: check if booking was paid via split tender (voucher + cash/Yoco) ─────
function isSplitTenderPayment(booking: any): boolean {
  var pm = (booking.payment_method || "").toUpperCase();
  return pm === "SPLIT" || pm === "SPLIT_TENDER" || pm === "VOUCHER_PARTIAL";
}

// ───── Helper: derive voucher and cash portions from a booking ─────
function getSplitTenderAmounts(booking: any): { voucherPortion: number; cashPortion: number } {
  var voucherPortion = Number(booking.voucher_amount_paid || 0);
  var cashPortion = Number(booking.cash_amount_paid || 0);
  // If split amounts are not explicitly stored, try to derive from total
  if (voucherPortion === 0 && cashPortion === 0) {
    var totalAmount = Number(booking.total_amount || 0);
    var totalCaptured = Number(booking.total_captured || 0);
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
  var totalAmount = Number(booking.total_amount || 0);

  // If paid via voucher only, issue a voucher at full value (no 5% penalty) instead of Yoco refund
  if (isVoucherPayment(booking)) {
    return await handleCancelRefundVoucher(req, booking, totalAmount);
  }

  // If paid via split tender (voucher + Yoco), pro-rata the refund
  if (isSplitTenderPayment(booking)) {
    return await handleCancelRefundSplitTender(req, booking, totalAmount);
  }

  // If paid via manual method (cash/EFT), skip Yoco and flag for manual refund
  if (isManualPayment(booking)) {
    var manualRefundAmount = totalAmount * 0.95;
    var totalCaptured = Number(booking.total_captured || totalAmount);
    var totalRefunded = Number(booking.total_refunded || 0);
    var refundableAmount = totalCaptured - totalRefunded;
    manualRefundAmount = refundableAmount * 0.95;

    await supabase.from("bookings").update({
      status: "CANCELLED",
      cancellation_reason: "Cancelled via web — manual/EFT refund required",
      cancelled_at: new Date().toISOString(),
      refund_status: "MANUAL_EFT_REQUIRED",
      refund_amount: manualRefundAmount,
      total_refunded: totalRefunded + manualRefundAmount,
    }).eq("id", booking.id);

    if (booking.slot_id) {
      var slotRes = await supabase.from("slots").select("booked").eq("id", booking.slot_id).single();
      if (slotRes.data) {
        await supabase.from("slots").update({
          booked: Math.max(0, (slotRes.data.booked || 0) - booking.qty),
        }).eq("id", booking.slot_id);
      }
    }

    await supabase.from("holds").update({ status: "CANCELLED" }).eq("booking_id", booking.id).eq("status", "ACTIVE");

    await supabase.from("logs").insert({
      business_id: booking.business_id,
      booking_id: booking.id,
      event: "booking_cancelled_manual_refund",
      payload: { refund_amount: manualRefundAmount, total_amount: totalAmount, payment_method: booking.payment_method },
    });

    return ok(req, { ok: true, action: "CANCEL_REFUND", refund_status: "MANUAL_EFT_REQUIRED", refund_amount: manualRefundAmount, message: "Booking cancelled. Admin must process refund manually (payment was " + booking.payment_method + ")." });
  }

  var totalCaptured = Number(booking.total_captured || totalAmount);
  var totalRefunded = Number(booking.total_refunded || 0);
  var refundableAmount = totalCaptured - totalRefunded;
  var refundAmount = refundableAmount * 0.95;

  await supabase.from("bookings").update({
    status: "CANCELLED",
    cancellation_reason: "Cancelled via web",
    cancelled_at: new Date().toISOString(),
    refund_status: "REQUESTED",
    refund_amount: refundAmount,
    total_refunded: totalRefunded + refundAmount,
  }).eq("id", booking.id);

  // Release slot capacity
  if (booking.slot_id) {
    var slotRes = await supabase.from("slots").select("booked").eq("id", booking.slot_id).single();
    if (slotRes.data) {
      await supabase.from("slots").update({
        booked: Math.max(0, (slotRes.data.booked || 0) - booking.qty),
      }).eq("id", booking.slot_id);
    }
  }

  // Cancel active holds
  await supabase.from("holds").update({ status: "CANCELLED" }).eq("booking_id", booking.id).eq("status", "ACTIVE");

  await supabase.from("logs").insert({
    business_id: booking.business_id,
    booking_id: booking.id,
    event: "booking_cancelled_refund",
    payload: { refund_amount: refundAmount, total_amount: totalAmount },
  });

  // Send cancellation notifications
  var tenant = await getTenantByBusinessId(supabase, booking.business_id);
  var ref = booking.id.substring(0, 8).toUpperCase();
  var tourName = (booking.tours && booking.tours.name) ? booking.tours.name : "Booking";
  var brandName = getBusinessDisplayName(tenant.business);
  var currency = tenant.business.currency || "ZAR";

  if (booking.phone) {
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
            start_time: (booking.slots && booking.slots.start_time) ? booking.slots.start_time : "",
            reason: "Cancelled via web — refund requested",
            refund_amount: refundAmount.toFixed(2),
            total_amount: String(totalAmount.toFixed(2)),
            is_partial: false,
          },
        }),
      });
    } catch (e) { console.error("REBOOK_CANCEL_EMAIL_ERR:", e); }
  }

  return ok(req, { ok: true, action: "CANCEL_REFUND", refund_amount: refundAmount });
}

// ───── CANCEL_REFUND for voucher-paid bookings (issue voucher, no 5% penalty) ─────
async function handleCancelRefundVoucher(req: any, booking: any, totalAmount: number) {
  var vcode = genVoucherCode();

  var vr = await insertVoucherWithRetry({
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

  var voucherId = (vr.data && vr.data.id) ? vr.data.id : null;

  await supabase.from("bookings").update({
    status: "CANCELLED",
    cancellation_reason: "Cancelled via web — voucher-paid, converted back to voucher",
    cancelled_at: new Date().toISOString(),
    converted_to_voucher_id: voucherId,
  }).eq("id", booking.id);

  // Release slot capacity
  if (booking.slot_id) {
    var slotRes = await supabase.from("slots").select("booked").eq("id", booking.slot_id).single();
    if (slotRes.data) {
      await supabase.from("slots").update({
        booked: Math.max(0, (slotRes.data.booked || 0) - booking.qty),
      }).eq("id", booking.slot_id);
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
  var tenant = await getTenantByBusinessId(supabase, booking.business_id);
  var ref = booking.id.substring(0, 8).toUpperCase();
  var tourName = (booking.tours && booking.tours.name) ? booking.tours.name : "Booking";
  var brandName = getBusinessDisplayName(tenant.business);
  var currency = tenant.business.currency || "ZAR";

  if (booking.phone) {
    try {
      await sendWhatsappTextForTenant(tenant, booking.phone,
        "Booking cancelled — voucher issued\n\n" +
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
            start_time: (booking.slots && booking.slots.start_time) ? booking.slots.start_time : "",
            reason: "Cancelled via web — voucher issued (original payment was voucher)",
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
async function handleCancelRefundSplitTender(req: any, booking: any, totalAmount: number) {
  var split = getSplitTenderAmounts(booking);
  var cancellationFee = totalAmount * 0.05; // 5% of TOTAL booking
  var yocoRefundAmount = Math.max(0, split.cashPortion - cancellationFee);
  var totalRefunded = Number(booking.total_refunded || 0);

  // Cap Yoco refund at actual Yoco capture amount
  var totalCaptured = Number(booking.total_captured || split.cashPortion);
  var yocoRefundable = totalCaptured - totalRefunded;
  yocoRefundAmount = Math.min(yocoRefundAmount, yocoRefundable);

  // 1. Restore voucher portion fully (create new voucher)
  var vcode = genVoucherCode();
  var vr = await insertVoucherWithRetry({
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

  var voucherId = (vr.data && vr.data.id) ? vr.data.id : null;

  // 2. Update booking status
  await supabase.from("bookings").update({
    status: "CANCELLED",
    cancellation_reason: "Cancelled via web — split-tender refund (voucher restored + Yoco refund minus 5% fee)",
    cancelled_at: new Date().toISOString(),
    refund_status: yocoRefundAmount > 0 ? "REQUESTED" : "REFUNDED",
    refund_amount: yocoRefundAmount,
    total_refunded: totalRefunded + yocoRefundAmount,
    converted_to_voucher_id: voucherId,
  }).eq("id", booking.id);

  // 3. Release slot capacity
  if (booking.slot_id) {
    var slotRes = await supabase.from("slots").select("booked").eq("id", booking.slot_id).single();
    if (slotRes.data) {
      await supabase.from("slots").update({
        booked: Math.max(0, (slotRes.data.booked || 0) - booking.qty),
      }).eq("id", booking.slot_id);
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
    },
  });

  // 5. Send notifications
  var tenant = await getTenantByBusinessId(supabase, booking.business_id);
  var ref = booking.id.substring(0, 8).toUpperCase();
  var tourName = (booking.tours && booking.tours.name) ? booking.tours.name : "Booking";
  var brandName = getBusinessDisplayName(tenant.business);
  var currency = tenant.business.currency || "ZAR";

  if (booking.phone) {
    try {
      await sendWhatsappTextForTenant(tenant, booking.phone,
        "Booking cancelled — split refund\n\n" +
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
            start_time: (booking.slots && booking.slots.start_time) ? booking.slots.start_time : "",
            reason: "Cancelled via web — split-tender refund",
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
  var totalAmount = Number(booking.total_amount || 0);
  var vcode = genVoucherCode();

  var vr = await insertVoucherWithRetry({
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

  var voucherId = (vr.data && vr.data.id) ? vr.data.id : null;

  await supabase.from("bookings").update({
    status: "CANCELLED",
    cancellation_reason: "Converted to voucher via web",
    cancelled_at: new Date().toISOString(),
    converted_to_voucher_id: voucherId,
  }).eq("id", booking.id);

  // Release slot capacity
  if (booking.slot_id) {
    var slotRes = await supabase.from("slots").select("booked").eq("id", booking.slot_id).single();
    if (slotRes.data) {
      await supabase.from("slots").update({
        booked: Math.max(0, (slotRes.data.booked || 0) - booking.qty),
      }).eq("id", booking.slot_id);
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
  var tenant = await getTenantByBusinessId(supabase, booking.business_id);
  var ref = booking.id.substring(0, 8).toUpperCase();
  var tourName = (booking.tours && booking.tours.name) ? booking.tours.name : "Booking";
  var brandName = getBusinessDisplayName(tenant.business);
  var currency = tenant.business.currency || "ZAR";

  if (booking.phone) {
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
            start_time: (booking.slots && booking.slots.start_time) ? booking.slots.start_time : "",
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
    var tenant = await getTenantByBusinessId(supabase, booking.business_id);
    var ref = booking.id.substring(0, 8).toUpperCase();
    var tourName = (booking.tours && booking.tours.name) ? booking.tours.name : "Booking";
    var brandName = getBusinessDisplayName(tenant.business);
    var slotTime = (booking.slots && booking.slots.start_time)
      ? formatTenantDateTime(tenant.business, booking.slots.start_time)
      : "";

    if (booking.phone) {
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
              start_time: (booking.slots && booking.slots.start_time) ? booking.slots.start_time : "",
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

// ───── Main handler ─────
Deno.serve(async function (req: any) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCors(req) });

  try {
    var body = await req.json();
    var bookingId = String(body.booking_id || "");
    var action = String(body.action || "");

    if (!bookingId) return fail(req, "booking_id required", 400);
    if (!action) return fail(req, "action required", 400);

    var validActions = ["RESCHEDULE", "ADD_GUESTS", "REMOVE_GUESTS", "UPDATE_CONTACT", "SPECIAL_REQUEST", "CANCEL_REFUND", "CANCEL_VOUCHER"];
    if (validActions.indexOf(action) === -1) {
      return fail(req, "Invalid action. Must be one of: " + validActions.join(", "), 400);
    }

    var br = await supabase
      .from("bookings")
      .select("*, slots(start_time, capacity_total, booked, held, price_per_person_override), tours(name, base_price_per_person)")
      .eq("id", bookingId)
      .single();

    if (br.error || !br.data) return fail(req, "Booking not found", 404);
    var booking = br.data;

    // For modification actions, booking must be in a modifiable state
    if (action !== "UPDATE_CONTACT" && action !== "SPECIAL_REQUEST") {
      if (!["PAID", "CONFIRMED", "COMPLETED"].includes(booking.status)) {
        return fail(req, "Booking is not in a modifiable state (status: " + booking.status + ")", 400);
      }
    }

    if (action === "RESCHEDULE") return await handleReschedule(req, booking, body);
    if (action === "ADD_GUESTS") return await handleAddGuests(req, booking, body);
    if (action === "REMOVE_GUESTS") return await handleRemoveGuests(req, booking, body);
    if (action === "UPDATE_CONTACT") return await handleUpdateContact(req, booking, body);
    if (action === "SPECIAL_REQUEST") return await handleSpecialRequest(req, booking, body);
    if (action === "CANCEL_REFUND") return await handleCancelRefund(req, booking);
    if (action === "CANCEL_VOUCHER") return await handleCancelVoucher(req, booking);

    return fail(req, "Unhandled action", 400);
  } catch (err: any) {
    console.error("REBOOK_BOOKING_ERR:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), { status: 500, headers: getCors(req) });
  }
});
