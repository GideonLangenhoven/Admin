import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';

// Synthetic data only. Refuse remote hosts and never load application secrets.
const host = process.argv[2];
assert(/^\/private\/tmp\/capekayak-db-test-[A-Za-z0-9]+$/.test(host || ''));
const db = new pg.Client({ host, port: Number(process.argv[3]), database: 'postgres', user: process.env.USER });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const migration = path => readFileSync('supabase/migrations/' + path, 'utf8');
function canonical(path, name) {
  const sql = migration(path);
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.' + name + '(');
  assert(start >= 0);
  const end = sql.indexOf('$$;', sql.indexOf('AS $$', start));
  assert(end > start);
  return sql.slice(start, end + 3);
}
await db.connect();
try {
  await db.query('BEGIN');
  await db.query(`CREATE SCHEMA auth;
    DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('request.jwt.claim.role', true) $$;
    CREATE FUNCTION public.bt_request_header(text) RETURNS text LANGUAGE sql AS $$ SELECT ''::text $$;
    CREATE TABLE bookings(id uuid PRIMARY KEY, business_id uuid, status text, yoco_checkout_id text, yoco_mode text,
      payment_url text, email text, total_amount numeric, payment_status text, slot_id uuid, tour_id uuid, qty integer,
      voucher_amount_paid numeric DEFAULT 0, payment_deadline timestamptz, waiver_token uuid,
      checkout_priced_at timestamptz, expected_amount_cents integer, expected_currency text,
      yoco_payment_id text, total_captured numeric, customer_name text DEFAULT 'Synthetic guest', phone text,
      created_at timestamptz DEFAULT now());
    CREATE TABLE slots(id uuid PRIMARY KEY, business_id uuid, tour_id uuid, status text, start_time timestamptz,
      capacity_total integer, held integer, booked integer);
    CREATE TABLE holds(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, booking_id uuid, slot_id uuid, status text,
      hold_type text, qty integer, expires_at timestamptz);
    CREATE TABLE logs(id uuid DEFAULT gen_random_uuid(), business_id uuid, booking_id uuid, event text, payload jsonb,
      created_at timestamptz DEFAULT clock_timestamp());
    CREATE TABLE idempotency_keys(key text UNIQUE);
    CREATE TABLE voucher_reservations(booking_id uuid, business_id uuid, voucher_id uuid, amount numeric, status text, expires_at timestamptz DEFAULT now()+interval '25 minutes', UNIQUE(voucher_id,booking_id));
    CREATE TABLE vouchers(id uuid, business_id uuid, current_balance numeric, value numeric, purchase_amount numeric, status text, expires_at timestamptz);
    SELECT set_config('request.jwt.claim.role', 'service_role', true);`);
  await db.query(canonical('20260911130000_checkout_pricing.sql', 'create_hold_with_capacity_check'));
  await db.query(canonical('20260911120000_atomic_voucher_confirmation.sql', 'reserve_voucher_amount'));
  await db.query(canonical('20260911120000_atomic_voucher_confirmation.sql', 'settle_voucher_reservations'));
  await db.query(canonical('20260911130000_checkout_pricing.sql', 'confirm_booking_payment'));
  // Strip transaction delimiters so all fixture state rolls back on completion.
  await db.query(migration('20261015120000_payment_recovery.sql').replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, ''));
  const unpaidMigration = migration('20261016110000_unpaid_booking_recovery.sql');
  await db.query(unpaidMigration.slice(unpaidMigration.indexOf('CREATE VIEW public.payment_recovery_bookings'), unpaidMigration.indexOf("NOTIFY pgrst")));
  await db.query(`INSERT INTO slots VALUES($1,$2,$3,'OPEN',now()+interval '2 days',10,0,0)`, [id(4),id(1),id(3)]);
  const seed = async (n, email = null) => db.query(`INSERT INTO bookings(id,business_id,status,yoco_checkout_id,yoco_mode,payment_url,email,total_amount,slot_id,tour_id,qty,expected_amount_cents,expected_currency)
    VALUES($1,$2,'HELD',$3,'live','https://checkout.yoco.com/fixture',$4,100,$5,$6,1,10000,'ZAR')`,[id(n),id(1),'checkout-'+n,email,id(4),id(3)]);
  const failure = async (n, payment = 'attempt-'+n, business = id(1), checkout = 'checkout-'+n) => (await db.query(
    `SELECT record_booking_payment_failure($1,$2,$3,$4,'Card declined') AS r`,[id(n),business,checkout,payment])).rows[0].r;
  const recovery = async n => (await db.query('SELECT prepare_payment_recovery($1,$2) AS r',[id(n),id(1)])).rows[0].r;
  await seed(5);
  assert.equal((await failure(5)).recorded,true,'failure without email must be visible');
  assert.equal((await failure(5)).recorded,false,'duplicate failure must not count again');
  assert.equal((await failure(5,'attempt-2')).count,2);
  assert.equal((await failure(5,'attempt-3')).count,3);
  assert.equal((await failure(5,'foreign',id(2))).recorded,false);
  assert.equal((await failure(5,'obsolete',id(1),'obsolete-checkout')).recorded,false);
  assert.equal((await recovery(5)).ok,false,'missing email must block send');
  await db.query('UPDATE bookings SET email=$1 WHERE id=$2',['guest@example.invalid',id(5)]);
  assert.equal((await recovery(5)).ok,true);
  assert.equal((await recovery(5)).ok,true,'repeated sends must reuse one hold');
  assert.equal((await db.query('SELECT held FROM slots')).rows[0].held,1);
  await db.query(`UPDATE holds SET expires_at=now()-interval '1 minute'`);
  assert.equal((await recovery(5)).ok,true,'operator may renew expired seats still owned by this hold');
  const paid = (await db.query(`SELECT confirm_booking_payment($1,'paid-5',10000,'ZAR') AS r`,[id(5)])).rows[0].r;
  assert.equal(paid.ok,true);
  assert.equal((await failure(5,'delayed-failure')).recorded,false,'late failure cannot undo payment');
  assert.equal((await recovery(5)).ok,false,'paid booking cannot be chased');
  const saved = (await db.query('SELECT status,payment_failed_at FROM bookings WHERE id=$1',[id(5)])).rows[0];
  assert.equal(saved.status,'PAID'); assert(saved.payment_failed_at,'paid outcome retains recovery history');
  assert.deepEqual((await db.query('SELECT booked,held FROM slots')).rows[0],{booked:1,held:0});
  await seed(6,'other@example.invalid'); await failure(6);
  await db.query('UPDATE slots SET capacity_total=1');
  assert.equal((await recovery(6)).ok,false,'sold out departure cannot receive payment recovery email');
  assert.equal((await db.query('SELECT count(*)::int n FROM holds WHERE booking_id=$1',[id(6)])).rows[0].n,0);
  await db.query('UPDATE slots SET capacity_total=10');
  await db.query('UPDATE bookings SET voucher_amount_paid=50 WHERE id=$1',[id(6)]);
  assert.equal((await recovery(6)).ok,false,'released voucher funding requires review');
  await seed(7,'voucher@example.invalid'); await failure(7);
  await db.query('UPDATE bookings SET voucher_amount_paid=50 WHERE id=$1',[id(7)]);
  await db.query("INSERT INTO vouchers(id,business_id,current_balance,value,status,expires_at) VALUES($1,$2,100,100,'ACTIVE',now()+interval '7 days')",[id(20),id(1)]);
  await db.query("INSERT INTO voucher_reservations(booking_id,business_id,voucher_id,amount,status,expires_at) VALUES($1,$2,$3,50,'reserved',now()-interval '1 minute')",[id(7),id(1),id(20)]);
  assert.equal((await recovery(7)).ok,true,'available voucher funding can be renewed with the seat hold');
  const funding = (await db.query("SELECT expires_at > now()+interval '23 hours' AS renewed FROM voucher_reservations WHERE booking_id=$1",[id(7)])).rows[0];
  assert.equal(funding.renewed,true);
  await seed(8,'shortfall@example.invalid'); await failure(8);
  await db.query('UPDATE bookings SET voucher_amount_paid=80 WHERE id=$1',[id(8)]);
  await db.query("INSERT INTO voucher_reservations(booking_id,business_id,voucher_id,amount,status) VALUES($1,$2,$3,80,'reserved')",[id(8),id(1),id(20)]);
  assert.equal((await recovery(8)).ok,false,'another booking owns the required voucher funds');
  assert.equal((await db.query('SELECT count(*)::int n FROM holds WHERE booking_id=$1',[id(8)])).rows[0].n,0,'voucher failure rolls back the newly reserved seat');
  await db.query("UPDATE bookings SET status='CONFIRMED' WHERE id=$1",[id(8)]);
  assert.equal((await recovery(8)).ok,false,'confirmed recovery still validates reserved voucher funding');
  await seed(30,'unfinished@example.invalid');
  assert.equal((await recovery(30)).ok,true,'unfinished checkout without a failure can be followed up');
  const unfinished=(await db.query('SELECT amount_due,payment_failed_at FROM payment_recovery_bookings WHERE id=$1',[id(30)])).rows[0];
  assert.equal(Number(unfinished.amount_due),100);assert.equal(unfinished.payment_failed_at,null);
  await seed(31,'manual@example.invalid');
  await db.query("UPDATE bookings SET status='CONFIRMED' WHERE id=$1",[id(31)]);
  await db.query('UPDATE slots SET booked=booked+1');
  const capacityBefore=(await db.query('SELECT booked,held FROM slots')).rows[0];
  assert.equal((await recovery(31)).ok,true,'confirmed unpaid booking without failure can be followed up');
  assert.deepEqual((await db.query('SELECT booked,held FROM slots')).rows[0],capacityBefore,'confirmed recovery never double reserves seats');
  assert.equal((await db.query('SELECT count(*)::int n FROM holds WHERE booking_id=$1',[id(31)])).rows[0].n,0);
  await db.query('UPDATE bookings SET total_captured=25 WHERE id=$1',[id(31)]);
  assert.equal(Number((await db.query('SELECT amount_due FROM payment_recovery_bookings WHERE id=$1',[id(31)])).rows[0].amount_due),75);
  assert.equal((await recovery(31)).ok,false,'part payment blocks an unsafe full-amount checkout email');
  for(const status of ['PAID','COMPLETED','CANCELLED','EXPIRED']){
    await db.query('UPDATE bookings SET status=$1,total_captured=NULL WHERE id=$2',[status,id(31)]);
    assert.equal(Number((await db.query('SELECT amount_due FROM payment_recovery_bookings WHERE id=$1',[id(31)])).rows[0].amount_due),0,status+' needs no follow-up');
    assert.equal((await recovery(31)).ok,false);
  }
  await db.query("SELECT set_config('request.jwt.claim.role','authenticated',true)");
  await db.query("UPDATE bookings SET payment_failed_at=NULL,payment_failure_reason='forged',payment_recovery_emailed_at=now() WHERE id=$1",[id(5)]);
  const protectedRow = (await db.query('SELECT * FROM bookings WHERE id=$1',[id(5)])).rows[0];
  assert(protectedRow.payment_failed_at); assert.equal(protectedRow.payment_failure_reason,'Card declined');
  assert.equal(protectedRow.payment_recovery_emailed_at,null);
  const privileges = (await db.query(`SELECT has_function_privilege('authenticated','prepare_payment_recovery(uuid,uuid)','EXECUTE') AS client,
    has_function_privilege('service_role','record_booking_payment_failure(uuid,uuid,text,text,text)','EXECUTE') AS server`)).rows[0];
  assert.deepEqual(privileges,{client:false,server:true});
  console.log('PASS: failure recording, duplicate/late events, tenant and checkout guards, reservation renewal, capacity, voucher checks, payment completion, field protection and RPC grants');
} finally {
  await db.query('ROLLBACK');
  await db.end();
}
