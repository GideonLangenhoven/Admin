#!/usr/bin/env node
// Push docs/admin-help/*.md into the platform-wide help KB (admin_kb_chunks)
// via the kb-sync edge function. Chunking happens here (one chunk per "## "
// section, article intro included with the first); embedding happens
// server-side so no Gemini key is needed locally.
//
// Usage:
//   SUPABASE_URL=https://<ref>.supabase.co KB_SYNC_KEY=... node scripts/sync-admin-help.mjs [--dry-run]
//
// Frontmatter (required per article):
//   title: Bookings
//   route: /bookings
//   required_role: OPERATOR | MAIN_ADMIN | SUPER_ADMIN

import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const DOCS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../docs/admin-help");
const ROLES = new Set(["OPERATOR", "MAIN_ADMIN", "SUPER_ADMIN"]);
const MAX_CHUNK_CHARS = 4000; // gemini embed input is truncated at 8000; stay well under

function parseFrontmatter(raw, file) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) throw new Error(file + ": missing frontmatter");
  const meta = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  if (!meta.title) throw new Error(file + ": frontmatter missing title");
  if (!ROLES.has(meta.required_role || "")) throw new Error(file + ": required_role must be one of " + [...ROLES].join("|"));
  return { meta, body: raw.slice(m[0].length).trim() };
}

// One chunk per "## " section so retrieval lands on the specific feature the
// user asked about. The article title prefixes every chunk's content — the
// embedding needs the page context ("Bookings — Bulk actions"), not just the
// section text.
function chunkArticle(slug, meta, body) {
  const sections = body.split(/\n(?=## )/);
  const chunks = [];
  for (const section of sections) {
    const text = section.trim();
    if (!text) continue;
    const headingMatch = text.match(/^## +(.+)/);
    const heading = headingMatch ? headingMatch[1].trim() : null;
    const content = (meta.title + (heading ? " — " + heading : "") + "\n" + text).slice(0, MAX_CHUNK_CHARS);
    chunks.push({
      chunk_key: "help:" + slug + ":" + chunks.length,
      title: meta.title + (heading ? " — " + heading : ""),
      route: meta.route || null,
      required_role: meta.required_role,
      content,
    });
  }
  return chunks;
}

const files = readdirSync(DOCS_DIR).filter((f) => f.endsWith(".md")).sort();
if (files.length === 0) {
  console.error("No articles found in " + DOCS_DIR);
  process.exit(1);
}

const allChunks = [];
for (const file of files) {
  const raw = readFileSync(resolve(DOCS_DIR, file), "utf8");
  const { meta, body } = parseFrontmatter(raw, file);
  const slug = basename(file, ".md");
  allChunks.push(...chunkArticle(slug, meta, body));
}

console.log(files.length + " articles -> " + allChunks.length + " chunks");

if (process.argv.includes("--dry-run")) {
  for (const c of allChunks) console.log("  " + c.chunk_key + "  [" + c.required_role + "]  " + c.title + "  (" + c.content.length + " chars)");
  process.exit(0);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const KB_SYNC_KEY = process.env.KB_SYNC_KEY;
if (!SUPABASE_URL || !KB_SYNC_KEY) {
  console.error("Set SUPABASE_URL and KB_SYNC_KEY env vars (or use --dry-run).");
  process.exit(1);
}

const res = await fetch(SUPABASE_URL.replace(/\/+$/, "") + "/functions/v1/kb-sync", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-kb-sync-key": KB_SYNC_KEY },
  body: JSON.stringify({ admin_chunks: allChunks }),
});
const data = await res.json().catch(() => ({}));
console.log("kb-sync " + res.status + ": " + JSON.stringify(data));
process.exit(res.ok && data?.ok ? 0 : 1);
