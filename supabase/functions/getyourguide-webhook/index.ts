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

Deno.serve(withSentry("getyourguide-webhook", async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (req.method !== "POST") return respond(405, { error: "Method not allowed" }, origin);

  const rawBody = await req.text();
  const event: any;
  try { event = JSON.parse(rawBody); } catch { return respond(400, { error: "Invalid JSON" }, origin); }

  const url = new URL(req.url);
  const businessId = url.searchParams.get("b");
  if (!businessId) return respond(400, { error: "Missing business_id (?b= param)" }, origin);

  const { data: integration } = await db
    .from("ota_integrations")
    .select("id, enabled, test_mode, webhook_secret_encrypted")
    .eq("business_id", businessId)
    .eq("channel", "GETYOURGUIDE")
    .maybeSingle();

  if (!integration) return respond(401, { error: "No GYG integration for this business" }, origin);
  if (!integration.enabled) return respond(200, { ok: true, skipped: "integration disabled" }, origin);

  // HMAC signature verification
  if (integration.webhook_secret_encrypted && SETTINGS_ENCRYPTION_KEY) {
    const { data: creds } = await db.rpc("get_ota_credentials", {
      p_business_id: businessId,
      p_key: SETTINGS_ENCRYPTION_KEY,
      p_channel: "GETYOURGUIDE",
    });
    const credRow = Array.isArray(creds) ? creds[0] : creds;
    const webhookSecret = credRow?.webhook_secret || "";
    if (webhookSecret) {
      const sigHeader = req.headers.get("x-gyg-signature") || req.headers.get("gyg-signature") || "";
      const sigValid = await verifyHmacSha256(rawBody, sigHeader, webhookSecret);
      if (!sigValid) {
        console.error("GYG_WEBHOOK_SIG_INVALID business=" + businessId);
        return respond(401, { error: "Invalid signature" }, origin);
      }
    }
  }

  const eventType = String(event?.event_type || event?.type || event?.data?.type || "booking.confirmed").toUpperCase();
  const d = event?.data || event;
  const externalRef = String(d?.booking_reference || d?.booking_id || event?.booking_reference || event?.id || "");
  console.log("GYG_WEBHOOK event=" + eventType + " ref=" + externalRef + " biz=" + businessId);

  if (externalRef) {
    const idemInsert = await db.from("idempotency_keys").insert({ key: "gyg:" + eventType + ":" + externalRef }).select("id").maybeSingle();
    if (idemInsert.error && idemInsert.error.code === "23505") {
      return respond(200, { ok: true, replay: true }, origin);
    }
  }

  if (eventType.includes("CANCEL")) {
    return await handleCancelled(businessId, event, externalRef, origin);
  }
  if (eventType.includes("AMEND") || eventType.includes("MODIF") || eventType.includes("UPDATE")) {
    return await handleAmended(businessId, event, externalRef, origin);
  }
  if (eventType.includes("CONFIRM") || eventType.includes("CREAT") || eventType.includes("BOOKING")) {
    return await handleBookingCreated(businessId, event, externalRef, origin);
  }

  return respond(200, { ok: true, ignored: eventType }, origin);
}));

async function handleBookingCreated(businessId: string, event: any, externalRef: string, origin: string | null): Promise<Response> {
  const d = event?.data || event;
  const productCode = String(d?.product_id || d?.product?.id || "");
  const optionCode = d?.option_id || d?.option?.id || null;
  const startDateTime = d?.datetime || d?.start_datetime || d?.date || d?.activity?.datetime;
  const participants = d?.participants || d?.travelers || [];
  const pax = participants.reduce((s: number, p: any) => s + (Number(p?.count || p?.quantity || p?.numberOfTravelers) || 0), 0) || d?.traveler_count || 1;
  const qty = Number(pax);
  const grossAmount = Number(d?.price?.retail?.amount || d?.retail_price?.amount || d?.total_retail_price || 0);
  const netAmount = Number(d?.price?.net?.amount || d?.net_price?.amount || d?.total_net_price || grossAmount);

  const traveler = d?.traveler || d?.lead_traveler || d?.booker || {};
  const customerName = String(traveler?.name || ((traveler?.first_name || "") + " " + (traveler?.last_name || "")).trim() || d?.customer_name || "GYG Guest");
  const customerEmail = String(traveler?.email || d?.email || "");
  const customerPhone = String(traveler?.phone || d?.phone_number || "");

  if (!productCode) {
    console.error("GYG_WEBHOOK: no product_id in payload business=" + businessId);
    return respond(200, { ok: false, reason: "no product_id" }, origin);
  }

  const { data: mapping } = await db.from("ota_product_mappings")
    .select("tour_id, default_markup_pct")
    .eq("business_id", businessId)
    .eq("channel", "GETYOURGUIDE")
    .eq("external_product_code", productCode)
    .eq("enabled", true)
    .maybeSingle();

  if (!mapping?.tour_id) {
    console.error("GYG_WEBHOOK: no mapping for product=" + productCode + " biz=" + businessId);
    await db.from("logs").insert({
      business_id: businessId,
      event: "gyg_unmapped_product",
      payload: { productCode, optionCode, externalRef, event_type: "BOOKING_CONFIRMED" },
    });
    return respond(200, { ok: false, reason: "no mapping for product_id", productCode }, origin);
  }

  const slotStart = new Date(startDateTime);
  if (isNaN(slotStart.getTime())) {
    console.error("GYG_WEBHOOK: invalid startDateTime=" + startDateTime);
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
    console.error("GYG_WEBHOOK: no slot found for product=" + productCode + " start=" + startDateTime + " biz=" + businessId);
    await db.from("logs").insert({
      business_id: businessId,
      event: "gyg_no_slot",
      payload: { productCode, startDateTime, externalRef, tour_id: mapping.tour_id },
    });
    return respond(200, { ok: false, reason: "no matching slot" }, origin);
  }

  const available = (slot.capacity_total || 0) - (slot.booked || 0) - (slot.held || 0);
  if (available < qty) {
    console.warn("GYG_WEBHOOK: oversold — slot=" + slot.id + " available=" + available + " requested=" + qty);
    await db.from("logs").insert({
      business_id: businessId,
      event: "gyg_oversold",
      payload: { slot_id: slot.id, available, qty, externalRef },
    });
  }

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
    source: "OTA_GETYOURGUIDE",
    ota_channel: "GETYOURGUIDE",
    ota_external_booking_id: externalRef || null,
    ota_net_amount: netAmount,
    ota_gross_amount: grossAmount,
    ota_metadata: event,
  }).select("id").single();

  if (insertErr) {
    console.error("GYG_WEBHOOK: booking insert failed code=" + insertErr.code + " msg=" + insertErr.message);
    return respond(500, { ok: false, error: "DB insert failed: " + insertErr.message, code: insertErr.code }, origin);
  }

  await db.from("slots").update({ booked: (slot.booked || 0) + qty }).eq("id", slot.id);

  await db.from("logs").insert({
    business_id: businessId,
    booking_id: booking.id,
    event: "gyg_booking_created",
    payload: { external_ref: externalRef, productCode, qty, net: netAmount, gross: grossAmount },
  });

  console.log("GYG_WEBHOOK: booking created id=" + booking.id + " ref=" + externalRef + " qty=" + qty);
  return respond(200, { ok: true, booking_id: booking.id }, origin);
}

