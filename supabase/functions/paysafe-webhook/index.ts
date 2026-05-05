// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, formatTenantDateTime, getBusinessDisplayName, getTenantByBusinessId, sendWhatsappTextForTenant } from "../_shared/tenant.ts";
import { withSentry } from "../_shared/sentry.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAYSAFE_WEBHOOK_SECRET = Deno.env.get("PAYSAFE_WEBHOOK_SECRET") || "";
const supabase = createServiceClient();

/* ───── Paysafe webhook signature verification ───── */
async function verifyPaysafeSignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!PAYSAFE_WEBHOOK_SECRET) {
    console.error("PAYSAFE_SIGNATURE_VERIFY: PAYSAFE_WEBHOOK_SECRET not set — rejecting request");
    return false;
  }
  if (!signatureHeader) return false;
  const key = new TextEncoder().encode(PAYSAFE_WEBHOOK_SECRET);
  const data = new TextEncoder().encode(rawBody);
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, data);
  const expectedHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  // Constant-time comparison
  const receivedHex = signatureHeader.toLowerCase();
  if (receivedHex.length !== expectedHex.length) return false;
  const mismatch = 0;
  for (let i = 0; i < receivedHex.length; i++) mismatch |= receivedHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return mismatch === 0;
}

async function createComboInvoice(booking: any, tourName: string, slotTime: string, paymentRef: string, paymentMethod: string) {
  const existing = await supabase.from("invoices").select("*").eq("booking_id", booking.id).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (existing.data) {
    if (existing.data.payment_reference !== paymentRef) {
      await supabase.from("invoices").update({ payment_method: paymentMethod, payment_reference: paymentRef }).eq("id", existing.data.id);
    }
    return existing.data;
  }

  const invNumR = await supabase.rpc("next_invoice_number", { p_business_id: booking.business_id }).catch(function () { return { data: null, error: { message: "RPC not found" } }; });
  if (invNumR.error) {
    console.warn("next_invoice_number RPC failed (using fallback):", invNumR.error.message);
  }
  const invNum = invNumR.data || ("INV-" + Date.now());
  const subtotal = Number(booking.total_amount);

  const inv = await supabase.from("invoices").insert({
    business_id: booking.business_id,
    booking_id: booking.id,
    invoice_number: invNum,
    customer_name: booking.customer_name,
    customer_email: booking.email,
    customer_phone: booking.phone,
    tour_name: tourName,
    tour_date: booking.slots?.start_time || null,
    qty: booking.qty,
    unit_price: booking.unit_price,
    subtotal: subtotal,
    discount_type: null,
    discount_percent: 0,
    discount_amount: 0,
    total_amount: booking.total_amount,
    payment_method: paymentMethod,
    payment_reference: paymentRef,
  }).select().single();

  if (inv.data) {
    await supabase.from("bookings").update({ invoice_id: inv.data.id }).eq("id", booking.id);
  }
  return { ...inv.data, invoice_number: invNum };
}

async function sendComboConfirmation(booking: any, comboBookingId: string, paymentId: string) {
  let tenant: any = null;
  try {
    tenant = await getTenantByBusinessId(supabase, booking.business_id);
  } catch (tenantErr) {
    console.error("COMBO_CONFIRM_TENANT_ERR:", tenantErr);
  }

  const ref = booking.id.substring(0, 8).toUpperCase();
  const tourName = booking.tours?.name || "Booking";
  const slotTime = booking.slots?.start_time
    ? (tenant ? formatTenantDateTime(tenant.business, booking.slots.start_time) : new Date(booking.slots.start_time).toLocaleString())
    : "See email";
  const brandName = tenant ? getBusinessDisplayName(tenant.business) : "Your Booking";
  const currency = tenant?.business?.currency || "ZAR";

  let invoice: any = null;
  try {
    invoice = await createComboInvoice(booking, tourName, slotTime, paymentId, "Paysafe (Combo)");
  } catch (invErr) {
    console.error("COMBO_INVOICE_ERR (continuing):", invErr);
  }

  // WhatsApp notification
  if (booking.phone && tenant) {
    try {
      await sendWhatsappTextForTenant(
        tenant,
        booking.phone,
        "Combo booking confirmed\n\n" +
        "Ref: " + ref + "\n" +
        tourName + "\n" +
        slotTime + "\n" +
        booking.qty + " guest" + (booking.qty === 1 ? "" : "s") + "\n" +
        currency + " " + booking.total_amount + " paid\n" +
        "Invoice: " + (invoice?.invoice_number || "pending") + "\n\n" +
        "Thanks for booking with " + brandName + ".",
      );
    } catch (e) {
      console.error("COMBO_WA_CONFIRM_ERR:", e);
    }
  }

  // Email notification via send-email function
  if (booking.email) {
    try {
      await fetch(SUPABASE_URL + "/functions/v1/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
        body: JSON.stringify({
          type: "BOOKING_CONFIRM",
          data: {
            email: booking.email,
            booking_id: booking.id,
            business_id: booking.business_id,
            customer_name: booking.customer_name,
            customer_email: booking.email,
            ref: ref,
            payment_reference: invoice?.payment_reference || paymentId,
            tour_name: tourName,
            tour_date: slotTime,
            start_time: slotTime,
            qty: booking.qty,
            total_amount: booking.total_amount,
            invoice_number: invoice?.invoice_number || "",
          },
        }),
      });
    } catch (e) {
      console.error("COMBO_EMAIL_CONFIRM_ERR:", e);
    }
  }

  return { invoice };
}

