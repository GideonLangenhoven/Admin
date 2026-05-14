// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { withSentry } from "../_shared/sentry.ts";
import { getWaiverContext } from "../_shared/waiver.ts";
import { getAdminAppOrigins, isAllowedOrigin } from "../_shared/tenant.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
const SETTINGS_ENCRYPTION_KEY = Deno.env.get("SETTINGS_ENCRYPTION_KEY") || "";
// Platform-wide default sender — uses bookingtours.co.za which is verified in Resend.
// Per-tenant emails auto-derive from subdomain: noreply@{slug}.bookingtours.co.za
const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "BookingTours <noreply@bookingtours.co.za>";
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

async function sendResend(to: string, fromEmail: string, subject: string, html: string, bcc?: string, attachments?: Array<{ filename: string; content: string }>, replyTo?: string) {
  // Validate email format before attempting to send
  if (!to || !isValidEmail(to)) {
    console.warn("RESEND_SKIP invalid email format: to=" + to + " subject=" + subject);
    return { error: "invalid_email_format", message: "Email address '" + to + "' has an invalid format" };
  }
  // Always send FROM a platform-controlled domain to pass DMARC/SPF.
  // The tenant's email goes in Reply-To so customers reply to the right place.
  const payload: Record<string, unknown> = { from: fromEmail || FROM_EMAIL, to: [to], subject, html };
  if (replyTo && isValidEmail(replyTo)) payload.reply_to = replyTo;
  if (bcc) payload.bcc = [bcc];
  if (attachments && attachments.length > 0) payload.attachments = attachments;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("RESEND_ERR status=" + res.status + " from=" + (fromEmail || FROM_EMAIL) + " to=" + to + " subject=" + subject + ":", JSON.stringify(data));
    // Log specific failure reasons for operational visibility
    if (data?.name === "validation_error") {
      console.warn("RESEND_VALIDATION_FAIL to=" + to + ": " + (data?.message || "unknown validation error"));
    }
    if (res.status === 422) {
      console.warn("RESEND_BOUNCE_LIKELY to=" + to + " — address may be invalid or previously bounced");
    }
  } else {
    console.log("RESEND_OK id=" + data?.id + " to=" + to + " subject=" + subject);
  }
  return data;
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
      meetingPointAddress: "", arrivalInstructions: "", businessAddress: "", whatToBring: "", activityVerbPast: "",
    };
  }

  let data: Record<string, unknown> | null = null;
  try {
    const res = await supabase
      .from("businesses")
      .select("id, name, business_name, subdomain, notification_email, footer_line_one, footer_line_two, manage_bookings_url, booking_site_url, gift_voucher_url, waiver_url, directions, email_color, email_img_payment, email_img_confirm, email_img_invoice, email_img_gift, email_img_cancel, email_img_cancel_weather, email_img_indemnity, email_img_admin, email_img_voucher, email_img_photos, social_facebook, social_instagram, social_tiktok, social_youtube, social_twitter, social_linkedin, social_tripadvisor, social_google_reviews, meeting_point_address, arrival_instructions, business_address, what_to_bring, activity_verb_past, location_phrase")
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
        .select("id, name, business_name, notification_email, footer_line_one, footer_line_two, manage_bookings_url, booking_site_url, gift_voucher_url, waiver_url, directions")
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
  };
}

type InvoiceContext = {
  companyName: string;
  addressLines: string[];
  reg: string;
  vat: string;
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
    bank: { account_owner: null, account_number: null, account_type: null, bank_name: null, branch_code: null },
  };
  if (!businessId || !supabase) return empty;

  const { data: biz } = await supabase
    .from("businesses")
    .select("business_name, invoice_company_name, invoice_address_line1, invoice_address_line2, invoice_address_line3, invoice_reg_number, invoice_vat_number")
    .eq("id", businessId)
    .maybeSingle();

  const companyName = String(biz?.invoice_company_name || biz?.business_name || "");
  const addressLines = [biz?.invoice_address_line1, biz?.invoice_address_line2, biz?.invoice_address_line3].filter(Boolean) as string[];
  const reg = String(biz?.invoice_reg_number || "");
  const vat = String(biz?.invoice_vat_number || "");

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

  return { companyName, addressLines, reg, vat, bank };
}

