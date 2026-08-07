// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { Webhook } from "npm:standardwebhooks";
import { withSentry } from "../_shared/sentry.ts";
import { getWaiverContext } from "../_shared/waiver.ts";
import { formatTenantDateTime, getAdminAppOrigins, isAllowedOrigin } from "../_shared/tenant.ts";
import { tourEndDate } from "../_shared/duration.ts";
import { fillMarketingTokens } from "../_shared/marketing-tokens.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const SETTINGS_ENCRYPTION_KEY = Deno.env.get("SETTINGS_ENCRYPTION_KEY") || "";
// Auth Hook secret — set in Supabase Auth → Hooks → Send Email Hook. When this
// is set, send-email accepts inbound Auth Hook payloads (magic-link / signup /
// recovery) signed via Supabase's standard-webhooks scheme. Inbound requests
// without a valid signature are rejected 401 to prevent arbitrary magic-link
// emails. Standard internal callers (with {type, data}) ignore this entirely.
const SEND_EMAIL_HOOK_SECRET = Deno.env.get("SEND_EMAIL_HOOK_SECRET") || "";
// Platform-wide default sender — uses bookingtours.co.za which is verified in Resend.
// Per-tenant emails auto-derive from subdomain: noreply@{slug}.bookingtours.co.za
// Safety: refuse to send from the Resend developer sandbox even if the env
// var got pasted with `onboarding@resend.dev`. That domain rate-limits hard
// and routes straight to spam for many providers. Always fall through to the
// platform-verified address when the env is missing or pointing at sandbox.
const RAW_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "";
const FROM_EMAIL = RAW_FROM_EMAIL && !/onboarding@resend\.dev|@resend\.dev/i.test(RAW_FROM_EMAIL)
  ? RAW_FROM_EMAIL
  : "BookingTours <noreply@bookingtours.co.za>";
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;
console.log("SEND_EMAIL_INIT supabase=" + (supabase ? "OK" : "NULL") + " url=" + (SUPABASE_URL ? "set" : "MISSING") + " key=" + (SUPABASE_SERVICE_ROLE_KEY ? "set" : "MISSING"));

