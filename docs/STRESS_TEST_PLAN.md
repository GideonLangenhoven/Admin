# Pre-Rollout Stress Test Plan — BookingTours

**Goal:** prove the platform survives real-world load and abuse before onboarding paying clients. Pass every gate below → roll out. Fail a gate → the failing section names the owner and the fix path.

**Philosophy:** stress the money paths hardest. A slow dashboard embarrasses you; a double-charged customer or a cross-tenant leak ends the business. Order of scrutiny: payments → tenant isolation → capacity/overbooking → messaging fan-out → UX under load.

**Reuse, don't rebuild.** This plan leans on what already exists: 204 unit tests (`npm run test:unit`), Playwright e2e suite (`tests/e2e/`, incl. `full-journey.spec.ts`), `npm run check-security-drift`, Yoco/OTA test modes + signed-webhook curl recipes (`docs/TESTING_EXTERNAL_BOOKINGS.md`), perf baselines (`docs/perf/`), and the 2000-tenant audit (`docs/qa/SCALE_READINESS_2026-07-04.md`). The only new tool required is **k6** (single binary, free) for HTTP load generation.

**Environment rule:** all load tests run against a **dedicated stress tenant** on the live project with **Yoco test mode ON**. Never load-test a real operator's tenant. Announce test windows — pg_cron jobs are shared platform-wide.

---

## Phase 0 — Gate zero: everything green before any load (½ day)

| Check | Command | Pass |
|---|---|---|
| Unit suite | `npm run test:unit` | 100% pass |
| E2E suite (both apps running) | `npx playwright test` | 100% pass |
| Security drift | `DATABASE_URL=… npm run check-security-drift` | exit 0 |
| Supabase advisors | dashboard → Advisors | no ERROR-level security findings |
| Builds | `npm run build` (admin + booking) | 0 errors |

Anything red here means you're stress-testing known-broken software. Stop and fix first.

---

## Phase 1 — Payment integrity under concurrency (1–2 days) 🔴 highest stakes

The one domain where "rare" bugs are catastrophic. All against the stress tenant, Yoco test keys, card `4111 1111 1111 1111`.

**1.1 Webhook replay & duplication.** Fire the same Yoco `payment.succeeded` webhook 50× concurrently (k6, signed with the test webhook secret). Pass: exactly one booking flips to PAID, one invoice, one confirmation email/WA; the other 49 return replay/200 with **zero** duplicate side effects (`idempotency_keys` holds).

