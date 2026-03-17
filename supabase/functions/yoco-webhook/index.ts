import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Webhook } from "npm:standardwebhooks";
import { createServiceClient, formatTenantDate, formatTenantDateTime, getBusinessDisplayName, getTenantByBusinessId, sendWhatsappTextForTenant } from "../_shared/tenant.ts";
import { getWaiverContext } from "../_shared/waiver.ts";

var SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
var SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
var supabase = createServiceClient();
function topupQuota(amount: number) {
  if (amount === 100) return 10;
  if (amount === 500) return 60;
  if (amount === 1000) return 140;
  return 0;
}

async function resolveWebhookBusinessId(checkoutId: string, payload: any) {
  var metadata = payload?.metadata || {};
  var metaType = String(metadata.type || "");
  var metaBookingId = String(metadata.booking_id || "");
  var metaVoucherId = String(metadata.voucher_id || "");
  var metaBusinessId = String(metadata.business_id || "");

  if (metaType === "TOPUP" && metaBusinessId) return metaBusinessId;

  if (metaBookingId) {
    var bookingLookup = await supabase.from("bookings").select("business_id").eq("id", metaBookingId).maybeSingle();
    if (bookingLookup.data?.business_id) return String(bookingLookup.data.business_id);
  }

  if (metaVoucherId) {
    var voucherLookup = await supabase.from("vouchers").select("business_id").eq("id", metaVoucherId).maybeSingle();
    if (voucherLookup.data?.business_id) return String(voucherLookup.data.business_id);
  }

  if (checkoutId) {
    var bookingByCheckout = await supabase.from("bookings").select("business_id").eq("yoco_checkout_id", checkoutId).maybeSingle();
    if (bookingByCheckout.data?.business_id) return String(bookingByCheckout.data.business_id);

    var voucherByCheckout = await supabase.from("vouchers").select("business_id").eq("yoco_checkout_id", checkoutId).maybeSingle();
    if (voucherByCheckout.data?.business_id) return String(voucherByCheckout.data.business_id);
  }

  return "";
}

async function verifyWebhookSignature(req: Request, rawBody: string, businessId: string) {
  if (!businessId) {
    console.warn("YOCO_WEBHOOK_VERIFY: no businessId resolved — skipping verification");
    return;
  }

  var tenant: any;
  try {
    tenant = await getTenantByBusinessId(supabase, businessId);
  } catch (credErr) {
    console.warn("YOCO_WEBHOOK_VERIFY: could not load credentials for business " + businessId + " — skipping verification:", credErr);
    return;
  }

  if (!tenant.credentials.yocoWebhookSecret) {
    console.warn("YOCO_WEBHOOK_VERIFY: no webhook secret configured for business " + businessId + " — skipping verification (set it in Settings → Integration Credentials)");
    return;
  }

  var webhook = new Webhook(tenant.credentials.yocoWebhookSecret);
  await webhook.verify(rawBody, {
    "webhook-id": req.headers.get("webhook-id") || "",
    "webhook-timestamp": req.headers.get("webhook-timestamp") || "",
    "webhook-signature": req.headers.get("webhook-signature") || "",
  });
}

async function createInvoice(booking: any, tourName: string, slotTime: string, paymentRef: string) {
  var existing = await supabase.from("invoices").select("*").eq("booking_id", booking.id).order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (existing.data) {
    if (existing.data.payment_reference !== paymentRef) {
      await supabase.from("invoices").update({ payment_method: "Yoco", payment_reference: paymentRef }).eq("id", existing.data.id);
      existing.data.payment_method = "Yoco";
      existing.data.payment_reference = paymentRef;
    }
    return existing.data;
  }

  var invNumR = await supabase.rpc("next_invoice_number");
  var invNum = invNumR.data || "INV-0";
  var subtotal = Number(booking.original_total || booking.total_amount);
  var discountAmt = subtotal - Number(booking.total_amount);
  if (discountAmt < 0) discountAmt = 0;

  var inv = await supabase.from("invoices").insert({
    business_id: booking.business_id, booking_id: booking.id,
    invoice_number: invNum,
    customer_name: booking.customer_name, customer_email: booking.email, customer_phone: booking.phone,
    tour_name: tourName, tour_date: booking.slots?.start_time || null,
    qty: booking.qty, unit_price: booking.unit_price,
    subtotal: subtotal,
    discount_type: booking.discount_type || null,
    discount_percent: booking.discount_percent || 0,
    discount_amount: discountAmt,
    total_amount: booking.total_amount,
    payment_method: "Yoco", payment_reference: paymentRef,
  }).select().single();

  if (inv.data) {
    await supabase.from("bookings").update({ invoice_id: inv.data.id }).eq("id", booking.id);
  }
  return { ...inv.data, invoice_number: invNum };
}

