import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { auditAdditionalSecurity } from '../../scripts/security-drift-audit.mjs';

const host = process.env.ROLLOUT_TEST_HOST || process.argv[2];
assert(/^\/private\/tmp\/capekayak-db-test-[A-Za-z0-9]+$/.test(host || ''), 'Disposable local PostgreSQL socket required');
const config = { host, port: Number(process.env.ROLLOUT_TEST_PORT || 5432), user: process.env.ROLLOUT_TEST_USER || process.env.USER };
const database = 'waiver_closeout_' + randomBytes(8).toString('hex');
const admin = new pg.Client({ ...config, database: 'postgres' });
const db = new pg.Client({ ...config, database });
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const fixed = process.argv.includes('--fixed');
let connected = false;
let passed = 0;
async function check(name, work) { await work(); passed++; console.log('PASS ' + name); }
async function sign(bookingId, token, payload = { participants: [{ dob: '1990-05-05' }] }) {
  await db.query('begin');
  try {
    await db.query('set local role anon');
    const row = await db.query('select public.sign_waiver($1,$2,$3,$4) result', [bookingId, token, 'Guest Name', payload]);
    await db.query('commit');
    return row.rows[0].result;
  } catch (error) { await db.query('rollback'); throw error; }
}
async function makeBooking(number, options = {}) {
  const bookingId = id(number);
  const token = id(number + 1000);
  const email = `waiver-${number}@fixture.invalid`;
  await db.query(`insert into public.bookings
    (id,business_id,tour_id,customer_name,email,qty,unit_price,total_amount,status,waiver_token,waiver_token_expires_at,waiver_status)
    values($1,$2,$3,'Guest Name',$4,1,100,100,'PAID',$5,$6,$7)`,
  [bookingId, id(1), id(2), email, options.storedNull ? null : token,
    options.expired ? '2020-01-01T00:00:00Z' : '2099-01-01T00:00:00Z', options.signed ? 'SIGNED' : 'PENDING']);
  await db.query('delete from public.marketing_contacts where business_id=$1 and email=$2', [id(1), email]);
  return { bookingId, token, email };
}
async function snapshot(booking) {
  const row = await db.query(`select waiver_status,waiver_signed_at,waiver_signed_name,waiver_payload
    from public.bookings where id=$1`, [booking.bookingId]);
  const contact = await db.query("select email,to_char(date_of_birth,'YYYY-MM-DD') dob from public.marketing_contacts where business_id=$1 and email=$2", [id(1), booking.email]);
  return { booking: row.rows[0], contacts: contact.rows };
}

