import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

// Section 5: validate_promo_code rate limit. Synthetic data only. Refuse remote hosts and never load application secrets.
// Usage: node tests/promo-rate-limit-local.mjs <disposable socket dir> <port>
const host = process.argv[2];
assert(/^\/private\/tmp\/capekayak-db-test-[A-Za-z0-9]+$/.test(host || ''));
const port = Number(process.argv[3]);
const database = 'promo_rate_limit_' + randomBytes(6).toString('hex');
const admin = new pg.Client({ host, port, user: process.env.USER, database: 'postgres' });
const db = new pg.Client({ host, port, user: process.env.USER, database });
const BIZ = '00000000-0000-4000-8000-000000000011';
const LIMITED = 'Too many promo code attempts. Wait a minute, then try again.';
const migration = name => readFileSync('supabase/migrations/' + name, 'utf8');

// One PostgREST request: the caller's role and headers, in its own transaction.
async function check(role, ip, code = 'GUESS') {
  await db.query('BEGIN');
  try {
    await db.query("SELECT set_config('request.jwt.claim.role', $1, true), set_config('request.headers', $2, true)",
      [role, ip ? JSON.stringify({ 'x-forwarded-for': ip + ', 10.0.0.1' }) : '']);
    await db.query(`SET LOCAL ROLE ${role}`);
    const { rows } = await db.query('SELECT validate_promo_code($1, $2, 0, NULL) AS r', [BIZ, code]);
    await db.query('COMMIT');
    return rows[0].r;
  } catch (error) { await db.query('ROLLBACK'); throw error; }
}
async function burst(role, ip, n) {
  const errors = [];
  for (let i = 0; i < n; i++) errors.push((await check(role, ip)).error);
  return errors;
}
// The bucket counts per clock minute, so start each burst early in one.
async function freshMinute() {
  const s = new Date().getSeconds();
  if (s > 50) await new Promise(resolve => setTimeout(resolve, (61 - s) * 1000));
}

await admin.connect();
await admin.query('CREATE DATABASE ' + database);
try {
  await db.connect();
  await db.query(`DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
    END $$;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
    CREATE TABLE promotions(id uuid PRIMARY KEY, business_id uuid, code text, active boolean DEFAULT true,
      valid_from timestamptz DEFAULT now() - interval '1 day', valid_until timestamptz, max_uses integer, used_count integer DEFAULT 0,
      min_order_amount numeric DEFAULT 0, discount_type text, discount_value numeric, description text);
    CREATE TABLE promotion_uses(promotion_id uuid, email text);
    INSERT INTO promotions(id, business_id, code, discount_type, discount_value)
      VALUES ('00000000-0000-4000-8000-000000000021', '${BIZ}', 'SUMMER20', 'PERCENT', 20);`);
  await db.query(migration('20260519120000_an4_api_rate_limit_bucket.sql'));
  await db.query(migration('20260425120000_promo_atomic_enforcement.sql').match(/CREATE OR REPLACE FUNCTION public\.validate_promo_code\([\s\S]*?\n\$\$;/)[0]);
  await db.query('GRANT EXECUTE ON FUNCTION public.validate_promo_code(uuid, text, numeric, text) TO anon, authenticated, service_role');

  // Before: an anonymous script can guess codes without limit.
  await freshMinute();
  assert.deepEqual(await burst('anon', '198.51.100.7', 31), Array(31).fill('Invalid promo code'));

  await db.query(migration('20261027200000_validate_promo_code_rate_limit.sql'));
  assert.equal((await db.query("SELECT has_function_privilege('anon', 'public.validate_promo_code(uuid, text, numeric, text)', 'EXECUTE') ok")).rows[0].ok, true);

  // After: 30 checks a minute per visitor, then refused, even for a real code.
  await freshMinute();
  assert.deepEqual(await burst('anon', '198.51.100.8', 31), [...Array(30).fill('Invalid promo code'), LIMITED]);
  assert.equal((await check('anon', '198.51.100.8', 'SUMMER20')).error, LIMITED);
  assert.equal((await check('authenticated', '198.51.100.8', 'SUMMER20')).error, LIMITED);
  // Another visitor is unaffected, and a valid code answers exactly as before.
  assert.deepEqual(await check('anon', '203.0.113.9', 'summer20'), {
    valid: true, promo_id: '00000000-0000-4000-8000-000000000021', code: 'SUMMER20', discount_type: 'PERCENT', discount_value: 20, description: '',
  });
  // Server callers share one IP and are not counted; nor is a call with no request headers.
  assert.deepEqual(await burst('service_role', '198.51.100.8', 3), Array(3).fill('Invalid promo code'));
  assert.equal((await check('anon', null)).error, 'Invalid promo code');
  assert.deepEqual((await db.query("SELECT ip, sum(count)::int n FROM api_rate_limits WHERE endpoint = 'validate_promo_code' GROUP BY ip ORDER BY ip")).rows,
    [{ ip: '198.51.100.8', n: 33 }, { ip: '203.0.113.9', n: 1 }]);
  console.log('validate_promo_code rate limit: all checks passed');
} finally {
  await db.end().catch(() => {});
  await admin.query('DROP DATABASE IF EXISTS ' + database).catch(() => {});
  await admin.end();
}
