import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const SETTINGS_ENCRYPTION_KEY = Deno.env.get("SETTINGS_ENCRYPTION_KEY") || "";

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

async function sha256Hex(input: string) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Removed: two-step encryption context pattern was replaced with key-as-parameter RPCs.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond(405, { success: false, error: "Method not allowed" });

  try {
    const body = await req.json();
    const requesterEmail = String(body.requester_email || "").trim().toLowerCase();
    const requesterPassword = String(body.requester_password || "");
    const businessName = String(body.business_name || "").trim();
    const businessTagline = String(body.business_tagline || "").trim();
    const adminName = String(body.admin_name || "").trim();
    const adminEmail = String(body.admin_email || "").trim().toLowerCase();
    const timezone = String(body.timezone || "UTC").trim();
    const currency = String(body.currency || "ZAR").trim().toUpperCase();
    const logoUrl = String(body.logo_url || "").trim() || null;
    const waToken = String(body.wa_token || "").trim() || null;
    const waPhoneId = String(body.wa_phone_id || "").trim() || null;
    const yocoSecretKey = String(body.yoco_secret_key || "").trim() || null;
    const yocoWebhookSecret = String(body.yoco_webhook_secret || "").trim() || null;

    if (!requesterEmail || !requesterPassword || !businessName || !adminName || !adminEmail) {
      return respond(400, { success: false, error: "requester_email, requester_password, business_name, admin_name, and admin_email are required" });
    }

    const { data: requester, error: requesterError } = await supabase
      .from("admin_users")
      .select("id, role, password_hash")
      .eq("email", requesterEmail)
      .maybeSingle();
    if (requesterError) throw requesterError;
    if (!requester || !/super/i.test(String(requester.role || ""))) {
      return respond(403, { success: false, error: "Only super admins can create new tenants" });
    }
    const requesterHash = await sha256Hex(requesterPassword);
    if (!requester.password_hash || requester.password_hash !== requesterHash) {
      return respond(403, { success: false, error: "Super admin password verification failed" });
    }

    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .insert({
        name: businessName,
        business_name: businessName,
        business_tagline: businessTagline || null,
        logo_url: logoUrl,
        timezone,
        currency,
      })
      .select("id, business_name, timezone, currency, logo_url")
      .single();

    if (businessError) throw businessError;

    const { data: admin, error: adminError } = await supabase
      .from("admin_users")
      .insert({
        business_id: business.id,
        name: adminName,
        email: adminEmail,
        role: "MAIN_ADMIN",
        password_hash: "",
        must_set_password: true,
      })
      .select("id, email, name, business_id")
      .single();

    if (adminError) {
      await supabase.from("businesses").delete().eq("id", business.id);
      throw adminError;
    }

    if (waToken || waPhoneId || yocoSecretKey || yocoWebhookSecret) {
      if (!SETTINGS_ENCRYPTION_KEY || SETTINGS_ENCRYPTION_KEY.length < 32) {
        throw new Error("SETTINGS_ENCRYPTION_KEY must be 32+ characters to store credentials.");
      }
      const { error: credentialError } = await supabase.rpc("set_business_credentials", {
        p_business_id: business.id,
        p_key: SETTINGS_ENCRYPTION_KEY,
        p_wa_token: waToken,
        p_wa_phone_id: waPhoneId,
        p_yoco_secret_key: yocoSecretKey,
        p_yoco_webhook_secret: yocoWebhookSecret,
      });
      if (credentialError) throw credentialError;
    }

    return respond(200, {
      success: true,
      business,
      admin,
    });
  } catch (error) {
    console.error("super-admin-onboard error", error);
    return respond(500, {
      success: false,
      error: error instanceof Error ? error.message : "Unhandled error",
    });
  }
});