async function sendBookingConfirmation(booking: any, yocoPaymentId: string, checkoutId: string, amount: number) {
  var existingNotificationLog = await supabase
    .from("logs")
    .select("id")
    .eq("booking_id", booking.id)
    .eq("event", "booking_confirmation_notifications_sent")
    .limit(1)
    .maybeSingle();
  if (existingNotificationLog.data?.id) {
    console.log("CONFIRM_ALREADY_SENT booking:" + booking.id);
    return;
  }

  var tenant = await getTenantByBusinessId(supabase, booking.business_id);
  var ref = booking.id.substring(0, 8).toUpperCase();
  var slotTime = booking.slots?.start_time ? formatTenantDateTime(tenant.business, booking.slots.start_time) : "See email";
  var tourName = booking.tours?.name || "Booking";
  var brandName = getBusinessDisplayName(tenant.business);
  var waiver = await getWaiverContext(supabase, { bookingId: booking.id, businessId: booking.business_id });
  var invoice: any = null;
  try {
    invoice = await createInvoice(booking, tourName, slotTime, yocoPaymentId);
  } catch (invErr) {
    console.error("INVOICE_CREATE_ERR (continuing to send notifications):", invErr);
  }

  var waSent = false;
  var emailSent = false;
  var waError = "";
  var emailError = "";

  if (booking.phone) {
    try {
      var currency = tenant.business.currency || "ZAR";
      await sendWhatsappTextForTenant(
        tenant,
        booking.phone,
        "Booking confirmed\n\n" +
        "Ref: " + ref + "\n" +
        tourName + "\n" +
        slotTime + "\n" +
        booking.qty + " guest" + (booking.qty === 1 ? "" : "s") + "\n" +
        currency + " " + booking.total_amount + " paid\n" +
        "Invoice: " + (invoice?.invoice_number || "pending") + "\n\n" +
        (waiver.waiverStatus !== "SIGNED" && waiver.waiverLink ? "Waiver: " + waiver.waiverLink + "\n\n" : "") +
        "Thanks for booking with " + brandName + ".",
        // Template fallback for customers outside the 24h window
        {
          name: "booking_confirmed",
          params: [
            ref,
            tourName,
            slotTime,
            String(booking.qty),
            currency + " " + booking.total_amount,
          ],
        },
      );
      waSent = true;
    } catch (e) {
      waError = e instanceof Error ? e.message : String(e);
      console.error("WA confirm err:", e);
    }
  }

  if (booking.email) {
    try {
      var emailRes = await fetch(SUPABASE_URL + "/functions/v1/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
        body: JSON.stringify({
          type: "BOOKING_CONFIRM",
          data: {
            email: booking.email,
            booking_id: booking.id,
            business_id: booking.business_id,
            waiver_status: waiver.waiverStatus,
            waiver_url: waiver.waiverLink,
            customer_name: booking.customer_name,
            customer_email: booking.email,
            ref: ref,
            payment_reference: invoice?.payment_reference || yocoPaymentId,
            tour_name: tourName,
            tour_date: slotTime,
            start_time: slotTime,
            qty: booking.qty,
            total_amount: booking.total_amount,
            invoice_number: invoice?.invoice_number || "",
          }
        }),
      });
      var emailData = await emailRes.json().catch(() => ({}));
      if (!emailRes.ok || emailData?.error) {
        emailError = String(emailData?.error || emailRes.statusText || "Email send failed");
        console.error("CONFIRM_EMAIL_ERR:", emailError);
      } else {
        emailSent = true;
      }
    } catch (e) {
      emailError = e instanceof Error ? e.message : String(e);
      console.error("confirm email err", e);
    }
  }

  await supabase.from("logs").insert({
    business_id: booking.business_id,
    booking_id: booking.id,
    event: "booking_confirmation_notifications_sent",
    payload: {
      yoco_payment_id: yocoPaymentId,
      checkout_id: checkoutId,
      amount,
      wa_sent: waSent,
      email_sent: emailSent,
      wa_error: waError || null,
      email_error: emailError || null,
    },
  });
}

