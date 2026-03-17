import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getWaiverContext } from "../_shared/waiver.ts";

var RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
var SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
var SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
// RESEND_FROM_EMAIL should be set to a verified sender, e.g. "Cape Kayak <bookings@capekayak.co.za>"
// If unset, Resend's onboarding@resend.dev test domain is used — which only delivers to your Resend account email.
var FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "Cape Kayak <onboarding@resend.dev>";
var supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

var ALLOWED_ORIGINS = ["https://admin.capekayak.co.za", "https://caepweb-admin.vercel.app", "https://book.capekayak.co.za", "https://capekayak.co.za", "https://bookingtours.co.za", "https://www.bookingtours.co.za", "http://localhost:3000", "http://localhost:3001"];
function getCors(req?: Request) {
  var origin = req?.headers?.get("origin") || "";
  var allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

async function sendResend(to: string, fromEmail: string, subject: string, html: string, bcc?: string, attachments?: Array<{ filename: string; content: string }>) {
  var payload: Record<string, unknown> = { from: fromEmail || FROM_EMAIL, to: [to], subject, html };
  if (bcc) payload.bcc = [bcc];
  if (attachments && attachments.length > 0) payload.attachments = attachments;
  var res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  var data = await res.json();
  if (!res.ok) {
    console.error("RESEND_ERR from=" + (fromEmail || FROM_EMAIL) + " to=" + to + " subject=" + subject + ":", JSON.stringify(data));
  } else {
    console.log("RESEND_OK id=" + data?.id + " to=" + to + " subject=" + subject);
  }
  return data;
}

var IMG_PAYMENT = "https://i.ibb.co/B2yM8wMf/8.jpg";
var IMG_CONFIRM = "https://i.ibb.co/35S5Qrj5/7.jpg";
var IMG_INVOICE = "https://i.ibb.co/SX19rypd/6.jpg";
var IMG_GIFT = "https://i.ibb.co/KxfvFSWG/5.jpg";
var IMG_CANCEL_GENERAL = "https://i.ibb.co/bRN0Hct9/Gemini-Generated-Image-539vy9539vy9539v-2.png";
var IMG_CANCEL_WEATHER = "https://i.ibb.co/QjYg8y0w/Gemini-Generated-Image-539vy9539vy9539v-2.png";
var IMG_INDEMNITY = "https://i.ibb.co/GQc9RTLn/3.jpg";
var IMG_ADMIN = "https://i.ibb.co/qMRzpgRH/2.jpg";
var IMG_VOUCHER = "https://i.ibb.co/pv599ykx/1.jpg";
var IMG_PHOTOS = "https://images.unsplash.com/photo-1544551763-46a013bb70d5?q=80&w=600&auto=format&fit=crop"; // Placeholder - please update


var SQ_IMG_STYLE = "width: 100%; max-width: 540px; border-radius: 12px; display: block; margin: 0 auto;";
var MAPS_URL = "https://www.google.com/maps/search/?api=1&query=Cape+Kayak+Adventures%2C+180+Beach+Rd%2C+Three+Anchor+Bay%2C+Cape+Town%2C+8005";
var MANAGE_BOOKING_URL = "https://book.capekayak.co.za/my-bookings";

async function enrichWaiverEmailData(d: Record<string, unknown>) {
  if (!supabase) return d;
  try {
    var ctx = await getWaiverContext(supabase, {
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
  var directBusinessId = String(d.business_id || "").trim();
  if (directBusinessId) return directBusinessId;
  if (!supabase) return "";

  var bookingId = String(d.booking_id || "").trim();
  if (bookingId) {
    var bookingRes = await supabase.from("bookings").select("business_id").eq("id", bookingId).maybeSingle();
    if (bookingRes.data?.business_id) return String(bookingRes.data.business_id);
  }

  var invoiceNumber = String(d.invoice_number || "").trim();
  if (invoiceNumber) {
    var invoiceRes = await supabase.from("invoices").select("business_id").eq("invoice_number", invoiceNumber).maybeSingle();
    if (invoiceRes.data?.business_id) return String(invoiceRes.data.business_id);
  }

  return "";
}

async function loadEmailBranding(d: Record<string, unknown>) {
  var businessId = await resolveBrandingBusinessId(d);
  if (!businessId || !supabase) {
    return {
      businessId: "",
      brandName: "Adventure Operator",
      shortBrandName: "Adventure Operator",
      footerLineOne: "Thanks for choosing our team.",
      footerLineTwo: "Reply to this email if you need anything.",
      manageBookingUrl: String(d.manage_bookings_url || MANAGE_BOOKING_URL),
      bookingSiteUrl: String(d.booking_site_url || "https://book.capekayak.co.za"),
      voucherUrl: String(d.gift_voucher_url || d.booking_site_url || "https://book.capekayak.co.za"),
      waiverUrl: String(d.waiver_url || ""),
      directions: String(d.directions || ""),
      fromEmail: FROM_EMAIL,
    };
  }

  var { data } = await supabase
    .from("businesses")
    .select("id, name, business_name, footer_line_one, footer_line_two, manage_bookings_url, booking_site_url, gift_voucher_url, waiver_url, directions")
    .eq("id", businessId)
    .maybeSingle();

  var brandName = String(data?.business_name || data?.name || "Adventure Operator");
  return {
    businessId,
    brandName,
    shortBrandName: brandName,
    footerLineOne: String(data?.footer_line_one || "Thanks for choosing " + brandName + "."),
    footerLineTwo: String(data?.footer_line_two || "Reply to this email if you need anything."),
    manageBookingUrl: String(data?.manage_bookings_url || d.manage_bookings_url || MANAGE_BOOKING_URL),
    bookingSiteUrl: String(data?.booking_site_url || d.booking_site_url || "https://book.capekayak.co.za"),
    voucherUrl: String(data?.gift_voucher_url || d.gift_voucher_url || data?.booking_site_url || d.booking_site_url || "https://book.capekayak.co.za"),
    waiverUrl: String(data?.waiver_url || d.waiver_url || ""),
    directions: String(data?.directions || d.directions || ""),
    fromEmail: Deno.env.get("RESEND_FROM_EMAIL") || brandName + " <onboarding@resend.dev>",
  };
}

function applyBranding(subject: string, html: string, branding: Awaited<ReturnType<typeof loadEmailBranding>>) {
  var brandedHtml = html;
  var replacements: Array<[string, string]> = [
    ["Cape Kayak Adventures", branding.brandName],
    ["Cape Kayak Adventure", branding.brandName],
    ["Cape Kayak Admin Dashboard", branding.brandName + " Admin Dashboard"],
    ["Cape Kayak Admin", branding.brandName + " Admin"],
    ["Cape Kayak", branding.shortBrandName],
    ["https://book.capekayak.co.za/my-bookings", branding.manageBookingUrl],
    ["https://book.capekayak.co.za", branding.bookingSiteUrl],
  ];

  for (var i = 0; i < replacements.length; i++) {
    brandedHtml = brandedHtml.split(replacements[i][0]).join(replacements[i][1]);
  }

  if (branding.voucherUrl) {
    brandedHtml = brandedHtml.split("book at book.capekayak.co.za").join("book at " + branding.voucherUrl);
  }
  if (branding.directions) {
    brandedHtml = brandedHtml
      .split("Three Anchor Bay, Sea Point, Cape Town<br>\n            If you have any questions, reply to this email or contact us on WhatsApp.")
      .join(branding.footerLineOne + "<br>\n            " + branding.footerLineTwo)
      .split("Three Anchor Bay, Sea Point, Cape Town<br>Book at book.capekayak.co.za or WhatsApp us.")
      .join(branding.footerLineOne + "<br>Book at " + branding.voucherUrl + " or reply to this email.")
      .split("Three Anchor Bay, Sea Point, Cape Town<br>\n            Thank you for adventuring with us!")
      .join(branding.footerLineOne + "<br>\n            " + branding.footerLineTwo);
  }

  var brandedSubject = subject
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
        <!-- Hero Image -->
        <tr>
          <td style="background-color: #1b3b36; padding: 0 30px 30px; text-align: center;">
            <img src="${IMG_PAYMENT}" alt="Cape Kayak Adventure" style="${SQ_IMG_STYLE}" />
          </td>
        </tr>
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

function bookingConfirmHtml(d: Record<string, unknown>) {
  var waiverPending = String(d.waiver_status || "PENDING") !== "SIGNED";
  var waiverUrl = String(d.waiver_url || "");
  var waiverBlock = waiverPending && waiverUrl
    ? `
        <tr>
          <td style="padding: 0 40px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 12px;">
              <tr>
                <td style="padding: 22px; text-align: center;">
                  <p style="margin: 0 0 8px 0; font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #047857;">Action required</p>
                  <h3 style="margin: 0 0 10px 0; font-family: Georgia, serif; font-size: 22px; color: #14532d;">Complete your waiver</h3>
                  <p style="margin: 0 0 18px 0; font-size: 14px; color: #166534; line-height: 1.6;">Please complete the waiver for this booking before the trip. The link covers the booking contact and the guests on this reservation.</p>
                  <a href="${waiverUrl}" style="display: inline-block; background-color: #166534; color: #ffffff !important; text-decoration: none; padding: 12px 24px; border-radius: 999px; font-weight: 700; font-size: 13px; letter-spacing: 0.04em; text-transform: uppercase;">Sign waiver</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `
    : `
        <tr>
          <td style="padding: 0 40px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px;">
              <tr>
                <td style="padding: 18px 22px; text-align: center;">
                  <p style="margin: 0; font-size: 14px; color: #1d4ed8; line-height: 1.6;"><strong>Waiver status:</strong> Completed for this booking.</p>
                </td>
              </tr>
            </table>
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
            <h1 style="margin: 10px 0 0 0; font-size: 32px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">Booking Confirmed</h1>
          </td>
        </tr>
        <!-- Hero Image -->
        <tr>
          <td style="background-color: #1b3b36; padding: 0 30px 30px; text-align: center;">
            <img src="${IMG_CONFIRM}" alt="Cape Kayak Adventure" style="${SQ_IMG_STYLE}" />
          </td>
        </tr>
        <!-- Content -->
        <tr>
          <td style="padding: 40px 40px 10px; text-align: center;">
            <h2 style="font-size: 24px; font-family: Georgia, serif; margin: 0 0 15px 0; color: #1b3b36;">We can't wait to see you, ${d.customer_name}.</h2>
            <p style="font-size: 16px; line-height: 1.6; color: #555; margin: 0 0 30px 0;">Your spots for the <strong>${d.tour_name}</strong> are officially locked in. Get ready for an unforgettable experience on the water.</p>
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
            <a href="${MAPS_URL}" style="display: inline-block; background-color: #2a5a52; color: #fff; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-size: 14px; font-weight: bold; margin-bottom: 15px;">Open in Google Maps</a>
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
            <a href="${MANAGE_BOOKING_URL}" style="display: inline-block; background-color: #1b3b36; color: #ffffff !important; text-decoration: none; padding: 16px 32px; border-radius: 30px; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Manage Your Booking</a>
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
        <!-- Hero Image -->
        <tr>
          <td style="background-color: #1b3b36; padding: 0 30px 30px; text-align: center;">
            <img src="${IMG_INVOICE}" alt="Cape Kayak Adventure" style="${SQ_IMG_STYLE}" />
          </td>
        </tr>
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
            <p style="font-size: 13px; color: #888; margin: 0;">Payment Method: <strong>${d.payment_method}</strong> &nbsp;|&nbsp; Ref: <strong>${d.payment_reference}</strong></p>
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
        <tr>
          <td style="background-color: #1b3b36; padding: 0 30px 30px; text-align: center;">
            <img src="${IMG_GIFT}" alt="Cape Kayak Adventure" style="${SQ_IMG_STYLE}" />
          </td>
        </tr>
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
            <p style="color: #A8C2B8; font-size: 12px; line-height: 1.5; margin: 0;">Three Anchor Bay, Sea Point, Cape Town<br>Book at book.capekayak.co.za or WhatsApp us.</p>
          </td>
        </tr>
      </table>
    </body>
    </html>`;
}

function cancellationHtml(d: Record<string, unknown>) {
  var isWeather = typeof d.reason === "string" && d.reason.toLowerCase().includes("weather");
  var headerImg = isWeather ? IMG_CANCEL_WEATHER : IMG_CANCEL_GENERAL;
  var cancelText = isWeather
    ? "Unfortunately, your trip has been cancelled due to weather conditions. The ocean wasn't playing along! We sincerely apologise for the disappointment."
    : `Unfortunately, your trip has been cancelled${d.reason ? " due to <strong>" + d.reason + "</strong>" : ""}. We sincerely apologise for the inconvenience.`;

  var amountRow = d.total_amount ? `<tr>
                <td width="40%" style="padding: 18px 20px; color: #888; font-size: 15px;">Amount Paid:</td>
                <td width="60%" style="padding: 18px 20px; color: #1b3b36; font-size: 15px; text-align: right;">R${d.total_amount}</td>
              </tr>` : "";
  var btnStyle = "display: block; width: 100%; box-sizing: border-box; text-align: center; text-decoration: none; padding: 16px 20px; border-radius: 30px; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px;";
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
        <tr>
          <td style="background-color: #1b3b36; padding: 0 30px 30px; text-align: center;">
            <img src="${headerImg}" alt="Cape Kayak Adventure" style="${SQ_IMG_STYLE}" />
          </td>
        </tr>
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
        <!-- Options -->
        <tr>
          <td style="padding: 10px 40px 10px; text-align: center;">
            <p style="font-size: 17px; font-family: Georgia, serif; color: #1b3b36; margin: 0 0 20px 0;">How would you like us to handle your booking?</p>
          </td>
        </tr>
        <tr>
          <td style="padding: 0 40px 40px; text-align: center;">
            <a href="${MANAGE_BOOKING_URL}" style="${btnStyle} background-color: #1b3b36; color: #ffffff !important;">Reschedule My Trip</a>
            <a href="${MANAGE_BOOKING_URL}" style="${btnStyle} background-color: #2563eb; color: #ffffff !important;">Convert to Voucher</a>
            <a href="${MANAGE_BOOKING_URL}" style="${btnStyle} background-color: #059669; color: #ffffff !important;">Request a Refund</a>
            <p style="font-size: 13px; color: #888; margin: 8px 0 0 0;">Or reply to this email and we&rsquo;ll sort it out for you.</p>
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

function indemnityHtml(d: Record<string, unknown>) {
  var waiverUrl = String(d.waiver_url || "");
  var waiverPending = String(d.waiver_status || "PENDING") !== "SIGNED";
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
        <tr>
          <td style="background-color: #1b3b36; padding: 0 30px 30px; text-align: center;">
            <img src="${IMG_INDEMNITY}" alt="Cape Kayak Adventure" style="${SQ_IMG_STYLE}" />
          </td>
        </tr>
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
        <tr>
          <td style="background-color: #1b3b36; padding: 0 30px 30px; text-align: center;">
            <img src="${IMG_VOUCHER}" alt="Cape Kayak Adventure" style="${SQ_IMG_STYLE}" />
          </td>
        </tr>
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
              Use this code when booking at <a href="https://book.capekayak.co.za" style="color: #2a5a52; font-weight: bold; text-decoration: none;">book.capekayak.co.za</a>
            </p>
            <a href="https://book.capekayak.co.za" style="display: inline-block; background-color: #2a5a52; color: #fff; text-decoration: none; padding: 14px 40px; border-radius: 8px; font-size: 16px; font-weight: bold;">Book Now</a>
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
        <tr>
          <td style="background-color: #1b3b36; padding: 0 30px 30px; text-align: center;">
            <img src="${IMG_PHOTOS}" alt="Cape Kayak Trip Photos" style="${SQ_IMG_STYLE}" />
          </td>
        </tr>
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
                  <p style="margin: 0 0 16px 0; font-size: 13px; color: #888; line-height: 1.5;">We captured some great moments from your trip. Click below to view and download your photos.</p>
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
              We'd love to see you again! Book your next adventure anytime at <a href="https://book.capekayak.co.za" style="color: #2a5a52; font-weight: bold; text-decoration: none;">book.capekayak.co.za</a>
            </p>
            <a href="https://book.capekayak.co.za" style="display: inline-block; background-color: #1b3b36; color: #fff; text-decoration: none; padding: 14px 40px; border-radius: 30px; font-size: 14px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">Book Again</a>
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
        <tr>
          <td style="background-color: #1b3b36; padding: 0 30px 30px; text-align: center;">
            <img src="${IMG_ADMIN}" alt="Cape Kayak Adventure" style="${SQ_IMG_STYLE}" />
          </td>
        </tr>
        <!-- Content -->
        <tr>
          <td style="padding: 40px 40px 10px; text-align: center;">
            <h2 style="font-size: 24px; font-family: Georgia, serif; margin: 0 0 15px 0; color: #1b3b36;">You've been added as an admin</h2>
            <p style="font-size: 16px; line-height: 1.6; color: #555; margin: 0 0 30px 0;">You now have access to the Cape Kayak Admin Dashboard. A temporary password has been set for your account — please change it as soon as possible.</p>
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
                <td width="40%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #888; font-size: 15px;">Temp Password:</td>
                <td width="60%" style="padding: 18px 20px; border-bottom: 1px solid #E5E5E5; color: #1b3b36; font-size: 15px; font-weight: bold; text-align: right;">${d.temp_password}</td>
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
                  <p style="margin: 0; font-size: 13px; color: #78350F; line-height: 1.5;">For security, please change your temporary password immediately after your first login.</p>
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

var VAT_RATE = 0.15;
var FROM_COMPANY = {
  name: "Cape Kayak Adventures",
  addressLines: ["179 Beach Road Three Anchor Bay", "Cape Town", "8005"],
  reg: "Reg. 1995/051404/23",
  vat: "4290176926",
};
var BANKING_DETAILS = {
  owner: "Coastal Kayak Trails CC",
  number: "070631824",
  type: "Current / Cheque",
  bank: "Standard Bank",
  branchCode: "020909",
};

function escHtml(raw: string) {
  return raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function proFormaHtml(d: Record<string, unknown>) {
  var invNo = escHtml(String(d.invoice_number || ""));
  var ref = escHtml(String(d.payment_reference || invNo));
  var toName = escHtml(String(d.customer_name || "Customer"));
  var toEmail = escHtml(String(d.customer_email || ""));
  var tourName = escHtml(String(d.tour_name || "Kayak Booking"));
  var tourDate = escHtml(String(d.tour_date || d.invoice_date || "-"));
  var service = tourName + "(" + tourDate + ")";
  var qty = Number(d.qty) || 1;
  var totalStr = String(d.total_amount || "0").replace(/[^0-9.,]/g, "").replace(/,/g, "");
  var total = parseFloat(totalStr) || 0;
  var subtotal = total / (1 + VAT_RATE);
  var vat = total - subtotal;
  var invDate = escHtml(String(d.invoice_date || "-"));

  var phoneSection = d.phone ? escHtml(String(d.phone)) + "\\n" : "";

  function m(n: number) { return n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/,/g, ''); }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Tax Invoice ${invNo}</title>
  <style>
    @page { size: A4; margin: 10mm; }
    body { margin: 0; background: #eeeeee; font-family: Arial, Helvetica, sans-serif; color: #111; }
    .page { width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff; padding: 12mm; box-sizing: border-box; }
    .row { display: flex; justify-content: space-between; gap: 10mm; margin-bottom: 5mm; }
    .company-name { font-family: 'Arial Black', sans-serif; font-size: 24px; font-weight: 900; letter-spacing: -0.5px; margin-top: -5px; }
    .company-name span { font-weight: 300; }
    .title { font-family: 'Arial Black', sans-serif; font-size: 32px; font-weight: 900; color: #b3b3b3; margin: 0; text-transform: uppercase; }
    .muted { font-size: 10px; color: #111; margin-top: 5mm; }
    table { width: 100%; border-collapse: collapse; }
    td, th { border: 1px solid #222; padding: 6px 7px; vertical-align: top; font-size: 12px; }
    th { background: #d8d8d8; text-align: left; font-weight: 700; color: #111; }
    .num { text-align: right; font-family: "Courier New", monospace; }
    .spacer { height: 10mm; }
    .bank-title { font-size: 16px; font-weight: 700; margin-top: 8mm; margin-bottom: 3mm; }
    .bank td { border: none; padding: 2px 2px; font-size: 12px; }
    .bank .label { font-weight: 700; width: 38mm; }
    .to-line { white-space: pre-line; }
    @media print { body { background: #fff; } .page { margin: 0; box-shadow: none; } }
  </style>
</head>
<body>
  <div class="page">
    <div class="row">
      <div>
        <div style="width: 200px; text-align: center; margin-bottom: 5px;">
          <svg width="80" height="30" viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg">
            <path d="M0,30 Q25,10 50,20 T100,10 L100,20 Q75,30 50,20 T0,30 Z" fill="#28a2d4" />
            <path d="M0,40 Q25,20 50,30 T100,20 L100,30 Q75,40 50,30 T0,40 Z" fill="#1b85b8" />
          </svg>
        </div>
        <div class="company-name">${escHtml((FROM_COMPANY.name || "CAPE KAYAK").replace(" Adventures", "").replace(" ADVENTURES", ""))} <span>ADVENTURES</span></div>
        <div class="muted">${escHtml(FROM_COMPANY.reg)} VAT: ${escHtml(FROM_COMPANY.vat)}</div>
      </div>
      <div style="text-align: right;">
        <h1 class="title">TAX INVOICE</h1>
      </div>
    </div>
    <div class="spacer"></div>
    <div class="row">
      <table style="width: 50%;">
        <tr><th style="background:#d8d8d8; text-align:center;">From:</th><th style="background:#d8d8d8; text-align:center;">To:</th></tr>
        <tr>
          <td class="to-line">${escHtml(FROM_COMPANY.name)}\n${escHtml(FROM_COMPANY.addressLines.join("\n"))}</td>
          <td class="to-line">${toName}\n${phoneSection}${toEmail}</td>
        </tr>
      </table>
      <table style="width: 45%;">
        <tr><th style="background:#d8d8d8; width: 40%">Invoice #:</th><td class="num">${invNo}</td></tr>
        <tr><th style="background:#d8d8d8;">Booking #:</th><td class="num">${ref}</td></tr>
        <tr><th style="background:#d8d8d8;">Date:</th><td class="num">${invDate}</td></tr>
        <tr><th style="background:#d8d8d8;">Amount Due:</th><td class="num">R0.00</td></tr>
      </table>
    </div>
    <div class="spacer"></div>
    <table>
      <tr>
        <th style="background:#d8d8d8; text-align:center; width:40%">Service</th>
        <th style="background:#d8d8d8; text-align:center; width:15%">Adults (Qty)</th>
        <th style="background:#d8d8d8; text-align:center; width:15%">Children (Qty)</th>
        <th style="background:#d8d8d8; text-align:center; width:15%">Guides (Qty)</th>
        <th style="background:#d8d8d8; text-align:center; width:15%">Total Cost (ZAR)</th>
      </tr>
      <tr>
        <td style="vertical-align:top;">${service}</td>
        <td style="text-align:center; vertical-align:top;">${qty}</td>
        <td style="text-align:center; vertical-align:top;">0</td>
        <td style="text-align:center; vertical-align:top;">0</td>
        <td class="num" style="text-align:right; vertical-align:top;">${m(total)}</td>
      </tr>
      <tr>
        <td rowspan="5" colspan="1" style="border:1px solid #222; border-top:none; border-bottom:1px solid #222;"></td>
        <td style="text-align:center; font-weight:bold;">Sub-total</td>
        <td colspan="2" style="text-align:right; font-weight:bold;">(Excl VAT)</td>
        <td class="num" style="text-align:right;">${m(subtotal)}</td>
      </tr>
      <tr>
        <td colspan="3" style="text-align:right; font-weight:bold;">VAT - ${(VAT_RATE * 100).toFixed(1)}%</td>
        <td class="num" style="text-align:right;">${m(vat)}</td>
      </tr>
      <tr>
        <td colspan="3" style="text-align:right; font-weight:bold;">Total:</td>
        <td class="num" style="text-align:right; font-weight:bold;">${m(total)}</td>
      </tr>
      <tr>
        <td colspan="3" style="text-align:right; font-weight:bold;">Amount Paid:</td>
        <td class="num" style="text-align:right;">${m(total)}</td>
      </tr>
      <tr>
        <td colspan="3" style="background:#b3b3b3; text-align:right; font-weight:bold;">Balance Due:</td>
        <td class="num" style="background:#b3b3b3; text-align:right; font-weight:bold;">R0.00</td>
      </tr>
    </table>
    <div class="bank-title">Banking Details</div>
    <table class="bank">
      <tr><td class="label">Account Owner:</td><td>${escHtml(BANKING_DETAILS.owner)}</td></tr>
      <tr><td class="label">Account Number:</td><td>${escHtml(BANKING_DETAILS.number)}</td></tr>
      <tr><td class="label">Account Type:</td><td>${escHtml(BANKING_DETAILS.type)}</td></tr>
      <tr><td class="label">Bank Name:</td><td>${escHtml(BANKING_DETAILS.bank)}</td></tr>
      <tr><td class="label">Branch Code:</td><td>${escHtml(BANKING_DETAILS.branchCode)}</td></tr>
      <tr><td class="label">Reference:</td><td>${invNo}</td></tr>
    </table>
  </div>
</body>
</html>`;
}

function toBase64(str: string): string {
  var bytes = new TextEncoder().encode(str);
  var binary = "";
  for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: getCors(req) });

  try {
    var body = await req.json();
    var type = body.type as string;
    var d = body.data as Record<string, unknown>;
    var branding = await loadEmailBranding(d);

    if (type === "BOOKING_CONFIRM" || type === "INDEMNITY") {
      d = await enrichWaiverEmailData(d);
    }

    console.log("SEND_EMAIL type=" + type + " to=" + (d.email || "?"));

    var subject = "";
    var html = "";
    var bcc: string | undefined;

    switch (type) {
      case "PAYMENT_LINK":
        subject = "Cape Kayak - Payment Link (Ref: " + d.ref + ")";
        html = paymentLinkHtml(d);
        break;
      case "BOOKING_CONFIRM":
        subject = "Cape Kayak - Booking Confirmed! (Ref: " + d.ref + ")";
        html = bookingConfirmHtml(d);
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
      case "BROADCAST":
        subject = d.subject ? String(d.subject) : "Cape Kayak - Important Update";
        html = broadcastHtml(d);
        break;
      case "ADMIN_WELCOME":
        subject = "Cape Kayak Admin - You've Been Added";
        html = adminWelcomeHtml(d);
        break;
      case "TRIP_PHOTOS":
        subject = "Cape Kayak - Your Trip Photos Are Ready! 📸";
        html = tripPhotosHtml(d);
        break;
      default:
        return new Response(JSON.stringify({ error: "Unknown email type: " + type }), { status: 400, headers: getCors(req) });
    }

    // Build tax invoice attachment for INVOICE emails
    var attachments: Array<{ filename: string; content: string }> | undefined;
    if (type === "INVOICE" || type === "BOOKING_CONFIRM") {
      try {
        if (d.invoice_number) {
          var pfHtml = proFormaHtml(d);
          var invNum = String(d.invoice_number);
          attachments = [{ filename: "TaxInvoice-" + invNum + ".html", content: toBase64(pfHtml) }];
        }
      } catch (pfErr) {
        console.error("PRO_FORMA_ERR:", pfErr);
      }
    }

    var branded = applyBranding(subject, html, branding);
    var result = await sendResend(d.email as string, branding.fromEmail, branded.subject, branded.html, bcc, attachments);
    return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: getCors(req) });
  } catch (err: unknown) {
    console.error("SEND_EMAIL_ERR:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: getCors(req) });
  }
});
