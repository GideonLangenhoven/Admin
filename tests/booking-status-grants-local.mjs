import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';

// H2 regression: the browser cannot write bookings.status or refund_*.
// Synthetic data only. Refuse remote hosts and never load application secrets.
const host = process.argv[2];
assert(/^\/private\/tmp\/capekayak-db-test-[A-Za-z0-9]+$/.test(host || ''));
const db = new pg.Client({ host, port: Number(process.argv[3]), database: 'postgres', user: process.env.USER });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const migration = path => readFileSync('supabase/migrations/' + path, 'utf8');
const SUPER = id(1), ADMIN_A = id(2);
const PLATFORM = id(10), A = id(11), B = id(12);
const PAID_A = id(31), REQUESTED_A = id(32), PENDING_REFUND_A = id(33), REQUESTED_B = id(34), DRAFT_A = id(35);
const UNPAID_A = id(36), TRIP_A = id(37), PRICIER_TRIP_A = id(38), UNPAID_B = id(39), PAID_2_A = id(40);
const V100 = id(51), V500 = id(52), FREE_TRIP = id(53), FREE_TRIP_2 = id(54), V_B = id(55);
const TOKEN = id(99);

async function as(role, user, work, headers = {}) {
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [user || '']);
  await db.query("SELECT set_config('request.headers', $1, true)", [JSON.stringify(headers)]);
  await db.query("SELECT set_config('request.jwt.claim.role', $1, true)", [role]);
  await db.query(`SET LOCAL ROLE ${role}`);
  try { return await work(); } finally { await db.query('RESET ROLE'); }
}
const admin = (user, work) => as('authenticated', user, work);
const guest = work => as('anon', null, work, { 'x-tenant-business-id': A, 'x-booking-id': DRAFT_A, 'x-booking-waiver-token': TOKEN });
async function refused(sql, params) {
  await db.query('SAVEPOINT refused');
  try { await db.query(sql, params); } catch (error) { await db.query('ROLLBACK TO SAVEPOINT refused'); return error.message; }
  assert.fail('expected refusal: ' + sql);
}
const row = async booking => (await db.query('SELECT status, refund_status, refund_notes, customer_name FROM bookings WHERE id=$1', [booking])).rows[0];
const decline = (user, booking) => admin(user, async () => (await db.query('SELECT decline_refund_request($1) r', [booking])).rows[0].r);
const applyVoucher = (user, booking, voucher) => admin(user, async () => (await db.query('SELECT apply_booking_voucher($1, $2) r', [booking, voucher])).rows[0].r);
// What Mark Paid (account_manual_booking) and payment confirmation run first.
const settle = async booking => (await db.query('SELECT settle_voucher_reservations($1) r', [booking])).rows[0].r;
const money = async booking => (await db.query('SELECT total_amount::float t, voucher_amount_paid::float v FROM bookings WHERE id=$1', [booking])).rows[0];
const balance = async voucher => (await db.query('SELECT current_balance::float b, status FROM vouchers WHERE id=$1', [voucher])).rows[0];

