#!/usr/bin/env node
// Client-bundle secret scan (security test A). Dependency-free; the admin and booking repos each carry an identical copy.
//
//   node scripts/check-client-bundle-secrets.mjs env              pre-build: NEXT_PUBLIC_* names and values must be safe
//   node scripts/check-client-bundle-secrets.mjs static [dir]     post-build: scan every file under dir (default .next/static)
//   node scripts/check-client-bundle-secrets.mjs url <url>...     post-deploy: scan what the live pages actually load
//
// Findings name the rule and the file/variable. A secret value is never printed. Exit 1 on any finding, 2 if the scan itself could not run.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const STRINGS = ["service_role", "sb_secret_", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS", "SETTINGS_ENCRYPTION_KEY"];
const PATTERNS = {
  "Yoco secret key": /\bsk_(?:live|test)_[A-Za-z0-9]{8,}/,
  "Resend API key": /\bre_[A-Za-z0-9]{20,}/,
  "PEM block": /-----BEGIN/,
};
const PUBLIC_VAR_BAD_NAME = /SERVICE|SECRET|PRIVATE|ENCRYPTION/i;
// Server-only env vars whose VALUES must never appear in a client file. Public-by-design vars are excluded.
const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD|PASSPHRASE|CREDENTIAL/i;
const PUBLIC_NAME = /^NEXT_PUBLIC_|PUBLIC|ANON|PUBLISHABLE|SITE_KEY/i;
const TEXT_EXT = new Set([".js", ".mjs", ".css", ".html", ".json", ".map", ".txt", ".rsc"]);

const findings = [];
const fail = (rule, where) => findings.push(`FAIL ${rule}: ${where}`);

function claims(token) {
  try { return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")); } catch { return null; }
}
// A JWT is only a finding when it carries a role other than anon (non-Supabase JWTs have no role).
const elevated = (token) => {
  const c = claims(token);
  return c && c.role && c.role !== "anon" ? c : null;
};

function dotenvValues() {
  const out = {};
  for (const f of [".env", ".env.local", ".env.production", ".env.production.local", ".env.development", ".env.development.local"]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

const serverSecrets = (env) =>
  Object.entries(env).filter(([n, v]) => SECRET_NAME.test(n) && !PUBLIC_NAME.test(n) && typeof v === "string" && v.length >= 16);

function scanText(text, where, secrets) {
  for (const m of text.matchAll(JWT)) {
    const c = elevated(m[0]);
    if (c) fail(`JWT with role "${c.role}"`, `${where} (project ref ${c.ref ?? "unknown"})`);
  }
  for (const s of STRINGS) if (text.includes(s)) fail(`forbidden string "${s}"`, where);
  for (const [rule, re] of Object.entries(PATTERNS)) if (re.test(text)) fail(rule, where);
  for (const [name, value] of secrets) if (text.includes(value)) fail(`value of server env ${name}`, where);
}

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function checkEnv() {
  const env = { ...dotenvValues(), ...process.env };
  const secrets = serverSecrets(env);
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("NEXT_PUBLIC_")) continue;
    if (PUBLIC_VAR_BAD_NAME.test(name)) fail("public variable name looks secret", name);
    const c = typeof value === "string" ? elevated(value) : null;
    if (c) fail(`public variable holds a JWT with role "${c.role}"`, name);
    if (typeof value === "string" && value.startsWith("sb_secret_")) fail("public variable holds an sb_secret_ key", name);
    for (const [sn, sv] of secrets) if (sv === value) fail(`public variable has the same value as server env ${sn}`, name);
  }
}

function checkStatic(dir) {
  if (!existsSync(dir)) { console.error(`scan could not run: ${dir} does not exist (build first)`); process.exit(2); }
  const secrets = serverSecrets({ ...dotenvValues(), ...process.env });
  let n = 0;
  for (const file of walk(dir)) {
    if (!TEXT_EXT.has(extname(file))) continue;
    n++;
    scanText(readFileSync(file, "utf8"), file, secrets);
  }
  if (n === 0) { console.error(`scan could not run: no scannable files under ${dir}`); process.exit(2); }
  console.log(`scanned ${n} files under ${dir}`);
}

async function checkUrls(pages) {
  if (pages.length === 0) { console.error("usage: url <url>..."); process.exit(2); }
  const secrets = serverSecrets(process.env);
  const get = async (u) => {
    const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${u}`);
    return r.text();
  };
  const seen = new Set();
  for (const page of pages) {
    const html = await get(page);
    scanText(html, page, secrets); // inlined RSC/props payloads live in the HTML itself
    const scripts = new Set([...html.matchAll(/\/_next\/static\/[^"' )\\]+\.js/g)].map((m) => new URL(m[0], page).href));
    // ponytail: one hop of chunk discovery from the runtime; chunks only fetched after client navigation are covered by `static` at build time.
    for (const s of [...scripts]) {
      for (const m of (await get(s)).matchAll(/static\/chunks\/[A-Za-z0-9_\-\/.]+\.js/g)) scripts.add(new URL("/_next/" + m[0], page).href);
    }
    for (const s of scripts) {
      if (seen.has(s)) continue;
      seen.add(s);
      scanText(await get(s), s, secrets);
    }
  }
  console.log(`scanned ${pages.length} page(s) and ${seen.size} script(s)`);
}

const [mode, ...args] = process.argv.slice(2);
try {
  if (mode === "env") checkEnv();
  else if (mode === "static") checkStatic(args[0] ?? ".next/static");
  else if (mode === "url") await checkUrls(args);
  else { console.error("usage: env | static [dir] | url <url>..."); process.exit(2); }
} catch (e) {
  console.error(`scan could not run: ${e instanceof Error ? e.message : e}`); // fail closed: an unreachable site is not a pass
  process.exit(2);
}
if (findings.length) {
  console.error([...new Set(findings)].join("\n"));
  process.exit(1);
}
console.log(`client-bundle scan (${mode}): clean`);
