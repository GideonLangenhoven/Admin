# C01 audit triage + integrated-candidate regression sweep — 2026-09-25

Reviewer: Claude Code session (not Astra, not Sol). Supporting evidence only.
Targets: Admin integration tip `f84e849` (worktree, lockfile-exact install).

## C01 — dependency audit triage (Admin)

| Lockfile | Result |
|---|---|
| Candidate `f84e849` (928 packages) | **0 vulnerabilities** — full and `--omit=dev` |
| Pre-candidate `1812677` (feature/simple-view) | 27 vulnerabilities: 2 critical, 10 high, 13 moderate, 2 low |

Pre-candidate critical/high advisories and their candidate dispositions:

- `next` <=16.3.2 (critical, DoS via Server Components) -> pinned **16.3.3**
- `vitest` <=4.1.10 (critical, UI-server file read) -> fixed in candidate toolchain
- `postcss` <=8.5.22 (high, CSS stringify XSS) -> pinned **8.5.23**
- `sharp` <=0.35.4-rc.0 (high, libvips CVE-2026-33327/33328/35590/35591) -> pinned **0.35.4**
- `xlsx` * (high, prototype pollution, no fixed release) -> dependency removed;
  the spreadsheet import path (`app/marketing/contacts`) uses `read-excel-file@9.3.10`
- brace-expansion, browserslist, fast-uri, js-yaml, nanoid, vite, ws (high) -> transitively
  resolved in the candidate lockfile (audit reports zero)

Runtime enforcement verified: `package.json` pins `engines >=22.23.2 <23` with
`engine-strict=true`; `npm ci` on Node 22.22.1 (this machine's only Node) is
correctly refused. Disposition is enforced, not inferred. CI pin 22.23.2/npm 10.9.8
per STATE.md. This machine needs Node >=22.23.2 before builds reproduce exactly.

Edge/remote dependencies: `deno.lock` frozen graph; `npm run check:edge` passes for
all 55 functions (also re-run on the C03 wizard patch).

**Companions not auditable from this machine.** The booking and onboarding repos'
lockfiles could not be re-audited: the onboarding repo is not checked out anywhere
here, and the nested `booking/` clone does not contain the pinned candidate (below).
STATE.md's "full and production audits are zero" for both companions therefore
remains unverified external evidence.

## Candidate regression sweep (tests/unit on f84e849)

    1484 tests: 1476 passed, 1 skipped, 7 failed (+1 file collection error)
    across 109 files, Node 22.22.1 (engine floor overridden for install), 22.5 s

First run without the companion checkout showed 15 failures; 8 were caused by
tests reading `booking/` paths that do not exist in a bare Admin worktree
(`booking/` is the nested companion repo in the user's checkout). After symlinking
the local `booking/` clone, 7 failures remain in 6 files:

`storefront-checkout-updates` (collection), `booking-success-access`, `img-proxy-ssrf`
(2 tests), `mobile-first-implementation` (2 tests), `partial-voucher-checkout`,
`web-chat-identity`.

Characterization — **pairing skew, not established Admin regressions**:

- All 6 files assert against `booking/` companion source (plus two that also read
  `supabase/functions`).
- The same 6 files pass 79/79 at base `52afaff` with the identical `booking/`
  checkout and toolchain, so the failures enter with the integration branch's
  updated tests.
- The local `booking/` checkout is `b7c65e3` on `scale-security-2026-07-04`, but the
  release manifest pins companion `f11b1dd94b662d8570f06e64088da8e832fbaaeb`.
  **That commit is absent from the local clone even after `git fetch --all`, absent
  from the GitHub remote, and absent as a dangling object.** The prompt's historical
  anchor `2ff1d82` survives only on local branch
  `codex/bookingtours-mobile-readiness-2026-09-21`.

Verdict: the sweep cannot certify the candidate/companion pairing until the pinned
companion source is restored (or the pair is re-pinned to a surviving commit and the
tests re-run). The 7 failures are consistent with tests written against `f11b1dd9`
source that the local `b7c65e3` checkout does not match; they are not proof of a
defect in either artifact.

## Consequences for the ledger

1. **C01 (Admin scope): locally satisfied** — zero audit findings on the candidate,
   enforcement verified. Companion scope is `BLOCKED_EXTERNAL` on source/access.
2. **Evidence-continuity finding (V06-adjacent):** two of three release artifacts
   (storefront `f11b1dd9`, onboarding `2de7de49`) are not present in any reachable
   or orphaned git object on this machine or the fetched remotes; they survive only
   in the Codex session's records. Restore them (the Codex host's clones — its
   transcript ran under `/root/...` paths, not on this Mac) or the release manifest
   cannot bind the exact artifacts. This is the concrete form of STATE.md's
   "companion publication/access ... externally unverified".
3. Candidate unit health apart from pairing: 1476/1484 pass locally; the C03 and C05
   patches' focused suites (18/18, 8/8, 11/11) pass in their own worktrees.

## Reproduction

    git worktree add <dir> f84e849 && cd <dir>
    npm ci --ignore-scripts --engine-strict=false   # Node >=22.23.2 required for strict
    ln -s <repo>/booking booking                    # nested companion checkout
    npm audit --json                               # 0 vulnerabilities
    npx vitest run tests/unit                      # 1476 pass / 7 fail (pairing skew)
    # base comparison: same 6 files at 52afaff -> 79/79 pass