async function handleAmended(businessId: string, event: any, externalRef: string, origin: string | null): Promise<Response> {
  const ref = externalRef || String(event?.data?.booking_reference || event?.booking_reference || "");
  if (!ref) return respond(200, { ok: false, reason: "no booking ref" }, origin);

  const { data: existing } = await db.from("bookings")
    .select("id, slot_id, qty, tour_id, status")
    .eq("business_id", businessId)
    .eq("ota_external_booking_id", ref)
    .eq("ota_channel", "GETYOURGUIDE")
    .maybeSingle();

  if (!existing) return respond(200, { ok: false, reason: "unknown booking for ref " + ref }, origin);
  if (existing.status === "CANCELLED") return respond(200, { ok: false, reason: "booking already cancelled" }, origin);

  const d = event?.data || event;
  const participants = d?.participants || d?.travelers || [];
  const newQty = participants.reduce((s: number, p: any) => s + (Number(p?.count || p?.quantity) || 0), 0) || d?.traveler_count || existing.qty;
  const newGross = Number(d?.price?.retail?.amount || d?.retail_price?.amount || 0);
  const newNet = Number(d?.price?.net?.amount || d?.net_price?.amount || newGross);
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
    event: "gyg_booking_amended",
    payload: { external_ref: ref, old_qty: existing.qty, new_qty: newQty, qty_diff: qtyDiff, net: newNet, gross: newGross },
  });

  console.log("GYG_WEBHOOK: booking amended id=" + existing.id + " ref=" + ref + " qtyDiff=" + qtyDiff);
  return respond(200, { ok: true, amended: existing.id }, origin);
}

async function handleCancelled(businessId: string, event: any, externalRef: string, origin: string | null): Promise<Response> {
  const ref = externalRef || String(event?.data?.booking_reference || event?.booking_reference || "");
  if (!ref) return respond(200, { ok: false, reason: "no booking ref" }, origin);

  const { data: bk } = await db.from("bookings")
    .select("id, slot_id, qty, status")
    .eq("business_id", businessId)
    .eq("ota_external_booking_id", ref)
    .eq("ota_channel", "GETYOURGUIDE")
    .maybeSingle();

  if (!bk) return respond(200, { ok: false, reason: "unknown booking for ref " + ref }, origin);
  if (bk.status === "CANCELLED") return respond(200, { ok: true, already: "cancelled" }, origin);

  await db.from("bookings").update({
    status: "CANCELLED",
    cancellation_reason: "Cancelled via GetYourGuide",
    cancelled_at: new Date().toISOString(),
  }).eq("id", bk.id);

  if (bk.slot_id) {
    const { data: sl } = await db.from("slots").select("booked").eq("id", bk.slot_id).single();
    if (sl) await db.from("slots").update({ booked: Math.max(0, (sl.booked || 0) - (bk.qty || 0)) }).eq("id", bk.slot_id);
  }

  await db.from("logs").insert({
    business_id: businessId,
    booking_id: bk.id,
    event: "gyg_booking_cancelled",
    payload: { external_ref: ref },
  });

  console.log("GYG_WEBHOOK: booking cancelled id=" + bk.id + " ref=" + ref);
  return respond(200, { ok: true, cancelled: bk.id }, origin);
}
