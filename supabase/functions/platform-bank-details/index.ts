// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Mirrors supabase/functions/bank-details/index.ts's get/set shape, but for
// the platform_settings singleton (BookingTours' own bank account, not any
// tenant's) — no business_id, and callers are the Next.js
// /api/platform-settings route only, invoked server-to-server with the
// service-role key (never a browser session JWT), so there's no per-request
// admin JWT to re-verify here; the SUPER_ADMIN check already happened in
// that Next.js route.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY")!;
const SETTINGS_ENCRYPTION_KEY = Deno.env.get("SETTINGS_ENCRYPTION_KEY") || "";

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function ok(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
}

function fail(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (!SETTINGS_ENCRYPTION_KEY) return fail("Encryption key not configured", 503);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON");
  }

  const { action } = body;

  if (action === "get") {
    const { data, error } = await db.rpc("get_platform_bank_details", { p_key: SETTINGS_ENCRYPTION_KEY });
    if (error) return fail(error.message, 500);
    const row = Array.isArray(data) ? data[0] : data;
    return ok({
      account_owner: row?.account_owner || null,
      account_number: row?.account_number || null,
      account_type: row?.account_type || null,
      bank_name: row?.bank_name || null,
      branch_code: row?.branch_code || null,
    });
  }

  if (action === "set") {
    const { account_owner, account_number, account_type, bank_name, branch_code } = body;
    const { error: setErr } = await db.rpc("set_platform_bank_details", {
      p_key: SETTINGS_ENCRYPTION_KEY,
      p_account_owner: account_owner ?? null,
      p_account_number: account_number ?? null,
      p_account_type: account_type ?? null,
      p_bank_name: bank_name ?? null,
      p_branch_code: branch_code ?? null,
    });
    if (setErr) return fail(setErr.message, 500);
    return ok({ success: true });
  }

  return fail("Unknown action: " + action);
});
