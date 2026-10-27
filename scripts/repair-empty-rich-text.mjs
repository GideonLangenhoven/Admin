#!/usr/bin/env node

/**
 * P2 Directions: report or repair business rich-text fields that hold only
 * empty markup such as "<br>". The settings editor saved that when a field
 * was cleared, and emails, WhatsApp and the bots then read it as text
 * ("Meeting Point: <br>"). The editor now saves a cleared field as "".
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/repair-empty-rich-text.mjs          # dry run (default)
 *   DATABASE_URL=postgresql://... node scripts/repair-empty-rich-text.mjs --apply  # set them to NULL
 *
 * The dry run changes nothing and prints every field that would change.
 * Exits 0 when none are left, 1 when some remain, 2 on usage errors.
 */

import pg from "pg";

const COLUMNS = ["directions", "terms_conditions", "privacy_policy", "cookies_policy"];
// Markup with no text and no image, e.g. "<br>", "<p><br></p>" or "&nbsp;".
const empty = c => `(${c} <> '' and regexp_replace(${c}, '<[^>]*>|&nbsp;|\\s', '', 'g') = '' and ${c} !~* '<img')`;
const FIND_SQL = `
  select id, name, ${COLUMNS.map(c => `case when ${empty(c)} then ${c} end as ${c}`).join(", ")}
  from public.businesses
  where ${COLUMNS.map(empty).join(" or ")}
  order by name;
`;
// One statement that re-checks each field, so text saved meanwhile is kept.
const REPAIR_SQL = `
  update public.businesses set ${COLUMNS.map(c => `${c} = case when ${empty(c)} then null else ${c} end`).join(", ")}
  where ${COLUMNS.map(empty).join(" or ")};
`;

function print(rows) {
  if (!rows.length) return console.log("No empty rich text: every field has text or is unset.");
  console.log(`${rows.length} business(es) hold empty markup:`);
  for (const r of rows) {
    const fields = COLUMNS.filter(c => r[c] != null).map(c => `${c} ${JSON.stringify(r[c].slice(0, 40))} -> NULL`);
    console.log(`  ${r.name}: ${fields.join(", ")}  [${r.id}]`);
  }
}

const apply = process.argv.includes("--apply");
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("ERROR: DATABASE_URL environment variable is required.");
  process.exit(2);
}
// sslmode=disable is for a local test database only.
const client = new pg.Client({ connectionString: dbUrl, ssl: /sslmode=disable/.test(dbUrl) ? false : { rejectUnauthorized: false } });
await client.connect();
try {
  const found = (await client.query(FIND_SQL)).rows;
  print(found);
  if (!apply || !found.length) {
    if (found.length) console.log("\nDry run: nothing changed. Re-run with --apply after approval.");
    process.exitCode = found.length ? 1 : 0;
  } else {
    await client.query(REPAIR_SQL);
    const left = (await client.query(FIND_SQL)).rows;
    console.log(`\nRepaired ${found.length - left.length} of ${found.length} business(es).`);
    print(left);
    process.exitCode = left.length ? 1 : 0;
  }
} finally {
  await client.end();
}