async function handlePaymentCompleted(paymentId: string, merchantRefNum: string) {
  // Idempotency check
  const idempotencyKey = "paysafe_payment:" + paymentId;
  const idempInsert = await supabase.from("idempotency_keys").insert({ key: idempotencyKey }).select("id").maybeSingle();
  if (idempInsert.error && idempInsert.error.code === "23505") {
    console.log("IDEMPOTENCY_SKIP: already processed key=" + idempotencyKey);
    return;
  }

  // Look up combo_booking by paysafe_payment_id or merchantRefNum (which is combo_booking_id)
  const { data: combo } = await supabase
    .from("combo_bookings")
    .select("*, combo_offers(*)")
    .or("paysafe_payment_id.eq." + paymentId + ",id.eq." + merchantRefNum)
    .maybeSingle();

  if (!combo) {
    console.error("PAYSAFE_WEBHOOK: No combo_booking found for payment=" + paymentId + " merchantRef=" + merchantRefNum);
    return;
  }

  if (combo.payment_status === "PAID") {
    console.log("PAYSAFE_WEBHOOK: combo_booking already PAID: " + combo.id);
    return;
  }

  // Update combo booking payment status
  await supabase.from("combo_bookings").update({
    paysafe_payment_id: paymentId,
    payment_status: "PAID",
  }).eq("id", combo.id);

  // ── Atomic N-party confirmation via server-side RPC ────────────────────────
  // confirm_combo_payment_atomic iterates combo_booking_items (or legacy
  // booking_a_id/booking_b_id for older 2-party combos), confirms every leg
  // in a single transaction, and flips the combo_bookings parent row. Any
  // error rolls back the entire combo — no more "A confirmed, B orphaned".
  const confirmRes = await supabase.rpc("confirm_combo_payment_atomic", {
    p_combo_booking_id: combo.id,
    p_paysafe_payment_id: "PAYSAFE_" + paymentId,
    p_payment_method: "PAYSAFE_COMBO",
  });
  if (confirmRes.error) {
    console.error("COMBO_CONFIRM_ATOMIC_ERR:", confirmRes.error.message);
    await supabase.from("logs").insert({
      business_id: combo?.combo_offers?.business_a_id || null,
      event: "combo_payment_confirm_failed",
      payload: { combo_booking_id: combo.id, paysafe_payment_id: paymentId, error: confirmRes.error.message },
    }).catch(function (e: any) { console.error("LOG_ERR:", e); });
    return;
  }

  // Load the confirmed bookings so we can send confirmations — supports N-party
  // via combo_booking_items, with legacy booking_a_id/booking_b_id as fallback.
  const bookingsToNotify: any[] = [];
  const confirmPath = (confirmRes.data && (confirmRes.data as any).path) || "legacy";
  if (confirmPath === "items") {
    const { data: items } = await supabase
      .from("combo_booking_items")
      .select("booking_id")
      .eq("combo_booking_id", combo.id);
    for (const it of (items || [])) {
      const { data: bk } = await supabase
        .from("bookings")
        .select("*, slots(start_time, booked, held), tours(name)")
        .eq("id", (it as any).booking_id)
        .single();
      if (bk) bookingsToNotify.push(bk);
    }
  } else {
    if (combo.booking_a_id) {
      const { data: bA } = await supabase
        .from("bookings")
        .select("*, slots(start_time, booked, held), tours(name)")
        .eq("id", combo.booking_a_id)
        .single();
      if (bA) bookingsToNotify.push(bA);
    }
    if (combo.booking_b_id) {
      const { data: bB } = await supabase
        .from("bookings")
        .select("*, slots(start_time, booked, held), tours(name)")
        .eq("id", combo.booking_b_id)
        .single();
      if (bB) bookingsToNotify.push(bB);
    }
  }

  // Log
  await supabase.from("logs").insert({
    business_id: combo?.combo_offers?.business_a_id || null,
    event: "combo_payment_completed",
    payload: {
      combo_booking_id: combo.id,
      paysafe_payment_id: paymentId,
      bookings_confirmed: (confirmRes.data as any)?.bookings_confirmed,
      path: confirmPath,
    },
  }).catch(function (e: any) { console.error("LOG_ERR:", e); });

  // Send confirmation emails/WhatsApp for every operator whose leg we just confirmed
  for (const nb of bookingsToNotify) {
    await sendComboConfirmation(nb, combo.id, paymentId);
  }
}

