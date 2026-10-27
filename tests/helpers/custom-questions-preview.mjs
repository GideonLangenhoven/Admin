import { cpSync, existsSync, mkdtempSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { spawn } from 'node:child_process';

const target = process.argv[2];
if (!['guest', 'admin'].includes(target)) throw new Error('Use guest or admin');
const source = resolve(target === 'guest' ? 'booking' : '.');
const preview = mkdtempSync(`/private/tmp/capekayak-questions-${target}-`);
const exclude = new Set(['node_modules', '.next', '.git', '.vercel', '.agents', '.aws', 'tests', 'docs', 'booking', 'remotion', 'my-video', 'video', 'landing-pages']);
const filter = file => file === source || (!exclude.has(basename(file)) && !basename(file).startsWith('.env'));
cpSync(source, preview, { recursive: true, filter });
symlinkSync(join(source, 'node_modules'), join(preview, 'node_modules'), 'dir');
const config = join(preview, 'next.config.ts');
writeFileSync(config, readFileSync(config, 'utf8').replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:35237").replace('  env: {', '  webpack(config) { config.cache = false; return config; },\n  env: {'));
if (target === 'admin') {
  // Functional operational-view checks use the existing local font so they
  // do not depend on a Google Fonts download. Production files are untouched.
  const layout = join(preview, 'app/layout.tsx');
  writeFileSync(layout, readFileSync(layout, 'utf8').replace(/import \{ Geist_Mono, Plus_Jakarta_Sans \} from "next\/font\/google";\n/, '')
    .replace('Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-sans" })', 'localFont({ src: "./fonts/Satoshi-Variable.woff2", variable: "--font-sans" })')
    .replace('Geist_Mono({ subsets: ["latin"], variable: "--font-mono" })', 'localFont({ src: "./fonts/Satoshi-Variable.woff2", variable: "--font-mono" })'));
}
writeFileSync(`/private/tmp/capekayak-questions-${target}-preview-path`, preview);
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:35237', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-only', NEXT_PUBLIC_BUSINESS_ID: '10000000-0000-4000-8000-000000000001', NEXT_TELEMETRY_DISABLED: '1' };
for (const key of Object.keys(env)) if (/SENTRY|SUPABASE_SERVICE|SUPABASE_ACCESS|YOCO|RESEND|ENCRYPTION|WHATSAPP|WA_TOKEN|SECRET|GOOGLE_/.test(key)) delete env[key];
const next = join(source, 'node_modules/next/dist/bin/next');
let child;
let stopped = false;
function run(args) {
  return new Promise(resolveExit => {
    child = spawn(process.execPath, [next, ...args], { cwd: preview, env, stdio: 'inherit' });
    child.on('exit', code => resolveExit(code || 0));
  });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopped = true; child?.kill(signal); });
if (target === 'guest') {
  const code = await run(['build', '--webpack']);
  if (code || stopped) process.exit(code);
  process.exit(await run(['start', '-H', '127.0.0.1', '-p', '35236']));
} else {
  if (!existsSync(join(preview, 'components'))) throw new Error('Missing admin components');
  process.exit(await run(['dev', '--webpack', '-H', '127.0.0.1', '-p', '35238']));
}
