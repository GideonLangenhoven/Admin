// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
      .select("id, role, password_hash")
      .eq("email", requesterEmail)
      .maybeSingle();

    if (requesterError) throw requesterError;
    if (!requester || !/super/i.test(String(requester.role || ""))) {
      return respond(403, { success: false, error: "Only super admins can manage invite tokens" });
    }

    const requesterHash = await sha256Hex(requesterPassword);
    if (!requester.password_hash || requester.password_hash !== requesterHash) {
      return respond(403, { success: false, error: "Super admin password verification failed" });
    }

    if (action === "generate") {
      // Generate a new single-use invite token (default 48h expiry)
      const expiresInHours = Math.min(Math.max(Number(body.expires_in_hours) || 48, 1), 720); // 1h to 30 days
      const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();

      const { data: tokenRow, error: tokenError } = await supabase
        .from("invite_tokens")
        .insert({
          created_by: requester.id,
          expires_at: expiresAt,
        })
        .select("id, token, expires_at, created_at")
        .single();

      if (tokenError) throw tokenError;

      // Build the invite link using the onboarding app URL
      const onboardingBaseUrl = String(body.onboarding_url || Deno.env.get("ONBOARDING_APP_URL") || "").replace(/\/+$/, "");
      const inviteLink = onboardingBaseUrl ? `${onboardingBaseUrl}?token=${tokenRow.token}` : null;

      return respond(200, {
        success: true,
        token: tokenRow.token,
        invite_link: inviteLink,
        expires_at: tokenRow.expires_at,
        created_at: tokenRow.created_at,
      });
    }

    if (action === "list") {
      // List all tokens (most recent first), with usage status
      const { data: tokens, error: listError } = await supabase
        .from("invite_tokens")
        .select("id, token, created_at, expires_at, used_at, used_by_email, used_by_business_id")
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
      }));

      return respond(200, { success: true, tokens: enriched });
    }

    if (action === "revoke") {
      // Revoke (delete) an unused token by its UUID
      const tokenId = String(body.token_id || "").trim();
      if (!tokenId) {
        return respond(400, { success: false, error: "token_id is required for revoke" });
      }

      const { error: revokeError } = await supabase
        .from("invite_tokens")
        .delete()
        .eq("id", tokenId)
        .is("used_at", null);

      if (revokeError) throw revokeError;

      return respond(200, { success: true, revoked: tokenId });
    }

    return respond(400, { success: false, error: "Unknown action. Use 'generate', 'list', or 'revoke'." });
  } catch (error) {
    console.error("generate-invite-token error", error);
    return respond(500, {
      success: false,
      error: error instanceof Error ? error.message : "Unhandled error",
    });
  }
});