**1.2 Double-spend race on the last seat.** Create a slot with capacity 2. Launch 20 concurrent checkout flows for 2 seats each (k6 hitting `create-checkout`, then confirm the winners' webhooks). Pass: `slots.booked ≤ capacity_total` at all times; losers get holds that expire cleanly; the orphan-hold query (`expires_at < now()-1h AND released_at IS NULL`) returns 0 an hour later.

**1.3 Hold-expiry vs late webhook.** Start a checkout, wait past the 15-min hold into the 5-min grace window, then deliver the payment webhook. Pass: booking confirms (grace honored). Repeat past the grace window: pass = payment refunded/flagged, booking not confirmed into a released seat.

**1.4 Reschedule/remediation races.** On one CANCELLED-with-credit booking, concurrently fire CLAIM_CREDIT(VOUCHER) and CLAIM_CREDIT(REFUND) and a RESCHEDULE. Pass: exactly one wins; refund_amount is consumed once; no voucher + refund both issued. Same for two concurrent RESCHEDULEs into a 1-seat slot.

**1.5 Refund ceiling.** Attempt refunds > `total_captured − total_refunded` via the admin queue and process-refund directly. Pass: rejected; `total_refunded` never exceeds `total_captured` on any booking after the whole phase (single SQL assert).

**Tooling:** k6 scripts + the signing recipes already in `docs/TESTING_EXTERNAL_BOOKINGS.md`. After each scenario run the invariants SQL pack (write once, ~10 asserts: capacity sums, refund ceilings, orphan holds, duplicate idempotency keys, PAID-without-payment-id).

---

## Phase 2 — Tenant isolation under adversarial load (1 day) 🔴

The audit fixed the known holes; this phase proves no regression and no *new* ones under concurrency.

**2.1 Cross-tenant fuzz.** With tenant A's anon context and tenant B's real IDs (bookings, slots, vouchers, conversations), replay every public API/edge function substituting B's IDs — at 50 rps. Pass: 100% of cross-tenant attempts return 401/403/404/empty; zero rows of B's data in any response body (assert by grepping responses for B's seeded marker email).
**2.2 Authenticated-role probe.** Repeat with an OPERATOR JWT from tenant A against admin APIs (billing, credentials, data-requests, wa-failures). Pass: same.
**2.3 RLS drift under migration load.** Run `check-security-drift` before and after the full stress campaign. Pass: exit 0 both times.
**2.4 Reviews RLS gap (known):** `reviews` authenticated read/update policies are `USING (true)` — app-layer filtered only. Either fix before rollout or explicitly accept the risk in writing. This plan recommends fixing (one migration).

---

## Phase 3 — Capacity & fan-out at tenant scale (1–2 days) 🟠

The 2000-tenant audit closed the 1000-row truncation class; verify it holds and find the wall-clock ceiling.

**3.1 Synthetic tenant fleet.** Seed script: 1,500 tenants × (2 tours, 30 future slots, 20 bookings with tomorrow-trips, phone+email). Pure inserts via service role; deleteable by marker prefix.
**3.2 Cron sweeps at fleet size.** Manually invoke `auto-messages` (action `all`), `cron-tasks`, `marketing-dispatch`, both OTA syncs against the fleet. Pass: each completes < 300s edge wall-clock (log duration), processes tenant #1,001+ (assert reminders logged for the last-seeded tenant), per-tenant failure injection (1 tenant with garbage credentials) doesn't abort the sweep, and re-running produces **zero duplicate sends** (auto_messages unique key holds at volume).
**3.3 Messaging burst limits.** 500 reminders due in one sweep: measure Resend + Meta WA throughput/429s. Pass: no silent drops — every 429/failure lands in `wa_messages` FAILED (surfaced by the failure watcher) or is retried. Record the real ceiling (sends/min) as an operational number.
**3.4 Admin/booking app hot pages at scale.** k6: 100 concurrent operators on `/bookings` (largest seeded tenant), 500 concurrent customers browsing the booking site + availability. Pass: p95 < 2s for booking-site reads, p95 < 4s for admin day-view, zero 5xx. Compare against `docs/perf/` baselines; regressions >2× need explanation.
**3.5 Realtime/polling pressure.** 50 open inbox tabs (the page polls every 3s). Pass: no PostgREST rate-limit errors; conversation list stays correct.

---

## Phase 4 — Full-journey soak (2–3 days wall-clock, mostly unattended) 🟠

Run the platform like 30 real businesses for 48h, continuously:

- k6 "day-in-the-life" scenario on loop: browse → hold → pay (test mode) → waiver sign → reschedule some → cancel some (customer + operator + weather) → review request → my-bookings OTP login → chat-bot conversation with human escalation.
- OTA webhook feed: signed Viator/GYG create/amend/cancel events every few minutes (recipes from the runbook), plus `ota-reconcile` nightly.
- Marketing: one campaign to 1k seeded contacts mid-soak; unsubscribe some; assert unsubscribed receive nothing further.

**Pass gates after 48h:** invariants SQL pack all green; zero unhandled 5xx in Vercel + edge function logs (grep for ERR patterns); Sentry shows no new error classes; email/WA delivery failure rate < 2% and all failures visible in operator UI; DB connections stable (no pool exhaustion in Supabase dashboard); pg_cron jobs all still on schedule (no stuck/failed runs in `cron.job_run_details`); disk/DB size growth linear and explained.

---

## Phase 5 — Abuse & failure injection (1 day) 🟡

- **Rate-limit probes:** OTP endpoint (brute-force a code — must lock out), review submit (20/min limit holds), chat endpoints, `/api/img` proxy (allowlist holds under fuzz: `file://`, redirects, IP literals).
- **Garbage in:** malformed webhook bodies, oversized payloads (>1MB), invalid signatures at 100 rps → all 4xx, zero DB writes, no function crash-loops.
- **Dependency outage drills:** wrong Resend key for 10 min mid-soak (mails must queue/fail visibly, not vanish); revoke WA token (failure watcher + email fallback must fire); Yoco webhook delivery delayed 10 min (grace window + reconciliation behavior).
- **Known fail-open to close or accept:** `payfast-itn` fails OPEN on validation network error — decommission or fix before rollout (recommended: disable the function until a client actually needs PayFast).

---

## Phase 6 — Operational readiness (½ day, checklist not load)

- Restore drill: point-in-time-restore the DB to a branch project, verify a booking lookup works there. An untested backup is not a backup.
- `SETTINGS_ENCRYPTION_KEY` stored separately from DB backups; documented key-holder.
- Runbook freshness: `PRODUCTION_RUNBOOK.md` on-call steps actually work (walk them once).
- Alerting: define the 5 pages a human must get — payment webhook error rate, cron job missed 2+ runs, WA failure spike, 5xx spike, security-drift failure in CI. Wire whatever is cheapest (Sentry alerts + a scheduled drift check).
- Load ceiling doc: write down the measured numbers from Phases 3–4 (max sends/min, max concurrent checkouts, tenant sweep duration) so sales/ops know the envelope.

---

## Verdict rubric

| Result | Action |
|---|---|
| All 🔴 phases pass, 🟠 pass | **Roll out.** Onboard clients in cohorts of ~10, watch the Phase-6 alerts for two weeks. |
| 🔴 pass, 🟠 partial | Roll out to a capped pilot (≤5 clients) while fixing 🟠 items. |
| Any 🔴 failure | **No rollout.** Payment or isolation failures are disqualifying; fix, then re-run that phase plus Phase 4. |

**Estimated effort:** ~7–9 working days for one engineer, of which ~2 are unattended soak. The big one-time investments (reusable afterwards for every release): the k6 scenario scripts, the tenant-fleet seed script, and the invariants SQL pack — roughly 2 of those days, and they become your permanent regression harness.

**Known open items this plan forces a decision on:** reviews RLS `USING(true)` (fix), payfast fail-open (disable), GYG unsigned-webhook acceptance when no secret configured (fix or mandate secrets at onboarding), per-request full scans flagged in the scale audit (measure in 3.4 — fix only if the numbers say so).
