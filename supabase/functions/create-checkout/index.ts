import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createServiceClient,
  getBusinessAllowedOrigins,
  getTenantByBusinessId,
  isAllowedOrigin,
  resolveBusinessSiteUrls,
} from "../_shared/tenant.ts";

var BOOKING_SUCCESS_URL = Deno.env.get("BOOKING_SUCCESS_URL") || "";
var BOOKING_CANCEL_URL = Deno.env.get("BOOKING_CANCEL_URL") || "";
var VOUCHER_SUCCESS_URL = Deno.env.get("VOUCHER_SUCCESS_URL") || "";
var supabase = createServiceClient();
function buildCors(origin?: string | null) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

function withQuery(base: string, params: Record<string, string>) {
  if (!base) return "";
  var url = new URL(base);
  for (var [key, value] of Object.entries(params)) {
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
  var businessId = params.businessId || "";
  var bookingStatus = "";

  if (!businessId && params.bookingId) {
    var bookingRow = await supabase.from("bookings").select("business_id, status").eq("id", params.bookingId).maybeSingle();
    businessId = String(bookingRow.data?.business_id || "");
    bookingStatus = String(bookingRow.data?.status || "");
  }
  if (!businessId && params.voucherId) {
    var voucherRow = await supabase.from("vouchers").select("business_id").eq("id", params.voucherId).maybeSingle();
    businessId = String(voucherRow.data?.business_id || "");
  }
  if (!businessId) {
    throw new Error("Unable to resolve business for checkout");
  }

  var tenant = await getTenantByBusinessId(supabase, businessId);
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

  try {
    var body = await req.json();
    var amount = body.amount;
    var bookingId = body.booking_id;
    var voucherId = body.voucher_id;
    var voucherCode = body.voucher_code;
    var promoCode = body.promo_code || "";
    var customerEmail = body.customer_email || "";
    var type = body.type || "BOOKING";
    var topupBusinessId = body.business_id;
    var skipNotifications = body.skip_notifications === true;

    if (!amount) return new Response(JSON.stringify({ error: "Need amount" }), { status: 400, headers: buildCors(req?.headers?.get("origin") || "*") });

    // FIX 4: Server-side price verification for BOOKING checkouts
    // Never trust frontend pricing — calculate from DB for standard bookings
    var promoDiscount = 0;
    var promoId: string | null = null;
    var appliedPromoCode = "";

    if (type === "BOOKING" && bookingId) {
      var bookingRow = await supabase
        .from("bookings")
        .select("id, business_id, tour_id, slot_id, qty, total_amount, voucher_amount_paid, discount_type, discount_percent, discount_amount, customer_email")
        .eq("id", bookingId)
        .maybeSingle();
      if (bookingRow.data) {
        var bk = bookingRow.data;
        var resolvedEmail = customerEmail || bk.customer_email || "";

        // Look up current base price from tour
        var tourRow = await supabase.from("tours").select("base_price_per_person").eq("id", bk.tour_id).maybeSingle();
        var basePrice = Number(tourRow.data?.base_price_per_person || 0);
        // Check for slot-level price override (peak pricing)
        if (bk.slot_id) {
          var slotRow = await supabase.from("slots").select("price_per_person_override").eq("id", bk.slot_id).maybeSingle();
          if (slotRow.data?.price_per_person_override != null) {
            basePrice = Number(slotRow.data.price_per_person_override);
          }
        }
        var serverTotal = basePrice * Number(bk.qty || 1);

        // Apply promo code if provided (before other discounts)
        if (promoCode) {
          var promoResult = await supabase.rpc("validate_promo_code", {
            p_business_id: bk.business_id,
            p_code: promoCode,
            p_order_amount: serverTotal,
            p_customer_email: resolvedEmail,
          });
          if (promoResult.data?.valid) {
            var promo = promoResult.data;
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
        var voucherApplied = Number(bk.voucher_amount_paid || 0);
        var serverCashDue = Math.max(0, serverTotal - voucherApplied);
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
          await supabase.rpc("apply_promo_code", { p_promo_id: promoId, p_customer_email: resolvedEmail, p_booking_id: bookingId });
          return new Response(JSON.stringify({ fully_covered: true, promo_applied: appliedPromoCode, discount: promoDiscount }), { headers: buildCors(req?.headers?.get("origin") || "*") });
        }
      }
    }

    var resolved = await resolveCheckoutBusiness({ bookingId, voucherId, businessId: topupBusinessId });
    var tenant = resolved.tenant;
    var businessUrls = resolved.businessUrls;
    var origin = req?.headers?.get("origin") || "";
    var allowedOrigins = getBusinessAllowedOrigins(tenant.business);
    if (origin && !isAllowedOrigin(origin, allowedOrigins)) {
      return new Response(
        JSON.stringify({ error: "ORIGIN_NOT_ALLOWED", reason: "This origin is not allowed for the selected business checkout." }),
        { status: 403, headers: buildCors(allowedOrigins[0] || "*") },
      );
    }
    var corsHeaders = buildCors(origin || allowedOrigins[0] || "*");
    var metadata: any = { type: type };
    var successUrl = businessUrls.bookingSuccessUrl;
    var cancelUrl = businessUrls.bookingCancelUrl;

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

    if (!tenant.credentials.yocoSecretKey) {
      return new Response(
        JSON.stringify({ error: "BUSINESS_PAYMENT_CONFIG_MISSING", reason: "No Yoco secret key configured for this business." }),
        { status: 503, headers: corsHeaders },
      );
    }

    var yocoRes = await fetch("https://payments.yoco.com/api/checkouts", {
      method: "POST",
      headers: { Authorization: "Bearer " + tenant.credentials.yocoSecretKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Math.round(Number(amount) * 100),
        currency: tenant.business.currency || "ZAR",
        successUrl: successUrl,
        cancelUrl: cancelUrl,
        failureUrl: cancelUrl,
        metadata: metadata,
      }),
    });

    var yocoData = await yocoRes.json();
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

      // Send payment link via WhatsApp + email for BOOKING checkouts (unless caller already handles notifications)
      if (type === "BOOKING" && bookingId && !skipNotifications) {
        try {
          var SUPABASE_URL_ENV = Deno.env.get("SUPABASE_URL") || "";
          var SERVICE_ROLE_KEY_ENV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
          // Fetch full booking details for notification
          var bkNotif = await supabase.from("bookings")
            .select("id, business_id, customer_name, email, phone, qty, total_amount, slots(start_time), tours(name)")
            .eq("id", bookingId)
            .maybeSingle();
          var bk = bkNotif.data;
          if (bk && SERVICE_ROLE_KEY_ENV) {
            var notifEmail = String(bk.email || customerEmail || "").trim().toLowerCase();
            var notifPhone = String(bk.phone || "").replace(/[^\d]/g, "");
            if (notifPhone && notifPhone.startsWith("0")) notifPhone = "27" + notifPhone.substring(1);
            var notifName = String(bk.customer_name || body.customer_name || "").trim();
            var notifFirst = notifName.split(" ")[0] || "there";
            var notifRef = String(bk.id || "").slice(0, 8).toUpperCase();
            var notifTour = (bk.tours as any)?.name || "Tour";
            var notifSlot = bk.slots as any;
            var notifTime = "";
            if (notifSlot?.start_time) {
              try {
                var tz = tenant.business?.timezone || "Africa/Johannesburg";
                notifTime = new Intl.DateTimeFormat("en-ZA", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(notifSlot.start_time));
              } catch { notifTime = String(notifSlot.start_time || ""); }
            }
            var notifAmount = Number(bk.total_amount || amount || 0);
            var notifQty = Number(bk.qty || body.qty || 1);

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

      return new Response(JSON.stringify({ id: yocoData.id, redirectUrl: yocoData.redirectUrl }), { status: 200, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: "Yoco error", details: yocoData }), { status: 500, headers: corsHeaders });
  } catch (err: any) {
    console.error("CHECKOUT_ERR:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: buildCors(req?.headers?.get("origin") || "*") });
  }
});
