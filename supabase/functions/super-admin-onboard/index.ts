// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
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
    const idempotencyKey = String(body.idempotency_key || "").trim();
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
    const customDomain = String(body.custom_domain || "").trim() || null;

    if (!requesterEmail || !requesterPassword || !businessName || !adminName || !adminEmail) {
      return respond(400, { success: false, error: "requester_email, requester_password, business_name, admin_name, and admin_email are required" });
    }

    const { data: requester, error: requesterError } = await supabase
      .from("admin_users")
      .select("id, role, password_hash, suspended")
      .eq("email", requesterEmail)
      .maybeSingle();
    if (requesterError) throw requesterError;
    if (!requester || !/super/i.test(String(requester.role || ""))) {
      return respond(403, { success: false, error: "Only super admins can create new tenants" });
    }
    if (requester.suspended) {
      return respond(403, { success: false, error: "Account is suspended" });
    }
    const requesterHash = await sha256Hex(requesterPassword);
    if (!requester.password_hash || requester.password_hash !== requesterHash) {
      return respond(403, { success: false, error: "Super admin password verification failed" });
    }

    // ── IDEMPOTENCY CHECK ──
    if (idempotencyKey) {
      const idempKey = "onboard:" + idempotencyKey;
      const idempInsert = await supabase
        .from("idempotency_keys")
        .insert({ key: idempKey })
        .select("id")
        .maybeSingle();

      if (idempInsert.error && idempInsert.error.code === "23505") {
        console.log("ONBOARD_IDEMPOTENCY_SKIP: already processed key=" + idempKey);

        const { data: existingBusiness } = await supabase
          .from("businesses")
          .select("id, business_name, timezone, currency, logo_url")
          .eq("name", businessName)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const { data: existingAdmin } = await supabase
          .from("admin_users")
          .select("id, email, name, business_id")
          .eq("email", adminEmail)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        return respond(200, {
          success: true,
          business: existingBusiness || { id: "unknown" },
          admin: existingAdmin || { id: "unknown" },
          idempotent: true,
        });
      }
    }

    const subdomain = String(body.subdomain || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "") || null;
    const bookingSiteUrl = String(body.booking_site_url || "").trim() || null;

    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .insert({
        name: businessName,
        business_name: businessName,
        business_tagline: businessTagline || null,
        logo_url: logoUrl,
        timezone,
        currency,
        subdomain,
        booking_site_url: bookingSiteUrl,
      })
      .select("id, business_name, timezone, currency, logo_url, subdomain")
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

    // ── Validate Yoco API keys before saving ──
    if (yocoSecretKey) {
      try {
        const yocoRes = await fetch("https://payments.yoco.com/api/checkouts", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${yocoSecretKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ amount: 100, currency: "ZAR" }),
        });
        if (yocoRes.status === 401) {
          return respond(400, {
            success: false,
            error: "Invalid Yoco API keys. Please verify your Secret Key.",
          });
        }
        // Any non-401 response (including 400 for missing fields) means the key is valid
      } catch (yocoErr) {
        return respond(500, {
          success: false,
          error: `Could not validate Yoco credentials: ${yocoErr instanceof Error ? yocoErr.message : "Network error"}`,
        });
      }
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

    // TODO: Integrate with Vercel Domains API to programmatically add custom domain and provision SSL certificate.
    // For now, custom domain requires manual DNS configuration and Vercel dashboard setup.
    if (customDomain) {
      // Save custom_domain on the business record for future reference
      await supabase.from("businesses").update({ custom_domain: customDomain }).eq("id", business.id);
      console.warn(
        `ACTION REQUIRED: Custom domain "${customDomain}" specified for business "${businessName}" (${business.id}). ` +
        `Manual DNS/Vercel configuration is needed: add CNAME record and configure domain in Vercel dashboard.`
      );
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
