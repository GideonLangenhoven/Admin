# C03 onboarding wizard ingress patch — independent cross-check

Reviewer: Claude Code session (not Astra, not Sol). Date: 2026-09-25.
Scope: read-only adversarial review + independent reproduction of `3515480`
("Bound onboarding wizard ingress and shared admission", base `307d6cb`).
Astra xHIGH review remains the authoritative acceptance gate; this is supporting evidence.

## Verdict

**Patch is sound. Recommend acceptance for integration.** All documented claims
reproduced; two environment prerequisites and two accepted design limitations noted.
No security or correctness defect found in the diff.

## Integrity

All three changed files match the (since-deleted) handoff evidence byte-for-byte:
`index.ts` b313617c…, limits test 66f215f9…, credential test a533d807…
(SHA-256 recomputed from the branch tip).

## What the patch does (diff reviewed in full)

- **Admission redesign**: the old per-IP limiter trusted a forwarded-IP header,
  allowed unlimited traffic without one, and failed open on RPC errors. New model:
  one shared admission bucket (key `"public"`, 200x per-action cap, checked before
  invite lookup) plus a per-tenant bucket (key = resolved business_id). RPC
  errors/timeouts return 503 (fail closed); denials return 429 with `Retry-After`.
  No forwarded-IP trust remains.
- **Action guard**: `action in RATE_LIMITS` -> `Object.hasOwn(...)`, closing
  prototype-key actions (e.g. `"constructor"`) passing the known-action check.
- **DNS SSRF guard**: `records.every(isPrivate)` -> `records.some(isPrivate)`; a
  mixed public/private answer set is now rejected (rebinding partial-answer hole).
- **Bounded reads**: request body 256 KB / 3 s with stream cancellation (413/408);
  Places fetch 5 s deadline + 64 KB response cap + 256-char query + 5-candidate cap;
  website scrape now truncates to 200 KB even on a single large chunk (old code
  tracked `total` but appended whole chunks).
- **Batch preflight**: tours validated and slot work computed (max 50 tours, 100
  ranges, 24 times/range, 5,000 generated slots) before the first write;
  `buildSlotRows` verified write-free.

## Verification points beyond the tests

- `check_rate_limit(p_ip text, p_endpoint text, p_max integer)` — `p_ip` is **text**,
  so the `"public"` and UUID bucket keys are type-valid; EXECUTE is service-only.
  Body is an atomic `INSERT ... ON CONFLICT DO UPDATE ... RETURNING count` per
  minute window (fixed window: 2x burst at boundaries is an accepted guard-rail
  limitation; concurrency proof reused from web-chat per handoff).
- Rate decisions are fail-closed on unexpected return values (`data === true/false`
  else "unavailable" -> 503).
- Tests are behavioral: real handler source loaded with trapped module mocks
  (unexpected tables/provider calls throw); they assert denial happens with zero
  invite reads, byte/time bounds fire before database work, and the DNS guard
  rejects any private answer.

## Independent reproduction (this session)

Env: Deno 2.9.4, Node 22.22.1 (see prerequisite below), lockfile-exact `npm ci`.

- Integrity hashes: 3/3 match.
- `npx vitest run` on both changed test files: **18/18 PASS** (matches claim).
- Red demonstration: the same limits test against unfixed parent `307d6cb`:
  **13/13 FAIL** — the tests bite on every guard.
- `npx eslint` on the three changed files: clean.
- `npm run check:edge` (the project's frozen Deno check): **exit 0,
  "Frozen Deno 2.9.4 check and bundle passed for 55 functions"** (matches claim).
  A raw `deno check <file>` is not the project's command and fails on npm type
  resolution; the script is the prescribed harness.
- `npx tsc --noEmit` after lockfile-exact install: **clean (exit 0, empty output)**
  (matches claim). An earlier run showed 8 errors in `app/marketing/contacts/page.tsx`;
  those were an artifact of reusing another branch's `node_modules` (missing
  `read-excel-file`, declared at this commit as `^9.3.10`). Parent-vs-patch error
  logs were identical, so the patch adds no type errors either way.

## Prerequisites and accepted limitations

1. **Node engine floor**: `package.json` pins `engines >=22.23.2 <23` with
   `engine-strict=true`; `npm ci` refuses on Node 22.22.1. Enforcement is working
   (C01 disposition is enforced, not inferred). This Mac has only brew `node@22`
   22.22.1; the faithful install used `--engine-strict=false` (recorded deviation).
   Dev machines and CI must run Node >=22.23.2 before release builds are reproducible.
2. **Shared limiter configuration must exist before deployment** — fail-closed 503
   is intentional (already recorded in STATE.md; Redis service identity pending).
3. DNS rebinding TOCTOU between resolution and fetch remains open (handoff lists it
   as a separate public-fetch V01 follow-up); this patch closes only the
   mixed-answer admission hole.
4. Fixed-minute limiter windows allow 2x burst at window boundaries (accepted).

## Reproduction commands

    git worktree add <dir> 3515480 && cd <dir>
    npm ci --ignore-scripts            # Node >=22.23.2 required
    npx vitest run tests/unit/onboarding-wizard-limits.test.ts tests/unit/yoco-credential-settings.test.ts
    npx tsc --noEmit
    npx eslint supabase/functions/onboarding-wizard/index.ts tests/unit/onboarding-wizard-limits.test.ts tests/unit/yoco-credential-settings.test.ts
    npm run check:edge
    # red: copy limits test onto 307d6cb worktree and run it -> 13/13 fail
