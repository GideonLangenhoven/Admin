import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const { Client, Pool } = pg;
const host = process.env.ROLLOUT_TEST_HOST || '127.0.0.1';
assert(['127.0.0.1','localhost','::1'].includes(host) || /^\/private\/tmp\/capekayak-db-test-[A-Za-z0-9]+$/.test(host), 'Disposable local PostgreSQL required');
const port = Number(process.env.ROLLOUT_TEST_PORT || 5432);
const database = 'ingress_' + randomBytes(6).toString('hex');
const admin = new Client({host,port,database:'postgres'});
const client = new Client({host,port,database});
const pool = new Pool({host,port,database,max:20});
const call = (bucket,key,limit,window) => pool.query('select public.check_ingress_rate_limit($1,$2,$3,$4) result',[bucket,key,limit,window]).then(r=>r.rows[0].result);

try {
  await admin.connect();
  await admin.query('create database ' + database);
  await client.connect();
  await client.query("do $$ begin create role anon; exception when duplicate_object then null; end $$; do $$ begin create role authenticated; exception when duplicate_object then null; end $$; do $$ begin create role service_role; exception when duplicate_object then null; end $$;");
  await client.query(readFileSync('supabase/migrations/20260927100000_shared_ingress_rate_limit.sql','utf8'));
  const signature = 'public.check_ingress_rate_limit(text,text,integer,integer)';
  for (const role of ['anon','authenticated']) assert.equal((await client.query('select has_function_privilege($1,$2,\'execute\') permitted',[role,signature])).rows[0].permitted,false);
  assert.equal((await client.query('select has_function_privilege($1,$2,\'execute\') permitted',['service_role',signature])).rows[0].permitted,true);
  for (const role of ['anon','authenticated']) {
    await client.query('begin');
    try {
      await client.query('set local role ' + role);
      await assert.rejects(client.query("select public.check_ingress_rate_limit('auth-input',$1,5,900000)",['a'.repeat(32)]),/permission denied/);
    } finally { await client.query('rollback'); }
  }
  assert.equal((await client.query('select count(*)::int count from public.ingress_rate_limits')).rows[0].count,0);
  for (const args of [[null,'a'.repeat(32),5,900000],['auth-input',null,5,900000],['auth-input','a'.repeat(32),null,900000],['auth-input','a'.repeat(32),5,null]]) {
    await assert.rejects(call(...args),/invalid ingress limit configuration/);
  }
  assert.equal((await client.query('select count(*)::int count from public.ingress_rate_limits')).rows[0].count,0);
  const key = 'a'.repeat(32);
  const first = await Promise.all(Array.from({length:20},()=>call('auth-input',key,5,900000)));
  assert.equal(first.filter(r=>r.allowed).length,5);
  assert.equal(first.filter(r=>!r.allowed).length,15);
  assert(first.every(r=>r.retry_after_ms >= 0 && r.retry_after_ms <= 900000));
  const row = (await client.query('select attempts,extract(epoch from expires_at-started_at)*1000 duration_ms from public.ingress_rate_limits where key_hash=$1',[key])).rows[0];
  assert.equal(row.attempts,6);
  assert.equal(Number(row.duration_ms),900000);
  await client.query("update public.ingress_rate_limits set expires_at=clock_timestamp()-interval '1 second' where key_hash=$1",[key]);
  assert.equal((await call('auth-input',key,5,900000)).remaining,4);
  assert.equal((await client.query('select attempts from public.ingress_rate_limits where key_hash=$1',[key])).rows[0].attempts,1);
  await assert.rejects(call('bad','b'.repeat(32),5,900000),/invalid ingress limit configuration/);
  await assert.rejects(call('auth-input','private@example.invalid',5,900000),/invalid ingress limit configuration/);
  const lockedKey = 'e'.repeat(32);
  const holder = new Client({host,port,database});
  await holder.connect();
  try {
    await holder.query('begin');
    await holder.query('select pg_advisory_xact_lock(hashtextextended($1,0))',['auth-input:' + lockedKey]);
    const blockedAt = performance.now();
    await assert.rejects(call('auth-input',lockedKey,5,900000),/lock timeout/);
    assert(performance.now() - blockedAt < 1_000, 'Held key lock exceeded the server deadline');
    assert.equal((await client.query('select count(*)::int count from public.ingress_rate_limits where key_hash=$1',[lockedKey])).rows[0].count,0);
  } finally {
    await holder.query('rollback');
    await holder.end();
  }
  await client.query("insert into public.ingress_rate_limits(bucket,key_hash,started_at,expires_at,attempts) select 'api-ip',lpad(n::text,32,'0'),now()-interval '3 hours',now()-interval '2 hours',1 from generate_series(1,100) n");
  await call('api-ip','c'.repeat(32),4000,60000);
  assert.equal((await client.query("select count(*)::int count from public.ingress_rate_limits where expires_at<now()-interval '1 hour'")).rows[0].count,68);
  assert((await client.query("select indexname from pg_indexes where tablename='ingress_rate_limits'")).rows.some(row=>row.indexname==='ingress_rate_limits_expiry_idx'));
  const started = performance.now();
  const results = await Promise.all(Array.from({length:200},()=>call('api-ip','d'.repeat(32),4000,60000)));
  assert(results.every(r=>r.allowed));
  console.log(JSON.stringify({concurrentSameKey:20,allowed:5,denied:15,expiryMs:900000,cleanupBatch:32,benchmarkRequests:200,benchmarkConcurrency:20,benchmarkDurationMs:Math.round(performance.now()-started)}));
} finally {
  await pool.end();
  try { await client.end(); } catch {}
  try { await admin.query('drop database if exists ' + database); } finally { await admin.end(); }
}
