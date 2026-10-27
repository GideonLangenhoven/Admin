import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';

// H3 regression. Synthetic data only. Refuse remote hosts and never load application secrets.
const host = process.argv[2];
assert(/^\/private\/tmp\/capekayak-db-test-[A-Za-z0-9]+$/.test(host || ''));
const db = new pg.Client({ host, port: Number(process.argv[3]), database: 'postgres', user: process.env.USER });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const migration = path => readFileSync('supabase/migrations/' + path, 'utf8');
const SUPER = id(1), ADMIN_A = id(2), ADMIN_B = id(3);
const PLATFORM = id(10), A = id(11), B = id(12), TOUR_A = id(21), TOUR_B = id(22);
const slot = n => id(100 + n);

async function as(user, work) {
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [user]);
  await db.query('SET LOCAL ROLE authenticated');
  try { return await work(); } finally { await db.query('RESET ROLE'); }
}
async function refused(sql, params) {
  await db.query('SAVEPOINT refused');
  try { await db.query(sql, params); } catch (error) { await db.query('ROLLBACK TO SAVEPOINT refused'); return error.message; }
  assert.fail('expected refusal: ' + sql);
}
const save = (user, business, period, label, start, end, priority, prices) => as(user, async () =>
  (await db.query('SELECT save_peak_period($1,$2,$3,$4,$5,$6,$7) r', [business, period, label, start, end, priority, JSON.stringify(prices)])).rows[0].r);
const price = async n => (await db.query('SELECT price_per_person_override p, is_peak FROM slots WHERE id=$1', [slot(n)])).rows[0];

