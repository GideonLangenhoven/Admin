import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('release plan contains exactly the six reviewed migrations and no ledger backfill', () => {
  const plan = JSON.parse(execFileSync(process.execPath, ['scripts/release-sql.mjs', 'plan'], {encoding:'utf8'}));
  const sql = readFileSync(plan.sqlPath, 'utf8');
  assert.equal(createHash('sha256').update(sql).digest('hex'), plan.sqlSha256);
  assert.equal(plan.migrations.length, 6);
  assert.equal(plan.ledgerBefore.count, 215);
  assert.equal(plan.ledgerBefore.latest, '20260922123000');
  assert.equal([...sql.matchAll(/^INSERT INTO supabase_migrations\.schema_migrations/gm)].length, 6);
  assert(sql.includes('LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE'));
  assert(sql.trimEnd().endsWith('COMMIT;'));
  for (const {name, sha256} of plan.migrations) {
    assert.equal(createHash('sha256').update(readFileSync('supabase/migrations/' + name)).digest('hex'), sha256);
    assert(sql.includes(`VALUES('${name.slice(0,14)}','${name.slice(15,-4)}',ARRAY[`));
  }
  const wrongHash = spawnSync(process.execPath, ['scripts/release-sql.mjs', 'rehearse', '--project-ref', plan.projectRef, '--sql-sha256', 'wrong'], {encoding:'utf8'});
  assert.notEqual(wrongHash.status, 0);
  assert.match(wrongHash.stderr, /SQL digest differs from reviewed plan/);
});

test('shared ingress is a separate hash-pinned stage after the original six', () => {
  const six = JSON.parse(execFileSync(process.execPath, ['scripts/release-sql.mjs','plan'], {encoding:'utf8'}));
  const ingress = JSON.parse(execFileSync(process.execPath, ['scripts/release-sql.mjs','plan','--stage','shared-ingress'], {encoding:'utf8'}));
  assert.equal(six.sqlSha256, '63ae9243a5af8d7462e57c99a7bdc6822b929e352f72e5c4f8540322eb92d46b');
  assert.equal(ingress.ledgerBefore.count, 221);
  assert.equal(ingress.ledgerBefore.latest, '20260925120000');
  assert.equal(ingress.migrations.length, 1);
  assert.equal(ingress.migrations[0].name, '20260927100000_shared_ingress_rate_limit.sql');
  const sql = readFileSync(ingress.sqlPath, 'utf8');
  assert.equal(createHash('sha256').update(sql).digest('hex'), ingress.sqlSha256);
  assert.equal([...sql.matchAll(/^INSERT INTO supabase_migrations\.schema_migrations/gm)].length, 1);
  assert(sql.includes("to_regprocedure('public.check_ingress_rate_limit(text,text,integer,integer)')"));
});

test('hosted API errors cannot print returned secrets or rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'capekayak-release-error-'));
  const mock = dir + '/fetch.mjs';
  writeFileSync(mock, "globalThis.fetch = async () => new Response(JSON.stringify({code:'23505',message:'SYNTHETIC_SECRET',row:{email:'private@example.invalid'}}), {status:400,headers:{'Content-Type':'application/json'}});\n");
  const result = spawnSync(process.execPath, ['--import', mock, 'scripts/release-sql.mjs', 'inspect'], {
    encoding:'utf8',
    env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'https://ukdsrndqhsatjkmxijuj.supabase.co',SUPABASE_ACCESS_TOKEN:'synthetic-token'},
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SQL HTTP 400 SQLSTATE 23505/);
  assert(!result.stderr.includes('SYNTHETIC_SECRET'));
  assert(!result.stderr.includes('private@example.invalid'));
  assert(!result.stderr.includes('synthetic-token'));
});
