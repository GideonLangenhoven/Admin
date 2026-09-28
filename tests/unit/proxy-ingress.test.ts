import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { sourceExports, sourceHandler, sourceFunction } from "../helpers/source-handler";

const require = createRequire(import.meta.url);

class NextResponse extends Response {
  static next() { return new NextResponse(null, { status: 200 }); }
  static redirect(url: URL) { return new NextResponse(null, { status: 307, headers: { Location: url.href } }); }
  static json(body: unknown, init?: ResponseInit) { return Response.json(body, init); }
}

const production = {
  VERCEL_ENV: "production",
  VERCEL: "1",
  UPSTASH_REDIS_REST_URL: "https://redis.example.invalid",
  UPSTASH_REDIS_REST_TOKEN: "synthetic-token",
};
const productionDatabase = {
  VERCEL_ENV: "production",
  VERCEL: "1",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
};

function request(path: string, body: unknown, ip = "192.0.2.44", extraHeaders: Record<string, string> = {}) {
  const url = new URL(`https://admin.example.invalid${path}`);
  return Object.assign(new Request(url, {
    method: "POST",
    headers: { "x-forwarded-for": ip, "content-type": "application/json", ...extraHeaders },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }), { nextUrl: url });
}

function load(env: Record<string, string>, fetchImpl: typeof fetch = () => { throw new Error("Outbound network disabled"); }) {
  const exported = sourceExports("proxy.ts", { "next/server": { NextResponse } }, env, fetchImpl);
  const proxy = exported.proxy as (req: Request) => Promise<Response>;
  const auth = exported.limitAdminIngress as (req: Request) => Promise<{ blocked: Response | null }>;
  return (req: Request) => /^\/api\/admin\/(login|setup-link)$/.test(new URL(req.url).pathname)
    ? auth(req).then(({ blocked }) => blocked || NextResponse.next()) : proxy(req);
}

function redis() {
  const counters = new Map<string, { count: number; expires: number }>();
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe("https://redis.example.invalid/multi-exec");
    const commands = JSON.parse(String(init?.body));
    expect(commands.map((command: string[]) => command[0])).toEqual(["SET", "INCR", "PTTL"]);
    const key = String(commands[0][1]);
    const now = Date.now();
    let entry = counters.get(key);
    if (!entry || entry.expires <= now) entry = { count: 0, expires: now + Number(commands[0][5]) };
    entry.count++;
    counters.set(key, entry);
    return Response.json([{ result: "OK" }, { result: entry.count }, { result: entry.expires - now }]);
  }) as typeof fetch;
  return { fetchImpl, counters };
}

function database() {
  let now = 0;
  const counters = new Map<string, { count: number; expires: number }>();
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe("https://project.supabase.co/rest/v1/rpc/check_ingress_rate_limit");
    expect(new Headers(init?.headers).get("apikey")).toBe("synthetic-service-key");
    const { p_bucket, p_key_hash, p_limit, p_window_ms } = JSON.parse(String(init?.body));
    expect(p_key_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(String(init?.body)).not.toContain("example.invalid");
    expect(String(init?.body)).not.toContain("192.0.2.");
    const key = `${p_bucket}:${p_key_hash}`;
    let entry = counters.get(key);
    if (!entry || entry.expires <= now) entry = { count: 0, expires: now + p_window_ms };
    entry.count = Math.min(p_limit + 1, entry.count + 1);
    counters.set(key, entry);
    return Response.json({
      allowed: entry.count <= p_limit,
      limit: p_limit,
      remaining: Math.max(0, p_limit - entry.count),
      retry_after_ms: entry.count > p_limit ? entry.expires - now : 0,
    });
  }) as typeof fetch;
  return { fetchImpl, counters, advance: (ms: number) => { now += ms; } };
}

