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

export async function setEncryptionKeyContext(supabase: any) {
  if (!SETTINGS_ENCRYPTION_KEY || SETTINGS_ENCRYPTION_KEY.length < 32) {
    throw new Error("Missing SETTINGS_ENCRYPTION_KEY");
  }

  var { error } = await supabase.rpc("set_app_settings_encryption_key", {
    p_value: SETTINGS_ENCRYPTION_KEY,
  });

  if (error) {
    throw new Error("Failed to set encryption key context: " + error.message);
  }
}

export async function getBusinessCredentials(supabase: any, businessId: string): Promise<TenantCredentials> {
  await setEncryptionKeyContext(supabase);

  var { data, error } = await supabase.rpc("get_business_credentials", {
    p_business_id: businessId,
  });

  if (error) {
    throw new Error("Credential lookup failed: " + error.message);
  }

  var row = asRow(data);
  if (!row) {
    throw new Error("No encrypted credentials found for business " + businessId);
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

export function isAllowedOrigin(origin: string, allowedOrigins: string[]) {
  if (!origin) return true;
  return allowedOrigins.includes(origin);
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

export async function sendWhatsappTextForTenant(tenant: TenantContext | { business: TenantBusiness; credentials: TenantCredentials }, to: string, message: string) {
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
  if (!res.ok) throw new Error(String(data?.error?.message || data?.message || "WhatsApp send failed"));
  return data;
}
