// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
//
// Combo checkout — two payment models, chosen automatically per offer:
//
//  1. PAYSAFE (native auto-split): business A has Paysafe API creds AND both
//     operators have paysafe_linked_account_id set. One charge, Paysafe SplitPay
//     routes each operator's share to their linked account at capture. No
//     settlement needed between operators.
//
//  2. YOCO (manual settlement): fallback when Paysafe isn't configured.
//     Business A (the offer's first operator) collects the FULL combo amount
//     through their own Yoco account; the combo_bookings row records each
//     side's share and operator A settles operator B's share out-of-band.
//     Tracked via combo_bookings.settled + the combo_settlements register.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, getBusinessCredentials, getTenantByBusinessId, resolveBookingSiteUrl } from "../_shared/tenant.ts";
import { confirmComboAndNotify } from "../_shared/combo.ts";

const supabase = createServiceClient();
const HOLD_MINUTES = 15;

function buildCors(origin?: string | null) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-business-id, x-tenant-subdomain, x-tenant-origin, x-voucher-code, x-booking-success-token, x-booking-id, x-booking-waiver-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

function jsonRes(data: any, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), { status, headers: cors });
}

async function logEvent(businessId: string, bookingId: string | null, event: string, payload: any) {
  const lg = await supabase.from("logs").insert({ business_id: businessId, booking_id: bookingId, event, payload });
  if (lg.error) console.error("LOG_ERR:", lg.error.message);
}

