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
  subdomain?: string | null;
  directions?: string | null;
  footer_line_one?: string | null;
  footer_line_two?: string | null;
  meeting_point_address?: string | null;
  arrival_instructions?: string | null;
  business_address?: string | null;
  social_google_reviews?: string | null;
  what_to_bring?: string | null;
  activity_verb_past?: string | null;
  location_phrase?: string | null;
};

export type TenantCredentials = {
  waToken: string;
  waPhoneId: string;
  yocoSecretKey: string;
  yocoWebhookSecret: string;
  yocoTestMode: boolean;
  yocoTestSecretKey: string;
  yocoTestWebhookSecret: string;
  activeYocoSecretKey: string;
  activeYocoWebhookSecret: string;
};

export type TenantContext = {
  business: TenantBusiness;
  credentials: TenantCredentials;
  resolvedBy: "business_id" | "wa_phone_id";
};

const SETTINGS_ENCRYPTION_KEY = Deno.env.get("SETTINGS_ENCRYPTION_KEY") || "";

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
  let digits = String(value).replace(/[^\d]/g, "");
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
  const { data, error } = await supabase.rpc("get_business_credentials", {
    p_business_id: businessId,
    p_key: SETTINGS_ENCRYPTION_KEY,
  });

  if (error) {
    throw new Error("Credential lookup failed: " + error.message);
  }

  const row = asRow(data);
  if (!row) {
    throw new Error("No credential record found for business " + businessId);
  }

  const testMode = row.yoco_test_mode === true;
  const liveKey = String(row.yoco_secret_key || "");
  const liveWebhook = String(row.yoco_webhook_secret || "");
  const testKey = String(row.yoco_test_secret_key || "");
  const testWebhook = String(row.yoco_test_webhook_secret || "");
  return {
    waToken: String(row.wa_token || ""),
    waPhoneId: String(row.wa_phone_id || ""),
    yocoSecretKey: liveKey,
    yocoWebhookSecret: liveWebhook,
    yocoTestMode: testMode,
    yocoTestSecretKey: testKey,
    yocoTestWebhookSecret: testWebhook,
    activeYocoSecretKey: testMode && testKey ? testKey : liveKey,
    activeYocoWebhookSecret: testMode && testWebhook ? testWebhook : liveWebhook,
  };
}

export async function getBusinessConfig(supabase: any, businessId: string): Promise<TenantBusiness> {
  const { data, error } = await supabase
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
      "meeting_point_address",
      "arrival_instructions",
      "business_address",
      "social_google_reviews",
      "what_to_bring",
      "activity_verb_past",
      "location_phrase",
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
  const business = await getBusinessConfig(supabase, businessId);
  const credentials = await getBusinessCredentials(supabase, businessId);
  return {
    business,
    credentials,
    resolvedBy: "business_id",
  };
}

export async function resolveTenantByWhatsappPayload(supabase: any, payload: any): Promise<TenantContext> {
  const metadata = payload?.entry?.[0]?.changes?.[0]?.value?.metadata || {};
  const incomingPhoneId = normalizePhoneLookup(metadata.phone_number_id || "");

  if (!incomingPhoneId) {
    throw new Error("WhatsApp metadata.phone_number_id is missing");
  }

  const { data, error } = await supabase
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
      "meeting_point_address",
      "arrival_instructions",
      "business_address",
      "social_google_reviews",
      "what_to_bring",
      "activity_verb_past",
      "location_phrase",
    ].join(","))
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error("Business scan failed: " + error.message);
  }

  const businesses = data || [];
  for (let i = 0; i < businesses.length; i++) {
    const business = businesses[i] as TenantBusiness;
    const credentials = await getBusinessCredentials(supabase, business.id);
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
  const value = String(url || "").trim();
  if (!value) return "";
  try {
    return new URL(value).origin;
  } catch (_error) {
    return "";
  }
}

export function getAdminAppOrigins() {
  const configured = String(Deno.env.get("ADMIN_APP_ORIGINS") || "")
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
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
  ])));
}

