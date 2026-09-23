import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const functions = resolve(dirname(fileURLToPath(import.meta.url)), '../supabase/functions');
const original = readFileSync(join(functions, 'deno.lock'));
const config = JSON.parse(readFileSync(join(functions, 'deno.json')));
const fixture = mkdtempSync(join(tmpdir(), 'bookingtours-edge-negative-'));

function check(source) {
  const entry = join(fixture, 'index.ts');
  writeFileSync(entry, source);
  return spawnSync('deno', ['check', '--config', join(fixture, 'deno.json'), '--node-modules-dir=none', '--frozen', entry], {
    encoding: 'utf8',
    env: { ...process.env, DENO_NO_PACKAGE_JSON: '1' },
  });
}

test('frozen Edge graph rejects tampering and float', async (t) => {
  try {
    config.lock = { path: './deno.lock', frozen: true };
    writeFileSync(join(fixture, 'deno.json'), JSON.stringify(config));

    await t.test('modified remote integrity', () => {
      const tampered = JSON.parse(original);
      tampered.remote['https://esm.sh/pako@1.0.11?target=denonext'] = '0'.repeat(64);
      writeFileSync(join(fixture, 'deno.lock'), JSON.stringify(tampered));
      const result = check('import "https://esm.sh/pako@1.0.11?target=denonext";');
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Integrity check failed for remote specifier/);
    });

    await t.test('new floating dependency', () => {
      writeFileSync(join(fixture, 'deno.lock'), original);
      const result = check('import "npm:standardwebhooks@^1.0.0";');
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /lockfile is out of date/);
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
