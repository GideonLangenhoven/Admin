# Finding B and C fixes — 2026-09-25 (per reviewer dispositions)

Author: Claude Code session. Reviewer dispositions of 2026-09-25 applied verbatim.

## B — web-chat throttle assertion (bot-hardening.test.ts)

The literal-name check (`expect(web).toContain("rateLimited")`) is replaced with the
approved behavioral contract: the real `web-chat` handler is driven through
`sourceHandler` with the real session modules and a denying shared limiter, asserting
**429 + Retry-After > 0**. The old per-process limiter is NOT restored. The full
contract (21st message, shared visitors behind one IP, polling budgets, oversized
input, limiter outages) remains covered by the executable `web-chat-limits.test.ts`.
Result: bot-hardening 9/9.

## C — check_ins_admin RLS policy (forward migration)

New forward migration `20260925120000_check_ins_policy_hoisted.sql` rewrites the
policy from the bare `= ANY(current_business_ids())` form to the reviewed
`IN (SELECT unnest((select current_business_ids())))` once-per-statement form
(the exact spelling the 20260704150000 convention migration rewrites to). Same
authorized rows. Bounded `lock_timeout`/`statement_timeout`; no baseline-only change.

Baseline updated to record the intended **post-migration** render (captured from a
real catalog: `(business_id IN ( SELECT unnest(( SELECT current_business_ids() AS
current_business_ids)) AS unnest))`), with a note that drift-check against a
pre-migration database flags exactly this policy — intended fail-closed behavior
until the migration is applied.

Verification on disposable PostgreSQL 17.11 (not source strings):

- **Plan**: old policy = `Filter: (business_id = ANY (current_business_ids()))`
  (per-row); new policy = `Filter: (ANY (business_id = (hashed SubPlan 2).col1))`
  with `SubPlan -> ProjectSet -> InitPlan` (evaluated once per statement).
- **Allowed/denied** as tenant-1 OPERATOR under `role authenticated`: SELECT visible
  rows = 2 of 3 (own tenant only); own-tenant INSERT allowed; foreign-tenant INSERT
  rejected (`new row violates row-level security policy`); `anon` denied
  (permission denied). WITH CHECK exercised with a temporary INSERT grant in the
  disposable DB only — production grants remain SELECT-only with writes via
  service-only RPCs.

Result: rls-initplan 12/12.

## Assembly sweep after both fixes

    1507 tests: 1499 passed, 7 failed, 1 skipped (conditional)

The 7 failures are unchanged: the companion-source-blocked set (asserted files/
contracts exist in no surviving booking commit). They remain **blocked**, not passed.

## Still required before this candidate deploys

1. Companion sources (recovery of `86588bcb`/`b93f053b`/`f11b1dd9`/`2de7de49`, or
   deliberate repinning with equivalence evidence) then rerun the 7 unchanged checks.
2. Supported-runtime run (Node >=22.23.2 per `engines` + `engine-strict`) — runs so
   far used Node 22.22.1 with the floor overridden for install only.
3. Deployment prerequisites (unchanged): shared Redis service for the fail-closed
   proxy limiter (503 when absent), `ADMIN_RECOVERY_ORIGIN`, and the migration set
   including this one and the C06 forward migration.
4. `apply_last_minute_deals` deployed-definition reconciliation (one query).
