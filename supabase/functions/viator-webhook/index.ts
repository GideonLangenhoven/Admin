import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient } from "../_shared/tenant.ts";
import { withSentry } from "../_shared/sentry.ts";

const SETTINGS_ENCRYPTION_KEY = Deno.env.get("SETTINGS_ENCRYPTION_KEY") || "";
const db = createServiceClient();

function headers(origin?: string | null) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Content-Type": "application/json",
  };
}

function respond(status: number, body: any, origin?: string | null) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}

async function verifyHmacSha256(rawBody: string, signatureHeader: string, secret: string): Promise<boolean> {
  if (!secret || !signatureHeader) return false;
  const key = new TextEncoder().encode(secret);
  const data = new TextEncoder().encode(rawBody);
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, data);
  const expectedHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  const receivedHex = signatureHeader.toLowerCase().replace(/^sha256=/, "");
  if (receivedHex.length !== expectedHex.length) return false;
  const mismatch = 0;
  for (let i = 0; i < receivedHex.length; i++) mismatch |= receivedHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return mismatch === 0;
}

Deno.serve(withSentry("viator-webhook", async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (req.method !== "POST") return respond(405, { error: "Method not allowed" }, origin);

  const rawBody = await req.text();
  const event: any;
  try { event = JSON.parse(rawBody); } catch { return respond(400, { error: "Invalid JSON" }, origin); }

  // Business ID from query param (?b=<uuid>) — set when registering webhook URL with Viator
  const url = new URL(req.url);
  const businessId = url.searchParams.get("b");
  if (!businessId) return respond(400, { error: "Missing business_id (?b= param)" }, origin);

  // Look up integration
  const { data: integration } = await db
    .from("ota_integrations")
    .select("id, enabled, test_mode, webhook_secret_encrypted")
    .eq("business_id", businessId)
    .eq("channel", "VIATOR")
    .maybeSingle();

  if (!integration) return respond(401, { error: "No Viator integration for this business" }, origin);
  if (!integration.enabled) return respond(200, { ok: true, skipped: "integration disabled" }, origin);

  // HMAC signature verification
  if (integration.webhook_secret_encrypted && SETTINGS_ENCRYPTION_KEY) {
    const { data: creds } = await db.rpc("get_ota_credentials", {
      p_business_id: businessId,
      p_key: SETTINGS_ENCRYPTION_KEY,
      p_channel: "VIATOR",
    });
    const credRow = Array.isArray(creds) ? creds[0] : creds;
    const webhookSecret = credRow?.webhook_secret || "";
    if (webhookSecret) {
      const sigHeader = req.headers.get("x-viator-signature") || req.headers.get("viator-signature") || "";
      const sigValid = await verifyHmacSha256(rawBody, sigHeader, webhookSecret);
      if (!sigValid) {
        console.error("VIATOR_WEBHOOK_SIG_INVALID business=" + businessId);
        return respond(401, { error: "Invalid signature" }, origin);
      }
    }
  }

  const externalRef = String(event?.bookingRef || event?.bookingReference || event?.data?.bookingRef || event?.id || "");
  const eventType = String(event?.type || event?.notificationType || event?.data?.type || "BOOKING_CONFIRMED").toUpperCase();
  console.log("VIATOR_WEBHOOK event=" + eventType + " ref=" + externalRef + " biz=" + businessId);

  // Idempotency — key includes event type so create + cancel on same ref are distinct
  if (externalRef) {
    const idemInsert = await db.from("idempotency_keys").insert({ key: "viator:" + eventType + ":" + externalRef }).select("id").maybeSingle();
    if (idemInsert.error && idemInsert.error.code === "23505") {
      return respond(200, { ok: true, replay: true }, origin);
    }
  }

  if (eventType.includes("CANCEL")) {
    return await handleCancelled(businessId, event, externalRef, origin);
  }
  if (eventType.includes("AMEND") || eventType.includes("MODIF") || eventType.includes("UPDATE")) {
    return await handleBookingAmended(businessId, event, externalRef, origin);
  }
  if (eventType.includes("CONFIRM") || eventType.includes("CREAT") || eventType.includes("BOOKING")) {
    return await handleBookingCreated(businessId, event, externalRef, origin);
  }

  // Unknown event type — ack to prevent retries
  return respond(200, { ok: true, ignored: eventType }, origin);
}));

