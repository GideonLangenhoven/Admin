// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-business-id, x-tenant-subdomain, x-tenant-origin, x-voucher-code, x-booking-success-token, x-booking-id, x-booking-waiver-token",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
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

const BOOKING_DOMAIN = Deno.env.get("BOOKING_DOMAIN") || "booking.bookingtours.co.za";
const DEFAULT_TIMEZONE = "Africa/Johannesburg";
const DEFAULT_CURRENCY = "ZAR";

// Mirrors regenerateDerivedUrls in app/super-admin/page.tsx — the booking site
// reads these columns directly, so a skeleton tenant needs them from birth.
function derivedUrls(base: string) {
  return {
    booking_site_url: base,
    manage_bookings_url: base + "/my-bookings",
    booking_success_url: base + "/success",
    booking_cancel_url: base + "/cancelled",
    gift_voucher_url: base + "/voucher",
    voucher_success_url: base + "/voucher-success",
    waiver_url: base + "/waiver",
  };
}

function buildInviteLink(onboardingUrl: unknown, token: string) {
  const base = String(onboardingUrl || Deno.env.get("ONBOARDING_APP_URL") || "").replace(/\/+$/, "");
  return base ? `${base}?token=${token}` : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const action = String(body.action || "generate");

    // Authenticate the super admin
    const requesterEmail = String(body.requester_email || "").trim().toLowerCase();
    const requesterPassword = String(body.requester_password || "");

    if (!requesterEmail || !requesterPassword) {
      return respond(400, { success: false, error: "requester_email and requester_password are required" });
    }

    const { data: requester, error: requesterError } = await supabase
      .from("admin_users")
      .select("id, role, password_hash, suspended")
      .eq("email", requesterEmail)
      .maybeSingle();

    if (requesterError) throw requesterError;
    if (!requester || !/super/i.test(String(requester.role || ""))) {
      return respond(403, { success: false, error: "Only super admins can manage invite tokens" });
    }
    if (requester.suspended) {
      return respond(403, { success: false, error: "Account is suspended" });
    }

    const requesterHash = await sha256Hex(requesterPassword);
    if (!requester.password_hash || requester.password_hash !== requesterHash) {
      return respond(403, { success: false, error: "Super admin password verification failed" });
    }

    if (action === "generate") {
      // Generate a new single-use invite token (default 48h expiry) together
      // with the skeleton tenant it provisions. Creating the business up front
      // is what lets the wizard autosave straight onto real rows instead of
      // holding a plaintext draft of the client's answers.
      const clientName = String(body.client_name || "").trim();
      const clientEmail = String(body.client_email || "").trim().toLowerCase();
      const subdomain = String(body.subdomain || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");

      if (!clientName || !clientEmail || !subdomain) {
        return respond(400, {
          success: false,
          error: "client_name, client_email and subdomain are required to generate an invite",
        });
      }

      const expiresInHours = Math.min(Math.max(Number(body.expires_in_hours) || 48, 1), 720); // 1h to 30 days
      const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

      const base = `https://${subdomain}.${BOOKING_DOMAIN}`;
      const { data: business, error: businessError } = await supabase
        .from("businesses")
        .insert({
          name: clientName,
          business_name: clientName,
          operator_email: clientEmail,
          subdomain,
          timezone: DEFAULT_TIMEZONE,
          currency: DEFAULT_CURRENCY,
          // Explicit, not the column default ('ACTIVE'): a half-provisioned
          // tenant must not be able to trade or be invoiced. ONBOARDING is
          // outside the TRADING set, so every payment gate fails closed until
          // the wizard's go-live step flips it.
          subscription_status: "ONBOARDING",
          ...derivedUrls(base),
        })
        .select("id, business_name, subdomain")
        .single();

      if (businessError) {
        if (businessError.code === "23505") {
          return respond(409, {
            success: false,
            error: `Subdomain "${subdomain}" is already taken. Pick a different one.`,
          });
        }
        throw businessError;
      }

      const { data: tokenRow, error: tokenError } = await supabase
        .from("invite_tokens")
        .insert({
          created_by: requester.id,
          expires_at: expiresAt,
          business_id: business.id,
          client_name: clientName,
          client_email: clientEmail,
        })
        .select("id, token, expires_at, created_at")
        .single();

      if (tokenError) {
        // Same manual rollback super-admin-onboard uses: no transaction spans
        // these two inserts, and an orphan skeleton tenant would squat the
        // subdomain with no way to reach it.
        await supabase.from("businesses").delete().eq("id", business.id);
        throw tokenError;
      }

      return respond(200, {
        success: true,
        token: tokenRow.token,
        invite_link: buildInviteLink(body.onboarding_url, tokenRow.token),
        expires_at: tokenRow.expires_at,
        created_at: tokenRow.created_at,
        business_id: business.id,
        business_name: business.business_name,
        subdomain: business.subdomain,
      });
    }

    if (action === "reissue") {
      // A call that runs past the token's expiry shouldn't strand the tenant
      // that's already half-filled: mint a fresh token against the same
      // business rather than starting over on a new subdomain.
      const businessId = String(body.business_id || "").trim();
      if (!businessId) {
        return respond(400, { success: false, error: "business_id is required for reissue" });
      }

      const { data: business, error: businessError } = await supabase
        .from("businesses")
        .select("id, business_name, operator_email")
        .eq("id", businessId)
        .maybeSingle();
      if (businessError) throw businessError;
      if (!business) return respond(404, { success: false, error: "Business not found" });

      const { data: prior } = await supabase
        .from("invite_tokens")
        .select("client_name, client_email")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const expiresInHours = Math.min(Math.max(Number(body.expires_in_hours) || 48, 1), 720);
      const { data: tokenRow, error: tokenError } = await supabase
        .from("invite_tokens")
        .insert({
          created_by: requester.id,
          expires_at: new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString(),
          business_id: businessId,
          client_name: prior?.client_name || business.business_name,
          client_email: prior?.client_email || business.operator_email,
        })
        .select("id, token, expires_at, created_at")
        .single();
      if (tokenError) throw tokenError;

      return respond(200, {
        success: true,
        token: tokenRow.token,
        invite_link: buildInviteLink(body.onboarding_url, tokenRow.token),
        expires_at: tokenRow.expires_at,
        business_id: businessId,
      });
    }

    if (action === "list") {
      // List all tokens (most recent first), with usage status
      const { data: tokens, error: listError } = await supabase
        .from("invite_tokens")
        .select(
          "id, token, created_at, expires_at, used_at, used_by_email, used_by_business_id, " +
          "business_id, client_name, client_email, wizard_step, " +
          "businesses:business_id (business_name, subdomain, subscription_status, yoco_webhook_status)"
        )
        .order("created_at", { ascending: false })
        .limit(50);

      if (listError) throw listError;

      const now = new Date();
      const enriched = (tokens || []).map((t: any) => ({
        ...t,
        status: t.used_at
          ? "used"
          : new Date(t.expires_at) < now
            ? "expired"
            : "active",
        invite_link: buildInviteLink(body.onboarding_url, t.token),
      }));

      return respond(200, { success: true, tokens: enriched });
    }

    if (action === "revoke") {
      // Revoke (delete) an unused token by its UUID
      const tokenId = String(body.token_id || "").trim();
      if (!tokenId) {
        return respond(400, { success: false, error: "token_id is required for revoke" });
      }

      const { data: revoked, error: revokeError } = await supabase
        .from("invite_tokens")
        .delete()
        .eq("id", tokenId)
        .is("used_at", null)
        .select("id, business_id")
        .maybeSingle();

      if (revokeError) throw revokeError;
      if (!revoked) {
        return respond(404, { success: false, error: "No unused invite found with that id (already used or revoked)." });
      }

      // Free the subdomain the skeleton was holding, but only while the tenant
      // never went live — once it is trading it belongs to the client, not to
      // the invite. Any other invite still pointing at it blocks the cleanup.
      let businessDeleted = false;
      if (revoked.business_id) {
        const { count: siblingTokens } = await supabase
          .from("invite_tokens")
          .select("id", { count: "exact", head: true })
          .eq("business_id", revoked.business_id);

        if (!siblingTokens) {
          const { data: gone } = await supabase
            .from("businesses")
            .delete()
            .eq("id", revoked.business_id)
            .eq("subscription_status", "ONBOARDING")
            .select("id")
            .maybeSingle();
          businessDeleted = Boolean(gone);
        }
      }

      return respond(200, { success: true, revoked: tokenId, business_deleted: businessDeleted });
    }

    return respond(400, { success: false, error: "Unknown action. Use 'generate', 'reissue', 'list', or 'revoke'." });
  } catch (error) {
    console.error("generate-invite-token error", error);
    return respond(500, {
      success: false,
      error: error instanceof Error ? error.message : "Unhandled error",
    });
  }
});
