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
    var type = body.type || "BOOKING";
    var topupBusinessId = body.business_id;

    if (!amount) return new Response(JSON.stringify({ error: "Need amount" }), { status: 400, headers: buildCors(req?.headers?.get("origin") || "*") });

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

    if (type === "GIFT_VOUCHER") {
      metadata.voucher_id = voucherId;
      metadata.voucher_code = voucherCode;
      successUrl = withQuery(businessUrls.voucherSuccessUrl, { code: voucherCode || "" });
    } else if (type === "TOPUP") {
      return new Response(
        JSON.stringify({ error: "TOPUPS_DISCONTINUED", reason: "Booking top-ups have been removed. Plans are billed monthly by admin seats." }),
        { status: 410, headers: corsHeaders },
      );
    } else {
      metadata.booking_id = bookingId;
      metadata.customer_name = body.customer_name || "";
      metadata.qty = String(body.qty || 1);
      if (body.voucher_codes) metadata.voucher_codes = body.voucher_codes.join(",");
      if (body.voucher_ids) metadata.voucher_ids = body.voucher_ids.join(",");
      successUrl = withQuery(businessUrls.bookingSuccessUrl, { ref: bookingId || "" });
    }

    if (type !== "TOPUP" && !ensureCheckoutUrls(businessUrls, type)) {
      return new Response(
        JSON.stringify({ error: "BUSINESS_BOOKING_URLS_MISSING", reason: "This business is missing configured booking success/cancel URLs." }),
        { status: 503, headers: corsHeaders },
      );
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
      return new Response(JSON.stringify({ id: yocoData.id, redirectUrl: yocoData.redirectUrl }), { status: 200, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: "Yoco error", details: yocoData }), { status: 500, headers: corsHeaders });
  } catch (err: any) {
    console.error("CHECKOUT_ERR:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: buildCors(req?.headers?.get("origin") || "*") });
  }
});
