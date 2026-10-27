import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

// P2 Directions repair script. Synthetic data only. Refuse remote hosts and never load application secrets.
const host = process.argv[2];
assert(/^\/private\/tmp\/capekayak-db-test-[A-Za-z0-9]+$/.test(host || ''));
const port = Number(process.argv[3]);
const database = 'empty_rich_text_' + randomBytes(6).toString('hex');
const admin = new pg.Client({ host, port, user: process.env.USER, database: 'postgres' });
const db = new pg.Client({ host, port, user: process.env.USER, database });
const url = `postgresql://${process.env.USER}@localhost:${port}/${database}?host=${host}&sslmode=disable`;
const run = (...args) => spawnSync('node', ['scripts/repair-empty-rich-text.mjs', ...args], { env: { PATH: process.env.PATH, DATABASE_URL: url }, encoding: 'utf8' });
const rows = async () => (await db.query('SELECT name, directions, terms_conditions, privacy_policy, cookies_policy FROM businesses ORDER BY name')).rows;

await admin.connect();
await admin.query('CREATE DATABASE ' + database);
try {
  await db.connect();
  await db.query(`
    CREATE TABLE businesses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text,
      directions text, terms_conditions text, privacy_policy text, cookies_policy text);
    INSERT INTO businesses(name, directions, terms_conditions, privacy_policy, cookies_policy) VALUES
      ('Alpha', '<br>', '<p><br></p>', 'Real policy', NULL),
      ('Beta', '<p>Meet at the slipway</p>', '&nbsp; ', '', '<img src="map.png">'),
      ('Gamma', 'Slipway', NULL, NULL, NULL);`);
  const before = await rows();

  const dry = run();
  assert.equal(dry.status, 1, dry.stderr);
  assert.match(dry.stdout, /2 business\(es\) hold empty markup/);
  assert.match(dry.stdout, /Alpha: directions "<br>" -> NULL, terms_conditions "<p><br><\/p>" -> NULL/);
  assert.match(dry.stdout, /Beta: terms_conditions "&nbsp; " -> NULL  \[/);
  assert.deepEqual(await rows(), before, 'dry run must change nothing');

  const applied = run('--apply');
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /Repaired 2 of 2 business\(es\)/);
  assert.deepEqual(await rows(), [
    { name: 'Alpha', directions: null, terms_conditions: null, privacy_policy: 'Real policy', cookies_policy: null },
    { name: 'Beta', directions: '<p>Meet at the slipway</p>', terms_conditions: null, privacy_policy: '', cookies_policy: '<img src="map.png">' },
    { name: 'Gamma', directions: 'Slipway', terms_conditions: null, privacy_policy: null, cookies_policy: null },
  ]);

  const again = run();
  assert.equal(again.status, 0);
  assert.match(again.stdout, /No empty rich text/);
  console.log('empty rich text repair: all checks passed');
} finally {
  await db.end().catch(() => {});
  await admin.query('DROP DATABASE IF EXISTS ' + database).catch(() => {});
  await admin.end();
}
