/**
 * In-memory sliding-window rate limiter.
 *
 * Used by middleware.ts to enforce per-IP request limits on all endpoints.
 * For multi-instance deployments, replace the in-memory store with Redis.
 */

interface SlidingWindowEntry {
  timestamps: number[];
}

// globalThis ensures the store survives hot reloads in dev and is shared
// across middleware + API routes in the same Node.js process.
const STORE_KEY = Symbol.for("ck_rate_limit_stores");
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

/* ── Config & result types ── */

export interface RateLimitConfig {
  name: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterMs: number;
}

/* ── Core ── */

export function rateLimit(config: RateLimitConfig, key: string): RateLimitResult {
  const store = getStore(config.name);
  const now = Date.now();
  const cutoff = now - config.windowMs;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Prune timestamps outside the current window
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

/* ── Helpers ── */

export function getClientIp(req: { headers: { get(name: string): string | null } }): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "127.0.0.1";
}

/** Evict expired entries from all stores. Called periodically from middleware. */
let lastCleanup = 0;

export function cleanupStores(maxWindowMs: number) {
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

/* ── Pre-configured limiters ── */

/** All API routes: 100 requests per minute per IP */
export const API_LIMIT: RateLimitConfig = {
  name: "api",
  limit: 100,
  windowMs: 60_000,
};

/** Login / auth routes: 5 attempts per 15 minutes per IP */
export const AUTH_LIMIT: RateLimitConfig = {
  name: "auth",
  limit: 5,
  windowMs: 15 * 60_000,
};
