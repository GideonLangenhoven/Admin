import { cpSync, mkdtempSync, symlinkSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { spawn } from "node:child_process";

const target = process.argv[2];
if (!["guest", "admin"].includes(target)) throw new Error("Use guest or admin");
const source = resolve(target === "guest" ? "booking" : ".");
const prebuilt = target === "guest" ? process.env.CATALOGUE_GUEST_PREBUILT : undefined;
if (prebuilt && (!/^\/private\/tmp\/capekayak-catalogue-guest-[A-Za-z0-9]+$/.test(prebuilt) || !existsSync(join(prebuilt, ".next/BUILD_ID")))) throw new Error("Reuse only a completed disposable catalogue build");
const preview = prebuilt || mkdtempSync(`/private/tmp/capekayak-catalogue-${target}-`);
if (!prebuilt) {
const runtime = ["app", "components", "lib", "public", "supabase/functions/_shared", "next.config.ts", "next-env.d.ts", "tsconfig.json", "package.json", "postcss.config.js", "postcss.config.mjs", "tailwind.config.js", "middleware.ts", "proxy.ts", "instrumentation.ts", "instrumentation-client.ts", "sentry.client.config.ts", "sentry.server.config.ts", "sentry.edge.config.ts"];
for (const name of runtime) if (existsSync(join(source, name))) {
  cpSync(join(source, name), join(preview, name), { recursive: true, filter: file => !["demo", "landing-pages"].includes(basename(file)) });
}
symlinkSync(join(source, "node_modules"), join(preview, "node_modules"), "dir");
const config = join(preview, "next.config.ts");
writeFileSync(config, readFileSync(config, "utf8")
  .replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:3147")
  // These disposable builds do not need an on-disk webpack cache.
  .replace("const nextConfig: NextConfig = {", "const nextConfig: NextConfig = {\n  webpack(config) { config.cache = false; return config; },"));
}
writeFileSync(`/private/tmp/capekayak-catalogue-${target}-preview-path`, preview);
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:3147", NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-only", NEXT_PUBLIC_BUSINESS_ID: "10000000-0000-4000-8000-000000000001", NEXT_TELEMETRY_DISABLED: "1" };
for (const key of Object.keys(env)) if (/SENTRY|SUPABASE_SERVICE|SUPABASE_ACCESS|YOCO|RESEND|ENCRYPTION|WHATSAPP|WA_TOKEN|SECRET|GOOGLE_/.test(key)) delete env[key];
const next = join(source, "node_modules/next/dist/bin/next");
let child;
function run(args) {
  return new Promise(done => {
    child = spawn(process.execPath, [next, ...args], { cwd: preview, env, stdio: "inherit" });
    child.on("exit", code => done(code || 0));
  });
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child?.kill(signal));
if (target === "guest") {
  const code = prebuilt ? 0 : await run(["build", "--webpack"]);
  if (code) process.exit(code);
  // The build cache is disposable and unnecessary for next start.
  rmSync(join(preview, ".next/cache"), { recursive: true, force: true });
  process.exit(await run(["start", "-H", "127.0.0.1", "-p", "3146"]));
} else process.exit(await run(["dev", "--webpack", "-H", "127.0.0.1", "-p", "3148"]));
