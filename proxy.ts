import { NextRequest, NextResponse } from "next/server";

/**
 * API rate limiting at the platform edge (Next.js 16 proxy.ts).
 *
 * The rate-limit logic is inlined here because Next 16's bundler
 * compiles proxy.ts in an isolated context that cannot resolve imports
 * out of the `app/` directory. Keeping the implementation small and
 * self-contained avoids any cross-bundle resolution issues.
 *
 * The in-memory store is for local development only. Deployed requests
 * require Redis, and an unavailable limiter rejects API traffic.
 *
 * Webhook endpoints live at supabase/functions/* (different runtime)
 * and rely on signature verification + idempotency keys, not this.
 */

interface SlidingWindowEntry {
  timestamps: number[];
}

const STORE_KEY = Symbol.for("ck_rate_limit_proxy_stores");
type StoreMap = Map<string, Map<string, SlidingWindowEntry>>;

function getStores(): StoreMap {
  const g = globalThis as unknown as Record<symbol, StoreMap>;
  if (!g[STORE_KEY]) g[STORE_KEY] = new Map();
  return g[STORE_KEY];
}

function getStore(name: string): Map<string, SlidingWindowEntry> {
  const stores = getStores();
  let s = stores.get(name);
  if (!s) {
    s = new Map();
    stores.set(name, s);
  }
  return s;
}

interface RateLimitConfig {
  name: string;
  limit: number;
  windowMs: number;
}

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterMs: number;
}

const BODY_BYTES = 8 * 1024;
const REDIS_BYTES = 4 * 1024;
const LIMITER_DEADLINE_MS = 1_500;
let lastLimiterError = "";

function unavailable(reason: string): NextResponse {
  if (lastLimiterError !== reason) console.error("RATE_LIMIT_UNAVAILABLE:", reason);
  lastLimiterError = reason;
  return new NextResponse(JSON.stringify({ error: "Rate limiting temporarily unavailable" }), {
    status: 503,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Retry-After": "2" },
  });
}

async function beforeDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("deadline");
  let onAbort = () => {};
  const timedOut = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error("deadline"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work, timedOut]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function readBounded(body: ReadableStream<Uint8Array> | null, maxBytes: number, signal: AbortSignal): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await beforeDeadline(reader.read(), signal);
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("body_too_large");
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    if (bytes > maxBytes || signal.aborted) void reader.cancel().catch(() => {});
  }
}

function rateLimit(config: RateLimitConfig, key: string): RateLimitResult {
  const store = getStore(config.name);
  const now = Date.now();
  const cutoff = now - config.windowMs;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= config.limit) {
    const retryAfterMs = entry.timestamps[0] + config.windowMs - now;
    return {
      allowed: false,
      limit: config.limit,
      remaining: 0,
      retryAfterMs: Math.max(0, retryAfterMs),
    };
  }

  entry.timestamps.push(now);
  return {
    allowed: true,
    limit: config.limit,
    remaining: config.limit - entry.timestamps.length,
    retryAfterMs: 0,
  };
}

async function distributedRateLimit(config: RateLimitConfig, key: string, url: string, token: string): Promise<RateLimitResult> {
  const redisKey = `ck:rl:${config.name}:${key}`;
  const signal = AbortSignal.timeout(LIMITER_DEADLINE_MS);
  const res = await beforeDeadline(fetch(`${url}/multi-exec`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["SET", redisKey, "0", "NX", "PX", config.windowMs],
      ["INCR", redisKey],
      ["PTTL", redisKey],
    ]),
    cache: "no-store",
    signal,
  }), signal);

  if (!res.ok) throw new Error(`Redis rate limit failed: ${res.status}`);
  const results = JSON.parse(await readBounded(res.body, REDIS_BYTES, signal));
  const rawCount = results?.[1]?.result;
  const rawTtl = results?.[2]?.result;
  const count = Number(rawCount);
  const ttl = Number(rawTtl);
  if (!Array.isArray(results) || results.length !== 3 || !Number.isSafeInteger(count) || count <= 0 ||
      rawTtl == null || !Number.isSafeInteger(ttl) || ttl < 0 || ttl > config.windowMs) {
    throw new Error("Redis rate limit returned invalid result");
  }

  return {
    allowed: count <= config.limit,
    limit: config.limit,
    remaining: Math.max(0, config.limit - count),
    retryAfterMs: count > config.limit ? Math.max(0, ttl) : 0,
  };
}

