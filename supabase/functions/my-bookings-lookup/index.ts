// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  filterBookingsForLookup,
  normalizePhoneTail,
  resolveBusinessFromOrigin,
  type LookupBusinessRow,
} from "../_shared/my-bookings-lookup.ts";
import { normalizeOtpCode, verifyTrackedOtp } from "../_shared/otp-attempts.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const OTP_SECRET = Deno.env.get("OTP_HMAC_SECRET") || SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function cors(req: Request) {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

function respond(req: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: cors(req) });
}

async function getAuthenticatedEmail(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return "";
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data.user?.email) return "";
  return data.user.email.toLowerCase();
}

async function resolveBusiness(req: Request, body: Record<string, unknown>) {
  const { data, error } = await supabase
    .from("businesses")
    .select("id, subdomain, booking_site_url, manage_bookings_url")
    .order("created_at", { ascending: true });
  if (error) throw new Error("Business lookup failed: " + error.message);

  const origin = req.headers.get("origin") || "";
  return resolveBusinessFromOrigin(
    (data || []) as LookupBusinessRow[],
    origin,
    typeof body.business_id === "string" ? body.business_id : "",
  );
}

const BOOKING_SELECT = [
  "id",
  "business_id",
  "customer_name",
  "email",
  "phone",
  "qty",
  "total_amount",
  "status",
  "refund_status",
  "refund_amount",
  "created_at",
  "unit_price",
  "tour_id",
  "slot_id",
  "custom_fields",
  "converted_to_voucher_id",
  "cancelled_at",
  "cancellation_reason",
  "waiver_status",
  "waiver_token",
  "yoco_payment_id",
  "slots(start_time, capacity_total, booked, held)",
  "tours(name, description, duration_minutes)",
].join(",");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return respond(req, 405, { success: false, error: "Method not allowed" });

  try {
    const body = await req.json() as Record<string, unknown>;
    const business = await resolveBusiness(req, body);
    if (!business) return respond(req, 403, { success: false, error: "Unknown booking site." });

    const requestedEmail = String(body.email || "").trim().toLowerCase();
    const emailOnly = body.emailOnly === true;
    let verifiedEmail = "";
    let phoneTail = "";

    const authEmail = await getAuthenticatedEmail(req);
    if (authEmail) {
      if (requestedEmail && requestedEmail !== authEmail) {
        return respond(req, 403, { success: false, error: "Authenticated email does not match this lookup." });
      }
      verifiedEmail = authEmail;
      phoneTail = normalizePhoneTail(String(body.phone_tail || ""));
    } else {
      const token = String(body.token || "");
      const code = normalizeOtpCode(String(body.code || ""));
      if (!token || !code) return respond(req, 401, { success: false, error: "Verification is required." });
      const verified = await verifyTrackedOtp(supabase, OTP_SECRET, token, code);
      if (!verified.valid || !verified.email) {
        return respond(req, verified.status || 401, { success: false, error: verified.error || "Verification failed." });
      }
      if (verified.purpose && verified.purpose !== "my_bookings") {
        return respond(req, 403, { success: false, error: "Verification token is not valid for this lookup." });
      }
      if (requestedEmail && requestedEmail !== verified.email) {
        return respond(req, 403, { success: false, error: "Verified email does not match this lookup." });
      }
      verifiedEmail = verified.email;
      phoneTail = normalizePhoneTail(verified.phoneTail);
    }

    const { data, error } = await supabase
      .from("bookings")
      .select(BOOKING_SELECT)
      .eq("business_id", business.id)
      .eq("email", verifiedEmail)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return respond(req, 500, { success: false, error: error.message });

    const bookings = filterBookingsForLookup((data || []) as any[], {
      businessId: business.id,
      email: verifiedEmail,
      phoneTail,
      emailOnly: Boolean(authEmail && emailOnly),
    });

    return respond(req, 200, { success: true, bookings });
  } catch (error) {
    console.error("my-bookings-lookup error", error);
    return respond(req, 500, {
      success: false,
      error: error instanceof Error ? error.message : "Unhandled error",
    });
  }
});
