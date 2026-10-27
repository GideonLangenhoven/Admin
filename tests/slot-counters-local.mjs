import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

// H2b regression. Synthetic data only. Refuse remote hosts and never load application secrets.
// Uses its own throwaway database because the counter triggers fire at COMMIT.
const host = process.argv[2];
assert(/^\/private\/tmp\/capekayak-db-test-[A-Za-z0-9]+$/.test(host || ''));
const connection = { host, port: Number(process.argv[3]), user: process.env.USER };
const database = 'slot_counters_' + randomBytes(6).toString('hex');
const admin = new pg.Client({ ...connection, database: 'postgres' });
const db = new pg.Client({ ...connection, database });
const other = new pg.Client({ ...connection, database });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const BUSINESS = id(1), S1 = id(11), S2 = id(12);
const counters = async slot => (await db.query('SELECT booked, held FROM slots WHERE id=$1', [slot])).rows[0];
const booking = (n, slot, status, qty) => db.query('INSERT INTO bookings VALUES ($1,$2,$3,$4,$5)', [id(n), BUSINESS, slot, status, qty]);
const hold = (n, slot, qty) => db.query(`INSERT INTO holds(booking_id,slot_id,status,qty) VALUES ($1,$2,'ACTIVE',$3)`, [id(n), slot, qty]);

