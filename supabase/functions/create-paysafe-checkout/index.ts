import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, getBusinessCredentials } from "../_shared/tenant.ts";

var supabase = createServiceClient();

function buildCors(origin?: string | null) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

function jsonRes(data: any, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), { status, headers: cors });
}

async function handleCreate(body: any, cors: Record<string, string>) {
  var { combo_offer_id, slot_a_id, slot_b_id, qty, customer_name, customer_email, customer_phone } = body;
  if (!combo_offer_id || !slot_a_id || !slot_b_id || !qty) {
    return jsonRes({ error: "combo_offer_id, slot_a_id, slot_b_id, and qty are required" }, 400, cors);
  }
  qty = Number(qty);

  // Load combo offer and validate
  var { data: offer, error: offerErr } = await supabase
    .from("combo_offers")
    .select("*")
    .eq("id", combo_offer_id)
    .eq("active", true)
    .maybeSingle();
  if (offerErr || !offer) {
    return jsonRes({ error: "Combo offer not found or inactive" }, 404, cors);
  }

  // Verify both slots have capacity
  var { data: slotA } = await supabase.from("slots").select("id, tour_id, capacity_total, booked, held").eq("id", slot_a_id).single();
  var { data: slotB } = await supabase.from("slots").select("id, tour_id, capacity_total, booked, held").eq("id", slot_b_id).single();
  if (!slotA || !slotB) {
    return jsonRes({ error: "One or both slots not found" }, 404, cors);
  }
  var availA = (slotA.capacity_total || 0) - (slotA.booked || 0) - (slotA.held || 0);
  var availB = (slotB.capacity_total || 0) - (slotB.booked || 0) - (slotB.held || 0);
  if (availA < qty) return jsonRes({ error: "Slot A does not have enough capacity (available: " + availA + ")" }, 400, cors);
  if (availB < qty) return jsonRes({ error: "Slot B does not have enough capacity (available: " + availB + ")" }, 400, cors);

  // Calculate totals based on split type
  var comboTotal = Number(offer.combo_price) * qty;
  var splitA: number;
  var splitB: number;
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
  var { data: bookingA, error: bookAErr } = await supabase.from("bookings").insert({
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
  }).select("id").single();
  if (bookAErr || !bookingA) {
    return jsonRes({ error: "Failed to create booking A: " + (bookAErr?.message || "unknown") }, 500, cors);
  }

  // Create booking B (business_b)
  var { data: bookingB, error: bookBErr } = await supabase.from("bookings").insert({
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
  var { data: comboBooking, error: comboErr } = await supabase.from("combo_bookings").insert({
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

  // Hold capacity on both slots
  await supabase.from("slots").update({ held: (slotA.held || 0) + qty }).eq("id", slot_a_id);
  await supabase.from("slots").update({ held: (slotB.held || 0) + qty }).eq("id", slot_b_id);

  // Load Paysafe account ID (public key for SDK) from business_a
  var { data: bizA } = await supabase.from("businesses").select("paysafe_account_id, currency").eq("id", offer.business_a_id).single();

  await supabase.from("logs").insert({
    business_id: offer.business_a_id,
    booking_id: bookingA.id,
    event: "combo_checkout_created",
    payload: {
      combo_booking_id: comboBooking.id,
      combo_offer_id: offer.id,
      booking_a_id: bookingA.id,
      booking_b_id: bookingB.id,
      total: comboTotal,
      split_a: splitA,
      split_b: splitB,
    },
  }).catch(function (e: any) { console.error("LOG_ERR:", e); });

  return jsonRes({
    combo_booking_id: comboBooking.id,
    booking_a_id: bookingA.id,
    booking_b_id: bookingB.id,
    paysafe_api_key: bizA?.paysafe_account_id || "",
    combo_total: comboTotal,
    currency: bizA?.currency || offer.currency || "ZAR",
  }, 200, cors);
}

async function handleProcess(body: any, cors: Record<string, string>) {
  var { combo_booking_id, paymentHandleToken } = body;
  if (!combo_booking_id || !paymentHandleToken) {
    return jsonRes({ error: "combo_booking_id and paymentHandleToken are required" }, 400, cors);
  }

  // Load combo booking
  var { data: combo, error: comboErr } = await supabase
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

  var offer = combo.combo_offers;

  // Load Paysafe credentials for business_a (primary)
  var credsA = await getBusinessCredentials(supabase, offer.business_a_id);
  var { data: bizA } = await supabase.from("businesses").select("paysafe_account_id, paysafe_linked_account_id").eq("id", offer.business_a_id).single();
  var { data: bizB } = await supabase.from("businesses").select("paysafe_linked_account_id").eq("id", offer.business_b_id).single();

  if (!credsA.paysafeApiKey || !credsA.paysafeApiSecret) {
    return jsonRes({ error: "Paysafe credentials not configured for primary business" }, 503, cors);
  }

  var totalCents = Math.round(Number(combo.combo_total) * 100);
  var splitACents = Math.round(Number(combo.split_a_amount) * 100);
  var splitBCents = Math.round(Number(combo.split_b_amount) * 100);

  // Build Paysafe payment request
  var authHeader = "Basic " + btoa(credsA.paysafeApiKey + ":" + credsA.paysafeApiSecret);
  var paysafeBody: any = {
    merchantRefNum: combo_booking_id,
    amount: totalCents,
    currencyCode: offer.currency || "ZAR",
    paymentHandleToken: paymentHandleToken,
    splitpay: [
      { linkedAccount: bizA?.paysafe_linked_account_id || "", amount: splitACents },
      { linkedAccount: bizB?.paysafe_linked_account_id || "", amount: splitBCents },
    ],
  };

  console.log("PAYSAFE_PAYMENT_REQUEST: combo=" + combo_booking_id + " amount=" + totalCents);

  var paysafeRes = await fetch("https://api.paysafe.com/paymenthub/v1/payments", {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(paysafeBody),
  });

  var paysafeData = await paysafeRes.json();
  console.log("PAYSAFE_PAYMENT_RESPONSE: " + JSON.stringify(paysafeData).substring(0, 500));

  if (!paysafeRes.ok || paysafeData.status === "FAILED") {
    var errMsg = paysafeData?.error?.message || paysafeData?.message || "Paysafe payment failed";
    await supabase.from("combo_bookings").update({ payment_status: "FAILED" }).eq("id", combo_booking_id);
    await supabase.from("logs").insert({
      business_id: offer.business_a_id,
      event: "combo_paysafe_payment_failed",
      payload: { combo_booking_id, paysafe_response: paysafeData },
    }).catch(function (e: any) { console.error("LOG_ERR:", e); });
    return jsonRes({ error: errMsg, details: paysafeData }, 502, cors);
  }

  // Payment succeeded — update combo booking
  var paymentId = paysafeData.id || paysafeData.paymentId || "";
  await supabase.from("combo_bookings").update({
    paysafe_payment_id: paymentId,
    paysafe_payment_handle: paymentHandleToken,
    payment_status: "PAID",
  }).eq("id", combo_booking_id);

  // Mark both bookings as PAID
  await supabase.from("bookings").update({ status: "PAID", payment_method: "PAYSAFE_COMBO" }).eq("id", combo.booking_a_id);
  await supabase.from("bookings").update({ status: "PAID", payment_method: "PAYSAFE_COMBO" }).eq("id", combo.booking_b_id);

  await supabase.from("logs").insert({
    business_id: offer.business_a_id,
    event: "combo_paysafe_payment_success",
    payload: { combo_booking_id, paysafe_payment_id: paymentId, amount: totalCents },
  }).catch(function (e: any) { console.error("LOG_ERR:", e); });

  return jsonRes({ success: true, payment_id: paymentId }, 200, cors);
}

Deno.serve(async (req: any) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: buildCors(req?.headers?.get("origin") || "*") });
  }

  try {
    var body = await req.json();
    var cors = buildCors(req?.headers?.get("origin") || "*");
    var action = body.action || "create";

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