function getClientIp(req: NextRequest, deployed: boolean): string | null {
  if (deployed && process.env.VERCEL !== "1") return null;
  const ip = (req.headers.get("x-vercel-forwarded-for") || req.headers.get("x-forwarded-for") || "").trim();
  if (!ip || ip.length > 45 || !/^[0-9a-fA-F:.]+$/.test(ip)) return deployed ? null : "local";
  return ip;
}

let lastCleanup = 0;

function cleanupStores(maxWindowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  getStores().forEach((store) => {
    store.forEach((entry, key) => {
      entry.timestamps = entry.timestamps.filter((t) => t > now - maxWindowMs);
      if (entry.timestamps.length === 0) store.delete(key);
    });
  });
}

const API_LIMIT: RateLimitConfig = { name: "api-ip", limit: 4_000, windowMs: 60_000 };
const AUTH_IP_LIMIT: RateLimitConfig = { name: "auth-ip", limit: 1_200, windowMs: 15 * 60_000 };
const AUTH_INPUT_LIMIT: RateLimitConfig = { name: "auth-input", limit: 10, windowMs: 15 * 60_000 };
const TOKEN_IP_LIMIT: RateLimitConfig = { name: "setup-token-ip", limit: 1_200, windowMs: 15 * 60_000 };
const TOKEN_INPUT_LIMIT: RateLimitConfig = { name: "setup-token-input", limit: 10, windowMs: 15 * 60_000 };
const SEND_IP_LIMIT: RateLimitConfig = { name: "setup-send-ip", limit: 300, windowMs: 15 * 60_000 };
const SEND_INPUT_LIMIT: RateLimitConfig = { name: "setup-send-input", limit: 5, windowMs: 15 * 60_000 };

