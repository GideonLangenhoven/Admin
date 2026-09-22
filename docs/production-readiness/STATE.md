# BookingTours production-readiness checkpoint

Updated: 2026-09-22T06:30:05Z
Verdict: FAILED_GATE.

The exact Admin candidate `71da0361db65dd63f90b5110648b96b2c4ff3567` and booking companion `2ff1d82` are deployed. The controlled five-migration package is applied, all 55 Edge Functions are active, Admin deployment `dpl_6XfJvbbYuWDTvR8KCgbCgbJs14K6` serves `admin.bookingtours.co.za`, and booking deployment `dpl_Gb2ULvtZBjNej8STiNyejxfdbc5i` serves `booking.bookingtours.co.za`. The deployment aliases return HTTP 200, the remote migration ledger is exact, scheduler prerequisites exist once, and unauthenticated cron requests are rejected.

The deployed four-case browser smoke passes against the active `claires-hiking` storefront and Admin. The apex storefront is a directory and correctly shows zero operators because the active tenant is not directory-visible; it is not the tenant smoke target. Scheduled notification, marketing and cleanup work is succeeding.

The bounded deployed BT500 staff smoke reached 500 VUs and failed decisively. It was stopped after approximately 144 seconds to limit impact: 35.19% unexpected action failures, 30.82% failed HTTP requests, read-action p95 30.004 seconds and write-action p95 61.486 seconds. The failures were dial-stage I/O timeouts across both Supabase and Vercel origins, so the evidence does not yet distinguish target capacity from generator/egress limits. It does prove that this generator-to-deployment path does not satisfy the release contract. The 24-hour qualification clock did not start.

The abort preserved integrity. Marker-specific tenant, arrival-audit, capacity, refund/capture, hold and idempotency checks remained at zero. Twelve pre-existing non-marker `PAID` records without provider IDs remain a separate baseline finding. One scheduled HTTP request timed out during the load window; the next minute's scheduled requests succeeded. The post-stop browser recovery smoke passed 4/4. The marker fleet was removed (500 auth users and 167 businesses), the private credentials were deleted, and database counts returned exactly to the pre-test baseline.

Local corrective work and source verification remain valid: 1,355 unit tests pass with one intentional skip, TypeScript and all Edge checks pass, both production builds pass, the responsive Simple View browser run passes, 181 disposable PostgreSQL checks pass, and npm audit reports zero vulnerabilities. Authoritative Auth, MFA ownership, refund authority, partial-arrival integrity and durable transactional notifications remain integrated in the deployed candidate.

Release qualification remains blocked by the failed capacity gate plus the previously open provider-double/public/background harnesses, genuine provider sandbox journeys, browser-derived Realtime measurement, representative-volume data, quota/headroom evidence, alert delivery drill, reviewed post-migration security baseline, and isolated restore target. No live provider messages, charges, refunds, provider-account changes, paid scaling or public launch switch occurred.

The minimum next capacity action is a progressive rerun from an instrumented independent generator with generator saturation and remote Supabase/Vercel resource metrics captured at each plateau. Do not begin the 60-minute steady phase or 24-hour soak until the timeout source is isolated, the 500-user smoke meets its original thresholds, provider doubles are enabled, and the remaining harness gates are executable.

Detailed deployed-smoke evidence is recorded in `docs/production-readiness/evidence/BT500_DEPLOYED_SMOKE_20260922.json`.
