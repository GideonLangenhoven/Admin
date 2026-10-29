import { describe, expect, it, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve(__dirname, "../../scripts/check-client-bundle-secrets.mjs");

// Clearly fake tokens: signature is a literal word, project ref is a placeholder.
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (role: string) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role, ref: "test-ref", exp: 2000000000 })}.fake-signature-for-tests`;
const SERVICE_JWT = jwt("service_role");
const ANON_JWT = jwt("anon");
const CANARY = "canary-server-secret-0123456789abcdef";

const dirs: string[] = [];
const sandbox = () => {
  const d = mkdtempSync(join(tmpdir(), "bundle-scan-"));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

type Result = { code: number; out: string };
// Minimal env so the scan never inherits real secrets from the machine running the tests.
const run = (args: string[], cwd: string, env: Record<string, string> = {}) =>
  new Promise<Result>((done) =>
    execFile(process.execPath, [SCRIPT, ...args], { cwd, env: { PATH: process.env.PATH ?? "", ...env } }, (err, stdout, stderr) =>
      done({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: stdout + stderr }),
    ),
  );

const chunk = (dir: string, body: string) => {
  const d = join(dir, "static", "chunks");
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "1051-test.js"), body);
  return join(dir, "static");
};

describe("client bundle scan: static mode", () => {
  it("fails on a service_role JWT in a chunk and never prints the token", async () => {
    const dir = sandbox();
    const r = await run(["static", chunk(dir, `let a="https://x.supabase.co",n="${SERVICE_JWT}";if(!a||!n)throw Error("x")`)], dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain('JWT with role "service_role"');
    expect(r.out).toContain("1051-test.js");
    expect(r.out).not.toContain(SERVICE_JWT);
    expect(r.out).not.toContain("fake-signature-for-tests");
  });

  it("passes when the only JWT is an anon key", async () => {
    const dir = sandbox();
    const r = await run(["static", chunk(dir, `let n="${ANON_JWT}";`)], dir);
    expect(r.code).toBe(0);
  });

  it("ignores JWT-shaped strings that carry no role (not a Supabase key)", async () => {
    const dir = sandbox();
    const r = await run(["static", chunk(dir, `let n="${b64({ alg: "HS256" })}.${b64({ sub: "someone", exp: 1 })}.fake-signature-for-tests";`)], dir);
    expect(r.code).toBe(0);
  });

  it.each([
    ["service_role", 'role:"service_role"'],
    ["sb_secret_", 'k="sb_secret_abcdefghijklmnop"'],
    ["SUPABASE_SERVICE_ROLE_KEY", "process.env.SUPABASE_SERVICE_ROLE_KEY"],
    ["SUPABASE_SECRET_KEYS", "process.env.SUPABASE_SECRET_KEYS"],
    ["SETTINGS_ENCRYPTION_KEY", "process.env.SETTINGS_ENCRYPTION_KEY"],
    ["Yoco secret key", 'k="sk_live_abcdefgh12345678"'],
    ["Resend API key", 'k="re_abcdefghijklmnopqrstuvwxyz012345"'],
    ["PEM block", 'k="-----BEGIN PRIVATE KEY-----"'],
  ])("fails on %s", async (rule, body) => {
    const dir = sandbox();
    const r = await run(["static", chunk(dir, body)], dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain(rule);
  });

  it("fails when the value of a server-only env var is in the bundle, naming the variable but not the value", async () => {
    const dir = sandbox();
    const r = await run(["static", chunk(dir, `let k="${CANARY}";`)], dir, { WA_ACCESS_TOKEN: CANARY });
    expect(r.code).toBe(1);
    expect(r.out).toContain("WA_ACCESS_TOKEN");
    expect(r.out).not.toContain(CANARY);
  });

  it("does not flag the value of a public-by-design variable", async () => {
    const dir = sandbox();
    const r = await run(["static", chunk(dir, `let k="${CANARY}";`)], dir, { WEB_PUSH_PUBLIC_KEY: CANARY });
    expect(r.code).toBe(0);
  });

  it("fails closed (exit 2) when there is nothing to scan", async () => {
    const dir = sandbox();
    expect((await run(["static", join(dir, "missing")], dir)).code).toBe(2);
    mkdirSync(join(dir, "empty"));
    expect((await run(["static", join(dir, "empty")], dir)).code).toBe(2);
  });
});

describe("client bundle scan: env mode (the actual S1 root cause)", () => {
  it("fails when NEXT_PUBLIC_SUPABASE_ANON_KEY holds a service_role JWT, without printing it", async () => {
    const dir = sandbox();
    const r = await run(["env"], dir, { NEXT_PUBLIC_SUPABASE_ANON_KEY: SERVICE_JWT });
    expect(r.code).toBe(1);
    expect(r.out).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(r.out).toContain("service_role");
    expect(r.out).not.toContain(SERVICE_JWT);
  });

  it("fails when a public variable holds an sb_secret_ key", async () => {
    const dir = sandbox();
    expect((await run(["env"], dir, { NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_abcdefghijklmnop" })).code).toBe(1);
  });

  it("fails when a public variable duplicates a server secret", async () => {
    const dir = sandbox();
    const r = await run(["env"], dir, { NEXT_PUBLIC_SUPABASE_ANON_KEY: CANARY, SUPABASE_SERVICE_ROLE_KEY: CANARY });
    expect(r.code).toBe(1);
    expect(r.out).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(r.out).not.toContain(CANARY);
  });

  it.each(["NEXT_PUBLIC_SERVICE_KEY", "NEXT_PUBLIC_MY_SECRET", "NEXT_PUBLIC_PRIVATE_THING", "NEXT_PUBLIC_ENCRYPTION_SALT"])("fails on the variable name %s", async (name) => {
    const dir = sandbox();
    expect((await run(["env"], dir, { [name]: "x" })).code).toBe(1);
  });

  it("also reads names and values from .env files in the working directory", async () => {
    const dir = sandbox();
    writeFileSync(join(dir, ".env.production"), `NEXT_PUBLIC_SUPABASE_ANON_KEY=${SERVICE_JWT}\n`);
    expect((await run(["env"], dir)).code).toBe(1);
  });

  it("passes with an anon key and a normal public config", async () => {
    const dir = sandbox();
    const r = await run(["env"], dir, {
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_JWT,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site-key",
      SUPABASE_SERVICE_ROLE_KEY: CANARY,
    });
    expect(r.code).toBe(0);
  });
});

describe("client bundle scan: url mode", () => {
  const serve = async (script: string) => {
    const server = createServer((req, res) => {
      if (req.url === "/_next/static/chunks/app.js") { res.setHeader("content-type", "text/javascript"); res.end(script); return; }
      res.setHeader("content-type", "text/html");
      res.end('<html><script src="/_next/static/chunks/app.js"></script></html>');
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const { port } = server.address() as { port: number };
    return { origin: `http://127.0.0.1:${port}`, close: () => server.close() };
  };

  it("finds a service_role JWT in a script a live page loads", async () => {
    const site = await serve(`let n="${SERVICE_JWT}";`);
    try {
      const r = await run(["url", site.origin], sandbox());
      expect(r.code).toBe(1);
      expect(r.out).toContain("/_next/static/chunks/app.js");
      expect(r.out).not.toContain(SERVICE_JWT);
    } finally { site.close(); }
  });

  it("passes on a clean live page", async () => {
    const site = await serve(`let n="${ANON_JWT}";`);
    try { expect((await run(["url", site.origin], sandbox())).code).toBe(0); } finally { site.close(); }
  });

  it("fails closed (exit 2) when the site is unreachable", async () => {
    expect((await run(["url", "http://127.0.0.1:1"], sandbox())).code).toBe(2);
  });
});

describe("client bundle scan: repo wiring", () => {
  it("the booking repo copy is identical to this one (when checked out alongside)", () => {
    const copy = resolve(__dirname, "../../booking/scripts/check-client-bundle-secrets.mjs");
    if (!existsSync(copy)) return; // CI pins an older booking checkout
    expect(readFileSync(copy, "utf8")).toBe(readFileSync(SCRIPT, "utf8"));
  });

  it("the admin build runs the env check before and the bundle scan after", () => {
    const scripts = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8")).scripts;
    expect(scripts.prebuild).toContain("check-client-bundle-secrets.mjs env");
    expect(scripts.postbuild).toContain("check-client-bundle-secrets.mjs static");
  });
});
