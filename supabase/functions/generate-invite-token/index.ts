import { withSentry } from "../_shared/sentry.ts";
// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAuth } from "../_shared/auth.ts";

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

Deno.serve(withSentry("generate-invite-token", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond(405, { success: false, error: "Method not allowed" });
  let auth;
  try { auth = await requireAuth(req); }
  catch { return respond(401, { success: false, error: "Unauthorized" }); }
  if (auth.role !== "SUPER_ADMIN" || auth.isServiceRole) {
    return respond(403, { success: false, error: "Only signed-in super admins can manage invite tokens" });
  }

  try {
    const body = await req.json();
    const action = String(body.action || "generate");

    const { data: requester, error: requesterError } = await supabase
      .from("admin_users")
      .select("id, role, suspended, read_only")
      .eq("user_id", auth.userId)
      .maybeSingle();

    if (requesterError) throw requesterError;
    if (!requester || requester.role !== "SUPER_ADMIN") {
      return respond(403, { success: false, error: "Only super admins can manage invite tokens" });
    }
    if (requester.suspended || requester.read_only) {
      return respond(403, { success: false, error: "This account cannot manage onboarding invites" });
    }

    if (action === "generate") {
      // Generate a new single-use invite token (default 48h expiry) together
      // with the skeleton tenant it provisions. Creating the business up front
      // is what lets the wizard autosave straight onto real rows instead of
      // holding a plaintext draft of the client's answers.
      const clientName = String(body.client_name || "").trim();
      const clientEmail = String(body.client_email || "").trim().toLowerCase();
      const subdomain = String(body.subdomain || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
      const existingBusinessId = String(body.business_id || "").trim();

      if (!clientName || !clientEmail || !subdomain) {
        return respond(400, {
          success: false,
          error: "client_name, client_email and subdomain are required to generate an invite",
        });
      }

      const expiresInHours = Math.min(Math.max(Number(body.expires_in_hours) || 48, 1), 720); // 1h to 30 days
      const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

      let business;
      if (existingBusinessId) {
        const { data, error } = await supabase.from("businesses")
          .select("id, business_name, subdomain, subscription_status, onboarding_request_id")
          .eq("id", existingBusinessId).maybeSingle();
        if (error) throw error;
        if (!data || data.subdomain !== subdomain || !data.onboarding_request_id || data.subscription_status !== "ACTIVE") {
          return respond(409, { success: false, error: "Select a newly created client with the same subdomain before inviting them to finish setup." });
        }
        const { data: owner, error: ownerError } = await supabase.from("admin_users")
          .select("id").eq("business_id", data.id).eq("role", "MAIN_ADMIN").ilike("email", clientEmail).maybeSingle();
        if (ownerError) throw ownerError;
        if (!owner) return respond(409, { success: false, error: "Client email must match this business's Main Admin email." });
        const { count: bookings, error: bookingError } = await supabase.from("bookings")
          .select("id", { count: "exact", head: true }).eq("business_id", data.id);
        if (bookingError) throw bookingError;
        if (bookings) return respond(409, { success: false, error: "This business already has bookings. Its owner should finish setup in the admin dashboard." });
        const { data: activeInvite, error: inviteError } = await supabase.from("invite_tokens")
          .select("id").eq("business_id", data.id).is("used_at", null)
          .gt("expires_at", new Date().toISOString()).limit(1).maybeSingle();
        if (inviteError) throw inviteError;
        if (activeInvite) return respond(409, { success: false, error: "This business already has an active invite. Refresh the list and copy its link." });
        business = data;
      } else {
        const base = `https://${subdomain}.${BOOKING_DOMAIN}`;
        const { data, error } = await supabase.from("businesses")
          .insert({
            name: clientName,
            business_name: clientName,
            operator_email: clientEmail,
            subdomain,
            timezone: DEFAULT_TIMEZONE,
            currency: DEFAULT_CURRENCY,
            subscription_status: "ONBOARDING",
            max_admin_seats: 1,
            ...derivedUrls(base),
          }).select("id, business_name, subdomain").single();
        if (error) {
          if (error.code === "23505") return respond(409, {
            success: false,
            error: `Subdomain "${subdomain}" already belongs to a business. Select that client to finish setup, or choose a different subdomain.`,
          });
          throw error;
        }
        business = data;
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
        if (!existingBusinessId) await supabase.from("businesses").delete().eq("id", business.id);
        throw tokenError;
      }

      if (existingBusinessId) {
        // The link stays private until we return it, so fence trading after
        // minting the token; a failed insert cannot strand the live business.
        const { data: fenced, error } = await supabase.from("businesses")
          .update({ subscription_status: "ONBOARDING" }).eq("id", business.id)
          .eq("subscription_status", "ACTIVE").select("id").maybeSingle();
        if (error || !fenced) {
          await supabase.from("invite_tokens").delete().eq("id", tokenRow.id);
          if (error) throw error;
          return respond(409, { success: false, error: "This business changed status. Refresh and try again." });
        }
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
        .select("id, business_name, operator_email, subscription_status")
        .eq("id", businessId)
        .maybeSingle();
      if (businessError) throw businessError;
      if (!business) return respond(404, { success: false, error: "Business not found" });

      const { data: prior } = await supabase
        .from("invite_tokens")
        .select("client_name, client_email, wizard_step, used_at")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (business.subscription_status !== "ONBOARDING" &&
          !(business.subscription_status === "ACTIVE" && prior?.wizard_step === "go-live" && !prior.used_at)) {
        return respond(409, { success: false, error: "This business is already live. Its owner can finish setup in the admin dashboard." });
      }

      const expiresInHours = Math.min(Math.max(Number(body.expires_in_hours) || 48, 1), 720);
      const { data: tokenRow, error: tokenError } = await supabase
        .from("invite_tokens")
        .insert({
          created_by: requester.id,
          expires_at: new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString(),
          business_id: businessId,
          client_name: prior?.client_name || business.business_name,
          client_email: prior?.client_email || business.operator_email,
          wizard_step: prior?.wizard_step || null,
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

      // Only an invite-created skeleton may be deleted. A manually created
      // client is kept and returned to ACTIVE when its last link is revoked.
      let businessDeleted = false;
      let businessRestored = false;
      if (revoked.business_id) {
        const { count: siblingTokens } = await supabase
          .from("invite_tokens")
          .select("id", { count: "exact", head: true })
          .eq("business_id", revoked.business_id)
          .is("used_at", null)
          .gt("expires_at", new Date().toISOString());

        if (!siblingTokens) {
          const { data: gone } = await supabase
            .from("businesses")
            .delete()
            .eq("id", revoked.business_id)
            .eq("subscription_status", "ONBOARDING")
            .is("onboarding_request_id", null)
            .select("id")
            .maybeSingle();
          businessDeleted = Boolean(gone);
          if (!businessDeleted) {
            const { data: restored } = await supabase.from("businesses")
              .update({ subscription_status: "ACTIVE" })
              .eq("id", revoked.business_id)
              .eq("subscription_status", "ONBOARDING")
              .not("onboarding_request_id", "is", null)
              .select("id").maybeSingle();
            businessRestored = Boolean(restored);
          }
        }
      }

      return respond(200, { success: true, revoked: tokenId, business_deleted: businessDeleted, business_restored: businessRestored });
    }

    return respond(400, { success: false, error: "Unknown action. Use 'generate', 'reissue', 'list', or 'revoke'." });
  } catch (error) {
    console.error("generate-invite-token error", error);
    return respond(500, {
      success: false,
      error: error instanceof Error ? error.message : "Unhandled error",
    });
  }
}));
