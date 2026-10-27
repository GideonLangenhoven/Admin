import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';

// P2 Cron regression. Synthetic data only. Refuse remote hosts and never load application secrets.
const host = process.argv[2];
assert(/^\/private\/tmp\/capekayak-db-test-[A-Za-z0-9]+$/.test(host || ''));
const db = new pg.Client({ host, port: Number(process.argv[3]), user: process.env.USER, database: 'postgres' });
const migration = readFileSync('supabase/migrations/20261027190000_pause_ota_crons.sql', 'utf8');
const active = async () => Object.fromEntries((await db.query('SELECT jobname, active FROM cron.job ORDER BY jobname')).rows.map(r => [r.jobname, r.active]));

await db.connect();
try {
  await db.query('BEGIN');
  // Just enough of pg_cron for the migration.
  await db.query(`
    CREATE SCHEMA cron;
    CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text, active boolean DEFAULT true);
    CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL,
      database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL)
    RETURNS void LANGUAGE plpgsql AS $$ BEGIN UPDATE cron.job j SET active = coalesce($6, j.active) WHERE j.jobid = $1; END $$;
    INSERT INTO cron.job(jobname, active) VALUES
      ('gyg-availability-hourly', true), ('viator-availability-hourly', false),
      ('ota-reconcile-nightly', false), ('marketing-dispatch', true);`);
  await db.query(migration);
  assert.deepEqual(await active(), {
    'gyg-availability-hourly': false, 'marketing-dispatch': true,
    'ota-reconcile-nightly': false, 'viator-availability-hourly': false,
  });
  await db.query(migration); // re-running changes nothing
  assert.equal((await active())['marketing-dispatch'], true);
  console.log('ota cron pause: all checks passed');
} finally {
  await db.query('ROLLBACK').catch(() => {});
  await db.end();
}
