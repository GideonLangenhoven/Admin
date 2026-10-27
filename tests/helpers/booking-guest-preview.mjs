import { cpSync, mkdtempSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { spawn } from 'node:child_process';

const preview = join(mkdtempSync('/private/tmp/capekayak-guest-preview-'), 'booking');
cpSync(resolve('booking'), preview, { recursive: true, filter: file => !['node_modules', '.next', '.git', '.vercel'].includes(basename(file)) && !basename(file).startsWith('.env') });
symlinkSync(resolve('booking/node_modules'), join(preview, 'node_modules'), 'dir');
const config = join(preview, 'next.config.ts');
writeFileSync(config, readFileSync(config, 'utf8').replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:3117"));
writeFileSync('/private/tmp/capekayak-guest-preview-path', preview);
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:3117', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-only', NEXT_PUBLIC_BUSINESS_ID: '10000000-0000-4000-8000-000000000001', NEXT_TELEMETRY_DISABLED: '1' };
for (const key of Object.keys(env)) if (/SENTRY|SUPABASE_SERVICE|SUPABASE_ACCESS|YOCO|RESEND/.test(key)) delete env[key];
const child = spawn(process.execPath, [resolve('booking/node_modules/next/dist/bin/next'), 'dev', '--webpack', '-H', '127.0.0.1', '-p', '3116'], { cwd: preview, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code || 0));