await db.connect();
try {
  await db.query('BEGIN');
  await db.query(`CREATE SCHEMA auth;
    DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    CREATE TABLE businesses(id uuid PRIMARY KEY, name text, timezone text DEFAULT 'Africa/Johannesburg');
    CREATE TABLE admin_users(user_id uuid, business_id uuid, role text, suspended boolean DEFAULT false);
    CREATE TABLE tours(id uuid PRIMARY KEY, business_id uuid, name text);
    CREATE TABLE slots(id uuid PRIMARY KEY, business_id uuid, tour_id uuid, start_time timestamptz, capacity_total integer,
      is_peak boolean DEFAULT false, price_per_person_override numeric, last_minute_at timestamptz, is_manually_overridden boolean DEFAULT false);
    CREATE TABLE bookings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, slot_id uuid, status text);
    CREATE TABLE peak_periods(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL, label text,
      start_date date NOT NULL, end_date date NOT NULL, priority integer DEFAULT 0, created_at timestamptz DEFAULT now());
    CREATE TABLE peak_period_prices(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      peak_period_id uuid REFERENCES peak_periods ON DELETE CASCADE, tour_id uuid, price_per_person numeric);
    CREATE TABLE chat_faq_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid);
    CREATE TABLE data_subject_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid);
    CREATE TABLE pii_anonymization_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid);
    ALTER TABLE peak_periods ENABLE ROW LEVEL SECURITY;
    ALTER TABLE peak_period_prices ENABLE ROW LEVEL SECURITY;
    ALTER TABLE chat_faq_entries ENABLE ROW LEVEL SECURITY;
    ALTER TABLE data_subject_requests ENABLE ROW LEVEL SECURITY;
    ALTER TABLE pii_anonymization_log ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, INSERT, UPDATE, DELETE ON peak_periods, peak_period_prices, chat_faq_entries, slots TO authenticated, anon;
    GRANT SELECT ON businesses, admin_users, tours, bookings, data_subject_requests, pii_anonymization_log TO authenticated;
    -- The policy as it was live: the tenant came from admin_users.business_id.
    CREATE POLICY peak_periods_tenant ON peak_periods FOR ALL
      USING (business_id IN (SELECT business_id FROM admin_users WHERE user_id = auth.uid()));`);
  const access = migration('20260907071000_operator_access_boundaries.sql');
  const start = access.indexOf('create or replace function public.current_business_ids()');
  await db.query(access.slice(start, access.indexOf('$$;', start) + 3));
  await db.query(`INSERT INTO businesses(id,name) VALUES ($1,'Platform Administration'),($2,'Tenant A'),($3,'Tenant B')`, [PLATFORM, A, B]);
  await db.query(`INSERT INTO admin_users(user_id,business_id,role) VALUES ($1,$4,'SUPER_ADMIN'),($2,$5,'MAIN_ADMIN'),($3,$6,'MAIN_ADMIN')`,
    [SUPER, ADMIN_A, ADMIN_B, PLATFORM, A, B]);
  await db.query(`INSERT INTO tours VALUES ($1,$2,'Paddle A'),($3,$4,'Paddle B')`, [TOUR_A, A, TOUR_B, B]);
  // Slot 4 is 00:30 local on 12 Dec, which is still 11 Dec in UTC; it must count as the 12th.
  await db.query(`INSERT INTO slots(id,business_id,tour_id,start_time,capacity_total) VALUES
    ($1,$5,$6,'2026-12-10 08:00+02',10),($2,$5,$6,'2026-12-11 08:00+02',10),($3,$5,$6,'2026-12-20 08:00+02',10),($4,$5,$6,'2026-12-12 00:30+02',10)`,
    [slot(1), slot(2), slot(3), slot(4), A, TOUR_A]);
  await db.query(`INSERT INTO bookings(business_id,slot_id,status) VALUES ($1,$2,'PAID')`, [A, slot(2)]);

  // Before the fix: a super-admin acting in tenant A is refused by RLS.
  const before = await as(SUPER, () => refused(`INSERT INTO peak_periods(business_id,start_date,end_date) VALUES ($1,'2026-12-10','2026-12-12')`, [A]));
  assert.match(before, /row-level security policy for table "peak_periods"/);

  await db.query(migration('20261027130000_peak_pricing_tenant_access.sql').replace(/^begin;\s*/, '').replace(/commit;\s*$/, ''));

  // Super-admin acting in tenant A: period, price and slot prices save together.
  let r = await save(SUPER, A, null, 'Festive', '2026-12-10', '2026-12-12', 0, [{ tour_id: TOUR_A, price_per_person: 900 }]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.slots_updated, 2, 'the slot with a paid booking keeps its price');
  assert.equal(Number((await price(1)).p), 900);
  assert.equal(Number((await price(4)).p), 900, 'local date, not UTC date');
  assert.equal((await price(2)).p, null);
  assert.equal((await price(3)).p, null);
  const period = r.id;

  // Tenant A admin edits it: the old range clears and the new range is priced.
  r = await save(ADMIN_A, A, period, '', '2026-12-15', '2026-12-20', 1, [{ tour_id: TOUR_A, price_per_person: 950 }]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(await price(1), { p: null, is_peak: false });
  assert.equal(Number((await price(3)).p), 950);
  assert.equal((await db.query('SELECT label FROM peak_periods WHERE id=$1', [period])).rows[0].label, '2026-12-15 to 2026-12-20');

  // Validation failures come back as friendly text, not raw errors.
  r = await save(ADMIN_A, A, null, 'Bad', '2026-12-20', '2026-12-15', 0, []);
  assert.deepEqual(r, { ok: false, error: 'Choose an end date on or after the start date.' });
  r = await save(ADMIN_A, A, null, 'Bad', '2026-12-01', '2026-12-02', 0, [{ tour_id: TOUR_A, price_per_person: -1 }]);
  assert.deepEqual(r, { ok: false, error: 'Enter a peak price of zero or more for every tour.' });

  // Slots created later inside the period get its price; explicit overrides are kept.
  await db.query(`INSERT INTO slots(id,business_id,tour_id,start_time,capacity_total) VALUES ($1,$3,$4,'2026-12-16 08:00+02',10),($2,$3,$4,'2026-12-25 08:00+02',10)`,
    [slot(5), slot(6), A, TOUR_A]);
  await db.query(`INSERT INTO slots(id,business_id,tour_id,start_time,capacity_total,price_per_person_override) VALUES ($1,$2,$3,'2026-12-17 08:00+02',10,777)`,
    [slot(7), A, TOUR_A]);
  assert.deepEqual(await price(5), { p: '950', is_peak: true });
  assert.equal((await price(6)).p, null);
  assert.equal(Number((await price(7)).p), 777);

  // Tenant B cannot read or change tenant A's periods, directly or through the functions.
  r = await save(ADMIN_B, A, null, 'x', '2026-12-01', '2026-12-02', 0, []);
  assert.deepEqual(r, { ok: false, error: 'You do not have access to this business.' });
  await as(ADMIN_B, async () => {
    assert.equal((await db.query('SELECT delete_peak_period($1) r', [period])).rows[0].r.ok, false);
    assert.equal((await db.query('SELECT count(*)::int n FROM peak_periods')).rows[0].n, 0);
    await refused(`INSERT INTO peak_periods(business_id,start_date,end_date) VALUES ($1,'2026-12-01','2026-12-02')`, [A]);
  });
  // A price row on your own period that points at another tenant's tour is refused.
  const own = await save(ADMIN_B, B, null, 'B', '2026-12-01', '2026-12-02', 0, []);
  await as(ADMIN_B, () => refused('INSERT INTO peak_period_prices(peak_period_id,tour_id,price_per_person) VALUES ($1,$2,1)', [own.id, TOUR_A]));
  // anon has no access to the functions.
  await db.query('SET LOCAL ROLE anon');
  assert.match(await refused('SELECT save_peak_period($1,null,$2,$3,$4,0,$5)', [A, 'x', '2026-12-01', '2026-12-02', '[]']), /permission denied/);
  await db.query('RESET ROLE');

  // Super-admin deletes the period: slots revert, the explicit override stays, prices cascade.
  await as(SUPER, async () => assert.equal((await db.query('SELECT delete_peak_period($1) r', [period])).rows[0].r.ok, true));
  assert.equal((await price(3)).p, null);
  assert.equal(Number((await price(7)).p), 777);
  assert.equal((await db.query('SELECT count(*)::int n FROM peak_period_prices pp JOIN peak_periods p ON p.id=pp.peak_period_id WHERE p.business_id=$1', [A])).rows[0].n, 0);
  console.log('peak pricing local tests passed');
} finally {
  await db.query('ROLLBACK').catch(() => {});
  await db.end();
}
