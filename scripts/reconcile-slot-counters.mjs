#!/usr/bin/env node

/**
 * H2b: report or repair slot counter drift, where slots.booked / slots.held
 * differ from the bookings and holds they count:
 *   booked = sum(qty) of bookings in PAID, CONFIRMED, COMPLETED
 *   held   = sum(qty) of ACTIVE holds and ACTIVE OTA reservations
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/reconcile-slot-counters.mjs          # dry run (default)
 *   DATABASE_URL=postgresql://... node scripts/reconcile-slot-counters.mjs --apply  # repair
 *
 * The dry run changes nothing and prints every slot that would change.
 * --apply needs migration 20261027140000_slot_counters_derived.sql; it repairs
 * each slot with sync_slot_counters(), which locks the slot before counting.
 * Exits 0 when no drift is left, 1 when drift remains, 2 on usage errors.
 */

import pg from "pg";

// Same rule as public.slot_counter_drift(), with names for a readable diff.
const DRIFT_SQL = `
  select s.id as slot_id, b.name as business, t.name as tour,
    to_char(s.start_time at time zone coalesce(b.timezone, 'Africa/Johannesburg'), 'YYYY-MM-DD HH24:MI') as starts,
    s.capacity_total, s.booked, bk.qty as expected_booked, s.held, h.qty as expected_held
  from public.slots s
  join public.businesses b on b.id = s.business_id
  left join public.tours t on t.id = s.tour_id
  cross join lateral (select coalesce(sum(x.qty), 0)::integer as qty from public.bookings x
    where x.slot_id = s.id and x.status in ('PAID', 'CONFIRMED', 'COMPLETED')) bk
  cross join lateral (select ((select coalesce(sum(x.qty), 0) from public.holds x
      where x.slot_id = s.id and x.status = 'ACTIVE')
    + (select coalesce(sum(o.qty), 0) from public.ota_reservations o
      where o.slot_id = s.id and o.status = 'ACTIVE'))::integer as qty) h
  where coalesce(s.booked, 0) <> bk.qty or coalesce(s.held, 0) <> h.qty
  order by s.start_time;
`;

function print(rows) {
  if (!rows.length) return console.log("No drift: every slot matches its bookings and holds.");
  console.log(`${rows.length} slot(s) drifted:`);
  for (const r of rows) {
    const changes = [];
    if (r.booked !== r.expected_booked) changes.push(`booked ${r.booked} -> ${r.expected_booked}`);
    if (r.held !== r.expected_held) changes.push(`held ${r.held} -> ${r.expected_held}`);
    console.log(`  ${r.starts}  ${r.business} / ${r.tour ?? "?"}  cap ${r.capacity_total}  ${changes.join(", ")}  [${r.slot_id}]`);
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
  const drift = (await client.query(DRIFT_SQL)).rows;
  print(drift);
  if (!apply || !drift.length) {
    if (drift.length) console.log("\nDry run: nothing changed. Re-run with --apply after approval.");
    process.exitCode = drift.length ? 1 : 0;
  } else {
    const ready = (await client.query("select to_regprocedure('public.sync_slot_counters(uuid)') is not null as ok")).rows[0].ok;
    if (!ready) {
      console.error("ERROR: --apply needs migration 20261027140000_slot_counters_derived.sql.");
      process.exitCode = 2;
    } else {
      for (const r of drift) await client.query("select public.sync_slot_counters($1)", [r.slot_id]);
      const left = (await client.query(DRIFT_SQL)).rows;
      console.log(`\nRepaired ${drift.length - left.length} of ${drift.length} slot(s).`);
      print(left);
      process.exitCode = left.length ? 1 : 0;
    }
  }
} finally {
  await client.end();
}
