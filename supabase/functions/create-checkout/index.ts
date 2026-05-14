// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createServiceClient,
  getBusinessAllowedOrigins,
  getTenantByBusinessId,
  isAllowedOrigin,
  resolveBusinessSiteUrls,
} from "../_shared/tenant.ts";

const BOOKING_SUCCESS_URL = Deno.env.get("BOOKING_SUCCESS_URL") || "";
const BOOKING_CANCEL_URL = Deno.env.get("BOOKING_CANCEL_URL") || "";
const VOUCHER_SUCCESS_URL = Deno.env.get("VOUCHER_SUCCESS_URL") || "";
const supabase = createServiceClient();
function buildCors(origin?: string | null) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-business-id, x-tenant-subdomain, x-tenant-origin, x-voucher-code, x-booking-success-token, x-booking-id, x-booking-waiver-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

function withQuery(base: string, params: Record<string, string>) {
  if (!base) return "";
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

function ensureCheckoutUrls(urls: { bookingSuccessUrl?: string; bookingCancelUrl?: string; voucherSuccessUrl?: string }, type: string) {
  if (type === "GIFT_VOUCHER") {
    return Boolean(urls.voucherSuccessUrl && urls.bookingCancelUrl);
  }
  return Boolean(urls.bookingSuccessUrl && urls.bookingCancelUrl);
}

async function resolveCheckoutBusiness(params: { bookingId?: string; voucherId?: string; businessId?: string }) {
  let businessId = params.businessId || "";
  let bookingStatus = "";

  if (!businessId && params.bookingId) {
    const bookingRow = await supabase.from("bookings").select("business_id, status").eq("id", params.bookingId).maybeSingle();
    businessId = String(bookingRow.data?.business_id || "");
    bookingStatus = String(bookingRow.data?.status || "");
  }
  if (!businessId && params.voucherId) {
    const voucherRow = await supabase.from("vouchers").select("business_id").eq("id", params.voucherId).maybeSingle();
    businessId = String(voucherRow.data?.business_id || "");
  }
  if (!businessId) {
    throw new Error("Unable to resolve business for checkout");
  }

  const tenant = await getTenantByBusinessId(supabase, businessId);
  return {
    businessId,
    bookingStatus,
    tenant,
    businessUrls: resolveBusinessSiteUrls(tenant.business, {
      bookingSuccessUrl: BOOKING_SUCCESS_URL,
      bookingCancelUrl: BOOKING_CANCEL_URL,
      voucherSuccessUrl: VOUCHER_SUCCESS_URL,
    }),
  };
}

Deno.serve(async (req: any) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: buildCors(req?.headers?.get("origin") || "*") });
  }

  let _reqBody: any = {};
  try {
    const body = await req.json();
    _reqBody = { booking_id: body.booking_id, voucher_id: body.voucher_id, type: body.type || "BOOKING", amount: body.amount };
    let amount = body.amount;
    const bookingId = body.booking_id;
    const voucherId = body.voucher_id;
    const voucherCode = body.voucher_code;
    const promoCode = body.promo_code || "";
    const customerEmail = body.customer_email || "";
    const type = body.type || "BOOKING";
    const topupBusinessId = body.business_id;
    const skipNotifications = body.skip_notifications === true;

    if (!amount) return new Response(JSON.stringify({ error: "Need amount" }), { status: 400, headers: buildCors(req?.headers?.get("origin") || "*") });

    // FIX 4: Server-side price verification for BOOKING checkouts
    // Never trust frontend pricing — calculate from DB for standard bookings
    let promoDiscount = 0;
    let promoId: string | null = null;
    let appliedPromoCode = "";

    if (type === "BOOKING" && bookingId) {
      const bookingRow = await supabase
        .from("bookings")
        .select("id, business_id, tour_id, slot_id, qty, total_amount, voucher_amount_paid, discount_type, discount_percent, discount_amount, customer_email, phone")
        .eq("id", bookingId)
        .maybeSingle();
      if (bookingRow.data) {
        const bk = bookingRow.data;
        const resolvedEmail = customerEmail || bk.customer_email || "";

        // Look up current base price from tour
        const tourRow = await supabase.from("tours").select("base_price_per_person").eq("id", bk.tour_id).maybeSingle();
        let basePrice = Number(tourRow.data?.base_price_per_person || 0);
        // Check for slot-level price override (peak pricing)
        if (bk.slot_id) {
          const slotRow = await supabase.from("slots").select("price_per_person_override").eq("id", bk.slot_id).maybeSingle();
          if (slotRow.data?.price_per_person_override != null) {
            basePrice = Number(slotRow.data.price_per_person_override);
          }
        }
        let serverTotal = basePrice * Number(bk.qty || 1);

        // Apply promo code if provided (before other discounts)
        if (promoCode) {
          const promoResult = await supabase.rpc("validate_promo_code", {
            p_business_id: bk.business_id,
            p_code: promoCode,
            p_order_amount: serverTotal,
            p_customer_email: resolvedEmail,
          });
          if (promoResult.data?.valid) {
            const promo = promoResult.data;
            promoId = promo.promo_id;
            appliedPromoCode = promo.code;
            if (promo.discount_type === "PERCENT") {
              promoDiscount = serverTotal * (Number(promo.discount_value) / 100);
            } else {
              promoDiscount = Number(promo.discount_value);
            }
            promoDiscount = Math.min(promoDiscount, serverTotal);
            serverTotal = serverTotal - promoDiscount;
            // Store promo on booking
            await supabase.from("bookings").update({
              promo_code: appliedPromoCode,
              discount_amount: promoDiscount,
            }).eq("id", bookingId);
            console.log("PROMO_APPLIED: code=" + appliedPromoCode + " discount=" + promoDiscount + " booking=" + bookingId);
          } else {
            // Invalid promo — return error to frontend
            return new Response(JSON.stringify({
              error: "PROMO_INVALID",
              reason: promoResult.data?.error || "Invalid promo code",
            }), { status: 400, headers: buildCors(req?.headers?.get("origin") || "*") });
          }
        }

        // Apply admin discount if present (on top of promo)
        if (bk.discount_type === "PERCENT" && bk.discount_percent) {
          serverTotal = serverTotal * (1 - Number(bk.discount_percent) / 100);
        } else if (bk.discount_amount && !promoCode) {
          // Only apply stored discount_amount if not from a promo (promo already applied above)
          serverTotal = serverTotal - Number(bk.discount_amount);
        }
        serverTotal = Math.max(0, serverTotal);
        // Subtract any voucher portion already applied
        const voucherApplied = Number(bk.voucher_amount_paid || 0);
        let serverCashDue = Math.max(0, serverTotal - voucherApplied);
        // Round to 2 decimals
        serverCashDue = Math.round(serverCashDue * 100) / 100;

        if (Math.abs(Number(amount) - serverCashDue) > 0.01) {
          console.warn("CHECKOUT_PRICE_MISMATCH: frontend=" + amount + " server=" + serverCashDue + " booking=" + bookingId);
          // Use server-calculated amount (never trust frontend)
          amount = serverCashDue;
          // Also update the booking record to reflect corrected total
          await supabase.from("bookings").update({ total_amount: serverTotal + promoDiscount }).eq("id", bookingId);
        }

        // If promo covers the entire amount, skip payment
        if (serverCashDue <= 0 && promoId) {
          // Apply promo usage
          await supabase.rpc("apply_promo_code", { p_promo_id: promoId, p_customer_email: resolvedEmail, p_booking_id: bookingId, p_customer_phone: bk.phone || null });
          return new Response(JSON.stringify({ fully_covered: true, promo_applied: appliedPromoCode, discount: promoDiscount }), { headers: buildCors(req?.headers?.get("origin") || "*") });
        }
      }
    }

    const resolved = await resolveCheckoutBusiness({ bookingId, voucherId, businessId: topupBusinessId });
    const tenant = resolved.tenant;
    const businessUrls = resolved.businessUrls;
    const origin = req?.headers?.get("origin") || "";
    const allowedOrigins = getBusinessAllowedOrigins(tenant.business);
    if (origin && !isAllowedOrigin(origin, allowedOrigins)) {
      return new Response(
        JSON.stringify({ error: "ORIGIN_NOT_ALLOWED", reason: "This origin is not allowed for the selected business checkout." }),
        { status: 403, headers: buildCors(allowedOrigins[0] || "*") },
      );
    }
    const corsHeaders = buildCors(origin || allowedOrigins[0] || "*");
    const metadata: any = { type: type };
    let successUrl = businessUrls.bookingSuccessUrl;
    const cancelUrl = businessUrls.bookingCancelUrl;

    if (type === "TOPUP") {
      return new Response(
        JSON.stringify({ error: "TOPUPS_DISCONTINUED", reason: "Booking top-ups have been removed. Plans are billed monthly by admin seats." }),
        { status: 410, headers: corsHeaders },
      );
    }

    if (!ensureCheckoutUrls(businessUrls, type)) {
      return new Response(
        JSON.stringify({ error: "BUSINESS_BOOKING_URLS_MISSING", reason: "This business is missing configured booking success/cancel URLs. Set BOOKING_SUCCESS_URL and BOOKING_CANCEL_URL in Supabase Edge Function secrets." }),
        { status: 503, headers: corsHeaders },
      );
    }

    if (type === "GIFT_VOUCHER") {
      metadata.voucher_id = voucherId;
      metadata.voucher_code = voucherCode;
      successUrl = withQuery(businessUrls.voucherSuccessUrl, { code: voucherCode || "" });
    } else if (type === "RESCHEDULE") {
      metadata.booking_id = bookingId;
      metadata.pending_reschedule_id = body.pending_reschedule_id || "";
      successUrl = withQuery(businessUrls.bookingSuccessUrl, { ref: bookingId || "" });
    } else if (type === "ADD_GUESTS") {
      metadata.booking_id = bookingId;
      metadata.hold_id = body.hold_id || "";
      metadata.new_qty = String(body.new_qty || 0);
      successUrl = withQuery(businessUrls.bookingSuccessUrl, { ref: bookingId || "" });
    } else {
      metadata.booking_id = bookingId;
      metadata.customer_name = body.customer_name || "";
      metadata.qty = String(body.qty || 1);
      if (body.voucher_codes) metadata.voucher_codes = body.voucher_codes.join(",");
      if (body.voucher_ids) metadata.voucher_ids = body.voucher_ids.join(",");
      if (promoId) { metadata.promo_id = promoId; metadata.promo_code = appliedPromoCode; metadata.customer_email = customerEmail; }
      successUrl = withQuery(businessUrls.bookingSuccessUrl, { ref: bookingId || "" });
    }

    console.log("CREATING CHECKOUT: amount=" + amount + " type=" + type);

    if (!tenant.credentials.activeYocoSecretKey) {
      return new Response(
        JSON.stringify({ error: "BUSINESS_PAYMENT_CONFIG_MISSING", reason: "No Yoco secret key configured for this business." }),
        { status: 503, headers: corsHeaders },
      );
    }

    const isTestMode = tenant.credentials.yocoTestMode === true;
    console.log("CREATING CHECKOUT: test_mode=" + isTestMode);

    const yocoRes = await fetch("https://payments.yoco.com/api/checkouts", {
      method: "POST",
      headers: { Authorization: "Bearer " + tenant.credentials.activeYocoSecretKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Math.round(Number(amount) * 100),
        currency: tenant.business.currency || "ZAR",
        successUrl: successUrl,
        cancelUrl: cancelUrl,
        failureUrl: cancelUrl,
        metadata: metadata,
      }),
    });

    const yocoData = await yocoRes.json();
    console.log("CHECKOUT:" + JSON.stringify(yocoData));

    if (!yocoRes.ok) {
      return new Response(
        JSON.stringify({
          error: "YOCO_CHECKOUT_FAILED",
          reason: yocoData?.message || yocoData?.error?.message || "Unable to create checkout",
          details: yocoData,
        }),
        { status: 502, headers: corsHeaders },
      );
    }

    if (yocoData && yocoData.id && yocoData.redirectUrl) {
      if (bookingId) {
        await supabase.from("bookings").update({ yoco_checkout_id: yocoData.id }).eq("id", bookingId);
      }
      if (voucherId) {
        await supabase.from("vouchers").update({ yoco_checkout_id: yocoData.id }).eq("id", voucherId);
      }

      // Send payment link email for gift voucher checkouts. The voucher code is only delivered by the webhook after payment succeeds.
      if (type === "GIFT_VOUCHER" && voucherId && !skipNotifications) {
        try {
          const SUPABASE_URL_ENV = Deno.env.get("SUPABASE_URL") || "";
          const SERVICE_ROLE_KEY_ENV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
          const voucherNotif = await supabase
            .from("vouchers")
            .select("id, business_id, buyer_name, buyer_email, recipient_name, tour_name, value, purchase_amount")
            .eq("id", voucherId)
            .maybeSingle();
          const gv = voucherNotif.data;
          const voucherEmail = String(gv?.buyer_email || customerEmail || "").trim().toLowerCase();
          if (gv && SERVICE_ROLE_KEY_ENV && voucherEmail && voucherEmail.includes("@")) {
            const voucherAmount = Number(gv.value || gv.purchase_amount || amount || 0);
            await fetch(SUPABASE_URL_ENV + "/functions/v1/send-email", {
              method: "POST",
              headers: { Authorization: "Bearer " + SERVICE_ROLE_KEY_ENV, "Content-Type": "application/json" },
              body: JSON.stringify({
                type: "VOUCHER_PAYMENT_LINK",
                data: {
                  email: voucherEmail,
                  business_id: gv.business_id,
                  buyer_name: gv.buyer_name || "there",
                  recipient_name: gv.recipient_name || "your recipient",
                  tour_name: gv.tour_name || "Gift Voucher",
                  total_amount: voucherAmount.toFixed(2),
                  payment_url: yocoData.redirectUrl,
                },
              }),
            });
            console.log("CHECKOUT_EMAIL_VOUCHER_PAYMENT_LINK_SENT voucher=" + voucherId);
          }
        } catch (voucherEmailErr) {
          console.error("CHECKOUT_VOUCHER_EMAIL_PAYMENT_LINK_ERR:", voucherEmailErr);
        }
      }

      // Send payment link via WhatsApp + email for BOOKING checkouts (unless caller already handles notifications)
      if (type === "BOOKING" && bookingId && !skipNotifications) {
        try {
          const SUPABASE_URL_ENV = Deno.env.get("SUPABASE_URL") || "";
          const SERVICE_ROLE_KEY_ENV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
          // Fetch full booking details for notification
          const bkNotif = await supabase.from("bookings")
            .select("id, business_id, customer_name, email, phone, qty, total_amount, slots(start_time), tours(name)")
            .eq("id", bookingId)
            .maybeSingle();
          const bk = bkNotif.data;
          if (bk && SERVICE_ROLE_KEY_ENV) {
            const notifEmail = String(bk.email || customerEmail || "").trim().toLowerCase();
            let notifPhone = String(bk.phone || "").replace(/[^\d]/g, "");
            if (notifPhone && notifPhone.startsWith("0")) notifPhone = "27" + notifPhone.substring(1);
            const notifName = String(bk.customer_name || body.customer_name || "").trim();
            const notifFirst = notifName.split(" ")[0] || "there";
            const notifRef = String(bk.id || "").slice(0, 8).toUpperCase();
            const notifTour = (bk.tours as any)?.name || "Tour";
            const notifSlot = bk.slots as any;
            let notifTime = "";
            if (notifSlot?.start_time) {
              try {
                const tz = tenant.business?.timezone || "Africa/Johannesburg";
                notifTime = new Intl.DateTimeFormat("en-ZA", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(notifSlot.start_time));
              } catch { notifTime = String(notifSlot.start_time || ""); }
            }
            const notifAmount = Number(bk.total_amount || amount || 0);
            const notifQty = Number(bk.qty || body.qty || 1);

            // Send WhatsApp with payment link
            if (notifPhone) {
              try {
                await fetch(SUPABASE_URL_ENV + "/functions/v1/send-whatsapp-text", {
                  method: "POST",
                  headers: { Authorization: "Bearer " + SERVICE_ROLE_KEY_ENV, "Content-Type": "application/json" },
                  body: JSON.stringify({
                    to: notifPhone,
                    business_id: bk.business_id,
                    message:
                      "Hi " + notifFirst + "!\n\n" +
                      "Here\u2019s your payment link to confirm your booking:\n\n" +
                      "\uD83D\uDEF6 " + notifTour + "\n" +
                      "\uD83D\uDCC5 " + notifTime + "\n" +
                      "\uD83D\uDC65 " + notifQty + " people\n" +
                      "\uD83D\uDCB0 R" + notifAmount.toFixed(2) + "\n\n" +
                      "\uD83D\uDD17 Pay here: " + yocoData.redirectUrl + "\n\n" +
                      "\u23F0 Please complete payment to secure your spot.",
                  }),
                });
                console.log("CHECKOUT_WA_PAYMENT_LINK_SENT booking=" + bookingId);
              } catch (waErr) {
                console.error("CHECKOUT_WA_PAYMENT_LINK_ERR:", waErr);
              }
            }

            // Send email with payment link
            if (notifEmail && notifEmail.includes("@")) {
              try {
                await fetch(SUPABASE_URL_ENV + "/functions/v1/send-email", {
                  method: "POST",
                  headers: { Authorization: "Bearer " + SERVICE_ROLE_KEY_ENV, "Content-Type": "application/json" },
                  body: JSON.stringify({
                    type: "PAYMENT_LINK",
                    data: {
                      email: notifEmail,
                      booking_id: bookingId,
                      business_id: bk.business_id,
                      customer_name: notifName || notifFirst,
                      ref: notifRef,
                      tour_name: notifTour,
                      tour_date: notifTime,
                      qty: notifQty,
                      total_amount: notifAmount.toFixed(2),
                      payment_url: yocoData.redirectUrl,
                    },
                  }),
                });
                console.log("CHECKOUT_EMAIL_PAYMENT_LINK_SENT booking=" + bookingId);
              } catch (emailErr) {
                console.error("CHECKOUT_EMAIL_PAYMENT_LINK_ERR:", emailErr);
              }
            }
          }
        } catch (notifErr) {
          // Notifications are best-effort — don't fail the checkout
          console.error("CHECKOUT_NOTIFICATION_ERR:", notifErr);
        }
      }

      // Send payment link via WhatsApp + email for RESCHEDULE upgrades.
      // The customer needs to know (a) the booking was moved, (b) there's a
      // top-up payment due, (c) the new slot is held for 15 min.
      if (type === "RESCHEDULE" && bookingId && !skipNotifications) {
        try {
          const SUPABASE_URL_ENV = Deno.env.get("SUPABASE_URL") || "";
          const SERVICE_ROLE_KEY_ENV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
          const pendingId = String(body.pending_reschedule_id || "");
          const bkNotif = await supabase.from("bookings")
            .select("id, business_id, customer_name, email, phone")
            .eq("id", bookingId)
            .maybeSingle();
          const bk = bkNotif.data;
          if (bk && SERVICE_ROLE_KEY_ENV) {
            // Resolve new-slot context from pending_reschedules so the email
            // says "moving to 20 May 04:00 — pay R200 to confirm" instead of
            // just "pay R200".
            let newSlotStart = "";
            let newTourName = "Tour";
            let newQty = 1;
            if (pendingId) {
              const prRes = await supabase.from("pending_reschedules")
                .select("new_slot_id, new_total_amount, diff")
                .eq("id", pendingId)
                .maybeSingle();
              if (prRes.data?.new_slot_id) {
                const slotRes = await supabase.from("slots")
                  .select("start_time, tour_id")
                  .eq("id", prRes.data.new_slot_id)
                  .maybeSingle();
                if (slotRes.data?.start_time) {
                  try {
                    const tz = tenant.business?.timezone || "Africa/Johannesburg";
                    newSlotStart = new Intl.DateTimeFormat("en-ZA", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(slotRes.data.start_time));
                  } catch { newSlotStart = String(slotRes.data.start_time); }
                  if (slotRes.data.tour_id) {
                    const tourRes = await supabase.from("tours").select("name").eq("id", slotRes.data.tour_id).maybeSingle();
                    if (tourRes.data?.name) newTourName = tourRes.data.name;
                  }
                }
              }
            }
            const notifEmail = String(bk.email || customerEmail || "").trim().toLowerCase();
            let notifPhone = String(bk.phone || "").replace(/[^\d]/g, "");
            if (notifPhone && notifPhone.startsWith("0")) notifPhone = "27" + notifPhone.substring(1);
            const notifFirst = String(bk.customer_name || "").trim().split(" ")[0] || "there";
            const notifRef = String(bk.id || "").slice(0, 8).toUpperCase();
            const diffAmt = Number(amount || 0).toFixed(2);

            if (notifPhone) {
              try {
                await fetch(SUPABASE_URL_ENV + "/functions/v1/send-whatsapp-text", {
                  method: "POST",
                  headers: { Authorization: "Bearer " + SERVICE_ROLE_KEY_ENV, "Content-Type": "application/json" },
                  body: JSON.stringify({
                    to: notifPhone,
                    business_id: bk.business_id,
                    message:
                      "Hi " + notifFirst + "!\n\n" +
                      "Your booking has been moved to a new slot, but it costs a little more:\n\n" +
                      "\uD83D\uDEF6 " + newTourName + "\n" +
                      "\uD83D\uDCC5 " + (newSlotStart || "(new slot)") + "\n" +
                      "\uD83D\uDCB0 Top-up due: R" + diffAmt + "\n\n" +
                      "\uD83D\uDD17 Pay here: " + yocoData.redirectUrl + "\n\n" +
                      "\u23F0 The new slot is held for 15 minutes. If you don't pay in time, your original booking stays as it was.\n\n" +
                      "Ref: " + notifRef,
                  }),
                });
                console.log("CHECKOUT_WA_RESCHEDULE_LINK_SENT booking=" + bookingId);
              } catch (waErr) {
                console.error("CHECKOUT_WA_RESCHEDULE_LINK_ERR:", waErr);
              }
            }

            if (notifEmail && notifEmail.includes("@")) {
              try {
                await fetch(SUPABASE_URL_ENV + "/functions/v1/send-email", {
                  method: "POST",
                  headers: { Authorization: "Bearer " + SERVICE_ROLE_KEY_ENV, "Content-Type": "application/json" },
                  body: JSON.stringify({
                    type: "RESCHEDULE_PAYMENT_LINK",
                    data: {
                      email: notifEmail,
                      booking_id: bookingId,
                      business_id: bk.business_id,
                      customer_name: bk.customer_name || notifFirst,
                      ref: notifRef,
                      tour_name: newTourName,
                      tour_date: newSlotStart,
                      qty: newQty,
                      total_amount: diffAmt,
                      payment_url: yocoData.redirectUrl,
                    },
                  }),
                });
                console.log("CHECKOUT_EMAIL_RESCHEDULE_LINK_SENT booking=" + bookingId);
              } catch (emailErr) {
                console.error("CHECKOUT_EMAIL_RESCHEDULE_LINK_ERR:", emailErr);
              }
            }
          }
        } catch (notifErr) {
          console.error("CHECKOUT_RESCHEDULE_NOTIFICATION_ERR:", notifErr);
        }
      }

      return new Response(JSON.stringify({ id: yocoData.id, redirectUrl: yocoData.redirectUrl }), { status: 200, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: "Yoco error", details: yocoData }), { status: 500, headers: corsHeaders });
  } catch (err: any) {
    console.error("CHECKOUT_ERR:", err?.message || err, JSON.stringify(_reqBody));
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: buildCors(req?.headers?.get("origin") || "*") });
  }
});