async function handleCreate(body: any, cors: Record<string, string>) {
  const { combo_offer_id, slot_a_id, slot_b_id, customer_name, customer_email, customer_phone, promo_code } = body;
  if (!combo_offer_id || !slot_a_id || !slot_b_id || !body.qty) {
    return jsonRes({ error: "combo_offer_id, slot_a_id, slot_b_id, and qty are required" }, 400, cors);
  }
  const qty = Number(body.qty);
  if (!Number.isFinite(qty) || qty < 1) {
    return jsonRes({ error: "qty must be a positive number" }, 400, cors);
  }

  // Load combo offer and validate
  const { data: offer, error: offerErr } = await supabase
    .from("combo_offers")
    .select("*")
    .eq("id", combo_offer_id)
    .eq("active", true)
    .maybeSingle();
  if (offerErr || !offer) {
    return jsonRes({ error: "Combo offer not found or inactive" }, 404, cors);
  }

  // Verify both slots have capacity
  const { data: slotA } = await supabase.from("slots").select("id, tour_id, capacity_total, booked, held").eq("id", slot_a_id).single();
  const { data: slotB } = await supabase.from("slots").select("id, tour_id, capacity_total, booked, held").eq("id", slot_b_id).single();
  if (!slotA || !slotB) {
    return jsonRes({ error: "One or both slots not found" }, 404, cors);
  }
  const availA = (slotA.capacity_total || 0) - (slotA.booked || 0) - (slotA.held || 0);
  const availB = (slotB.capacity_total || 0) - (slotB.booked || 0) - (slotB.held || 0);
  if (availA < qty) return jsonRes({ error: "Slot A does not have enough capacity (available: " + availA + ")" }, 400, cors);
  if (availB < qty) return jsonRes({ error: "Slot B does not have enough capacity (available: " + availB + ")" }, 400, cors);

  // Validate and apply promo code if provided
  let promoDiscount = 0;
  let appliedPromoCode = "";
  let comboTotal = Number(offer.combo_price) * qty;

  if (promo_code) {
    const promoResult = await supabase.rpc("validate_promo_code", {
      p_business_id: offer.business_a_id,
      p_code: promo_code,
      p_order_amount: comboTotal,
      p_customer_email: customer_email || null,
    });
    if (promoResult.data?.valid) {
      const promo = promoResult.data;
      appliedPromoCode = promo.code;
      if (promo.discount_type === "PERCENT") {
        promoDiscount = comboTotal * (Number(promo.discount_value) / 100);
      } else {
        promoDiscount = Math.min(Number(promo.discount_value), comboTotal);
      }
      promoDiscount = Math.round(promoDiscount * 100) / 100;
      comboTotal = comboTotal - promoDiscount;
      console.log("COMBO_PROMO_APPLIED: code=" + appliedPromoCode + " discount=" + promoDiscount);
    } else {
      return jsonRes({ error: promoResult.data?.error || "Invalid promo code" }, 400, cors);
    }
  }

  // Calculate totals based on split type
  let splitA: number;
  let splitB: number;
  if (offer.split_type === "PERCENT") {
    splitA = Number(offer.split_a_percent) / 100 * comboTotal;
    splitB = comboTotal - splitA;
  } else {
    // FIXED split
    splitA = Number(offer.split_a_fixed) * qty;
    splitB = Number(offer.split_b_fixed) * qty;
  }
  // Round to 2 decimals
  splitA = Math.round(splitA * 100) / 100;
  splitB = Math.round(splitB * 100) / 100;

  // Create booking A (business_a)
  const { data: bookingA, error: bookAErr } = await supabase.from("bookings").insert({
    business_id: offer.business_a_id,
    tour_id: offer.tour_a_id,
    slot_id: slot_a_id,
    status: "HELD",
    is_combo: true,
    customer_name: customer_name || "",
    email: customer_email || "",
    phone: customer_phone || "",
    qty: qty,
    total_amount: splitA,
    unit_price: splitA / qty,
    source: "WEB",
    payment_method: "PAYSAFE_COMBO",
    ...(appliedPromoCode ? { promo_code: appliedPromoCode, discount_amount: promoDiscount } : {}),
  }).select("id").single();
  if (bookAErr || !bookingA) {
    return jsonRes({ error: "Failed to create booking A: " + (bookAErr?.message || "unknown") }, 500, cors);
  }

  // Create booking B (business_b)
  const { data: bookingB, error: bookBErr } = await supabase.from("bookings").insert({
    business_id: offer.business_b_id,
    tour_id: offer.tour_b_id,
    slot_id: slot_b_id,
    status: "HELD",
    is_combo: true,
    customer_name: customer_name || "",
    email: customer_email || "",
    phone: customer_phone || "",
    qty: qty,
    total_amount: splitB,
    unit_price: splitB / qty,
    source: "WEB",
    payment_method: "PAYSAFE_COMBO",
  }).select("id").single();
  if (bookBErr || !bookingB) {
    // Rollback booking A
    await supabase.from("bookings").delete().eq("id", bookingA.id);
    return jsonRes({ error: "Failed to create booking B: " + (bookBErr?.message || "unknown") }, 500, cors);
  }

  // Create combo_bookings record
  const { data: comboBooking, error: comboErr } = await supabase.from("combo_bookings").insert({
    combo_offer_id: offer.id,
    booking_a_id: bookingA.id,
    booking_b_id: bookingB.id,
    combo_total: comboTotal,
    split_a_amount: splitA,
    split_b_amount: splitB,
    payment_status: "PENDING",
    customer_name: customer_name || "",
    customer_email: customer_email || "",
    customer_phone: customer_phone || "",
  }).select("id").single();
  if (comboErr || !comboBooking) {
    // Rollback both bookings
    await supabase.from("bookings").delete().eq("id", bookingA.id);
    await supabase.from("bookings").delete().eq("id", bookingB.id);
    return jsonRes({ error: "Failed to create combo booking: " + (comboErr?.message || "unknown") }, 500, cors);
  }

  // Link bookings back to combo record
  await supabase.from("bookings").update({ combo_booking_id: comboBooking.id }).eq("id", bookingA.id);
  await supabase.from("bookings").update({ combo_booking_id: comboBooking.id }).eq("id", bookingB.id);

  // S8: reserve capacity on both slots with an atomic capacity CHECK (prevents
  // combo overbooking under concurrency). If either slot is full, roll back
  // everything created so far and return 409.
  const rollbackCombo = async () => {
    await supabase.from("bookings").delete().eq("id", bookingA.id);
    await supabase.from("bookings").delete().eq("id", bookingB.id);
    await supabase.from("combo_bookings").delete().eq("id", comboBooking.id);
  };
  const resA = await supabase.rpc("reserve_combo_capacity", { p_slot_id: slot_a_id, p_business_id: offer.business_a_id, p_qty: qty });
  if (resA.error || resA.data !== true) {
    await rollbackCombo();
    return jsonRes({ error: "Those spots were just taken on the first tour. Please pick another time." }, 409, cors);
  }
  const resB = await supabase.rpc("reserve_combo_capacity", { p_slot_id: slot_b_id, p_business_id: offer.business_b_id, p_qty: qty });
  if (resB.error || resB.data !== true) {
    // release the slot-A reservation we just took, then roll back
    await supabase.rpc("adjust_slot_capacity", { p_slot_id: slot_a_id, p_business_id: offer.business_a_id, p_booked_delta: 0, p_held_delta: -qty });
    await rollbackCombo();
    return jsonRes({ error: "Those spots were just taken on the second tour. Please pick another time." }, 409, cors);
  }

  // Hold rows for both legs: gives abandoned combo checkouts the standard
  // 15-min-expiry lifecycle via cron-tasks (release held capacity, expire the
  // bookings). confirm_combo_payment_atomic CONSUMEs these on payment.
  const holdExpiry = new Date(Date.now() + HOLD_MINUTES * 60 * 1000).toISOString();
  const holdIns = await supabase.from("holds").insert([
    { booking_id: bookingA.id, slot_id: slot_a_id, qty: qty, status: "ACTIVE", hold_type: "COMBO", expires_at: holdExpiry },
    { booking_id: bookingB.id, slot_id: slot_b_id, qty: qty, status: "ACTIVE", hold_type: "COMBO", expires_at: holdExpiry },
  ]);
  if (holdIns.error) console.error("COMBO_HOLDS_ERR (capacity still reserved, reconcile heals):", holdIns.error.message);

  // ── Payment provider selection ──────────────────────────────────────────
  // Paysafe SplitPay needs: business A API creds + BOTH linked account IDs.
  // Otherwise fall back to the manual-settlement model: business A collects
  // the full amount via their own Yoco account.
  const { data: bizA } = await supabase.from("businesses").select("paysafe_account_id, paysafe_linked_account_id, currency").eq("id", offer.business_a_id).single();
  const { data: bizB } = await supabase.from("businesses").select("paysafe_linked_account_id").eq("id", offer.business_b_id).single();

  let credsA;
  try {
    credsA = await getBusinessCredentials(supabase, offer.business_a_id);
  } catch (credErr: any) {
    await supabase.rpc("adjust_slot_capacity", { p_slot_id: slot_a_id, p_business_id: offer.business_a_id, p_booked_delta: 0, p_held_delta: -qty });
    await supabase.rpc("adjust_slot_capacity", { p_slot_id: slot_b_id, p_business_id: offer.business_b_id, p_booked_delta: 0, p_held_delta: -qty });
    await rollbackCombo();
    return jsonRes({ error: "Payment configuration error: " + (credErr?.message || "credentials unavailable") }, 503, cors);
  }

  const paysafeConfigured = Boolean(
    credsA.paysafeApiKey && credsA.paysafeApiSecret &&
    bizA?.paysafe_account_id && bizA?.paysafe_linked_account_id && bizB?.paysafe_linked_account_id,
  );

  const baseResponse = {
    combo_booking_id: comboBooking.id,
    booking_a_id: bookingA.id,
    booking_b_id: bookingB.id,
    combo_total: comboTotal,
    currency: bizA?.currency || offer.currency || "ZAR",
  };

  if (paysafeConfigured) {
    await logEvent(offer.business_a_id, bookingA.id, "combo_checkout_created", {
      combo_booking_id: comboBooking.id, combo_offer_id: offer.id,
      booking_a_id: bookingA.id, booking_b_id: bookingB.id,
      total: comboTotal, split_a: splitA, split_b: splitB, provider: "paysafe",
    });
    return jsonRes({ ...baseResponse, provider: "paysafe", paysafe_api_key: bizA?.paysafe_account_id || "" }, 200, cors);
  }

  // ── Yoco fallback (manual settlement) ──
  if (!credsA.activeYocoSecretKey) {
    await supabase.rpc("adjust_slot_capacity", { p_slot_id: slot_a_id, p_business_id: offer.business_a_id, p_booked_delta: 0, p_held_delta: -qty });
    await supabase.rpc("adjust_slot_capacity", { p_slot_id: slot_b_id, p_business_id: offer.business_b_id, p_booked_delta: 0, p_held_delta: -qty });
    await rollbackCombo();
    return jsonRes({ error: "No payment provider configured for this combo. The primary operator needs either Paysafe (with linked accounts) or Yoco credentials." }, 503, cors);
  }

  const tenantA = await getTenantByBusinessId(supabase, offer.business_a_id);
  const siteUrl = resolveBookingSiteUrl(tenantA.business);
  const successUrl = (tenantA.business.booking_success_url || (siteUrl ? siteUrl + "/success" : "https://bookingtours.co.za")) + "?combo=" + comboBooking.id;
  const cancelUrl = tenantA.business.booking_cancel_url || (siteUrl ? siteUrl + "/cancelled" : "https://bookingtours.co.za");

  const yocoRes = await fetch("https://payments.yoco.com/api/checkouts", {
    method: "POST",
    headers: { Authorization: "Bearer " + credsA.activeYocoSecretKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: Math.round(comboTotal * 100),
      currency: tenantA.business.currency || "ZAR",
      successUrl: successUrl,
      cancelUrl: cancelUrl,
      failureUrl: cancelUrl,
      metadata: {
        type: "COMBO",
        combo_booking_id: comboBooking.id,
        booking_id: bookingA.id,
        business_id: offer.business_a_id,
      },
    }),
  });
  const yocoData = await yocoRes.json();
  if (!yocoRes.ok || !yocoData?.id || !yocoData?.redirectUrl) {
    await supabase.rpc("adjust_slot_capacity", { p_slot_id: slot_a_id, p_business_id: offer.business_a_id, p_booked_delta: 0, p_held_delta: -qty });
    await supabase.rpc("adjust_slot_capacity", { p_slot_id: slot_b_id, p_business_id: offer.business_b_id, p_booked_delta: 0, p_held_delta: -qty });
    await rollbackCombo();
    return jsonRes({ error: "Unable to create checkout: " + (yocoData?.message || yocoData?.error?.message || "Yoco error") }, 502, cors);
  }

  // yoco_checkout_id on booking A makes the webhook's checkoutId→business
  // resolver work; the combo row carries it for combo lookup.
  await supabase.from("combo_bookings").update({ yoco_checkout_id: yocoData.id }).eq("id", comboBooking.id);
  await supabase.from("bookings").update({ yoco_checkout_id: yocoData.id }).eq("id", bookingA.id);

  await logEvent(offer.business_a_id, bookingA.id, "combo_checkout_created", {
    combo_booking_id: comboBooking.id, combo_offer_id: offer.id,
    booking_a_id: bookingA.id, booking_b_id: bookingB.id,
    total: comboTotal, split_a: splitA, split_b: splitB, provider: "yoco",
  });

  return jsonRes({ ...baseResponse, provider: "yoco", redirect_url: yocoData.redirectUrl }, 200, cors);
}

