import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

// This fixture is intentionally local-only and never reads application secrets.
const host = process.env.ROLLOUT_TEST_HOST || process.argv[2];
assert(/^\/private\/tmp\/capekayak-db-test-[A-Za-z0-9]+$/.test(host || ''), 'Disposable local PostgreSQL socket required');
const config = { host, port: Number(process.env.ROLLOUT_TEST_PORT || 5432), user: process.env.ROLLOUT_TEST_USER || process.env.USER };
const database = 'refund_batch_' + randomBytes(8).toString('hex');
const admin = new pg.Client({ ...config, database: 'postgres' });
const db = new pg.Client({ ...config, database });
const worker = new pg.Client({ ...config, database });
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
let connected = false;
let passed = 0;

async function check(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
async function denied(sql, params = []) {
  await db.query('begin');
  try {
    await db.query('set local role authenticated');
    await assert.rejects(db.query(sql, params), error => error.code === '42501');
  } finally { await db.query('rollback'); }
}

try {
  await admin.connect();
  await admin.query('create database ' + database);
  await db.connect();
  await worker.connect();
  connected = true;
  await db.query(`do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  end $$`);
  await db.query('create table public.businesses(id uuid primary key)');
  await db.query('insert into public.businesses values($1),($2)', [id(1), id(2)]);
  await db.query(readFileSync('supabase/migrations/20260923130000_refund_batch_acceptance.sql', 'utf8'));
  const batch = id(10), actor = id(11), first = id(20), second = id(21);
  const accepted = {
    id: batch, business_id: id(1), actor_user_id: actor, actor_role: 'OPERATOR', booking_ids: [first, second],
    results: Object.fromEntries([first, second].map(booking_id => [booking_id, { booking_id, status: 'unprocessed', ok: false }])),
  };
  await check('one accepted row contains exact actor, tenant, targets and initial item states', async () => {
    const saved = await db.query(`insert into public.refund_batches(id,business_id,actor_user_id,actor_role,booking_ids,results)
      values($1,$2,$3,$4,$5,$6) returning *`,
    [accepted.id, accepted.business_id, accepted.actor_user_id, accepted.actor_role, accepted.booking_ids, accepted.results]);
    assert.equal(saved.rows.length, 1);
    assert.deepEqual(saved.rows[0].booking_ids, [first, second]);
    assert.deepEqual(saved.rows[0].results, accepted.results);
  });
  await check('client roles cannot read, write, claim or record refund batches', async () => {
    await denied('select * from public.refund_batches');
    await denied('insert into public.refund_batches(id,business_id,actor_user_id,actor_role,booking_ids,results) values($1,$2,$3,$4,$5,$6)',
      [id(12), id(2), actor, 'OPERATOR', [first], accepted.results]);
    await denied('select public.claim_refund_batch_item($1,$2)', [batch, first]);
    await denied('select public.record_refund_batch_item($1,$2,$3)', [batch, first, { booking_id: first, status: 'completed', ok: true }]);
  });
  await check('parallel claim submits a target once and never reclaims in-flight work', async () => {
    const results = await Promise.all([
      db.query('select public.claim_refund_batch_item($1,$2) ok', [batch, first]),
      worker.query('select public.claim_refund_batch_item($1,$2) ok', [batch, first]),
    ]);
    assert.deepEqual(results.map(result => result.rows[0].ok).sort(), [false, true]);
    assert.equal((await db.query('select public.claim_refund_batch_item($1,$2) ok', [batch, first])).rows[0].ok, false);
  });
  await check('one recorded result preserves the untouched tail', async () => {
    const result = { booking_id: first, status: 'pending', ok: false, refund_status: 'REFUND_PENDING' };
    assert.equal((await db.query('select public.record_refund_batch_item($1,$2,$3) ok', [batch, first, result])).rows[0].ok, true);
    assert.equal((await db.query('select public.record_refund_batch_item($1,$2,$3) ok', [batch, first, result])).rows[0].ok, false);
    const saved = (await db.query('select results from public.refund_batches where id=$1', [batch])).rows[0].results;
    assert.deepEqual(saved[first], result);
    assert.equal(saved[second].status, 'unprocessed');
    assert.equal((await db.query('select public.claim_refund_batch_item($1,$2) ok', [batch, second])).rows[0].ok, true);
  });
  await check('service role can read the accepted record while tenant clients cannot', async () => {
    await db.query('begin');
    try {
      await db.query('set local role service_role');
      const rows = await db.query('select actor_user_id,booking_ids from public.refund_batches where id=$1 and business_id=$2', [batch, id(1)]);
      assert.equal(rows.rows[0].actor_user_id, actor);
      assert.deepEqual(rows.rows[0].booking_ids, [first, second]);
    } finally { await db.query('rollback'); }
  });
  console.log('PASS total=' + passed);
} finally {
  if (connected) { await worker.end(); await db.end(); }
  await admin.query('drop database if exists ' + database + ' with (force)');
  await admin.end();
}