await admin.connect();
await admin.query('CREATE DATABASE ' + database);
try {
  await db.connect();
  await other.connect();
  await db.query(`
    DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    CREATE TABLE slots(id uuid PRIMARY KEY, business_id uuid, tour_id uuid, start_time timestamptz, status text,
      capacity_total integer, booked integer DEFAULT 0, held integer DEFAULT 0, price_per_person_override numeric,
      created_at timestamptz DEFAULT now(), is_peak boolean, is_manually_overridden boolean, local_departure_time text,
      image_url text, last_minute_at timestamptz, price_before_deal numeric);
    CREATE TABLE bookings(id uuid PRIMARY KEY, business_id uuid, slot_id uuid, status text, qty integer);
    CREATE TABLE holds(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), booking_id uuid REFERENCES bookings ON DELETE CASCADE,
      slot_id uuid, status text, qty integer);
    CREATE FUNCTION increment_held(sid uuid, amount integer) RETURNS void LANGUAGE sql AS $$ UPDATE slots SET held = held + amount WHERE id = sid $$;
    GRANT SELECT, INSERT, UPDATE, DELETE ON slots, bookings, holds TO authenticated;`);
  await db.query(`INSERT INTO slots(id,business_id,start_time,capacity_total) VALUES ($1,$3,now()+interval '2 days',10),($2,$3,now()+interval '3 days',10)`, [S1, S2, BUSINESS]);

  // Before the fix: an RPC counts a paid booking, then a raw status write cancels it. booked stays 3.
  await booking(1, S1, 'PAID', 3);
  await db.query('UPDATE slots SET booked = 3 WHERE id=$1', [S1]);
  await db.query(`UPDATE bookings SET status='CANCELLED' WHERE id=$1`, [id(1)]);
  assert.deepEqual(await counters(S1), { booked: 3, held: 0 });

  await db.query(readFileSync('supabase/migrations/20261027140000_slot_counters_derived.sql', 'utf8'));

  // The monitor sees the drift, and the delta-based call used by edge functions now recounts instead of decrementing again.
  const drift = (await db.query('SELECT * FROM slot_counter_drift()')).rows;
  assert.deepEqual(drift.map(r => [r.slot_id, r.booked, r.expected_booked]), [[S1, 3, 0]]);
  await db.query('SELECT adjust_slot_capacity($1,$2,-3,0)', [S1, BUSINESS]);
  assert.deepEqual(await counters(S1), { booked: 0, held: 0 });
  await db.query('SELECT adjust_slot_capacity($1,$2,-3,0)', [S1, BUSINESS]);
  assert.deepEqual(await counters(S1), { booked: 0, held: 0 }, 'a repeated call must not under-count');
  await assert.rejects(db.query('SELECT adjust_slot_capacity($1,$2,0,0)', [S1, id(999)]), /slot not found for business/);

  // Raw writers: insert, hold, cancel.
  await booking(2, S1, 'PAID', 2);
  await booking(3, S1, 'HELD', 3);
  await hold(3, S1, 3);
  assert.deepEqual(await counters(S1), { booked: 2, held: 3 });
  await db.query(`UPDATE bookings SET status='CANCELLED' WHERE id=$1`, [id(2)]);
  assert.deepEqual(await counters(S1), { booked: 0, held: 3 });

  // Inside a transaction, an RPC's own arithmetic is untouched; the stored values are corrected at commit.
  await db.query('BEGIN');
  await db.query('UPDATE slots SET booked = booked + 3, held = held - 3 WHERE id=$1', [S1]);
  await db.query(`UPDATE bookings SET status='CONFIRMED' WHERE id=$1`, [id(3)]);
  await db.query(`UPDATE holds SET status='CONVERTED' WHERE booking_id=$1`, [id(3)]);
  await db.query('UPDATE slots SET booked = booked + 100 WHERE id=$1', [S1]);
  assert.deepEqual(await counters(S1), { booked: 103, held: 0 });
  await db.query('COMMIT');
  assert.deepEqual(await counters(S1), { booked: 3, held: 0 });

  // Moving, resizing and deleting bookings and holds.
  await db.query('UPDATE bookings SET slot_id=$2 WHERE id=$1', [id(3), S2]);
  assert.deepEqual([await counters(S1), await counters(S2)], [{ booked: 0, held: 0 }, { booked: 3, held: 0 }]);
  await db.query('UPDATE bookings SET qty=5 WHERE id=$1', [id(3)]);
  assert.deepEqual(await counters(S2), { booked: 5, held: 0 });
  await db.query('DELETE FROM bookings WHERE id=$1', [id(3)]);
  assert.deepEqual(await counters(S2), { booked: 0, held: 0 });
  await booking(4, S1, 'HELD', 2);
  await hold(4, S1, 2);
  assert.deepEqual(await counters(S1), { booked: 0, held: 2 });
  await db.query(`UPDATE holds SET status='EXPIRED' WHERE booking_id=$1`, [id(4)]);
  assert.deepEqual(await counters(S1), { booked: 0, held: 0 });
  await hold(4, S1, 2);
  await db.query('DELETE FROM bookings WHERE id=$1', [id(4)]);
  assert.deepEqual(await counters(S1), { booked: 0, held: 0 }, 'a cascade-deleted hold releases held');

  // Two transactions on the same slot: the one that commits second waits for the slot lock and counts both.
  await booking(5, S1, 'PENDING', 2);
  await db.query('BEGIN');
  await db.query('SELECT 1 FROM slots WHERE id=$1 FOR UPDATE', [S1]);
  await db.query(`UPDATE bookings SET status='PAID' WHERE id=$1`, [id(5)]);
  await other.query('BEGIN');
  await other.query(`INSERT INTO bookings VALUES ($1,$2,$3,'PAID',1)`, [id(6), BUSINESS, S1]);
  const otherCommit = other.query('COMMIT');
  for (let i = 0; i < 50 && !(await admin.query('SELECT count(*)::int n FROM pg_locks WHERE NOT granted')).rows[0].n; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await db.query('COMMIT');
  await otherCommit;
  assert.deepEqual(await counters(S1), { booked: 3, held: 0 });

  // The browser can still edit slots, but not the counters.
  await db.query('BEGIN');
  await db.query('SET LOCAL ROLE authenticated');
  await db.query('UPDATE slots SET capacity_total = 12 WHERE id=$1', [S1]);
  await db.query('SAVEPOINT counters');
  await assert.rejects(db.query('UPDATE slots SET held = 99 WHERE id=$1', [S1]), /permission denied/);
  await db.query('ROLLBACK TO SAVEPOINT counters');
  await assert.rejects(db.query('SELECT increment_held($1, 5)', [S1]), /permission denied/);
  await db.query('ROLLBACK');

  assert.deepEqual((await db.query('SELECT * FROM slot_counter_drift()')).rows, []);
  console.log('slot counter local tests passed');
} finally {
  await db.end().catch(() => {});
  await other.end().catch(() => {});
  await admin.query('DROP DATABASE IF EXISTS ' + database).catch(() => {});
  await admin.end();
}