async function inputKey(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Page-level role gating (advisory UX, NOT a security boundary).
 *
 * Reads the ck_admin_role cookie set by components/AuthGate.tsx and redirects
 * unauthorised callers away from privileged pages so they don't render empty
 * scaffolding before the API gates kick in.
 *
 * The actual security boundary is the per-route auth check in app/lib/api-auth.ts —
 * a forged cookie buys nothing, because every privileged API call validates the
 * Supabase access token + admin_users.role server-side. This gate exists only to
 * spare OPERATOR users a confusing UX (loading skeleton → empty page → "why?").
 *
 * Cookie may be absent on legitimate flows (just logged in for the first time,
 * change-password, marketing pages). When absent, fall through and let AuthGate
 * handle it client-side.
 */

type RoleRequirement = "SUPER_ADMIN_ONLY" | "PRIVILEGED";

const PAGE_GATES: Array<{ pattern: RegExp; requirement: RoleRequirement }> = [
  { pattern: /^\/super-admin(\/|$)/, requirement: "SUPER_ADMIN_ONLY" },
  { pattern: /^\/ota-drift(\/|$)/, requirement: "SUPER_ADMIN_ONLY" },
  { pattern: /^\/billing(\/|$)/, requirement: "PRIVILEGED" },
  // NOTE: /settings is deliberately NOT gated here. Regular ADMINs can be
  // granted per-section settings_permissions (stored in DB/localStorage, not
  // readable from this cookie), and AppShell shows them the Settings link.
  // The page renders its own "no permission" state for everyone else.
  { pattern: /^\/privacy\/data-requests(\/|$)/, requirement: "PRIVILEGED" },
  { pattern: /^\/partnerships(\/|$)/, requirement: "PRIVILEGED" },
];

// MVP: temporarily hidden routes. Direct URL access redirects to `/`.
// To re-enable: remove the entry here AND uncomment the matching nav line
// in app/layout.tsx.
const HIDDEN_FOR_MVP: RegExp[] = [
  /^\/settings\/ota(\/|$)/,
  /^\/ota-drift(\/|$)/,
];

function checkMvpHidden(req: NextRequest): NextResponse | null {
  if (!HIDDEN_FOR_MVP.some((p) => p.test(req.nextUrl.pathname))) return null;
  if (req.nextUrl.pathname.startsWith("/settings/ota") && req.cookies.get("ck_demo_read_only")?.value === "1") return null;
  const url = req.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  return NextResponse.redirect(url);
}

function checkPageRoleGate(req: NextRequest): NextResponse | null {
  const pathname = req.nextUrl.pathname;
  const gate = PAGE_GATES.find((g) => g.pattern.test(pathname));
  if (!gate) return null;

  const role = req.cookies.get("ck_admin_role")?.value;
  if (!role) return null;

  const allowed =
    gate.requirement === "SUPER_ADMIN_ONLY"
      ? role === "SUPER_ADMIN"
      : role === "MAIN_ADMIN" || role === "SUPER_ADMIN";

  if (allowed) return null;

  const url = req.nextUrl.clone();
  url.pathname = "/";
  url.search = "?denied=1";
  return NextResponse.redirect(url);
}

async function checkRequest(req: NextRequest, parsedBody?: Record<string, unknown>) {
  const mvpHidden = checkMvpHidden(req);
  if (mvpHidden) return mvpHidden;

  const pageGate = checkPageRoleGate(req);
  if (pageGate) return pageGate;

  if (!req.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
  const deployed = process.env.VERCEL === "1" || process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview";
  if (deployed && process.env.E2E_BYPASS_RATE_LIMIT && process.env.E2E_BYPASS_RATE_LIMIT !== "0") {
    return unavailable("production rate-limit bypass configured");
  }
  if (!deployed && process.env.E2E_BYPASS_RATE_LIMIT === "1") return NextResponse.next();

  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || "";
  let redisUrl = "";
  try {
    const url = new URL(process.env.UPSTASH_REDIS_REST_URL || "");
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("invalid Redis URL");
    }
    redisUrl = url.origin;
  } catch { /* missing or invalid configuration is handled below */ }
  if (deployed && (!redisUrl || !token)) return unavailable("valid HTTPS Redis URL and token required");

  const ip = getClientIp(req, deployed);
  if (!ip) return unavailable("trusted Vercel client IP required");

  const isLogin = req.nextUrl.pathname === "/api/admin/login";
  const isSetupLink = req.nextUrl.pathname === "/api/admin/setup-link";
  let payload: Record<string, unknown> = parsedBody || {};
  if (parsedBody === undefined && (isLogin || isSetupLink) && req.method === "POST") {
    if (Number(req.headers.get("content-length")) > BODY_BYTES) {
      return new NextResponse(JSON.stringify({ error: "Request body too large" }), { status: 413, headers: { "Content-Type": "application/json" } });
    }
    try {
      const raw = await readBounded(req.clone().body, BODY_BYTES, AbortSignal.timeout(LIMITER_DEADLINE_MS));
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed;
    } catch (error) {
      if (error instanceof Error && error.message === "body_too_large") {
        return new NextResponse(JSON.stringify({ error: "Request body too large" }), { status: 413, headers: { "Content-Type": "application/json" } });
      }
      if (error instanceof Error && error.message === "deadline") {
        return new NextResponse(JSON.stringify({ error: "Request body timed out" }), { status: 408, headers: { "Content-Type": "application/json" } });
      }
      // Malformed JSON still consumes the route's IP bucket.
    }
  }

  // The login and setup-link routes coerce these fields with String(...).
  // Match that behavior so a one-element JSON array cannot evade its bucket.
  const email = String(payload.email || "").trim().toLowerCase();
  const validEmail = email.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(email) ? email : "";
  const secret = token || "local-only";
  const buckets: Array<[RateLimitConfig, string]> = [];
  if (isLogin) {
    buckets.push([AUTH_IP_LIMIT, ip]);
    if (validEmail) buckets.push([AUTH_INPUT_LIMIT, `${ip}:${await inputKey(validEmail, secret)}`]);
  } else if (isSetupLink && (payload.action === "validate" || payload.action === "complete")) {
    buckets.push([TOKEN_IP_LIMIT, ip]);
    const setupToken = String(payload.token || "");
    const boundedToken = setupToken.length <= 256 ? setupToken : "";
    if (boundedToken) buckets.push([TOKEN_INPUT_LIMIT, `${ip}:${await inputKey(boundedToken, secret)}`]);
  } else if (isSetupLink) {
    buckets.push([SEND_IP_LIMIT, ip]);
    const adminId = typeof payload.admin_id === "string" && payload.admin_id.length <= 128 ? payload.admin_id : "";
    const target = validEmail || adminId;
    if (target) buckets.push([SEND_INPUT_LIMIT, `${ip}:${await inputKey(target, secret)}`]);
  } else {
    buckets.push([API_LIMIT, ip]);
  }

  let results: RateLimitResult[];
  try {
    if (redisUrl && token) {
      results = await Promise.all(buckets.map(([config, key]) => distributedRateLimit(config, key, redisUrl, token)));
    } else {
      results = buckets.map(([config, key]) => rateLimit(config, key));
    }
  } catch {
    if (deployed) return unavailable("Redis request failed, timed out, or returned an invalid result");
    results = buckets.map(([config, key]) => rateLimit(config, key));
  }
  if (!deployed) cleanupStores(Math.max(API_LIMIT.windowMs, AUTH_IP_LIMIT.windowMs));

  const denied = results.filter((candidate) => !candidate.allowed);
  const result = denied.length
    ? denied.reduce((a, b) => a.retryAfterMs >= b.retryAfterMs ? a : b)
    : results.reduce((a, b) => a.remaining <= b.remaining ? a : b);

  if (!result.allowed) {
    return new NextResponse(
      JSON.stringify({
        error: "Too many requests",
        retry_after_ms: Math.max(1, result.retryAfterMs),
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))),
          "Cache-Control": "no-store",
          "X-RateLimit-Limit": String(result.limit),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  const res = NextResponse.next();
  res.headers.set("X-RateLimit-Limit", String(result.limit));
  res.headers.set("X-RateLimit-Remaining", String(result.remaining));
  return res;
}

export async function proxy(req: NextRequest) {
  return checkRequest(req);
}

// Next's Node proxy adapter waits for the original POST body to end during
// finalize(), even after this guard returns 408. These two routes call the
// same guard inside their route handler, where the response can finish at the
// body deadline. The matcher keeps every other path under proxy coverage.
export async function limitAdminIngress(req: NextRequest): Promise<{ blocked: NextResponse | null; raw: string }> {
  if (Number(req.headers.get("content-length")) > BODY_BYTES) {
    void req.body?.cancel().catch(() => {});
    return { blocked: new NextResponse(JSON.stringify({ error: "Request body too large" }), { status: 413, headers: { "Content-Type": "application/json" } }), raw: "" };
  }
  let raw = "";
  try {
    raw = await readBounded(req.body, BODY_BYTES, AbortSignal.timeout(LIMITER_DEADLINE_MS));
  } catch (error) {
    if (error instanceof Error && error.message === "body_too_large") {
      return { blocked: new NextResponse(JSON.stringify({ error: "Request body too large" }), { status: 413, headers: { "Content-Type": "application/json" } }), raw: "" };
    }
    return { blocked: new NextResponse(JSON.stringify({ error: "Request body timed out" }), { status: 408, headers: { "Content-Type": "application/json" } }), raw: "" };
  }
  let parsed: Record<string, unknown> = {};
  try {
    const body = JSON.parse(raw);
    if (body && typeof body === "object" && !Array.isArray(body)) parsed = body;
  } catch { /* malformed JSON still consumes the route's IP bucket */ }
  const decision = await checkRequest(req, parsed);
  return { blocked: decision.status === 200 ? null : decision, raw };
}

export const config = {
  matcher: ["/((?!api/admin/(?:login|setup-link)(?:/|$)).*)"],
};