await db.connect();
try {
  await db.query('BEGIN');
  await db.query(`CREATE SCHEMA auth;
    DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    ALTER ROLE service_role BYPASSRLS; -- as on Supabase
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
    CREATE FUNCTION public.bt_request_header(text) RETURNS text LANGUAGE sql STABLE AS
      $$ SELECT coalesce(current_setting('request.headers', true), '{}')::json ->> $1 $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    CREATE TABLE businesses(id uuid PRIMARY KEY, name text);
    CREATE TABLE admin_users(user_id uuid, business_id uuid, role text, suspended boolean DEFAULT false);
    CREATE TABLE bookings(id uuid PRIMARY KEY, business_id uuid, status text, customer_name text, total_amount numeric,
      waiver_token uuid, refund_status text, refund_amount numeric, refund_notes text, refund_processed_at timestamptz,
      refund_error text, refund_request_id uuid, cancelled_at timestamptz,
      qty integer DEFAULT 1, unit_price numeric, voucher_code text, voucher_amount_paid numeric, discount_type text);
    CREATE TABLE vouchers(id uuid PRIMARY KEY, business_id uuid, code text, status text DEFAULT 'ACTIVE', type text,
      value numeric, current_balance numeric, purchase_amount numeric, purchase_value numeric, pax_limit integer,
      expires_at timestamptz, redeemed_at timestamptz, redeemed_booking_id uuid);
    CREATE TABLE voucher_reservations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), voucher_id uuid NOT NULL, booking_id uuid NOT NULL,
      business_id uuid NOT NULL, amount numeric NOT NULL CHECK (amount > 0),
      status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'settled', 'released')),
      expires_at timestamptz NOT NULL DEFAULT now() + interval '25 minutes', UNIQUE (voucher_id, booking_id));
    CREATE TABLE logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid, booking_id uuid, event text, payload jsonb);
    ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
    -- Grants and policies as they are live.
    GRANT SELECT, INSERT, UPDATE, DELETE ON bookings TO authenticated, anon;
    GRANT ALL ON bookings, logs TO service_role;
    GRANT SELECT ON businesses, admin_users TO authenticated;`);
  const access = migration('20260907071000_operator_access_boundaries.sql');
  const start = access.indexOf('create or replace function public.current_business_ids()');
  await db.query(access.slice(start, access.indexOf('$$;', start) + 3));
  // The live voucher deduction and settlement, as Mark Paid runs them.
  for (const [file, name] of [['20260912100000_client_data_boundaries.sql', 'deduct_voucher_balance'], ['20260911120000_atomic_voucher_confirmation.sql', 'settle_voucher_reservations']]) {
    const sql = migration(file), at = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    await db.query(sql.slice(at, sql.indexOf('$$;', sql.indexOf('AS $$', at) + 5) + 3));
  }
  await db.query(`CREATE POLICY bookings_tenant_read ON bookings FOR SELECT TO authenticated, anon USING (true);
    CREATE POLICY bookings_tenant_update ON bookings FOR UPDATE TO authenticated
      USING (business_id IN (SELECT unnest((SELECT current_business_ids()))))
      WITH CHECK (business_id IN (SELECT unnest((SELECT current_business_ids()))));`);
  const hardening = migration('20260911090000_payment_hold_hardening.sql');
  const policy = hardening.indexOf('CREATE POLICY bookings_anon_update');
  await db.query(hardening.slice(policy, hardening.indexOf(');', hardening.indexOf('WITH CHECK', policy)) + 2));

  await db.query(`INSERT INTO businesses VALUES ($1,'Platform Administration'),($2,'Tenant A'),($3,'Tenant B')`, [PLATFORM, A, B]);
  await db.query(`INSERT INTO admin_users(user_id,business_id,role) VALUES ($1,$3,'SUPER_ADMIN'),($2,$4,'MAIN_ADMIN')`, [SUPER, ADMIN_A, PLATFORM, A]);
  await db.query(`INSERT INTO bookings(id,business_id,status,customer_name,total_amount,waiver_token,refund_status) VALUES
    ($1,$6,'PAID','Paid guest',300,null,null), ($2,$6,'CANCELLED','Asked for refund',300,null,'REQUESTED'),
    ($3,$6,'CANCELLED','Refund in flight',300,null,'REFUND_PENDING'), ($4,$7,'CANCELLED','Other tenant',300,null,'REQUESTED'),
    ($5,$6,'PENDING','Draft guest',100,$8,null)`, [PAID_A, REQUESTED_A, PENDING_REFUND_A, REQUESTED_B, DRAFT_A, A, B, TOKEN]);
  await db.query(`INSERT INTO bookings(id,business_id,status,customer_name,qty,unit_price,total_amount) VALUES
    ($1,$5,'PENDING','Unpaid guest',2,150,300), ($2,$5,'HELD','Trip guest',3,150,450), ($3,$5,'HELD','Pricier trip guest',3,150,450),
    ($4,$6,'PENDING','Other tenant guest',2,150,300), ($7,$5,'PAID','Paid guest 2',2,150,300)`, [UNPAID_A, TRIP_A, PRICIER_TRIP_A, UNPAID_B, A, B, PAID_2_A]);
  await db.query(`INSERT INTO vouchers(id,business_id,code,type,value,current_balance,purchase_value,pax_limit) VALUES
    ($1,$6,'V100','CREDIT',100,100,null,null), ($2,$6,'V500','CREDIT',500,500,null,null),
    ($3,$6,'TRIP350','FREE_TRIP',400,400,350,2), ($4,$6,'TRIP250','FREE_TRIP',400,400,250,2), ($5,$7,'VB','CREDIT',100,100,null,null)`,
    [V100, V500, FREE_TRIP, FREE_TRIP_2, V_B, A, B]);

  // Before the fix: the bookings page could cancel and "refund" a paid booking with one PATCH,
  // and a guest could cancel their own draft without the cancellation flow.
  await db.query('SAVEPOINT before');
  await admin(ADMIN_A, () => db.query(`UPDATE bookings SET status='CANCELLED', refund_status='PROCESSED' WHERE id=$1`, [PAID_A]));
  assert.deepEqual(await row(PAID_A), { status: 'CANCELLED', refund_status: 'PROCESSED', refund_notes: null, customer_name: 'Paid guest' });
  await guest(() => db.query(`UPDATE bookings SET status='CANCELLED' WHERE id=$1`, [DRAFT_A]));
  assert.equal((await row(DRAFT_A)).status, 'CANCELLED');
  // ...and "Apply code" deducted a voucher, then wrote the booking, recording
  // no credit: Mark Paid's voucher check then refused the booking.
  await admin(ADMIN_A, async () => {
    await db.query('SELECT deduct_voucher_balance($1, 100)', [V100]);
    await db.query(`UPDATE bookings SET total_amount=200, voucher_amount_paid=100, discount_type='VOUCHER' WHERE id=$1`, [UNPAID_A]);
  });
  assert.deepEqual(await settle(UNPAID_A), { success: false, error: 'Voucher coverage does not match booking', shortfall: 100 });
  await db.query('ROLLBACK TO SAVEPOINT before');

  await db.query(migration('20261027150000_booking_status_server_only.sql').replace(/^[\s\S]*?BEGIN;\s*/, '').replace(/COMMIT;\s*$/, ''));

  // Admins (tenant admin and super-admin alike) cannot write status or any refund column.
  for (const user of [ADMIN_A, SUPER]) {
    for (const column of ['status', 'refund_status', 'refund_amount', 'refund_notes', 'refund_processed_at', 'refund_error', 'refund_request_id']) {
      const value = column === 'refund_amount' ? '0' : column === 'refund_processed_at' ? 'now()' : column === 'refund_request_id' ? 'gen_random_uuid()' : `'X'`;
      assert.match(await admin(user, () => refused(`UPDATE bookings SET ${column}=${value} WHERE id=$1`, [PAID_A])), /permission denied for table bookings/);
    }
  }
  // Every other column still saves, inside the caller's tenants only.
  assert.equal((await admin(ADMIN_A, () => db.query(`UPDATE bookings SET customer_name='Renamed', cancelled_at=null WHERE id=$1`, [PAID_A]))).rowCount, 1);
  assert.equal((await admin(ADMIN_A, () => db.query(`UPDATE bookings SET customer_name='Hijack' WHERE id=$1`, [REQUESTED_B]))).rowCount, 0);
  assert.deepEqual(await row(PAID_A), { status: 'PAID', refund_status: null, refund_notes: null, customer_name: 'Renamed' });

  // The booking site can still re-save its draft as PENDING, and nothing else.
  assert.equal((await guest(() => db.query(`UPDATE bookings SET status='PENDING', customer_name='Draft guest 2' WHERE id=$1`, [DRAFT_A]))).rowCount, 1);
  for (const status of ['CANCELLED', 'HELD', 'PAID']) {
    assert.match(await guest(() => refused(`UPDATE bookings SET status=$2 WHERE id=$1`, [DRAFT_A, status])), /row-level security policy for table "bookings"/);
  }
  assert.match(await guest(() => refused(`UPDATE bookings SET refund_status='REQUESTED' WHERE id=$1`, [DRAFT_A])), /permission denied for table bookings/);

  // Server paths (service_role, SECURITY DEFINER owners) keep full control.
  await db.query('SET LOCAL ROLE service_role');
  assert.equal((await db.query(`UPDATE bookings SET status='CANCELLED', refund_status='REFUND_PENDING' WHERE id=$1`, [PAID_A])).rowCount, 1);
  await db.query('RESET ROLE');

  // Declining a refund goes through the RPC: own tenant, REQUESTED/FAILED only, with a timeline entry.
  assert.deepEqual(await decline(ADMIN_A, REQUESTED_A), { ok: true });
  assert.deepEqual(await row(REQUESTED_A), { status: 'CANCELLED', refund_status: 'DECLINED', refund_notes: 'Refund declined by admin', customer_name: 'Asked for refund' });
  const logged = (await db.query('SELECT business_id, event, payload FROM logs WHERE booking_id=$1', [REQUESTED_A])).rows;
  assert.deepEqual(logged, [{ business_id: A, event: 'refund_declined', payload: { previous_status: 'REQUESTED', user_id: ADMIN_A } }]);
  assert.equal((await decline(ADMIN_A, REQUESTED_A)).ok, false); // already declined
  assert.equal((await decline(ADMIN_A, PENDING_REFUND_A)).ok, false); // money already moving
  assert.equal((await row(PENDING_REFUND_A)).refund_status, 'REFUND_PENDING');
  assert.deepEqual(await decline(ADMIN_A, REQUESTED_B), { ok: false, error: 'Booking not found' }); // other tenant
  assert.equal((await row(REQUESTED_B)).refund_status, 'REQUESTED');
  assert.deepEqual(await decline(SUPER, REQUESTED_B), { ok: true }); // super-admin acting in tenant B
  assert.match(await as('anon', null, () => refused('SELECT decline_refund_request($1)', [REQUESTED_B])), /permission denied for function decline_refund_request/);

  // "Apply code" with a voucher: balance, settled credit and total change together; Mark Paid's check passes.
  assert.deepEqual(await applyVoucher(ADMIN_A, UNPAID_A, V100), { ok: true, deducted: 100, new_total: 200 });
  assert.deepEqual(await money(UNPAID_A), { t: 200, v: 100 });
  assert.deepEqual(await balance(V100), { b: 0, status: 'REDEEMED' });
  assert.deepEqual(await settle(UNPAID_A), { success: true, shortfall: 0 });
  // A second voucher covering the rest leaves nothing to pay; credit still matches.
  assert.deepEqual(await applyVoucher(ADMIN_A, UNPAID_A, V500), { ok: true, deducted: 200, new_total: 0 });
  assert.deepEqual(await money(UNPAID_A), { t: 0, v: 300 });
  assert.deepEqual(await balance(V500), { b: 300, status: 'ACTIVE' });
  assert.deepEqual(await settle(UNPAID_A), { success: true, shortfall: 0 });
  assert.deepEqual((await db.query(`SELECT voucher_id, amount::float, status FROM voucher_reservations WHERE booking_id=$1 ORDER BY amount`, [UNPAID_A])).rows,
    [{ voucher_id: V100, amount: 100, status: 'settled' }, { voucher_id: V500, amount: 200, status: 'settled' }]);
  assert.deepEqual((await db.query(`SELECT payload FROM logs WHERE booking_id=$1 AND event='voucher_applied' ORDER BY payload->>'amount'`, [UNPAID_A])).rows.map(r => r.payload),
    [{ voucher_id: V100, code: 'V100', amount: 100, user_id: ADMIN_A }, { voucher_id: V500, code: 'V500', amount: 200, user_id: ADMIN_A }]);
  assert.equal((await applyVoucher(ADMIN_A, UNPAID_A, V500)).error, 'Nothing is left to pay on this booking');
  // Free-trip vouchers cover their guests' places, capped at what the voucher cost.
  assert.deepEqual(await applyVoucher(ADMIN_A, TRIP_A, FREE_TRIP), { ok: true, deducted: 300, new_total: 150 });
  assert.deepEqual(await applyVoucher(ADMIN_A, PRICIER_TRIP_A, FREE_TRIP_2), { ok: true, deducted: 250, new_total: 200 });
  assert.equal((await applyVoucher(ADMIN_A, PRICIER_TRIP_A, FREE_TRIP_2)).error, 'This voucher is already on this booking');
  // Refused: paid bookings, other tenants' bookings or vouchers, and the booking site.
  assert.equal((await applyVoucher(ADMIN_A, PAID_2_A, V500)).error, 'Only unpaid bookings can take a voucher');
  assert.deepEqual(await money(PAID_2_A), { t: 300, v: null });
  assert.equal((await applyVoucher(ADMIN_A, UNPAID_B, V_B)).error, 'Only unpaid bookings can take a voucher');
  assert.equal((await applyVoucher(ADMIN_A, TRIP_A, V_B)).error, 'This voucher is not active');
  assert.deepEqual(await balance(V_B), { b: 100, status: 'ACTIVE' });
  assert.match(await as('anon', null, () => refused('SELECT apply_booking_voucher($1, $2)', [UNPAID_A, V500])), /permission denied for function apply_booking_voucher/);
  assert.deepEqual(await applyVoucher(SUPER, UNPAID_B, V_B), { ok: true, deducted: 100, new_total: 200 }); // super-admin acting in tenant B

  await db.query('ROLLBACK');
  console.log('booking status grants local tests passed');
} finally {
  await db.end();
}
