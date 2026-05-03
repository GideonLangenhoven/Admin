#!/usr/bin/env node

/**
 * Reconciliation script: compares live Supabase security state against the
 * committed baseline in supabase/security-baseline.json.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/check-security-drift.mjs
 *
 * Exits 0 if production matches baseline, non-zero with a diff on drift.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = resolve(__dirname, "../supabase/security-baseline.json");

const GRANTS_SQL = `
  SELECT grantee, table_name, privilege_type
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND grantee IN ('anon', 'authenticated', 'service_role')
  ORDER BY grantee, table_name, privilege_type;
`;

const RLS_SQL = `
  SELECT n.nspname AS schema, c.relname AS table_name, c.relrowsecurity AS rls_enabled
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r'
    AND n.nspname = 'public'
  ORDER BY c.relname;
`;

const POLICIES_SQL = `
  SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
  FROM pg_policies
  WHERE schemaname = 'public'
  ORDER BY tablename, policyname;
`;

function loadBaseline() {
  const raw = readFileSync(BASELINE_PATH, "utf-8");
  return JSON.parse(raw);
}

function canonicalize(rows, sortKeys) {
  return rows
    .map((r) => {
      const out = {};
      for (const k of sortKeys) out[k] = r[k] ?? null;
      return out;
    })
    .sort((a, b) => {
      for (const k of sortKeys) {
        const av = String(a[k] ?? "");
        const bv = String(b[k] ?? "");
        if (av < bv) return -1;
        if (av > bv) return 1;
      }
      return 0;
    });
}

function rowKey(row, keys) {
  return keys.map((k) => String(row[k] ?? "")).join("|");
}

function diffSections(baselineRows, liveRows, sortKeys, label) {
  const baseMap = new Map();
  const liveMap = new Map();

  for (const r of baselineRows) baseMap.set(rowKey(r, sortKeys), r);
  for (const r of liveRows) liveMap.set(rowKey(r, sortKeys), r);

  const added = [];
  const removed = [];
  const changed = [];

  for (const [k, r] of liveMap) {
    if (!baseMap.has(k)) added.push(r);
  }
  for (const [k, r] of baseMap) {
    if (!liveMap.has(k)) removed.push(r);
    else {
      const live = liveMap.get(k);
      if (JSON.stringify(r) !== JSON.stringify(live)) {
        changed.push({ baseline: r, live });
      }
    }
  }

  if (!added.length && !removed.length && !changed.length) return null;

  const lines = [`\n=== ${label} DRIFT DETECTED ===`];
  if (added.length) {
    lines.push(`\n  ADDED (${added.length}):`);
    for (const r of added) lines.push(`    + ${JSON.stringify(r)}`);
  }
  if (removed.length) {
    lines.push(`\n  REMOVED (${removed.length}):`);
    for (const r of removed) lines.push(`    - ${JSON.stringify(r)}`);
  }
  if (changed.length) {
    lines.push(`\n  CHANGED (${changed.length}):`);
    for (const c of changed) {
      lines.push(`    baseline: ${JSON.stringify(c.baseline)}`);
      lines.push(`    live:     ${JSON.stringify(c.live)}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("ERROR: DATABASE_URL environment variable is required.");
    console.error(
      "  Format: postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres"
    );
    process.exit(2);
  }

  let baseline;
  try {
    baseline = loadBaseline();
  } catch (e) {
    console.error(`ERROR: Cannot read baseline file at ${BASELINE_PATH}`);
    console.error(e.message);
    process.exit(2);
  }

  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    const [grantsRes, rlsRes, policiesRes] = await Promise.all([
      client.query(GRANTS_SQL),
      client.query(RLS_SQL),
      client.query(POLICIES_SQL),
    ]);

    const grantKeys = ["grantee", "table_name", "privilege_type"];
    const rlsKeys = ["schema", "table_name", "rls_enabled"];
    const policyKeys = ["schemaname", "tablename", "policyname", "cmd", "roles", "qual", "with_check"];

    const liveGrants = canonicalize(grantsRes.rows, grantKeys);
    const liveRls = canonicalize(rlsRes.rows, rlsKeys);
    const livePolicies = canonicalize(policiesRes.rows, policyKeys);

    const baseGrants = canonicalize(baseline.grants, grantKeys);
    const baseRls = canonicalize(baseline.rls_status, rlsKeys);
    const basePolicies = canonicalize(baseline.policies, policyKeys);

    const grantDiff = diffSections(baseGrants, liveGrants, grantKeys, "GRANTS");
    const rlsDiff = diffSections(baseRls, liveRls, rlsKeys, "RLS STATUS");
    const policyDiff = diffSections(basePolicies, livePolicies, policyKeys, "POLICIES");

    if (!grantDiff && !rlsDiff && !policyDiff) {
      console.log(
        `[check-security-drift] PASS — production matches baseline.` +
          ` (${liveGrants.length} grants, ${liveRls.length} tables, ${livePolicies.length} policies)`
      );
      process.exit(0);
    }

    console.error("[check-security-drift] FAIL — security drift detected!\n");
    if (grantDiff) console.error(grantDiff);
    if (rlsDiff) console.error(rlsDiff);
    if (policyDiff) console.error(policyDiff);
    console.error(
      "\nAction required: either update supabase/security-baseline.json to match" +
        " (if the change is intentional) or revert the production change."
    );
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err.message);
  process.exit(2);
});
