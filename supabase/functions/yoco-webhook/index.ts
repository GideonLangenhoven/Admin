import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Webhook } from "npm:standardwebhooks";
import { createServiceClient, formatTenantDate, formatTenantDateTime, getBusinessDisplayName, getTenantByBusinessId, resolveManageBookingsUrl, sendWhatsappTextForTenant } from "../_shared/tenant.ts";
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

  var invNumR = await supabase.rpc("next_invoice_number", { p_business_id: booking.business_id }).catch(function () { return { data: null, error: { message: "RPC not found" } }; });
  if (invNumR.error) {
    console.warn("next_invoice_number RPC failed (using fallback):", invNumR.error.message);
  }
  var invNum = invNumR.data || ("INV-" + Date.now());
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
  // Idempotency: check logs table first (always exists)
  var existingLog = await supabase
    .from("logs")
    .select("id")
    .eq("booking_id", booking.id)
    .eq("event", "booking_confirmation_notifications_sent")
    .limit(1)
    .maybeSingle();
  if (existingLog.data?.id) {
    console.log("CONFIRM_ALREADY_SENT (log exists) booking:" + booking.id);
    return;
  }

  // Try atomic lock via confirmation_sent_at column (if migration was run).
  // If column doesn't exist or update fails, proceed anyway — logs check above is the primary guard.
  try {
    var claimLock = await supabase
      .from("bookings")
      .update({ confirmation_sent_at: new Date().toISOString() })
      .eq("id", booking.id)
      .is("confirmation_sent_at", null)
      .select("id")
      .maybeSingle();
    if (claimLock.data === null && !claimLock.error) {
      // Column exists and lock was already claimed by another webhook
      console.log("CONFIRM_ALREADY_SENT (lock claimed by another webhook) booking:" + booking.id);
      return;
    }
    if (claimLock.error) {
      console.warn("CONFIRM_LOCK_WARN (proceeding anyway):", claimLock.error.message);
    }
  } catch (lockErr) {
    console.warn("CONFIRM_LOCK_ERR (proceeding anyway):", lockErr);
  }

  var tenant: any = null;
  try {
    tenant = await getTenantByBusinessId(supabase, booking.business_id);
  } catch (tenantErr) {
    console.error("CONFIRM_TENANT_ERR (will still attempt email via send-email):", tenantErr);
  }
  var ref = booking.id.substring(0, 8).toUpperCase();
  var slotTime = booking.slots?.start_time
    ? (tenant ? formatTenantDateTime(tenant.business, booking.slots.start_time) : new Date(booking.slots.start_time).toLocaleString())
    : "See email";
  var tourName = booking.tours?.name || "Booking";
  var brandName = tenant ? getBusinessDisplayName(tenant.business) : "Your Booking";
  var waiver: any = { waiverStatus: "PENDING", waiverLink: "" };
  try {
    waiver = await getWaiverContext(supabase, { bookingId: booking.id, businessId: booking.business_id });
  } catch (waiverErr) {
    console.error("CONFIRM_WAIVER_ERR (proceeding without waiver info):", waiverErr);
  }

  // Last-minute booking: if trip is within 24 hours, always include waiver link prominently
  var isLastMinute = false;
  if (booking.slots?.start_time) {
    var hoursUntilTrip = (new Date(booking.slots.start_time).getTime() - Date.now()) / (1000 * 60 * 60);
    isLastMinute = hoursUntilTrip < 24 && hoursUntilTrip > 0;
  }

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

  if (booking.phone && tenant) {
    try {
      var currency = tenant.business.currency || "ZAR";
      var myBookingsUrl = resolveManageBookingsUrl(tenant.business);
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
        (waiver.waiverStatus !== "SIGNED" && waiver.waiverLink
          ? (isLastMinute ? "IMPORTANT - Please sign your waiver before the trip:\n" : "Waiver: ") + waiver.waiverLink + "\n\n"
          : "") +
        "Thanks for booking with " + brandName + ".",
        // Template fallback for customers outside the 24h window
        {
          name: "booking_confirmed1",
          params: [
            ref,
            tourName,
            slotTime,
            String(booking.qty),
            currency + " " + booking.total_amount,
            myBookingsUrl,
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
            is_last_minute: isLastMinute,
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

    // ── IDEMPOTENCY CHECK ──
    // Prevent duplicate processing when Yoco sends the same webhook multiple times
    if (type === "payment.succeeded" && (yocoPaymentId || checkoutId)) {
      var idempotencyKey = "yoco_payment:" + (yocoPaymentId || checkoutId);
      var idempInsert = await supabase.from("idempotency_keys").insert({ key: idempotencyKey }).select("id").maybeSingle();
      if (idempInsert.error && idempInsert.error.code === "23505") {
        // Duplicate key — this payment was already processed
        console.log("IDEMPOTENCY_SKIP: already processed key=" + idempotencyKey);
        return new Response("OK", { status: 200 });
      }
    }

    if (type === "payment.failed") {
      // Handle failed reschedule upgrade payment — cancel the pending reschedule and release hold
      if (metaType === "RESCHEDULE") {
        var failedPrId = String(payload.metadata?.pending_reschedule_id || "");
        if (failedPrId) {
          var failedPr = await supabase.from("pending_reschedules").select("*").eq("id", failedPrId).eq("status", "PENDING").single();
          if (failedPr.data) {
            await supabase.from("pending_reschedules").update({ status: "CANCELLED" }).eq("id", failedPr.data.id);
            if (failedPr.data.hold_id) {
              await supabase.from("holds").update({ status: "CANCELLED" }).eq("id", failedPr.data.hold_id);
            }
            // Release held capacity on new slot
            var failedSlot = await supabase.from("slots").select("held").eq("id", failedPr.data.new_slot_id).single();
            if (failedSlot.data) {
              var failedBooking = await supabase.from("bookings").select("qty").eq("id", failedPr.data.booking_id).single();
              var failedQty = failedBooking.data?.qty || 0;
              await supabase.from("slots").update({ held: Math.max(0, (failedSlot.data.held || 0) - failedQty) }).eq("id", failedPr.data.new_slot_id);
            }
            await supabase.from("logs").insert({
              business_id: failedPr.data.business_id,
              booking_id: failedPr.data.booking_id,
              event: "reschedule_upgrade_payment_failed",
              payload: { pending_reschedule_id: failedPr.data.id, checkout_id: checkoutId },
            });
            console.log("RESCHEDULE PAYMENT FAILED - cancelled pending_reschedule:" + failedPr.data.id);
          }
        }
        return new Response("OK", { status: 200 });
      }

      // Handle failed ADD_GUESTS payment — release hold
      if (metaType === "ADD_GUESTS") {
        var failedHoldId = String(payload.metadata?.hold_id || "");
        var failedAgBookingId = String(payload.metadata?.booking_id || "");
        var failedAgNewQty = Number(payload.metadata?.new_qty || 0);
        if (failedHoldId) {
          await supabase.from("holds").update({ status: "CANCELLED" }).eq("id", failedHoldId);
          // Release held capacity
          if (failedAgBookingId) {
            var failedAgBooking = await supabase.from("bookings").select("slot_id, qty").eq("id", failedAgBookingId).single();
            if (failedAgBooking.data) {
              var failedAgDelta = failedAgNewQty - failedAgBooking.data.qty;
              if (failedAgDelta > 0) {
                var failedAgSlot = await supabase.from("slots").select("held").eq("id", failedAgBooking.data.slot_id).single();
                if (failedAgSlot.data) {
                  await supabase.from("slots").update({ held: Math.max(0, (failedAgSlot.data.held || 0) - failedAgDelta) }).eq("id", failedAgBooking.data.slot_id);
                }
              }
            }
          }
          await supabase.from("logs").insert({
            business_id: businessId,
            booking_id: failedAgBookingId,
            event: "add_guests_payment_failed",
            payload: { hold_id: failedHoldId, checkout_id: checkoutId },
          });
          console.log("ADD_GUESTS PAYMENT FAILED - cancelled hold:" + failedHoldId);
        }
        return new Response("OK", { status: 200 });
      }

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

    // ── RESCHEDULE UPGRADE PAYMENT ──
    if (metaType === "RESCHEDULE") {
      var pendingRescheduleId = String(payload.metadata?.pending_reschedule_id || "");
      if (!pendingRescheduleId) {
        console.log("RESCHEDULE webhook but no pending_reschedule_id in metadata");
        return new Response("OK", { status: 200 });
      }

      var prRes = await supabase
        .from("pending_reschedules")
        .select("*")
        .eq("id", pendingRescheduleId)
        .eq("status", "PENDING")
        .single();

      if (!prRes.data) {
        console.log("RESCHEDULE: pending_reschedule not found or already processed: " + pendingRescheduleId);
        return new Response("OK", { status: 200 });
      }

      var pr = prRes.data;
      var prBooking = await supabase
        .from("bookings")
        .select("*, slots(start_time), tours(name)")
        .eq("id", pr.booking_id)
        .single();

      if (!prBooking.data) {
        console.log("RESCHEDULE: booking not found for pending reschedule: " + pr.booking_id);
        return new Response("OK", { status: 200 });
      }

      var rBooking = prBooking.data;

      // 1. Release old slot capacity (decrement booked)
      var oldSlotData = await supabase.from("slots").select("booked").eq("id", pr.old_slot_id).single();
      if (oldSlotData.data) {
        await supabase.from("slots").update({
          booked: Math.max(0, (oldSlotData.data.booked || 0) - rBooking.qty),
        }).eq("id", pr.old_slot_id);
      }

      // 2. Convert hold on new slot: held -> booked
      var newSlotData = await supabase.from("slots").select("booked, held").eq("id", pr.new_slot_id).single();
      if (newSlotData.data) {
        await supabase.from("slots").update({
          booked: (newSlotData.data.booked || 0) + rBooking.qty,
          held: Math.max(0, (newSlotData.data.held || 0) - rBooking.qty),
        }).eq("id", pr.new_slot_id);
      }

      // 3. Update booking to new slot
      await supabase.from("bookings").update({
        slot_id: pr.new_slot_id,
        tour_id: pr.new_tour_id,
        unit_price: pr.new_unit_price,
        total_amount: pr.new_total_amount,
      }).eq("id", pr.booking_id);

      // 4. Mark hold as CONVERTED
      if (pr.hold_id) {
        await supabase.from("holds").update({ status: "CONVERTED" }).eq("id", pr.hold_id);
      }

      // 5. Mark pending_reschedule as COMPLETED
      await supabase.from("pending_reschedules").update({
        status: "COMPLETED",
        completed_at: new Date().toISOString(),
      }).eq("id", pr.id);

      // 6. Log the completed reschedule
      await supabase.from("logs").insert({
        business_id: pr.business_id,
        booking_id: pr.booking_id,
        event: "reschedule_upgrade_completed",
        payload: {
          pending_reschedule_id: pr.id,
          old_slot_id: pr.old_slot_id,
          new_slot_id: pr.new_slot_id,
          diff: pr.diff,
          yoco_payment_id: yocoPaymentId,
          checkout_id: checkoutId,
        },
      });

      // 7. Send reschedule confirmation notification
      try {
        var rTenant = await getTenantByBusinessId(supabase, pr.business_id);
        var rRef = pr.booking_id.substring(0, 8).toUpperCase();
        // Re-fetch booking with new slot info for notification
        var updatedBooking = await supabase
          .from("bookings")
          .select("*, slots(start_time), tours(name)")
          .eq("id", pr.booking_id)
          .single();
        var rBk = updatedBooking.data || rBooking;
        var rTourName = rBk.tours?.name || "Booking";
        var rSlotTime = rBk.slots?.start_time ? formatTenantDateTime(rTenant.business, rBk.slots.start_time) : "";
        var rBrandName = getBusinessDisplayName(rTenant.business);

        if (rBk.phone) {
          try {
            await sendWhatsappTextForTenant(rTenant, rBk.phone,
              "Booking rescheduled\n\n" +
              "Hi " + ((rBk.customer_name && rBk.customer_name.split(" ")[0]) || "there") +
              ", your booking has been moved to a new date/time.\n\n" +
              "Ref: " + rRef + "\n" +
              rTourName + (rSlotTime ? "\n" + rSlotTime : "") + "\n\n" +
              "Thanks, " + rBrandName + "."
            );
          } catch (e) { console.error("RESCHEDULE_CONFIRM_WA_ERR:", e); }
        }

        if (rBk.email) {
          try {
            await fetch(SUPABASE_URL + "/functions/v1/send-email", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
              body: JSON.stringify({
                type: "BOOKING_UPDATED",
                data: {
                  business_id: pr.business_id,
                  email: rBk.email,
                  customer_name: rBk.customer_name,
                  ref: rRef,
                  tour_name: rTourName,
                  start_time: rSlotTime || rBk.slots?.start_time || "",
                  message: "Your booking has been moved to a new date/time.",
                  event: "rescheduled",
                },
              }),
            });
          } catch (e) { console.error("RESCHEDULE_CONFIRM_EMAIL_ERR:", e); }
        }
      } catch (notifyErr) {
        console.error("RESCHEDULE_NOTIFY_ERR:", notifyErr);
      }

      console.log("RESCHEDULE UPGRADE COMPLETED booking:" + pr.booking_id + " pending_reschedule:" + pr.id);
      return new Response("OK", { status: 200 });
    }

    // ── ADD_GUESTS PAYMENT ──
    if (metaType === "ADD_GUESTS") {
      var agHoldId = String(payload.metadata?.hold_id || "");
      var agNewQty = Number(payload.metadata?.new_qty || 0);
      var agBookingId = String(payload.metadata?.booking_id || "");

      if (agBookingId && agNewQty > 0) {
        var agBooking = await supabase
          .from("bookings")
          .select("*, slots(start_time), tours(name)")
          .eq("id", agBookingId)
          .single();

        if (agBooking.data) {
          var agBk = agBooking.data;
          var agDelta = agNewQty - agBk.qty;
          var agUnitPrice = Number(agBk.unit_price || 0);
          var agNewTotal = agNewQty * agUnitPrice;

          // Update booking qty and total
          await supabase.from("bookings").update({
            qty: agNewQty,
            total_amount: agNewTotal,
          }).eq("id", agBookingId);

          // Convert hold: held -> booked on slot
          if (agHoldId) {
            await supabase.from("holds").update({ status: "CONVERTED" }).eq("id", agHoldId);
          }
          var agSlot = await supabase.from("slots").select("booked, held").eq("id", agBk.slot_id).single();
          if (agSlot.data) {
            await supabase.from("slots").update({
              booked: (agSlot.data.booked || 0) + agDelta,
              held: Math.max(0, (agSlot.data.held || 0) - agDelta),
            }).eq("id", agBk.slot_id);
          }

          await supabase.from("logs").insert({
            business_id: agBk.business_id,
            booking_id: agBookingId,
            event: "guests_added_payment_confirmed",
            payload: { old_qty: agBk.qty, new_qty: agNewQty, hold_id: agHoldId, yoco_payment_id: yocoPaymentId },
          });

          // Invalidate waiver if previously signed — new guests are uninsured
          if (agBk.waiver_status === "SIGNED") {
            var newWaiverToken = crypto.randomUUID();
            await supabase.from("bookings").update({
              waiver_status: "PENDING",
              waiver_token: newWaiverToken,
              waiver_token_expires_at: null, // trigger will re-set based on slot time
            }).eq("id", agBookingId);

            // Send INDEMNITY email so the lead booker can update the waiver
            if (agBk.email) {
              try {
                var agWaiverTenant = await getTenantByBusinessId(supabase, agBk.business_id);
                var agWaiverRef = agBookingId.substring(0, 8).toUpperCase();
                await fetch(SUPABASE_URL + "/functions/v1/send-email", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
                  body: JSON.stringify({
                    type: "INDEMNITY",
                    data: {
                      booking_id: agBookingId,
                      business_id: agBk.business_id,
                      waiver_status: "PENDING",
                      waiver_token: newWaiverToken,
                      email: agBk.email,
                      customer_name: agBk.customer_name || "Guest",
                      ref: agWaiverRef,
                      tour_name: agBk.tours?.name || "Experience",
                      start_time: agBk.slots?.start_time ? formatTenantDateTime(agWaiverTenant.business, agBk.slots.start_time) : "TBC",
                      qty: agNewQty,
                      message: "You've added new guests — please update your waiver",
                    },
                  }),
                });
              } catch (e) { console.error("ADD_GUESTS_WAIVER_EMAIL_ERR:", e); }
            }

            await supabase.from("logs").insert({
              business_id: agBk.business_id,
              booking_id: agBookingId,
              event: "waiver_invalidated_guests_added",
              payload: { old_waiver_status: "SIGNED", new_waiver_status: "PENDING", new_waiver_token: newWaiverToken },
            });
          }

          // Send notification (WhatsApp + email)
          try {
            var agTenant = await getTenantByBusinessId(supabase, agBk.business_id);
            var agRef = agBookingId.substring(0, 8).toUpperCase();
            var agTourName = agBk.tours?.name || "Booking";
            var agBrandName = getBusinessDisplayName(agTenant.business);
            var agSlotTime = agBk.slots?.start_time ? formatTenantDateTime(agTenant.business, agBk.slots.start_time) : "";

            if (agBk.phone) {
              try {
                await sendWhatsappTextForTenant(agTenant, agBk.phone,
                  "Booking updated\n\n" +
                  "Hi " + ((agBk.customer_name && agBk.customer_name.split(" ")[0]) || "there") + ", " +
                  agDelta + " guest" + (agDelta === 1 ? "" : "s") + " added to your booking.\n\n" +
                  "Ref: " + agRef + "\n" +
                  agTourName + "\n\n" +
                  "Thanks, " + agBrandName + "."
                );
              } catch (e) { console.error("ADD_GUESTS_WA_ERR:", e); }
            }

            if (agBk.email) {
              try {
                await fetch(SUPABASE_URL + "/functions/v1/send-email", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
                  body: JSON.stringify({
                    type: "BOOKING_UPDATED",
                    data: {
                      business_id: agBk.business_id,
                      email: agBk.email,
                      customer_name: agBk.customer_name,
                      ref: agRef,
                      tour_name: agTourName,
                      start_time: agSlotTime || agBk.slots?.start_time || "",
                      message: agDelta + " guest" + (agDelta === 1 ? "" : "s") + " added. Your booking now has " + agNewQty + " guest" + (agNewQty === 1 ? "" : "s") + " total.",
                      event: "guests_added",
                    },
                  }),
                });
              } catch (e) { console.error("ADD_GUESTS_EMAIL_ERR:", e); }
            }
          } catch (e) { console.error("ADD_GUESTS_NOTIFY_ERR:", e); }

          console.log("ADD_GUESTS PAYMENT CONFIRMED booking:" + agBookingId + " new_qty:" + agNewQty);
        }
      }
      return new Response("OK", { status: 200 });
    }

    // Check if this is a gift voucher payment
    var gvr = await supabase.from("vouchers").select("*").eq("yoco_checkout_id", checkoutId).single();
    if (gvr.data && gvr.data.status === "PENDING") {
      var gv = gvr.data;
      await supabase.from("vouchers").update({ status: "ACTIVE", current_balance: gv.value || gv.purchase_amount || 0 }).eq("id", gv.id);
      // Send voucher email
      try {
        await fetch(SUPABASE_URL + "/functions/v1/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
          body: JSON.stringify({
            type: "GIFT_VOUCHER", data: {
              business_id: gv.business_id,
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
      try {
        await sendBookingConfirmation(booking, booking.yoco_payment_id || yocoPaymentId, checkoutId, payload.amount);
      } catch (confirmErr) {
        console.error("CONFIRM_RESEND_ERR booking=" + booking.id + ":", confirmErr);
      }
      return new Response("OK", { status: 200 });
    }

    // ── LATE WEBHOOK OVERBOOKING CHECK ──
    // If the hold has expired/been released, check if capacity is still available
    var activeHold = await supabase.from("holds").select("id, status").eq("booking_id", booking.id).eq("status", "ACTIVE").maybeSingle();
    if (!activeHold.data) {
      // Hold is gone (expired or cancelled) — check slot capacity before proceeding
      var capacityCheck = await supabase.rpc("slot_has_capacity", { p_slot_id: booking.slot_id, p_qty: booking.qty });
      if (capacityCheck.data === false) {
        // Slot is full — auto-cancel and refund
        console.log("LATE_WEBHOOK_OVERBOOK: slot full, auto-cancelling booking:" + booking.id);

        await supabase.from("bookings").update({
          status: "CANCELLED",
          payment_status: "REFUND_PENDING",
          yoco_payment_id: yocoPaymentId,
          cancellation_reason: "Auto-cancelled: slot full after hold expired",
          cancelled_at: new Date().toISOString(),
        }).eq("id", booking.id);

        // Trigger automatic refund via process-refund
        try {
          await fetch(SUPABASE_URL + "/functions/v1/process-refund", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
            body: JSON.stringify({ booking_id: booking.id }),
          });
        } catch (refundErr) {
          console.error("LATE_WEBHOOK_REFUND_ERR:", refundErr);
        }

        // Send apology notifications
        try {
          var lateNotifyTenant = await getTenantByBusinessId(supabase, booking.business_id);
          var lateBrandName = getBusinessDisplayName(lateNotifyTenant.business);
          var lateRef = booking.id.substring(0, 8).toUpperCase();
          var lateTourName = booking.tours?.name || "Booking";
          var lateCurrency = lateNotifyTenant.business.currency || "ZAR";

          if (booking.phone) {
            try {
              await sendWhatsappTextForTenant(lateNotifyTenant, booking.phone,
                "Booking update\n\n" +
                "Hi " + ((booking.customer_name && booking.customer_name.split(" ")[0]) || "there") +
                ", unfortunately the slot for " + lateTourName + " (Ref: " + lateRef + ") is now fully booked.\n\n" +
                "Your payment of " + lateCurrency + " " + booking.total_amount + " will be refunded automatically. " +
                "Please allow 5 to 10 business days.\n\n" +
                "We apologise for the inconvenience. Please contact us to rebook on another date.\n\n" +
                "Thanks, " + lateBrandName + "."
              );
            } catch (e) { console.error("LATE_WEBHOOK_WA_ERR:", e); }
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
                    ref: lateRef,
                    tour_name: lateTourName,
                    start_time: booking.slots?.start_time || "",
                    reason: "The slot became fully booked while your payment was processing. A full refund has been issued automatically.",
                    refund_amount: String(booking.total_amount),
                    total_amount: String(booking.total_amount),
                    is_partial: false,
                  },
                }),
              });
            } catch (e) { console.error("LATE_WEBHOOK_EMAIL_ERR:", e); }
          }
        } catch (notifyErr) {
          console.error("LATE_WEBHOOK_NOTIFY_ERR:", notifyErr);
        }

        // Log as alert for admin visibility
        await supabase.from("logs").insert({
          business_id: booking.business_id,
          booking_id: booking.id,
          event: "late_webhook_overbooking_prevented",
          payload: {
            yoco_payment_id: yocoPaymentId,
            checkout_id: checkoutId,
            slot_id: booking.slot_id,
            qty: booking.qty,
            reason: "Hold expired and slot is now full. Auto-refund triggered.",
          },
        });

        return new Response("OK", { status: 200 });
      }
      // Capacity IS available — proceed normally (the hold-to-booked conversion below
      // will handle the slot update even without an active hold)
      console.log("LATE_WEBHOOK_OK: hold expired but capacity still available for booking:" + booking.id);
    }

    // ── MID-CHECKOUT SLOT CLOSURE CHECK ──
    // Before marking as PAID, verify the slot hasn't been closed/cancelled during checkout
    var slotStatusCheck = await supabase.from("slots").select("status").eq("id", booking.slot_id).single();
    if (slotStatusCheck.data && (slotStatusCheck.data.status === "CLOSED" || slotStatusCheck.data.status === "CANCELLED")) {
      console.log("SLOT_CLOSED_DURING_CHECKOUT: slot " + booking.slot_id + " status=" + slotStatusCheck.data.status + " booking=" + booking.id);

      // Do NOT mark as PAID — cancel the booking
      await supabase.from("bookings").update({
        status: "CANCELLED",
        payment_status: "REFUND_PENDING",
        yoco_payment_id: yocoPaymentId,
        cancellation_reason: "Slot closed during checkout",
        cancelled_at: new Date().toISOString(),
      }).eq("id", booking.id);

      // Trigger refund to reverse the Yoco charge
      try {
        await fetch(SUPABASE_URL + "/functions/v1/process-refund", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
          body: JSON.stringify({ booking_id: booking.id }),
        });
      } catch (refundErr) {
        console.error("SLOT_CLOSED_REFUND_ERR:", refundErr);
      }

      // Release any active hold
      await supabase.from("holds").update({ status: "CANCELLED" }).eq("booking_id", booking.id).eq("status", "ACTIVE");

      // Send customer apology email with reschedule option
      try {
        var closedTenant = await getTenantByBusinessId(supabase, booking.business_id);
        var closedRef = booking.id.substring(0, 8).toUpperCase();
        var closedTourName = booking.tours?.name || "Booking";
        var closedBrandName = getBusinessDisplayName(closedTenant.business);
        var closedCurrency = closedTenant.business.currency || "ZAR";

        if (booking.phone) {
          try {
            await sendWhatsappTextForTenant(closedTenant, booking.phone,
              "Booking update\n\n" +
              "Hi " + ((booking.customer_name && booking.customer_name.split(" ")[0]) || "there") +
              ", we're sorry but the slot for " + closedTourName + " (Ref: " + closedRef + ") has been closed.\n\n" +
              "Your payment of " + closedCurrency + " " + booking.total_amount + " will be refunded automatically. " +
              "Please allow 5 to 10 business days.\n\n" +
              "You can reschedule to another available date via My Bookings.\n\n" +
              "Apologies for the inconvenience.\n" + closedBrandName + "."
            );
          } catch (e) { console.error("SLOT_CLOSED_WA_ERR:", e); }
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
                  ref: closedRef,
                  tour_name: closedTourName,
                  start_time: booking.slots?.start_time || "",
                  reason: "The slot was closed while your payment was being processed. A full refund has been issued automatically. You can reschedule to another date via My Bookings.",
                  refund_amount: String(booking.total_amount),
                  total_amount: String(booking.total_amount),
                  is_partial: false,
                },
              }),
            });
          } catch (e) { console.error("SLOT_CLOSED_EMAIL_ERR:", e); }
        }
      } catch (notifyErr) {
        console.error("SLOT_CLOSED_NOTIFY_ERR:", notifyErr);
      }

      // Log as alert event
      await supabase.from("logs").insert({
        business_id: booking.business_id,
        booking_id: booking.id,
        event: "slot_closed_during_checkout",
        payload: {
          yoco_payment_id: yocoPaymentId,
          checkout_id: checkoutId,
          slot_id: booking.slot_id,
          slot_status: slotStatusCheck.data.status,
          qty: booking.qty,
          reason: "Slot closed/cancelled during checkout. Auto-refund triggered.",
        },
      });

      return new Response("OK", { status: 200 });
    }

    // Verify payment amount matches expected booking total
    var webhookAmountZar = Number(payload.metadata?.amount_zar || Math.round((Number(payload.amount) || 0) / 100));
    if (webhookAmountZar > 0 && Math.abs(webhookAmountZar - Number(booking.total_amount || 0)) > 1) {
      console.warn("YOCO_AMOUNT_MISMATCH: booking=" + booking.id + " expected=" + booking.total_amount + " received=" + webhookAmountZar);
    }

    // Atomically update to PAID — if already updated by a concurrent webhook, skip
    var upd = await supabase.from("bookings").update({ status: "PAID", yoco_payment_id: yocoPaymentId, total_captured: booking.total_amount, payment_status: "CAPTURED" }).eq("id", booking.id).is("yoco_payment_id", null).select("id").maybeSingle();
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
      try {
        await sendBookingConfirmation(booking, booking.yoco_payment_id || yocoPaymentId, checkoutId, payload.amount);
      } catch (confirmErr) {
        console.error("CONFIRM_CONCURRENT_ERR booking=" + booking.id + ":", confirmErr);
      }
      return new Response("OK", { status: 200 });
    }
    var holdConvert = await supabase.from("holds").update({ status: "CONVERTED" }).eq("booking_id", booking.id).eq("status", "ACTIVE").select("id").maybeSingle();
    var sr = await supabase.from("slots").select("booked, held").eq("id", booking.slot_id).single();
    if (sr.data) {
      // If hold was still active, convert held -> booked. If hold expired, just increment booked.
      var heldDecrement = holdConvert.data ? booking.qty : 0;
      await supabase.from("slots").update({
        booked: sr.data.booked + booking.qty,
        held: Math.max(0, sr.data.held - heldDecrement),
      }).eq("id", booking.slot_id);
    }

    // Deduct voucher balances for vouchers applied to this booking (sequential, atomic RPC)
    var metaVoucherIds = String(payload.metadata?.voucher_ids || "");
    var metaVoucherCodes = String(payload.metadata?.voucher_codes || "");
    if (metaVoucherIds || metaVoucherCodes) {
      var voucherIdList = metaVoucherIds ? metaVoucherIds.split(",").filter(Boolean) : [];
      var voucherCodeList = metaVoucherCodes ? metaVoucherCodes.split(",").filter(Boolean) : [];
      var voucherDiscount = Number(booking.original_total || 0) - Number(booking.total_amount || 0);
      if (voucherDiscount > 0) {
        var vouchersToDeduct: any[] = [];
        if (voucherIdList.length > 0) {
          var vr = await supabase.from("vouchers").select("id, code, current_balance, value, purchase_amount").in("id", voucherIdList);
          vouchersToDeduct = vr.data || [];
        } else if (voucherCodeList.length > 0) {
          var vr2 = await supabase.from("vouchers").select("id, code, current_balance, value, purchase_amount").in("code", voucherCodeList);
          vouchersToDeduct = vr2.data || [];
        }
        var remainingDiscount = voucherDiscount;
        for (var vi = 0; vi < vouchersToDeduct.length; vi++) {
          if (remainingDiscount <= 0) break;
          var voucher = vouchersToDeduct[vi];
          // Atomic deduction via RPC — sequential drain (Voucher A to R0 first, then Voucher B)
          var rpcRes = await supabase.rpc("deduct_voucher_balance", { p_voucher_id: voucher.id, p_amount: remainingDiscount });
          if (rpcRes.data?.success) {
            var deduction = Number(rpcRes.data.deducted);
            var newBal = Number(rpcRes.data.remaining);
            remainingDiscount -= deduction;
            await supabase.from("vouchers").update({ redeemed_booking_id: booking.id }).eq("id", voucher.id);
            // Send remaining balance email if voucher still has credit
            if (newBal > 0 && booking.email) {
              try {
                await fetch(SUPABASE_URL + "/functions/v1/send-email", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_KEY },
                  body: JSON.stringify({
                    type: "VOUCHER_BALANCE",
                    data: {
                      email: booking.email,
                      customer_name: booking.customer_name,
                      voucher_code: voucher.code,
                      original_value: Number(voucher.current_balance ?? voucher.value ?? voucher.purchase_amount ?? 0),
                      amount_used: deduction,
                      remaining_balance: newBal,
                      booking_ref: booking.id.substring(0, 8).toUpperCase(),
                      tour_name: booking.tours?.name || "Booking",
                      business_id: booking.business_id,
                    },
                  }),
                });
              } catch (vbErr) { console.error("VOUCHER_BALANCE_EMAIL_ERR:", vbErr); }
            }
          }
        }
        console.log("VOUCHER_DEDUCTION booking=" + booking.id + " discount=" + voucherDiscount + " vouchers=" + vouchersToDeduct.length);
      }
    }

    // Apply promo code usage if one was used during checkout
    var metaPromoId = payload?.metadata?.promo_id;
    var metaPromoEmail = payload?.metadata?.customer_email || booking.customer_email || "";
    if (metaPromoId) {
      try {
        await supabase.rpc("apply_promo_code", { p_promo_id: metaPromoId, p_customer_email: metaPromoEmail, p_booking_id: booking.id, p_customer_phone: booking.phone || null });
        console.log("PROMO_USAGE_RECORDED: promo=" + metaPromoId + " booking=" + booking.id);
      } catch (promoErr) { console.error("PROMO_APPLY_ERR:", promoErr); }
    }

    await supabase.from("logs").insert({ business_id: booking.business_id, booking_id: booking.id, event: "payment_confirmed", payload: { yoco_payment_id: yocoPaymentId, checkout_id: checkoutId, amount: payload.amount, promo_code: payload?.metadata?.promo_code || null } });
    await supabase.from("conversations").update({ current_state: "IDLE", state_data: {}, updated_at: new Date().toISOString() }).eq("phone", booking.phone).eq("business_id", booking.business_id);

    // Send confirmation email + WhatsApp — wrapped in try-catch so a notification failure
    // does NOT prevent the webhook from returning 200 (booking is already marked PAID above)
    try {
      await sendBookingConfirmation({ ...booking, status: "PAID", yoco_payment_id: yocoPaymentId }, yocoPaymentId, checkoutId, payload.amount);
    } catch (confirmErr) {
      console.error("CONFIRM_SEND_ERR booking=" + booking.id + ":", confirmErr);
      // Log the failure so it can be retried manually from admin
      await supabase.from("logs").insert({
        business_id: booking.business_id,
        booking_id: booking.id,
        event: "booking_confirmation_failed",
        payload: { error: confirmErr instanceof Error ? confirmErr.message : String(confirmErr), yoco_payment_id: yocoPaymentId },
      }).catch(() => {});
    }

    console.log("PAYMENT CONFIRMED booking:" + booking.id);
    return new Response("OK", { status: 200 });
  } catch (err) { console.error("YOCO_WEBHOOK_ERROR:", err); return new Response("OK", { status: 200 }); }
});
