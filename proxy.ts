import { NextRequest, NextResponse } from "next/server";

/**
 * Per-IP rate limiting at the platform edge (Next.js 16 proxy.ts).
 *
 * The rate-limit logic is inlined here because Next 16's bundler
 * compiles proxy.ts in an isolated context that cannot resolve imports
 * out of the `app/` directory. Keeping the implementation small and
 * self-contained avoids any cross-bundle resolution issues.
 *
 * Note: the store is in-memory per Node.js process. On a single-instance
 * Vercel deployment that's fine; if we ever scale to multiple regions/
 * instances the limit is per-instance. For multi-instance enforcement,
 * swap the in-memory Map for Redis/Upstash.
 *
 * Limits:
 *   - /api/admin/login + /api/admin/setup-link : 5 attempts / 15 minutes
 *   - all other /api/*                         : 100 requests / minute
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

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "127.0.0.1";
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

const API_LIMIT: RateLimitConfig = { name: "api", limit: 100, windowMs: 60_000 };
const AUTH_LIMIT: RateLimitConfig = { name: "auth", limit: 5, windowMs: 15 * 60_000 };

export function proxy(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();

  const ip = getClientIp(req);
  const isAuth =
    req.nextUrl.pathname.startsWith("/api/admin/login") ||
    req.nextUrl.pathname.startsWith("/api/admin/setup-link");
  const config = isAuth ? AUTH_LIMIT : API_LIMIT;

  const result = rateLimit(config, ip);
  cleanupStores(Math.max(API_LIMIT.windowMs, AUTH_LIMIT.windowMs));

  if (!result.allowed) {
    return new NextResponse(
      JSON.stringify({
        error: "Too many requests",
        retry_after_ms: result.retryAfterMs,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil(result.retryAfterMs / 1000)),
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