async function handlePaymentFailed(paymentId: string, merchantRefNum: string) {
  // Look up combo booking
  const { data: combo } = await supabase
    .from("combo_bookings")
    .select("*, combo_offers(*)")
    .or("paysafe_payment_id.eq." + paymentId + ",id.eq." + merchantRefNum)
    .maybeSingle();

  if (!combo) {
    console.error("PAYSAFE_WEBHOOK_FAILED: No combo_booking found for payment=" + paymentId);
    return;
  }

  // Load both bookings
  const { data: bookingA } = await supabase
    .from("bookings")
    .select("*, slots(held)")
    .eq("id", combo.booking_a_id)
    .single();
  const { data: bookingB } = await supabase
    .from("bookings")
    .select("*, slots(held)")
    .eq("id", combo.booking_b_id)
    .single();

  // Release held capacity on both slots
  if (bookingA?.slots) {
    await supabase.from("slots").update({
      held: Math.max(0, (bookingA.slots.held || 0) - bookingA.qty),
    }).eq("id", bookingA.slot_id);
  }
  if (bookingB?.slots) {
    await supabase.from("slots").update({
      held: Math.max(0, (bookingB.slots.held || 0) - bookingB.qty),
    }).eq("id", bookingB.slot_id);
  }

  // Mark both bookings as PENDING PAYMENT
  if (bookingA) {
    await supabase.from("bookings").update({ status: "PENDING PAYMENT" }).eq("id", bookingA.id);
  }
  if (bookingB) {
    await supabase.from("bookings").update({ status: "PENDING PAYMENT" }).eq("id", bookingB.id);
  }

  // Update combo booking status
  await supabase.from("combo_bookings").update({ payment_status: "FAILED" }).eq("id", combo.id);

  await supabase.from("logs").insert({
    business_id: combo.combo_offers.business_a_id,
    event: "combo_payment_failed",
    payload: {
      combo_booking_id: combo.id,
      paysafe_payment_id: paymentId,
      booking_a_id: combo.booking_a_id,
      booking_b_id: combo.booking_b_id,
    },
  }).catch(function (e: any) { console.error("LOG_ERR:", e); });
}

Deno.serve(withSentry("paysafe-webhook", async (req: any) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  try {
    const rawBody = await req.text();

    // Verify Paysafe webhook signature
    const sigHeader = req.headers.get("x-paysafe-signature") || req.headers.get("signature");
    const sigValid = await verifyPaysafeSignature(rawBody, sigHeader);
    if (!sigValid) {
      console.error("PAYSAFE_WEBHOOK_SIGNATURE_INVALID: rejected request with bad or missing signature");
      return new Response("Unauthorized", { status: 401 });
    }

    const body = rawBody ? JSON.parse(rawBody) : {};
    console.log("PAYSAFE_WEBHOOK:" + JSON.stringify(body).substring(0, 500));

    const eventType = body.eventType || body.type || "";
    const paymentId = body.id || body.paymentId || body.data?.id || "";
    const merchantRefNum = body.merchantRefNum || body.data?.merchantRefNum || "";

    if (eventType === "PAYMENT_COMPLETED" || eventType === "payment.completed") {
      await handlePaymentCompleted(paymentId, merchantRefNum);
      return new Response("OK", { status: 200 });
    }

    if (eventType === "PAYMENT_FAILED" || eventType === "payment.failed") {
      await handlePaymentFailed(paymentId, merchantRefNum);
      return new Response("OK", { status: 200 });
    }

    console.log("PAYSAFE_WEBHOOK: Ignoring event type: " + eventType);
    return new Response("OK", { status: 200 });
  } catch (err: any) {
    console.error("PAYSAFE_WEBHOOK_ERROR:", err);
    // Always return 200 to webhooks to prevent retries on server errors
    return new Response("OK", { status: 200 });
  }
}));