try {
  await admin.connect();
  await admin.query('create database ' + database);
  await db.connect(); connected = true;
  await db.query(readFileSync('tests/fixtures/rollout-schema.sql', 'utf8'));
  await db.query('grant usage on schema public to anon, authenticated');
  await db.query(readFileSync('supabase/migrations/20260710120000_marketing_contact_auto_sync.sql', 'utf8'));
  await db.query(readFileSync('supabase/migrations/20260717145119_sign_waiver_dob_sync.sql', 'utf8'));
  await db.query(`create table public.audit_logs (
    id uuid primary key default gen_random_uuid(), actor_id uuid, business_id uuid,
    action_type text, target_entity text, target_id uuid, after_state jsonb)`);
  const platformSql = readFileSync('supabase/migrations/20260913100000_platform_admin_controls.sql', 'utf8');
  const auditStart = platformSql.indexOf('CREATE OR REPLACE FUNCTION public.audit_super_admin_business_edit()');
  const auditEnd = platformSql.indexOf('CREATE OR REPLACE FUNCTION public.platform_generate_invoice', auditStart);
  assert(auditStart >= 0 && auditEnd > auditStart, 'Historical audit trigger DDL unavailable');
  await db.query(platformSql.slice(auditStart, auditEnd));
  if (fixed) await db.query(readFileSync('supabase/migrations/20260923140000_waiver_and_client_trigger_paths.sql', 'utf8'));
  await db.query('alter table public.bookings alter column waiver_token drop not null');
  await db.query('insert into public.businesses(id,name,operator_email) values($1,$2,$3)', [id(1), 'Fixture operator', 'owner@fixture.invalid']);

  const unsigned = await makeBooking(100);
  await check('explicit NULL token is denied without waiver or marketing mutation', async () => {
    const before = await snapshot(unsigned);
    assert.deepEqual(await sign(unsigned.bookingId, null), { ok: false, error: 'invalid_token' });
    assert.deepEqual(await snapshot(unsigned), before);
  });
  await check('wrong and missing tokens are denied without mutation', async () => {
    const before = await snapshot(unsigned);
    assert.deepEqual(await sign(unsigned.bookingId, id(999)), { ok: false, error: 'invalid_token' });
    assert.deepEqual(await sign(id(9999), unsigned.token), { ok: false, error: 'invalid_token' });
    assert.deepEqual(await snapshot(unsigned), before);
  });
  await check('matching token signs once, fills DOB, and valid replay is idempotent', async () => {
    assert.deepEqual(await sign(unsigned.bookingId, unsigned.token), { ok: true });
    const after = await snapshot(unsigned);
    assert.equal(after.booking.waiver_status, 'SIGNED');
    assert.equal(after.contacts[0].dob, '1990-05-05');
    assert.deepEqual(await sign(unsigned.bookingId, unsigned.token), { ok: true, already_signed: true });
    assert.deepEqual(await snapshot(unsigned), after);
  });
  await check('NULL token on already signed booking is denied without mutation', async () => {
    const before = await snapshot(unsigned);
    assert.deepEqual(await sign(unsigned.bookingId, null), { ok: false, error: 'invalid_token' });
    assert.deepEqual(await snapshot(unsigned), before);
  });
  const expired = await makeBooking(101, { expired: true });
  await check('matching expired token is denied without mutation', async () => {
    const before = await snapshot(expired);
    assert.deepEqual(await sign(expired.bookingId, expired.token), { ok: false, error: 'expired' });
    assert.deepEqual(await snapshot(expired), before);
  });
  const storedNull = await makeBooking(102, { storedNull: true });
  await check('stored NULL token is denied without mutation', async () => {
    const before = await snapshot(storedNull);
    assert.deepEqual(await sign(storedNull.bookingId, null), { ok: false, error: 'invalid_token' });
    assert.deepEqual(await snapshot(storedNull), before);
  });
  const invalidDob = await makeBooking(103);
  await check('malformed DOB does not block valid legal signing', async () => {
    assert.deepEqual(await sign(invalidDob.bookingId, invalidDob.token, { participants: [{ dob: 'not-a-date' }] }), { ok: true });
    const after = await snapshot(invalidDob);
    assert.equal(after.booking.waiver_status, 'SIGNED');
    assert(after.contacts.every(contact => contact.dob === null));
  });
  await check('booking contact trigger still fills missing fields', async () => {
    const booking = await makeBooking(104);
    await db.query('update public.bookings set customer_name=$1 where id=$2', ['Updated Guest', booking.bookingId]);
    const contactSql = 'select first_name,last_name,status from public.marketing_contacts where business_id=$1 and email=$2';
    const contact = (await db.query(contactSql, [id(1), booking.email])).rows[0];
    assert.deepEqual(contact, { first_name: 'Updated', last_name: 'Guest', status: 'active' });
    await db.query("update public.marketing_contacts set first_name='Curated',status='unsubscribed' where business_id=$1 and email=$2", [id(1), booking.email]);
    await db.query('update public.bookings set customer_name=$1 where id=$2', ['Changed Again', booking.bookingId]);
    assert.deepEqual((await db.query(contactSql, [id(1), booking.email])).rows[0],
      { first_name: 'Curated', last_name: 'Guest', status: 'unsubscribed' });
  });
  await check('exact active Super Admin business edit is audited without values', async () => {
    const superUser = id(900), ordinaryUser = id(901);
    await db.query(`insert into public.admin_users(id,email,password_hash,role,business_id,user_id)
      values($1,$2,'','SUPER_ADMIN',$3,$1),($4,$5,'','OPERATOR',$3,$4)`,
    [superUser, 'super@fixture.invalid', id(1), ordinaryUser, 'staff@fixture.invalid']);
    for (const [userId, value] of [[superUser, 'Approved wording'], [ordinaryUser, 'Staff wording']]) {
      await db.query('begin');
      try {
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
        await db.query('update public.businesses set business_tagline=$1 where id=$2', [value, id(1)]);
        await db.query('commit');
      } catch (error) { await db.query('rollback'); throw error; }
    }
    const rows = (await db.query(`select actor_id,action_type,after_state from public.audit_logs
      where business_id=$1 order by id`, [id(1)])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actor_id, superUser);
    assert.equal(rows[0].action_type, 'BUSINESS_DETAILS_UPDATED');
    assert.deepEqual(rows[0].after_state, { changed_fields: ['business_tagline'] });
    await db.query('update public.admin_users set suspended=true where id=$1', [superUser]);
    await db.query('begin');
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [superUser]);
      await db.query("update public.businesses set business_tagline='Suspended wording' where id=$1", [id(1)]);
      await db.query('commit');
    } catch (error) { await db.query('rollback'); throw error; }
    assert.equal((await db.query('select count(*) n from public.audit_logs where business_id=$1', [id(1)])).rows[0].n, '1');
  });
  if (fixed) await check('all three client-originating definer functions use a narrow explicit path', async () => {
    const paths = (await db.query(`select proname,proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and proname=any($1::text[])`, [[
      'sign_waiver', 'ck_sync_marketing_contact', 'audit_super_admin_business_edit',
    ]])).rows;
    assert.equal(paths.length, 3);
    assert(paths.every(row => row.proconfig?.includes('search_path=pg_catalog, public, pg_temp')));
  });
  if (fixed) await check('effective checker accepts the corrected paths on real PostgreSQL', async () => {
    const findings = await auditAdditionalSecurity(db, { grants: [] });
    for (const signature of [
      'public.sign_waiver(p_booking_id uuid, p_waiver_token uuid, p_signed_name text, p_payload jsonb)',
      'public.ck_sync_marketing_contact()', 'public.audit_super_admin_business_edit()',
    ]) assert(!findings.includes(`Unconstrained search_path on SECURITY DEFINER ${signature}`));
  });
  console.log('PASS total=' + passed);
} finally {
  if (connected) await db.end();
  await admin.query('drop database if exists ' + database + ' with (force)');
  await admin.end();
}
