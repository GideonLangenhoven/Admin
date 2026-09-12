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
import { blockIfNotTrading } from "../_shared/subscription.ts";
import { requireAuth, canAccessBusiness } from "../_shared/auth.ts";
import { bookingSuccessUrl } from "../_shared/booking-success.ts";

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

async function resolveCheckoutBusiness(params: { bookingId?: string; voucherId?: string }) {
  // SECURITY: business_id is ALWAYS derived from the booking/voucher row's
  // own column, never from client input. A client-supplied business_id used
  // to take priority here, letting a request carry a real booking_id for
  // Tenant A alongside a business_id for Tenant B — the checkout session
  // (and Yoco secret key) would be created under Tenant B while Tenant A's
  // booking still got marked PAID by Tenant A's own webhook. TOPUP was the
  // only checkout type that ever needed a bare business_id, and it's been
  // discontinued (see the TOPUPS_DISCONTINUED branch below) — every
  // remaining type has a real bookingId or voucherId to resolve from.
  let businessId = "";
  let bookingStatus = "";

  if (params.bookingId) {
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
    const customerEmail = body.customer_email || "";
    const type = body.type || "BOOKING";
    const skipNotifications = body.skip_notifications === true;
    // Payment-link email/WhatsApp for NEW bookings is OPT-IN: only the admin
    // "book them in / resend link" flows pass this. Customer-initiated bookings
    // (chatbot, booking site, WhatsApp bot, OTA) pay inline and must NOT be
    // emailed/WhatsApp'd the link up front — the hold-expiry cron chases them
    // only if they abandon or payment lags past the 15-min hold.
    const sendPaymentLink = body.send_payment_link === true;

    if (amount == null || !Number.isFinite(Number(amount)) || Number(amount) < 0) return new Response(JSON.stringify({ error: "Need amount" }), { status: 400, headers: buildCors(req?.headers?.get("origin") || "*") });

    // A public booking ID must not mint a private confirmation capability.
    // New storefront bookings already receive an independent waiver secret in
    // their insert response. Internal bots and operator actions use real auth.
    if (bookingId) {
      const { data: booking, error } = await supabase.from("bookings")
        .select("business_id, waiver_token").eq("id", bookingId).maybeSingle();
      if (error) return new Response(JSON.stringify({ error: "Could not verify booking access" }), { status: 503, headers: buildCors(req?.headers?.get("origin")) });
      let allowed = Boolean(booking?.waiver_token && typeof body.booking_token === "string" && body.booking_token === booking.waiver_token);
      if (!allowed && booking) {
        try { allowed = canAccessBusiness(await requireAuth(req), booking.business_id); } catch { /* not an operator or service caller */ }
      }
      if (!allowed) return new Response(JSON.stringify({ error: "Booking verification required" }), { status: 403, headers: buildCors(req?.headers?.get("origin")) });
    }

    // Fix 3a: a paused or suspended operator takes no new business. Gated here,
    // ahead of pricing, promo application and payment, so every downstream exit
    // is covered — including the promo-fully-covered path below, which returns
    // a confirmed booking without ever reaching the payment provider.
    // One extra indexed lookup per checkout; the alternative is a gate per exit.
    {
      const gateRow = bookingId
        ? await supabase.from("bookings").select("business_id").eq("id", bookingId).maybeSingle()
        : voucherId
        ? await supabase.from("vouchers").select("business_id").eq("id", voucherId).maybeSingle()
        : null;
      const gateBusinessId = String(gateRow?.data?.business_id || "");
      if (gateBusinessId) {
        const blocked = await blockIfNotTrading(supabase, gateBusinessId, buildCors(req?.headers?.get("origin") || "*"));
        if (blocked) return blocked;
      }
    }

    // Price, voucher reservations and the seat hold commit together.
    let quote: any = null;
    let promoId: string | null = null;
    let appliedPromoCode = "";
    if (type === "BOOKING" && bookingId) {
      const priced = await supabase.rpc("prepare_booking_checkout", {
        p_booking_id: bookingId, p_promo_code: body.promo_code ?? null,
        p_voucher_ids: body.voucher_ids ?? null, p_voucher_codes: body.voucher_codes ?? null,
        p_add_ons: body.add_ons ?? null,
      });
      if (priced.error || !priced.data?.ok) {
        return new Response(JSON.stringify({ error: "CHECKOUT_UNAVAILABLE", reason: priced.data?.error || "Could not verify booking pricing" }), {
          status: 409, headers: buildCors(req?.headers?.get("origin")),
        });
      }
      quote = priced.data;
      amount = Number(quote.amount);
      promoId = quote.promo_id;
      appliedPromoCode = quote.promo_code || "";
    }

    // Gift-voucher charge must equal the voucher's face value read from the DB —
    // never the client-supplied amount. The webhook activates current_balance to
    // this same value on payment, so trusting the client would let a buyer pay R1
    // for an arbitrarily large voucher.
    if (type === "GIFT_VOUCHER" && voucherId) {
      const gvRow = await supabase.from("vouchers").select("value, purchase_amount, status").eq("id", voucherId).maybeSingle();
      if (!gvRow.data) {
        return new Response(JSON.stringify({ error: "VOUCHER_NOT_FOUND" }), { status: 404, headers: buildCors(req?.headers?.get("origin") || "*") });
      }
      const faceValue = Number(gvRow.data.value ?? gvRow.data.purchase_amount ?? 0);
      if (!(faceValue > 0)) {
        return new Response(JSON.stringify({ error: "VOUCHER_VALUE_INVALID" }), { status: 400, headers: buildCors(req?.headers?.get("origin") || "*") });
      }
      if (Math.abs(Number(amount) - faceValue) > 0.01) {
        console.warn("VOUCHER_PRICE_MISMATCH: frontend=" + amount + " server=" + faceValue + " voucher=" + voucherId);
      }
      amount = faceValue;
    }

    const resolved = await resolveCheckoutBusiness({ bookingId, voucherId });
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
    // R12: strict allowlist. Legacy bot types (ADD_PEOPLE/DEPOSIT_50/RESEND/
    // SPLIT_*) map to their maintained equivalents; anything else is rejected
    // instead of falling through to caller-supplied amounts.
    const TYPE_MAP: Record<string, string> = {
      BOOKING: "BOOKING", GIFT_VOUCHER: "GIFT_VOUCHER", RESCHEDULE: "RESCHEDULE",
      ADD_GUESTS: "ADD_GUESTS", ADD_PEOPLE: "ADD_GUESTS",
      COMBO: "COMBO", COMBO_SETTLEMENT: "COMBO_SETTLEMENT",
      TOPUP: "TOPUP", PLATFORM_INVOICE: "PLATFORM_INVOICE",
    };
    const canonicalType = TYPE_MAP[type] || "";
    if (!canonicalType) {
      return new Response(
        JSON.stringify({ error: "UNKNOWN_CHECKOUT_TYPE", reason: "Unsupported checkout type: " + type }),
        { status: 400, headers: corsHeaders },
      );
    }
    // R12: derive every supported charge server-side. Uplifts (RESCHEDULE /
    // ADD_GUESTS) come from the pending record or qty delta; deposits and
    // splits pay a fraction of the verified cash due — never the raw caller amount.
    let expectedCents = 0;
    let amendmentHold: any = null;
    let pendingReschedule: any = null;
    if ((canonicalType === "RESCHEDULE" || canonicalType === "ADD_GUESTS") && bookingId) {
      if (canonicalType === "RESCHEDULE") {
        const pending = await supabase.from("pending_reschedules").select("*")
          .eq("id", String(body.pending_reschedule_id || "")).eq("booking_id", bookingId).eq("business_id", resolved.businessId).maybeSingle();
        if (pending.error || !pending.data || pending.data.status !== "PENDING") return new Response(JSON.stringify({ error: "RESCHEDULE_NOT_PENDING" }), { status: 409, headers: corsHeaders });
        pendingReschedule = pending.data;
      }
      const held = await supabase.from("holds").select("*").eq("id", pendingReschedule?.hold_id || String(body.hold_id || "")).eq("booking_id", bookingId).maybeSingle();
      if (held.error || !held.data || held.data.status !== "ACTIVE" || new Date(held.data.expires_at).getTime() <= Date.now()
          || held.data.hold_type !== canonicalType) return new Response(JSON.stringify({ error: "AMENDMENT_HOLD_EXPIRED" }), { status: 409, headers: corsHeaders });
      amendmentHold = held.data;
      if (canonicalType === "ADD_GUESTS" && Number(amendmentHold.metadata?.new_qty) !== Number(body.new_qty)) return new Response(JSON.stringify({ error: "GUEST_COUNT_CHANGED" }), { status: 409, headers: corsHeaders });
      amount = Number(pendingReschedule?.diff ?? amendmentHold.metadata?.diff);
      if (!(amount > 0)) return new Response(JSON.stringify({ error: "AMENDMENT_AMOUNT_INVALID" }), { status: 409, headers: corsHeaders });
      if (amendmentHold.metadata?.payment_url) return new Response(JSON.stringify({
        id: amendmentHold.metadata.yoco_checkout_id, redirectUrl: amendmentHold.metadata.payment_url, amount, expires_at: amendmentHold.expires_at,
      }), { headers: corsHeaders });
    }
    const metadata: any = { type: canonicalType, requested_type: type };
    let successUrl = businessUrls.bookingSuccessUrl;
    const cancelUrl = businessUrls.bookingCancelUrl;

    if (canonicalType === "TOPUP") {
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

    if (canonicalType === "GIFT_VOUCHER") {
      metadata.voucher_id = voucherId;
      metadata.voucher_code = voucherCode;
      successUrl = withQuery(businessUrls.voucherSuccessUrl, { code: voucherCode || "" });
    } else if (canonicalType === "RESCHEDULE") {
      metadata.booking_id = bookingId;
      metadata.pending_reschedule_id = body.pending_reschedule_id || "";
      successUrl = await bookingSuccessUrl(businessUrls.bookingSuccessUrl, bookingId, resolved.businessId, amendmentHold.id);
    } else if (canonicalType === "ADD_GUESTS") {
      metadata.booking_id = bookingId;
      metadata.hold_id = body.hold_id || "";
      metadata.new_qty = String(body.new_qty || 0);
      successUrl = await bookingSuccessUrl(businessUrls.bookingSuccessUrl, bookingId, resolved.businessId, amendmentHold.id);
    } else if (canonicalType === "COMBO" || canonicalType === "COMBO_SETTLEMENT" || canonicalType === "PLATFORM_INVOICE") {
      // Combo/platform checkouts carry their own metadata from their dedicated
      // creators; the generic booking branch must not claim them.
      return new Response(
        JSON.stringify({ error: "WRONG_CHECKOUT_CREATOR", reason: "Use the dedicated " + canonicalType + " creator for this checkout type." }),
        { status: 400, headers: corsHeaders },
      );
    } else {
      metadata.booking_id = bookingId;
      metadata.customer_name = body.customer_name || "";
      metadata.qty = String(body.qty || 1);
      if (body.voucher_codes) metadata.voucher_codes = body.voucher_codes.join(",");
      if (body.voucher_ids) metadata.voucher_ids = body.voucher_ids.join(",");
      if (promoId) { metadata.promo_id = promoId; metadata.promo_code = appliedPromoCode; metadata.customer_email = customerEmail; }
      successUrl = await bookingSuccessUrl(businessUrls.bookingSuccessUrl, bookingId, resolved.businessId);
    }

    if (quote?.redirectUrl) {
      return new Response(JSON.stringify({ id: quote.checkout_id, redirectUrl: quote.redirectUrl, amount, expires_at: quote.expires_at }), { headers: corsHeaders });
    }
    if (canonicalType === "BOOKING" && quote && amount === 0) {
      const confirmed = await supabase.rpc("confirm_booking_payment", {
        p_booking_id: bookingId, p_payment_id: "VOUCHER_WEB", p_captured_cents: 0,
        p_currency: tenant.business.currency || "ZAR",
      });
      if (confirmed.error || !confirmed.data?.ok) return new Response(JSON.stringify({ error: "CONFIRMATION_FAILED", reason: confirmed.data?.error || "Could not confirm booking" }), { status: 409, headers: corsHeaders });
      return new Response(JSON.stringify({ fully_covered: true, redirectUrl: successUrl, amount: 0 }), { headers: corsHeaders });
    }

    console.log("CREATING CHECKOUT: amount=" + amount + " type=" + type);

    if (!tenant.credentials.activeYocoSecretKey) {
      return new Response(
        JSON.stringify({ error: "BUSINESS_PAYMENT_CONFIG_MISSING", reason: "No Yoco secret key configured for this business." }),
        { status: 503, headers: corsHeaders },
      );
    }

    let isTestMode = tenant.credentials.yocoTestMode === true;
    console.log("CREATING CHECKOUT: test_mode=" + isTestMode);

    // Store the exact request, including its signed return URL. A lost response
    // retries the same provider operation instead of minting a second payment.
    const savedRequest = await supabase.rpc("save_checkout_request", {
      p_booking_id: bookingId || null, p_hold_id: amendmentHold?.id || null, p_voucher_id: voucherId || null,
      p_request: { mode: isTestMode ? "test" : "live", body: {
        amount: Math.round(Number(amount) * 100), currency: tenant.business.currency || "ZAR",
        successUrl, cancelUrl, failureUrl: cancelUrl, metadata,
      } },
    });
    if (savedRequest.error || !savedRequest.data?.ok) return new Response(JSON.stringify({ error: "CHECKOUT_REQUEST_FAILED", reason: savedRequest.data?.error || "Could not save checkout. Please try again." }), { status: 409, headers: corsHeaders });
    const paymentRequest = savedRequest.data.request;
    isTestMode = paymentRequest.mode === "test";
    const paymentKey = isTestMode ? tenant.credentials.yocoTestSecretKey : tenant.credentials.yocoSecretKey;
    if (!paymentKey) return new Response(JSON.stringify({ error: "BUSINESS_PAYMENT_CONFIG_MISSING", reason: "Payment credentials for this checkout are missing." }), { status: 503, headers: corsHeaders });
    amount = Number(paymentRequest.body.amount) / 100;
    const yocoRes = await fetch("https://payments.yoco.com/api/checkouts", {
      method: "POST",
      headers: { Authorization: "Bearer " + paymentKey, "Content-Type": "application/json", "Idempotency-Key": paymentRequest.id },
      body: JSON.stringify(paymentRequest.body),
    });

    const yocoData = await yocoRes.json();
    console.log("CHECKOUT:", yocoData?.id, yocoRes.status);

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
      // R12/R14: stamp the immutable expected charge (cents) the webhook
      // reconciles against; reserve voucher credit so concurrent checkouts
      // cannot spend the same balance twice.
      expectedCents = Math.round(Number(amount) * 100);
      if (bookingId && canonicalType === "BOOKING") {
        // payment_url only for first-payment checkouts: the cron hold-expiry
        // sweep re-sends it if the customer abandons. Top-up links (RESCHEDULE/
        // ADD_GUESTS) must not overwrite the original booking payment link.
        const bookingUpdate: Record<string, unknown> = {
          yoco_checkout_id: yocoData.id,
          expected_amount_cents: expectedCents,
          expected_currency: tenant.business.currency || "ZAR",
          yoco_mode: isTestMode ? "test" : "live",
        };
        if (canonicalType === "BOOKING") bookingUpdate.payment_url = yocoData.redirectUrl;
        const savedCheckout = await supabase.from("bookings").update(bookingUpdate).eq("id", bookingId).eq("business_id", resolved.businessId);
        if (savedCheckout.error) return new Response(JSON.stringify({ error: "CHECKOUT_SAVE_FAILED", reason: "Could not save the payment link. Please try again." }), { status: 503, headers: corsHeaders });

      }
      if (amendmentHold) {
        const stamp = {
          yoco_checkout_id: yocoData.id, yoco_mode: isTestMode ? "test" : "live",
          expected_amount_cents: expectedCents, expected_currency: tenant.business.currency || "ZAR",
        };
        const held = await supabase.from("holds").update({ metadata: { ...amendmentHold.metadata, ...stamp, payment_url: yocoData.redirectUrl } })
          .eq("id", amendmentHold.id).eq("booking_id", bookingId);
        if (held.error) return new Response(JSON.stringify({ error: "AMENDMENT_CHECKOUT_SAVE_FAILED" }), { status: 503, headers: corsHeaders });
        if (pendingReschedule) {
          const pending = await supabase.from("pending_reschedules").update(stamp).eq("id", pendingReschedule.id).eq("business_id", resolved.businessId);
          if (pending.error) return new Response(JSON.stringify({ error: "RESCHEDULE_CHECKOUT_SAVE_FAILED" }), { status: 503, headers: corsHeaders });
        }
      }
      if (voucherId) {
        // Persist payment_url so the cron can re-send it if the buyer abandons.
        // No "please pay" email here — the buyer is redirected straight to Yoco,
        // so an immediate email is redundant. Mirrors the BOOKING flow: the cron
        // emails the link only if the voucher is still PENDING after 15 min.
        await supabase.from("vouchers").update({ yoco_checkout_id: yocoData.id, payment_url: yocoData.redirectUrl, yoco_mode: isTestMode ? "test" : "live" }).eq("id", voucherId);
      }

      // Send payment link via WhatsApp + email for BOOKING checkouts — opt-in
      // (admin-only). See sendPaymentLink note above.
      if (canonicalType === "BOOKING" && bookingId && sendPaymentLink) {
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

      // Send payment link for RESCHEDULE upgrades. Email is the canonical
      // channel; WhatsApp only when no email on file. The customer needs to
      // know (a) the booking was moved, (b) there's a top-up payment due,
      // (c) the new slot is held for 15 min.
      if (canonicalType === "RESCHEDULE" && bookingId && !skipNotifications) {
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
            const newQty = 1;
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

            if (notifPhone && !(notifEmail && notifEmail.includes("@"))) {
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

      return new Response(JSON.stringify({ id: yocoData.id, redirectUrl: yocoData.redirectUrl, amount, expires_at: quote?.expires_at }), { status: 200, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: "Yoco error", details: yocoData }), { status: 500, headers: corsHeaders });
  } catch (err: any) {
    console.error("CHECKOUT_ERR:", err?.message || err, JSON.stringify(_reqBody));
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: buildCors(req?.headers?.get("origin") || "*") });
  }
});