describe("proxy ingress limits", () => {
  it("observes a fetch rejection when the shared deadline has already expired", async () => {
    const beforeDeadline = sourceFunction("proxy.ts", "beforeDeadline", {}) as (work: Promise<unknown>, signal: AbortSignal) => Promise<unknown>;
    const controller = new AbortController();
    controller.abort();
    let rejectWork: (error: Error) => void = () => {};
    const work = new Promise<never>((_resolve, reject) => { rejectWork = reject; });
    await expect(beforeDeadline(work, controller.signal)).rejects.toThrow("deadline");
    rejectWork(new Error("late synthetic fetch failure"));
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  it("excludes only auth routes from Next proxy and retains other API coverage", () => {
    const config = sourceExports("proxy.ts", { "next/server": { NextResponse } }).config as { matcher: string[] };
    const { getMiddlewareMatchers } = require("next/dist/build/analysis/get-page-static-info");
    const [matcher] = getMiddlewareMatchers(config.matcher, {});
    const matches = (path: string) => new RegExp(matcher.regexp).test(path);
    expect(matches("/api/admin/login")).toBe(false);
    expect(matches("/api/admin/login/")).toBe(false);
    expect(matches("/api/admin/setup-link")).toBe(false);
    expect(matches("/api/admin/setup-link/")).toBe(false);
    expect(matches("/api/admin/login/extra")).toBe(true);
    expect(matches("/api/admin/setup-link/extra")).toBe(true);
    expect(matches("/api/admin/login-extra")).toBe(true);
    expect(matches("/api/admin/update")).toBe(true);
    expect(matches("/api/check-ins")).toBe(true);
    expect(matches("/settings")).toBe(true);
  });

  it("rejects production bypass, missing Redis, and missing trusted IP", async () => {
    expect((await load({ ...production, E2E_BYPASS_RATE_LIMIT: "1" })(request("/api/admin/login", { email: "a@example.invalid" }))).status).toBe(503);
    expect((await load({ VERCEL_ENV: "production", VERCEL: "1" })(request("/api/admin/login", { email: "a@example.invalid" }))).status).toBe(503);
    expect((await load({ VERCEL_ENV: "preview", NODE_ENV: "production", VERCEL: "1" })(request("/api/admin/login", { email: "a@example.invalid" }))).status).toBe(503);
    expect((await load({ ...production, UPSTASH_REDIS_REST_URL: "http://redis.example.invalid" })(request("/api/admin/login", { email: "a@example.invalid" }))).status).toBe(503);
    expect((await load(production, redis().fetchImpl)(request("/api/admin/login", { email: "a@example.invalid" }, ""))).status).toBe(503);
    expect((await load(production, redis().fetchImpl)(request("/api/admin/login", { email: "a@example.invalid" }, "", { "x-real-ip": "192.0.2.44" }))).status).toBe(503);
  });

  it("uses Netlify's handler context IP and rejects spoofed request headers", () => {
    const clientIp = (netlify: unknown, headers: Record<string, string>, env: Record<string, string> = {}, routeIp?: string | null) => {
      const getClientIp = sourceFunction("proxy.ts", "getClientIp", {
        process: { env }, Netlify: netlify,
      });
      return getClientIp({ headers: new Headers(headers) }, true, routeIp);
    };
    const spoofed = { "x-forwarded-for": "198.51.100.9", "x-nf-client-connection-ip": "198.51.100.10" };
    expect(clientIp({ context: { ip: "192.0.2.44" } }, spoofed)).toBe("192.0.2.44");
    expect(clientIp({ context: { ip: "2001:db8::1" } }, spoofed)).toBe("2001:db8::1");
    expect(clientIp(undefined, spoofed)).toBeNull();
    expect(clientIp({ context: null }, spoofed)).toBeNull();
    expect(clientIp({ context: { ip: "192.0.2.44, 198.51.100.9" } }, spoofed)).toBeNull();
    expect(clientIp({ context: { ip: "192.0.2.44" } }, { "x-vercel-forwarded-for": "203.0.113.8" }, { VERCEL: "1" })).toBeNull();
    expect(clientIp(undefined, { "x-vercel-forwarded-for": "203.0.113.8" }, { VERCEL: "1" })).toBe("203.0.113.8");
    expect(clientIp(undefined, { "x-vercel-forwarded-for": "203.0.113.8" }, { VERCEL: "1" }, "192.0.2.44")).toBeNull();
    expect(clientIp({ context: { ip: "192.0.2.44" } }, spoofed, {}, null)).toBeNull();
    expect(clientIp(undefined, spoofed, {}, "192.0.2.44")).toBe("192.0.2.44");
  });

  it("uses Netlify Functions context for login and setup-link on the Node route", async () => {
    const env = {
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
    };
    const shared = database();
    const limitAdminIngress = sourceExports("proxy.ts", { "next/server": { NextResponse } }, env, shared.fetchImpl).limitAdminIngress;
    let contextIp = "192.0.2.44";
    let contextAvailable = true;
    for (const [route, bucket] of [["login", "auth-ip"], ["setup-link", "setup-send-ip"]] as const) {
      const handler = sourceHandler(`app/api/admin/${route}/route.ts`, {
        "next/server": { NextResponse },
        "@supabase/supabase-js": { createClient: () => { throw new Error("Unexpected database call"); } },
        "@netlify/functions": { getContext: () => {
          if (!contextAvailable) throw new Error("No function request context");
          return { ip: contextIp };
        } },
        "../../../lib/api-auth": {}, "../../../lib/admin-password": {},
        "../../../../proxy": { limitAdminIngress },
      }, env);
      for (const spoofedIp of ["198.51.100.9", "198.51.100.10"]) {
        expect((await handler(request(`/api/admin/${route}`, {}, spoofedIp, {
          "x-nf-client-connection-ip": spoofedIp,
        }))).status).toBe(400);
      }
      expect([...shared.counters].filter(([key]) => key.startsWith(`${bucket}:`)).map(([, entry]) => entry.count)).toEqual([2]);
      contextAvailable = false;
      expect((await handler(request(`/api/admin/${route}`, {}, "198.51.100.9"))).status).toBe(503);
      contextAvailable = true;
      contextIp = "192.0.2.44, 198.51.100.9";
      expect((await handler(request(`/api/admin/${route}`, {}, "198.51.100.9"))).status).toBe(503);
      contextIp = "192.0.2.44";
    }
  });

  it("fails closed on a mixed Vercel marker or a development bypass with real function context", async () => {
    for (const route of ["login", "setup-link"] as const) {
      for (const env of [
        { ...productionDatabase, NODE_ENV: "production" },
        { NODE_ENV: "development", E2E_BYPASS_RATE_LIMIT: "1",
          NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key" },
      ]) {
        const limitAdminIngress = sourceExports("proxy.ts", { "next/server": { NextResponse } }, env, database().fetchImpl).limitAdminIngress;
        const handler = sourceHandler(`app/api/admin/${route}/route.ts`, {
          "next/server": { NextResponse },
          "@supabase/supabase-js": { createClient: () => { throw new Error("Unexpected database call"); } },
          "@netlify/functions": { getContext: () => ({ ip: "192.0.2.44" }) },
          "../../../lib/api-auth": {}, "../../../lib/admin-password": {},
          "../../../../proxy": { limitAdminIngress },
        }, env);
        expect((await handler(request(`/api/admin/${route}`, {}, "198.51.100.9", {
          "x-vercel-forwarded-for": "198.51.100.9",
        }))).status).toBe(503);
      }
    }
  });

  it("allows 500 distinct staff on one office IP but limits repeated guesses across instances", async () => {
    const shared = redis();
    const first = load(production, shared.fetchImpl);
    const second = load(production, shared.fetchImpl);
    for (let i = 0; i < 500; i++) {
      const proxy = i % 2 ? first : second;
      expect((await proxy(request("/api/admin/login", { email: `staff${i}@example.invalid`, password: "synthetic" }))).status).toBe(200);
    }
    for (let i = 0; i < 10; i++) {
      expect((await (i % 2 ? first : second)(request("/api/admin/login", { email: "target@example.invalid", password: "synthetic" }))).status).toBe(200);
    }
    const denied = await second(request("/api/admin/login", { email: "target@example.invalid", password: "synthetic" }));
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await denied.json()).retry_after_ms).toBeGreaterThan(0);
  }, 20_000);

  it("uses the service-only shared database when Redis is absent, with fixed first-request expiry", async () => {
    const shared = database();
    const first = load(productionDatabase, shared.fetchImpl);
    const second = load(productionDatabase, shared.fetchImpl);
    for (let i = 0; i < 5; i++) {
      expect((await (i % 2 ? first : second)(request("/api/admin/setup-link", { action: "send", email: "one@example.invalid" }))).status).toBe(200);
    }
    const denied = await second(request("/api/admin/setup-link", { action: "send", email: "one@example.invalid" }));
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Retry-After")).toBe("900");
    expect((await first(request("/api/admin/setup-link", { action: "send", email: "two@example.invalid" }))).status).toBe(200);
    shared.advance(60_000);
    expect((await first(request("/api/admin/setup-link", { action: "send", email: "one@example.invalid" }))).headers.get("Retry-After")).toBe("840");
    shared.advance(840_000);
    expect((await first(request("/api/admin/setup-link", { action: "send", email: "one@example.invalid" }))).status).toBe(200);
  });

  it("fails closed on database outage, invalid results, and partial Redis configuration", async () => {
    const body = { email: "staff@example.invalid" };
    expect((await load(productionDatabase, async () => { throw new Error("synthetic outage"); })(request("/api/admin/login", body))).status).toBe(503);
    expect((await load(productionDatabase, async () => Response.json({ allowed: true, limit: 10, remaining: 999, retry_after_ms: 0 }))(request("/api/admin/login", body))).status).toBe(503);
    expect((await load({ ...productionDatabase, UPSTASH_REDIS_REST_URL: "http://redis.example.invalid" }, database().fetchImpl)(request("/api/admin/login", body))).status).toBe(503);
  });

  it("does not allocate input buckets after the shared IP bucket denies", async () => {
    const buckets: string[] = [];
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      buckets.push(body.p_bucket);
      return Response.json({ allowed: false, limit: 1200, remaining: 0, retry_after_ms: 900000 });
    }) as typeof fetch;
    const proxy = load(productionDatabase, fetchImpl);
    for (let i = 0; i < 5; i++) {
      expect((await proxy(request("/api/admin/login", { email: `rotating${i}@example.invalid` }))).status).toBe(429);
    }
    expect(buckets).toEqual(Array(5).fill("auth-ip"));
  });

  it("buckets coerced JSON-array email through the actual login handler", async () => {
    const shared = redis();
    const limitAdminIngress = sourceExports("proxy.ts", { "next/server": { NextResponse } }, production, shared.fetchImpl).limitAdminIngress;
    const lookups: string[] = [];
    const query: any = {
      select: () => query,
      eq: (_column: string, value: string) => { lookups.push(value); return query; },
      maybeSingle: async () => ({ data: null, error: null }),
    };
    const login = sourceHandler("app/api/admin/login/route.ts", {
      "next/server": { NextResponse },
      "@supabase/supabase-js": { createClient: () => ({ from: () => query }) },
      "../../../lib/admin-password": { setAdminAuthPassword: () => { throw new Error("Unexpected auth write"); } },
      "../../../../proxy": { limitAdminIngress },
    }, production);
    for (let i = 0; i < 10; i++) {
      expect((await login(request("/api/admin/login", { email: ["staff@example.invalid"], password: "synthetic-invalid" }))).status).toBe(401);
    }
    const denied = await login(request("/api/admin/login", { email: ["staff@example.invalid"], password: "synthetic-invalid" }));
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Retry-After")).toBeTruthy();
    expect(lookups).toEqual(Array(10).fill("staff@example.invalid"));
    expect([...shared.counters.keys()].filter(key => key.includes("auth-input"))).toHaveLength(1);
  });

  it("keeps malformed setup-link email under the coarse IP bucket and route validation", async () => {
    const shared = redis();
    const limitAdminIngress = sourceExports("proxy.ts", { "next/server": { NextResponse } }, production, shared.fetchImpl).limitAdminIngress;
    const setup = sourceHandler("app/api/admin/setup-link/route.ts", {
      "next/server": { NextResponse },
      "@supabase/supabase-js": { createClient: () => { throw new Error("Unexpected database call"); } },
      "../../../lib/api-auth": {}, "../../../lib/admin-password": {},
      "../../../../proxy": { limitAdminIngress },
    }, production);
    const response = await setup(request("/api/admin/setup-link", {
      action: "send", reason: "RESET", email: { toString: null },
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid setup-link request" });
    expect([...shared.counters.keys()].filter(key => key.includes("setup-send-ip"))).toHaveLength(1);
    expect([...shared.counters.keys()].filter(key => key.includes("setup-send-input"))).toHaveLength(0);
  });

  it("closes blocked auth responses without changing their status, body, or retry header", async () => {
    for (const route of ["login", "setup-link"] as const) {
      for (const status of [408, 413, 429, 503]) {
        const blocked = Response.json({ error: "synthetic denial" }, { status, headers: { "Retry-After": "7" } });
        const handler = sourceHandler(`app/api/admin/${route}/route.ts`, {
          "next/server": { NextResponse, after: () => { throw new Error("Unexpected background work"); } },
          "@supabase/supabase-js": { createClient: () => { throw new Error("Unexpected database call"); } },
          "../../../lib/api-auth": {}, "../../../lib/admin-password": {},
          "../../../../proxy": { limitAdminIngress: async () => ({ blocked, raw: "" }) },
        }, production);
        const response = await handler(request(`/api/admin/${route}`, { email: "staff@example.invalid" }));
        expect(response.status).toBe(status);
        expect(response.headers.get("Connection")).toBe("close");
        expect(response.headers.get("Retry-After")).toBe("7");
        expect(await response.json()).toEqual({ error: "synthetic denial" });
      }
    }
  });

  it("admits the BT500 shared-origin spike even when every Admin write retries", async () => {
    // 100 actions/s peak × 20% Admin writes × 2 check-in attempts × 60s.
    const proxy = load(production, redis().fetchImpl);
    for (let i = 0; i < 2_400; i++) {
      expect((await proxy(request("/api/check-ins?source=simple-view", { client_event_id: `synthetic-${i}` }))).status).toBe(200);
    }
  }, 20_000);

  it("keeps reset send pressure separate from another account and token completion", async () => {
    const proxy = load(production, redis().fetchImpl);
    for (let i = 0; i < 5; i++) {
      expect((await proxy(request("/api/admin/setup-link", { action: "send", reason: "RESET", email: "one@example.invalid" }))).status).toBe(200);
    }
    expect((await proxy(request("/api/admin/setup-link", { action: "send", reason: "RESET", email: "one@example.invalid" }))).status).toBe(429);
    expect((await proxy(request("/api/admin/setup-link", { action: "send", reason: "RESET", email: "two@example.invalid" }))).status).toBe(200);
    expect((await proxy(request("/api/admin/setup-link", { action: "complete", email: "one@example.invalid", token: "synthetic" }))).status).toBe(200);
  });

  it("fails closed on Redis outage and reaches its request deadline", async () => {
    expect((await load(production, async () => { throw new Error("synthetic outage"); })(request("/api/admin/login", { email: "a@example.invalid" }))).status).toBe(503);
    const stalled = (async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      if (!init?.signal) return reject(new Error("missing deadline"));
      init.signal.addEventListener("abort", () => reject(new Error("synthetic timeout")), { once: true });
    })) as typeof fetch;
    const start = Date.now();
    const result = await Promise.race([
      load(production, stalled)(request("/api/admin/login", { email: "a@example.invalid" })),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("proxy did not finish")), 3_000)),
    ]);
    expect(result.status).toBe(503);
    expect(Date.now() - start).toBeLessThan(2_500);
  }, 5_000);

  it("bounds actual request and Redis response bytes", async () => {
    const proxy = load(production, redis().fetchImpl);
    expect((await proxy(request("/api/admin/setup-link", { action: "send", email: "a@example.invalid", padding: "x".repeat(20_000) }, "192.0.2.61", { "content-length": "5" }))).status).toBe(413);
    const oversized = (async () => Response.json([{ result: "OK" }, { result: 1 }, { result: 60_000 }, { padding: "x".repeat(20_000) }])) as typeof fetch;
    expect((await load(production, oversized)(request("/api/admin/login", { email: "a@example.invalid" }))).status).toBe(503);
  });

  it("stops waiting for a stalled classification body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const url = new URL("https://admin.example.invalid/api/admin/setup-link");
    const req = Object.assign(new Request(url, {
      method: "POST",
      headers: { "x-forwarded-for": "192.0.2.66" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" }), { nextUrl: url });
    const result = await Promise.race([
      load(production, redis().fetchImpl)(req),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("body deadline missing")), 3_000)),
    ]);
    expect(result.status).toBe(408);
    expect(cancelled).toBe(true);
  }, 5_000);

  it("lets an actual Next Node route finish a stalled auth body at its deadline", async () => {
    const { NodeNextRequest } = require("next/dist/server/base-http/node");
    const { NextRequestAdapter } = require("next/dist/server/web/spec-extension/adapters/next-request");
    const input = new PassThrough() as PassThrough & { method: string; url: string; headers: Record<string, string> };
    input.method = "POST";
    input.url = "https://admin.example.invalid/api/admin/setup-link";
    input.headers = { "x-forwarded-for": "192.0.2.66", "content-type": "application/json" };
    const req = NextRequestAdapter.fromNodeNextRequest(new NodeNextRequest(input), new AbortController().signal);
    const limitAdminIngress = sourceExports("proxy.ts", { "next/server": { NextResponse } }, production, redis().fetchImpl).limitAdminIngress;
    const setup = sourceHandler("app/api/admin/setup-link/route.ts", {
      "next/server": { NextResponse, after: () => { throw new Error("Unexpected background work"); } },
      "@supabase/supabase-js": { createClient: () => { throw new Error("Unexpected database call"); } },
      "../../../lib/api-auth": {}, "../../../lib/admin-password": {},
      "../../../../proxy": { limitAdminIngress },
    }, production);
    const started = Date.now();
    try {
      const response = await Promise.race([
        setup(req),
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("route deadline missing")), 3_000)),
      ]);
      expect(response.status).toBe(408);
      expect(response.headers.get("Connection")).toBe("close");
      expect(Date.now() - started).toBeLessThan(2_500);
      expect(input.readableEnded).toBe(false);
    } finally {
      input.destroy();
    }
  }, 5_000);
});