export function getBusinessAllowedOrigins(business?: TenantBusiness | null) {
  const urls = [
    business?.booking_site_url,
    business?.manage_bookings_url,
    business?.gift_voucher_url,
    business?.booking_success_url,
    business?.booking_cancel_url,
    business?.voucher_success_url,
  ];
  const origins = urls
    .map(function (url) { return urlToOrigin(url); })
    .filter(Boolean);
  return Array.from(new Set(getAdminAppOrigins().concat(origins)));
}

// Wildcard patterns for bookingtours.co.za subdomains
const WILDCARD_ORIGINS = [
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
    const hostname = new URL(origin).hostname;
    for (let i = 0; i < WILDCARD_ORIGINS.length; i++) {
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
  const defaultSuccessUrl = defaults?.bookingSuccessUrl || "";
  const defaultCancelUrl = defaults?.bookingCancelUrl || "";
  const defaultVoucherSuccessUrl = defaults?.voucherSuccessUrl || "";
  const bookingSiteUrl = trimTrailingSlash(data?.booking_site_url);
  const fallbackSiteUrl = trimTrailingSlash(defaultSuccessUrl).replace(/\/success$/, "");

  return {
    bookingSiteUrl: bookingSiteUrl || fallbackSiteUrl,
    bookingSuccessUrl: data?.booking_success_url || (bookingSiteUrl ? bookingSiteUrl + "/success" : defaultSuccessUrl),
    bookingCancelUrl: data?.booking_cancel_url || (bookingSiteUrl ? bookingSiteUrl + "/cancelled" : defaultCancelUrl),
    voucherSuccessUrl: data?.voucher_success_url || (bookingSiteUrl ? bookingSiteUrl + "/voucher-confirmed" : defaultVoucherSuccessUrl),
  };
}

export function resolveBookingSiteUrl(business?: TenantBusiness | null): string {
  const bookingSiteUrl = trimTrailingSlash(business?.booking_site_url);
  if (bookingSiteUrl) return bookingSiteUrl;
  if (business?.subdomain) return "https://" + business.subdomain + ".booking.bookingtours.co.za";
  return "";
}

export function resolveManageBookingsUrl(business?: TenantBusiness | null): string {
  if (business?.manage_bookings_url) return String(business.manage_bookings_url);
  const siteUrl = resolveBookingSiteUrl(business);
  if (siteUrl) return siteUrl + "/my-bookings";
  return "";
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
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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
  let normalizedTo = String(to || "").replace(/\D/g, "");
  if (normalizedTo.startsWith("0")) normalizedTo = "27" + normalizedTo.substring(1);

  const components = bodyParams.length > 0
    ? [{ type: "body", parameters: bodyParams.map(function (text) { return { type: "text", text: String(text) }; }) }]
    : [];

  const res = await fetch("https://graph.facebook.com/v19.0/" + tenant.credentials.waPhoneId + "/messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + tenant.credentials.waToken, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: normalizedTo,
      type: "template",
      template: { name: templateName, language: { code: languageCode }, components },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(data?.error?.message || "WhatsApp template send failed: " + templateName));
  return data;
}

// Send a free-form WhatsApp text message.
// If the customer is outside the 24-hour window (error 131047 / 131026) and
// a templateFallback is provided, the template is sent instead so the message
// still reaches the customer.
/**
 * Try to send a free-form WhatsApp message. Unlike sendWhatsappTextForTenant,
 * this does NOT auto-fallback to a template — it reports whether the 24-hour
 * customer-initiated-conversation window is closed, so callers can implement
 * "send reopener template + queue full message" patterns (e.g. cancellations).
 */
export async function sendWhatsappFreeformOrSignal(
  tenant: TenantContext | { business: TenantBusiness; credentials: TenantCredentials },
  to: string,
  message: string,
): Promise<{ ok: boolean; windowClosed: boolean; error: string; messageId?: string }> {
  if (!tenant.credentials.waToken || !tenant.credentials.waPhoneId) {
    return { ok: false, windowClosed: false, error: "WhatsApp not configured for this business" };
  }
  let normalizedTo = String(to || "").replace(/\D/g, "");
  if (normalizedTo.startsWith("0")) normalizedTo = "27" + normalizedTo.substring(1);
  try {
    const res = await fetch("https://graph.facebook.com/v19.0/" + tenant.credentials.waPhoneId + "/messages", {
      method: "POST",
      headers: { Authorization: "Bearer " + tenant.credentials.waToken, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: normalizedTo, type: "text", text: { body: message } }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errCode = data?.error?.code;
      const windowClosed = errCode === 131047 || errCode === 131026;
      return { ok: false, windowClosed: windowClosed, error: String(data?.error?.message || data?.message || "send failed") };
    }
    const messageId = data?.messages?.[0]?.id || undefined;
    return { ok: true, windowClosed: false, error: "", messageId };
  } catch (e: any) {
    return { ok: false, windowClosed: false, error: String(e?.message || e) };
  }
}

/**
 * Two-step cancellation / urgent-update WhatsApp flow.
 *
 * If the 24-hour customer service window is OPEN → sends `full_message` directly as free-form text.
 * If the window is CLOSED → sends a pre-approved reopener template (default name:
 *   `booking_update_reopener`, override via WA_REOPENER_TEMPLATE_NAME env var; parameters are
 *   [customer_first_name, brand_name]) AND queues the full message in `outbox` with
 *   status='WAITING_WINDOW'. The message is sent the moment the customer replies (see the
 *   drain block in wa-webhook — keyed on phone + business_id).
 *
 * Intended for time-sensitive cancellation/reschedule notifications where we want the customer
 * to see the FULL details with a working manage-bookings link, not just a generic template.
 *
 * Returns { sent: 'direct' | 'template', queued: boolean }.
 */
export async function sendWhatsappWithWindowReopen(
  supabase: any,
  tenant: TenantContext,
  params: {
    to: string;
    booking_id?: string | null;
    full_message: string;
    customer_first_name: string;
  },
): Promise<{ sent: "direct" | "template"; queued: boolean }> {
  const res = await sendWhatsappFreeformOrSignal(tenant, params.to, params.full_message);
  if (res.ok) {
    return { sent: "direct", queued: false };
  }
  if (!res.windowClosed) {
    // Not a window-closed error — rethrow so caller can log/alert.
    throw new Error("WhatsApp send failed: " + res.error);
  }

  // Window closed → send reopener template + queue full message for later drain.
  const reopenerTemplateName = Deno.env.get("WA_REOPENER_TEMPLATE_NAME") || "booking_update_reopener";
  const brandName = getBusinessDisplayName(tenant.business);
  const firstName = params.customer_first_name || "there";
  try {
    await sendWhatsappTemplate(tenant, params.to, reopenerTemplateName, [firstName, brandName]);
  } catch (templateErr: any) {
    // Template not approved / rejected / missing variables — fall back to the original
    // sendWhatsappTextForTenant path so caller still attempts something. Rethrow so caller
    // can log; cancellation emails are independent and will still go out.
    throw new Error("Reopener template send failed (" + reopenerTemplateName + "): " + (templateErr?.message || templateErr));
  }

  let normalizedTo = String(params.to || "").replace(/\D/g, "");
  if (normalizedTo.startsWith("0")) normalizedTo = "27" + normalizedTo.substring(1);
  await supabase.from("outbox").insert({
    business_id: tenant.business.id,
    booking_id: params.booking_id || null,
    phone: normalizedTo,
    message_type: "CANCEL_FOLLOWUP",
    message_body: params.full_message,
    scheduled_for: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // far future; drained on reply
    status: "WAITING_WINDOW",
  });
  return { sent: "template", queued: true };
}

export async function sendWhatsappTextForTenant(
  tenant: TenantContext | { business: TenantBusiness; credentials: TenantCredentials },
  to: string,
  message: string,
  templateFallback?: { name: string; params: string[]; language?: string },
) {
  // Guard: fail fast with a clear message instead of a malformed API call
  if (!tenant.credentials.waToken || !tenant.credentials.waPhoneId) {
    const bName = getBusinessDisplayName(tenant.business);
    throw new Error(
      "WhatsApp is not configured for " + bName + ". " +
      "Please add the Access Token and Phone Number ID in Admin → Settings → Integration Credentials."
    );
  }
  let normalizedTo = String(to || "").replace(/\D/g, "");
  if (normalizedTo.startsWith("0")) normalizedTo = "27" + normalizedTo.substring(1);
  const res = await fetch("https://graph.facebook.com/v19.0/" + tenant.credentials.waPhoneId + "/messages", {
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
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errCode = data?.error?.code;
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
