// Disposable PostgreSQL only; no project environment or hosted services are used.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import pg from 'pg';

const directory = mkdtempSync('/private/tmp/capekayak-credentials-');
const bin = '/opt/homebrew/opt/postgresql@17/bin';
const env = Object.fromEntries(['PATH', 'USER', 'LANG', 'TMPDIR'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
const run = (name, args) => {
  const result = spawnSync(join(bin, name), args, { env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
};
const business = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const actor = '10000000-0000-4000-8000-000000000010';
const client = new pg.Client({ host: directory, port: 55438, database: 'postgres', user: process.env.USER, ssl: false });
let started = false;
try {
  run('initdb', ['-D', join(directory, 'data'), '-A', 'trust', '--no-locale', '-E', 'UTF8']);
  run('pg_ctl', ['-D', join(directory, 'data'), '-l', join(directory, 'postgres.log'), '-o', `-h '' -k ${directory} -p 55438`, '-w', 'start']);
  started = true;
  await client.connect();
  await client.query(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE businesses(id uuid PRIMARY KEY, subscription_status text, wa_token_encrypted bytea, wa_phone_id_encrypted bytea, wa_phone_id_lookup text,
      yoco_secret_key_encrypted bytea, yoco_webhook_secret_encrypted bytea, yoco_test_secret_key_encrypted bytea, yoco_test_webhook_secret_encrypted bytea,
      yoco_webhook_status text, yoco_test_mode boolean);
    CREATE TABLE admin_users(id uuid PRIMARY KEY, business_id uuid, role text, suspended boolean DEFAULT false, read_only boolean DEFAULT false);
    CREATE TABLE audit_logs(actor_id uuid, business_id uuid, action_type text, target_entity text, target_id uuid, after_state jsonb);
    INSERT INTO businesses(id, subscription_status) VALUES ('${business}', 'ACTIVE'), ('${other}', 'ACTIVE');
    INSERT INTO admin_users(id, business_id, role) VALUES ('${actor}', '${business}', 'MAIN_ADMIN');
  `);
  const sensitive = readFileSync('supabase/migrations/20260921120000_mfa_sensitive_business_columns.sql', 'utf8');
  await client.query(sensitive.slice(sensitive.indexOf('CREATE OR REPLACE FUNCTION public.assert_sensitive_settings_actor'), sensitive.indexOf('CREATE OR REPLACE FUNCTION public.set_sensitive_credentials_audited')));
  await client.query(readFileSync('supabase/migrations/20261017120000_clear_integration_credentials.sql', 'utf8'));
  const seed = async () => client.query(`UPDATE businesses SET wa_token_encrypted='token', wa_phone_id_encrypted='phone', wa_phone_id_lookup='123',
    yoco_secret_key_encrypted='live', yoco_webhook_secret_encrypted='live-hook', yoco_test_secret_key_encrypted='test',
    yoco_test_webhook_secret_encrypted='test-hook', yoco_webhook_status='registered', yoco_test_mode=true`);
  const snapshot = async id => (await client.query('SELECT * FROM businesses WHERE id=$1', [id])).rows[0];
  const clear = (section, target = business) => client.query('SELECT clear_sensitive_credentials_audited($1,$2,$3)', [target, actor, section]);
  for (const [section, columns] of [
    ['wa', ['wa_token_encrypted', 'wa_phone_id_encrypted', 'wa_phone_id_lookup']],
    ['yoco', ['yoco_secret_key_encrypted', 'yoco_webhook_secret_encrypted', 'yoco_webhook_status']],
    ['yoco_test', ['yoco_test_secret_key_encrypted', 'yoco_test_webhook_secret_encrypted']],
  ]) {
    await seed();
    const before = await snapshot(business), untouched = await snapshot(other);
    await clear(section);
    assert.deepEqual(await snapshot(business), { ...before, ...Object.fromEntries(columns.map(name => [name, null])) });
    assert.deepEqual(await snapshot(other), untouched);
    const log = (await client.query('SELECT * FROM audit_logs WHERE after_state->>\'section\'=$1', [section])).rows[0];
    assert.equal(log.actor_id, actor);
    assert.equal(log.business_id, business);
    assert.deepEqual(log.after_state, { outcome: 'success', section, operation: 'clear', assisted: false });
  }
  await seed();
  const before = await snapshot(business);
  await assert.rejects(clear('all'), /Unknown protected credential section/);
  await assert.rejects(clear('wa', other), /not authorized/);
  for (const change of ["role='ADMIN'", "role='MAIN_ADMIN',read_only=true", "read_only=false,suspended=true"]) {
    await client.query(`UPDATE admin_users SET ${change}`);
    await assert.rejects(clear('wa'), /not authorized/);
  }
  await client.query("UPDATE admin_users SET role='MAIN_ADMIN',suspended=false,read_only=false");
  await client.query("UPDATE businesses SET subscription_status='SUSPENDED' WHERE id=$1", [business]);
  await assert.rejects(clear('wa'), /not active/);
  await client.query("UPDATE businesses SET subscription_status='ACTIVE' WHERE id=$1", [business]);
  assert.deepEqual(await snapshot(business), before);
  await client.query("ALTER TABLE audit_logs ADD CONSTRAINT reject_audit CHECK (action_type <> 'SENSITIVE_CREDENTIAL_CHANGED') NOT VALID");
  await assert.rejects(clear('wa'), /reject_audit/);
  assert.deepEqual(await snapshot(business), before);
  await client.query('ALTER TABLE audit_logs DROP CONSTRAINT reject_audit');
  for (const role of ['anon', 'authenticated']) {
    await client.query(`SET ROLE ${role}`);
    await assert.rejects(clear('wa'), /permission denied/);
    await client.query('RESET ROLE');
  }
  await client.query("UPDATE admin_users SET role='SUPER_ADMIN'");
  await client.query('SET ROLE service_role');
  await clear('wa', other);
  await client.query('RESET ROLE');
  const assisted = (await client.query('SELECT after_state FROM audit_logs WHERE business_id=$1', [other])).rows[0];
  assert.equal(assisted.after_state.assisted, true);
  console.log('Integration credential SQL checks passed: scoped removal, mode preservation, authorization, audit rollback and service-only access.');
} finally {
  await client.end().catch(() => {});
  if (started) run('pg_ctl', ['-D', join(directory, 'data'), '-m', 'fast', '-w', 'stop']);
}