Deno.serve(async (req: any) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });
  try {
    var rawBody = await req.text();
    var body = rawBody ? JSON.parse(rawBody) : {};
    console.log("YOCO_WEBHOOK:" + JSON.stringify(body).substring(0, 500));
    var type = body.type; var payload = body.payload;
    if (type !== "payment.succeeded" && type !== "payment.failed") { console.log("Ignoring:" + type); return new Response("OK", { status: 200 }); }
    var checkoutId = payload.metadata?.checkoutId || payload.checkoutId || payload.checkout_id || "";
    var yocoPaymentId = payload.id || "";
    var metaBookingId = payload.metadata?.booking_id || "";
    var metaType = String(payload.metadata?.type || "");
    if (!checkoutId && !metaBookingId) { console.log("No checkoutId or booking_id in payload"); return new Response("OK", { status: 200 }); }
    var businessId = await resolveWebhookBusinessId(checkoutId, payload);
    try {
      await verifyWebhookSignature(req, rawBody, businessId);
    } catch (verifyError) {
      console.error("YOCO_WEBHOOK_VERIFY_ERROR:", verifyError);
      return new Response("Unauthorized", { status: 401 });
    }

    if (type === "payment.failed") {
      var fb = checkoutId
        ? await supabase.from("bookings").select("id, status").eq("yoco_checkout_id", checkoutId).maybeSingle()
        : { data: null };
      if (!fb.data && metaBookingId) {
        fb = await supabase.from("bookings").select("id, status").eq("id", metaBookingId).maybeSingle();
      }
      if (fb.data && (fb.data.status === "HELD" || fb.data.status === "PENDING" || fb.data.status === "CONFIRMED")) {
        await supabase.from("bookings").update({ status: "PENDING PAYMENT" }).eq("id", fb.data.id);
        console.log("PAYMENT FAILED - Marking as PENDING PAYMENT for booking:" + fb.data.id);
      }
      return new Response("OK", { status: 200 });
    }

    if (metaType === "TOPUP") {
      var topupBusinessId = String(payload.metadata?.business_id || "");
      var amountZar = Number(payload.metadata?.amount_zar || Math.round((Number(payload.amount) || 0) / 100));
      var extraQuota = topupQuota(amountZar);
      var periodStart = new Date();
      periodStart.setDate(1);
      periodStart.setHours(0, 0, 0, 0);
      if (topupBusinessId && amountZar > 0 && extraQuota > 0) {
        var existingByPayment = yocoPaymentId
          ? await supabase.from("topup_orders").select("id").eq("yoco_payment_id", yocoPaymentId).limit(1).maybeSingle()
          : { data: null as any };
        if (existingByPayment.data?.id) return new Response("OK", { status: 200 });

        var existingByCheckout = checkoutId
          ? await supabase.from("topup_orders").select("id").eq("yoco_checkout_id", checkoutId).limit(1).maybeSingle()
          : { data: null as any };
        if (existingByCheckout.data?.id) return new Response("OK", { status: 200 });

        await supabase.from("topup_orders").insert({
          business_id: topupBusinessId,
          period_key: periodStart.toISOString().slice(0, 10),
          amount_zar: amountZar,
          extra_quota: extraQuota,
          status: "PAID",
          source: "YOCO",
          paid_at: new Date().toISOString(),
          yoco_payment_id: yocoPaymentId,
          yoco_checkout_id: checkoutId,
          metadata: { yoco_payment_id: yocoPaymentId, checkout_id: checkoutId },
        });
        await supabase.from("logs").insert({
          business_id: topupBusinessId,
          event: "topup_payment_confirmed",
          payload: { amount_zar: amountZar, extra_quota: extraQuota, yoco_payment_id: yocoPaymentId, checkout_id: checkoutId },
        });
      }
      return new Response("OK", { status: 200 });
    }
    // Check if this is a gift voucher payment
    var gvr = await supabase.from("vouchers").select("*").eq("yoco_checkout_id", checkoutId).single();
    if (gvr.data && gvr.data.status === "PENDING") {
      var gv = gvr.data;
      await supabase.from("vouchers").update({ status: "ACTIVE" }).eq("id", gv.id);
      // Send voucher email
      try {
        await fetch(SUPABASE_URL + "/functions/v1/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
          body: JSON.stringify({
            type: "GIFT_VOUCHER", data: {
              email: gv.buyer_email,
              code: gv.code,
              recipient_name: gv.recipient_name,
              gift_message: gv.gift_message,
              buyer_name: gv.buyer_name,
              tour_name: gv.tour_name,
              value: gv.value || gv.purchase_amount,
              expires_at: formatTenantDate(await getTenantByBusinessId(supabase, gv.business_id).then(function (t) { return t.business; }), gv.expires_at),
            }
          }),
        });
      } catch (e) { console.log("gv email err"); }
      // WhatsApp confirmation
      if (gv.buyer_phone) {
        var gvTenant = await getTenantByBusinessId(supabase, gv.business_id);
        await sendWhatsappTextForTenant(gvTenant, gv.buyer_phone,
          "Gift voucher purchased\n\n" +
          "Code: " + gv.code + "\n" +
          (gv.tour_name || "Any activity") + "\n" +
          "For: " + (gv.recipient_name || "Your guest") + "\n" +
          "Value: " + (gvTenant.business.currency || "ZAR") + " " + (gv.value || gv.purchase_amount) + "\n\n" +
          "The voucher has been emailed to " + gv.buyer_email + "."
        );
        await supabase.from("conversations").update({ current_state: "IDLE", state_data: {} }).eq("phone", gv.buyer_phone).eq("business_id", gv.business_id);
      }
      console.log("GV PAYMENT CONFIRMED voucher:" + gv.code);
      return new Response("OK", { status: 200 });
    }

    var br = checkoutId
      ? await supabase.from("bookings").select("*, slots(start_time), tours(name)").eq("yoco_checkout_id", checkoutId).maybeSingle()
      : { data: null, error: null };
    if (!br.data && metaBookingId) {
      console.log("Fallback: lookup by metadata.booking_id=" + metaBookingId);
      br = await supabase.from("bookings").select("*, slots(start_time), tours(name)").eq("id", metaBookingId).maybeSingle();
    }
    if (!br.data) { console.log("No booking found. checkoutId=" + checkoutId + " bookingId=" + metaBookingId); return new Response("OK", { status: 200 }); }
    var booking = br.data;
    if (booking.status === "PAID" || booking.status === "COMPLETED") {
      console.log("Already paid, ensuring confirmation delivery:" + booking.id);
      await sendBookingConfirmation(booking, booking.yoco_payment_id || yocoPaymentId, checkoutId, payload.amount);
      return new Response("OK", { status: 200 });
    }

    // Atomically update to PAID — if already updated by a concurrent webhook, skip
    var upd = await supabase.from("bookings").update({ status: "PAID", yoco_payment_id: yocoPaymentId }).eq("id", booking.id).is("yoco_payment_id", null).select("id").maybeSingle();
    if (upd.error) {
      console.log("BOOKING_PAID_UPDATE_FAILED booking=" + booking.id + " err=" + upd.error.message);
      await supabase.from("logs").insert({
        business_id: booking.business_id,
        booking_id: booking.id,
        event: "payment_confirmed_but_status_update_failed",
        payload: { error: upd.error.message, yoco_payment_id: yocoPaymentId, checkout_id: checkoutId },
      });
      return new Response("OK", { status: 200 });
    }
    if (!upd.data) {
      console.log("Already processed (concurrent webhook), ensuring confirmation delivery:" + booking.id);
      await sendBookingConfirmation(booking, booking.yoco_payment_id || yocoPaymentId, checkoutId, payload.amount);
      return new Response("OK", { status: 200 });
    }
    await supabase.from("holds").update({ status: "CONVERTED" }).eq("booking_id", booking.id).eq("status", "ACTIVE");
    var sr = await supabase.from("slots").select("booked, held").eq("id", booking.slot_id).single();
    if (sr.data) { await supabase.from("slots").update({ booked: sr.data.booked + booking.qty, held: Math.max(0, sr.data.held - booking.qty) }).eq("id", booking.slot_id); }
    await supabase.from("logs").insert({ business_id: booking.business_id, booking_id: booking.id, event: "payment_confirmed", payload: { yoco_payment_id: yocoPaymentId, checkout_id: checkoutId, amount: payload.amount } });
    await supabase.from("conversations").update({ current_state: "IDLE", state_data: {}, updated_at: new Date().toISOString() }).eq("phone", booking.phone).eq("business_id", booking.business_id);
    await sendBookingConfirmation({ ...booking, status: "PAID", yoco_payment_id: yocoPaymentId }, yocoPaymentId, checkoutId, payload.amount);

    console.log("PAYMENT CONFIRMED booking:" + booking.id);
    return new Response("OK", { status: 200 });
  } catch (err) { console.error("YOCO_WEBHOOK_ERROR:", err); return new Response("OK", { status: 200 }); }
});
