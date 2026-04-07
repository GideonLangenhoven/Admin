import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

var SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
var SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
var RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
var FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "BookingTours <noreply@bookingtours.co.za>";
var OTP_SECRET = Deno.env.get("OTP_HMAC_SECRET") || SUPABASE_SERVICE_ROLE_KEY;

var supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

/* ── Rate limiting (in-memory, resets on cold start) ── */
var rateLimitMap = new Map<string, number[]>();
var RATE_LIMIT_MAX = 3;
var RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

function checkRateLimit(email: string): boolean {
  var now = Date.now();
  var timestamps = rateLimitMap.get(email) || [];
  timestamps = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT_MAX) return false;
  timestamps.push(now);
  rateLimitMap.set(email, timestamps);
  return true;
}

/* ── HMAC helpers ── */
async function hmacSign(payload: string): Promise<string> {
  var key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(OTP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  var sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function createToken(email: string, phoneTail: string, code: string, expiresTs: number): Promise<string> {
  var payload = [email, phoneTail, code, expiresTs].join("|");
  var sig = await hmacSign(payload);
  // base64-encode the payload + signature for transport
  var raw = payload + "|" + sig;
  return btoa(raw);
}

async function verifyToken(token: string, userCode: string): Promise<{ valid: boolean; error?: string; email?: string; phoneTail?: string }> {
  try {
    var raw = atob(token);
    var parts = raw.split("|");
    if (parts.length !== 5) return { valid: false, error: "Invalid token format" };
    var [email, phoneTail, code, expiresStr, sig] = parts;
    var expiresTs = Number(expiresStr);

    // Check expiry
    if (Date.now() > expiresTs) return { valid: false, error: "Code expired. Please request a new one." };

    // Verify HMAC
    var payload = [email, phoneTail, code, expiresStr].join("|");
    var expectedSig = await hmacSign(payload);
    if (sig !== expectedSig) return { valid: false, error: "Invalid token" };

    // Check code
    if (userCode.trim() !== code) return { valid: false, error: "Incorrect code. Please try again." };

    return { valid: true, email, phoneTail };
  } catch {
    return { valid: false, error: "Invalid token" };
  }
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
    <p style="margin:0 0 4px;color:#666;font-size:13px">This code expires in 5 minutes.</p>
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
    var body = await req.json();
    var action = String(body.action || "send");

    /* ── SEND OTP ── */
    if (action === "send") {
      var email = String(body.email || "").trim().toLowerCase();
      var phoneTail = String(body.phone_tail || "").replace(/\D/g, "").slice(-9);

      if (!email || !phoneTail) {
        return respond(400, { success: false, error: "Email and phone are required." });
      }

      // Rate limit
      if (!checkRateLimit(email)) {
        return respond(429, { success: false, error: "Too many requests. Please wait a few minutes." });
      }

      // Verify bookings exist (prevents enumeration / spam)
      var { data: bookings } = await supabase
        .from("bookings")
        .select("id, phone")
        .eq("email", email)
        .limit(20);

      var matched = (bookings || []).filter(function (b: { phone?: string }) {
        var rawPhone = (b.phone || "").replace(/\D/g, "");
        if (!rawPhone) return true;
        return rawPhone.slice(-9) === phoneTail;
      });

      if (matched.length === 0) {
        return respond(404, { success: false, error: "No bookings found for this email and phone combination." });
      }

      // Generate 6-digit code
      var codeNum = crypto.getRandomValues(new Uint32Array(1))[0] % 900000 + 100000;
      var code = String(codeNum);
      var expiresTs = Date.now() + 5 * 60 * 1000; // 5 min TTL

      // Create signed token
      var token = await createToken(email, phoneTail, code, expiresTs);

      // Send email via Resend
      var res = await fetch("https://api.resend.com/emails", {
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
        var errData = await res.json();
        console.error("RESEND_OTP_ERR", res.status, JSON.stringify(errData));
        return respond(500, { success: false, error: "Failed to send verification email. Please try again." });
      }

      return respond(200, { success: true, token });
    }

    /* ── VERIFY OTP ── */
    if (action === "verify") {
      var token = String(body.token || "");
      var userCode = String(body.code || "").trim();

      if (!token || !userCode) {
        return respond(400, { success: false, error: "Token and code are required." });
      }

      var result = await verifyToken(token, userCode);
      if (!result.valid) {
        return respond(400, { success: false, error: result.error });
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
