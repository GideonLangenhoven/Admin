import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

var RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
var SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
var SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
var supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
// RESEND_FROM_EMAIL should be set to a verified sender, e.g. "Cape Kayak <bookings@capekayak.co.za>"
// Without it, onboarding@resend.dev only delivers to your own Resend account email.
var FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "Bookings <onboarding@resend.dev>";

var ALLOWED_ORIGINS = [
  "https://admin.capekayak.co.za",
  "https://caepweb-admin.vercel.app",
  "https://book.capekayak.co.za",
  "https://capekayak.co.za",
  "https://bookingtours.co.za",
  "https://www.bookingtours.co.za",
  "http://localhost:3000",
  "http://localhost:3001"
];

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

var IMG_INVOICE = "https://i.ibb.co/SX19rypd/6.jpg";
var SQ_IMG_STYLE = "width: 100%; max-width: 540px; border-radius: 12px; display: block; margin: 0 auto;";

function money(n: number) {
  return n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string | null, timezone: string) {
  if (!iso) return "-";
  var d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: timezone,
  });
}

function invoiceHtml(d: Record<string, unknown>, brandName: string, footerLineOne: string, footerLineTwo: string) {
  return `<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #F7F7F6; margin: 0; padding: 20px; color: #333;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);">
    <tr>
      <td style="background-color: #1b3b36; padding: 30px 30px 20px; text-align: center;">
        <p style="margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px; color: #A8C2B8;">${brandName}</p>
        <h1 style="margin: 10px 0 0 0; font-size: 30px; font-weight: 500; font-family: Georgia, serif; color: #F7F7F6;">Invoice ${d.invoice_number}</h1>
      </td>
    </tr>
    <tr>
      <td style="background-color: #1b3b36; padding: 0 30px 30px; text-align: center;">
        <img src="${IMG_INVOICE}" alt="${brandName}" style="${SQ_IMG_STYLE}" />
      </td>
    </tr>
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
            <td style="padding: 15px 0; border-bottom: 1px solid #E5E5E5; color: #333; text-align: right;">R${d.total_amount}</td>
          </tr>
          <tr>
            <td colspan="3" style="padding: 20px 0 0 0; border-bottom: none; font-size: 18px; font-weight: bold; color: #1b3b36;">Total</td>
            <td style="padding: 20px 0 0 0; border-bottom: none; font-size: 18px; font-weight: bold; color: #1b3b36; text-align: right;">R${d.total_amount}</td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding: 0 40px 30px; text-align: center;">
        <p style="font-size: 13px; color: #888; margin: 0;">Ref: <strong>${d.ref}</strong></p>
      </td>
    </tr>
    <tr>
      <td style="background-color: #1b3b36; color: #A8C2B8; text-align: center; padding: 30px; font-size: 12px; line-height: 1.5;">
        ${footerLineOne}<br>
        ${footerLineTwo}
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
    var bookingId = body.booking_id as string | null;
    var invoiceId = body.invoice_id as string | null;

    if (!bookingId && !invoiceId) {
      return new Response(
        JSON.stringify({ error: "booking_id or invoice_id required" }),
        { status: 400, headers: getCors(req) }
      );
    }

    // Try to fetch invoice data if invoice_id is provided
    var invoiceRow: Record<string, unknown> | null = null;
    if (invoiceId) {
      var { data: inv } = await supabase.from("invoices").select("*").eq("id", invoiceId).single();
      if (inv) invoiceRow = inv;
    }

    // Fetch booking data
    var bookingRow: Record<string, unknown> | null = null;
    var resolvedBookingId = bookingId || (invoiceRow?.booking_id as string | null);
    if (resolvedBookingId) {
      var { data: bk } = await supabase
        .from("bookings")
        .select("id, customer_name, email, phone, qty, total_amount, status, tours(name), slots(start_time), business_id")
        .eq("id", resolvedBookingId)
        .single();
      if (bk) bookingRow = bk;
    }

    if (!bookingRow && !invoiceRow) {
      return new Response(
        JSON.stringify({ error: "Booking or invoice not found" }),
        { status: 404, headers: getCors(req) }
      );
    }

    // Resolve values — prefer invoice data, fall back to booking data
    var customerName = String(invoiceRow?.customer_name || bookingRow?.customer_name || "Customer");
    var customerEmail = String(invoiceRow?.customer_email || bookingRow?.email || "");
    var qty = Number(invoiceRow?.qty || bookingRow?.qty || 1);
    var totalAmount = Number(invoiceRow?.total_amount || bookingRow?.total_amount || 0);
    var unitPrice = qty > 0 ? money(totalAmount / qty) : money(totalAmount);
    var tourName = String(invoiceRow?.tour_name || (bookingRow?.tours as any)?.name || "Kayak Booking");
    var startTime = (bookingRow?.slots as any)?.start_time || invoiceRow?.tour_date || null;
    var ref = resolvedBookingId ? resolvedBookingId.substring(0, 8).toUpperCase() : (invoiceId || "").substring(0, 8).toUpperCase();
    var businessId = bookingRow?.business_id || invoiceRow?.business_id;
    var { data: business } = businessId
      ? await supabase.from("businesses").select("business_name, name, timezone, notification_email, footer_line_one, footer_line_two").eq("id", businessId).maybeSingle()
      : { data: null as any };
    var brandName = String(business?.business_name || business?.name || "Your Booking");
    var businessTimezone = String(business?.timezone || "UTC");
    var footerLineOne = String(business?.footer_line_one || "Thanks for choosing " + brandName + ".");
    var footerLineTwo = String(business?.footer_line_two || "Reply to this email if you need anything.");
    var tourDate = fmtDate(startTime as string | null, businessTimezone);

    // Determine invoice number
    var invNumber = body.invoice_number
      || String(invoiceRow?.invoice_number || "")
      || ref;
    if (!invNumber) invNumber = ref;

    if (!customerEmail) {
      return new Response(
        JSON.stringify({ error: "No customer email found" }),
        { status: 400, headers: getCors(req) }
      );
    }

    // Fetch admin email for BCC
    var adminEmail = business?.notification_email ? String(business.notification_email) : undefined;

    // Build email data
    var emailData = {
      email: customerEmail,
      customer_name: customerName,
      customer_email: customerEmail,
      invoice_number: invNumber,
      invoice_date: fmtDate(invoiceRow?.created_at as string | null || startTime as string | null || new Date().toISOString(), businessTimezone),
      tour_name: tourName,
      tour_date: tourDate,
      qty: qty,
      unit_price: unitPrice,
      total_amount: money(totalAmount),
      ref: ref,
    };

    var subject = brandName + " - Invoice " + invNumber;
    var html = invoiceHtml(emailData, brandName, footerLineOne, footerLineTwo);

    // Send via Resend
    var payload: Record<string, unknown> = { from: brandName + " <onboarding@resend.dev>", to: [customerEmail], subject, html };
    if (adminEmail) payload.bcc = [adminEmail];

    var resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    var resendData = await resendRes.json();
    if (!resendRes.ok) {
      console.error("RESEND_ERR:", JSON.stringify(resendData));
      return new Response(
        JSON.stringify({ error: "Email send failed", detail: resendData }),
        { status: 500, headers: getCors(req) }
      );
    }

    console.log("SEND_INVOICE ok to=" + customerEmail + " inv=" + invNumber);

    return new Response(
      JSON.stringify({ ok: true, result: resendData }),
      { status: 200, headers: getCors(req) }
    );
  } catch (err: unknown) {
    console.error("SEND_INVOICE_ERR:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: getCors(req) }
    );
  }
});
