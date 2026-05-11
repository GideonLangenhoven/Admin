// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveBusinessFromOrigin, type LookupBusinessRow } from "../_shared/my-bookings-lookup.ts";
import {
  createOpaqueOtpToken,
  generateOtpCode,
  getClientIp,
  insertOtpAttempt,
  normalizeOtpCode,
  OTP_EMAIL_SEND_LIMIT,
  OTP_IP_SEND_LIMIT,
  OTP_TTL_MS,
  countRecentOtpAttempts,
  verifyTrackedOtp,
} from "../_shared/otp-attempts.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "BookingTours <noreply@bookingtours.co.za>";
const OTP_SECRET = Deno.env.get("OTP_HMAC_SECRET") || SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

async function resolveRequestBusiness(req: Request, body: Record<string, unknown>) {
  const { data, error } = await supabase
    .from("businesses")
    .select("id, subdomain, booking_site_url, manage_bookings_url")
    .order("created_at", { ascending: true });
  if (error) throw new Error("Business lookup failed: " + error.message);
  return resolveBusinessFromOrigin(
    (data || []) as LookupBusinessRow[],
    req.headers.get("origin") || "",
    typeof body.business_id === "string" ? body.business_id : "",
  );
}

/* ── DB-backed rate limiting ── */
async function enforceSendRateLimit(email: string, ipAddress: string) {
  const emailCount = await countRecentOtpAttempts(supabase, "email", email);
  if (emailCount >= OTP_EMAIL_SEND_LIMIT) {
    return { allowed: false, status: 429, error: "Too many requests. Please wait a few minutes." };
  }
  const ipCount = await countRecentOtpAttempts(supabase, "ip_address", ipAddress);
  if (ipCount >= OTP_IP_SEND_LIMIT) {
    return { allowed: false, status: 429, error: "Too many requests. Please wait a few minutes." };
  }
  return { allowed: true };
}

async function issueOtpAttempt(input: {
  businessId: string;
  email: string;
  phoneTail: string;
  ipAddress: string;
  purpose: string;
}) {
  const code = generateOtpCode();
  const expiresTs = Date.now() + OTP_TTL_MS;
  const token = createOpaqueOtpToken();
  await insertOtpAttempt(supabase, OTP_SECRET, {
    token,
    businessId: input.businessId,
    email: input.email,
    phoneTail: input.phoneTail,
    code,
    expiresTs,
    ipAddress: input.ipAddress,
    purpose: input.purpose,
  });
  return { token, code };
}