async function handleProcess(body: any, cors: Record<string, string>) {
  const { combo_booking_id, paymentHandleToken } = body;
  if (!combo_booking_id || !paymentHandleToken) {
    return jsonRes({ error: "combo_booking_id and paymentHandleToken are required" }, 400, cors);
  }

  // Load combo booking
  const { data: combo, error: comboErr } = await supabase
    .from("combo_bookings")
    .select("*, combo_offers(*)")
    .eq("id", combo_booking_id)
    .single();
  if (comboErr || !combo) {
    return jsonRes({ error: "Combo booking not found" }, 404, cors);
  }
  if (combo.payment_status === "PAID") {
    return jsonRes({ error: "Payment already processed" }, 400, cors);
  }

  const offer = combo.combo_offers;

  // Load Paysafe credentials for business_a (primary)
  const credsA = await getBusinessCredentials(supabase, offer.business_a_id);
  const { data: bizA } = await supabase.from("businesses").select("paysafe_account_id, paysafe_linked_account_id").eq("id", offer.business_a_id).single();
  const { data: bizB } = await supabase.from("businesses").select("paysafe_linked_account_id").eq("id", offer.business_b_id).single();

  if (!credsA.paysafeApiKey || !credsA.paysafeApiSecret) {
    return jsonRes({ error: "Paysafe credentials not configured for primary business" }, 503, cors);
  }
  if (!bizA?.paysafe_linked_account_id || !bizB?.paysafe_linked_account_id) {
    return jsonRes({ error: "Paysafe linked accounts not configured for both operators" }, 503, cors);
  }

  const totalCents = Math.round(Number(combo.combo_total) * 100);
  const splitACents = Math.round(Number(combo.split_a_amount) * 100);
  // Derive splitB from total to guarantee splitA + splitB === totalCents (avoids rounding mismatch)
  const splitBCents = totalCents - splitACents;

  // Build Paysafe payment request
  const authHeader = "Basic " + btoa(credsA.paysafeApiKey + ":" + credsA.paysafeApiSecret);
  const paysafeBody: any = {
    merchantRefNum: combo_booking_id,
    amount: totalCents,
    currencyCode: offer.currency || "ZAR",
    paymentHandleToken: paymentHandleToken,
    splitpay: [
      { linkedAccount: bizA.paysafe_linked_account_id, amount: splitACents },
      { linkedAccount: bizB.paysafe_linked_account_id, amount: splitBCents },
    ],
  };

  console.log("PAYSAFE_PAYMENT_REQUEST: combo=" + combo_booking_id + " amount=" + totalCents);

  const paysafeRes = await fetch("https://api.paysafe.com/paymenthub/v1/payments", {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(paysafeBody),
  });

  const paysafeData = await paysafeRes.json();
  console.log("PAYSAFE_PAYMENT_RESPONSE: " + JSON.stringify(paysafeData).substring(0, 500));

  if (!paysafeRes.ok || paysafeData.status === "FAILED") {
    const errMsg = paysafeData?.error?.message || paysafeData?.message || "Paysafe payment failed";
    await supabase.from("combo_bookings").update({ payment_status: "FAILED" }).eq("id", combo_booking_id);
    await logEvent(offer.business_a_id, null, "combo_paysafe_payment_failed", { combo_booking_id, paysafe_response: paysafeData });
    return jsonRes({ error: errMsg, details: paysafeData }, 502, cors);
  }

  // Payment succeeded — confirm every leg atomically (held→booked, holds
  // CONSUMED, PAID, invoices + notifications). The webhook's idempotency +
  // already-PAID check makes its later arrival a no-op.
  const paymentId = paysafeData.id || paysafeData.paymentId || "";
  await supabase.from("combo_bookings").update({
    paysafe_payment_id: paymentId,
    paysafe_payment_handle: paymentHandleToken,
  }).eq("id", combo_booking_id);

  const confirm = await confirmComboAndNotify(supabase, combo_booking_id, "PAYSAFE_" + paymentId, "PAYSAFE_COMBO");
  if (!confirm.ok) {
    // Money captured but confirm failed — surface loudly; webhook retry or
    // manual RPC re-run recovers (RPC is idempotent).
    console.error("COMBO_CONFIRM_ATOMIC_ERR (payment captured!):", confirm.error);
    await logEvent(offer.business_a_id, null, "combo_payment_confirm_failed", { combo_booking_id, paysafe_payment_id: paymentId, error: confirm.error });
    return jsonRes({ error: "Payment captured but confirmation failed; our team has been notified.", payment_id: paymentId }, 500, cors);
  }

  await logEvent(offer.business_a_id, null, "combo_paysafe_payment_success", { combo_booking_id, paysafe_payment_id: paymentId, amount: totalCents });

  return jsonRes({ success: true, payment_id: paymentId }, 200, cors);
}

Deno.serve(async (req: any) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: buildCors(req?.headers?.get("origin") || "*") });
  }

  try {
    const body = await req.json();
    const cors = buildCors(req?.headers?.get("origin") || "*");
    const action = body.action || "create";

    if (action === "process") {
      return await handleProcess(body, cors);
    }

    return await handleCreate(body, cors);
  } catch (err: any) {
    console.error("CREATE_PAYSAFE_CHECKOUT_ERR:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500,
      headers: buildCors(req?.headers?.get("origin") || "*"),
    });
  }
});
