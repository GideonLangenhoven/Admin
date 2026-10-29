#!/usr/bin/env node
// Security tests B and C: what the outside world can do to the Supabase API.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<public key> node scripts/security-surface-check.mjs anon
//     Test C (negative half): with only the public key and no session, tenant data is unreachable and writes are refused.
//     Read-only apart from refused writes aimed at ids that do not exist. The positive half (one booking readable with
//     its id + waiver token, tenant A/B isolation) needs seeded test tenants and lives in tests/tenant-isolation.
//
//   SUPABASE_URL=... OLD_KEY=<retired key> [NEW_SECRET_KEY=<sb_secret_...>] node scripts/security-surface-check.mjs old-key
//     Test B: after rotation the retired key must be rejected everywhere. Keys are read from the environment only and
//     never printed. Run by the owner, who holds the old key.
//
// Exit 0 = every check passed, 1 = a check failed, 2 = could not run.
const [mode] = process.argv.slice(2);
const base = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
if (!base || !["anon", "old-key"].includes(mode)) {
  console.error("usage: SUPABASE_URL=... (SUPABASE_ANON_KEY=... | OLD_KEY=...) node scripts/security-surface-check.mjs anon|old-key");
  process.exit(2);
}

const NOBODY = "00000000-0000-4000-8000-00000000dead";
const REJECTED = [401, 403]; // PostgREST maps permission-denied to 401/403 depending on the role
const failures = [];
let ran = 0;

async function call(key, path, { method = "GET", headers = {}, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
}
function check(name, ok, detail) {
  ran++;
  if (!ok) failures.push(`FAIL ${name}: ${detail}`);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
const noRows = (r) => (Array.isArray(r.json) && r.json.length === 0) || REJECTED.includes(r.status);
const refused = (r) => REJECTED.includes(r.status) || r.status === 404 || (Array.isArray(r.json) && r.json.length === 0);

try {
  if (mode === "anon") {
    const key = process.env.SUPABASE_ANON_KEY;
    if (!key) { console.error("SUPABASE_ANON_KEY (the public key) is required"); process.exit(2); }
    const get = (path, headers) => call(key, path, { headers });

    for (const [label, headers] of [["no tenant header", {}], ["with a tenant header", { "x-tenant-business-id": NOBODY }]]) {
      const r = await get("/rest/v1/customers?select=*", headers);
      check(`customers readable by anon: 0 rows or refused (${label})`, noRows(r), `status ${r.status}, ${JSON.stringify(r.json)?.slice(0, 80)}`);
    }
    let r = await get("/rest/v1/bookings?select=*");
    check("bookings without id + waiver token: 0 rows", noRows(r), `status ${r.status}`);
    r = await get("/rest/v1/bookings?select=*", { "x-booking-id": NOBODY, "x-booking-waiver-token": NOBODY });
    check("bookings with a wrong id + token: 0 rows", noRows(r), `status ${r.status}`);
    for (const table of ["admin_users", "businesses", "logs"]) {
      r = await get(`/rest/v1/${table}?select=*&limit=1`);
      check(`${table}?select=* : permission denied`, REJECTED.includes(r.status), `status ${r.status}`);
    }
    r = await get("/rest/v1/vouchers?select=*");
    check("vouchers without the code header: 0 rows", noRows(r), `status ${r.status}`);

    r = await call(key, `/rest/v1/bookings?id=eq.${NOBODY}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: { status: "PAID" } });
    check("PATCH bookings status=PAID: nothing modified", refused(r), `status ${r.status}, ${JSON.stringify(r.json)?.slice(0, 80)}`);
    r = await call(key, `/rest/v1/bookings?id=eq.${NOBODY}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: { refund_status: "REFUNDED", refund_amount: 1 } });
    check("PATCH bookings refund_*: nothing modified", refused(r), `status ${r.status}`);

    for (const fn of ["get_operator_dashboard", "get_business_credentials", "set_paysafe_credentials", "set_yoco_credentials", "marketing_audience_summary"]) {
      r = await call(key, `/rest/v1/rpc/${fn}`, { method: "POST", body: {} });
      check(`rpc/${fn}: refused`, REJECTED.includes(r.status) || r.status === 404, `status ${r.status}`);
    }
    r = await call(key, "/rest/v1/rpc/current_business_ids", { method: "POST", body: {} });
    check("rpc/current_business_ids returns []", r.status === 200 && (r.json === null || (Array.isArray(r.json) && r.json.length === 0)), `status ${r.status}, ${JSON.stringify(r.json)?.slice(0, 60)}`);

    // Tables the storefront never writes. The criterion is "no write is applied": an INSERT must error, and an
    // UPDATE/DELETE must error or match no row. Each probe filters on the table's real primary key with a value that
    // cannot exist, so a stray success could never touch real data.
    const NEVER_WRITTEN = {
      customers: ["id", NOBODY], chat_faq_entries: ["id", NOBODY], data_subject_requests: ["id", NOBODY], reviews: ["id", NOBODY],
      promotion_uses: ["id", NOBODY], combo_bookings: ["id", NOBODY], tenant_health: ["business_id", NOBODY],
      marketing_permission_events: ["id", "-1"], otp_attempts: ["token_hash", "no-such-token"], platform_public_settings: ["key", "no-such-key"],
    };
    const noRowChanged = (r) => r.status >= 400 || (r.status < 300 && Array.isArray(r.json) && r.json.length === 0);
    for (const [table, [pk, sentinel]] of Object.entries(NEVER_WRITTEN)) {
      const post = await call(key, `/rest/v1/${table}`, { method: "POST", body: {} });
      const patch = await call(key, `/rest/v1/${table}?${pk}=eq.${sentinel}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: { [pk]: sentinel } });
      const del = await call(key, `/rest/v1/${table}?${pk}=eq.${sentinel}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
      check(`${table}: no INSERT / UPDATE / DELETE is applied for anon`, post.status >= 400 && noRowChanged(patch) && noRowChanged(del), `statuses ${post.status}/${patch.status}/${del.status}`);
    }
  } else {
    const oldKey = process.env.OLD_KEY;
    if (!oldKey) { console.error("OLD_KEY (the retired key) is required, as an environment variable"); process.exit(2); }
    let r = await call(oldKey, "/rest/v1/admin_users?select=id&limit=1");
    check("retired key: GET admin_users is 401", r.status === 401, `status ${r.status}`);
    r = await call(oldKey, "/functions/v1/process-refund", { method: "POST", body: { booking_id: NOBODY } });
    check("retired key: POST process-refund is 401", r.status === 401, `status ${r.status}`);
    r = await call(oldKey, "/functions/v1/cancel-booking", { method: "POST", body: { booking_id: NOBODY } });
    check("retired key: POST cancel-booking is 401", r.status === 401, `status ${r.status}`);
    if (process.env.NEW_SECRET_KEY) {
      r = await call(process.env.NEW_SECRET_KEY, "/rest/v1/admin_users?select=id&limit=1");
      check("new secret key: GET admin_users works for backend calls", r.status === 200, `status ${r.status}`);
    }
  }
} catch (e) {
  console.error(`check could not run: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
}

console.log(`\n${ran - failures.length}/${ran} passed`);
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
