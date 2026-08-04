import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// PostgREST fails the ENTIRE query when a select list or filter names a column
// that does not exist. Nothing throws in the app: `{ data, error }` comes back
// with data null, and code that writes `?? []` or `if (row.data)` silently does
// nothing. That is invisible in review and invisible in production.
//
// This scan found eight live instances, including server-side price
// verification in create-checkout that had been dead (the client's amount went
// to the payment provider unverified), a POPIA subject-access export that
// returned the customer row with zero bookings, and the expired-hold payment
// link that never sent.
//
// tests/fixtures/db-columns.json is a snapshot of information_schema. Adding a
// column to the database does not break this test; referencing a column that
// is not in the snapshot does. If that happens after a legitimate migration,
// regenerate the fixture — the failure is the reminder to do so.
const SCHEMA: Record<string, string[]> = JSON.parse(
  readFileSync("tests/fixtures/db-columns.json", "utf8"),
);

const ROOTS = ["supabase/functions", "app", "booking/app", "components"];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (e === "node_modules" || e === ".next" || e.startsWith(".")) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

// Split a select list on top-level commas only, so embedded resources like
// `bookings(phone, email)` are skipped rather than mis-parsed.
function topLevelParts(sel: string): string[] {
  const parts: string[] = [];
  let depth = 0, buf = "";
  for (const ch of sel) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(buf); buf = ""; }
    else buf += ch;
  }
  parts.push(buf);
  return parts;
}

type Ref = { table: string; column: string; file: string };

function collectRefs(): Ref[] {
  const files = ROOTS.flatMap((r) => walk(r));
  const fromRe = /\.from\(\s*"([a-z_]+)"\s*\)((?:(?!\.from\()[\s\S]){0,900})/g;
  const filterRe = /\.(?:eq|neq|gt|gte|lt|lte|like|ilike|is|in)\(\s*"([a-zA-Z_][a-zA-Z0-9_]*)"/g;
  const selectRe = /^\s*\.select\(\s*"([^"]{2,600})"/m;
  const refs: Ref[] = [];

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    // Comments describe intentions, not queries — a TODO naming a column that
    // does not exist yet is not a bug.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const m of code.matchAll(fromRe)) {
      const table = m[1];
      const body = m[2];
      if (!SCHEMA[table]) continue;

      for (const f of body.matchAll(filterRe)) refs.push({ table, column: f[1], file });

      // .or("col.eq.x,col2.is.null") names columns inside a string, so none of
      // the filter helpers above see them. Only the literal prefix is
      // scannable when the value is concatenated ("phone.eq." + phone) — but
      // that prefix is exactly the column name, which is the fragile part.
      for (const o of body.matchAll(/\.or\(\s*"([^"]+)"/g)) {
        for (const t of o[1].matchAll(/([a-z_][a-z0-9_]*)\.(?:eq|neq|gt|gte|lt|lte|like|ilike|is|in|not)\./g)) {
          refs.push({ table, column: t[1], file });
        }
      }

      const sel = selectRe.exec(body);
      if (sel && sel[1].trim() !== "*") {
        for (const raw of topLevelParts(sel[1])) {
          const col = raw.trim().split("::")[0].trim();
          if (!col || col === "*" || col.includes("(") || col.includes(":")) continue;
          if (!/^[a-z_][a-z0-9_]*$/.test(col)) continue;
          refs.push({ table, column: col, file });
        }
      }
    }
  }
  return refs;
}

describe("database column references in code exist in the schema", () => {
  const refs = collectRefs();

  it("scans a meaningful amount of code", () => {
    expect(refs.length).toBeGreaterThan(200);
  });

  it("every referenced table.column exists", () => {
    const bad = refs
      .filter((r) => !SCHEMA[r.table].includes(r.column))
      .map((r) => `${r.table}.${r.column}  (${r.file})`);
    expect([...new Set(bad)].sort()).toEqual([]);
  });
});
