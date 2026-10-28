import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';

// Disposable local PostgreSQL only; never loads application credentials.
// node tests/verified-loyalty-local.mjs <socket dir> <port>
const host = process.argv[2];
assert(/\/(capekayak-db-test-[A-Za-z0-9]+|pg)$/.test(host || ''));
const db = new pg.Client({ host, port: Number(process.argv[3]), database: 'postgres', user: process.env.USER });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sql = path => readFileSync('supabase/migrations/' + path, 'utf8').replace(/^(--.*\n)*BEGIN;\s*/, '').replace(/COMMIT;\s*$/, '');
await db.connect();
try {
  await db.query('BEGIN');
  await db.query(`DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role' $$;
    CREATE FUNCTION current_business_ids() RETURNS uuid[] LANGUAGE sql AS $$ SELECT ARRAY[]::uuid[] $$;
    CREATE TABLE businesses(id uuid PRIMARY KEY, subscription_status text);
    CREATE TABLE slots(id uuid PRIMARY KEY,business_id uuid,start_time timestamptz);
    CREATE TABLE bookings(id uuid PRIMARY KEY,business_id uuid,customer_name text,phone text,email text,created_at timestamptz DEFAULT now(),status text,slot_id uuid,
      qty integer DEFAULT 2,discount_type text,discount_percent integer,discount_amount numeric,discount_notes text,promo_code text,total_captured numeric DEFAULT 0,
      checkout_priced_at timestamptz,checkout_request jsonb,yoco_checkout_id text,payment_url text);
    CREATE TABLE policies(business_id uuid PRIMARY KEY,loyalty_bookings_threshold integer DEFAULT 2,loyalty_period_days integer DEFAULT 30,loyalty_discount_percent integer DEFAULT 10,group_discount_min_qty integer DEFAULT 6,group_discount_percent integer DEFAULT 5);
    CREATE TABLE marketing_contacts(id uuid PRIMARY KEY,business_id uuid,email text,phone text,status text);`);
  await db.query(sql('20261015140000_customer_return_history.sql'));
  await db.query(sql('20261028210000_verified_loyalty_discount.sql'));
  await db.query("INSERT INTO businesses VALUES($1,'ACTIVE'),($2,'ACTIVE')", [id(1), id(2)]);
  await db.query('INSERT INTO policies(business_id) VALUES($1),($2)', [id(1), id(2)]);
  const past = (n, business = id(1), email = 'guest@example.invalid') => db.query(
    "INSERT INTO bookings(id,business_id,created_at,status,email,phone) VALUES($1,$2,now()-interval '5 days','PAID',$3,'0825550101')", [id(n), business, email]);
  await past(10); await past(11); await past(12, id(2));
  const draft = (n, extra = {}) => db.query(
    `INSERT INTO bookings(id,business_id,status,email,phone,discount_type,discount_percent,promo_code,checkout_priced_at,checkout_request)
     VALUES($1,$2,$3,$4,'0710000000',$5,$6,$7,$8,$9)`,
    [id(n), extra.business || id(1), extra.status || 'PENDING', extra.email || 'Guest@Example.invalid', extra.type || null, extra.pct ?? null, extra.promo || null, extra.priced || null, extra.request || null]);
  const apply = async (n, email = 'guest@example.invalid') => (await db.query('SELECT apply_verified_booking_discount($1,$2) r', [id(n), email])).rows[0].r;
  const row = async n => (await db.query('SELECT discount_type,discount_percent,discount_notes FROM bookings WHERE id=$1', [id(n)])).rows[0];

  // The email proves the history: two paid bookings in 30 days earn the loyalty rate.
  assert.equal((await db.query('SELECT resolve_booking_discount($1,NULL,2,$2) d', [id(1), 'GUEST@example.invalid'])).rows[0].d.percent, 10);
  assert.equal((await db.query('SELECT resolve_booking_discount($1,NULL,2) d', [id(1)])).rows[0].d.percent, 0, 'no identity, no loyalty');
  assert.equal((await db.query('SELECT resolve_booking_discount($1,$2,2) d', [id(1), '27825550101'])).rows[0].d.percent, 10, 'three-argument (WhatsApp) calls still work');
  assert.equal((await db.query('SELECT resolve_booking_discount($1,NULL,2,$2) d', [id(2), 'guest@example.invalid'])).rows[0].d.percent, 0, 'history never crosses tenants');

  await draft(20);
  assert.equal((await apply(20)).applied, true);
  assert.deepEqual(await row(20), { discount_type: 'PERCENT', discount_percent: 10, discount_notes: 'Loyalty discount' });
  await draft(21);
  assert.equal((await apply(21, 'someone@else.invalid')).applied, false, 'only the email on the booking');
  await draft(22, { promo: 'SUMMER' });
  assert.equal((await apply(22)).applied, false, 'a promo replaces automatic discounts');
  await draft(23, { type: 'MANUAL', pct: 0 });
  assert.equal((await apply(23)).applied, false, 'an operator price stands');
  await draft(24, { priced: new Date(), request: { id: 'x' } });
  assert.equal((await apply(24)).applied, false, 'an issued checkout is immutable');
  await draft(25, { status: 'PAID' });
  assert.equal((await apply(25)).applied, false);
  await draft(26, { type: 'PERCENT', pct: 20 });
  assert.equal((await apply(26)).applied, false, 'never lowers a better discount');
  for (const n of [21, 22, 23, 24, 25]) assert.equal((await row(n)).discount_notes, null);

  const grants = (await db.query("SELECT p.proname, has_function_privilege('anon',p.oid,'EXECUTE') a, has_function_privilege('authenticated',p.oid,'EXECUTE') u FROM pg_proc p WHERE proname IN ('apply_verified_booking_discount','resolve_booking_discount')")).rows;
  assert.equal(grants.length, 2);
  for (const g of grants) assert.deepEqual([g.a, g.u], [false, false], g.proname + ' is service-role only');
  console.log('verified loyalty: ok');
} finally {
  await db.query('ROLLBACK').catch(() => undefined);
  await db.end();
}
