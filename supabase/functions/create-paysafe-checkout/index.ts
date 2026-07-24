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
  const qty = Number(body.qty);
  if (!combo_offer_id || !body.qty) {
    return jsonRes({ error: "combo_offer_id and qty are required" }, 400, cors);
  }
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

  // Build the leg list: N-party via combo_offer_items, legacy 2-party via the
  // A/B columns. slot_ids maps item id → chosen slot; legacy slot_a_id/slot_b_id
  // are accepted for 2-leg offers (older booking-app builds).
  const { data: offerItems } = await supabase
    .from("combo_offer_items")
    .select("id, tour_id, business_id, position, split_percent, split_fixed")
    .eq("combo_offer_id", offer.id)
    .order("position", { ascending: true });
  const slotIdMap: Record<string, string> = (body.slot_ids && typeof body.slot_ids === "object") ? body.slot_ids : {};

  type LegSpec = { item_id: string | null; tour_id: string; business_id: string; slot_id: string; split_percent: number | null; split_fixed: number | null };
  let legSpecs: LegSpec[];
  if (offerItems && offerItems.length >= 2) {
    legSpecs = offerItems.map((it: any, idx: number) => ({
      item_id: it.id,
      tour_id: it.tour_id,
      business_id: it.business_id,
      slot_id: String(slotIdMap[it.id] || (idx === 0 ? slot_a_id : idx === 1 ? slot_b_id : "") || ""),
      split_percent: it.split_percent != null ? Number(it.split_percent) : null,
      split_fixed: it.split_fixed != null ? Number(it.split_fixed) : null,
    }));
  } else {
    if (!offer.business_a_id || !offer.business_b_id) {
      return jsonRes({ error: "Combo offer has no sellable items" }, 400, cors);
    }
    legSpecs = [
      { item_id: null, tour_id: offer.tour_a_id, business_id: offer.business_a_id, slot_id: String(slot_a_id || ""), split_percent: offer.split_a_percent != null ? Number(offer.split_a_percent) : null, split_fixed: offer.split_a_fixed != null ? Number(offer.split_a_fixed) : null },
      { item_id: null, tour_id: offer.tour_b_id, business_id: offer.business_b_id, slot_id: String(slot_b_id || ""), split_percent: offer.split_b_percent != null ? Number(offer.split_b_percent) : null, split_fixed: offer.split_b_fixed != null ? Number(offer.split_b_fixed) : null },
    ];
  }
  if (legSpecs.some((l) => !l.slot_id)) {
    return jsonRes({ error: "A slot must be selected for every tour in the combo" }, 400, cors);
  }

  // Verify every slot exists, belongs to its leg's tour, and has capacity
  for (const leg of legSpecs) {
    const { data: slot } = await supabase.from("slots").select("id, tour_id, capacity_total, booked, held").eq("id", leg.slot_id).single();
    if (!slot || String(slot.tour_id) !== String(leg.tour_id)) {
      return jsonRes({ error: "Selected slot not found for one of the tours" }, 404, cors);
    }
    const avail = (slot.capacity_total || 0) - (slot.booked || 0) - (slot.held || 0);
    if (avail < qty) return jsonRes({ error: "One of the tours does not have enough capacity (available: " + avail + ")" }, 400, cors);
  }

  // The collector is the operator who receives the customer's payment (and
  // settles the other legs). Offer creator = first leg by construction.
  const collectorId = String(offer.business_a_id || offer.created_by_business_id || legSpecs[0].business_id);

  // Validate and apply promo code if provided (collector's promo codes)
  let promoDiscount = 0;
  let appliedPromoCode = "";
  let comboTotal = Number(offer.combo_price) * qty;

  if (promo_code) {
    const promoResult = await supabase.rpc("validate_promo_code", {
      p_business_id: collectorId,
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

  // Per-leg split amounts. PERCENT: shares of the (possibly discounted) total,
  // last leg absorbs the rounding remainder so the splits always sum exactly.
  // FIXED: split_fixed × qty per leg (promo discounts come off the collector's
  // take implicitly, matching the original 2-party behaviour).
  const splits: number[] = [];
  if (offer.split_type === "PERCENT") {
    let allocated = 0;
    legSpecs.forEach((leg, i) => {
      if (i === legSpecs.length - 1) {
        splits.push(Math.round((comboTotal - allocated) * 100) / 100);
      } else {
        const amt = Math.round(comboTotal * (Number(leg.split_percent || 0) / 100) * 100) / 100;
        splits.push(amt);
        allocated += amt;
      }
    });
  } else {
    legSpecs.forEach((leg) => splits.push(Math.round(Number(leg.split_fixed || 0) * qty * 100) / 100));
  }

  // One HELD booking per leg; any failure rolls back everything created so far
  const bookingIds: string[] = [];
  const rollbackBookings = async () => {
    for (const id of bookingIds) await supabase.from("bookings").delete().eq("id", id);
  };
  for (let i = 0; i < legSpecs.length; i++) {
    const leg = legSpecs[i];
    const { data: bk, error: bkErr } = await supabase.from("bookings").insert({
      business_id: leg.business_id,
      tour_id: leg.tour_id,
      slot_id: leg.slot_id,
      status: "HELD",
      is_combo: true,
      customer_name: customer_name || "",
      email: customer_email || "",
      phone: customer_phone || "",
      qty: qty,
      total_amount: splits[i],
      unit_price: splits[i] / qty,
      source: "WEB",
      payment_method: "PAYSAFE_COMBO",
      ...(i === 0 && appliedPromoCode ? { promo_code: appliedPromoCode, discount_amount: promoDiscount } : {}),
    }).select("id").single();
    if (bkErr || !bk) {
      await rollbackBookings();
      return jsonRes({ error: "Failed to create booking: " + (bkErr?.message || "unknown") }, 500, cors);
    }
    bookingIds.push(bk.id);
  }

  // Parent combo row. The legacy A/B columns mirror the first two legs so
  // every existing lookup keeps working; split_b_amount = everything the
  // collector owes the other operators.
  const collectorSum = legSpecs.reduce((s, leg, i) => leg.business_id === collectorId ? s + splits[i] : s, 0);
  const { data: comboBooking, error: comboErr } = await supabase.from("combo_bookings").insert({
    combo_offer_id: offer.id,
    booking_a_id: bookingIds[0],
    booking_b_id: bookingIds[1] || null,
    combo_total: comboTotal,
    split_a_amount: Math.round(collectorSum * 100) / 100,
    split_b_amount: Math.round((comboTotal - collectorSum) * 100) / 100,
    payment_status: "PENDING",
    customer_name: customer_name || "",
    customer_email: customer_email || "",
    customer_phone: customer_phone || "",
  }).select("id").single();
  if (comboErr || !comboBooking) {
    await rollbackBookings();
    return jsonRes({ error: "Failed to create combo booking: " + (comboErr?.message || "unknown") }, 500, cors);
  }

  // Per-leg items — the authoritative N-party record (confirm RPC, settlement
  // aggregation and payment links all read these).
  const { error: itemsErr } = await supabase.from("combo_booking_items").insert(
    legSpecs.map((leg, i) => ({
      combo_booking_id: comboBooking.id,
      booking_id: bookingIds[i],
      business_id: leg.business_id,
      tour_id: leg.tour_id,
      position: i + 1,
      split_amount: splits[i],
    })),
  );
  if (itemsErr) {
    await supabase.from("combo_bookings").delete().eq("id", comboBooking.id);
    await rollbackBookings();
    return jsonRes({ error: "Failed to create combo items: " + itemsErr.message }, 500, cors);
  }

  // Link bookings back to combo record
  for (const id of bookingIds) {
    await supabase.from("bookings").update({ combo_booking_id: comboBooking.id }).eq("id", id);
  }

  // S8: reserve capacity on every slot with an atomic capacity CHECK (prevents
  // combo overbooking under concurrency). If any slot is full, release what we
  // reserved, roll back everything created so far and return 409.
  const rollbackCombo = async () => {
    await supabase.from("combo_booking_items").delete().eq("combo_booking_id", comboBooking.id);
    await rollbackBookings();
    await supabase.from("combo_bookings").delete().eq("id", comboBooking.id);
  };
  const reserved: LegSpec[] = [];
  const releaseReserved = async () => {
    for (const leg of reserved) {
      await supabase.rpc("adjust_slot_capacity", { p_slot_id: leg.slot_id, p_business_id: leg.business_id, p_booked_delta: 0, p_held_delta: -qty });
    }
  };
  for (const leg of legSpecs) {
    const res = await supabase.rpc("reserve_combo_capacity", { p_slot_id: leg.slot_id, p_business_id: leg.business_id, p_qty: qty });
    if (res.error || res.data !== true) {
      await releaseReserved();
      await rollbackCombo();
      return jsonRes({ error: "Those spots were just taken on one of the tours. Please pick another time." }, 409, cors);
    }
    reserved.push(leg);
  }

  // Hold rows for every leg: gives abandoned combo checkouts the standard
  // 15-min-expiry lifecycle via cron-tasks (release held capacity, expire the
  // bookings). confirm_combo_payment_atomic CONSUMEs these on payment.
  const holdExpiry = new Date(Date.now() + HOLD_MINUTES * 60 * 1000).toISOString();
  const holdIns = await supabase.from("holds").insert(
    legSpecs.map((leg, i) => ({ booking_id: bookingIds[i], slot_id: leg.slot_id, qty: qty, status: "ACTIVE", hold_type: "COMBO", expires_at: holdExpiry })),
  );
  if (holdIns.error) console.error("COMBO_HOLDS_ERR (capacity still reserved, reconcile heals):", holdIns.error.message);

  // ── Payment provider selection ──────────────────────────────────────────
  // Paysafe SplitPay needs: collector API creds + both linked account IDs —
  // and stays 2-party only (handleProcess splits pairwise).
  // ponytail: 3+ operator combos always use the Yoco manual-settlement model;
  // generalize the Paysafe path when a 3-way SplitPay combo actually exists.
  const distinctBusinessIds = [...new Set(legSpecs.map((l) => l.business_id))];
  const paysafeEligible = legSpecs.length === 2 && distinctBusinessIds.length === 2;
  const otherBusinessId = distinctBusinessIds.find((id) => id !== collectorId) || "";

  const { data: bizA } = await supabase.from("businesses").select("paysafe_account_id, paysafe_linked_account_id, currency").eq("id", collectorId).single();
  const { data: bizB } = paysafeEligible && otherBusinessId
    ? await supabase.from("businesses").select("paysafe_linked_account_id").eq("id", otherBusinessId).single()
    : { data: null };

  let credsA;
  try {
    credsA = await getBusinessCredentials(supabase, collectorId);
  } catch (credErr: any) {
    await releaseReserved();
    await rollbackCombo();
    return jsonRes({ error: "Payment configuration error: " + (credErr?.message || "credentials unavailable") }, 503, cors);
  }

  const paysafeConfigured = paysafeEligible && Boolean(
    credsA.paysafeApiKey && credsA.paysafeApiSecret &&
    bizA?.paysafe_account_id && bizA?.paysafe_linked_account_id && bizB?.paysafe_linked_account_id,
  );

  const baseResponse = {
    combo_booking_id: comboBooking.id,
    booking_a_id: bookingIds[0],
    booking_b_id: bookingIds[1] || null,
    booking_ids: bookingIds,
    combo_total: comboTotal,
    currency: bizA?.currency || offer.currency || "ZAR",
  };

  if (paysafeConfigured) {
    await logEvent(collectorId, bookingIds[0], "combo_checkout_created", {
      combo_booking_id: comboBooking.id, combo_offer_id: offer.id,
      booking_ids: bookingIds, total: comboTotal, splits, provider: "paysafe",
    });
    return jsonRes({ ...baseResponse, provider: "paysafe", paysafe_api_key: bizA?.paysafe_account_id || "" }, 200, cors);
  }

  // ── Yoco fallback (manual settlement): the collector takes the full amount ──
  if (!credsA.activeYocoSecretKey) {
    await releaseReserved();
    await rollbackCombo();
    return jsonRes({ error: "No payment provider configured for this combo. The primary operator needs either Paysafe (with linked accounts) or Yoco credentials." }, 503, cors);
  }

  const tenantA = await getTenantByBusinessId(supabase, collectorId);
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
        booking_id: bookingIds[0],
        business_id: collectorId,
      },
    }),
  });
  const yocoData = await yocoRes.json();
  if (!yocoRes.ok || !yocoData?.id || !yocoData?.redirectUrl) {
    await releaseReserved();
    await rollbackCombo();
    return jsonRes({ error: "Unable to create checkout: " + (yocoData?.message || yocoData?.error?.message || "Yoco error") }, 502, cors);
  }

  // yoco_checkout_id on the collector's booking makes the webhook's
  // checkoutId→business resolver work; the combo row carries it for combo lookup.
  await supabase.from("combo_bookings").update({ yoco_checkout_id: yocoData.id }).eq("id", comboBooking.id);
  await supabase.from("bookings").update({ yoco_checkout_id: yocoData.id }).eq("id", bookingIds[0]);

  await logEvent(collectorId, bookingIds[0], "combo_checkout_created", {
    combo_booking_id: comboBooking.id, combo_offer_id: offer.id,
    booking_ids: bookingIds, total: comboTotal, splits, provider: "yoco",
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
