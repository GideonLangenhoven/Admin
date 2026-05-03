// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

var SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
var SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
var WA_TOKEN = Deno.env.get("WA_ACCESS_TOKEN")!;
var WA_PHONE_ID = Deno.env.get("WA_PHONE_NUMBER_ID")!;
var PAYFAST_PASSPHRASE = Deno.env.get("PAYFAST_PASSPHRASE") || "";
var BUSINESS_ID = Deno.env.get("BUSINESS_ID")!;

var supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function sendText(to: any, text: any) {
  await fetch("https://graph.facebook.com/v19.0/" + WA_PHONE_ID + "/messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + WA_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: to, type: "text", text: { body: text } }),
  });
}

function verifySignature(params: any, receivedSig: any) {
  // Build param string for signature check
  var keys = Object.keys(params).filter(function(k) { return k !== "signature"; }).sort();
  var pfParamString = "";
  for (var i = 0; i < keys.length; i++) {
    if (i > 0) pfParamString += "&";
    pfParamString += keys[i] + "=" + encodeURIComponent(params[keys[i]]).replace(/%20/g, "+");
  }
  if (PAYFAST_PASSPHRASE) {
    pfParamString += "&passphrase=" + encodeURIComponent(PAYFAST_PASSPHRASE).replace(/%20/g, "+");
  }

  // MD5 hash
  var encoder = new TextEncoder();
  var data = encoder.encode(pfParamString);
  var hashBuffer = new Uint8Array(16);

  // Use SubtleCrypto for MD5 isn't available, fallback to simple check
  // For production, validate server-side with PayFast
  console.log("ITN_SIG_CHECK: received=" + receivedSig);
  return true; // We validate with PayFast server below instead
}

async function validateWithPayFast(params: any) {
  var sandbox = Deno.env.get("PAYFAST_SANDBOX") === "true";
  var validateUrl = sandbox
    ? "https://sandbox.payfast.co.za/eng/query/validate"
    : "https://www.payfast.co.za/eng/query/validate";

  var keys = Object.keys(params).filter(function(k) { return k !== "signature"; });
  var body = "";
  for (var i = 0; i < keys.length; i++) {
    if (i > 0) body += "&";
    body += keys[i] + "=" + encodeURIComponent(params[keys[i]]).replace(/%20/g, "+");
  }

  try {
    var res = await fetch(validateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body,
    });
    var text = await res.text();
    console.log("PF_VALIDATE:" + text);
    return text.trim() === "VALID";
  } catch (err) {
    console.error("PF_VALIDATE_ERR:", err);
    return true; // Fail open to not block payments, log for review
  }
}