async function handleBookingCreated(businessId: string, event: any, externalRef: string, origin: string | null): Promise<Response> {
  // Extract fields — Viator's webhook payload structure
  // Top-level or nested under event.data depending on webhook version
  const d = event?.data || event;
  const productCode = String(d?.productCode || d?.product?.productCode || "");
  const optionCode = d?.productOptionCode || d?.product?.productOptionCode || null;
  const startDateTime = d?.travelDate || d?.startDate || d?.startDateTime || d?.activity?.startDate;
  const pax = d?.travelerCount || d?.paxMix?.reduce((s: number, p: any) => s + (p?.numberOfTravelers || 0), 0) || d?.numTravelers || 1;
  const qty = Number(pax);
  const grossAmount = Number(d?.totalPrice?.amount || d?.price?.total?.amount || d?.totalRetailPrice || 0);
  const netAmount = Number(d?.totalNetPrice?.amount || d?.netRate?.amount || d?.supplierPrice || grossAmount);

  // Traveler info
  const leadTraveler = d?.leadTraveler || d?.booker || {};
  const customerName = String(leadTraveler?.name || ((leadTraveler?.firstName || "") + " " + (leadTraveler?.lastName || "")).trim() || d?.customerName || "Viator Guest");
  const customerEmail = String(leadTraveler?.email || d?.email || "");
  const customerPhone = String(leadTraveler?.phone || d?.phone || "");

  if (!productCode) {
    console.error("VIATOR_WEBHOOK: no productCode in payload business=" + businessId);
    return respond(200, { ok: false, reason: "no productCode" }, origin);
  }

  // Resolve tour from mapping
  const { data: mapping } = await db.from("ota_product_mappings")
    .select("tour_id, default_markup_pct")
    .eq("business_id", businessId)
    .eq("channel", "VIATOR")
    .eq("external_product_code", productCode)
    .eq("enabled", true)
    .maybeSingle();

  if (!mapping?.tour_id) {
    console.error("VIATOR_WEBHOOK: no mapping for product=" + productCode + " biz=" + businessId);
    await db.from("logs").insert({
      business_id: businessId,
      event: "viator_unmapped_product",
      payload: { productCode, optionCode, externalRef, event_type: "BOOKING_CONFIRMED" },
    });
    return respond(200, { ok: false, reason: "no mapping for productCode", productCode }, origin);
  }

  // Find matching slot (±30 min tolerance)
  const slotStart = new Date(startDateTime);
  if (isNaN(slotStart.getTime())) {
    console.error("VIATOR_WEBHOOK: invalid startDateTime=" + startDateTime);
    return respond(200, { ok: false, reason: "invalid startDateTime" }, origin);
  }

  const { data: slot } = await db.from("slots")
    .select("id, capacity_total, booked, held, tour_id")
    .eq("business_id", businessId)
    .eq("tour_id", mapping.tour_id)
    .gte("start_time", new Date(slotStart.getTime() - 30 * 60_000).toISOString())
    .lte("start_time", new Date(slotStart.getTime() + 30 * 60_000).toISOString())
    .eq("status", "OPEN")
    .limit(1)
    .maybeSingle();

  if (!slot) {
    console.error("VIATOR_WEBHOOK: no slot found for product=" + productCode + " start=" + startDateTime + " biz=" + businessId);
    await db.from("logs").insert({
      business_id: businessId,
      event: "viator_no_slot",
      payload: { productCode, startDateTime, externalRef, tour_id: mapping.tour_id },
    });
    return respond(200, { ok: false, reason: "no matching slot" }, origin);
  }

  const available = (slot.capacity_total || 0) - (slot.booked || 0) - (slot.held || 0);
  if (available < qty) {
    console.warn("VIATOR_WEBHOOK: oversold — slot=" + slot.id + " available=" + available + " requested=" + qty);
    await db.from("logs").insert({
      business_id: businessId,
      event: "viator_oversold",
      payload: { slot_id: slot.id, available, qty, externalRef },
    });
  }

  // Upsert customer
  let customerId: string | null = null;
  if (customerEmail) {
    const { data: cid } = await db.rpc("upsert_customer", {
      p_business_id: businessId,
      p_email: customerEmail,
      p_name: customerName || null,
      p_phone: customerPhone || null,
      p_marketing_consent: false,
    });
    customerId = cid as string;
  }

  // Create booking — status PAID since Viator collects payment
  const { data: booking, error: insertErr } = await db.from("bookings").insert({
    business_id: businessId,
    tour_id: mapping.tour_id,
    slot_id: slot.id,
    customer_id: customerId,
    customer_name: customerName,
    email: customerEmail || "",
    phone: customerPhone || "",
    qty,
    unit_price: netAmount / Math.max(1, qty),
    total_amount: netAmount,
    status: "PAID",
    source: "OTA_VIATOR",
    ota_channel: "VIATOR",
    ota_external_booking_id: externalRef || null,
    ota_net_amount: netAmount,
    ota_gross_amount: grossAmount,
    ota_metadata: event,
  }).select("id").single();

  if (insertErr) {
    console.error("VIATOR_WEBHOOK: booking insert failed code=" + insertErr.code + " msg=" + insertErr.message);
    return respond(500, { ok: false, error: "DB insert failed: " + insertErr.message, code: insertErr.code }, origin);
  }

  // Increment slot booked count
  await db.from("slots").update({ booked: (slot.booked || 0) + qty }).eq("id", slot.id);

  // Audit log
  await db.from("logs").insert({
    business_id: businessId,
    booking_id: booking.id,
    event: "viator_booking_created",
    payload: { external_ref: externalRef, productCode, qty, net: netAmount, gross: grossAmount },
  });

  console.log("VIATOR_WEBHOOK: booking created id=" + booking.id + " ref=" + externalRef + " qty=" + qty);
  return respond(200, { ok: true, booking_id: booking.id }, origin);
}

