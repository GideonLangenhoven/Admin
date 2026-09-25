import { withSentry } from "../_shared/sentry.ts";
// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SETTINGS_ENCRYPTION_KEY = Deno.env.get("SETTINGS_ENCRYPTION_KEY") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-business-id, x-tenant-subdomain, x-tenant-origin, x-voucher-code, x-booking-success-token, x-booking-id, x-booking-waiver-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

async function requireCredentialMfa(req: Request, adminId: string, userId: string) {
  const token = (req.headers.get("authorization") || "").match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return { error: "Sign in again before linking credentials", status: 401 } as const;
  let userResult;
  try { userResult = await supabase.auth.getUser(token); }
  catch { return { error: "MFA verification is temporarily unavailable. Nothing was changed.", status: 503 } as const; }
  const user = userResult.data.user;
  if (userResult.error || !user || user.id !== userId) return { error: "Sign in again before linking credentials", status: 401 } as const;

  let assurance;
  try { assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel(token); }
  catch { return { error: "MFA verification is temporarily unavailable. Nothing was changed.", status: 503 } as const; }
  if (assurance.error || !assurance.data) return { error: "MFA verification is temporarily unavailable. Nothing was changed.", status: 503 } as const;
  const factors = (user.factors || []).filter((factor: any) => factor.status === "verified" && factor.factor_type === "totp");
  const { data: recovery, error: recoveryError } = await supabase.from("mfa_recovery_state")
    .select("status, completed_at").eq("admin_id", adminId).maybeSingle();
  if (recoveryError) return { error: "Recovery status could not be verified. Nothing was changed.", status: 503 } as const;
  if (recovery && recovery.status !== "COMPLETED") return { error: "MFA recovery must finish before credentials can be linked", status: 423 } as const;
  if (recovery?.status === "COMPLETED") {
    const completedAt = Date.parse(recovery.completed_at || "");
    const freshFactor = factors.some((factor: any) => Date.parse(factor.updated_at || factor.created_at || "") > completedAt);
    const freshChallenge = (assurance.data.currentAuthenticationMethods || []).some((method: any) =>
      typeof method !== "string" && String(method.method).includes("totp") && Number(method.timestamp) * 1000 > completedAt
    );
    if (!freshFactor || !freshChallenge) return { error: "Enroll and verify a new authenticator after recovery", status: 403 } as const;
  }
  if (!factors.length) return { error: "Set up an authenticator before linking credentials", status: 403 } as const;
  if (assurance.data.currentLevel !== "aal2") return { error: "Enter a current authenticator code before linking credentials", status: 403 } as const;
  return { ok: true } as const;
}

// Removed: two-step encryption context pattern was replaced with key-as-parameter RPCs.

Deno.serve(withSentry("super-admin-onboard", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond(405, { success: false, error: "Method not allowed" });
  let auth;
  try { auth = await requireAuth(req); }
  catch { return respond(401, { success: false, error: "Unauthorized" }); }
  if (auth.role !== "SUPER_ADMIN" || auth.isServiceRole) {
    return respond(403, { success: false, error: "Only signed-in super admins can create new tenants" });
  }

  try {
    const body = await req.json();
    const idempotencyKey = String(body.idempotency_key || "").trim();
    const businessName = String(body.business_name || "").trim();
    const businessTagline = String(body.business_tagline || "").trim();
    const adminName = String(body.admin_name || "").trim();
    const adminEmail = String(body.admin_email || "").trim().toLowerCase();
    const timezone = String(body.timezone || "Africa/Johannesburg").trim();
    const currency = String(body.currency || "ZAR").trim().toUpperCase();
    const logoUrl = String(body.logo_url || "").trim() || null;
    const waToken = String(body.wa_token || "").trim() || null;
    const waPhoneId = String(body.wa_phone_id || "").trim() || null;
    const yocoSecretKey = String(body.yoco_secret_key || "").trim() || null;
    const yocoWebhookSecret = String(body.yoco_webhook_secret || "").trim() || null;
    const customDomain = String(body.custom_domain || "").trim() || null;

    if (!businessName || !adminName || !adminEmail) {
      return respond(400, { success: false, error: "business_name, admin_name, and admin_email are required" });
    }

    const { data: requester, error: requesterError } = await supabase
      .from("admin_users")
      .select("id, role, suspended")
      .eq("user_id", auth.userId)
      .maybeSingle();
    if (requesterError) throw requesterError;
    if (!requester || requester.role !== "SUPER_ADMIN") {
      return respond(403, { success: false, error: "Only super admins can create new tenants" });
    }
    if (requester.suspended) {
      return respond(403, { success: false, error: "Account is suspended" });
    }
    const subdomain = String(body.subdomain || "").trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) return respond(400, { success: false, error: "A valid booking subdomain is required" });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idempotencyKey)) return respond(400, { success: false, error: "A valid onboarding request ID is required" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) return respond(400, { success: false, error: "A valid owner email is required" });
    try { new Intl.DateTimeFormat("en", { timeZone: timezone }); }
    catch { return respond(400, { success: false, error: "Use a valid timezone, such as Africa/Johannesburg" }); }
    if (currency !== "ZAR") return respond(400, { success: false, error: "Yoco onboarding currently supports ZAR" });
    if (customDomain) return respond(400, { success: false, error: "Use the booking subdomain first. Custom domains require a separate DNS setup." });
    const credentials = Object.fromEntries(Object.entries({
      wa_token: waToken, wa_phone_id: waPhoneId, yoco_secret_key: yocoSecretKey, yoco_webhook_secret: yocoWebhookSecret,
    }).filter(([, value]) => value));
    if (Boolean(waToken) !== Boolean(waPhoneId) || Boolean(yocoSecretKey) !== Boolean(yocoWebhookSecret)) {
      return respond(400, { success: false, error: "Supply both values for each credential pair, or leave both blank and connect it later in Settings." });
    }
    if (Object.keys(credentials).length && SETTINGS_ENCRYPTION_KEY.length < 32) throw new Error("Credential encryption is not configured");
    if (yocoSecretKey && !yocoSecretKey.startsWith("sk_live_")) return respond(400, { success: false, error: "This field is for the live Yoco key. Configure test keys separately in Settings." });
    if (Object.keys(credentials).length) {
      const mfa = await requireCredentialMfa(req, requester.id, auth.userId);
      if ("error" in mfa) return respond(mfa.status, { success: false, code: "MFA_REQUIRED", error: mfa.error });
    }
    // Saving a key is not a payment verification. No surprise checkout is
    // created, and the readiness checklist keeps the provider test outstanding.
    const { data, error } = await supabase.rpc("platform_onboard_business_audited", {
      p_actor_id: requester.id, p_request_id: idempotencyKey,
      p_business: { business_name: businessName, business_tagline: businessTagline, timezone, currency, logo_url: logoUrl, subdomain },
      p_admin: { name: adminName, email: adminEmail }, p_credentials: credentials, p_key: SETTINGS_ENCRYPTION_KEY,
    });
    if (error) throw error;
    return respond(200, data);
  } catch (error) {
    console.error("super-admin-onboard error", error);
    // Supabase query errors are PostgrestError objects, NOT Error instances, so
    // `instanceof Error` would drop the real message. Read .message directly.
    const e = error as { message?: string; details?: string; hint?: string; code?: string };
    const msg = e?.message || e?.details || (typeof error === "string" ? error : "") || "Unhandled error";
    const friendly = e?.code === "23505"
      ? `A record with these details already exists (${e.details || e.message}). The admin email or subdomain may already be in use.`
      : msg;
    return respond(500, { success: false, error: friendly });
  }
}));