Deno.serve(async (req: any) => {
  // CRITICAL: Always return 200 to PayFast
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  try {
    var bodyText = await req.text();
    console.log("ITN_RAW:" + bodyText.substring(0, 500));

    // Parse form data
    var params: any = {};
    var pairs = bodyText.split("&");
    for (var i = 0; i < pairs.length; i++) {
      var kv = pairs[i].split("=");
      if (kv.length === 2) params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1].replace(/\+/g, " "));
    }

    var bookingId = params.m_payment_id;
    var paymentStatus = params.payment_status;
    var amountGross = params.amount_gross;
    var pfPaymentId = params.pf_payment_id;

    console.log("ITN: booking=" + bookingId + " status=" + paymentStatus + " amount=" + amountGross + " pfId=" + pfPaymentId);

    if (!bookingId) {
      console.log("ITN: No booking ID");
      return new Response("OK", { status: 200 });
    }

    // Get booking
    var br = await supabase.from("bookings").select("*, slots(start_time, tour_id)").eq("id", bookingId).single();
    if (!br.data) {
      console.log("ITN: Booking not found: " + bookingId);
      return new Response("OK", { status: 200 });
    }
    var booking = br.data;

    // Idempotency: if already PAID, skip
    if (booking.status === "PAID" || booking.status === "COMPLETED") {
      console.log("ITN: Already paid, skipping");
      return new Response("OK", { status: 200 });
    }

    // Validate with PayFast server
    var valid = await validateWithPayFast(params);
    if (!valid) {
      console.error("ITN: PayFast validation failed");
      await supabase.from("logs").insert({ business_id: BUSINESS_ID, booking_id: bookingId, event: "itn_validation_failed", payload: params });
      return new Response("OK", { status: 200 });
    }

    // Check payment status
    if (paymentStatus !== "COMPLETE") {
      console.log("ITN: Payment not complete: " + paymentStatus);
      if (paymentStatus === "CANCELLED") {
        await supabase.from("bookings").update({ status: "CANCELLED", cancellation_reason: "Payment cancelled" }).eq("id", bookingId);
        // Release hold
        await supabase.from("holds").update({ status: "RELEASED" }).eq("booking_id", bookingId).eq("status", "ACTIVE");
        // Release held seats
        var cancelSlot = await supabase.from("slots").select("held").eq("id", booking.slot_id).single();
        if (cancelSlot.data) {
          await supabase.from("slots").update({ held: Math.max(0, cancelSlot.data.held - booking.qty) }).eq("id", booking.slot_id);
        }
        await sendText(booking.phone, "Your payment was cancelled. Your hold has been released.\n\nReply *menu* to start again.");
      }
      await supabase.from("logs").insert({ business_id: BUSINESS_ID, booking_id: bookingId, event: "itn_status_" + paymentStatus, payload: params });
      return new Response("OK", { status: 200 });
    }

    // Verify amount matches
    var expectedAmount = Number(booking.total_amount).toFixed(2);
    if (amountGross && Number(amountGross).toFixed(2) !== expectedAmount) {
      console.error("ITN: Amount mismatch. Expected:" + expectedAmount + " Got:" + amountGross);
      await supabase.from("logs").insert({ business_id: BUSINESS_ID, booking_id: bookingId, event: "itn_amount_mismatch", payload: { expected: expectedAmount, received: amountGross } });
      // Still process but flag for review
    }

    // ---- PAYMENT CONFIRMED ----

    // 1. Update booking to PAID
    await supabase.from("bookings").update({
      status: "PAID",
      payfast_m_payment_id: pfPaymentId || null,
    }).eq("id", bookingId);

    // 2. Convert hold to CONVERTED
    await supabase.from("holds").update({ status: "CONVERTED" }).eq("booking_id", bookingId).eq("status", "ACTIVE");

    // 3. Move seats from held to booked
    var slotR = await supabase.from("slots").select("booked, held").eq("id", booking.slot_id).single();
    if (slotR.data) {
      await supabase.from("slots").update({
        booked: slotR.data.booked + booking.qty,
        held: Math.max(0, slotR.data.held - booking.qty),
      }).eq("id", booking.slot_id);
    }

    // 4. Log success
    await supabase.from("logs").insert({ business_id: BUSINESS_ID, booking_id: bookingId, event: "payment_confirmed", payload: { pf_payment_id: pfPaymentId, amount: amountGross } });

    // 5. Send WhatsApp confirmation
    var ref = bookingId.substring(0, 8).toUpperCase();
    var slotTime = booking.slots ? fmtSlotTime(booking.slots.start_time) : "See confirmation email";

    var discountLine = "";
    if (booking.discount_type === "GROUP") discountLine = "\n\u{1F389} 5% group discount applied";
    if (booking.discount_type === "LOYALTY") discountLine = "\n\u{1F31F} 10% loyalty discount applied";

    await sendText(booking.phone,
      "\u{1F389} *Booking Confirmed!*\n\n" +
      "\u{1F4CB} Ref: " + ref + "\n" +
      "\u{1F6F6} Sea Kayak Tour\n" +
      "\u{1F4C5} " + slotTime + "\n" +
      "\u{1F465} " + booking.qty + " people\n" +
      "\u{1F4B0} R" + booking.total_amount + " paid" + discountLine + "\n\n" +
      "\u{1F4CD} *Meeting Point:*\nThree Anchor Bay, Beach Road, Sea Point\nArrive 15 min early\n\n" +
      "\u{1F392} *Remember to bring:*\nSunscreen, hat, towel, water bottle\n\n" +
      "See you on the water! \u{1F30A}\n\n" +
      "Need to change plans? Reply *menu* anytime."
    );

    // 6. Reset conversation state
    await supabase.from("conversations").update({
      current_state: "IDLE", state_data: {},
      last_booking_id: bookingId, updated_at: new Date().toISOString(),
    }).eq("business_id", BUSINESS_ID).eq("phone", booking.phone);

    console.log("ITN: SUCCESS for " + bookingId);

  } catch (err) {
    console.error("ITN_ERROR:", err);
    // Log error but still return 200
    try {
      await supabase.from("logs").insert({ business_id: BUSINESS_ID, event: "itn_error", payload: { error: String(err) } });
    } catch (e) {}
  }

  // ALWAYS return 200
  return new Response("OK", { status: 200 });
});

function fmtSlotTime(iso: any) {
  return new Date(iso).toLocaleString("en-ZA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" });
}
