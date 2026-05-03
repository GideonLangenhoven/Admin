// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

var SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
var SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY")!;
var SETTINGS_ENCRYPTION_KEY = Deno.env.get("SETTINGS_ENCRYPTION_KEY") || "";

var db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function getCors(req: Request) {
  var origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

async function verifyAdmin(req: Request, businessId: string) {
  var jwt = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!jwt) return null;
  var { data: { user }, error } = await db.auth.getUser(jwt);
  if (error || !user) return null;
  var { data: row } = await db
    .from("admin_users")
    .select("id")
    .eq("user_id", user.id)
    .eq("business_id", businessId)
    .maybeSingle();
  return row ? user : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCors(req) });
  }

  if (!SETTINGS_ENCRYPTION_KEY) {
    return fail(req, "Encryption key not configured", 503);
  }

  var body: any;
  try {
    body = await req.json();
  } catch {
    return fail(req, "Invalid JSON");
  }

  var { action, business_id } = body;
  if (!business_id) return fail(req, "business_id required");

  var user = await verifyAdmin(req, business_id);
  if (!user) return fail(req, "Unauthorized", 401);

  if (action === "get") {
    var { data, error } = await db.rpc("get_business_bank_details", {
      p_business_id: business_id,
      p_key: SETTINGS_ENCRYPTION_KEY,
    });
    if (error) return fail(req, error.message, 500);
    var row = Array.isArray(data) ? data[0] : data;
    return ok(req, {
      account_owner: row?.account_owner || null,
      account_number: row?.account_number || null,
      account_type: row?.account_type || null,
      bank_name: row?.bank_name || null,
      branch_code: row?.branch_code || null,
    });
  }

  if (action === "set") {
    var { account_owner, account_number, account_type, bank_name, branch_code } = body;
    var { error: setErr } = await db.rpc("set_business_bank_details", {
      p_business_id: business_id,
      p_key: SETTINGS_ENCRYPTION_KEY,
      p_account_owner: account_owner ?? null,
      p_account_number: account_number ?? null,
      p_account_type: account_type ?? null,
      p_bank_name: bank_name ?? null,
      p_branch_code: branch_code ?? null,
    });
    if (setErr) return fail(req, setErr.message, 500);
    return ok(req, { success: true });
  }

  return fail(req, "Unknown action: " + action);
});