function buildSocialIconsHtml(branding: { socialFacebook: string; socialInstagram: string; socialTiktok: string; socialYoutube: string; socialTwitter: string; socialLinkedin: string; socialTripadvisor: string; socialGoogleReviews: string; emailColor?: string }) {
  const icons: string[] = [];
  const iconStyle = "display: inline-block; margin: 0 6px; text-decoration: none;";
  const svgStyle = "width: 24px; height: 24px;";
  // Use accent color derived from brand, fallback to light muted
  const fill = "#A8C2B8";

  if (branding.socialFacebook) icons.push(`<a href="${branding.socialFacebook}" style="${iconStyle}" target="_blank"><svg style="${svgStyle}" viewBox="0 0 24 24" fill="${fill}"><path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z"/></svg></a>`);
  if (branding.socialInstagram) icons.push(`<a href="${branding.socialInstagram}" style="${iconStyle}" target="_blank"><svg style="${svgStyle}" viewBox="0 0 24 24" fill="${fill}"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12s.014 3.668.072 4.948c.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24s3.668-.014 4.948-.072c4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948s-.014-3.667-.072-4.947c-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg></a>`);
  if (branding.socialTiktok) icons.push(`<a href="${branding.socialTiktok}" style="${iconStyle}" target="_blank"><svg style="${svgStyle}" viewBox="0 0 24 24" fill="${fill}"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 0010.86 4.44v-7.15a8.16 8.16 0 005.58 2.18V11.2a4.85 4.85 0 01-3.59-1.57V6.69h3.59z"/></svg></a>`);
  if (branding.socialYoutube) icons.push(`<a href="${branding.socialYoutube}" style="${iconStyle}" target="_blank"><svg style="${svgStyle}" viewBox="0 0 24 24" fill="${fill}"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg></a>`);
  if (branding.socialTwitter) icons.push(`<a href="${branding.socialTwitter}" style="${iconStyle}" target="_blank"><svg style="${svgStyle}" viewBox="0 0 24 24" fill="${fill}"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></a>`);
  if (branding.socialLinkedin) icons.push(`<a href="${branding.socialLinkedin}" style="${iconStyle}" target="_blank"><svg style="${svgStyle}" viewBox="0 0 24 24" fill="${fill}"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg></a>`);
  if (branding.socialTripadvisor) icons.push(`<a href="${branding.socialTripadvisor}" style="${iconStyle}" target="_blank"><svg style="${svgStyle}" viewBox="0 0 24 24" fill="${fill}"><path d="M12.006 4.295c-2.67 0-5.338.784-7.645 2.353H0l1.963 2.135a5.997 5.997 0 004.04 10.43 5.976 5.976 0 004.075-1.6L12 19.545l1.922-1.932a5.976 5.976 0 004.075 1.6 5.997 5.997 0 004.04-10.43L24 6.648h-4.35a13.573 13.573 0 00-7.644-2.353zM6.003 17.213a3.997 3.997 0 110-7.994 3.997 3.997 0 010 7.994zm11.994 0a3.997 3.997 0 110-7.994 3.997 3.997 0 010 7.994zM6.003 11.219a2 2 0 100 4 2 2 0 000-4zm11.994 0a2 2 0 100 4 2 2 0 000-4z"/></svg></a>`);
  if (branding.socialGoogleReviews) icons.push(`<a href="${branding.socialGoogleReviews}" style="${iconStyle}" target="_blank"><svg style="${svgStyle}" viewBox="0 0 24 24" fill="${fill}"><path d="M12 0C5.372 0 0 5.373 0 12s5.372 12 12 12c6.627 0 12-5.373 12-12S18.627 0 12 0zm.14 19.018c-3.868 0-7-3.14-7-7.018 0-3.878 3.132-7.018 7-7.018 1.89 0 3.47.697 4.682 1.829l-1.974 1.896c-.508-.486-1.394-1.052-2.708-1.052-2.322 0-4.218 1.924-4.218 4.345s1.897 4.345 4.218 4.345c2.703 0 3.718-1.945 3.875-2.951h-3.875v-2.485h6.447c.075.407.134.812.134 1.345 0 4.014-2.686 6.764-6.581 6.764z"/></svg></a>`);

  if (icons.length === 0) return "";
  return `<table cellpadding="0" cellspacing="0" style="margin: 14px auto 0;"><tr><td style="text-align: center;">${icons.join("")}</td></tr></table>`;
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

  // Replace arrival instructions + what-to-bring (Prompt 23)
  if (branding.arrivalInstructions || branding.whatToBring) {
    brandedHtml = brandedHtml
      .split("Please arrive 15 minutes before launch.<br>Bring sunscreen, a hat, a towel, and a water bottle.")
      .join((branding.arrivalInstructions || "Please arrive 15 minutes before launch.") + (branding.whatToBring ? "<br>" + branding.whatToBring : ""));
  }

  // Replace Google Reviews URL (Prompt 23)
  if (branding.socialGoogleReviews) {
    brandedHtml = brandedHtml
      .split("https://search.google.com/local/writereview?placeid=ChIJ9a9I09RHzB0Rh9R8O4pM7aQ")
      .join(branding.socialGoogleReviews);
  }

  // Replace activity verb (Prompt 23)
  brandedHtml = brandedHtml
    .split("Thank you for paddling with")
    .join("Thank you for " + (branding.activityVerbPast || "adventuring") + " with");

  // Replace hardcoded Google Maps URL with business directions or remove it
  if (branding.directions) {
    brandedHtml = brandedHtml.split("https://www.google.com/maps/search/?api=1&query=Cape+Kayak+Adventures+180+Beach+Rd+Three+Anchor+Bay+Cape+Town+8005").join(
      "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(branding.directions)
    );
  }

  // Inject social media icons inside the dark email footer
  const socialHtml = buildSocialIconsHtml(branding);
  if (socialHtml) {
    // Find the footer </td> — it's the last </td> before </body>
    const bodyClose = brandedHtml.lastIndexOf("</body>");
    if (bodyClose > -1) {
      const footerTdClose = brandedHtml.lastIndexOf("</td>", bodyClose);
      if (footerTdClose > -1) {
        brandedHtml = brandedHtml.slice(0, footerTdClose) + "\n            " + socialHtml + "\n          " + brandedHtml.slice(footerTdClose);
      }
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
            <h1 style="margin: 10px 0 0 0; font-size: 30px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">Complete Your Reservation</h1>
          </td>
        </tr>
        ${heroImg("IMG_PAYMENT", "Cape Kayak")}
        <!-- Content -->
        <tr>
          <td style="padding: 40px 40px 10px; text-align: center;">
            <h2 style="font-size: 24px; font-family: Georgia, serif; margin: 0 0 15px 0; color: #1b3b36;">Hi ${d.customer_name},</h2>
            <p style="font-size: 16px; line-height: 1.6; color: #555; margin: 0 0 30px 0;">You're almost there. Please complete your payment below to secure your spots for the <strong>${d.tour_name}</strong>.</p>
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
  // Activity-aware messaging based on tour name
  const tourLower = String(d.tour_name || "").toLowerCase();
  let activityFlavor = "Get ready for an unforgettable experience.";
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

function invoiceHtml(d: Record<string, unknown>) {
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
            <h1 style="margin: 10px 0 0 0; font-size: 30px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">Invoice ${d.invoice_number}</h1>
          </td>
        </tr>
        ${heroImg("IMG_INVOICE", "Cape Kayak")}
        <!-- Customer Info -->
        <tr>
          <td style="padding: 30px 40px 20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-bottom: 1px solid #E5E5E5; padding-bottom: 20px; margin-bottom: 20px; font-size: 14px; color: #555; line-height: 1.6;">
              <tr>
                <td style="vertical-align: top;"><strong style="color: #1b3b36;">Billed To:</strong><br>${d.customer_name}<br>${d.customer_email}</td>
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
                <td style="padding: 15px 0; border-bottom: 1px solid #E5E5E5; color: #333; text-align: right;">R${d.subtotal}</td>
              </tr>
              ${Number(d.discount_amount) > 0 ? `<tr><td colspan="3" style="color: #B91C1C; border-bottom: none; padding-top: 10px;">Discount${d.discount_type === "PERCENT" ? " (" + d.discount_percent + "%)" : ""}</td><td style="color: #B91C1C; border-bottom: none; padding-top: 10px; text-align: right;">-R${d.discount_amount}</td></tr>` : ""}
              <tr>
                <td colspan="3" style="padding: 20px 0 0 0; border-bottom: none; font-size: 18px; font-weight: bold; color: #1b3b36;">Total Paid</td>
                <td style="padding: 20px 0 0 0; border-bottom: none; font-size: 18px; font-weight: bold; color: #1b3b36; text-align: right;">R${d.total_amount}</td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Payment Meta -->
        <tr>
          <td style="padding: 0 40px 30px; text-align: center;">
            <p style="font-size: 13px; color: #888; margin: 0;">Payment Method: <strong>${d.payment_method}</strong> &nbsp;|&nbsp; Ref: <strong>${String(d.payment_reference || "").substring(0, 8).toUpperCase()}</strong></p>
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


function giftVoucherHtml(d: Record<string, unknown>) {
  return `
    <!DOCTYPE html>
    <html>
    <head><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
    <body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #F7F7F6; margin: 0; padding: 20px; color: #333;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);">
        <tr>
          <td style="background-color: #1b3b36; padding: 30px 30px 20px; text-align: center;">
            <p style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #A8C2B8;">Cape Kayak Adventures</p>
            <h1 style="margin: 10px 0 0 0; font-size: 30px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">Gift Voucher</h1>
          </td>
        </tr>
        ${heroImg("IMG_GIFT", "Cape Kayak")}
        <tr>
          <td style="padding: 40px 40px 10px; text-align: center;">
            <h2 style="font-size: 24px; font-family: Georgia, serif; margin: 0 0 15px 0; color: #1b3b36;">Hi ${d.buyer_name},</h2>
            <p style="font-size: 16px; line-height: 1.6; color: #555; margin: 0 0 20px 0;">Your gift voucher for <strong>${d.recipient_name}</strong> is ready!</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 0 40px 20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f3ff; border: 2px dashed #7c3aed; border-radius: 12px;">
              <tr><td style="padding: 24px; text-align: center;">
                <p style="margin: 0; font-size: 14px; color: #6b7280;">Voucher Code</p>
                <p style="margin: 8px 0; font-size: 28px; font-weight: bold; letter-spacing: 4px; color: #7c3aed;">${d.code}</p>
                <p style="margin: 0; font-size: 14px; color: #6b7280;">${d.tour_name} &middot; R${d.value}</p>
                <p style="margin: 8px 0 0; font-size: 12px; color: #9ca3af;">Valid until ${d.expires_at}</p>
              </td></tr>
            </table>
          </td>
        </tr>
        ${d.gift_message ? `<tr><td style="padding: 0 40px 20px;"><div style="background: #fafafa; border-radius: 8px; padding: 16px; font-style: italic; color: #4b5563; text-align: center;">&ldquo;${d.gift_message}&rdquo;</div></td></tr>` : ""}
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
  const cancelText = isWeather
    ? "Unfortunately, your trip has been cancelled due to weather conditions. The ocean wasn't playing along! We sincerely apologise for the disappointment."
    : `Unfortunately, your trip has been cancelled${d.reason ? " due to <strong>" + d.reason + "</strong>" : ""}. We sincerely apologise for the inconvenience.`;

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
  const optionsBlock = isWeather
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
    : `
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
      `;

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
              Please arrive 15 minutes before launch.<br>
              Bring sunscreen, a hat, a towel, and a water bottle.
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
              Had a great time? We'd love it if you could leave us a quick review on Google — it means the world to our small team!
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
  const y = 800;
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
  const tourName = String(d.tour_name || "Booking");
  const tourDate = String(d.tour_date || d.invoice_date || "-");
  const qty = Number(d.qty) || 1;
  const totalStr = String(d.total_amount || "0").replace(/[^0-9.,]/g, "").replace(/,/g, "");
  const total = parseFloat(totalStr) || 0;
  const subtotal = total / (1 + VAT_RATE);
  const vatAmt = total - subtotal;
  const invDate = String(d.invoice_date || "-");
  function m(n: number) { return "R" + n.toFixed(2); }

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
  const toLines = [toName];
  if (toPhone) toLines.push(toPhone);
  toLines.push(toEmail);
  for (const tl of toLines) {
    page.drawText(tl, { x: margin + usable * 0.5, y: toY, font, size: 9, color: black });
    toY -= 12;
  }
  y -= 10;

  // ── Invoice details ──
  page.drawLine({ start: { x: margin, y }, end: { x: W - margin, y }, thickness: 1, color: lightGrey });
  y -= 20;
  const detailLabels = ["Invoice #:", "Booking Ref:", "Date:", "Amount Due:"];
  const detailValues = [invNo, ref, invDate, "R0.00"];
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
    ["Amount Paid:", m(total)],
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
  page.drawText("R0.00", { x: totalsValX, y, font: fontBold, size: 10, color: black });
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
  const binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function broadcastHtml(d: Record<string, unknown>) {
  let phtml = String(d.message || "Message").replace(/\n/g, '<br>');
  phtml = phtml.replace(/\{name\}/gi, String(d.customer_name || "Guest").split(" ")[0]);
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

Deno.serve(withSentry("send-email", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCors(req) });

  try {
    if (!RESEND_API_KEY) {
      console.error("SEND_EMAIL: RESEND_API_KEY not configured");
      return new Response(JSON.stringify({ error: "Email service not configured" }), { status: 503, headers: getCors(req) });
    }

    const body = await req.json();
    const type = body.type as string;
    const d = body.data as Record<string, unknown>;

    // Escape user-controlled fields to prevent HTML injection in email templates
    const fieldsToEscape = ["customer_name", "recipient_name", "gift_message", "reason", "cancel_reason", "ref", "tour_name", "invoice_number"];
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
      branding = { businessId: "", brandName: fb, shortBrandName: fb, footerLineOne: "Thanks for choosing " + fb + ".", footerLineTwo: "Reply to this email if you need anything.", manageBookingUrl: "", bookingSiteUrl: "", voucherUrl: "", waiverUrl: "", directions: "", fromEmail: FROM_EMAIL, replyToEmail: "", emailColor: "#1b3b36", imgPayment: "", imgConfirm: "", imgInvoice: "", imgGift: "", imgCancel: "", imgCancelWeather: "", imgIndemnity: "", imgAdmin: "", imgVoucher: "", imgPhotos: "", socialFacebook: "", socialInstagram: "", socialTiktok: "", socialYoutube: "", socialTwitter: "", socialLinkedin: "", socialTripadvisor: "", socialGoogleReviews: "" };
    }

    if (type === "BOOKING_CONFIRM" || type === "INDEMNITY") {
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
      case "PAYMENT_LINK":
        subject = "Cape Kayak - Payment Link (Ref: " + d.ref + ")";
        html = paymentLinkHtml(d);
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
      case "INVOICE":
        subject = "Cape Kayak - Invoice " + d.invoice_number;
        html = invoiceHtml(d);
        bcc = d.admin_email as string;
        break;
      case "GIFT_VOUCHER":
        subject = "Cape Kayak - Gift Voucher for " + d.recipient_name;
        html = giftVoucherHtml(d);
        bcc = d.admin_email as string;
        break;
      case "CANCELLATION":
        subject = "Cape Kayak - Booking Cancelled (Ref: " + d.ref + ")";
        html = cancellationHtml(d);
        break;
      case "INDEMNITY":
        subject = "Cape Kayak - Indemnity & Waiver (Ref: " + d.ref + ")";
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
    const result = await sendResend(d.email as string, branding.fromEmail, branded.subject, branded.html, bcc, attachments, branding.replyToEmail);
    if (result?.statusCode && result.statusCode >= 400) {
      return new Response(JSON.stringify({ ok: false, error: result.message || "Resend API error", result }), { status: 200, headers: getCors(req) });
    }
    return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: getCors(req) });
  } catch (err: unknown) {
    console.error("SEND_EMAIL_ERR:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: getCors(req) });
  }
}));
