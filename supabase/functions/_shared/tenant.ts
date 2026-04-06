import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type TenantBusiness = {
  id: string;
  name?: string | null;
  business_name?: string | null;
  business_tagline?: string | null;
  timezone?: string | null;
  currency?: string | null;
  logo_url?: string | null;
  ai_system_prompt?: string | null;
  faq_json?: any;
  terminology?: any;
  weather_widget_locations?: any;
  waiver_url?: string | null;
  booking_site_url?: string | null;
  manage_bookings_url?: string | null;
  gift_voucher_url?: string | null;
  booking_success_url?: string | null;
  booking_cancel_url?: string | null;
  voucher_success_url?: string | null;
  directions?: string | null;
  footer_line_one?: string | null;
  footer_line_two?: string | null;
};

export type TenantCredentials = {
  waToken: string;
  waPhoneId: string;
  yocoSecretKey: string;
  yocoWebhookSecret: string;
};

export type TenantContext = {
  business: TenantBusiness;
  credentials: TenantCredentials;
  resolvedBy: "business_id" | "wa_phone_id";
};

var SETTINGS_ENCRYPTION_KEY = Deno.env.get("SETTINGS_ENCRYPTION_KEY") || "";

function asRow(data: any) {
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

export function normalizePhoneLookup(value?: string | null) {
  return String(value || "").replace(/[^\d]/g, "");
}

/**
 * Normalise any phone input to E.164-like digits-only format.
 * Examples:
 *   "+27 71 614 5061"  → "27716145061"
 *   "071 614 5061"     → "27716145061"
 *   "0716145061"       → "27716145061"
 *   "27716145061"      → "27716145061"
 *   "+44 7911 123456"  → "447911123456"
 * Returns empty string for falsy / empty input.
 */
export function normalizePhone(value?: string | null): string {
  if (!value) return "";
  var digits = String(value).replace(/[^\d]/g, "");
  if (!digits) return "";
  // South-African local numbers starting with 0 → prepend 27
  if (digits.startsWith("0")) {
    digits = "27" + digits.substring(1);
  }
  return digits;
}

// Kept for backward compatibility — safe to call; the DB stub is a no-op.
// Credential RPCs now receive the key as an explicit param — no session GUC needed.
export async function setEncryptionKeyContext(_supabase: any) {
  if (!SETTINGS_ENCRYPTION_KEY || SETTINGS_ENCRYPTION_KEY.length < 32) {
    throw new Error("Missing or too-short SETTINGS_ENCRYPTION_KEY (must be 32+ chars)");
  }
}

export async function getBusinessCredentials(supabase: any, businessId: string): Promise<TenantCredentials> {
  if (!SETTINGS_ENCRYPTION_KEY || SETTINGS_ENCRYPTION_KEY.length < 32) {
    throw new Error("Missing or too-short SETTINGS_ENCRYPTION_KEY (must be 32+ chars)");
  }

  // Single RPC call — key passed as an explicit parameter.
  // Fixes the broken two-step GUC pattern that failed with connection pooling.
  var { data, error } = await supabase.rpc("get_business_credentials", {
    p_business_id: businessId,
    p_key: SETTINGS_ENCRYPTION_KEY,
  });

  if (error) {
    throw new Error("Credential lookup failed: " + error.message);
  }

  var row = asRow(data);
  if (!row) {
    throw new Error("No credential record found for business " + businessId);
  }

  return {
    waToken: String(row.wa_token || ""),
    waPhoneId: String(row.wa_phone_id || ""),
    yocoSecretKey: String(row.yoco_secret_key || ""),
    yocoWebhookSecret: String(row.yoco_webhook_secret || ""),
  };
}

export async function getBusinessConfig(supabase: any, businessId: string): Promise<TenantBusiness> {
  var { data, error } = await supabase
    .from("businesses")
    .select([
      "id",
      "name",
      "business_name",
      "business_tagline",
      "timezone",
      "currency",
      "logo_url",
      "ai_system_prompt",
      "faq_json",
      "terminology",
      "weather_widget_locations",
      "waiver_url",
      "booking_site_url",
      "manage_bookings_url",
      "gift_voucher_url",
      "booking_success_url",
      "booking_cancel_url",
      "voucher_success_url",
      "directions",
      "footer_line_one",
      "footer_line_two",
    ].join(","))
    .eq("id", businessId)
    .maybeSingle();

  if (error) {
    throw new Error("Business lookup failed: " + error.message);
  }

  if (!data) {
    throw new Error("Business not found: " + businessId);
  }

  return data as TenantBusiness;
}

export async function getTenantByBusinessId(supabase: any, businessId: string): Promise<TenantContext> {
  var business = await getBusinessConfig(supabase, businessId);
  var credentials = await getBusinessCredentials(supabase, businessId);
  return {
    business,
    credentials,
    resolvedBy: "business_id",
  };
}

export async function resolveTenantByWhatsappPayload(supabase: any, payload: any): Promise<TenantContext> {
  var metadata = payload?.entry?.[0]?.changes?.[0]?.value?.metadata || {};
  var incomingPhoneId = normalizePhoneLookup(metadata.phone_number_id || "");

  if (!incomingPhoneId) {
    throw new Error("WhatsApp metadata.phone_number_id is missing");
  }

  var { data, error } = await supabase
    .from("businesses")
    .select([
      "id",
      "name",
      "business_name",
      "business_tagline",
      "timezone",
      "currency",
      "logo_url",
      "ai_system_prompt",
      "faq_json",
      "terminology",
      "weather_widget_locations",
      "waiver_url",
      "booking_site_url",
      "manage_bookings_url",
      "gift_voucher_url",
      "booking_success_url",
      "booking_cancel_url",
      "voucher_success_url",
      "directions",
      "footer_line_one",
      "footer_line_two",
    ].join(","))
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error("Business scan failed: " + error.message);
  }

  var businesses = data || [];
  for (var i = 0; i < businesses.length; i++) {
    var business = businesses[i] as TenantBusiness;
    var credentials = await getBusinessCredentials(supabase, business.id);
    if (normalizePhoneLookup(credentials.waPhoneId) === incomingPhoneId) {
      return {
        business,
        credentials,
        resolvedBy: "wa_phone_id",
      };
    }
  }

  throw new Error("No business matched WhatsApp phone_number_id " + incomingPhoneId);
}