function getCors(req?: Request) {
  const origins = getAdminAppOrigins();
  const origin = req?.headers?.get("origin") || "";
  const allowed = isAllowedOrigin(origin, origins) ? origin : origins[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-business-id, x-tenant-subdomain, x-tenant-origin, x-voucher-code, x-booking-success-token, x-booking-id, x-booking-waiver-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

// Basic email format validation — catches obviously malformed addresses before hitting the API
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// NOTE: For production bounce/complaint handling, configure a Resend webhook endpoint
// (POST /functions/v1/resend-webhook) to receive bounce, complaint, and delivery events.
// See: https://resend.com/docs/dashboard/webhooks/introduction
// This lets you mark bad emails in the database and stop future sends to them.

async function sendResend(to: string, fromEmail: string, subject: string, html: string, bcc?: string, attachments?: Array<{ filename: string; content: string }>, replyTo?: string, unsubscribeUrl?: string): Promise<{ ok: boolean; id?: string; status?: number; error?: string; message?: string }> {
  // Validate email format before attempting to send
  if (!to || !isValidEmail(to)) {
    console.warn("RESEND_SKIP invalid email format: to=" + to + " subject=" + subject);
    return { ok: false, error: "invalid_email_format", message: "Email address '" + to + "' has an invalid format" };
  }
  // Always send FROM a platform-controlled domain to pass DMARC/SPF.
  // The tenant's email goes in Reply-To so customers reply to the right place.
  // Every send here was HTML-only, no plain-text MIME alternative — a real
  // (if secondary, next to SPF/DMARC — see DNS note in project docs) spam
  // scoring factor, and Resend derives it automatically when omitted, so a
  // simple tag-stripped fallback costs nothing and removes the gap.
  const text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const payload: Record<string, unknown> = { from: fromEmail || FROM_EMAIL, to: [to], subject, html, text };
  if (replyTo && isValidEmail(replyTo)) payload.reply_to = replyTo;
  if (bcc) payload.bcc = [bcc];
  if (attachments && attachments.length > 0) payload.attachments = attachments;
  // RFC 8058 one-click List-Unsubscribe — mailbox providers (Gmail, Apple Mail,
  // Yahoo) now require this for bulk mail to land in the inbox. Only set when
  // the caller passed a token URL so transactional sends stay clean.
  if (unsubscribeUrl) {
    payload.headers = {
      "List-Unsubscribe": "<" + unsubscribeUrl + ">",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
  }
  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (netErr) {
    console.error("RESEND_NETWORK_ERR to=" + to + ":", netErr);
    return { ok: false, error: "network_error", message: String(netErr) };
  }
  const data = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) {
    console.error("RESEND_ERR status=" + res.status + " from=" + (fromEmail || FROM_EMAIL) + " to=" + to + " subject=" + subject + ":", JSON.stringify(data));
    if ((data as any)?.name === "validation_error") {
      console.warn("RESEND_VALIDATION_FAIL to=" + to + ": " + ((data as any)?.message || "unknown validation error"));
    }
    if (res.status === 422) {
      console.warn("RESEND_BOUNCE_LIKELY to=" + to + " — address may be invalid or previously bounced");
    }
    return {
      ok: false,
      status: res.status,
      error: (data as any)?.name || "resend_error",
      message: (data as any)?.message || ("HTTP " + res.status),
    };
  }
  console.log("RESEND_OK id=" + (data as any)?.id + " to=" + to + " subject=" + subject);
  return { ok: true, id: (data as any)?.id };
}

// Default email images — empty means no image shown unless business uploads one via Settings
const IMG_PAYMENT = "";
const IMG_CONFIRM = "";
const IMG_INVOICE = "";
const IMG_GIFT = "";
const IMG_CANCEL_GENERAL = "";
const IMG_CANCEL_WEATHER = "";
const IMG_INDEMNITY = "";
const IMG_ADMIN = "";
const IMG_VOUCHER = "";
const IMG_PHOTOS = "";

const SQ_IMG_STYLE = "width: 100%; max-width: 540px; border-radius: 12px; display: block; margin: 0 auto;";

// Render hero image placeholder — uses {{IMG_KEY}} markers that get resolved after branding
function heroImg(key: string, alt: string, bgColor = "#1b3b36") {
  return `<!--HERO_IMG:${key}:${bgColor}:${alt}-->`;
}

const MANAGE_BOOKING_URL = "";

async function enrichWaiverEmailData(d: Record<string, unknown>) {
  if (!supabase) return d;
  try {
    const ctx = await getWaiverContext(supabase, {
      businessId: String(d.business_id || ""),
      bookingId: String(d.booking_id || ""),
      waiverStatus: String(d.waiver_status || ""),
      waiverToken: String(d.waiver_token || ""),
    });
    return {
      ...d,
      waiver_status: d.waiver_status || ctx.waiverStatus,
      waiver_url: d.waiver_url || ctx.waiverLink,
    };
  } catch (error) {
    console.error("WAIVER_EMAIL_CONTEXT_ERR:", error);
    return d;
  }
}

async function resolveBrandingBusinessId(d: Record<string, unknown>) {
  const directBusinessId = String(d.business_id || "").trim();
  if (directBusinessId) return directBusinessId;
  if (!supabase) return "";

  const bookingId = String(d.booking_id || "").trim();
  if (bookingId) {
    const bookingRes = await supabase.from("bookings").select("business_id").eq("id", bookingId).maybeSingle();
    if (bookingRes.data?.business_id) return String(bookingRes.data.business_id);
  }

  const invoiceNumber = String(d.invoice_number || "").trim();
  if (invoiceNumber) {
    const invoiceRes = await supabase.from("invoices").select("business_id").eq("invoice_number", invoiceNumber).maybeSingle();
    if (invoiceRes.data?.business_id) return String(invoiceRes.data.business_id);
  }

  return "";
}

function deriveAccentColor(hex: string): string {
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  // Blend 60% toward white for a muted light accent
  r = Math.round(r + (255 - r) * 0.6);
  g = Math.round(g + (255 - g) * 0.6);
  b = Math.round(b + (255 - b) * 0.6);
  return "#" + [r, g, b].map(c => c.toString(16).padStart(2, "0")).join("");
}

async function loadEmailBranding(d: Record<string, unknown>) {
  const businessId = await resolveBrandingBusinessId(d);
  console.log("BRANDING_RESOLVE bizId=" + businessId + " supabase=" + (supabase ? "OK" : "NULL") + " d.business_id=" + d.business_id);
  if (!businessId || !supabase) {
    console.warn("BRANDING_FALLBACK: no businessId or no supabase client");
    const fallbackBrand = String(d.business_name || d.brand_name || "Your Booking");
    return {
      businessId: "",
      brandName: fallbackBrand,
      timezone: "UTC",
      shortBrandName: fallbackBrand,
      footerLineOne: "Thanks for choosing our team.",
      footerLineTwo: "Reply to this email if you need anything.",
      manageBookingUrl: String(d.manage_bookings_url || ""),
      bookingSiteUrl: String(d.booking_site_url || ""),
      voucherUrl: String(d.gift_voucher_url || d.booking_site_url || ""),
      waiverUrl: String(d.waiver_url || ""),
      directions: String(d.directions || ""),
      fromEmail: FROM_EMAIL,
      replyToEmail: "",
      emailColor: "#1b3b36",
      imgPayment: "", imgConfirm: "", imgInvoice: "", imgGift: "", imgCancel: "", imgCancelWeather: "", imgIndemnity: "", imgAdmin: "", imgVoucher: "", imgPhotos: "",
      socialFacebook: "", socialInstagram: "", socialTiktok: "", socialYoutube: "", socialTwitter: "", socialLinkedin: "", socialTripadvisor: "", socialGoogleReviews: "",
      meetingPointAddress: "", arrivalInstructions: "", businessAddress: "", whatToBring: "", activityVerbPast: "", emailTagline: "", logoUrl: "",
    };
  }

  let data: Record<string, unknown> | null = null;
  try {
    const res = await supabase
      .from("businesses")
      .select("id, name, business_name, subdomain, timezone, notification_email, footer_line_one, footer_line_two, manage_bookings_url, booking_site_url, gift_voucher_url, waiver_url, directions, email_color, email_img_payment, email_img_confirm, email_img_invoice, email_img_gift, email_img_cancel, email_img_cancel_weather, email_img_indemnity, email_img_admin, email_img_voucher, email_img_photos, social_facebook, social_instagram, social_tiktok, social_youtube, social_twitter, social_linkedin, social_tripadvisor, social_google_reviews, meeting_point_address, arrival_instructions, business_address, what_to_bring, activity_verb_past, location_phrase, email_tagline, logo_url")
      .eq("id", businessId)
      .maybeSingle();
    data = res.data;
    console.log("BRANDING_QUERY_OK data=" + (data ? "found" : "null") + " manage=" + data?.manage_bookings_url + " site=" + data?.booking_site_url + " sub=" + data?.subdomain);
  } catch (brandErr) {
    console.warn("BRANDING_QUERY_ERR (will use fallbacks):", brandErr);
    // Try a simpler query without the email_img columns in case they don't exist yet
    try {
      const res2 = await supabase
        .from("businesses")
        .select("id, name, business_name, timezone, notification_email, footer_line_one, footer_line_two, manage_bookings_url, booking_site_url, gift_voucher_url, waiver_url, directions")
        .eq("id", businessId)
        .maybeSingle();
      data = res2.data;
    } catch (fallbackErr) {
      console.warn("BRANDING_FALLBACK_QUERY_ERR:", fallbackErr);
    }
  }

  const brandName = String(data?.business_name || data?.name || d.business_name || d.brand_name || "Your Booking");
  return {
    businessId,
    brandName,
    timezone: String((data as Record<string, unknown> | null)?.timezone || "UTC"),
    shortBrandName: brandName,
    footerLineOne: String(data?.footer_line_one || "Thanks for choosing " + brandName + "."),
    footerLineTwo: String(data?.footer_line_two || "Reply to this email if you need anything."),
    manageBookingUrl: String(data?.manage_bookings_url || d.manage_bookings_url || (data?.booking_site_url ? String(data.booking_site_url).replace(/\/+$/, "") + "/my-bookings" : (data?.subdomain ? "https://" + data.subdomain + ".booking.bookingtours.co.za/my-bookings" : ""))),
    bookingSiteUrl: String(data?.booking_site_url || d.booking_site_url || (data?.subdomain ? "https://" + data.subdomain + ".booking.bookingtours.co.za" : "")),
    voucherUrl: String(data?.gift_voucher_url || d.gift_voucher_url || (data?.booking_site_url ? String(data.booking_site_url).replace(/\/+$/, "") + "/gift-voucher" : (data?.subdomain ? "https://" + data.subdomain + ".booking.bookingtours.co.za/gift-voucher" : ""))),
    waiverUrl: String(data?.waiver_url || d.waiver_url || ""),
    directions: String(data?.directions || d.directions || ""),
    // Use the verified root domain for the envelope and pass the tenant brand
    // in the display name. Per-subdomain From requires the subdomain to be
    // added + DNS-verified in Resend, which isn't done per tenant — so until
    // each tenant verifies its own subdomain, sending from there gets a 403
    // "domain not verified" and the email never goes out.
    fromEmail: brandName
      ? brandName + " <noreply@bookingtours.co.za>"
      : FROM_EMAIL,
    // Reply-To uses the tenant's notification_email so customer replies go to the right place
    replyToEmail: String(data?.notification_email || ""),
    emailColor: String(data?.email_color || "#1b3b36"),
    imgPayment: String(data?.email_img_payment || ""),
    imgConfirm: String(data?.email_img_confirm || ""),
    imgInvoice: String(data?.email_img_invoice || ""),
    imgGift: String(data?.email_img_gift || ""),
    imgCancel: String(data?.email_img_cancel || ""),
    imgCancelWeather: String(data?.email_img_cancel_weather || ""),
    imgIndemnity: String(data?.email_img_indemnity || ""),
    imgAdmin: String(data?.email_img_admin || ""),
    imgVoucher: String(data?.email_img_voucher || ""),
    imgPhotos: String(data?.email_img_photos || ""),
    socialFacebook: String(data?.social_facebook || ""),
    socialInstagram: String(data?.social_instagram || ""),
    socialTiktok: String(data?.social_tiktok || ""),
    socialYoutube: String(data?.social_youtube || ""),
    socialTwitter: String(data?.social_twitter || ""),
    socialLinkedin: String(data?.social_linkedin || ""),
    socialTripadvisor: String(data?.social_tripadvisor || ""),
    socialGoogleReviews: String(data?.social_google_reviews || ""),
    meetingPointAddress: String(data?.meeting_point_address || ""),
    arrivalInstructions: String(data?.arrival_instructions || ""),
    businessAddress: String(data?.business_address || ""),
    whatToBring: String(data?.what_to_bring || ""),
    activityVerbPast: String(data?.activity_verb_past || ""),
    emailTagline: String(data?.email_tagline || ""),
    logoUrl: String(data?.logo_url || ""),
  };
}

type InvoiceContext = {
  companyName: string;
  addressLines: string[];
  reg: string;
  vat: string;
  logoUrl: string;
  bank: {
    account_owner: string | null;
    account_number: string | null;
    account_type: string | null;
    bank_name: string | null;
    branch_code: string | null;
  };
};

async function getInvoiceContext(businessId: string): Promise<InvoiceContext> {
  const empty: InvoiceContext = {
    companyName: "",
    addressLines: [],
    reg: "",
    vat: "",
    logoUrl: "",
    bank: { account_owner: null, account_number: null, account_type: null, bank_name: null, branch_code: null },
  };
  if (!businessId || !supabase) return empty;

  const { data: biz } = await supabase
    .from("businesses")
    .select("business_name, invoice_company_name, invoice_address_line1, invoice_address_line2, invoice_address_line3, invoice_reg_number, invoice_vat_number, logo_url")
    .eq("id", businessId)
    .maybeSingle();

  const companyName = String(biz?.invoice_company_name || biz?.business_name || "");
  const addressLines = [biz?.invoice_address_line1, biz?.invoice_address_line2, biz?.invoice_address_line3].filter(Boolean) as string[];
  const reg = String(biz?.invoice_reg_number || "");
  const vat = String(biz?.invoice_vat_number || "");
  const logoUrl = String(biz?.logo_url || "");

  let bank = empty.bank;
  if (SETTINGS_ENCRYPTION_KEY) {
    try {
      const { data: bankRows } = await supabase.rpc("get_business_bank_details", {
        p_business_id: businessId,
        p_key: SETTINGS_ENCRYPTION_KEY,
      });
      const row = Array.isArray(bankRows) ? bankRows[0] : bankRows;
      if (row) {
        bank = {
          account_owner: row.account_owner || null,
          account_number: row.account_number || null,
          account_type: row.account_type || null,
          bank_name: row.bank_name || null,
          branch_code: row.branch_code || null,
        };
      }
    } catch (bankErr) {
      console.error("INVOICE_BANK_DETAILS_ERR:", bankErr);
    }
  } else {
    console.warn("INVOICE_CONTEXT: SETTINGS_ENCRYPTION_KEY not set, skipping bank details");
  }

  return { companyName, addressLines, reg, vat, logoUrl, bank };
}

// BookingTours' own logo + bank details (platform_settings singleton) — used
// only by PLATFORM_INVOICE_OUTSTANDING, which must look like it's FROM
// BookingTours TO the operator, never resolving the operator's own branding.
type PlatformInvoiceContext = {
  logoUrl: string;
  bank: InvoiceContext["bank"];
};

async function getPlatformInvoiceContext(): Promise<PlatformInvoiceContext> {
  const empty: PlatformInvoiceContext = {
    logoUrl: "",
    bank: { account_owner: null, account_number: null, account_type: null, bank_name: null, branch_code: null },
  };
  if (!supabase) return empty;

  const { data: settings } = await supabase.from("platform_settings").select("logo_url").eq("id", true).maybeSingle();
  const logoUrl = String(settings?.logo_url || "");

  let bank = empty.bank;
  if (SETTINGS_ENCRYPTION_KEY) {
    try {
      const { data: bankRows } = await supabase.rpc("get_platform_bank_details", { p_key: SETTINGS_ENCRYPTION_KEY });
      const row = Array.isArray(bankRows) ? bankRows[0] : bankRows;
      if (row) {
        bank = {
          account_owner: row.account_owner || null,
          account_number: row.account_number || null,
          account_type: row.account_type || null,
          bank_name: row.bank_name || null,
          branch_code: row.branch_code || null,
        };
      }
    } catch (bankErr) {
      console.error("PLATFORM_INVOICE_BANK_DETAILS_ERR:", bankErr);
    }
  }

  return { logoUrl, bank };
}

function buildSocialIconsHtml(branding: { socialFacebook: string; socialInstagram: string; socialTiktok: string; socialYoutube: string; socialTwitter: string; socialLinkedin: string; socialTripadvisor: string; socialGoogleReviews: string; emailColor?: string }) {
  // Platform ICON images, not names. Inline <svg> is stripped by Gmail/
  // Outlook/Yahoo, and data: URIs are blocked by Gmail — so we use hosted
  // PNG favicons via Google's s2 favicon service (plain <img>, renders
  // everywhere, nothing for us to host). alt text keeps the platform name
  // for screen readers and image-blocking clients.
  const links: string[] = [];
  const icon = (href: string, domain: string, name: string) =>
    `<a href="${href}" target="_blank" style="text-decoration: none;"><img src="https://www.google.com/s2/favicons?domain=${domain}&sz=64" alt="${name}" width="22" height="22" style="width: 22px; height: 22px; border-radius: 5px; vertical-align: middle; border: 0;" /></a>`;

  if (branding.socialFacebook) links.push(icon(branding.socialFacebook, "facebook.com", "Facebook"));
  if (branding.socialInstagram) links.push(icon(branding.socialInstagram, "instagram.com", "Instagram"));
  if (branding.socialTiktok) links.push(icon(branding.socialTiktok, "tiktok.com", "TikTok"));
  if (branding.socialYoutube) links.push(icon(branding.socialYoutube, "youtube.com", "YouTube"));
  if (branding.socialTwitter) links.push(icon(branding.socialTwitter, "x.com", "X / Twitter"));
  if (branding.socialLinkedin) links.push(icon(branding.socialLinkedin, "linkedin.com", "LinkedIn"));
  if (branding.socialTripadvisor) links.push(icon(branding.socialTripadvisor, "tripadvisor.com", "TripAdvisor"));
  if (branding.socialGoogleReviews) links.push(icon(branding.socialGoogleReviews, "google.com", "Google Reviews"));

  if (links.length === 0) return "";
  const separator = `<span style="display: inline-block; width: 12px;">&nbsp;</span>`;
  return `<table cellpadding="0" cellspacing="0" style="margin: 14px auto 0;"><tr><td style="text-align: center;">${links.join(separator)}</td></tr></table>`;
}

function applyBranding(subject: string, html: string, branding: Awaited<ReturnType<typeof loadEmailBranding>>) {
  let brandedHtml = html;

  // Safety: NEVER produce empty URLs — Gmail strips href="" making buttons unclickable
  const fallbackUrl = "https://bookingtours.co.za";
  const safeManageUrl = branding.manageBookingUrl || (branding.bookingSiteUrl ? branding.bookingSiteUrl.replace(/\/+$/, "") + "/my-bookings" : fallbackUrl);
  const safeBookingUrl = branding.bookingSiteUrl || fallbackUrl;
  if (safeManageUrl === fallbackUrl) {
    console.warn("BRANDING_WARN: manageBookingUrl is empty for business=" + branding.businessId + " brandName=" + branding.brandName + " — using fallback");
  }

  const replacements: Array<[string, string]> = [
    ["Cape Kayak Adventures", branding.brandName],
    ["Cape Kayak Adventure", branding.brandName],
    ["Cape Kayak Admin Dashboard", branding.brandName + " Admin Dashboard"],
    ["Cape Kayak Admin", branding.brandName + " Admin"],
    ["Cape Kayak", branding.shortBrandName],
    ["{{BOOKING_URL}}/my-bookings", safeManageUrl],
    ["{{BOOKING_URL}}", safeBookingUrl],
  ];

  for (let i = 0; i < replacements.length; i++) {
    brandedHtml = brandedHtml.split(replacements[i][0]).join(replacements[i][1]);
  }

  if (branding.voucherUrl) {
    brandedHtml = brandedHtml.split("book at {{BOOKING_URL}}").join("book at " + branding.voucherUrl);
  }
  // Always replace hardcoded address with business-specific footer lines
  brandedHtml = brandedHtml
    .split("Three Anchor Bay, Sea Point, Cape Town<br>\n            If you have any questions, reply to this email or contact us on WhatsApp.")
    .join(branding.footerLineOne + "<br>\n            " + branding.footerLineTwo)
    .split("Three Anchor Bay, Sea Point, Cape Town<br>Book at {{BOOKING_URL}} or WhatsApp us.")
    .join(branding.footerLineOne + "<br>" + (branding.bookingSiteUrl ? "Book at " + branding.bookingSiteUrl + " or reply to this email." : branding.footerLineTwo))
    .split("Three Anchor Bay, Sea Point, Cape Town<br>\n            Thank you for adventuring with us!")
    .join(branding.footerLineOne + "<br>\n            " + branding.footerLineTwo)
    .split("Three Anchor Bay, Sea Point, Cape Town<br>\n            Book at {{BOOKING_URL}} or WhatsApp us.")
    .join(branding.footerLineOne + "<br>\n            " + branding.footerLineTwo)
    .split("Three Anchor Bay, Sea Point, Cape Town")
    .join(branding.footerLineOne)
    .split("Cape Kayak Adventures, 180 Beach Rd, Three Anchor Bay")
    .join(branding.brandName + (branding.directions ? ", " + branding.directions : ""))
    .split("180 Beach Rd, Three Anchor Bay<br>\n              Cape Town, 8005")
    .join(branding.directions || branding.footerLineOne)
    .split("180 Beach Rd, Three Anchor Bay")
    .join(branding.directions || branding.footerLineOne)
    .split("179 Beach Road Three Anchor Bay")
    .join(branding.directions || branding.footerLineOne)
    .split("Cape Town, 8005")
    .join("")
    .split("Cape Town<br>8005")
    .join("");

  // Replace arrival instructions + what-to-bring (Prompt 23). Always runs:
  // an unconfigured tenant gets a neutral line, never the kayak-specific default.
  brandedHtml = brandedHtml
    .split("Please arrive 15 minutes before launch.<br>Bring sunscreen, a hat, a towel, and a water bottle.")
    .join((branding.arrivalInstructions || "Please arrive 15 minutes early.") + (branding.whatToBring ? "<br>" + branding.whatToBring : ""));

  // Replace Google Reviews URL (Prompt 23) — or strip the review ask entirely
  // for tenants with no review link configured; never ship Cape Kayak's Place ID.
  if (branding.socialGoogleReviews) {
    brandedHtml = brandedHtml
      .split("https://search.google.com/local/writereview?placeid=ChIJ9a9I09RHzB0Rh9R8O4pM7aQ")
      .join(branding.socialGoogleReviews);
  } else {
    brandedHtml = brandedHtml
      .split("Had a great time? We'd love it if you could leave us a quick review on Google. It means the world to our small team!")
      .join("We hope you had a great time — see you again soon!")
      .split(`<a href="https://search.google.com/local/writereview?placeid=ChIJ9a9I09RHzB0Rh9R8O4pM7aQ" style="display: inline-block; background-color: #ffffff; color: #2a5a52; border: 2px solid #2a5a52; text-decoration: none; padding: 12px 30px; border-radius: 8px; font-size: 15px; font-weight: bold;">⭐ Leave a Google Review</a>`)
      .join("");
  }

  // Operator logo in every email header: inject above the eyebrow line.
  // One mechanism for all templates (the invoice's own inline logo was removed
  // in favour of this).
  if (branding.logoUrl) {
    const eyebrowTag = '<p style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #A8C2B8;">';
    brandedHtml = brandedHtml.split(eyebrowTag).join(
      `<img src="${branding.logoUrl}" alt="" style="max-height: 48px; max-width: 180px; margin: 0 auto 12px; display: block;" />` + eyebrowTag,
    );
  }

  // Replace activity verb (Prompt 23)
  brandedHtml = brandedHtml
    .split("Thank you for paddling with")
    .join("Thank you for " + (branding.activityVerbPast || "adventuring") + " with")
    // Trip-photos email: drop the water-specific suffix for non-water operators
    .split("We hope you had an incredible time on the water")
    .join("We hope you had an incredible time");

  // Maps button: point at the tenant's own location, falling back through their
  // configured address fields; tenants with no location get the button STRIPPED
  // rather than Cape Kayak's pin.
  const mapsQuery = branding.directions || branding.meetingPointAddress || branding.businessAddress;
  if (mapsQuery) {
    brandedHtml = brandedHtml.split("https://www.google.com/maps/search/?api=1&query=Cape+Kayak+Adventures+180+Beach+Rd+Three+Anchor+Bay+Cape+Town+8005").join(
      "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(mapsQuery)
    );
  } else {
    brandedHtml = brandedHtml
      .split(`<a href="https://www.google.com/maps/search/?api=1&query=Cape+Kayak+Adventures+180+Beach+Rd+Three+Anchor+Bay+Cape+Town+8005" style="display: inline-block; background-color: #1b3b36; color: #fff; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-size: 14px; font-weight: bold; margin-bottom: 15px;">Open in Google Maps</a>`)
      .join("");
  }

  // Inject the dark-footer extras: social icons (per-operator, optional) and
  // a "Powered by BookingTours" line. The powered-by line is intentionally
  // NOT one of the ordinary per-tenant `branding` fields above — it isn't
  // read from any business setting, so no operator config can omit or
  // override it, and it must render even when a tenant has zero social links.
  const socialHtml = buildSocialIconsHtml(branding);
  // The mark carries alt="" and sits beside the text rather than replacing it:
  // most clients block remote images by default, and a blocked decorative image
  // collapses to nothing while "Powered by BookingTours" still reads. Ivory
  // variant because this footer is dark. Hosted on the customer-facing booking
  // domain (4 KB asset — this ships on every transactional email).
  const poweredByHtml = `<table cellpadding="0" cellspacing="0" style="width:100%;"><tr><td style="text-align:center; padding-top:14px; margin-top:14px; border-top:1px solid rgba(255,255,255,0.14);"><p style="margin:0; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; font-size:11px; letter-spacing:0.02em; color:#A8C2B8;"><img src="https://booking.bookingtours.co.za/brand/bt-mark-email.png" alt="" width="11" height="14" style="height:14px; width:auto; vertical-align:-3px; margin-right:6px; border:0;" />Powered by <a href="https://bookingtours.co.za" style="color:#ffffff; font-weight:600; text-decoration:none;">BookingTours</a></p></td></tr></table>`;
  const footerExtras = socialHtml + poweredByHtml;
  {
    // Find the footer </td> — it's the last </td> before </body>
    const bodyClose = brandedHtml.lastIndexOf("</body>");
    if (bodyClose > -1) {
      const footerTdClose = brandedHtml.lastIndexOf("</td>", bodyClose);
      if (footerTdClose > -1) {
        brandedHtml = brandedHtml.slice(0, footerTdClose) + "\n            " + footerExtras + "\n          " + brandedHtml.slice(footerTdClose);
      } else {
        // No table-footer to anchor to — still guarantee the line renders.
        brandedHtml = brandedHtml.slice(0, bodyClose) + footerExtras + brandedHtml.slice(bodyClose);
      }
    } else {
      brandedHtml += footerExtras;
    }
  }

  // Resolve hero image markers — show uploaded image or remove the block entirely
  const imgMap: Record<string, string> = {
    IMG_PAYMENT: branding.imgPayment,
    IMG_CONFIRM: branding.imgConfirm,
    IMG_INVOICE: branding.imgInvoice,
    IMG_GIFT: branding.imgGift,
    IMG_CANCEL: branding.imgCancel,
    IMG_CANCEL_WEATHER: branding.imgCancelWeather,
    IMG_INDEMNITY: branding.imgIndemnity,
    IMG_ADMIN: branding.imgAdmin,
    IMG_VOUCHER: branding.imgVoucher,
    IMG_PHOTOS: branding.imgPhotos,
  };
  brandedHtml = brandedHtml.replace(/<!--HERO_IMG:(\w+):([^:]*):([^>]*)-->/g, (_match, key, bgColor, alt) => {
    const url = imgMap[key] || "";
    if (!url) return "";
    return `<tr><td style="background-color: ${bgColor}; padding: 0 30px 30px; text-align: center;"><img src="${url}" alt="${alt}" style="${SQ_IMG_STYLE}" /></td></tr>`;
  });

  // Replace email brand color
  if (branding.emailColor && branding.emailColor !== "#1b3b36") {
    const accent = deriveAccentColor(branding.emailColor);
    brandedHtml = brandedHtml.split("#1b3b36").join(branding.emailColor);
    brandedHtml = brandedHtml.split("#A8C2B8").join(accent);
  }

  const brandedSubject = subject
    .replace(/^Cape Kayak Admin\b/, branding.brandName + " Admin")
    .replace(/^Cape Kayak\b/, branding.brandName);

  return { subject: brandedSubject, html: brandedHtml };
}

function paymentLinkHtml(d: Record<string, unknown>) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #F7F7F6; margin: 0; padding: 20px; color: #333;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);">
        <!-- Hero Banner -->
        <tr>
          <td style="background-color: #1b3b36; padding: 30px 30px 20px; text-align: center;">
            <p style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #A8C2B8;">Cape Kayak Adventures</p>
            <h1 style="margin: 10px 0 0 0; font-size: 30px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">${d.heading || "Complete Your Reservation"}</h1>
          </td>
        </tr>
        ${heroImg("IMG_PAYMENT", "Cape Kayak")}
        <!-- Content -->
        <tr>
          <td style="padding: 40px 40px 10px; text-align: center;">
            <h2 style="font-size: 24px; font-family: Georgia, serif; margin: 0 0 15px 0; color: #1b3b36;">Hi ${d.customer_name},</h2>
            <p style="font-size: 16px; line-height: 1.6; color: #555; margin: 0 0 30px 0;">${d.intro || ("You're almost there. Please complete your payment below to secure your spots for the <strong>" + d.tour_name + "</strong>.")}</p>
            ${d.cancel_phrase ? `<p style="font-size: 14px; line-height: 1.6; color: #B45309; background:#FEF3C7; border-radius:8px; padding:12px 16px; margin: 0 0 20px 0;">Heads up: if payment isn't made, this booking will be automatically cancelled about <strong>${d.cancel_phrase} before the trip</strong> so the spot can be released. Any trouble paying? Just reply to this email.</p>` : ""}
          </td>
        </tr>
        <!-- Details Box -->
        <tr>
          <td style="padding: 0 40px 30px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F7F7F6; border-radius: 8px;">
              <tr>
                <td width="40%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #888; font-size: 15px; font-weight: 400;">Reference:</td>
                <td width="60%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #1b3b36; font-size: 15px; font-weight: 400; text-align: right;">${d.ref}</td>
              </tr>
              <tr>
                <td width="40%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #888; font-size: 15px; font-weight: 400;">Date:</td>
                <td width="60%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #1b3b36; font-size: 15px; font-weight: 400; text-align: right;">${d.tour_date}</td>
              </tr>
              <tr>
                <td width="40%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #888; font-size: 15px; font-weight: 400;">Guests:</td>
                <td width="60%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #1b3b36; font-size: 15px; font-weight: 400; text-align: right;">${d.qty}</td>
              </tr>
              <tr>
                <td width="40%" style="padding: 18px 20px; color: #1b3b36; font-size: 16px; font-weight: 400;">Total Due:</td>
                <td width="60%" style="padding: 18px 20px; color: #1b3b36; font-size: 16px; font-weight: 400; text-align: right;">${String(d.total_amount).match(/^[0-9]/) ? "R" + d.total_amount : d.total_amount}</td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- CTA -->
        <tr>
          <td style="padding: 0 40px 40px; text-align: center;">
            <a href="${d.payment_url}" style="display: inline-block; background-color: #1b3b36; color: #ffffff !important; text-decoration: none; padding: 16px 32px; border-radius: 30px; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Pay Securely Now</a>
            <p style="font-size: 13px; color: #888; margin-top: 25px;">This payment link is unique to your booking and will expire.</p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background-color: #1b3b36; color: #A8C2B8; text-align: center; padding: 30px; font-size: 12px; line-height: 1.5;">
            Three Anchor Bay, Sea Point, Cape Town<br>
            If you have any questions, reply to this email or contact us on WhatsApp.
          </td>
        </tr>
      </table>
    </body>
    </html>`;
}

function voucherPaymentLinkHtml(d: Record<string, unknown>) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #F7F7F6; margin: 0; padding: 20px; color: #333;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);">
        <tr>
          <td style="background-color: #1b3b36; padding: 30px 30px 20px; text-align: center;">
            <p style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #A8C2B8;">Cape Kayak Adventures</p>
            <h1 style="margin: 10px 0 0 0; font-size: 30px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">Complete Voucher Payment</h1>
          </td>
        </tr>
        ${heroImg("IMG_PAYMENT", "Cape Kayak")}
        <tr>
          <td style="padding: 40px 40px 10px; text-align: center;">
            <h2 style="font-size: 24px; font-family: Georgia, serif; margin: 0 0 15px 0; color: #1b3b36;">Hi ${d.buyer_name},</h2>
            <p style="font-size: 16px; line-height: 1.6; color: #555; margin: 0 0 30px 0;">Please complete payment for the gift voucher for <strong>${d.recipient_name}</strong>. The voucher code will be emailed after payment is confirmed.</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 0 40px 30px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F7F7F6; border-radius: 8px;">
              <tr>
                <td width="45%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #888; font-size: 15px;">Voucher:</td>
                <td width="55%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #1b3b36; font-size: 15px; text-align: right;">${d.tour_name || "Gift Voucher"}</td>
              </tr>
              <tr>
                <td width="45%" style="padding: 18px 20px; color: #1b3b36; font-size: 16px;">Total Due:</td>
                <td width="55%" style="padding: 18px 20px; color: #1b3b36; font-size: 16px; text-align: right;">${String(d.total_amount).match(/^[0-9]/) ? "R" + d.total_amount : d.total_amount}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding: 0 40px 40px; text-align: center;">
            <a href="${d.payment_url}" style="display: inline-block; background-color: #1b3b36; color: #ffffff !important; text-decoration: none; padding: 16px 32px; border-radius: 30px; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Pay Securely Now</a>
          </td>
        </tr>
        <tr>
          <td style="background-color: #1b3b36; color: #A8C2B8; text-align: center; padding: 30px; font-size: 12px; line-height: 1.5;">
            Three Anchor Bay, Sea Point, Cape Town<br>
            If you have any questions, reply to this email or contact us on WhatsApp.
          </td>
        </tr>
      </table>
    </body>
    </html>`;
}

function bookingConfirmHtml(d: Record<string, unknown>) {
  const waiverPending = String(d.waiver_status || "PENDING") !== "SIGNED";
  const waiverUrl = String(d.waiver_url || "");
  // Use #1b3b36 / #A8C2B8 tokens so the post-processor at
  // line ~442 swaps them to the tenant's emailColor + derived accent.
  const waiverBlock = waiverPending && waiverUrl
    ? `
        <tr>
          <td style="padding: 0 40px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F7F7F6; border: 1px solid #A8C2B8; border-radius: 12px;">
              <tr>
                <td style="padding: 22px; text-align: center;">
                  <p style="margin: 0 0 8px 0; font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #1b3b36;">Action required</p>
                  <h3 style="margin: 0 0 10px 0; font-family: Georgia, serif; font-size: 22px; color: #1b3b36;">Complete your waiver</h3>
                  <p style="margin: 0 0 18px 0; font-size: 14px; color: #1b3b36; line-height: 1.6;">Please complete the waiver for this booking before the trip. The link covers the booking contact and the guests on this reservation.</p>
                  <a href="${waiverUrl}" style="display: inline-block; background-color: #1b3b36; color: #ffffff !important; text-decoration: none; padding: 12px 24px; border-radius: 999px; font-weight: 700; font-size: 13px; letter-spacing: 0.04em; text-transform: uppercase;">Sign waiver</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `
    : `
        <tr>
          <td style="padding: 0 40px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F7F7F6; border: 1px solid #A8C2B8; border-radius: 12px;">
              <tr>
                <td style="padding: 18px 22px; text-align: center;">
                  <p style="margin: 0; font-size: 14px; color: #1b3b36; line-height: 1.6;"><strong>Waiver status:</strong> Completed for this booking.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `;
  // Operator-set tagline wins; otherwise guess a flavor line from the tour name
  const tourLower = String(d.tour_name || "").toLowerCase();
  let activityFlavor = String(d._emailTagline || "") || "Get ready for an unforgettable experience.";
  if (d._emailTagline) { /* operator copy — skip the guesswork below */ } else
  if (/kayak|paddle|canoe/.test(tourLower)) activityFlavor = "Get ready for an unforgettable experience on the water.";
  else if (/hike|hiking|trail|walk|mountain/.test(tourLower)) activityFlavor = "Lace up your boots and get ready for an incredible adventure on the trail.";
  else if (/surf|wave/.test(tourLower)) activityFlavor = "Get ready to catch some waves and have an amazing time.";
  else if (/dive|diving|snorkel/.test(tourLower)) activityFlavor = "Get ready to explore the incredible underwater world.";
  else if (/bike|cycling|cycle|mtb/.test(tourLower)) activityFlavor = "Get ready to hit the road and enjoy an unforgettable ride.";
  else if (/safari|game|wildlife/.test(tourLower)) activityFlavor = "Get ready for an unforgettable wildlife experience.";
  else if (/climb|abseil|rappel|bouldering/.test(tourLower)) activityFlavor = "Get ready to reach new heights on an unforgettable adventure.";
  else if (/zip\s?line|canopy/.test(tourLower)) activityFlavor = "Get ready to soar through the air on an unforgettable adventure.";
  else if (/fish|fishing|angling/.test(tourLower)) activityFlavor = "Get ready to cast your line and enjoy a fantastic day out.";
  else if (/sunset|sunrise/.test(tourLower)) activityFlavor = "Get ready for a breathtaking experience you won't forget.";
  else if (/boat|cruise|sail|yacht|catamaran/.test(tourLower)) activityFlavor = "Get ready to set sail on an unforgettable experience.";
  else if (/horse|riding/.test(tourLower)) activityFlavor = "Saddle up and get ready for an unforgettable ride.";
  else if (/wine|tasting|cellar/.test(tourLower)) activityFlavor = "Get ready to savour every sip on an unforgettable tasting experience.";
  else if (/paraglid|skydiv|tandem/.test(tourLower)) activityFlavor = "Get ready for the thrill of a lifetime up in the sky.";

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #F7F7F6; margin: 0; padding: 20px; color: #333;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);">
        <!-- Hero Banner -->
        <tr>
          <td style="background-color: #1b3b36; padding: 30px 30px 20px; text-align: center;">
            <p style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #A8C2B8;">Cape Kayak Adventures</p>
            <h1 style="margin: 10px 0 0 0; font-size: 32px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">Booking Confirmed</h1>
          </td>
        </tr>
        ${heroImg("IMG_CONFIRM", "Cape Kayak")}
        <!-- Content -->
        <tr>
          <td style="padding: 40px 40px 10px; text-align: center;">
            <h2 style="font-size: 24px; font-family: Georgia, serif; margin: 0 0 15px 0; color: #1b3b36;">We can't wait to see you, ${d.customer_name}.</h2>
            <p style="font-size: 16px; line-height: 1.6; color: #555; margin: 0 0 30px 0;">Your spots for the <strong>${d.tour_name}</strong> are officially locked in. ${activityFlavor}</p>
          </td>
        </tr>
        <!-- Details Box -->
        <tr>
          <td style="padding: 0 40px 20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F7F7F6; border-radius: 8px;">
              <tr>
                <td width="40%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #888; font-size: 15px; font-weight: 400;">Reference:</td>
                <td width="60%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #1b3b36; font-size: 15px; font-weight: 400; text-align: right;">${d.ref}</td>
              </tr>
              ${d.invoice_number ? `<tr>
                <td width="40%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #888; font-size: 15px; font-weight: 400;">Invoice No:</td>
                <td width="60%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #1b3b36; font-size: 15px; font-weight: 400; text-align: right;">${d.invoice_number}</td>
              </tr>` : ""}
              <tr>
                <td width="40%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #888; font-size: 15px; font-weight: 400;">Date &amp; Time:</td>
                <td width="60%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #1b3b36; font-size: 15px; font-weight: 400; text-align: right;">${d.start_time}</td>
              </tr>
              <tr>
                <td width="40%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #888; font-size: 15px; font-weight: 400;">Guests:</td>
                <td width="60%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #1b3b36; font-size: 15px; font-weight: 400; text-align: right;">${d.qty}</td>
              </tr>
              <tr>
                <td width="40%" style="padding: 18px 20px; color: #1b3b36; font-size: 16px; font-weight: 400;">Amount Paid:</td>
                <td width="60%" style="padding: 18px 20px; color: #1b3b36; font-size: 16px; font-weight: 400; text-align: right;">${String(d.total_amount).match(/^[0-9]/) ? "R" + d.total_amount : d.total_amount}</td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Meeting Point -->
        <tr>
          <td style="padding: 0 40px 20px; text-align: center;">
            <h3 style="font-family: Georgia, serif; color: #1b3b36; font-size: 20px; margin: 0 0 10px 0;">Meeting Point</h3>
            <p style="font-size: 15px; color: #555; line-height: 1.5; margin: 0 0 10px 0;">
              <strong>Cape Kayak Adventures</strong><br>
              180 Beach Rd, Three Anchor Bay<br>
              Cape Town, 8005
            </p>
            <a href="https://www.google.com/maps/search/?api=1&query=Cape+Kayak+Adventures+180+Beach+Rd+Three+Anchor+Bay+Cape+Town+8005" style="display: inline-block; background-color: #1b3b36; color: #fff; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-size: 14px; font-weight: bold; margin-bottom: 15px;">Open in Google Maps</a>
            <p style="font-size: 14px; color: #555; line-height: 1.5; margin: 15px 0 0 0;">
              Please arrive 15 minutes before launch.<br>Bring sunscreen, a hat, a towel, and a water bottle.
            </p>
          </td>
        </tr>
        ${waiverBlock}
        <!-- CTA -->
        <tr>
          <td style="padding: 10px 40px 40px; text-align: center;">
            <p style="font-size: 14px; font-family: Georgia, serif; color: #1b3b36; font-style: italic; margin: 0 0 15px 0;">Need to amend your booking?</p>
            <a href="${d._manageUrl || "{{BOOKING_URL}}/my-bookings"}" style="display: inline-block; background-color: #1b3b36; color: #ffffff !important; text-decoration: none; padding: 16px 32px; border-radius: 30px; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Manage Your Booking</a>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background-color: #1b3b36; text-align: center; padding: 30px;">
            <p style="font-family: Georgia, serif; font-size: 18px; color: #F7F7F6; margin: 0 0 15px 0;">Cape Kayak</p>
            <p style="color: #A8C2B8; font-size: 12px; line-height: 1.5; margin: 0;">Three Anchor Bay, Sea Point, Cape Town<br>
            If you have any questions, reply to this email or contact us on WhatsApp.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>`;
}

function myBookingsOtpHtml(d: Record<string, unknown>) {
  const code = String(d.otp_code || "");
  return `
    <!DOCTYPE html>
    <html>
    <head><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #F7F7F6; margin: 0; padding: 20px; color: #333;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);">
        <tr>
          <td style="background-color: #1b3b36; padding: 30px 30px 20px; text-align: center;">
            <p style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #A8C2B8;">Cape Kayak Adventures</p>
            <h1 style="margin: 10px 0 0 0; font-size: 30px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">Your Login Code</h1>
          </td>
        </tr>
        <tr>
          <td style="padding: 40px 40px 10px; text-align: center;">
            <p style="font-size: 16px; line-height: 1.6; color: #555; margin: 0 0 24px 0;">Use this code to access and manage your bookings:</p>
            <div style="text-align: center; margin: 0 0 24px 0;">
              <span style="display: inline-block; font-family: 'Courier New', monospace; font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #1b3b36; background: #F7F7F6; padding: 16px 28px; border-radius: 10px; border: 2px dashed #1b3b36;">${code}</span>
            </div>
            <p style="font-size: 13px; color: #888; margin: 0 0 4px 0;">This code expires in 15 minutes.</p>
            <p style="font-size: 13px; color: #888; margin: 0;">If you didn't request this, you can safely ignore this email.</p>
          </td>
        </tr>
        <tr>
          <td style="background-color: #1b3b36; text-align: center; padding: 30px;">
            <p style="font-family: Georgia, serif; font-size: 18px; color: #F7F7F6; margin: 0 0 15px 0;">Cape Kayak</p>
            <p style="color: #A8C2B8; font-size: 12px; line-height: 1.5; margin: 0;">Manage your bookings anytime.<br>If you have any questions, reply to this email.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>`;
}

function reschedulePaymentLinkHtml(d: Record<string, unknown>) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #F7F7F6; margin: 0; padding: 20px; color: #333;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);">
        <!-- Hero Banner -->
        <tr>
          <td style="background-color: #1b3b36; padding: 30px 30px 20px; text-align: center;">
            <p style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #A8C2B8;">Cape Kayak Adventures</p>
            <h1 style="margin: 10px 0 0 0; font-size: 30px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">Confirm your reschedule</h1>
          </td>
        </tr>
        ${heroImg("IMG_PAYMENT", "Cape Kayak")}
        <!-- Content -->
        <tr>
          <td style="padding: 40px 40px 10px; text-align: center;">
            <h2 style="font-size: 24px; font-family: Georgia, serif; margin: 0 0 15px 0; color: #1b3b36;">Hi ${d.customer_name},</h2>
            <p style="font-size: 16px; line-height: 1.6; color: #555; margin: 0 0 8px 0;">Your booking is being moved to a new slot, but it costs a little more. Pay the top-up below to confirm the change.</p>
            <p style="font-size: 13px; color: #888; margin: 0 0 30px 0;">If you don't complete payment within 15 minutes, your original booking stays as it was.</p>
          </td>
        </tr>
        <!-- Details Box -->
        <tr>
          <td style="padding: 0 40px 30px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F7F7F6; border-radius: 8px;">
              <tr>
                <td width="40%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #888; font-size: 15px;">Reference:</td>
                <td width="60%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #1b3b36; font-size: 15px; text-align: right;">${d.ref}</td>
              </tr>
              <tr>
                <td width="40%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #888; font-size: 15px;">Tour:</td>
                <td width="60%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #1b3b36; font-size: 15px; text-align: right;">${d.tour_name}</td>
              </tr>
              <tr>
                <td width="40%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #888; font-size: 15px;">New date &amp; time:</td>
                <td width="60%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #1b3b36; font-size: 15px; text-align: right;">${d.tour_date}</td>
              </tr>
              <tr>
                <td width="40%" style="padding: 18px 20px; color: #1b3b36; font-size: 16px; font-weight: 600;">Top-up due:</td>
                <td width="60%" style="padding: 18px 20px; color: #1b3b36; font-size: 16px; font-weight: 600; text-align: right;">${String(d.total_amount).match(/^[0-9]/) ? "R" + d.total_amount : d.total_amount}</td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- CTA -->
        <tr>
          <td style="padding: 0 40px 40px; text-align: center;">
            <a href="${d.payment_url}" style="display: inline-block; background-color: #1b3b36; color: #ffffff !important; text-decoration: none; padding: 16px 32px; border-radius: 30px; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Complete Reschedule</a>
            <p style="font-size: 13px; color: #888; margin-top: 25px;">This payment link is unique to your booking and expires when the hold lapses.</p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background-color: #1b3b36; color: #A8C2B8; text-align: center; padding: 30px; font-size: 12px; line-height: 1.5;">
            Three Anchor Bay, Sea Point, Cape Town<br>
            If you have any questions, reply to this email or contact us on WhatsApp.
          </td>
        </tr>
      </table>
    </body>
    </html>`;
}

function bookingUpdatedHtml(d: Record<string, unknown>) {
  const eventLabel = String(d.event || "updated");
  const eventTitle = eventLabel === "rescheduled" ? "Booking Rescheduled" : "Booking Updated";
  const eventMessage = eventLabel === "rescheduled"
    ? "Your booking has been moved to a new date/time. Here are your updated details."
    : String(d.message || "Your booking details have been updated.");
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #F7F7F6; margin: 0; padding: 20px; color: #333;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);">
        <!-- Hero Banner -->
        <tr>
          <td style="background-color: #1b3b36; padding: 30px 30px 20px; text-align: center;">
            <p style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #A8C2B8;">Cape Kayak Adventures</p>
            <h1 style="margin: 10px 0 0 0; font-size: 30px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">${eventTitle}</h1>
          </td>
        </tr>
        ${heroImg("IMG_CONFIRM", "Cape Kayak")}
        <!-- Content -->
        <tr>
          <td style="padding: 40px 40px 10px; text-align: center;">
            <h2 style="font-size: 24px; font-family: Georgia, serif; margin: 0 0 15px 0; color: #1b3b36;">Hi ${d.customer_name},</h2>
            <p style="font-size: 16px; line-height: 1.6; color: #555; margin: 0 0 30px 0;">${eventMessage}</p>
          </td>
        </tr>
        <!-- Details Box -->
        <tr>
          <td style="padding: 0 40px 20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F7F7F6; border-radius: 8px;">
              <tr>
                <td width="40%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #888; font-size: 15px;">Reference:</td>
                <td width="60%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #1b3b36; font-size: 15px; text-align: right;">${d.ref}</td>
              </tr>
              <tr>
                <td width="40%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #888; font-size: 15px;">Tour:</td>
                <td width="60%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #1b3b36; font-size: 15px; text-align: right;">${d.tour_name}</td>
              </tr>
              <tr>
                <td width="40%" style="padding: 18px 20px; color: #888; font-size: 15px;">New Date &amp; Time:</td>
                <td width="60%" style="padding: 18px 20px; color: #1b3b36; font-size: 15px; text-align: right;">${d.start_time}</td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- CTA -->
        <tr>
          <td style="padding: 10px 40px 40px; text-align: center;">
            <a href="${d._manageUrl || "{{BOOKING_URL}}/my-bookings"}" style="display: inline-block; background-color: #1b3b36; color: #ffffff !important; text-decoration: none; padding: 16px 32px; border-radius: 30px; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">View My Booking</a>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background-color: #1b3b36; text-align: center; padding: 30px;">
            <p style="font-family: Georgia, serif; font-size: 18px; color: #F7F7F6; margin: 0 0 15px 0;">Cape Kayak</p>
            <p style="color: #A8C2B8; font-size: 12px; line-height: 1.5; margin: 0;">Three Anchor Bay, Sea Point, Cape Town<br>
            If you have any questions, reply to this email or contact us on WhatsApp.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>`;
}

// Invoices can be (re)sent for bookings that haven't paid yet (admin resend,
// invoices page). Callers may pass amount_paid explicitly; otherwise
// payment_method "Pending" (the admin apps' convention for unpaid, cleared by
// manual-mark-paid on payment) means nothing has been paid. Default: paid in
// full, which preserves the original webhook/confirm flows.
function invoiceAmountPaid(d: Record<string, unknown>, total: number): number {
  if (d.amount_paid !== undefined && d.amount_paid !== null && d.amount_paid !== "") {
    const n = parseFloat(String(d.amount_paid).replace(/[^0-9.,-]/g, "").replace(/,/g, ""));
    if (!isNaN(n)) return n;
  }
  return String(d.payment_method || "").trim().toLowerCase() === "pending" ? 0 : total;
}

function invoiceHtml(d: Record<string, unknown>, invCtx?: InvoiceContext) {
  // Always compute the VAT breakdown locally so the email is a compliant
  // SA tax invoice regardless of what the caller passed for `subtotal`.
  // Some callers (admin /bookings page) pass `subtotal = total` which would
  // hide the VAT line; deriving it from `total_amount` here keeps the email
  // honest end-to-end.
  const totalStr = String(d.total_amount || "0").replace(/[^0-9.,]/g, "").replace(/,/g, "");
  const totalNum = parseFloat(totalStr) || 0;
  const subtotalNum = totalNum / (1 + VAT_RATE);
  const vatNum = totalNum - subtotalNum;
  const m2 = (n: number) => n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const subtotalStr = m2(subtotalNum);
  const vatStr = m2(vatNum);
  const totalStrFmt = m2(totalNum);
  const fullyPaid = invoiceAmountPaid(d, totalNum) >= totalNum - 0.005;
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #F7F7F6; margin: 0; padding: 20px; color: #333;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);">
        <!-- Hero Banner -->
        <tr>
          <td style="background-color: #1b3b36; padding: 30px 30px 20px; text-align: center;">
            <p style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #A8C2B8;">${invCtx?.companyName || "Tax Invoice"}</p>
            <h1 style="margin: 10px 0 0 0; font-size: 30px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">Tax Invoice ${d.invoice_number}</h1>
          </td>
        </tr>
        ${heroImg("IMG_INVOICE", "Cape Kayak")}
        <!-- Customer Info -->
        <tr>
          <td style="padding: 30px 40px 20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom: 1px solid #E5E5E5; padding-bottom: 20px; margin-bottom: 20px; font-size: 14px; color: #555; line-height: 1.6;">
              <tr>
                <td style="vertical-align: top;"><strong style="color: #1b3b36;">Billed To:</strong><br>${d.customer_company_name ? `${d.customer_company_name}<br>` : ""}${d.customer_name}<br>${d.customer_email}${d.customer_vat_number ? `<br>VAT: ${d.customer_vat_number}` : ""}</td>
                <td style="vertical-align: top; text-align: right;"><strong style="color: #1b3b36;">Date:</strong> ${d.invoice_date}</td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Invoice Table -->
        <tr>
          <td style="padding: 0 40px 20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse; font-size: 14px;">
              <tr>
                <th style="padding: 12px 0; border-bottom: 2px solid #E5E5E5; color: #888; font-weight: 500; text-align: left;">Description</th>
                <th style="padding: 12px 0; border-bottom: 2px solid #E5E5E5; color: #888; font-weight: 500; text-align: right;">Qty</th>
                <th style="padding: 12px 0; border-bottom: 2px solid #E5E5E5; color: #888; font-weight: 500; text-align: right;">Price</th>
                <th style="padding: 12px 0; border-bottom: 2px solid #E5E5E5; color: #888; font-weight: 500; text-align: right;">Amount</th>
              </tr>
              <tr>
                <td style="padding: 15px 0; border-bottom: 1px solid #E5E5E5; color: #333;"><strong style="color: #1b3b36;">${d.tour_name}</strong><br><span style="color: #888; font-size: 13px;">${d.tour_date}</span></td>
                <td style="padding: 15px 0; border-bottom: 1px solid #E5E5E5; color: #333; text-align: right;">${d.qty}</td>
                <td style="padding: 15px 0; border-bottom: 1px solid #E5E5E5; color: #333; text-align: right;">R${d.unit_price}</td>
                <td style="padding: 15px 0; border-bottom: 1px solid #E5E5E5; color: #333; text-align: right;">R${totalStrFmt}</td>
              </tr>
              ${Number(d.discount_amount) > 0 ? `<tr><td colspan="3" style="color: #B91C1C; border-bottom: none; padding-top: 10px;">Discount${d.discount_type === "PERCENT" ? " (" + d.discount_percent + "%)" : ""}</td><td style="color: #B91C1C; border-bottom: none; padding-top: 10px; text-align: right;">-R${d.discount_amount}</td></tr>` : ""}
              <tr>
                <td colspan="3" style="padding: 14px 0 4px 0; border-bottom: none; color: #555; text-align: right;">Subtotal (excl. VAT)</td>
                <td style="padding: 14px 0 4px 0; border-bottom: none; color: #555; text-align: right;">R${subtotalStr}</td>
              </tr>
              <tr>
                <td colspan="3" style="padding: 4px 0; border-bottom: 1px solid #E5E5E5; color: #555; text-align: right;">VAT (${(VAT_RATE * 100).toFixed(0)}%)</td>
                <td style="padding: 4px 0; border-bottom: 1px solid #E5E5E5; color: #555; text-align: right;">R${vatStr}</td>
              </tr>
              <tr>
                <td colspan="3" style="padding: 14px 0 0 0; border-bottom: none; font-size: 18px; font-weight: bold; color: #1b3b36;">${fullyPaid ? "Total Paid" : "Total Due"} (incl. VAT)</td>
                <td style="padding: 14px 0 0 0; border-bottom: none; font-size: 18px; font-weight: bold; color: #1b3b36; text-align: right;">R${totalStrFmt}</td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Payment Meta -->
        <tr>
          <td style="padding: 0 40px 30px; text-align: center;">
            <p style="font-size: 13px; color: #888; margin: 0;">Payment Method: <strong>${d.payment_method}</strong> &nbsp;|&nbsp; Ref: <strong>${String(d.payment_reference || "").substring(0, 8).toUpperCase()}</strong></p>
            ${fullyPaid ? "" : `<p style="font-size: 13px; color: #B45309; margin: 8px 0 0; font-weight: 600;">Payment outstanding: this invoice has not been paid yet.</p>`}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background-color: #1b3b36; color: #A8C2B8; text-align: center; padding: 30px; font-size: 12px; line-height: 1.5;">
            Three Anchor Bay, Sea Point, Cape Town<br>
            Thank you for adventuring with us!
          </td>
        </tr>
      </table>
    </body>
    </html>`;
}

function platformInvoiceOutstandingHtml(d: Record<string, unknown>, platCtx: PlatformInvoiceContext) {
  const fmtZar = (n: unknown) => Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const amountStr = fmtZar(d.amount_zar);
  const emailOverageZar = Number(d.email_overage_zar || 0);
  const aiOverageZar = Number(d.ai_overage_zar || 0);
  const subscriptionZar = Number(d.amount_zar || 0) - emailOverageZar - aiOverageZar;
  const bank = platCtx.bank;
  const hasBank = !!(bank.account_number || bank.bank_name);
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #F7F7F6; margin: 0; padding: 20px; color: #333;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);">
        <tr>
          <td style="background-color: #1b3b36; padding: 30px 30px 20px; text-align: center;">
            ${platCtx.logoUrl ? `<img src="${platCtx.logoUrl}" alt="BookingTours" style="max-height: 40px; margin-bottom: 12px;" />` : ""}
            <p style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #A8C2B8;">BookingTours</p>
            <h1 style="margin: 10px 0 0 0; font-size: 26px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">Invoice ${d.platform_invoice_number}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding: 30px 40px 10px;">
            <p style="font-size: 14px; color: #555; margin: 0 0 4px;">Hi ${d.name || ""},</p>
            <p style="font-size: 14px; color: #555; line-height: 1.6; margin: 0;">
              Your ${d.plan_name || "subscription"} invoice for <strong>${d.business_name}</strong>
              (${d.period_start} to ${d.period_end}) is outstanding.
              ${d.pro_rated ? `<br><span style="color: #B45309;">${d.pause_note || "This invoice was pro-rated."}</span>` : ""}
            </p>
          </td>
        </tr>
        ${emailOverageZar > 0 || aiOverageZar > 0 ? `
        <tr>
          <td style="padding: 10px 40px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size: 13px; color: #555; border-top: 1px solid #eee;">
              <tr>
                <td style="padding: 10px 0 4px;">${d.plan_name || "Subscription"} (monthly fee${d.pro_rated ? ", pro-rated" : ""})</td>
                <td style="padding: 10px 0 4px; text-align: right;">R${fmtZar(subscriptionZar)}</td>
              </tr>
              ${emailOverageZar > 0 ? `
              <tr>
                <td style="padding: 4px 0 10px;">Marketing emails over included quota (${d.email_overage_count || 0})</td>
                <td style="padding: 4px 0 10px; text-align: right;">R${fmtZar(emailOverageZar)}</td>
              </tr>` : ""}
              ${aiOverageZar > 0 ? `
              <tr>
                <td style="padding: 4px 0 10px;">AI assistant replies over included quota (${d.ai_overage_count || 0})</td>
                <td style="padding: 4px 0 10px; text-align: right;">R${fmtZar(aiOverageZar)}</td>
              </tr>` : ""}
            </table>
          </td>
        </tr>` : ""}
        <tr>
          <td style="padding: 10px 40px 20px; text-align: center;">
            <p style="font-size: 32px; font-weight: bold; color: #1b3b36; margin: 0;">R${amountStr}</p>
            <p style="font-size: 12px; color: #888; margin: 4px 0 0;">Amount due</p>
          </td>
        </tr>
        ${d.yoco_payment_link_url ? `
        <tr>
          <td style="padding: 0 40px 20px; text-align: center;">
            <a href="${d.yoco_payment_link_url}" style="display: inline-block; background-color: #0c8a59; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px;">Pay Now</a>
          </td>
        </tr>` : ""}
        ${hasBank ? `
        <tr>
          <td style="padding: 0 40px 30px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F7F7F6; border-radius: 8px; padding: 16px; font-size: 13px; color: #555; line-height: 1.7;">
              <tr><td style="padding: 16px;">
                <strong style="color: #1b3b36;">Or pay via EFT:</strong><br>
                ${bank.account_owner ? `Account owner: ${bank.account_owner}<br>` : ""}
                ${bank.bank_name ? `Bank: ${bank.bank_name}<br>` : ""}
                ${bank.account_number ? `Account number: ${bank.account_number}<br>` : ""}
                ${bank.account_type ? `Account type: ${bank.account_type}<br>` : ""}
                ${bank.branch_code ? `Branch code: ${bank.branch_code}` : ""}
              </td></tr>
            </table>
          </td>
        </tr>` : ""}
        <tr>
          <td style="background-color: #1b3b36; color: #A8C2B8; text-align: center; padding: 30px; font-size: 12px; line-height: 1.5;">
            BookingTours. Thank you for partnering with us.
          </td>
        </tr>
      </table>
    </body>
    </html>`;
}

function giftVoucherHtml(d: Record<string, unknown>) {
  // Redesigned as a premium, celebratory gift-card experience instead of a
  // plain transactional layout. Framing adapts to who's actually reading it
  // — a real gift ("You've received a gift!") when it lands in the
  // recipient's own inbox (recipient_email supplied at purchase); a short,
  // reassuring receipt when the buyer gets a copy alongside it; or, when no
  // recipient email was given, an honest "forward this on" framing for the
  // buyer rather than pretending it's a receipt for themselves.
  const mode = String(d.gift_recipient_mode || "buyer_forward");
  const recipientName = String(d.recipient_name || "your friend");
  const buyerName = String(d.buyer_name || "Someone special");

  const heroEyebrow = mode === "recipient" ? "You've Received a Gift" : mode === "buyer_receipt" ? "Gift Sent" : "A Gift For Someone Special";
  const heroTitle = mode === "recipient" ? "🎁 Surprise, " + recipientName + "!" : mode === "buyer_receipt" ? "🎁 On Its Way!" : "🎁 Your Gift Voucher";

  const introHtml = mode === "recipient"
    ? `<h2 style="font-size: 26px; font-family: Georgia, serif; margin: 0 0 12px 0; color: #1b3b36;">Hi ${recipientName},</h2>
       <p style="font-size: 16px; line-height: 1.6; color: #555; margin: 0 0 20px 0;"><strong>${buyerName}</strong> just sent you a gift: an adventure, on them. Your voucher is below.</p>`
    : mode === "buyer_receipt"
      ? `<h2 style="font-size: 26px; font-family: Georgia, serif; margin: 0 0 12px 0; color: #1b3b36;">Hi ${buyerName},</h2>
         <p style="font-size: 16px; line-height: 1.6; color: #555; margin: 0 0 20px 0;">Your gift for <strong>${recipientName}</strong> is on its way to their inbox right now. Here's a copy for your records.</p>`
      : `<h2 style="font-size: 26px; font-family: Georgia, serif; margin: 0 0 12px 0; color: #1b3b36;">Hi ${buyerName},</h2>
         <p style="font-size: 16px; line-height: 1.6; color: #555; margin: 0 0 20px 0;">Your gift voucher for <strong>${recipientName}</strong> is ready below. <strong>Forward this email</strong> to give it to them, or print it as a card to hand over in person.</p>`;

  // Elegant quote card in the brand palette (applyBranding recolors #1b3b36).
  const messageBlock = d.gift_message
    ? (mode === "recipient"
        ? `<tr><td style="padding: 0 32px 24px;">
            <div style="background: #F7F7F6; border-radius: 14px; padding: 24px; text-align: center; border: 1px solid #e6e6e3;">
              <p style="margin: 0 0 10px 0; font-size: 17px; line-height: 1.6; font-style: italic; color: #1b3b36;">&ldquo;${d.gift_message}&rdquo;</p>
              <p style="margin: 0; font-size: 13px; font-weight: 600; color: #6b7280;">From ${buyerName}</p>
            </div>
          </td></tr>`
        : `<tr><td style="padding: 0 32px 20px;">
            <div style="background: #F7F7F6; border-radius: 10px; padding: 16px 20px; font-size: 13px; color: #6b7280;">Your message to ${recipientName}: <em>&ldquo;${d.gift_message}&rdquo;</em></div>
          </td></tr>`)
    : "";

  // How to give / redeem the gift, tailored to who's reading.
  const forwardNote = mode === "recipient"
    ? `<tr><td style="padding: 0 32px 4px; text-align: center;"><p style="margin: 0; font-size: 14px; line-height: 1.6; color: #6b7280;">Quote your code above when you book online or over WhatsApp. The balance is applied to your trip.</p></td></tr>`
    : mode === "buyer_receipt"
      ? ""
      : `<tr><td style="padding: 0 32px 4px; text-align: center;"><p style="margin: 0; font-size: 14px; line-height: 1.6; color: #6b7280;"><strong>To gift it:</strong> forward this email to ${recipientName}, or print this page as a card. They redeem the code when booking online or over WhatsApp.</p></td></tr>`;

  const ctaLabel = mode === "recipient" ? "Redeem Your Gift" : "View Booking Site";
  const ctaBlock = `<tr><td style="padding: 20px 40px 12px; text-align: center;">
      <table cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto; display: inline-table;"><tr>
        <td align="center" bgcolor="#1b3b36" style="border-radius: 999px;">
          <a href="{{BOOKING_URL}}" target="_blank" style="display: inline-block; padding: 16px 36px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 999px; letter-spacing: 0.03em; text-transform: uppercase;">${ctaLabel}</a>
        </td>
      </tr></table>
    </td></tr>`;

  // Deliverability nudge — recipient gift emails often land in Promotions/Spam.
  const spamNote = mode === "buyer_receipt"
    ? ""
    : `<tr><td style="padding: 0 40px 24px; text-align: center;"><p style="margin: 0; font-size: 12px; color: #9ca3af;">Don't see it in your inbox? Check your <strong>spam / promotions</strong> folder.</p></td></tr>`;

  return `
    <!DOCTYPE html>
    <html>
    <head><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #F7F7F6; margin: 0; padding: 20px; color: #333;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 45px -12px rgba(27,59,54,0.28);">
        <tr>
          <td style="background: linear-gradient(135deg, #1b3b36 0%, #2d5a4f 100%); padding: 36px 30px 28px; text-align: center;">
            <p style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #A8C2B8;">${heroEyebrow}</p>
            <h1 style="margin: 12px 0 0 0; font-size: 32px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">${heroTitle}</h1>
          </td>
        </tr>
        ${heroImg("IMG_GIFT", "Cape Kayak")}
        <tr>
          <td style="padding: 36px 40px 10px; text-align: center;">
            ${introHtml}
          </td>
        </tr>
        <tr>
          <td style="padding: 0 32px 8px;">
            <!-- The voucher itself, styled as a physical gift card / ticket. -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background: #ffffff; border: 2px dashed #1b3b36; border-radius: 20px;">
              <tr><td style="padding: 30px 24px 8px; text-align: center;">
                <p style="margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 3px; color: #1b3b36; opacity: 0.6;">Gift Voucher</p>
                <p style="margin: 10px 0 0; font-size: 52px; font-weight: 800; color: #1b3b36; line-height: 1;">R${d.value}</p>
                ${d.tour_name ? `<p style="margin: 8px 0 0; font-size: 14px; color: #6b7280;">${d.tour_name}</p>` : ""}
              </td></tr>
              <tr><td style="padding: 18px 24px 6px;">
                <div style="border-top: 2px dashed #d7ddd9;"></div>
              </td></tr>
              <tr><td style="padding: 6px 24px 30px; text-align: center;">
                <p style="margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #9ca3af;">Voucher Code</p>
                <p style="margin: 10px 0 0; font-family: 'Courier New', Courier, monospace; font-size: 34px; font-weight: 800; letter-spacing: 6px; color: #1b3b36;">${d.code}</p>
                <p style="margin: 14px 0 0; font-size: 12px; color: #9ca3af;">Valid until ${d.expires_at}</p>
              </td></tr>
            </table>
          </td>
        </tr>
        ${messageBlock}
        ${forwardNote}
        ${ctaBlock}
        ${spamNote}
        <tr>
          <td style="background-color: #1b3b36; text-align: center; padding: 30px;">
            <p style="font-family: Georgia, serif; font-size: 18px; color: #F7F7F6; margin: 0 0 15px 0;">Cape Kayak</p>
            <p style="color: #A8C2B8; font-size: 12px; line-height: 1.5; margin: 0;">Three Anchor Bay, Sea Point, Cape Town<br>Book at {{BOOKING_URL}} or WhatsApp us.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>`;
}

function cancellationHtml(d: Record<string, unknown>) {
  const isWeather = d.is_weather === true || (typeof d.reason === "string" && d.reason.toLowerCase().includes("weather"));
  // When a voucher was issued (customer chose it, or voucher-paid booking),
  // the email confirms the voucher — it must NOT re-offer the three options.
  const hasVoucher = Boolean(d.voucher_code);
  // Cancelled within 24h of the trip start: booking is forfeited, so the
  // email must NOT offer reschedule/voucher/refund options.
  const isForfeit = d.is_forfeit === true;
  // The reschedule/voucher/refund choice is OPT-IN: only operator-initiated
  // cancellations that still need a customer decision set offer_choice. Every
  // other cancellation email (refund already chosen or processed) must confirm
  // the outcome, never re-offer the three options.
  const offerChoice = d.offer_choice === true;
  const refundAmt = d.refund_amount != null && d.refund_amount !== "" ? String(d.refund_amount) : "";
  const isRefundConfirmed = !hasVoucher && !isForfeit && !offerChoice && refundAmt !== "";
  const cancelText = hasVoucher
    ? "Your booking has been cancelled and its value converted to a voucher. The code is below; use it any time on your next booking."
    : isForfeit
    ? `Unfortunately, your trip has been cancelled${d.reason ? " due to <strong>" + d.reason + "</strong>" : ""}. As the cancellation falls within 24 hours of the trip start, the booking amount is forfeited in line with our cancellation policy. If you believe this is a mistake, just reply to this email.`
    : isRefundConfirmed
    ? "Your booking has been cancelled and your refund is on its way. The details are below."
    : isWeather
    ? "Unfortunately, your trip has been cancelled due to weather conditions. The ocean wasn't playing along! We sincerely apologise for the disappointment."
    : "Unfortunately, your trip has been cancelled. We sincerely apologise for the inconvenience.";

  const amountRow = d.total_amount ? `<tr>
                <td width="40%" style="padding: 18px 20px; color: #888; font-size: 15px;">Amount Paid:</td>
                <td width="60%" style="padding: 18px 20px; color: #1b3b36; font-size: 15px; text-align: right;">R${d.total_amount}</td>
              </tr>` : "";

  // Use directly-injected URL (set before template runs) with placeholder fallback
  const manageUrl = String(d._manageUrl || "{{BOOKING_URL}}/my-bookings");

  // Bulletproof table-based button — works in all email clients
  // NEVER produce empty href — Gmail strips href="" making buttons unclickable
  function emailBtn(label: string, url: string, bgColor: string) {
    const safeUrl = url || "https://bookingtours.co.za";
    return `<table cellpadding="0" cellspacing="0" border="0" style="margin: 4px auto; display: inline-table;"><tr>
      <td align="center" bgcolor="${bgColor}" style="border-radius: 30px; padding: 0;">
        <a href="${safeUrl}" target="_blank" style="display: inline-block; padding: 12px 24px; font-family: Helvetica, Arial, sans-serif; font-size: 13px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 30px; letter-spacing: 0.03em;">${label}</a>
      </td>
    </tr></table>`;
  }

  // Weather cancellations get a prominent self-service block
  const optionsBlock = isForfeit
    ? ""
    : isRefundConfirmed
    ? `
        <tr>
          <td style="padding: 0 40px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px;">
              <tr>
                <td style="padding: 24px; text-align: center;">
                  <p style="margin: 0 0 6px 0; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #047857;">Refund confirmed</p>
                  <p style="margin: 0 0 10px 0; font-size: 26px; font-weight: 700; color: #1b3b36;">R${refundAmt}</p>
                  <p style="margin: 0; font-size: 14px; color: #166534; line-height: 1.5;">Your refund is being processed. Please allow 5 to 10 business days for it to reflect in your account.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `
    : hasVoucher
    ? `
        <tr>
          <td style="padding: 0 40px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #fffbeb; border: 2px dashed #d97706; border-radius: 12px;">
              <tr>
                <td style="padding: 24px; text-align: center;">
                  <p style="margin: 0 0 6px 0; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #92400e;">Your voucher</p>
                  <p style="margin: 0 0 6px 0; font-family: 'Courier New', monospace; font-size: 26px; font-weight: 700; letter-spacing: 0.12em; color: #1b3b36;">${d.voucher_code}</p>
                  ${d.voucher_amount ? `<p style="margin: 0 0 12px 0; font-size: 15px; font-weight: 600; color: #92400e;">Value: R${d.voucher_amount}</p>` : ""}
                  <p style="margin: 0; font-size: 13px; color: #92400e; line-height: 1.5;">Enter this code at checkout on your next booking. Valid for 3 years.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `
    : isWeather
    ? `
        <tr>
          <td style="padding: 0 40px 10px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px;">
              <tr>
                <td style="padding: 24px; text-align: center;">
                  <p style="margin: 0 0 6px 0; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #047857;">Your options</p>
                  <p style="margin: 0 0 16px 0; font-size: 14px; color: #166534; line-height: 1.5;">Pick a new date, convert to a voucher, or request a full refund.</p>
                  ${emailBtn("Manage My Booking", manageUrl, "#166534")}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding: 8px 40px 28px; text-align: center;">
            <p style="font-size: 12px; color: #999; margin: 0;">Or reply to this email and we&rsquo;ll sort it out for you.</p>
          </td>
        </tr>
      `
    : offerChoice
    ? `
        <tr>
          <td style="padding: 10px 40px 8px; text-align: center;">
            <p style="font-size: 15px; font-family: Georgia, serif; color: #1b3b36; margin: 0 0 16px 0;">What would you like to do?</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 0 30px 30px; text-align: center;">
            ${emailBtn("Reschedule", manageUrl, "#1b3b36")}
            ${emailBtn("Get a Voucher", manageUrl, "#1b3b36")}
            ${emailBtn("Request Refund", manageUrl, "#1b3b36")}
            <p style="font-size: 12px; color: #999; margin: 12px 0 0 0;">Or reply to this email and we&rsquo;ll sort it out for you.</p>
          </td>
        </tr>
      `
    : "";

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #F7F7F6; margin: 0; padding: 20px; color: #333;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);">
        <!-- Hero Banner -->
        <tr>
          <td style="background-color: #1b3b36; padding: 30px 30px 20px; text-align: center;">
            <p style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #A8C2B8;">Cape Kayak Adventures</p>
            <h1 style="margin: 10px 0 0 0; font-size: 30px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">Trip Cancelled</h1>
          </td>
        </tr>
        <!-- Hero Image -->
        ${heroImg(isWeather ? "IMG_CANCEL_WEATHER" : "IMG_CANCEL", "Cape Kayak")}
        <!-- Content -->
        <tr>
          <td style="padding: 40px 40px 10px; text-align: center;">
            <h2 style="font-size: 24px; font-family: Georgia, serif; margin: 0 0 15px 0; color: #1b3b36;">Hi ${d.customer_name},</h2>
            <p style="font-size: 16px; line-height: 1.6; color: #555; margin: 0 0 30px 0;">${cancelText}</p>
          </td>
        </tr>
        <!-- Details Box -->
        <tr>
          <td style="padding: 0 40px 20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F7F7F6; border-radius: 8px;">
              <tr>
                <td width="40%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #888; font-size: 15px;">Reference:</td>
                <td width="60%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #1b3b36; font-size: 15px; text-align: right;">${d.ref}</td>
              </tr>
              <tr>
                <td width="40%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #888; font-size: 15px;">Tour:</td>
                <td width="60%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #1b3b36; font-size: 15px; text-align: right;">${d.tour_name}</td>
              </tr>
              <tr>
                <td width="40%" style="padding: 18px 20px; ${d.total_amount ? "border-bottom: 1px solid #E5E5E5; " : ""}color: #888; font-size: 15px;">Date &amp; Time:</td>
                <td width="60%" style="padding: 18px 20px; ${d.total_amount ? "border-bottom: 1px solid #E5E5E5; " : ""}color: #1b3b36; font-size: 15px; text-align: right;">${d.start_time}</td>
              </tr>
              ${amountRow}
            </table>
          </td>
        </tr>
        ${optionsBlock}
        <!-- Footer -->
        <tr>
          <td style="background-color: #1b3b36; text-align: center; padding: 30px;">
            <p style="font-family: Georgia, serif; font-size: 18px; color: #F7F7F6; margin: 0 0 15px 0;">Cape Kayak</p>
            <p style="color: #A8C2B8; font-size: 12px; line-height: 1.5; margin: 0;">Three Anchor Bay, Sea Point, Cape Town<br>
            If you have any questions, reply to this email or contact us on WhatsApp.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>`;
}

function indemnityHtml(d: Record<string, unknown>) {
  const waiverUrl = String(d.waiver_url || "");
  const waiverPending = String(d.waiver_status || "PENDING") !== "SIGNED";
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #F7F7F6; margin: 0; padding: 20px; color: #333;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);">
        <!-- Hero Banner -->
        <tr>
          <td style="background-color: #1b3b36; padding: 30px 30px 20px; text-align: center;">
            <p style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #A8C2B8;">Cape Kayak Adventures</p>
            <h1 style="margin: 10px 0 0 0; font-size: 28px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">Your trip is tomorrow</h1>
          </td>
        </tr>
        <!-- Hero Image -->
        ${heroImg("IMG_INDEMNITY", "Cape Kayak")}
        <!-- Intro -->
        <tr>
          <td style="padding: 40px 40px 10px; text-align: center;">
            <h2 style="font-size: 22px; font-family: Georgia, serif; margin: 0 0 15px 0; color: #1b3b36;">Hi ${d.customer_name},</h2>
            <p style="font-size: 16px; line-height: 1.6; color: #555; margin: 0 0 10px 0;">Your <strong>${d.tour_name}</strong> is tomorrow. This is a reminder to arrive early and finish any outstanding pre-trip steps.</p>
            <p style="font-size: 15px; line-height: 1.6; color: #555; margin: 0 0 20px 0;">${waiverPending ? "Your waiver is still outstanding. Please complete it before the trip so check-in stays quick on the day." : "Your waiver has already been completed. You are all set for check-in."}</p>
          </td>
        </tr>
        <!-- Booking Details -->
        <tr>
          <td style="padding: 0 40px 20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F7F7F6; border-radius: 8px;">
              <tr>
                <td width="40%" style="padding: 14px 20px; border-bottom: 1px solid #E5E5E5; color: #888; font-size: 14px;">Reference:</td>
                <td width="60%" style="padding: 14px 20px; border-bottom: 1px solid #E5E5E5; color: #1b3b36; font-size: 14px; text-align: right;">${d.ref}</td>
              </tr>
              <tr>
                <td width="40%" style="padding: 14px 20px; border-bottom: 1px solid #E5E5E5; color: #888; font-size: 14px;">Activity:</td>
                <td width="60%" style="padding: 14px 20px; border-bottom: 1px solid #E5E5E5; color: #1b3b36; font-size: 14px; text-align: right;">${d.tour_name}</td>
              </tr>
              <tr>
                <td width="40%" style="padding: 14px 20px; border-bottom: 1px solid #E5E5E5; color: #888; font-size: 14px;">Date &amp; Time:</td>
                <td width="60%" style="padding: 14px 20px; border-bottom: 1px solid #E5E5E5; color: #1b3b36; font-size: 14px; text-align: right;">${d.start_time}</td>
              </tr>
              <tr>
                <td width="40%" style="padding: 14px 20px; color: #888; font-size: 14px;">Guests:</td>
                <td width="60%" style="padding: 14px 20px; color: #1b3b36; font-size: 14px; text-align: right;">${d.qty}</td>
              </tr>
            </table>
          </td>
        </tr>
        ${waiverPending && waiverUrl ? `
        <tr>
          <td style="padding: 0 40px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 12px;">
              <tr>
                <td style="padding: 24px; text-align: center;">
                  <p style="margin: 0 0 8px 0; font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #047857;">Outstanding before arrival</p>
                  <h3 style="margin: 0 0 10px 0; font-family: Georgia, serif; font-size: 22px; color: #14532d;">Sign the waiver now</h3>
                  <p style="margin: 0 0 18px 0; font-size: 14px; color: #166534; line-height: 1.6;">Use the secure booking-specific link below. It covers the booking holder and everyone travelling on this reservation.</p>
                  <a href="${waiverUrl}" style="display: inline-block; background-color: #166534; color: #ffffff !important; text-decoration: none; padding: 12px 24px; border-radius: 999px; font-weight: 700; font-size: 13px; letter-spacing: 0.04em; text-transform: uppercase;">Complete waiver</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        ` : `
        <tr>
          <td style="padding: 0 40px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px;">
              <tr>
                <td style="padding: 20px; text-align: center;">
                  <p style="margin: 0; font-size: 14px; color: #1d4ed8; line-height: 1.6;"><strong>Waiver status:</strong> Already completed. No further action is needed before arrival.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        `}
        <!-- Reminder Section -->
        <tr>
          <td style="padding: 0 40px 20px; text-align: center;">
            <h3 style="font-family: Georgia, serif; color: #1b3b36; font-size: 20px; margin: 0 0 10px 0;">See You Tomorrow</h3>
            <p style="font-size: 15px; color: #555; line-height: 1.5; margin: 0 0 25px 0;">
              <strong>Cape Kayak Adventures, 180 Beach Rd, Three Anchor Bay</strong><br>
              Please arrive 15 minutes before launch.<br>Bring sunscreen, a hat, a towel, and a water bottle.
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background-color: #1b3b36; text-align: center; padding: 30px;">
            <p style="font-family: Georgia, serif; font-size: 18px; color: #F7F7F6; margin: 0 0 15px 0;">Cape Kayak</p>
            <p style="color: #A8C2B8; font-size: 12px; line-height: 1.5; margin: 0;">Three Anchor Bay, Sea Point, Cape Town<br>
            If you have any questions, reply to this email or contact us on WhatsApp.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>`;
}

function voucherHtml(d: Record<string, unknown>) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body style="margin: 0; padding: 0; background-color: #F7F7F6; font-family: Arial, Helvetica, sans-serif; color: #333;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
        <!-- Hero Banner -->
        <tr>
          <td style="background-color: #1b3b36; padding: 30px 30px 20px; text-align: center;">
            <p style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #A8C2B8;">Cape Kayak Adventures</p>
            <h1 style="margin: 10px 0 0 0; font-size: 30px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">Your Voucher</h1>
          </td>
        </tr>
        <!-- Hero Image -->
        ${heroImg("IMG_VOUCHER", "Cape Kayak")}
        <!-- Thank You -->
        <tr>
          <td style="text-align: center; padding: 30px 40px 10px;">
            <p style="font-size: 15px; color: #6b7280; margin: 0;">Thank you for choosing Cape Kayak Adventures</p>
          </td>
        </tr>
        <!-- Voucher Code Box -->
        <tr>
          <td style="padding: 20px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background: #f0fdf4; border: 2px dashed #2a5a52; border-radius: 12px;">
              <tr>
                <td style="padding: 24px; text-align: center;">
                  <p style="margin: 0 0 8px 0; font-size: 14px; color: #6b7280;">Your Code</p>
                  <p style="margin: 0 0 8px 0; font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #2a5a52;">${d.code}</p>
                  <p style="margin: 0; font-size: 13px; color: #6b7280;">Valid until ${d.expires_at}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Instructions -->
        <tr>
          <td style="padding: 0 40px 30px; text-align: center;">
            <p style="font-size: 15px; color: #555; line-height: 1.6; margin: 0 0 20px 0;">
              Use this code when booking at <a href="{{BOOKING_URL}}" style="color: #2a5a52; font-weight: bold; text-decoration: none;">{{BOOKING_URL}}</a>
            </p>
            <a href="{{BOOKING_URL}}" style="display: inline-block; background-color: #2a5a52; color: #fff; text-decoration: none; padding: 14px 40px; border-radius: 8px; font-size: 16px; font-weight: bold;">Book Now</a>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background-color: #1b3b36; text-align: center; padding: 30px;">
            <p style="font-family: Georgia, serif; font-size: 18px; color: #F7F7F6; margin: 0 0 15px 0;">Cape Kayak</p>
            <p style="color: #A8C2B8; font-size: 12px; line-height: 1.5; margin: 0;">Three Anchor Bay, Sea Point, Cape Town<br>
            If you have any questions, reply to this email or contact us on WhatsApp.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>`;
}

function voucherBalanceHtml(d: Record<string, unknown>) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body style="margin: 0; padding: 0; background-color: #F7F7F6; font-family: Arial, Helvetica, sans-serif; color: #333;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
        <!-- Hero Banner -->
        <tr>
          <td style="background-color: #1b3b36; padding: 30px 30px 20px; text-align: center;">
            <p style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #A8C2B8;">Cape Kayak Adventures</p>
            <h1 style="margin: 10px 0 0 0; font-size: 30px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">Voucher Balance Update</h1>
          </td>
        </tr>
        <!-- Hero Image -->
        ${heroImg("IMG_VOUCHER", "Cape Kayak")}
        <!-- Greeting -->
        <tr>
          <td style="text-align: center; padding: 30px 40px 10px;">
            <p style="font-size: 16px; color: #333; margin: 0;">Hi ${d.customer_name || "there"},</p>
            <p style="font-size: 15px; color: #6b7280; margin: 10px 0 0 0;">Your voucher was used for a booking. Here's a summary of your remaining balance.</p>
          </td>
        </tr>
        <!-- Booking Details -->
        <tr>
          <td style="padding: 20px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background: #f9fafb; border-radius: 12px; border: 1px solid #e5e7eb;">
              <tr>
                <td style="padding: 20px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding: 8px 0; font-size: 14px; color: #6b7280;">Booking Ref</td>
                      <td style="padding: 8px 0; font-size: 14px; font-weight: bold; text-align: right; color: #333;">${d.booking_ref || ""}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; font-size: 14px; color: #6b7280;">Tour</td>
                      <td style="padding: 8px 0; font-size: 14px; font-weight: bold; text-align: right; color: #333;">${d.tour_name || ""}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; font-size: 14px; color: #6b7280;">Amount Used</td>
                      <td style="padding: 8px 0; font-size: 14px; font-weight: bold; text-align: right; color: #B91C1C;">-R${d.amount_used || 0}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Voucher Balance Box -->
        <tr>
          <td style="padding: 0 40px 20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background: #f0fdf4; border: 2px dashed #2a5a52; border-radius: 12px;">
              <tr>
                <td style="padding: 24px; text-align: center;">
                  <p style="margin: 0 0 8px 0; font-size: 14px; color: #6b7280;">Your Voucher Code</p>
                  <p style="margin: 0 0 12px 0; font-size: 28px; font-weight: bold; letter-spacing: 4px; color: #2a5a52;">${d.voucher_code || ""}</p>
                  <p style="margin: 0 0 4px 0; font-size: 14px; color: #6b7280;">Remaining Balance</p>
                  <p style="margin: 0; font-size: 36px; font-weight: bold; color: #2a5a52;">R${d.remaining_balance || 0}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Instructions -->
        <tr>
          <td style="padding: 0 40px 30px; text-align: center;">
            <p style="font-size: 15px; color: #555; line-height: 1.6; margin: 0 0 20px 0;">
              You have R${d.remaining_balance || 0} credit remaining on your voucher. Use it on your next booking.
            </p>
            <a href="{{BOOKING_URL}}" style="display: inline-block; background-color: #2a5a52; color: #fff; text-decoration: none; padding: 14px 40px; border-radius: 8px; font-size: 16px; font-weight: bold;">Book Again</a>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background-color: #1b3b36; text-align: center; padding: 30px;">
            <p style="font-family: Georgia, serif; font-size: 18px; color: #F7F7F6; margin: 0 0 15px 0;">Cape Kayak</p>
            <p style="color: #A8C2B8; font-size: 12px; line-height: 1.5; margin: 0;">Three Anchor Bay, Sea Point, Cape Town<br>
            If you have any questions, reply to this email or contact us on WhatsApp.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>`;
}

