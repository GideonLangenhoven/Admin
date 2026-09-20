# BookingTours production-readiness checkpoint

Updated: 2026-09-20T13:21:03Z
Verdict: `IN_PROGRESS`

## Routing and source

- Requested and observed implementation runtime: `gpt-5.6-sol`, effort `max` (session `01a0bd6e-e45e-7170-92f5-f1030a113171`; Codex CLI `0.155.1`). No customer-facing AI model was changed.
- Admin source: remote `GideonLangenhoven/Admin`, required ref `feature/launch-rollout-2026-09-20` at discovery SHA `76d00f3157acb2c73159bef6b8d40a108a9e767d`. Tested application candidate `90eed5ee936252077a611b8cbe602c1fc761c301` is its accepted descendant through G0 commit `ae6ce521b5500730f4798506305afa2781f8fd8d`; ancestry is valid.
- Isolated writer worktree: `/private/tmp/bookingtours-readiness-76d00f3`, branch `codex/bookingtours-readiness-2026-09-20`.
- The original checkout's two modified launch documents and untracked readiness pack are preserved untouched.
- CI's booking-app pin is `460e58d952ad570c9036bc13118eec66a2591918`. It descends the local booking checkout's clean HEAD `99b71f093486b13f6f9bed38f48d184a93b23ba6`; that checkout is dirty and is not evidence. Current Admin tests still fail three UI-contract assertions against the CI pin. The deployed booking and onboarding revisions remain unknown.

## Environment and baseline

- No `.env` file or real credential was copied into the worktree. Staging has not been positively identified; production mutations, real messages, financial operations, load, paid changes, deployment, and destructive work remain unauthorized.
- Lockfile SHA-256: `8620bb3a03e3efd78ce5c39e7d500a79a88849fc397fcd6a9d450f923eef9757`; migration-set SHA-256: `49e4103ebc0f9fcb54c37e5519d772465764eaaad7c61ef78a26e432b8a041d9` (245 top-level SQL files).
- Final `npm ci`: pass on the candidate lockfile. Earlier dependency-audit evidence reported 27 advisories (2 low, 13 moderate, 10 high, 2 critical); current advisory/reachability triage remains the open `SEC-10` gate.
- `npm run check:edge`: pass. `tsc --noEmit`: pass. `npm run lint`: exit 0 with 262 existing warnings.
- Final `npm run test:unit` with CI-pinned booking source: 1,176 pass, 3 fail, 1 skip. The same companion UI-contract drift fails as at baseline; it is not waived.
- `npm run build` passes using explicit fake public Supabase values; the production-only service-auth probe correctly skips outside production. No provider action occurred.
- `npm run test:isolation:local`: pass after reviewed fixture repair; all current selected migrations apply and 164 checks pass. Baseline proof fails at the demo migration with missing `storage.objects`; see the evidence records.
- Sanitized baseline record: `/private/tmp/bookingtours-readiness-evidence-76d00f3/g0-baseline.md`.

## Decisions, locks, and next work

- Preserve demo `read_only` mutation blocks and synthetic date refresh.
- Refund work is locked pending an owner policy decision: current User Manual/help say `OPERATOR` may refund; the older security model says `ADMIN+`. Batch auth and tenant prevalidation already exist and must not be misreported as absent.
- Pricing migration `20260920090000_enforce_standard_plan_pricing.sql` is locked pending the approved scope and actual migration ledger.
- Completed: `G0-TEST-HARNESS-01`, independently approved for its narrow disposable-harness scope. Patch SHA-256 `d6b1d227bc28012d5fd4f9c6e48679e31dc15c0527ca2ba128346a23256698ff`.
- Completed: `GUIDE-OFFLINE-01` (`COR-05`) at application SHA `2d6ce9826647a61bcd8f30c815b4a6b212c84df0`. Original regression: 12/12 failed; final focused suite: 26/26 passed. TypeScript, worker syntax, diff check, targeted lint, and final production build passed. Astra/high independently returned `APPROVE_TASK`; runtime metadata was not independently observable. Evidence hashes are in `evidence/GUIDE-OFFLINE-01.json`.
- Completed: `GUIDE-PHOTO-01` (`SEC-07`) at application SHA `a39079704d0ed9f892ad35541aba69a5a01d3716`. Original focused regression failed 10/12; final focused photo suites passed 42/42. TypeScript, diff check, targeted lint (two existing UI warnings), and the exact production build passed. Astra/high independently returned `APPROVE_TASK`; runtime metadata was not independently observable. Evidence hashes are in `evidence/GUIDE-PHOTO-01.json`.
- Completed: `DEMO-AUTH-01` (partial `SEC-11`) at application SHA `37f94bc2374fe987226055ecb810253addcf5faf`. The original focused regression failed 2/10; final focused and affected suites passed 10/10 and 38/38. Shared Next.js/Edge authorization now treats read-only as an authority ceiling while preserving own-tenant demo browsing and writable `SUPER_ADMIN` support. Astra/high independently returned `APPROVE_TASK`; runtime metadata was not independently observable. Database/RLS/Storage and deployed evidence remain open, so `SEC-11` is only partially verified.
- Completed: `COR-02A` (`COR-02`, narrow partial `COR-04`) at application SHA `90eed5ee936252077a611b8cbe602c1fc761c301`. Original regression: 9/87 failed; final focused suite: 115/115 passed; disposable PostgreSQL: 164/164 passed. Provider acceptance now requires a valid provider ID, uncertain outcomes retry with a stable key and frozen payload, expiry is rechecked before send, and overlapping accepted work replays without resubmission or false failure. Astra/high returned `APPROVE_TASK`; runtime metadata was not independently observable. The migration is local-only pending target-ledger verification, and hold rediscovery/claim/fairness remains open under `COR-04`.
- No active writer lock. Refund and pricing policy locks remain in force. A next correction must be selected from dependency-ready work; do not represent `COR-04` as closed or deploy the reminder migration before its target ledger is reconciled.
- `COR-02`, `COR-05`, `SEC-07`, and the narrow application portion of `SEC-11` are task-verified, not release-certified. No load, soak, restore, genuine-provider, deployed-browser, monitoring receipt, or canary evidence exists.
