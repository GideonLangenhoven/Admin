/**
 * Mints a real Supabase Auth session for an admin account WITHOUT a password,
 * using the service-role admin generate_link endpoint (no email is sent — the
 * endpoint returns the link instead of mailing it).
 *
 * Emits JSON on stdout: { storageKey, storageValue, session, admin }
 * Consumed by tests/e2e/route-sweep.spec.ts to seed localStorage.
 *
 * Usage: node scripts/e2e-mint-session.mjs <email>
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const email = (process.argv[2] || "").trim().toLowerCase();
if (!email) throw new Error("usage: node scripts/e2e-mint-session.mjs <email>");

// 1. Admin-generate a magiclink token (returns the token, does not send mail).
const genRes = await fetch(`${URL_}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", email }),
});
if (!genRes.ok) throw new Error(`generate_link ${genRes.status}: ${await genRes.text()}`);
const link = await genRes.json();
const tokenHash = link.hashed_token || link.properties?.hashed_token;
if (!tokenHash) throw new Error("no hashed_token in generate_link response");

// 2. Exchange the token for a session using the anon key (normal client path).
const verifyRes = await fetch(`${URL_}/auth/v1/verify`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", token_hash: tokenHash }),
});
if (!verifyRes.ok) throw new Error(`verify ${verifyRes.status}: ${await verifyRes.text()}`);
const session = await verifyRes.json();

// 3. Let supabase-js itself serialise the session so the browser storage format
//    matches exactly what the app's bundled client expects to read back.
const written = {};
const shim = {
  getItem: (k) => written[k] ?? null,
  setItem: (k, v) => {
    written[k] = v;
  },
  removeItem: (k) => {
    delete written[k];
  },
};
const client = createClient(URL_, ANON, {
  auth: { storage: shim, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
});
const { error } = await client.auth.setSession({
  access_token: session.access_token,
  refresh_token: session.refresh_token,
});
if (error) throw new Error(`setSession: ${error.message}`);

// 4. Look up the admin row the AuthGate will re-derive from.
const svc = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const { data: admin } = await svc
  .from("admin_users")
  .select("email, name, role, business_id, settings_permissions")
  .eq("email", email)
  .maybeSingle();

const { data: biz } = await svc
  .from("businesses")
  .select("id, timezone")
  .eq("id", admin.business_id)
  .maybeSingle();

console.log(
  JSON.stringify({
    storage: written,
    admin,
    timezone: biz?.timezone || "UTC",
    expires_at: session.expires_at,
  }),
);
