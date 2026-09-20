# BookingTours production-readiness checkpoint

Updated: 2026-09-20T07:08:29Z  
Verdict: `IN_PROGRESS`

## Routing and source

- Requested and observed implementation runtime: `gpt-5.6-sol`, effort `max` (session `01a0bd6e-e45e-7170-92f5-f1030a113171`; Codex CLI `0.155.1`). No customer-facing AI model was changed.
- Admin source: remote `GideonLangenhoven/Admin`, required ref `feature/launch-rollout-2026-09-20`, local and remote HEAD `76d00f3157acb2c73159bef6b8d40a108a9e767d`. The inspected baseline equals the candidate; ancestry is valid.
- Isolated writer worktree: `/private/tmp/bookingtours-readiness-76d00f3`, branch `codex/bookingtours-readiness-2026-09-20`.
- The original checkout's two modified launch documents and untracked readiness pack are preserved untouched.
- CI's booking-app pin is `460e58d952ad570c9036bc13118eec66a2591918`. It descends the local booking checkout's clean HEAD `99b71f093486b13f6f9bed38f48d184a93b23ba6`; that checkout is dirty and is not evidence. Current Admin tests still fail three UI-contract assertions against the CI pin. The deployed booking and onboarding revisions remain unknown.

## Environment and baseline

- No `.env` file or real credential was copied into the worktree. Staging has not been positively identified; production mutations, real messages, financial operations, load, paid changes, deployment, and destructive work remain unauthorized.
- Lockfile SHA-256: `03f462aa55fff63a71e5544a2c394395505cf1b14dfd826656819ba23d9cdbda`; migration-set SHA-256: `8366d65142c3fcc959abe503344d294539424bcdc9c1279d279716876441a6ca` (244 files).
- `npm ci`: pass; npm reported 27 advisories (2 low, 13 moderate, 10 high, 2 critical), not yet reachability-triaged.
- `npm run check:edge`: pass. `tsc --noEmit`: pass. `npm run lint`: exit 0 with 262 existing warnings.
- `npm run test:unit` with CI-pinned booking source: 1,100 pass, 3 fail, 1 skip. Failures are companion UI-contract drift, not waived.
- `npm run build` passes using explicit fake public Supabase values; the production-only service-auth probe correctly skips outside production. No provider action occurred.
- `npm run test:isolation:local`: pass after reviewed fixture repair; all current selected migrations apply and 158 checks pass. Baseline proof fails at the demo migration with missing `storage.objects`; see the evidence hashes below.
- Sanitized baseline record: `/private/tmp/bookingtours-readiness-evidence-76d00f3/g0-baseline.md`.

## Decisions, locks, and next work

- Preserve demo `read_only` mutation blocks and synthetic date refresh.
- Refund work is locked pending an owner policy decision: current User Manual/help say `OPERATOR` may refund; the older security model says `ADMIN+`. Batch auth and tenant prevalidation already exist and must not be misreported as absent.
- Pricing migration `20260920090000_enforce_standard_plan_pricing.sql` is locked pending the approved scope and actual migration ledger.
- Completed: `G0-TEST-HARNESS-01`, independently approved for its narrow disposable-harness scope. Patch SHA-256 `d6b1d227bc28012d5fd4f9c6e48679e31dc15c0527ca2ba128346a23256698ff`.
- Active writer lock: `COR-05` offline guide queue only. Next: create the bounded task packet and failing behavioral service-worker tests before implementation.
- No task is release-verified. No load, soak, restore, genuine-provider, deployment, monitoring receipt, or canary evidence exists.