async function handleBookingAmended(businessId: string, event: any, externalRef: string, origin: string | null): Promise<Response> {
  const ref = externalRef || String(event?.data?.bookingRef || event?.bookingReference || "");
  if (!ref) return respond(200, { ok: false, reason: "no booking ref" }, origin);

  const { data: existing } = await db.from("bookings")
    .select("id, slot_id, qty, tour_id, status")
    .eq("business_id", businessId)
    .eq("ota_external_booking_id", ref)
    .eq("ota_channel", "VIATOR")
    .maybeSingle();

  if (!existing) return respond(200, { ok: false, reason: "unknown booking for ref " + ref }, origin);
  if (existing.status === "CANCELLED") return respond(200, { ok: false, reason: "booking already cancelled" }, origin);

  const d = event?.data || event;
  const newQty = d?.travelerCount || d?.paxMix?.reduce((s: number, p: any) => s + (p?.numberOfTravelers || 0), 0) || d?.numTravelers || existing.qty;
  const newGross = Number(d?.totalPrice?.amount || d?.price?.total?.amount || d?.totalRetailPrice || 0);
  const newNet = Number(d?.totalNetPrice?.amount || d?.netRate?.amount || d?.supplierPrice || newGross);
  const qtyDiff = Number(newQty) - (existing.qty || 0);

  await db.from("bookings").update({
    qty: newQty,
    unit_price: newNet / Math.max(1, Number(newQty)),
    total_amount: newNet,
    ota_net_amount: newNet,
    ota_gross_amount: newGross,
    ota_metadata: event,
  }).eq("id", existing.id);

  if (qtyDiff !== 0 && existing.slot_id) {
    const { data: sl } = await db.from("slots").select("booked").eq("id", existing.slot_id).single();
    if (sl) {
      await db.from("slots").update({ booked: Math.max(0, (sl.booked || 0) + qtyDiff) }).eq("id", existing.slot_id);
    }
  }

  await db.from("logs").insert({
    business_id: businessId,
    booking_id: existing.id,
    event: "viator_booking_amended",
    payload: { external_ref: ref, old_qty: existing.qty, new_qty: newQty, qty_diff: qtyDiff, net: newNet, gross: newGross },
  });

  console.log("VIATOR_WEBHOOK: booking amended id=" + existing.id + " ref=" + ref + " qtyDiff=" + qtyDiff);
  return respond(200, { ok: true, amended: existing.id }, origin);
}

async function handleCancelled(businessId: string, event: any, externalRef: string, origin: string | null): Promise<Response> {
  const ref = externalRef || String(event?.data?.bookingRef || event?.bookingReference || "");
  if (!ref) return respond(200, { ok: false, reason: "no booking ref" }, origin);

  const { data: bk } = await db.from("bookings")
    .select("id, slot_id, qty, status")
    .eq("business_id", businessId)
    .eq("ota_external_booking_id", ref)
    .eq("ota_channel", "VIATOR")
    .maybeSingle();

  if (!bk) return respond(200, { ok: false, reason: "unknown booking for ref " + ref }, origin);
  if (bk.status === "CANCELLED") return respond(200, { ok: true, already: "cancelled" }, origin);

  await db.from("bookings").update({
    status: "CANCELLED",
    cancellation_reason: "Cancelled via Viator",
    cancelled_at: new Date().toISOString(),
  }).eq("id", bk.id);

  // Release slot capacity
  if (bk.slot_id) {
    const { data: sl } = await db.from("slots").select("booked").eq("id", bk.slot_id).single();
    if (sl) await db.from("slots").update({ booked: Math.max(0, (sl.booked || 0) - (bk.qty || 0)) }).eq("id", bk.slot_id);
  }

  await db.from("logs").insert({
    business_id: businessId,
    booking_id: bk.id,
    event: "viator_booking_cancelled",
    payload: { external_ref: ref },
  });

  console.log("VIATOR_WEBHOOK: booking cancelled id=" + bk.id + " ref=" + ref);
  return respond(200, { ok: true, cancelled: bk.id }, origin);
}
