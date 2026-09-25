# Integration assembly + settled failure disposition — 2026-09-25

Reviewer of record: Astra. Prepared by: Claude Code session (not Sol).
Basis: reviewer feedback of 2026-09-25 (source recovery + settle-the-seven directive).

## 1. Source recovery — status

| Artifact | Status |
|---|---|
| Admin candidate `f84e849` + 38 commits | **NOT lost.** Present locally on `codex/bookingtours-simple-view-readiness-2026-09-20`; simply never pushed (GitHub "No commit found" = unpushed, not missing). Publishing it is a one-command action once push authority/auto-deploy inspection is done. |
| Storefront candidate `f11b1dd9` | **UNRECOVERED from this machine.** Not in the nested `booking/` clone (138 commits, all refs), not in the second clone at `Desktop/2026/Code Projects/booking-corrupt`, not on the fetched GitHub remote, not a loose/packed object anywhere searched, not in any APFS local snapshot (`tmutil` reports none). Candidates were built in throwaway clones under `/private/tmp` and lost to tmp cleanup. |
| Onboarding candidate `2de7de49` | **UNRECOVERED**; repo identified at last: `Desktop/2026/Code Projects/ActvityHub/Onboarding` (`GideonLangenhoven/onboarding`). SHA absent from its object store; surviving refs: `main-fresh` `d47c7ce` ("zero-secret onboarding wizard v2"), `main-old`, `archive/v1-wizard`, `main`. |

Remaining recovery avenue: the Codex host's workspace (its transcripts show `/root/...`
task paths, not on this Mac). If that host persists its sandbox, the companion clones
are there. Otherwise the reviewer's outcome 2 applies: deliberate repinning with
equivalence evidence and a fresh manifest.

## 2. The seven failures — settled per-failure disposition

Every failing assertion targets **booking-side companion source**. The asserted files
and contracts exist in **no surviving booking commit** (checked `b7c65e3`, `2ff1d82`,
`e823b2c`, `12252cf`, full ref history):

| # | Test / assertion | Exact pairing expected | Why it fails | Disposition |
|---|---|---|---|---|
| 1 | storefront-checkout-updates (collection) | `booking/app/lib/checkout-session.ts` | File exists in no ref | Source unavailable — blocked |
| 2 | booking-success-access: "routes WhatsApp payment redirects through guarded checkout issuance" | `booking/app/lib/booking-checkout.ts` (line 199; earlier Admin-side assertions pass) | File exists in no ref | Source unavailable — blocked |
| 3 | img-proxy-ssrf: "rejects non-http(s) protocols before fetching" | `booking/app/api/img/route.ts` containing `url.protocol !== "https:" \|\| url.port \|\| url.username \|\| url.password` | Surviving route has an older guard style (protocol allowlist only; no port/user/pass rejection) | Source unavailable — the hardened route is lost-candidate behavior |
| 4 | img-proxy-ssrf: "only echoes image content types, with sniffing disabled" | same file, `ALLOWED_TYPES.test(...)` + `image/${format}` template type | Surviving route uses `upstreamType.startsWith("image/")` + fixed type map | Source unavailable — same as #3 |
| 5–6 | mobile-first-implementation ×2 | `booking/app/book/BookingFlow.tsx` | File exists in no ref | Source unavailable — blocked |
| 7 | partial-voucher-checkout: "booking payload includes voucher_amount_paid" | `booking/app/book/BookingFlow.tsx` (its Admin-side `create-checkout` assertion is after the failing read and remains unexercised) | File exists in no ref | Source unavailable — blocked |

Reviewer's category: **"The necessary source remains unavailable. Keep the result
blocked; do not label it passed."** Not one can be attributed to an Admin-side
regression; none is suppressed; the base's 79/79 is explicitly not claimed as a
candidate pass. Restoring `f11b1dd9` (or repinning with equivalence proof) and
re-running is the only path to moving these.

## 3. Test-count reconciliation (the 1,484th)

`1476 passed + 7 failed + 1 skipped = 1484`. The skip is identified, not assumed:
`tests/unit/anon-cross-tenant-reads.test.ts > "anon holds no EXECUTE on the
booking-data helpers"` runs under `it.skipIf(!baseline.function_grants)` — it executes
only when the baseline fixture carries function-grant data.

## 4. Integration assembly — done, and it surfaced three NEW failures

The reviewer's containment requirement (candidate must contain the actual patches,
not review notes) is now satisfied for Admin. Cherry-picked onto `f84e849`, clean,
no conflicts:

    383c86d  Bound public web chat with shared visitor limits   (was 9d98b8b)
    9aa1fb2  Close reviewed waiver and security catalog gaps    (was a9ce062)
    18cda84  Bound onboarding wizard ingress and shared admission (was 3515480)

Branch `claude/candidate-assembly-2026-09-25`. Patch-id analysis confirms everything
else (C02/C04/C06, C01 deps, proxy, exact-role, v01, v03, edge-resolution, runtime/CI)
was already integrated in `f84e849`.

Focused suites on the assembly: wizard limits 13/13 + credential 5/5, web-chat-limits
(new 173-line suite) passes, checker exceptions 8/8 pass.

**Full sweep on the assembly: 10 failed + 1 collection error (was 7 + 1).** The three
new failures are integration findings only visible with the patches combined:

| Finding | Test | Cause | Needs |
|---|---|---|---|
| A | `rls-initplan` ×2 ("no policy calls current_business_ids() in a per-row filter", "every use of the tenant helper sits inside a subquery") | The C05 baseline regeneration records `check_ins_admin` as `business_id = ANY (current_business_ids())` (from `20260920100000`); the repo's hoisting convention requires the `IN (SELECT unnest(...))` initplan form | Contract decision: correct the policy to the hoisted form (likely, given the BT500 scale rationale) or formally retire the assertion with a reason |
| B | `bot-hardening` ("web-chat rate limiting (P2) throttles per client and returns 429") | The web-chat shared-visitor-limits patch replaces the per-client throttle contract the old test asserts; the new contract has its own passing suite | Contract decision: which throttle contract is approved (or both, scoped) |

These are exactly the "approved change vs genuine regression" adjudications the
reviewer reserved; they are recorded, not patched speculatively. Per-patch testing
passed both patches; only combined testing exposed the conflicts.

## 5. Next actions in order

1. Recover the companion sources from the Codex host's workspace, or execute the
   reviewer's repinning path (compare `12252cf`/`d47c7ce` against intended behavior,
   restore missing pieces, fresh manifest + evidence).
2. Astra adjudicates findings A and B on the assembled candidate; then the seven
   rerun against the exact recovered/repinned pairing.
3. Publish the Admin branch (unpushed 38 + 3 assembly commits) after auto-deploy
   inspection — closes "No commit found" for `f84e849`.
4. `apply_last_minute_deals` freeze-reconciliation query on the deployed DB (one
   query; comment-only difference either way).
5. Then the unchanged remaining gates (V02–V06 evidence) — no new sweeps.

Full reproduction commands and evidence logs are in the review branches
`claude/c05-waiver-crosscheck-2026-09-25`, `claude/c03-wizard-crosscheck-2026-09-25`,
`claude/c01-audit-sweep-2026-09-25`, and this branch.
