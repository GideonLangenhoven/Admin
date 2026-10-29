import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Security tests B and C (scripts/security-surface-check.mjs), proven against a fake API: it must pass a locked-down
// one and fail each kind of leak. A check that has only ever passed proves nothing.

const SCRIPT = resolve(__dirname, "../../scripts/security-surface-check.mjs");
type Handler = (req: IncomingMessage, res: ServerResponse) => void;

async function withApi(handler: Handler, run: (url: string) => Promise<void>) {
  const server = createServer(handler);
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  try { await run(`http://127.0.0.1:${(server.address() as { port: number }).port}`); } finally { server.close(); }
}
const reply = (res: ServerResponse, status: number, body?: unknown) => { res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(body === undefined ? "" : JSON.stringify(body)); };
const run = (mode: string, env: Record<string, string>) =>
  new Promise<{ code: number; out: string }>((done) =>
    execFile(process.execPath, [SCRIPT, mode], { env: { PATH: process.env.PATH ?? "", ...env } }, (err, stdout, stderr) =>
      done({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: stdout + stderr })));

// A locked-down API: no tenant data to anon, privileged objects denied, writes refused.
const locked: Handler = (req, res) => {
  const url = req.url || "";
  if (req.method === "GET") return /\/(admin_users|businesses|logs)\?/.test(url) ? reply(res, 401, { code: "42501" }) : reply(res, 200, []);
  if (url.includes("/rpc/current_business_ids")) return reply(res, 200, []);
  if (url.includes("/rpc/")) return reply(res, 404, { code: "PGRST202" });
  return reply(res, 401, { code: "42501" });
};

describe("anon access matrix (test C)", () => {
  const env = (url: string) => ({ SUPABASE_URL: url, SUPABASE_ANON_KEY: "public-key-fixture" });

  it("passes a locked-down API", async () => {
    await withApi(locked, async (url) => {
      const r = await run("anon", env(url));
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain("26/26 passed");
    });
  });

  it("fails when anon can read customers", async () => {
    await withApi((req, res) => (req.url?.includes("/customers?") ? reply(res, 200, [{ id: "c1", email: "x@example.invalid" }]) : locked(req, res)), async (url) => {
      const r = await run("anon", env(url));
      expect(r.code).toBe(1);
      expect(r.out).toContain("customers readable by anon");
    });
  });

  it("fails when anon can read admin_users or logs", async () => {
    await withApi((req, res) => (req.url?.includes("/logs?") ? reply(res, 200, [{ id: 1 }]) : locked(req, res)), async (url) => {
      const r = await run("anon", env(url));
      expect(r.code).toBe(1);
      expect(r.out).toContain("logs?select=*");
    });
  });

  it("fails when a PATCH to bookings modifies a row", async () => {
    await withApi((req, res) => (req.method === "PATCH" && req.url?.includes("/bookings?") ? reply(res, 200, [{ id: "b1", status: "PAID" }]) : locked(req, res)), async (url) => {
      const r = await run("anon", env(url));
      expect(r.code).toBe(1);
      expect(r.out).toContain("PATCH bookings status=PAID");
    });
  });

  it("fails when anon can write a table it should never touch", async () => {
    await withApi((req, res) => (req.method === "POST" && req.url?.includes("/rest/v1/otp_attempts") ? reply(res, 201, []) : locked(req, res)), async (url) => {
      const r = await run("anon", env(url));
      expect(r.code).toBe(1);
      expect(r.out).toContain("otp_attempts: no INSERT / UPDATE / DELETE is applied for anon");
    });
  });

  it("fails when a privileged RPC is callable", async () => {
    await withApi((req, res) => (req.url?.includes("/rpc/get_operator_dashboard") ? reply(res, 200, { revenue: 1 }) : locked(req, res)), async (url) => {
      const r = await run("anon", env(url));
      expect(r.code).toBe(1);
      expect(r.out).toContain("rpc/get_operator_dashboard");
    });
  });

  it("does not print the key", async () => {
    await withApi(locked, async (url) => {
      expect((await run("anon", env(url))).out).not.toContain("public-key-fixture");
    });
  });

  it("exits 2 (cannot run) without a key", async () => {
    const r = await run("anon", { SUPABASE_URL: "http://127.0.0.1:1" });
    expect(r.code).toBe(2);
  });
});

describe("retired key is dead (test B)", () => {
  it("passes when the old key is refused everywhere, and never prints it", async () => {
    await withApi((_req, res) => reply(res, 401, { message: "Invalid API key" }), async (url) => {
      const r = await run("old-key", { SUPABASE_URL: url, OLD_KEY: "retired-key-fixture" });
      expect(r.code, r.out).toBe(0);
      expect(r.out).not.toContain("retired-key-fixture");
    });
  });

  it("fails if the old key still reads admin_users", async () => {
    await withApi((req, res) => (req.url?.includes("/admin_users") ? reply(res, 200, [{ id: "a" }]) : reply(res, 401)), async (url) => {
      const r = await run("old-key", { SUPABASE_URL: url, OLD_KEY: "retired-key-fixture" });
      expect(r.code).toBe(1);
      expect(r.out).toContain("GET admin_users is 401");
    });
  });

  it("fails if the old key can still reach a money function", async () => {
    await withApi((req, res) => (req.url?.includes("/functions/v1/process-refund") ? reply(res, 200, { ok: true }) : reply(res, 401)), async (url) => {
      const r = await run("old-key", { SUPABASE_URL: url, OLD_KEY: "retired-key-fixture" });
      expect(r.code).toBe(1);
      expect(r.out).toContain("process-refund is 401");
    });
  });

  it("checks the new secret key works for backend calls when one is supplied", async () => {
    await withApi((req, res) => (req.headers.apikey === "new-secret-fixture" ? reply(res, 200, []) : reply(res, 401)), async (url) => {
      const r = await run("old-key", { SUPABASE_URL: url, OLD_KEY: "retired-key-fixture", NEW_SECRET_KEY: "new-secret-fixture" });
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain("new secret key");
    });
  });

  it("exits 2 (cannot run) without the old key", async () => {
    expect((await run("old-key", { SUPABASE_URL: "http://127.0.0.1:1" })).code).toBe(2);
  });
});
