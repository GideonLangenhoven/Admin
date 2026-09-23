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
import { checkServerIdentity } from "node:tls";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { auditAdditionalSecurity } from "./security-drift-audit.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = resolve(__dirname, "../supabase/security-baseline.json");

// pg parses connection-string SSL options *after* the explicit `ssl` option.
// Strip those options before handing the URL to pg so they cannot replace TLS
// verification. sslmode=require is accepted only with verify-full semantics.
export function secureClientConfig(rawUrl, env = process.env) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) {
    throw new Error("DATABASE_URL must name a PostgreSQL network host");
  }
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    throw new Error("TLS certificate validation must be enabled");
  }
  const params = url.searchParams;
  for (const key of ["host", "sslmode", "ssl", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) {
    if (params.getAll(key).length > 1) throw new Error(`Duplicate ${key} is not supported`);
  }
  const mode = params.get("sslmode") ?? env.PGSSLMODE;
  if (mode && !["verify-full", "require"].includes(mode)) {
    throw new Error("sslmode must use certificate and hostname verification");
  }
  const ssl = params.get("ssl");
  if (ssl && !["true", "1"].includes(ssl)) {
    throw new Error("ssl must be enabled");
  }
  if (params.get("uselibpqcompat") === "true") {
    throw new Error("libpq compatibility SSL modes are not supported");
  }
  const hostOverride = params.get("host");
  if (hostOverride !== null && (!hostOverride || hostOverride.startsWith("/"))) {
    throw new Error("DATABASE_URL must name a PostgreSQL network host");
  }
  // pg omits servername for IP hosts. Node otherwise checks its default name
  // rather than the URL host; use Node's own hostname/IP verifier explicitly.
  const expectedHost = hostOverride ?? url.hostname;
  const sslOptions = {
    rejectUnauthorized: true,
    checkServerIdentity: (_name, certificate) => checkServerIdentity(expectedHost, certificate),
  };
  for (const [param, option] of [["sslrootcert", "ca"], ["sslcert", "cert"], ["sslkey", "key"]]) {
    const path = params.get(param) ?? (param === "sslrootcert" ? env.PGSSLROOTCERT : null);
    if (path) sslOptions[option] = readFileSync(path, "utf8");
    params.delete(param);
  }
  for (const key of ["sslmode", "ssl", "uselibpqcompat"]) params.delete(key);
  return { connectionString: url.toString(), ssl: sslOptions, connectionTimeoutMillis: 10000 };
}

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

  const client = new pg.Client(secureClientConfig(dbUrl));

  try {
    await client.connect();

    const grantsRes = await client.query(GRANTS_SQL);
    const rlsRes = await client.query(RLS_SQL);
    const policiesRes = await client.query(POLICIES_SQL);
    const additionalFindings = await auditAdditionalSecurity(client, baseline);

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

    if (!grantDiff && !rlsDiff && !policyDiff && !additionalFindings.length) {
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
    if (additionalFindings.length) {
      console.error(`\n=== EFFECTIVE AUTHORITY DRIFT (${additionalFindings.length}) ===`);
      for (const finding of additionalFindings) console.error(`  - ${finding}`);
    }
    console.error(
      "\nAction required: either update supabase/security-baseline.json to match" +
        " (if the change is intentional) or revert the production change."
    );
    process.exit(1);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    // Connection/parser errors may contain credentials or the full DSN.
    console.error("Database security check failed", err.code ? `(${err.code})` : "");
    process.exit(2);
  });
}
