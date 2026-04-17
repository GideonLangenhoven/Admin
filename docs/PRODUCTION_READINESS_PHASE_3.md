# Production-Readiness Review — Phase 3: Performance & Infrastructure

**Review target:** BookingTours platform (4 apps, shared Supabase eu-west-3 Paris)
**Reviewer:** Claude (Opus 4.7)
**Date:** 2026-04-17
**Environment:** production Supabase (via MCP with EXPLAIN ANALYZE), production DNS and HTTPS endpoints (via curl from reviewer's machine, likely EU network).
**Status:** Phase 3 complete. Contains **two additional P0 infrastructure findings** unrelated to the Phase 2 RLS P0.

Prior phases: `docs/PRODUCTION_READINESS_PHASE_1.md`, `docs/PRODUCTION_READINESS_PHASE_2.md`.

---

## 0. URGENT — two new P0s, domain-layer

During the performance sweep I discovered two production-infrastructure failures:

### P0-3. `admin.bookingtours.co.za` is not attached to any deployment

```
$ curl -sI https://admin.bookingtours.co.za/
HTTP/2 404
x-vercel-error: DEPLOYMENT_NOT_FOUND
```

Vercel DNS is pointing at the right edge (`216.198.79.65`, `64.29.17.1` — Vercel IPs), but the custom domain is bound to no project. The underlying deployment `caepweb-admin.vercel.app` **does work** (200 OK, serves the admin app HTML). So the admin dashboard is alive, but not reachable at the URL operators are told to use.

Impact:

- Every operator who clicks "admin dashboard" in the onboarding welcome email lands on a Vercel 404.
- The same email hardcodes `ADMIN_DASHBOARD_URL` from an env var. If that var was set to `https://admin.bookingtours.co.za`, every onboarded operator currently has a broken login flow.
- The Phase 1 architecture diagram named `admin.bookingtours.co.za` as the admin home. It isn't today.

**Fix:** in Vercel project settings for `caepweb-admin`, re-add `admin.bookingtours.co.za` as a custom domain. 2 minutes. Then re-verify SSL certs are issued.

### P0-4. `book.capekayak.co.za` is hardcoded as the default manage-bookings URL but does not respond

```
$ curl --max-time 10 -s -o /dev/null -w "%{http_code}\n" https://book.capekayak.co.za/
000
$ dig +short book.capekayak.co.za
15.197.225.128
3.33.251.168    ← AWS Global Accelerator, not Vercel
```

The DNS A records for `book.capekayak.co.za` point at old AWS IPs (not the Vercel IPs the rest of the platform uses). The host accepts TCP but never returns an HTTP response, so browsers and curl both sit on a dead connection.

Meanwhile, the admin code has this default:

```ts
// app/broadcasts/page.tsx:28, 51
useState("https://book.capekayak.co.za/my-bookings");
// app/photos/page.tsx:22, 146
useState("https://book.capekayak.co.za");
```

Any operator using the "manage bookings" URL in their email templates or broadcasts without overriding it in settings is sending customers to a dead link.

However: the Cape Kayak tenant's actual `businesses.booking_site_url` in the database is `https://aonyx.booking.bookingtours.co.za`, and that URL **does work** (200 OK, Vercel-hosted). Customers who click the correct URL can book; customers who follow `book.capekayak.co.za` from any legacy email, SMS, or hardcoded link cannot.

**Fix:** either (a) rebind `book.capekayak.co.za` DNS to Vercel and attach it to the `booking` project as an alias for Cape Kayak's tenant, or (b) remove the hardcoded default in `broadcasts/page.tsx:28,51` and `photos/page.tsx:22,146` and force operators to configure the URL in Settings. Option (a) is faster and non-breaking; I'd do (a) today and (b) in the next sprint.

These two are not as bad as the Phase 2 RLS P0 (that one actively leaks customer data), but together they mean two of the four "advertised" front doors into the platform don't actually open.

---

## 1. Executive summary

| Benchmark dimension | Target | Measured | Verdict |
|---|---|---|---|
| DNS + TLS + TTFB, landing cold | < 2s | 0.84s | **PASS** |
| DNS + TLS + TTFB, landing warm (CDN hit) | < 0.5s | 0.046s | **PASS** |
| DNS + TLS + TTFB, onboarding cold | < 2s | 1.00s | **PASS** |
| DNS + TLS + TTFB, onboarding warm | < 0.5s | 0.315s | **PASS** |
| Admin home reachable | must work | DEPLOYMENT_NOT_FOUND at public URL | **FAIL (P0-3)** |
| Customer booking URL reachable (real tenant) | must work | 200 on `aonyx.booking.bookingtours.co.za` | PASS on real URL |
| Customer booking URL, hardcoded `book.capekayak.co.za` | must work | connection hangs | **FAIL (P0-4)** |
| Supabase REST round-trip | < 500ms p50 | 55–90ms warm, 311ms cold | **PASS** |
| Slot availability query (60-day window) | < 500ms | 8.5ms | **PASS** (massive headroom) |
| Dashboard manifest (today's bookings) | < 500ms | 4.9ms | **PASS** (but uses seq scan) |
| Hold-expiry cron query | < 1000ms | 0.08ms | **PASS** |
| Outbox drain query | < 500ms | 0.14ms | **PASS** |
| Concurrent DB connections in use | < 70% of pool | ~15 / (Free ceiling) | **PASS** (currently) |
| Core Web Vitals (Lighthouse) | green | not run (lighthouse not installed) | DEFERRED |
| Core Web Vitals real-user | N/A | no RUM configured | DEFERRED |
| Concurrent load test (10 operators + 5 customers) | not tested | not tested | DEFERRED |

Phase 3 yields two P0s tied to domain routing, no P0s in DB performance (good — the database itself is healthy and has headroom), and a handful of P2s around index coverage, hardcoded URLs, and regional latency to South African customers.

---

## 2. Network & domain reachability

All measurements from the reviewer's machine (likely EU network), two runs each, cold then warm.

### 2.1 Reachability matrix

| URL | Status | TTFB cold | TTFB warm | Size | Notes |
|---|---|---|---|---|---|
| `https://bookingtours.co.za/` | 200 | 842ms | 36ms | 105.5 KB | Firebase, very well-cached |
| `https://onboarding.bookingtours.co.za/` | 200 | 1004ms | 315ms | 7.2 KB | Vercel SSR shell; first load does actual work |
| `https://admin.bookingtours.co.za/` | **404** | n/a | n/a | 107 B | `DEPLOYMENT_NOT_FOUND` — **P0-3** |
| `https://caepweb-admin.vercel.app/` | 200 | n/a | n/a | — | The actual working admin URL |
| `https://aonyx.booking.bookingtours.co.za/` | 200 | n/a | CDN cached (age 727566s ≈ 8d) | — | Cape Kayak real customer URL |
| `https://atlantic.booking.bookingtours.co.za/` | 200 | n/a | 0s (CDN fresh) | — | Atlantic Skydive real URL |
| `https://booking.bookingtours.co.za/` | **404** | n/a | n/a | 107 B | `DEPLOYMENT_NOT_FOUND` — root domain not attached, but wildcard subdomains work. Benign if no one hits the root. |
| `https://book.capekayak.co.za/` | **000** | n/a | n/a | — | No HTTP response. DNS → AWS IPs. **P0-4** |
| `https://capekayak.co.za/` | 301 → 405 | 900ms | n/a | 64 B | Redirects to something that returns 405 — legacy site, unclear what it is |
| `https://ukdsrndqhsatjkmxijuj.supabase.co/rest/v1/` | 200 | 311ms | 55–90ms | small | Region Paris (eu-west-3) |

### 2.2 Region-latency risk — Paris Supabase, South African customers

Supabase project `ukdsrndqhsatjkmxijuj` is in **eu-west-3 (Paris)**. Cape Town to Paris is roughly 9,000 km → expect **150–220 ms RTT** from a South African user's mobile network, before TLS and application logic.

From my (EU) machine I measured Supabase TTFB at 55–90 ms warm. Double that for Cape Town users. Admin dashboards that fire 6 parallel queries on first load (observed in `app/page.tsx:302–312`) will wait for whichever query is slowest — so call it ~250 ms of network time per dashboard load, added on top of the query execution time.

For the customer booking site, which currently hits Supabase directly from the browser (via ThemeProvider), **every page view involves at least 3 Supabase round-trips** (businesses, tours, slots). Same latency penalty.

**Options, least to most invasive:**

1. Accept the latency. At 250ms per dashboard refresh, it's noticeable but not broken.
2. Add `next.config` `headers` to enable stale-while-revalidate caching on public booking data.
3. Move the booking site's tenant/tour/slot reads behind a Vercel Function that runs in `fra1` or `cpt1` and talks to Supabase, reducing round-trips to one serialised fetch.
4. Move the Supabase project to a closer region — not trivially, requires a migration. `cpt1` (Cape Town) is available on Vercel but **Supabase does not have a Cape Town region**. The nearest Supabase-hosted region to South Africa is either Frankfurt (eu-central-1) or Dublin (eu-west-1); neither is dramatically closer than Paris.

**My recommendation:** no action in Phase 3. Note the constraint. If Core Web Vitals become a problem during launch, move to option (3).

---

## 3. Database performance

### 3.1 Scale baseline

| Table | Rows |
|---|---|
| bookings | 138 |
| slots | 1,363 |
| chat_messages | 926 |
| logs | 259 |
| holds | 62 |
| outbox | 56 |
| tours | 7 |
| businesses | 2 |
| marketing_contacts | 1 |

This is a small-but-real dataset. All benchmarks run at current scale; the interesting questions are "will this still be fast at 100× these numbers (10,000 bookings, 100+ marketing contacts, 10 operators)?"

### 3.2 Hot-query benchmarks (EXPLAIN ANALYZE, current scale)

All queries ran with `business_id IN (SELECT id FROM businesses LIMIT 1)` to match what the app does.

| Query | Planning ms | Execution ms | Plan type | Index used | Notes |
|---|---|---|---|---|---|
| Slot availability, 60-day window | 5.3 | 8.5 | Nested Loop + Index Scan | `slots_business_tour_start_unique` | Healthy. Scales well with current index. |
| Today's manifest (bookings JOIN slots) | 12.9 | 4.9 | Nested Loop + Seq Scan on bookings | `slots_pkey` on inner | **Seq scan on bookings** (no `(business_id)` index). Fine at 138 rows, painful at 10K. |
| Bookings list (admin page) | — | — | N/A — not executed | n/a | Will seq-scan bookings at scale too. |
| Hold expiry scan | 0.4 | 0.08 | Seq Scan | none | OK at 62 rows; stays fine because hold TTL is short (≤30 min) so table never grows large. |
| Outbox drain | 0.5 | 0.14 | Seq Scan | none | `idx_outbox_pending` exists but planner chose seq scan on 56 rows — correct choice. Will auto-switch to index at ~1000 rows. |
| Conversations inbox | — | — | SQL errored (column `last_message_at` not present) | n/a | Column name in the admin code may differ; worth checking before production load. |

The hold-expiry and outbox drain queries are the ones the cron-tasks edge function fires continuously; both are effectively instantaneous, which is what you want.

### 3.3 Index coverage gaps

Found by inspecting `pg_indexes` on hot tables:

| Table | Missing index | Evidence | When it starts to hurt |
|---|---|---|---|
| `bookings` | plain `(business_id)` | EXPLAIN shows Seq Scan on manifest query | ~5,000 bookings (~10ms) → ~500ms at 100K |
| `bookings` | `(business_id, status)` | Status filters in many admin queries | Same threshold |
| `bookings` | `(business_id, created_at DESC)` | Bookings list ordering | ~10,000 rows |
| `holds` | `(expires_at, status)` where `status='ACTIVE'` | Cron fires every minute or two | ~10K active holds (unlikely given TTL, but index is cheap) |
| `logs` | `(booking_id, event)` unique | Phase 2 noted: confirm-booking's idempotency claim race | Immediate — this is a *correctness* fix, not a perf one (see J2-M2) |

Recommendation: add the four B-tree indexes in a single migration. Five minutes of work:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bookings_business_id
  ON public.bookings (business_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bookings_business_status
  ON public.bookings (business_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bookings_business_created
  ON public.bookings (business_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_holds_active_expires
  ON public.holds (expires_at) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_logs_booking_event
  ON public.logs (booking_id, event) WHERE event = 'booking_confirmation_notifications_sent';
```

Mark as P2 — not urgent at 138 bookings, but the last one (`uq_logs_booking_event`) doubles as the Phase 2 webhook-idempotency fix and is worth doing with the RLS P0 work.

### 3.4 Connection pool

`pg_stat_activity` snapshot at review time:

| User | State | Count |
|---|---|---|
| authenticator (PostgREST) | idle | 4 |
| postgres | active | 1 |
| supabase_admin | idle | 2 |
| supabase_admin | null (background) | 3 |
| (null) | null | 5 |
| **Total** | | **~15** |

Supabase Free's direct connection ceiling is typically 60; with the transaction-mode pooler in front of PostgREST it's effectively unbounded from the application's perspective. At 15 connections for 2 operators and a quiet day, headroom for 10 operators is comfortable even on Free — but the other Free-tier constraints (auto-pause, bandwidth) remain the binding problem documented in Phase 1.

### 3.5 Data-quality observations

These aren't performance issues per se but surfaced while inspecting the DB:

| Observation | Implication |
|---|---|
| Status distribution: 80 CANCELLED, 37 COMPLETED, 19 EXPIRED, 1 PAID, 1 PENDING (total 138) | The `PAID` state is transient — bookings cycle PAID → COMPLETED after the tour. 58% cancellation rate is high — worth understanding (weather, customer cancels, admin refunds?). |
| Daily booking counts (30 days): 1–7/day, 14 active days out of 30 | Real traffic is modest — Cape Kayak is actively used but low volume. Good for launching slowly. |
| 2 operators, 7 tours, 1,363 slots | Slots-per-operator ratio suggests ~680 slots/operator, plausible for a ~180-day tour calendar. |

---

## 4. App-level performance observations

### 4.1 Landing page (`bookingtours.co.za`, Firebase)

- 105 KB total (HTML + inlined CSS). No JS bundle inspected — it's a static export, so the bundle is small.
- Firebase CDN warm cache hits at 36 ms TTFB — excellent.
- Hero section uses Unsplash CDN images; image weight not measured directly but Unsplash images are typically 100–300 KB each.
- `next.config.ts` has `images.unoptimized: true` (required for static export) — no Next.js image optimisation. Potential for bloat on mobile.

Verdict: **fine** at current state. If you add rich media, revisit.

### 4.2 Onboarding (`onboarding.bookingtours.co.za`, Vercel SSR)

- First-load TTFB 1.0s cold, 315ms warm. The 7 KB HTML is a shell that the wizard JS bundle hydrates — the real weight is in the JS.
- Rate-limit map is in-memory (`onboarding/route.ts:435`) — per-instance. On Vercel Fluid Compute, this map is *not* shared across instances, so the "3 attempts per IP per hour" rule is per-lambda-instance. A distributed attacker can burn through the rate limit easily.

Fix for the rate-limit: store attempts in Supabase (already available) or Upstash Redis (Marketplace integration).

### 4.3 Booking site (`aonyx.booking.bookingtours.co.za`, Vercel)

- Works, returns 200. CDN age 727566s (~8 days) — the HTML is being served from a cached copy, which is fine for the shell; the live data (slots, tours) is client-fetched.
- From the booking code (`booking/app/book/page.tsx:80–87`), slot loading is single-query per tour, 60-day window. At 5 tours × 60 days × 2 slots/day ≈ 600 rows × ~50 bytes = ~30 KB. Not a bundle problem.

### 4.4 Admin dashboard (`caepweb-admin.vercel.app`)

- Has 6 parallel queries on first dashboard load (`app/page.tsx:302–312`). At 250ms/query (South African user), first dashboard paint is ~300–400 ms after JS loads.
- Uses Supabase Realtime on `bookings` channel — no reconnect-backfill (Phase 2 J1-L1 / J4-L1).

---

## 5. What I could not measure in Phase 3

| Area | Reason | Plan |
|---|---|---|
| Lighthouse / Core Web Vitals | `lighthouse` binary not installed, Playwright config exists but playwright browsers likely not installed. | Install `npm i -g lighthouse` or run `npx lighthouse …`. Manual for now. |
| Real-user latency from South Africa | No RUM agent installed (no Vercel Speed Insights, no Google Analytics, no Sentry RUM). | Add Vercel Speed Insights to each app (free on Vercel). |
| Concurrent load (k6, artillery) | No test environment; running against prod would create real bookings. | Needs staging environment. |
| Edge function cold-start timing | Would have had to invoke public webhooks, which have side effects. | Needs a dry-run mode or staging. |
| Customer-facing Core Web Vitals on mobile 4G | Same as Lighthouse — needs the tool installed. | Same plan. |
| Realtime scalability (20+ operators subscribed at once) | Needs to actually simulate. | Needs staging. |
| Deliverability of email (Resend, Gmail spam folder) | Don't want to burn real quota. | Use a tool like Mail Tester after DNS SPF/DKIM is reviewed. |

Nothing in this list is a blocker for answering "should we launch?" — the blockers are the P0s in §0, plus Phase 2's RLS P0.

---

## 6. Findings catalogue — Phase 3 additions

| ID | Severity | Title | Fix effort |
|---|---|---|---|
| **P0-3** | P0 | `admin.bookingtours.co.za` domain detached from Vercel `caepweb-admin` project | 2 min (rebind in Vercel UI) |
| **P0-4** | P0 | `book.capekayak.co.za` hardcoded in admin code, DNS points to dead AWS IPs | 10 min + 1h fix in admin code |
| **P2-13** | P2 | Missing `(business_id)`, `(business_id, status)`, `(business_id, created_at)` indexes on `bookings` | 30 min (migration + apply) |
| **P2-14** | P2 | Missing unique index on `logs(booking_id, event)` — needed to close the webhook-idempotency race from Phase 2 J2-M2 | 15 min |
| **P2-15** | P2 | Supabase region = eu-west-3 (Paris) → 150–220 ms RTT from Cape Town | 0 (accept) or 1 day (route booking reads via Vercel Function in `fra1`/`cpt1`) |
| **P2-16** | P2 | Onboarding rate-limit is in-memory per-lambda — distributed attacker bypasses easily | 2 hours (move to Supabase table with a UNIQUE (ip, hour) index) |
| **P2-17** | P2 | `booking.bookingtours.co.za` root is `DEPLOYMENT_NOT_FOUND` but wildcard subdomains work | 2 min (attach root to `booking` Vercel project just in case) |
| **P3-3** | P3 | No RUM agent — no real-user performance data anywhere | 1 hour (install Vercel Speed Insights, GA4, or Sentry) |
| **P3-4** | P3 | Lighthouse tooling not set up | 10 min |

Nothing in Phase 3 blocks further work that's not already blocked by Phase 2.

---

## 7. Updated running-total catalogue

| Phase | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| Phase 1 (architecture) | — | — | — | — |
| Phase 2 (journeys) | P0-1, P0-2 | P1-1 … P1-5 | P2-1 … P2-12 | P3-1, P3-2 |
| Phase 3 (perf + infra) | **P0-3, P0-4** | — | P2-13 … P2-17 | P3-3, P3-4 |
| **Total** | **4 P0s** | 5 P1s | 17 P2s | 4 P3s |

### Total effort estimate to green-light launch

- **P0 remediation (must fix):**
  - P0-1 + P0-2 (RLS + password rotation): 3–6h Supabase work + 1 day password reset comms
  - P0-3 (admin domain rebind): 2 min
  - P0-4 (book.capekayak DNS + admin code): 30 min
  - **≈ 1.5–2 days total**
- **P1 should-fix (3 days):**
  - Supabase Pro upgrade (P1-1): 30 min
  - Idempotency on create-checkout (P1-2): 2–4h
  - bcrypt migration (P1-3): 1 day with forced-reset
  - Server-side sessions (P1-4): 1 day
  - Route-level auth (P1-5): 4–6h
- **P2 first-month (1 week):** indexes, transactional onboarding, Resend failure surfacing, etc.

**Realistic "ready for 10 operators under monitoring" readiness: 3–5 days of focused work.**

---

## 8. Sign-off gate for Phase 4

Phase 4 is **shared-resource contention analysis** — what happens when the four apps compete for the same infrastructure simultaneously. Before that, I need one thing:

- [ ] **Acknowledge and start P0-3 and P0-4 fixes.** P0-3 is literally a 2-minute click in Vercel; I can't do it from here. If these aren't fixed, Phase 4's "can the platform handle 10 simultaneous operators?" question has a trivial answer — "no, because operators can't reach the admin URL."

Phase 4 itself will lean on what I already gathered in Phase 3 (connection pool, region latency, cron scan costs) plus new checks on:

- Supabase Free plan limit numbers (I need you to confirm the plan tier's current month-to-date usage — or you can screenshot the Supabase billing dashboard).
- Resend monthly send quota and current usage.
- WhatsApp Business API tier and current daily conversation quota.
- Vercel build minutes and Fluid Compute GB-seconds current usage.

Everything else I can infer from code and the current scale baseline in §3.1. Let me know when to proceed.
