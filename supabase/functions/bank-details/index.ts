// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY")!;
const SETTINGS_ENCRYPTION_KEY = Deno.env.get("SETTINGS_ENCRYPTION_KEY") || "";

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function getCors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-business-id, x-tenant-business-id, x-tenant-subdomain, x-tenant-origin, x-voucher-code, x-booking-success-token, x-booking-id, x-booking-waiver-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

function ok(req: Request, data: unknown) {
  return new Response(JSON.stringify(data), { status: 200, headers: getCors(req) });
}

function fail(req: Request, msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: getCors(req) });
}

async function verifyAdmin(req: Request, businessId: string, action: string) {
  const jwt = (req.headers.get("authorization") || "").match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!jwt) return { error: "Unauthorized", status: 401 } as const;
  let userResult;
  try { userResult = await db.auth.getUser(jwt); }
  catch { return { error: "Authentication service unavailable", status: 503 } as const; }
  const user = userResult.data.user;
  if (userResult.error || !user) return { error: "Unauthorized", status: 401 } as const;
  const { data: row, error: rowError } = await db
    .from("admin_users")
    .select("id, user_id, role, business_id, suspended, read_only")
    .eq("user_id", user.id)
    .maybeSingle();
  if (rowError) return { error: "Account verification unavailable", status: 503 } as const;
  if (!row || row.suspended || !["OPERATOR", "ADMIN", "MAIN_ADMIN", "SUPER_ADMIN"].includes(row.role)) {
    return { error: "Unauthorized", status: 403 } as const;
  }
  if (row.role === "SUPER_ADMIN" && req.headers.get("x-admin-business-id")?.trim() !== businessId) {
    return { error: "Select the target business again", status: 403 } as const;
  }
  if (row.role !== "SUPER_ADMIN" && row.business_id !== businessId) return { error: "Wrong business", status: 403 } as const;
  if (action !== "set") return { user, actor: row, jwt } as const;
  if (row.read_only) return { error: "This demonstration account is read-only", status: 403 } as const;
  if (row.role !== "MAIN_ADMIN" && row.role !== "SUPER_ADMIN") return { error: "MAIN_ADMIN or SUPER_ADMIN required", status: 403 } as const;

  const { data: business, error: businessError } = await db.from("businesses")
    .select("id, subscription_status").eq("id", businessId).maybeSingle();
  if (businessError) return { error: "Target business verification unavailable", status: 503 } as const;
  if (!business || !["ACTIVE", "TRIAL", "PAST_DUE"].includes(String(business.subscription_status || "").toUpperCase())) {
    return { error: "Protected settings require an active business", status: 403 } as const;
  }

  let assurance;
  try { assurance = await db.auth.mfa.getAuthenticatorAssuranceLevel(jwt); }
  catch { return { error: "MFA verification unavailable", status: 503 } as const; }
  if (assurance.error || !assurance.data) return { error: "MFA verification unavailable", status: 503 } as const;
  const factors = (user.factors || []).filter((factor: any) => factor.status === "verified" && factor.factor_type === "totp");

  const { data: recovery, error: recoveryError } = await db.from("mfa_recovery_state")
    .select("status, completed_at")
    .eq("admin_id", row.id)
    .maybeSingle();
  if (recoveryError) return { error: "Recovery status unavailable", status: 503 } as const;
  if (recovery && recovery.status !== "COMPLETED") return { error: "MFA recovery is still in progress", status: 423 } as const;
  if (recovery?.status === "COMPLETED") {
    const completedAt = Date.parse(recovery.completed_at || "");
    const freshFactor = factors.some((factor: any) => Date.parse(factor.updated_at || factor.created_at || "") > completedAt);
    const freshChallenge = (assurance.data.currentAuthenticationMethods || []).some((method: any) =>
      typeof method !== "string" && String(method.method).includes("totp") && Number(method.timestamp) * 1000 > completedAt
    );
    if (!freshFactor || !freshChallenge) return { error: "Enroll and verify a new authenticator after recovery", status: 403 } as const;
  }
  if (!factors.length) return { error: "Set up an authenticator before changing bank details", status: 403 } as const;
  if (assurance.data.currentLevel !== "aal2") return { error: "Enter a current authenticator code before changing bank details", status: 403 } as const;
  return { user, actor: row, jwt } as const;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCors(req) });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail(req, "Invalid JSON");
  }

  const { action, business_id } = body;
  if (!business_id) return fail(req, "business_id required");

  const admin = await verifyAdmin(req, business_id, action);
  if ("error" in admin) return fail(req, admin.error, admin.status);

  if (!SETTINGS_ENCRYPTION_KEY) {
    return fail(req, "Encryption key not configured", 503);
  }

  if (action === "get") {
    const { data, error } = await db.rpc("get_business_bank_details", {
      p_business_id: business_id,
      p_key: SETTINGS_ENCRYPTION_KEY,
    });
    if (error) return fail(req, error.message, 500);
    const row = Array.isArray(data) ? data[0] : data;
    return ok(req, {
      account_owner: row?.account_owner || null,
      account_number: row?.account_number || null,
      account_type: row?.account_type || null,
      bank_name: row?.bank_name || null,
      branch_code: row?.branch_code || null,
    });
  }

  if (action === "set") {
    const { account_owner, account_number, account_type, bank_name, branch_code } = body;
    const { error: setErr } = await db.rpc("set_business_bank_details_audited", {
      p_business_id: business_id,
      p_actor_id: admin.actor.id,
      p_key: SETTINGS_ENCRYPTION_KEY,
      p_account_owner: account_owner ?? null,
      p_account_number: account_number ?? null,
      p_account_type: account_type ?? null,
      p_bank_name: bank_name ?? null,
      p_branch_code: branch_code ?? null,
    });
    if (setErr) {
      await db.from("audit_logs").insert({
        actor_id: admin.actor.id,
        business_id,
        action_type: "BANK_DETAILS_CHANGE_FAILED",
        target_entity: "businesses",
        target_id: business_id,
        after_state: { outcome: "failed" },
      });
      return fail(req, setErr.message, 500);
    }
    return ok(req, { success: true });
  }

  return fail(req, "Unknown action: " + action);
});