function tripPhotosHtml(d: Record<string, unknown>) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body style="margin: 0; padding: 0; background-color: #F7F7F6; font-family: Arial, Helvetica, sans-serif; color: #333;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
        <!-- Hero Banner -->
        <tr>
          <td style="background-color: #1b3b36; padding: 30px 30px 20px; text-align: center;">
            <p style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #A8C2B8;">Cape Kayak Adventures</p>
            <h1 style="margin: 10px 0 0 0; font-size: 30px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">Your Trip Photos</h1>
          </td>
        </tr>
        <!-- Hero Image -->
        ${heroImg("IMG_PHOTOS", "Cape Kayak")}
        <!-- Sub-header -->
        <tr>
          <td style="text-align: center; padding: 30px 40px 10px;">
            <p style="font-size: 15px; color: #6b7280; margin: 0;">We hope you had an incredible time on the water</p>
          </td>
        </tr>
        <!-- Message -->
        <tr>
          <td style="padding: 10px 40px 20px; text-align: center;">
            <p style="font-size: 15px; color: #555; line-height: 1.7; margin: 0;">
              Hi ${d.customer_name},<br><br>
              Thank you for paddling with <strong>Cape Kayak Adventures</strong>${d.tour_name ? " on our <strong>" + d.tour_name + "</strong> trip" : ""}! We loved having you out there and hope you enjoyed every moment.
            </p>
          </td>
        </tr>
        <!-- Photos Box -->
        <tr>
          <td style="padding: 0 40px 20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f0fdf4; border: 2px solid #2a5a52; border-radius: 12px;">
              <tr>
                <td style="padding: 24px; text-align: center;">
                  <p style="margin: 0 0 8px 0; font-size: 14px; color: #6b7280;">Your trip photos are ready!</p>
                  <p style="margin: 0 0 16px 0; font-size: 13px; color: #888; line-height: 1.5;">We captured some great moments from your trip. Click below to view and download your photos.<br><strong>Share this link with your group!</strong></p>
                  <a href="${d.photo_url}" style="display: inline-block; background-color: #2a5a52; color: #fff; text-decoration: none; padding: 14px 40px; border-radius: 8px; font-size: 16px; font-weight: bold;">View Photos</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Review Request -->
        <tr>
          <td style="padding: 0 40px 20px; text-align: center;">
            <p style="font-size: 14px; color: #555; line-height: 1.6; margin: 0 0 15px 0;">
              Had a great time? We'd love it if you could leave us a quick review on Google. It means the world to our small team!
            </p>
            <a href="https://search.google.com/local/writereview?placeid=ChIJ9a9I09RHzB0Rh9R8O4pM7aQ" style="display: inline-block; background-color: #ffffff; color: #2a5a52; border: 2px solid #2a5a52; text-decoration: none; padding: 12px 30px; border-radius: 8px; font-size: 15px; font-weight: bold;">⭐ Leave a Google Review</a>
          </td>
        </tr>
        <!-- Come Back -->
        <tr>
          <td style="padding: 0 40px 30px; text-align: center;">
            <p style="font-size: 15px; color: #555; line-height: 1.6; margin: 0 0 20px 0;">
              We'd love to see you again! Book your next adventure anytime at <a href="{{BOOKING_URL}}" style="color: #2a5a52; font-weight: bold; text-decoration: none;">{{BOOKING_URL}}</a>
            </p>
            <a href="{{BOOKING_URL}}" style="display: inline-block; background-color: #1b3b36; color: #fff; text-decoration: none; padding: 14px 40px; border-radius: 30px; font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">Book Again</a>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background-color: #1b3b36; text-align: center; padding: 30px;">
            <p style="font-family: Georgia, serif; font-size: 18px; color: #F7F7F6; margin: 0 0 15px 0;">Cape Kayak</p>
            <p style="color: #A8C2B8; font-size: 12px; line-height: 1.5; margin: 0;">Three Anchor Bay, Sea Point, Cape Town<br>
            If you have any questions, reply to this email or contact us on WhatsApp.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>`;
}

// Customer-facing fallback for an operator's WhatsApp reply that couldn't be
// delivered on WhatsApp (24h window closed / send failed). Keeps the operator's
// message intact and branded so the customer still receives it.
function customerMessageHtml(d: Record<string, unknown>) {
  const messageHtml = String(d.message || "").replace(/\n/g, "<br>");
  return `
    <!DOCTYPE html>
    <html>
    <head><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #F7F7F6; margin: 0; padding: 20px; color: #333;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);">
        <tr>
          <td style="background-color: #1b3b36; padding: 28px 30px 20px; text-align: center;">
            <p style="margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 2px; color: #A8C2B8;">Cape Kayak Adventures</p>
            <h1 style="margin: 10px 0 0 0; font-size: 26px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">A message for you</h1>
          </td>
        </tr>
        <tr>
          <td style="padding: 34px 40px 10px;">
            <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 16px 0;">Hi ${d.customer_name || "there"},</p>
            <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 20px 0;">${messageHtml}</p>
            <p style="font-size: 14px; line-height: 1.6; color: #777; margin: 0;">You can reply directly to this email to reach our team.</p>
          </td>
        </tr>
        <tr>
          <td style="background-color: #1b3b36; text-align: center; padding: 24px;">
            <p style="color: #A8C2B8; font-size: 12px; line-height: 1.5; margin: 0;">Three Anchor Bay, Sea Point, Cape Town<br>Reply to this email or contact us on WhatsApp.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>`;
}

// Internal operator-facing alert (e.g. a customer booking change request).
// Sent TO the tenant's notification_email. No deep link into the dashboard —
// tenant admin URLs vary — so it carries the customer's contact details so the
// operator can act straight from the email, and points them to their inbox.
function partnershipInviteHtml(d: Record<string, unknown>) {
  return `
    <!DOCTYPE html>
    <html>
    <head><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #F7F7F6; margin: 0; padding: 20px; color: #333;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);">
        <tr>
          <td style="background-color: #1b3b36; padding: 28px 30px 20px; text-align: center;">
            <p style="margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 2px; color: #A8C2B8;">Cape Kayak Adventures</p>
            <h1 style="margin: 10px 0 0 0; font-size: 26px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">Partnership Invitation</h1>
          </td>
        </tr>
        <tr>
          <td style="padding: 34px 40px 6px;">
            <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 16px 0;">Hi ${d.partner_name || "there"},</p>
            <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 16px 0;"><strong>${d.inviter_name || "A BookingTours operator"}</strong> would like to partner with your business on BookingTours.</p>
            <p style="font-size: 15px; line-height: 1.6; color: #555; margin: 0 0 8px 0;">Partners create combo offers together: two experiences bundled at one price, sold on both booking sites with a single checkout. You choose the tours, the price and how the revenue is split.</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 20px 40px 12px; text-align: center;">
            <table cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto; display: inline-table;"><tr>
              <td align="center" bgcolor="#1b3b36" style="border-radius: 999px;">
                <a href="${d.approve_url}" target="_blank" style="display: inline-block; padding: 16px 36px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 999px; letter-spacing: 0.03em; text-transform: uppercase;">Accept Partnership</a>
              </td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td style="padding: 4px 40px 30px; text-align: center;">
            <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #9ca3af;">Accepting activates the partnership. You can revoke it anytime from your dashboard's Partners page. If you weren't expecting this invitation, you can safely ignore this email.</p>
          </td>
        </tr>
        <tr>
          <td style="background-color: #1b3b36; text-align: center; padding: 24px;">
            <p style="color: #A8C2B8; font-size: 12px; line-height: 1.5; margin: 0;">Three Anchor Bay, Sea Point, Cape Town<br>Powered by BookingTours.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>`;
}

function settlementRequestHtml(d: Record<string, unknown>) {
  return `
    <!DOCTYPE html>
    <html>
    <head><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #F7F7F6; margin: 0; padding: 20px; color: #333;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);">
        <tr>
          <td style="background-color: #1b3b36; padding: 28px 30px 20px; text-align: center;">
            <p style="margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 2px; color: #A8C2B8;">Cape Kayak Adventures</p>
            <h1 style="margin: 10px 0 0 0; font-size: 26px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">Combo Settlement Request</h1>
          </td>
        </tr>
        <tr>
          <td style="padding: 34px 40px 6px;">
            <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 16px 0;">Hi ${d.partner_name || "there"},</p>
            <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 16px 0;"><strong>${d.requester_name || "Your partner"}</strong> has requested settlement of their share of combo bookings you collected payment for.</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 0 32px 8px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F7F7F6; border-radius: 12px;">
              <tr><td style="padding: 26px 24px 6px; text-align: center;">
                <p style="margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 3px; color: #1b3b36; opacity: 0.6;">Amount Owed</p>
                <p style="margin: 10px 0 0; font-size: 44px; font-weight: 800; color: #1b3b36; line-height: 1;">R${d.amount}</p>
                <p style="margin: 10px 0 20px; font-size: 13px; color: #6b7280;">${d.combo_count} combo booking${Number(d.combo_count) === 1 ? "" : "s"} · ${d.period_label || ""}</p>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding: 20px 40px 12px; text-align: center;">
            <table cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto; display: inline-table;"><tr>
              <td align="center" bgcolor="#1b3b36" style="border-radius: 999px;">
                <a href="${d.payment_url}" target="_blank" style="display: inline-block; padding: 16px 36px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 999px; letter-spacing: 0.03em; text-transform: uppercase;">Pay R${d.amount} Now</a>
              </td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td style="padding: 4px 40px 30px; text-align: center;">
            <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #9ca3af;">Payment is processed securely by Yoco and goes directly to ${d.requester_name || "your partner"}. The settlement is marked as paid automatically on both dashboards, and the full breakdown is on your Partners page.</p>
          </td>
        </tr>
        <tr>
          <td style="background-color: #1b3b36; text-align: center; padding: 24px;">
            <p style="color: #A8C2B8; font-size: 12px; line-height: 1.5; margin: 0;">Three Anchor Bay, Sea Point, Cape Town<br>Powered by BookingTours.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>`;
}

function operatorAlertHtml(d: Record<string, unknown>) {
  const row = (label: string, value: unknown) => value
    ? `<tr><td width="35%" style="padding: 14px 20px; border-bottom: 1px solid #E5E5E5; color: #888; font-size: 14px;">${label}</td><td width="65%" style="padding: 14px 20px; border-bottom: 1px solid #E5E5E5; color: #1b3b36; font-size: 14px; text-align: right;">${value}</td></tr>`
    : "";
  return `
    <!DOCTYPE html>
    <html>
    <head><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #F7F7F6; margin: 0; padding: 20px; color: #333;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);">
        <tr>
          <td style="background-color: #1b3b36; padding: 28px 30px 20px; text-align: center;">
            <p style="margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 2px; color: #A8C2B8;">Cape Kayak Adventures</p>
            <h1 style="margin: 10px 0 0 0; font-size: 26px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">${d.heading || "New alert"}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding: 34px 40px 6px;">
            <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0 0 20px 0;">${d.intro || ""}</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 0 40px 10px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F7F7F6; border-radius: 8px;">
              ${row("Reference", d.ref)}
              ${row("Tour", d.tour_name)}
              ${row("Customer", d.customer_name)}
              ${row("Phone", d.customer_phone)}
              ${row("Email", d.customer_email)}
            </table>
          </td>
        </tr>
        ${d.note ? `<tr><td style="padding: 6px 40px 10px;"><div style="background: #fff8e6; border-left: 3px solid #d9a441; border-radius: 6px; padding: 14px 16px; font-size: 14px; color: #6b5a2f;">“${d.note}”</div></td></tr>` : ""}
        <tr>
          <td style="padding: 10px 40px 36px;">
            <p style="font-size: 14px; line-height: 1.6; color: #555; margin: 0;">Open your <strong>BookingTours dashboard → Inbox</strong> to reply. This request is already waiting there.</p>
          </td>
        </tr>
        <tr>
          <td style="background-color: #1b3b36; text-align: center; padding: 24px;">
            <p style="color: #A8C2B8; font-size: 12px; line-height: 1.5; margin: 0;">Three Anchor Bay, Sea Point, Cape Town<br>You're receiving this because you're the notification contact for this business.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>`;
}

function adminWelcomeHtml(d: Record<string, unknown>) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #F7F7F6; margin: 0; padding: 20px; color: #333;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);">
        <!-- Hero Banner -->
        <tr>
          <td style="background-color: #1b3b36; padding: 30px 30px 20px; text-align: center;">
            <p style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #A8C2B8;">Cape Kayak Adventures</p>
            <h1 style="margin: 10px 0 0 0; font-size: 30px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">Welcome, Admin</h1>
          </td>
        </tr>
        <!-- Hero Image -->
        ${heroImg("IMG_ADMIN", "Cape Kayak")}
        <!-- Content -->
        <tr>
          <td style="padding: 40px 40px 10px; text-align: center;">
            <h2 style="font-size: 24px; font-family: Georgia, serif; margin: 0 0 15px 0; color: #1b3b36;">You've been added as an admin</h2>
            <p style="font-size: 16px; line-height: 1.6; color: #555; margin: 0 0 30px 0;">You now have access to the Cape Kayak Admin Dashboard. Click the button below to set your password and get started.</p>
          </td>
        </tr>
        <!-- Details Box -->
        <tr>
          <td style="padding: 0 40px 20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F7F7F6; border-radius: 8px;">
              <tr>
                <td width="40%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #888; font-size: 15px;">Email:</td>
                <td width="60%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #1b3b36; font-size: 15px; text-align: right;">${d.email}</td>
              </tr>
              <tr>
                <td width="40%" style="padding: 18px 20px; color: #888; font-size: 15px;">Role:</td>
                <td width="60%" style="padding: 18px 20px; color: #1b3b36; font-size: 15px; text-align: right;">Admin</td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- CTA -->
        <tr>
          <td style="padding: 10px 40px 15px; text-align: center;">
            <a href="${d.change_password_url}" style="display: inline-block; background-color: #1b3b36; color: #ffffff !important; text-decoration: none; padding: 16px 32px; border-radius: 30px; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Set Your Password</a>
          </td>
        </tr>
        <!-- Security Note -->
        <tr>
          <td style="padding: 0 40px 30px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #FEF3C7; border: 1px solid #F59E0B; border-radius: 8px;">
              <tr>
                <td style="padding: 16px; text-align: center;">
                  <p style="margin: 0; font-size: 13px; color: #78350F; line-height: 1.5;">This setup link expires in 48 hours. If you didn't expect this email, please contact the main admin.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background-color: #1b3b36; text-align: center; padding: 30px;">
            <p style="font-family: Georgia, serif; font-size: 18px; color: #F7F7F6; margin: 0 0 15px 0;">Cape Kayak</p>
            <p style="color: #A8C2B8; font-size: 12px; line-height: 1.5; margin: 0;">Three Anchor Bay, Sea Point, Cape Town<br>
            If you have any questions, contact the main admin.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>`;
}

