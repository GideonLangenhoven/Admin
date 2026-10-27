// Disposable PostgreSQL only. No environment files or hosted accounts are read.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import pg from 'pg';

const directory = mkdtempSync('/private/tmp/capekayak-admin-contact-');
const bin = '/opt/homebrew/opt/postgresql@17/bin';
const env = Object.fromEntries(['PATH', 'USER', 'LANG', 'TMPDIR'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
function run(name, args) {
  const result = spawnSync(join(bin, name), args, { env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const db = new pg.Client({ host: directory, port: 55439, database: 'postgres', user: process.env.USER, ssl: false });
let started = false;
try {
  run('initdb', ['-D', join(directory, 'data'), '-A', 'trust', '--no-locale', '-E', 'UTF8']);
  run('pg_ctl', ['-D', join(directory, 'data'), '-l', join(directory, 'postgres.log'), '-o', `-h '' -k ${directory} -p 55439`, '-w', 'start']);
  started = true;
  await db.connect();
  await db.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, email text UNIQUE);
    CREATE TABLE admin_users(id uuid PRIMARY KEY, email text UNIQUE NOT NULL, user_id uuid, name text,
      role text, business_id uuid, must_set_password boolean, password_hash text, password_set_at timestamptz,
      setup_token_hash text, setup_token_hash_used text, setup_token_expires_at timestamptz,
      setup_token_claim_id uuid, setup_token_claimed_at timestamptz, invite_sent_at timestamptz);
    REVOKE ALL ON admin_users FROM anon, authenticated;
    GRANT SELECT ON admin_users TO authenticated;
  `);
  await db.query(readFileSync('supabase/migrations/20260921130000_authoritative_auth_passwords.sql', 'utf8'));
  await db.query(readFileSync('supabase/migrations/20261019110000_admin_contact_details.sql', 'utf8'));
  await db.query("INSERT INTO auth.users VALUES($1,'owner@example.invalid'),($2,'occupied@example.invalid')", [id(1), id(2)]);
  await db.query("INSERT INTO admin_users(id,email,user_id,name,role,business_id,must_set_password) VALUES($1,'owner@example.invalid',$2,'Owner','MAIN_ADMIN',$3,false),($4,'pending@example.invalid',NULL,'Invite','ADMIN',$3,true)", [id(10), id(1), id(20), id(11)]);
  await db.query("SELECT issue_admin_setup_token($1,'old-token',now()+interval '1 hour',false)", [id(10)]);
  const before = (await db.query('SELECT * FROM admin_users WHERE id=$1', [id(10)])).rows[0];
  await db.query("UPDATE auth.users SET email='new@example.invalid' WHERE id=$1", [id(1)]);
  const after = (await db.query('SELECT * FROM admin_users WHERE id=$1', [id(10)])).rows[0];
  assert.equal(after.email, 'new@example.invalid');
  for (const key of ['id', 'user_id', 'business_id', 'role', 'must_set_password', 'name']) assert.equal(after[key], before[key], key);
  for (const key of ['setup_token_hash', 'setup_token_hash_used', 'setup_token_expires_at', 'setup_token_claim_id', 'setup_token_claimed_at', 'invite_sent_at']) assert.equal(after[key], null, key);
  assert.equal((await db.query("SELECT claim_admin_setup_token('owner@example.invalid','old-token',$1) result", [id(30)])).rows[0].result.status, 'INVALID');
  await assert.rejects(db.query("UPDATE admin_users SET email='mismatch@example.invalid' WHERE id=$1", [id(10)]), { code: '23514' });
  await assert.rejects(db.query("UPDATE auth.users SET email='PENDING@example.invalid' WHERE id=$1", [id(1)]), { code: '23505' });
  assert.equal((await db.query('SELECT email FROM auth.users WHERE id=$1', [id(1)])).rows[0].email, 'new@example.invalid');
  await assert.rejects(db.query("UPDATE admin_users SET email='OCCUPIED@example.invalid' WHERE id=$1", [id(11)]), { code: '23505' });
  console.log('PASS Auth/admin email synchronization is atomic; duplicate emails roll back; pending invites cannot take over an existing identity; old tokens expire');

  await db.query("SELECT issue_admin_setup_token($1,'busy-token',now()+interval '1 hour',false)", [id(10)]);
  await db.query("SELECT claim_admin_setup_token('new@example.invalid','busy-token',$1)", [id(31)]);
  await assert.rejects(db.query("UPDATE auth.users SET email='during-setup@example.invalid' WHERE id=$1", [id(1)]), { code: '55000' });
  assert.equal((await db.query('SELECT email FROM auth.users WHERE id=$1', [id(1)])).rows[0].email, 'new@example.invalid');
  await db.query('SELECT release_admin_setup_token_claim($1,$2)', [id(10), id(31)]);
  await db.query("UPDATE auth.users SET email='after-setup@example.invalid' WHERE id=$1", [id(1)]);
  await db.query("SELECT issue_admin_setup_token($1,'pending-token',now()+interval '1 hour',false)", [id(11)]);
  await db.query("UPDATE admin_users SET name='New invite',email='  New-Invite@Example.invalid ',phone='+27 82 555 0100' WHERE id=$1", [id(11)]);
  const invite = (await db.query('SELECT * FROM admin_users WHERE id=$1', [id(11)])).rows[0];
  assert.equal(invite.email, 'new-invite@example.invalid'); assert.equal(invite.phone, '+27 82 555 0100');
  assert.equal(invite.setup_token_hash, null); assert.equal(invite.must_set_password, true); assert.equal(invite.user_id, null);
  await db.query('UPDATE admin_users SET phone=NULL WHERE id=$1', [id(11)]);
  await assert.rejects(db.query('UPDATE admin_users SET phone=$1 WHERE id=$2', ['1'.repeat(41), id(11)]), { code: '23514' });
  for (const role of ['anon', 'authenticated']) {
    await db.query('SET ROLE ' + role);
    await assert.rejects(db.query("UPDATE admin_users SET email='bypass@example.invalid'"), { code: '42501' });
    await assert.rejects(db.query('SELECT sync_admin_auth_email()'), { code: '42501' });
    await db.query('RESET ROLE');
  }
  console.log('PASS active password setup blocks email changes; invitations can be corrected; optional phone can be cleared; direct client writes stay denied');
} finally {
  await db.end().catch(() => {});
  if (started) run('pg_ctl', ['-D', join(directory, 'data'), '-m', 'fast', '-w', 'stop']);
}
