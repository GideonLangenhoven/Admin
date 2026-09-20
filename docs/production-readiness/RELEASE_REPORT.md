# BookingTours release report

Verdict: `IN_PROGRESS`

The required source was resolved at `feature/launch-rollout-2026-09-20@76d00f3157acb2c73159bef6b8d40a108a9e767d`. The tested Admin application candidate is the accepted descendant `a39079704d0ed9f892ad35541aba69a5a01d3716`. No deployment has been performed. The booking companion, onboarding source, deployed app IDs, Edge Function versions, environment identifiers, redacted configuration fingerprint, and production migration ledger are unresolved.

Local source gates currently show a clean install from the candidate lockfile, passing TypeScript, Edge checks, a production build with synthetic public configuration, and 158 passing disposable PostgreSQL isolation checks after an independently reviewed fixture repair. Lint has 262 pre-existing warnings. Final full-unit evidence has 1,157 passes, 3 failures, and 1 skip; the failures are the same companion UI-contract drift against CI's pinned booking commit. These are recorded outcomes, not release waivers.

`GUIDE-OFFLINE-01` / `COR-05` is independently task-approved at `2d6ce982`: offline check-ins are bound to the active user and tenant without per-item bearer tokens; recoverable failures remain queued; terminal failures stay visible; legacy work is quarantined; stale auth generations cannot replay across account switches; bounded batches drain without starvation; and interrupted check-in persistence converges using the existing idempotency key. The original behavioral suite failed 12/12 tests; the final suite passed 26/26. This is isolated unit/build evidence, not proof of a real authenticated browser, database, or deployed journey.

`GUIDE-PHOTO-01` / `SEC-07` is independently task-approved at `a390797`: actual multipart bytes are capped at 4,500,000 bytes, aligned with Vercel's documented 4.5 MB Function request ceiling; files are separately bounded and fully decoded with a pixel limit; unsupported, multi-page, mismatched, malformed, and truncated content is rejected before Drive access; names and MIME are server-derived; and uncertain provider/database outcomes are correlated without destructive cleanup or blind-retry advice. The original focused suite failed 10/12 tests; the final photo suites passed 42/42. HEIC is explicitly unsupported by the verified decoder. Original decoded bytes are retained and handed to Drive's separate-origin preview surfaces; this is not malware certification or content sanitization. No genuine Drive/database/browser test was performed.

No genuine provider, browser E2E, cross-version 100-account, 2,000-session load, spike, 24-hour soak, restore, monitoring-receipt, deployment, or canary evidence exists. `BT2000-LAUNCH-V2` and its costs remain unapproved. Production operations and live side effects remain unauthorized.

Customer-preservation rules, demo safeguards, current financial invariants, and legitimate role workflows are locked. Refund-role and existing-pricing migration policy require owner decisions before those changes.

`ROLLOUT_READY_2000` is not issued.