function adminResetPasswordHtml(d: Record<string, unknown>) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #F7F7F6; margin: 0; padding: 20px; color: #333;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);">
        <tr>
          <td style="background-color: #1b3b36; padding: 30px 30px 20px; text-align: center;">
            <p style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #A8C2B8;">Cape Kayak Adventures</p>
            <h1 style="margin: 10px 0 0 0; font-size: 30px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">Password Reset</h1>
          </td>
        </tr>
        ${heroImg("IMG_ADMIN", "Cape Kayak")}
        <tr>
          <td style="padding: 40px 40px 10px; text-align: center;">
            <h2 style="font-size: 24px; font-family: Georgia, serif; margin: 0 0 15px 0; color: #1b3b36;">Reset your admin password</h2>
            <p style="font-size: 16px; line-height: 1.6; color: #555; margin: 0 0 30px 0;">We received a request to reset your admin dashboard password. Click the button below to set a new password.</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 0 40px 20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F7F7F6; border-radius: 8px;">
              <tr>
                <td width="40%" style="padding: 18px 20px; color: #888; font-size: 15px;">Email:</td>
                <td width="60%" style="padding: 18px 20px; color: #1b3b36; font-size: 15px; text-align: right;">${d.email}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding: 10px 40px 15px; text-align: center;">
            <a href="${d.change_password_url}" style="display: inline-block; background-color: #1b3b36; color: #ffffff !important; text-decoration: none; padding: 16px 32px; border-radius: 30px; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Reset Your Password</a>
          </td>
        </tr>
        <tr>
          <td style="padding: 0 40px 30px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #FEF3C7; border: 1px solid #F59E0B; border-radius: 8px;">
              <tr>
                <td style="padding: 16px; text-align: center;">
                  <p style="margin: 0; font-size: 13px; color: #78350F; line-height: 1.5;">This reset link expires in 48 hours. If you didn't request this, you can safely ignore this email.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background-color: #1b3b36; text-align: center; padding: 30px;">
            <p style="font-family: Georgia, serif; font-size: 18px; color: #F7F7F6; margin: 0 0 15px 0;">Cape Kayak</p>
            <p style="color: #A8C2B8; font-size: 12px; line-height: 1.5; margin: 0;">Three Anchor Bay, Sea Point, Cape Town<br>
            If you have any questions, contact the main admin.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>`;
}

const VAT_RATE = 0.15;

function escHtml(raw: string) {
  return raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function buildInvoicePdf(d: Record<string, unknown>, invCtx: InvoiceContext): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontMono = await doc.embedFont(StandardFonts.Courier);

  const W = 595.28;
  const margin = 40;
  const usable = W - margin * 2;
  let y = 800;
  const black = rgb(0, 0, 0);
  const grey = rgb(0.5, 0.5, 0.5);
  const lightGrey = rgb(0.85, 0.85, 0.85);
  const darkGreen = rgb(0.106, 0.231, 0.212);

  // Invoice data
  const invNo = String(d.invoice_number || "");
  const ref = String(d.payment_reference || invNo).substring(0, 8).toUpperCase();
  const toName = String(d.customer_name || "Customer");
  const toEmail = String(d.customer_email || "");
  const toPhone = String(d.phone || "");
  const toCompany = String(d.customer_company_name || "");
  const toVat = String(d.customer_vat_number || "");
  const tourName = String(d.tour_name || "Booking");
  const tourDate = String(d.tour_date || d.invoice_date || "-");
  const qty = Number(d.qty) || 1;
  const totalStr = String(d.total_amount || "0").replace(/[^0-9.,]/g, "").replace(/,/g, "");
  const total = parseFloat(totalStr) || 0;
  const subtotal = total / (1 + VAT_RATE);
  const vatAmt = total - subtotal;
  const invDate = String(d.invoice_date || "-");
  const amountPaid = invoiceAmountPaid(d, total);
  function m(n: number) { return "R" + n.toFixed(2); }

  // ── Optional operator logo (top-left) ──
  // pdf-lib can only embed raster PNG/JPG — SVG and WEBP logos (which render
  // fine as an <img> on the booking site/admin sidebar) can't be embedded
  // here without rasterizing first, so they're skipped. That used to fail
  // completely silently; now it's logged so a missing invoice logo is
  // diagnosable instead of a mystery.
  if (invCtx.logoUrl) {
    try {
      const resp = await fetch(invCtx.logoUrl);
      if (!resp.ok) {
        console.warn("INVOICE_LOGO_FETCH_FAILED url=" + invCtx.logoUrl + " status=" + resp.status);
      } else {
        const bytes = new Uint8Array(await resp.arrayBuffer());
        const ct = (resp.headers.get("content-type") || "").toLowerCase();
        const url = invCtx.logoUrl.toLowerCase();
        let img: any = null;
        if (ct.includes("png") || url.endsWith(".png")) img = await doc.embedPng(bytes);
        else if (ct.includes("jpg") || ct.includes("jpeg") || /\.jpe?g(\?|$)/.test(url)) img = await doc.embedJpg(bytes);
        if (img) {
          const h = 42;
          const w = (img.width / img.height) * h;
          page.drawImage(img, { x: margin, y: y - h, width: w, height: h });
          y -= (h + 12);
        } else {
          console.warn("INVOICE_LOGO_UNSUPPORTED_FORMAT url=" + invCtx.logoUrl + " content-type=" + ct + " — invoice PDFs support PNG/JPG only; re-upload the logo in that format to show it on invoices.");
        }
      }
    } catch (logoErr) {
      console.error("INVOICE_LOGO_ERR url=" + invCtx.logoUrl + ": " + (logoErr instanceof Error ? logoErr.message : String(logoErr)));
    }
  }

  // ── Header ──
  page.drawText(invCtx.companyName || "Tax Invoice", { x: margin, y, font: fontBold, size: 18, color: black });
  page.drawText("TAX INVOICE", { x: W - margin - fontBold.widthOfTextAtSize("TAX INVOICE", 22), y, font: fontBold, size: 22, color: grey });
  y -= 16;
  const regLine = [invCtx.reg ? invCtx.reg : "", invCtx.vat ? "VAT: " + invCtx.vat : ""].filter(Boolean).join("  ");
  if (regLine) page.drawText(regLine, { x: margin, y, font, size: 8, color: grey });
  y -= 30;

  // ── Horizontal line ──
  page.drawLine({ start: { x: margin, y }, end: { x: W - margin, y }, thickness: 1, color: lightGrey });
  y -= 25;

  // ── From / To ──
  page.drawText("From:", { x: margin, y, font: fontBold, size: 10, color: black });
  page.drawText("To:", { x: margin + usable * 0.5, y, font: fontBold, size: 10, color: black });
  y -= 14;
  const fromLines = [invCtx.companyName, ...invCtx.addressLines].filter(Boolean);
  for (const fl of fromLines) {
    page.drawText(fl, { x: margin, y, font, size: 9, color: black });
    y -= 12;
  }
  let toY = y + 12 + fromLines.length * 12 - 14;
  const toLines: string[] = [];
  if (toCompany) toLines.push(toCompany);
  toLines.push(toName);
  if (toPhone) toLines.push(toPhone);
  toLines.push(toEmail);
  if (toVat) toLines.push("VAT: " + toVat);
  for (const tl of toLines) {
    page.drawText(tl, { x: margin + usable * 0.5, y: toY, font, size: 9, color: black });
    toY -= 12;
  }
  // Continue below whichever of From/To is taller so neither overlaps the next row.
  y = Math.min(y, toY);
  y -= 10;

  // ── Invoice details ──
  page.drawLine({ start: { x: margin, y }, end: { x: W - margin, y }, thickness: 1, color: lightGrey });
  y -= 20;
  const detailLabels = ["Invoice #:", "Booking Ref:", "Date:", "Amount Due:"];
  const detailValues = [invNo, ref, invDate, m(Math.max(0, total - amountPaid))];
  for (let di = 0; di < detailLabels.length; di++) {
    page.drawText(detailLabels[di], { x: W - margin - 200, y, font: fontBold, size: 9, color: black });
    page.drawText(detailValues[di], { x: W - margin - 80, y, font: fontMono, size: 9, color: black });
    y -= 14;
  }
  y -= 15;

  // ── Service table ──
  const tableTop = y;
  const colWidths = [usable * 0.45, usable * 0.15, usable * 0.15, usable * 0.25];
  const colX = [margin, margin + colWidths[0], margin + colWidths[0] + colWidths[1], margin + colWidths[0] + colWidths[1] + colWidths[2]];
  const rowH = 20;

  // Header row
  page.drawRectangle({ x: margin, y: tableTop - rowH, width: usable, height: rowH, color: lightGrey });
  const headers = ["Service", "Qty", "Unit Price", "Total (ZAR)"];
  for (let hi = 0; hi < headers.length; hi++) {
    page.drawText(headers[hi], { x: colX[hi] + 5, y: tableTop - 14, font: fontBold, size: 9, color: black });
  }
  y = tableTop - rowH;

  // Data row
  page.drawRectangle({ x: margin, y: y - rowH, width: usable, height: rowH, color: rgb(1, 1, 1) });
  page.drawText(tourName + " (" + tourDate + ")", { x: colX[0] + 5, y: y - 14, font, size: 9, color: black, maxWidth: colWidths[0] - 10 });
  page.drawText(String(qty), { x: colX[1] + 5, y: y - 14, font, size: 9, color: black });
  page.drawText(m(total / qty), { x: colX[2] + 5, y: y - 14, font, size: 9, color: black });
  page.drawText(m(total), { x: colX[3] + 5, y: y - 14, font: fontMono, size: 9, color: black });
  y -= rowH;

  // Table borders
  for (let r = 0; r <= 2; r++) {
    page.drawLine({ start: { x: margin, y: tableTop - r * rowH }, end: { x: W - margin, y: tableTop - r * rowH }, thickness: 0.5, color: grey });
  }
  for (let c = 0; c <= 4; c++) {
    const cx = c < 4 ? colX[c] : W - margin;
    page.drawLine({ start: { x: cx, y: tableTop }, end: { x: cx, y: tableTop - 2 * rowH }, thickness: 0.5, color: grey });
  }
  y -= 10;

  // ── Totals ──
  const totalsX = W - margin - 200;
  const totalsValX = W - margin - 60;

  const totalRows = [
    ["Sub-total (Excl VAT):", m(subtotal)],
    ["VAT - " + (VAT_RATE * 100).toFixed(1) + "%:", m(vatAmt)],
    ["Total:", m(total)],
    ["Amount Paid:", m(amountPaid)],
  ];
  for (const tr of totalRows) {
    page.drawText(tr[0], { x: totalsX, y, font: tr[0] === "Total:" ? fontBold : font, size: 9, color: black });
    page.drawText(tr[1], { x: totalsValX, y, font: fontMono, size: 9, color: black });
    y -= 14;
  }

  // Balance due (highlighted)
  y -= 4;
  page.drawRectangle({ x: totalsX - 5, y: y - 4, width: W - margin - totalsX + 5, height: 18, color: lightGrey });
  page.drawText("Balance Due:", { x: totalsX, y, font: fontBold, size: 10, color: black });
  page.drawText(m(Math.max(0, total - amountPaid)), { x: totalsValX, y, font: fontBold, size: 10, color: black });
  y -= 35;

  // ── Banking Details (only if business has bank details populated) ──
  const hasBank = invCtx.bank.account_number || invCtx.bank.account_owner;
  if (hasBank) {
    page.drawText("Banking Details", { x: margin, y, font: fontBold, size: 12, color: black });
    y -= 18;
    const bankRows = [
      ["Account Owner:", invCtx.bank.account_owner || ""],
      ["Account Number:", invCtx.bank.account_number || ""],
      ["Account Type:", invCtx.bank.account_type || ""],
      ["Bank Name:", invCtx.bank.bank_name || ""],
      ["Branch Code:", invCtx.bank.branch_code || ""],
      ["Reference:", invNo],
    ].filter(row => row[1]);
    for (const br of bankRows) {
      page.drawText(br[0], { x: margin, y, font: fontBold, size: 9, color: black });
      page.drawText(br[1], { x: margin + 110, y, font, size: 9, color: black });
      y -= 13;
    }
  }

  return await doc.save();
}

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function broadcastHtml(d: Record<string, unknown>) {
  let phtml = String(d.message || "Message").replace(/\n/g, '<br>');
  phtml = phtml.replace(/\{name\}/gi, String(d.customer_name || "Guest").split(" ")[0]);
  const unsubUrl = String(d.unsubscribe_url || "");
  // POPIA / CAN-SPAM / GDPR: every mass commercial email must carry a
  // one-click unsubscribe. broadcastHtml previously hid this fact behind a
  // "reply to this email" line. We now ALWAYS render an unsubscribe link
  // when the caller passed a token URL.
  const unsubBlock = unsubUrl
    ? `<p style="color: #A8C2B8; font-size: 11px; line-height: 1.5; margin: 12px 0 0;">Don't want updates like this? <a href="${unsubUrl}" style="color: #fff; text-decoration: underline;">Unsubscribe</a>.</p>`
    : "";
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    </head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #F7F7F6; margin: 0; padding: 20px; color: #333;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);">
        <!-- Header -->
        <tr>
          <td style="background-color: #1b3b36; padding: 20px 30px; text-align: center;">
            <p style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #A8C2B8;">Cape Kayak Adventures</p>
            <h1 style="margin: 10px 0 0 0; font-size: 24px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">Update About Your Trip</h1>
          </td>
        </tr>
        <!-- Hero Image (reuses the operator's confirmation-email hero image — broadcast has no dedicated upload of its own) -->
        ${heroImg("IMG_CONFIRM", "Cape Kayak")}
        <!-- Content -->
        <tr>
          <td style="padding: 40px 40px 40px;">
            <p style="font-size: 16px; line-height: 1.6; color: #333; margin: 0;">${phtml}</p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background-color: #1b3b36; text-align: center; padding: 30px;">
            <p style="font-family: Georgia, serif; font-size: 18px; color: #F7F7F6; margin: 0 0 15px 0;">Cape Kayak</p>
            <p style="color: #A8C2B8; font-size: 12px; line-height: 1.5; margin: 0;">Three Anchor Bay, Sea Point, Cape Town<br>
            If you have any questions, reply to this email or contact us on WhatsApp.</p>
            ${unsubBlock}
          </td>
        </tr>
      </table>
    </body>
    </html>`;
}

function popiaConfirmRequestHtml(d: Record<string, unknown>) {
  return `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <h2 style="color: #1b3b36; margin-bottom: 20px;">Confirm Your Data Request</h2>
    <p style="font-size: 15px; color: #333; line-height: 1.6;">
      We received your <strong>${d.request_type}</strong> request. To proceed, please confirm by clicking the button below.
    </p>
    <p style="font-size: 13px; color: #666; line-height: 1.5;">
      This link expires in <strong>24 hours</strong>. If you did not make this request, you can safely ignore this email.
    </p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${d.confirm_url}" style="display: inline-block; background-color: #1b3b36; color: #fff; text-decoration: none; padding: 14px 40px; border-radius: 8px; font-size: 16px; font-weight: bold;">Confirm Request</a>
    </div>
    <p style="font-size: 12px; color: #999;">If the button doesn't work, copy and paste this URL into your browser:<br>${d.confirm_url}</p>
  </div>`;
}

function popiaRequestConfirmedHtml(d: Record<string, unknown>) {
  const schedDate = d.scheduled_for ? new Date(String(d.scheduled_for)).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" }) : "30 days from now";
  return `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <h2 style="color: #1b3b36; margin-bottom: 20px;">Your Request Is Confirmed</h2>
    <p style="font-size: 15px; color: #333; line-height: 1.6;">
      Your <strong>${d.request_type}</strong> request has been confirmed and is scheduled for processing on <strong>${schedDate}</strong>.
    </p>
    <p style="font-size: 14px; color: #555; line-height: 1.6;">
      You have 30 days to cancel this request if you change your mind. After that date, it will be reviewed and processed by the business.
    </p>
    <p style="font-size: 13px; color: #888; margin-top: 20px;">Under South Africa's Protection of Personal Information Act (POPIA), you have the right to access, correct, or delete your personal data.</p>
  </div>`;
}

function popiaRequestFulfilledHtml(d: Record<string, unknown>) {
  return `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <h2 style="color: #1b3b36; margin-bottom: 20px;">Your Data Request Has Been Processed</h2>
    <p style="font-size: 15px; color: #333; line-height: 1.6;">
      Your <strong>${d.request_type}</strong> request has been fulfilled.
    </p>
    ${String(d.request_type) === "DELETION" ? `<p style="font-size: 14px; color: #555; line-height: 1.6;">
      Your personal information (name, email, phone, etc.) has been permanently removed from our systems.
      An anonymized record of your past bookings has been retained for financial and tax compliance purposes (SARS 5-year requirement),
      but it can no longer be linked back to you.
    </p>` : `<p style="font-size: 14px; color: #555; line-height: 1.6;">Your request has been processed. If you have any questions, please contact us.</p>`}
  </div>`;
}

function popiaRequestRejectedHtml(d: Record<string, unknown>) {
  return `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <h2 style="color: #1b3b36; margin-bottom: 20px;">Update on Your Data Request</h2>
    <p style="font-size: 15px; color: #333; line-height: 1.6;">
      We've reviewed your <strong>${d.request_type}</strong> request but are unable to fulfill it at this time.
    </p>
    <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 16px; border-radius: 4px; margin: 20px 0;">
      <p style="margin: 0; font-size: 14px; color: #991b1b;"><strong>Reason:</strong> ${d.reason}</p>
    </div>
    <p style="font-size: 13px; color: #666; line-height: 1.5;">
      Under POPIA Section 11(3), a responsible party may refuse a request if it falls under a lawful exemption (e.g. active legal proceedings, financial record retention requirements).
      If you believe this decision is incorrect, you may lodge a complaint with the Information Regulator at <a href="https://inforegulator.org.za">inforegulator.org.za</a>.
    </p>
  </div>`;
}

function popiaExportReadyHtml(d: Record<string, unknown>) {
  const expiryDate = d.expires_at ? new Date(String(d.expires_at)).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" }) : "7 days";
  return `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <h2 style="color: #1b3b36; margin-bottom: 20px;">Your Data Export Is Ready</h2>
    <p style="font-size: 15px; color: #333; line-height: 1.6;">
      Your personal data export has been generated and is ready for download.
    </p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${d.export_url}" style="display: inline-block; background-color: #1b3b36; color: #fff; text-decoration: none; padding: 14px 40px; border-radius: 8px; font-size: 16px; font-weight: bold;">Download Export</a>
    </div>
    <p style="font-size: 13px; color: #888;">This download link expires on <strong>${expiryDate}</strong>. The file contains all personal information we hold about you in JSON format.</p>
  </div>`;
}

function magicLinkHtml(d: Record<string, unknown>) {
  const action = String(d.action_type || "magiclink");
  const isSignup = action === "signup";
  const isRecovery = action === "recovery";
  const heading = isSignup ? "Confirm your email" : isRecovery ? "Reset your password" : "Sign in to your bookings";
  const cta = isSignup ? "Confirm Email" : isRecovery ? "Reset Password" : "Sign In";
  const intro = isSignup
    ? "Click the button below to confirm your email and finish signing up. This link expires in 1 hour."
    : isRecovery
      ? "Click the button below to choose a new password. This link expires in 1 hour."
      : "Click the button below to sign in to manage your bookings. This link expires in 1 hour.";
  const otp = String(d.otp_code || "");
  return `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <h2 style="color: #1b3b36; margin-bottom: 20px;">${heading}</h2>
    <p style="font-size: 15px; color: #333; line-height: 1.6;">${intro}</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${d.magic_link_url}" style="display: inline-block; background-color: #1b3b36; color: #fff; text-decoration: none; padding: 14px 40px; border-radius: 8px; font-size: 16px; font-weight: bold;">${cta}</a>
    </div>
    ${otp ? `<p style="font-size: 14px; color: #555; text-align: center;">Or enter this 6-digit code on the sign-in page:</p>
    <p style="font-size: 28px; letter-spacing: 6px; font-weight: bold; color: #1b3b36; text-align: center; margin: 12px 0;">${escHtml(otp)}</p>` : ""}
    <p style="font-size: 13px; color: #888;">If you didn&rsquo;t request this, you can safely ignore this email.</p>
  </div>`;
}

// Resolve tenant business_id from a Supabase Auth redirect URL — the tenant is
// the leftmost subdomain (e.g. `aonyx` in `aonyx.booking.bookingtours.co.za`).
// Returns null when no business matches or the URL is unparseable.
async function resolveTenantFromRedirect(redirectUrl: string): Promise<string | null> {
  if (!redirectUrl || !supabase) return null;
  try {
    const u = new URL(redirectUrl);
    const sub = u.hostname.split(".")[0];
    if (!sub || sub === "booking" || sub === "www") return null;
    const { data } = await supabase.from("businesses").select("id").eq("subdomain", sub).maybeSingle();
    return data?.id ?? null;
  } catch {
    return null;
  }
}

Deno.serve(withSentry("send-email", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCors(req) });

  try {
    if (!RESEND_API_KEY) {
      console.error("SEND_EMAIL: RESEND_API_KEY not configured");
      return new Response(JSON.stringify({ error: "Email service not configured" }), { status: 503, headers: getCors(req) });
    }

    // Read raw body once so we can both JSON-parse it and HMAC-verify it (the
    // Supabase Auth Send Email Hook signs the request via standard-webhooks).
    const rawBody = await req.text();
    let parsedBody: Record<string, unknown>;
    try { parsedBody = JSON.parse(rawBody); }
    catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: getCors(req) }); }

    // Supabase Auth Hook payload shape: { user, email_data }. When this is
    // present we verify the standard-webhooks signature and convert to the
    // internal { type, data } shape that the switch below already knows.
    const isAuthHook = parsedBody && typeof parsedBody === "object" && (parsedBody as Record<string, unknown>).user && (parsedBody as Record<string, unknown>).email_data && !(parsedBody as Record<string, unknown>).type;
    if (isAuthHook) {
      if (!SEND_EMAIL_HOOK_SECRET) {
        console.error("SEND_EMAIL_AUTH_HOOK: SEND_EMAIL_HOOK_SECRET not configured — rejecting to avoid arbitrary magic-link sends");
        return new Response(JSON.stringify({ error: "Auth hook not configured on this function" }), { status: 503, headers: getCors(req) });
      }
      try {
        const wh = new Webhook(SEND_EMAIL_HOOK_SECRET);
        await wh.verify(rawBody, {
          "webhook-id": req.headers.get("webhook-id") || "",
          "webhook-timestamp": req.headers.get("webhook-timestamp") || "",
          "webhook-signature": req.headers.get("webhook-signature") || "",
        });
      } catch (sigErr) {
        console.error("SEND_EMAIL_AUTH_HOOK_BAD_SIG:", sigErr);
        return new Response(JSON.stringify({ error: "Invalid hook signature" }), { status: 401, headers: getCors(req) });
      }
      const user = (parsedBody as { user: Record<string, unknown> }).user;
      const ed = (parsedBody as { email_data: Record<string, unknown> }).email_data;
      const action = String(ed.email_action_type || "magiclink");
      if (action !== "magiclink" && action !== "signup" && action !== "recovery") {
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: "unsupported action " + action }), { status: 200, headers: getCors(req) });
      }
      const redirectTo = String(ed.redirect_to || "");
      const siteUrl = String(ed.site_url || "");
      const tokenHash = String(ed.token_hash || "");
      const verifyUrl = (siteUrl ? siteUrl.replace(/\/+$/, "") : "")
        + "/auth/v1/verify?token=" + encodeURIComponent(tokenHash)
        + "&type=" + encodeURIComponent(action)
        + "&redirect_to=" + encodeURIComponent(redirectTo);
      const tenantId = await resolveTenantFromRedirect(redirectTo);
      parsedBody = {
        type: "MAGIC_LINK",
        data: {
          business_id: tenantId,
          email: user.email,
          customer_name: (user.user_metadata as Record<string, unknown> | undefined)?.name || "",
          magic_link_url: verifyUrl,
          otp_code: String(ed.token || ""),
          action_type: action,
        },
      };
    }

    const type = (parsedBody as { type?: string }).type as string;
    let d = (parsedBody as { data?: Record<string, unknown> }).data as Record<string, unknown>;

    // Escape user-controlled fields to prevent HTML injection in email templates
    const fieldsToEscape = ["customer_name", "recipient_name", "buyer_name", "gift_message", "reason", "cancel_reason", "ref", "tour_name", "invoice_number", "note", "intro", "heading", "customer_phone", "customer_email", "business_name", "plan_name"];
    for (let fi = 0; fi < fieldsToEscape.length; fi++) {
      const fk = fieldsToEscape[fi];
      if (d[fk] && typeof d[fk] === "string") d[fk] = escHtml(d[fk] as string);
    }

    let branding: Awaited<ReturnType<typeof loadEmailBranding>>;
    try {
      branding = await loadEmailBranding(d);
    } catch (brandErr) {
      console.error("BRANDING_LOAD_ERR (using fallbacks):", brandErr);
      const fb = String(d.business_name || d.brand_name || "Your Booking");
      branding = { businessId: "", brandName: fb, timezone: "UTC", shortBrandName: fb, footerLineOne: "Thanks for choosing " + fb + ".", footerLineTwo: "Reply to this email if you need anything.", manageBookingUrl: "", bookingSiteUrl: "", voucherUrl: "", waiverUrl: "", directions: "", fromEmail: FROM_EMAIL, replyToEmail: "", emailColor: "#1b3b36", meetingPointAddress: "", arrivalInstructions: "", businessAddress: "", whatToBring: "", activityVerbPast: "", emailTagline: "", logoUrl: "", imgPayment: "", imgConfirm: "", imgInvoice: "", imgGift: "", imgCancel: "", imgCancelWeather: "", imgIndemnity: "", imgAdmin: "", imgVoucher: "", imgPhotos: "", socialFacebook: "", socialInstagram: "", socialTiktok: "", socialYoutube: "", socialTwitter: "", socialLinkedin: "", socialTripadvisor: "", socialGoogleReviews: "" };
    }

    if (type === "BOOKING_CONFIRM" || type === "INDEMNITY" || type === "REMINDER") {
      try { d = await enrichWaiverEmailData(d); } catch (wErr) { console.error("WAIVER_ENRICH_ERR:", wErr); }
    }

    // Validate recipient email before processing the template
    const recipientEmail = String(d.email || "").trim();
    if (!recipientEmail || !isValidEmail(recipientEmail)) {
      console.warn("SEND_EMAIL_SKIP type=" + type + " invalid_email=" + recipientEmail);
      return new Response(JSON.stringify({ ok: false, error: "invalid_email", message: "Recipient email '" + recipientEmail + "' is missing or invalid" }), { status: 200, headers: getCors(req) });
    }
    d.email = recipientEmail;

    console.log("SEND_EMAIL type=" + type + " to=" + (d.email || "?") + " biz=" + branding.businessId + " manage=" + branding.manageBookingUrl + " site=" + branding.bookingSiteUrl);

    // Inject resolved URLs into data so templates can use them directly via ${d._manageUrl}
    // This avoids relying solely on the {{BOOKING_URL}} placeholder replacement in applyBranding
    d._manageUrl = branding.manageBookingUrl || (branding.bookingSiteUrl ? branding.bookingSiteUrl.replace(/\/+$/, "") + "/my-bookings" : "");
    d._siteUrl = branding.bookingSiteUrl || "";
    d._emailTagline = branding.emailTagline || "";
    // Per-tour tagline wins over the account-wide one. Every BOOKING_CONFIRM
    // caller passes booking_id, and send-email already does bookings→tours
    // joins by id (see below), so this needs no changes on the sending side.
    if (type === "BOOKING_CONFIRM" && d.booking_id && supabase) {
      try {
        const tt = await supabase.from("bookings").select("tours(confirmation_tagline)").eq("id", String(d.booking_id)).maybeSingle();
        const tag = (tt.data as { tours?: { confirmation_tagline?: string } } | null)?.tours?.confirmation_tagline;
        if (tag && String(tag).trim()) d._emailTagline = String(tag).trim();
      } catch (tagErr) {
        console.error("TOUR_TAGLINE_LOOKUP_ERR:", tagErr);
      }
    }

    // Central guard: senders should pass tenant-formatted date strings, but a
    // raw ISO timestamp still slips through from older callers — format it
    // here so no template ever renders "2026-07-11T10:00:00+00:00".
    if (typeof d.start_time === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(d.start_time) && !Number.isNaN(Date.parse(d.start_time))) {
      d.start_time = formatTenantDateTime({ id: branding.businessId, timezone: branding.timezone }, d.start_time);
    }

    // Multi-day tours: render tour_date as a range ("Mon, 13 Jul, 09:00 – Wed, 15 Jul").
    // Whole-day durations end ON the last day, matching the booking-site display.
    if (typeof d.tour_date === "string" && d.tour_date && !d.tour_date.includes("–") && supabase) {
      try {
        const rangeBookingId = String(d.booking_id || "").trim();
        if (rangeBookingId) {
          const bres = await supabase.from("bookings").select("slots(start_time), tours(duration_minutes)").eq("id", rangeBookingId).maybeSingle();
          const row = bres.data as { slots?: { start_time?: string }; tours?: { duration_minutes?: number } } | null;
          const durMin = Number(row?.tours?.duration_minutes || 0);
          const startIso = row?.slots?.start_time;
          const end = startIso ? tourEndDate(startIso, durMin) : null;
          if (end && durMin >= 1440) {
            const endStr = formatTenantDateTime({ id: branding.businessId, timezone: branding.timezone }, end.toISOString(), { hour: undefined, minute: undefined });
            d.tour_date = d.tour_date + " – " + endStr;
          }
        }
      } catch (e) { console.warn("TOUR_DATE_RANGE_ERR:", e); }
    }

    // Last resort: if URL is still empty, try to construct from business_id lookup
    if (!d._manageUrl && d.business_id && supabase) {
      try {
        const bizLookup = await supabase.from("businesses").select("subdomain, manage_bookings_url, booking_site_url").eq("id", String(d.business_id)).maybeSingle();
        if (bizLookup.data) {
          d._manageUrl = String(bizLookup.data.manage_bookings_url || (bizLookup.data.booking_site_url ? String(bizLookup.data.booking_site_url).replace(/\/+$/, "") + "/my-bookings" : (bizLookup.data.subdomain ? "https://" + bizLookup.data.subdomain + ".booking.bookingtours.co.za/my-bookings" : "")));
          d._siteUrl = String(bizLookup.data.booking_site_url || (bizLookup.data.subdomain ? "https://" + bizLookup.data.subdomain + ".booking.bookingtours.co.za" : ""));
          console.log("BRANDING_LASTRESORT manage=" + d._manageUrl);
        }
      } catch (e) { console.warn("BRANDING_LASTRESORT_ERR:", e); }
    }
    if (!d._manageUrl) {
      console.error("BRANDING_EMPTY_URL: no manage URL resolved for type=" + type + " biz=" + branding.businessId);
    }

    let subject = "";
    let html = "";
    let bcc: string | undefined;

    switch (type) {
      case "MY_BOOKINGS_OTP":
        subject = "Your verification code";
        html = myBookingsOtpHtml(d);
        break;
      case "PAYMENT_LINK":
        subject = "Cape Kayak - Payment Link (Ref: " + d.ref + ")";
        html = paymentLinkHtml(d);
        break;
      case "PAYMENT_REMINDER":
        subject = "Reminder: payment outstanding for your upcoming " + (d.tour_name || "booking");
        html = paymentLinkHtml({
          ...d,
          heading: "Your trip is coming up",
          intro: "Just a friendly reminder: your <strong>" + (d.tour_name || "booking") + "</strong> is coming up soon and we haven't received your payment yet. You can pay securely below to keep your spot.",
        });
        break;
      case "RESCHEDULE_PAYMENT_LINK":
        subject = "Cape Kayak - Reschedule payment due (Ref: " + d.ref + ")";
        html = reschedulePaymentLinkHtml(d);
        break;
      case "VOUCHER_PAYMENT_LINK":
        subject = "Cape Kayak - Gift Voucher Payment Link";
        html = voucherPaymentLinkHtml(d);
        break;
      case "BOOKING_CONFIRM":
        subject = "Cape Kayak - Booking Confirmed! (Ref: " + d.ref + ")";
        html = bookingConfirmHtml(d);
        break;
      case "BOOKING_UPDATED":
        subject = "Cape Kayak - Booking Updated (Ref: " + d.ref + ")";
        html = bookingUpdatedHtml(d);
        break;
      case "INVOICE": {
        const invCtxHtml = await getInvoiceContext(branding.businessId);
        subject = (invCtxHtml.companyName || "Tax Invoice") + " - Tax Invoice " + d.invoice_number;
        html = invoiceHtml(d, invCtxHtml);
        bcc = d.admin_email as string;
        break;
      }
      case "PLATFORM_INVOICE_OUTSTANDING": {
        // Uses BookingTours' own branding (platform_settings), never the
        // operator's — deliberately does NOT reuse the `invoice_number` field
        // name (see `platform_invoice_number` in the payload) so this never
        // triggers resolveBrandingBusinessId's tenant-invoice lookup above.
        const platCtx = await getPlatformInvoiceContext();
        subject = "BookingTours: Invoice " + d.platform_invoice_number + " outstanding";
        html = platformInvoiceOutstandingHtml(d, platCtx);
        break;
      }
      case "GIFT_VOUCHER": {
        const gvMode = String(d.gift_recipient_mode || "buyer_forward");
        subject = gvMode === "recipient"
          ? "🎁 " + d.recipient_name + ", you've received a gift!"
          : gvMode === "buyer_receipt"
            ? "Your gift for " + d.recipient_name + " is on its way"
            : "🎁 Cape Kayak - Your gift voucher for " + d.recipient_name;
        html = giftVoucherHtml(d);
        bcc = d.admin_email as string;
        break;
      }
      case "CANCELLATION":
        subject = "Cape Kayak - Booking Cancelled (Ref: " + d.ref + ")";
        html = cancellationHtml(d);
        break;
      case "INDEMNITY":
        subject = "Cape Kayak - Indemnity & Waiver (Ref: " + d.ref + ")";
        html = indemnityHtml(d);
        break;
      case "REMINDER":
        // Email fallback for the trip reminder (sent only when WhatsApp
        // fails). Same body as INDEMNITY — it renders the trip details and
        // handles both signed and unsigned waiver states.
        subject = "Cape Kayak - Your trip is tomorrow (Ref: " + d.ref + ")";
        html = indemnityHtml(d);
        break;
      case "VOUCHER":
        subject = "Cape Kayak - Your Voucher Code";
        html = voucherHtml(d);
        break;
      case "VOUCHER_BALANCE":
        subject = "Cape Kayak - Voucher Balance: R" + (d.remaining_balance || 0) + " remaining";
        html = voucherBalanceHtml(d);
        break;
      case "BROADCAST":
        subject = d.subject ? String(d.subject) : "Cape Kayak - Important Update";
        html = broadcastHtml(d);
        break;
      case "ADMIN_WELCOME":
        if (d.reason === "RESET") {
          subject = "Reset Your Admin Password";
          html = adminResetPasswordHtml(d);
        } else {
          subject = "Cape Kayak Admin - You've Been Added";
          html = adminWelcomeHtml(d);
        }
        break;
      case "TRIP_PHOTOS":
        subject = "Cape Kayak - Your Trip Photos Are Ready! 📸";
        html = tripPhotosHtml(d);
        break;
      case "SETTLEMENT_REQUEST":
        // Operator B asks operator A to pay their combo share via Yoco link.
        subject = (d.requester_name || "Your partner") + " requested combo settlement: R" + d.amount;
        html = settlementRequestHtml(d);
        break;
      case "PARTNERSHIP_INVITE":
        // Operator-to-operator combo partnership invite (Partners dashboard).
        subject = (d.inviter_name || "A BookingTours operator") + " wants to partner with you on BookingTours";
        html = partnershipInviteHtml(d);
        break;
      case "OPERATOR_ALERT":
        // Internal alert TO the operator (notification_email), not a customer.
        subject = String(d.heading || "New alert") + (d.ref ? ": " + d.ref : "");
        html = operatorAlertHtml(d);
        break;
      case "CUSTOMER_MESSAGE":
        // Email fallback for an operator's WhatsApp reply the customer couldn't
        // receive on WhatsApp (item 21). applyBranding swaps in the tenant brand.
        subject = "A message from Cape Kayak Adventures";
        html = customerMessageHtml(d);
        break;
      case "MARKETING_TEST": {
        // Admin preview of a marketing template. We do NOT touch the queue or
        // generate per-recipient unsubscribe tokens here — the body runs
        // through the same token map real sends use (_shared/marketing-tokens)
        // so no {token} ever reaches an inbox raw. Real business name and site
        // URL; obviously-sample voucher/promo values, since a preview has no
        // voucher behind it.
        const testTokens = {
          first_name: String(d.first_name || "Admin"),
          business_name: branding.brandName,
          site_url: branding.bookingSiteUrl,
          voucher_code: "SAMPLE-CODE",
          voucher_amount: "R500",
          promo_code: "SAMPLE10",
          promo_discount: "10%",
        };
        subject = fillMarketingTokens(String(d.subject_line || "[TEST] Marketing preview"), testTokens);
        html = fillMarketingTokens(String(d.html_content || "<p>No content</p>"), testTokens)
          .replace(/\{\{unsubscribe_url\}\}/g, SUPABASE_URL + "/functions/v1/marketing-unsubscribe?token=preview");
        break;
      }
      case "POPIA_CONFIRM_REQUEST":
        subject = "Confirm Your Data Request";
        html = popiaConfirmRequestHtml(d);
        break;
      case "POPIA_REQUEST_CONFIRMED":
        subject = "Your Data Request Has Been Confirmed";
        html = popiaRequestConfirmedHtml(d);
        break;
      case "POPIA_REQUEST_FULFILLED":
        subject = "Your Data Request Has Been Processed";
        html = popiaRequestFulfilledHtml(d);
        break;
      case "POPIA_REQUEST_REJECTED":
        subject = "Update on Your Data Request";
        html = popiaRequestRejectedHtml(d);
        break;
      case "POPIA_EXPORT_READY":
        subject = "Your Data Export Is Ready";
        html = popiaExportReadyHtml(d);
        break;
      case "MAGIC_LINK": {
        const action = String(d.action_type || "magiclink");
        subject = action === "signup"
          ? "Confirm your email · " + branding.brandName
          : action === "recovery"
            ? "Reset your password · " + branding.brandName
            : "Sign in to " + branding.brandName;
        html = magicLinkHtml(d);
        break;
      }
      default:
        return new Response(JSON.stringify({ error: "Unknown email type: " + type }), { status: 400, headers: getCors(req) });
    }

    // Build tax invoice PDF attachment for INVOICE and BOOKING_CONFIRM emails
    let attachments: Array<{ filename: string; content: string }> | undefined;
    if (type === "INVOICE" || type === "BOOKING_CONFIRM") {
      try {
        if (d.invoice_number) {
          const invNum = String(d.invoice_number);
          const invCtx = await getInvoiceContext(branding.businessId);
          const pdfBytes = await buildInvoicePdf(d, invCtx);
          let pdfB64 = "";
          for (let pi = 0; pi < pdfBytes.length; pi++) pdfB64 += String.fromCharCode(pdfBytes[pi]);
          pdfB64 = btoa(pdfB64);
          attachments = [{ filename: "TaxInvoice-" + invNum + ".pdf", content: pdfB64 }];
        }
      } catch (pfErr) {
        console.error("PDF_INVOICE_ERR:", pfErr);
      }
    }

    console.log("BRANDING_URLS type=" + type + " biz=" + branding.businessId + " manage=" + branding.manageBookingUrl + " site=" + branding.bookingSiteUrl);
    const branded = applyBranding(subject, html, branding);
    // Marketing-class email types get a List-Unsubscribe header so mailbox
    // providers don't dump them in spam. The header URL is the same as the
    // footer link the caller already passed in (no per-recipient token
    // generation here — broadcast/marketing-dispatch generate that upstream).
    const isMarketingClass = type === "BROADCAST" || type === "MARKETING_TEST";
    const unsubForHeader = isMarketingClass && typeof d.unsubscribe_url === "string" && d.unsubscribe_url
      ? String(d.unsubscribe_url)
      : undefined;
    const result = await sendResend(d.email as string, branding.fromEmail, branded.subject, branded.html, bcc, attachments, branding.replyToEmail, unsubForHeader);
    if (!result.ok) {
      // Surface the upstream failure to the caller as a non-2xx so that
      // supabase.functions.invoke sets `.error` and callers can't mistake a
      // failed send for success. Body keeps the original Resend status for
      // diagnostics. (Auth-hook "skipped" and invalid_email stay 200 — those
      // are not Resend send failures.)
      return new Response(JSON.stringify({ ok: false, error: result.error || "send_failed", message: result.message, status: result.status }), { status: 502, headers: getCors(req) });
    }
    return new Response(JSON.stringify({ ok: true, id: result.id }), { status: 200, headers: getCors(req) });
  } catch (err: unknown) {
    console.error("SEND_EMAIL_ERR:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: getCors(req) });
  }
}));
