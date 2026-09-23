import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const functions = resolve(dirname(fileURLToPath(import.meta.url)), '../supabase/functions');
const root = JSON.parse(readFileSync(join(functions, 'deno.json')));
const lockFile = join(functions, 'deno.lock');
const lockBytes = readFileSync(lockFile);
const lock = JSON.parse(lockBytes);
const names = readdirSync(functions, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(functions, entry.name, 'index.ts')))
  .map((entry) => entry.name);

if (!/^deno 2\.9\.4\b/.test(spawnSync('deno', ['--version'], { encoding: 'utf8' }).stdout ?? '')) {
  throw new Error('Edge checks require Deno 2.9.4');
}
if (names.length === 0 || root.lock?.path !== './deno.lock' || root.lock?.frozen !== true ||
    lock.version !== '5' || Object.keys(lock.redirects ?? {}).length !== 0 ||
    Object.keys(lock.remote ?? {}).length === 0) {
  throw new Error('Expected a frozen, integrity-recorded Edge graph without redirects');
}
for (const name of names) {
  const config = JSON.parse(readFileSync(join(functions, name, 'deno.json')));
  if (config.lock?.path !== '../deno.lock' || config.lock?.frozen !== true ||
      JSON.stringify(config.imports) !== JSON.stringify(root.imports) ||
      JSON.stringify(config.compilerOptions) !== JSON.stringify(root.compilerOptions)) {
    throw new Error(`${name}: deployment config differs from the frozen shared graph`);
  }
}

const output = mkdtempSync(join(tmpdir(), 'bookingtours-edge-bundles-'));
try {
  for (const name of names) {
    const config = join(functions, name, 'deno.json');
    const entry = join(functions, name, 'index.ts');
    for (const args of [
      ['check', '--config', config, '--node-modules-dir=none', '--frozen', entry],
      ['bundle', '--config', config, '--node-modules-dir=none', '--frozen', '--output', join(output, `${name}.js`), entry],
    ]) {
      const result = spawnSync('deno', args, {
        stdio: 'inherit',
        env: { ...process.env, DENO_NO_PACKAGE_JSON: '1' },
      });
      if (result.error || result.status !== 0) throw new Error(`${name}: deno ${args[0]} failed (${result.error?.message ?? result.signal ?? result.status})`);
    }
  }
  if (!readFileSync(lockFile).equals(lockBytes)) throw new Error('Frozen Edge checks changed deno.lock');
  console.log(`Frozen Deno 2.9.4 check and bundle passed for ${names.length} functions`);
} finally {
  rmSync(output, { recursive: true, force: true });
}
