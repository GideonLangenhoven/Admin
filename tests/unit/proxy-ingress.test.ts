import { describe, expect, it } from "vitest";
import { sourceExports } from "../helpers/source-handler";

class NextResponse extends Response {
  static next() { return new NextResponse(null, { status: 200 }); }
  static redirect(url: URL) { return new NextResponse(null, { status: 307, headers: { Location: url.href } }); }
}

const production = {
  VERCEL_ENV: "production",
  VERCEL: "1",
  UPSTASH_REDIS_REST_URL: "https://redis.example.invalid",
  UPSTASH_REDIS_REST_TOKEN: "synthetic-token",
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
  return sourceExports("proxy.ts", { "next/server": { NextResponse } }, env, fetchImpl).proxy as (req: Request) => Promise<Response>;
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

describe("proxy ingress limits", () => {
  it("rejects production bypass, missing Redis, and missing trusted IP", async () => {
    expect((await load({ ...production, E2E_BYPASS_RATE_LIMIT: "1" })(request("/api/admin/login", { email: "a@example.invalid" }))).status).toBe(503);
    expect((await load({ VERCEL_ENV: "production", VERCEL: "1" })(request("/api/admin/login", { email: "a@example.invalid" }))).status).toBe(503);
    expect((await load({ VERCEL_ENV: "preview", NODE_ENV: "production", VERCEL: "1" })(request("/api/admin/login", { email: "a@example.invalid" }))).status).toBe(503);
    expect((await load({ ...production, UPSTASH_REDIS_REST_URL: "http://redis.example.invalid" })(request("/api/admin/login", { email: "a@example.invalid" }))).status).toBe(503);
    expect((await load(production, redis().fetchImpl)(request("/api/admin/login", { email: "a@example.invalid" }, ""))).status).toBe(503);
    expect((await load(production, redis().fetchImpl)(request("/api/admin/login", { email: "a@example.invalid" }, "", { "x-real-ip": "192.0.2.44" }))).status).toBe(503);
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
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
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
    controller!.close();
    expect(result.status).toBe(408);
  }, 5_000);
});
