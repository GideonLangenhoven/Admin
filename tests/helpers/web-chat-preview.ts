import { cpSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";

// Preserve the developer's active .next output and omit every real credential.
const preview = join(mkdtempSync(join(tmpdir(), "capekayak-webchat-preview-")), "booking");
console.log("Isolated guest build: " + preview);
cpSync(resolve("booking"), preview, { recursive: true, filter: source => !["node_modules", ".next", ".git"].includes(basename(source)) && !basename(source).startsWith(".env") });
symlinkSync(resolve("booking/node_modules"), join(preview, "node_modules"), "dir");
const cli = resolve("booking/node_modules/next/dist/bin/next");
const options = { cwd: preview, stdio: "inherit" as const, env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:3094", SUPABASE_URL: "http://127.0.0.1:3094", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key", NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-key", NEXT_PUBLIC_BUSINESS_ID: "a", NEXT_TELEMETRY_DISABLED: "1", SENTRY_AUTH_TOKEN: "", SENTRY_DSN: "", NEXT_PUBLIC_SENTRY_DSN: "", VERCEL_ENV: "preview" } };
let child = spawn(process.execPath, [cli, "build", "--webpack"], options);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
child.on("exit", code => {
  if (code !== 0) process.exit(code || 1);
  // The server needs the compiled output, not the large build cache.
  rmSync(join(preview, ".next/cache"), { recursive: true, force: true });
  child = spawn(process.execPath, [cli, "start", "-H", "127.0.0.1", "-p", "3093"], options);
  child.on("exit", code => process.exit(code || 0));
});