/* ── Email template ── */
function otpEmailHtml(code: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 16px">
<tr><td align="center">
<table width="100%" style="max-width:440px;background:#ffffff;border-radius:12px;overflow:hidden">
  <tr><td style="background:#1b3b36;padding:24px 32px;text-align:center">
    <h1 style="margin:0;color:#ffffff;font-family:Georgia,serif;font-size:22px;font-weight:700">Cape Kayak</h1>
  </td></tr>
  <tr><td style="padding:32px">
    <p style="margin:0 0 8px;color:#333;font-size:15px">Your verification code is:</p>
    <div style="text-align:center;margin:24px 0">
      <span style="display:inline-block;font-family:'Courier New',monospace;font-size:36px;font-weight:700;letter-spacing:8px;color:#1b3b36;background:#f0f5f4;padding:16px 28px;border-radius:10px;border:2px dashed #1b3b36">${code}</span>
    </div>
    <p style="margin:0 0 4px;color:#666;font-size:13px">This code expires in 15 minutes.</p>
    <p style="margin:0;color:#666;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
  </td></tr>
  <tr><td style="padding:16px 32px;background:#f9fafb;text-align:center;border-top:1px solid #eee">
    <p style="margin:0;color:#999;font-size:11px">Cape Kayak &middot; Verification Code</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/* ── Main handler ── */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const action = String(body.action || "send");

    /* ── SEND OTP (customer login) ── */
    if (action === "send") {
      const email = String(body.email || "").trim().toLowerCase();
      const phoneTail = String(body.phone_tail || "").replace(/\D/g, "").slice(-9);

      if (!email || !phoneTail) {
        return respond(400, { success: false, error: "Email and phone are required." });
      }

      const business = await resolveRequestBusiness(req, body);
      if (!business) {
        return respond(403, { success: false, error: "Unknown booking site." });
      }

      const clientIp = getClientIp(req);

      const rateLimit = await enforceSendRateLimit(email, clientIp);
      if (!rateLimit.allowed) return respond(rateLimit.status || 429, { success: false, error: rateLimit.error });

      // Check for matching bookings
      const { data: bookings } = await supabase
        .from("bookings")
        .select("id, phone")
        .eq("business_id", business.id)
        .eq("email", email)
        .limit(20);

      const matched = (bookings || []).filter(function (b: { phone?: string }) {
        const rawPhone = (b.phone || "").replace(/\D/g, "");
        if (!rawPhone) return true;
        return rawPhone.slice(-9) === phoneTail;
      });

      // Always issue an opaque token and return 200. Only matched customers get emailed.
      const { token, code } = await issueOtpAttempt({
        businessId: business.id,
        email,
        phoneTail,
        ipAddress: clientIp,
        purpose: "my_bookings",
      });

      // Only send the email if bookings matched — but always return 200
      if (matched.length > 0) {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: [email],
            subject: "Your verification code",
            html: otpEmailHtml(code),
          }),
        });

        if (!res.ok) {
          const errData = await res.json();
          console.error("RESEND_OTP_ERR", res.status, JSON.stringify(errData));
          // Still return 200 with token — don't leak send failure vs no-match
        }
      }

      return respond(200, { success: true, token });
    }

    /* ── SEND ADMIN OTP (settings verification) ── */
    if (action === "send_admin") {
      const email = String(body.email || "").trim().toLowerCase();
      const businessId = String(body.business_id || "");

      if (!email || !businessId) {
        return respond(400, { success: false, error: "Email and business_id are required." });
      }

      const clientIp = getClientIp(req);
      const rateLimit = await enforceSendRateLimit("admin:" + email, clientIp);
      if (!rateLimit.allowed) return respond(rateLimit.status || 429, { success: false, error: rateLimit.error });

      // Verify the email belongs to an admin of this business
      const { data: admin } = await supabase
        .from("admin_users")
        .select("id, role")
        .eq("business_id", businessId)
        .eq("email", email)
        .in("role", ["MAIN_ADMIN", "SUPER_ADMIN"])
        .maybeSingle();

      if (!admin) {
        return respond(403, { success: false, error: "Not authorised." });
      }

      const { token, code } = await issueOtpAttempt({
        businessId,
        email: "admin:" + email,
        phoneTail: "admin",
        ipAddress: clientIp,
        purpose: "admin_settings",
      });

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [email],
          subject: "Verify settings change",
          html: otpEmailHtml(code),
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        console.error("RESEND_ADMIN_OTP_ERR", res.status, JSON.stringify(errData));
        return respond(500, { success: false, error: "Failed to send verification email." });
      }

      return respond(200, { success: true, token });
    }

    /* ── VERIFY OTP ── */
    if (action === "verify") {
      const token = String(body.token || "");
      const userCode = normalizeOtpCode(String(body.code || ""));

      if (!token || !userCode) {
        return respond(400, { success: false, error: "Token and code are required." });
      }

      const result = await verifyTrackedOtp(supabase, OTP_SECRET, token, userCode);
      if (!result.valid) {
        if (result.status === 429) {
          return respond(429, { success: false, verified: false, error: result.error });
        }
        return respond(200, { success: false, verified: false, error: result.error });
      }

      return respond(200, { success: true, verified: true });
    }

    return respond(400, { success: false, error: "Unknown action. Use 'send' or 'verify'." });
  } catch (error) {
    console.error("send-otp error", error);
    return respond(500, {
      success: false,
      error: error instanceof Error ? error.message : "Unhandled error",
    });
  }
});