export function trimTrailingSlash(url?: string | null) {
  return String(url || "").replace(/\/+$/, "");
}

export function urlToOrigin(url?: string | null) {
  var value = String(url || "").trim();
  if (!value) return "";
  try {
    return new URL(value).origin;
  } catch (_error) {
    return "";
  }
}

export function getAdminAppOrigins() {
  var configured = String(Deno.env.get("ADMIN_APP_ORIGINS") || "")
    .split(",")
    .map(function (value) { return value.trim(); })
    .filter(Boolean);
  return Array.from(new Set(configured.concat([
    "https://caepweb-admin.vercel.app",
    "https://admin-tawny-delta-92.vercel.app",
    "https://booking-mu-steel.vercel.app",
    "https://bookingtours.co.za",
    "https://www.bookingtours.co.za",
    "http://localhost:3000",
    "http://localhost:3001",
  ])));
}

export function getBusinessAllowedOrigins(business?: TenantBusiness | null) {
  var urls = [
    business?.booking_site_url,
    business?.manage_bookings_url,
    business?.gift_voucher_url,
    business?.booking_success_url,
    business?.booking_cancel_url,
    business?.voucher_success_url,
  ];
  var origins = urls
    .map(function (url) { return urlToOrigin(url); })
    .filter(Boolean);
  return Array.from(new Set(getAdminAppOrigins().concat(origins)));
}

// Wildcard patterns for bookingtours.co.za subdomains
var WILDCARD_ORIGINS = [
  ".admin.bookingtours.co.za",
  ".booking.bookingtours.co.za",
  ".bookingtours.co.za",
];

export function isAllowedOrigin(origin: string, allowedOrigins: string[]) {
  if (!origin) return false;
  // Exact match against known origins
  if (allowedOrigins.includes(origin)) return true;
  // Wildcard match: any *.admin.bookingtours.co.za or *.booking.bookingtours.co.za
  try {
    var hostname = new URL(origin).hostname;
    for (var i = 0; i < WILDCARD_ORIGINS.length; i++) {
      if (hostname.endsWith(WILDCARD_ORIGINS[i])) return true;
    }
  } catch (_) { /* invalid URL */ }
  return false;
}

export function resolveBusinessSiteUrls(data?: TenantBusiness | null, defaults?: {
  bookingSuccessUrl?: string;
  bookingCancelUrl?: string;
  voucherSuccessUrl?: string;
}) {
  var defaultSuccessUrl = defaults?.bookingSuccessUrl || "";
  var defaultCancelUrl = defaults?.bookingCancelUrl || "";
  var defaultVoucherSuccessUrl = defaults?.voucherSuccessUrl || "";
  var bookingSiteUrl = trimTrailingSlash(data?.booking_site_url);
  var fallbackSiteUrl = trimTrailingSlash(defaultSuccessUrl).replace(/\/success$/, "");

  return {
    bookingSiteUrl: bookingSiteUrl || fallbackSiteUrl,
    bookingSuccessUrl: data?.booking_success_url || (bookingSiteUrl ? bookingSiteUrl + "/success" : defaultSuccessUrl),
    bookingCancelUrl: data?.booking_cancel_url || (bookingSiteUrl ? bookingSiteUrl + "/cancelled" : defaultCancelUrl),
    voucherSuccessUrl: data?.voucher_success_url || (bookingSiteUrl ? bookingSiteUrl + "/voucher-confirmed" : defaultVoucherSuccessUrl),
  };
}

