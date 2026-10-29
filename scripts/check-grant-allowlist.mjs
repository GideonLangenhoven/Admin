#!/usr/bin/env node

/**
 * Security test G: the anon/authenticated grants on the public schema must equal supabase/grant-allowlist.json.
 *
 * Unlike check-security-drift (which snapshots whatever is live), this is an explicit least-privilege allowlist:
 * a new table or function gets Supabase's default ALL/EXECUTE for anon and authenticated, so it fails here until
 * someone either revokes it in the migration or adds it to the allowlist in review.
 *
 * Usage:  DATABASE_URL=postgresql://... node scripts/check-grant-allowlist.mjs
 * Exit 0 = exact match, 1 = drift (EXTRA = security failure, MISSING = something may have broken), 2 = could not run.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ALLOWLIST_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../supabase/grant-allowlist.json");
export const ROLES = ["anon", "authenticated"];
const TABLE_PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
const COLUMN_PRIVS = ["SELECT", "INSERT", "UPDATE", "REFERENCES"];
const roleValues = ROLES.map((r) => `('${r}')`).join(",");
const privValues = (privs) => privs.map((p) => `('${p}')`).join(",");
const RELKINDS = "('r','p','v','m')";

export const LIVE_SQL = {
  tables: `select c.relname as rel, r.role, p.priv from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join (values ${roleValues}) r(role) cross join (values ${privValues(TABLE_PRIVS)}) p(priv)
    where n.nspname = 'public' and c.relkind in ${RELKINDS} and has_table_privilege(r.role, c.oid, p.priv)`,
  // Column-level grants that are not already implied by a table-level grant.
  columns: `select c.relname as rel, r.role, p.priv, a.attname as col from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    cross join (values ${roleValues}) r(role) cross join (values ${privValues(COLUMN_PRIVS)}) p(priv)
    where n.nspname = 'public' and c.relkind in ${RELKINDS} and not has_table_privilege(r.role, c.oid, p.priv)
      and has_column_privilege(r.role, c.oid, a.attnum, p.priv)`,
  // Extension-owned functions are not ours to allowlist.
  functions: `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig, r.role
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace cross join (values ${roleValues}) r(role)
    where n.nspname = 'public' and p.prokind in ('f','p') and has_function_privilege(r.role, p.oid, 'EXECUTE')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`,
};

// One flat set of facts per source, so drift is a plain set difference.
export function factsFromRows({ tables, columns, functions }) {
  const facts = new Set();
  for (const r of tables) facts.add(`table  ${r.role}  ${r.rel}  ${r.priv}`);
  for (const r of columns) facts.add(`column ${r.role}  ${r.rel}.${r.col}  ${r.priv}`);
  for (const r of functions) facts.add(`func   ${r.role}  ${r.sig}`);
  return facts;
}

export function factsFromAllowlist(allow) {
  const facts = new Set();
  for (const [rel, byRole] of Object.entries(allow.tables ?? {}))
    for (const [role, privs] of Object.entries(byRole)) for (const priv of privs) facts.add(`table  ${role}  ${rel}  ${priv}`);
  for (const [role, byRel] of Object.entries(allow.columns ?? {}))
    for (const [rel, byPriv] of Object.entries(byRel))
      for (const [priv, cols] of Object.entries(byPriv)) for (const col of cols) facts.add(`column ${role}  ${rel}.${col}  ${priv}`);
  for (const [role, sigs] of Object.entries(allow.functions ?? {})) for (const sig of sigs) facts.add(`func   ${role}  ${sig}`);
  return facts;
}

export function diffGrants(live, allowed) {
  return {
    extra: [...live].filter((f) => !allowed.has(f)).sort(),
    missing: [...allowed].filter((f) => !live.has(f)).sort(),
  };
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL environment variable is required.");
    process.exit(2);
  }
  const allowed = factsFromAllowlist(JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8")));
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const tables = await client.query(LIVE_SQL.tables);
    const columns = await client.query(LIVE_SQL.columns);
    const functions = await client.query(LIVE_SQL.functions);
    const live = factsFromRows({ tables: tables.rows, columns: columns.rows, functions: functions.rows });
    const { extra, missing } = diffGrants(live, allowed);
    if (!extra.length && !missing.length) {
      console.log(`[check-grant-allowlist] PASS: ${live.size} grants match supabase/grant-allowlist.json`);
      return;
    }
    console.error("[check-grant-allowlist] FAIL: live grants differ from the allowlist\n");
    if (extra.length) console.error(`EXTRA (granted but not allowlisted: ${extra.length})\n${extra.map((f) => "  + " + f).join("\n")}\n`);
    if (missing.length) console.error(`MISSING (allowlisted but not granted: ${missing.length})\n${missing.map((f) => "  - " + f).join("\n")}\n`);
    console.error("Revoke the extra grants in a migration, or add them to supabase/grant-allowlist.json with a reason in review.");
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("Unexpected error:", err.message);
    process.exit(2);
  });
}
