import { NextRequest, NextResponse } from "next/server";
import {
  API_LIMIT,
  AUTH_LIMIT,
  cleanupStores,
  getClientIp,
  rateLimit,
} from "./app/lib/rate-limit";

/**
 * Per-IP rate limiting at the platform edge (Next.js 16 proxy.ts).
 *
 * Note: the rate limiter store is in-memory per Node.js process. On a
 * single-instance Vercel deployment that's fine; if we ever scale to
 * multiple regions/instances the limit is per-instance. For multi-instance
 * enforcement, swap the store in app/lib/rate-limit.ts for Redis/Upstash.
 *
 * Limits (configured in app/lib/rate-limit.ts):
 *   - /api/admin/login : 5 attempts / 15 minutes (AUTH_LIMIT)
 *   - all other /api/* : 100 requests / minute (API_LIMIT)
 *
 * Webhook endpoints are NOT rate-limited here — they're exposed at
 * supabase/functions/* (different runtime) and rely on signature
 * verification + idempotency keys.
 */
export function proxy(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();

  const ip = getClientIp(req);
  const isAuth =
    req.nextUrl.pathname.startsWith("/api/admin/login") ||
    req.nextUrl.pathname.startsWith("/api/admin/setup-link");
  const config = isAuth ? AUTH_LIMIT : API_LIMIT;

  const result = rateLimit(config, ip);

  // Periodic cleanup to keep the in-memory store bounded.
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

// Note: Next.js 16 proxy.ts does NOT allow `export const config` (route
// segment config is rejected at build time, and proxy always runs on the
// Node.js runtime). Path filtering happens inside the function via the
// pathname check above.