export function resolveManageBookingsUrl(business?: TenantBusiness | null): string {
  if (business?.manage_bookings_url) return String(business.manage_bookings_url);
  var bookingSiteUrl = trimTrailingSlash(business?.booking_site_url);
  if (bookingSiteUrl) return bookingSiteUrl + "/my-bookings";
  if (business?.subdomain) return "https://" + business.subdomain + ".booking.bookingtours.co.za/my-bookings";
  return "https://booking-mu-steel.vercel.app/my-bookings";
}

// ──────────────────────────────────────────────────────────────────
// AUDIT LOGGING — Edge Functions that perform sensitive operations
// (refunds, price overrides, booking deletions, credential changes)
// should log to the `audit_logs` table. Example:
//
//   await supabase.from("audit_logs").insert({
//     actor_id:      adminUserId,
//     business_id:   businessId,
//     action_type:   "REFUND",
//     target_entity: "bookings",
//     target_id:     bookingId,
//     before_state:  { status: "CONFIRMED", amount_paid: 500 },
//     after_state:   { status: "REFUNDED",  refund_amount: 500 },
//   });
//
// The audit_logs table is append-only (no UPDATE/DELETE policies).
// ──────────────────────────────────────────────────────────────────

export function createServiceClient() {
  var supabaseUrl = Deno.env.get("SUPABASE_URL");
  var supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, supabaseKey);
}

export function getBusinessDisplayName(business?: TenantBusiness | null) {
  return String(business?.business_name || business?.name || "Adventure Operator");
}

export function getBusinessTimezone(business?: TenantBusiness | null) {
  return String(business?.timezone || "UTC");
}

export function formatTenantDateTime(business: TenantBusiness | null | undefined, iso: string, options?: Intl.DateTimeFormatOptions) {
  return new Date(iso).toLocaleString("en-ZA", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: getBusinessTimezone(business),
    ...(options || {}),
  });
}

export function formatTenantDate(business: TenantBusiness | null | undefined, iso: string, options?: Intl.DateTimeFormatOptions) {
  return new Date(iso).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: getBusinessTimezone(business),
    ...(options || {}),
  });
}

// Send a pre-approved WhatsApp message template.
// bodyParams maps to {{1}}, {{2}}, ... in the template body in order.
export async function sendWhatsappTemplate(
  tenant: TenantContext | { business: TenantBusiness; credentials: TenantCredentials },
  to: string,
  templateName: string,
  bodyParams: string[],
  languageCode = "en",
) {
  if (!tenant.credentials.waToken || !tenant.credentials.waPhoneId) {
    throw new Error("WhatsApp is not configured for " + getBusinessDisplayName(tenant.business));
  }
  var normalizedTo = String(to || "").replace(/\D/g, "");
  if (normalizedTo.startsWith("0")) normalizedTo = "27" + normalizedTo.substring(1);

  var components = bodyParams.length > 0
    ? [{ type: "body", parameters: bodyParams.map(function (text) { return { type: "text", text: String(text) }; }) }]
    : [];

  var res = await fetch("https://graph.facebook.com/v19.0/" + tenant.credentials.waPhoneId + "/messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + tenant.credentials.waToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: normalizedTo,
      type: "template",
      template: { name: templateName, language: { code: languageCode }, components },
    }),
  });
  var data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(data?.error?.message || "WhatsApp template send failed: " + templateName));
  return data;
}

// Send a free-form WhatsApp text message.
// If the customer is outside the 24-hour window (error 131047 / 131026) and
// a templateFallback is provided, the template is sent instead so the message
// still reaches the customer.
export async function sendWhatsappTextForTenant(
  tenant: TenantContext | { business: TenantBusiness; credentials: TenantCredentials },
  to: string,
  message: string,
  templateFallback?: { name: string; params: string[]; language?: string },
) {
  // Guard: fail fast with a clear message instead of a malformed API call
  if (!tenant.credentials.waToken || !tenant.credentials.waPhoneId) {
    var bName = getBusinessDisplayName(tenant.business);
    throw new Error(
      "WhatsApp is not configured for " + bName + ". " +
      "Please add the Access Token and Phone Number ID in Admin → Settings → Integration Credentials."
    );
  }
  var normalizedTo = String(to || "").replace(/\D/g, "");
  if (normalizedTo.startsWith("0")) normalizedTo = "27" + normalizedTo.substring(1);
  var res = await fetch("https://graph.facebook.com/v19.0/" + tenant.credentials.waPhoneId + "/messages", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + tenant.credentials.waToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: normalizedTo,
      type: "text",
      text: { body: message },
    }),
  });
  var data = await res.json().catch(() => ({}));

  if (!res.ok) {
    var errCode = data?.error?.code;
    // 131047 = outside 24h customer service window
    // 131026 = recipient hasn't messaged this number before
    if ((errCode === 131047 || errCode === 131026) && templateFallback) {
      console.log("WA 24h window closed — sending template fallback: " + templateFallback.name + " to " + normalizedTo);
      return await sendWhatsappTemplate(tenant, to, templateFallback.name, templateFallback.params, templateFallback.language);
    }
    throw new Error(String(data?.error?.message || data?.message || "WhatsApp send failed"));
  }
  return data;
}
