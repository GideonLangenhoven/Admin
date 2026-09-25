# C05 waiver/permission-baseline patch — independent cross-check

Reviewer: Claude Code session (not Astra, not Sol). Date: 2026-09-25.
Scope: read-only adversarial review + independent reproduction of the frozen patch
`a9ce062` ("Close reviewed waiver and security catalog gaps", base `e9bea35`).
Astra xHIGH review remains the authoritative acceptance gate; this is supporting evidence.

## Verdict

**Patch is sound and minimal. Recommend acceptance for integration.**
Two non-blocking observations (below). Sol's claimed 8/8 checker tests and 11/11
local PostgreSQL checks were independently reproduced, including a red run proving
the tests fail on unfixed code.

## What was reviewed

Single commit `a9ce062`, 5 paths:

| Path | Nature |
|---|---|
| `supabase/migrations/20260923140000_waiver_and_client_trigger_paths.sql` | 3 client-originating definer paths corrected |
| `scripts/security-drift-audit.mjs` | checker strengthened + hash-pinned exceptions |
| `supabase/security-baseline.json` | regenerated catalog delta (2026-09-23) |
| `tests/security-drift-reviewed-exceptions.mjs` | 8 checker unit tests (new) |
| `tests/tenant-isolation/waiver-closeout.mjs` | 11 disposable-PostgreSQL checks (new) |

## The vulnerability and its fix (verified)

Old `sign_waiver` guard: `v_token <> p_waiver_token`. Under SQL three-valued logic,
a caller-supplied `p_waiver_token = NULL` against a booking with a real token makes
this predicate NULL (falsified), so the guard fails OPEN. The signing UPDATE does not
match (`waiver_token = NULL`), but the function returned `{ok: true}` and the
DOB marketing-contact sync still ran — unauthenticated contact/DOB poisoning keyed
only on a booking UUID. Red run reproduced exactly:

    actual:   { ok: true }
    expected: { ok: false, error: 'invalid_token' }

Fix `IS DISTINCT FROM` is the correct null-safe comparison. Old/new bodies are otherwise
identical except `search_path = pg_catalog, public, pg_temp` and full `public.`
qualification of five relation references. No behavior change to signing, DOB parsing,
idempotent replay, expiry, or the two trigger functions.

## Reproduction (independent, this session)

Env: PostgreSQL 17.11 (Homebrew, disposable initdb cluster), Node 22.22.1.
Worktree at `a9ce062`, isolated.

- `node tests/security-drift-reviewed-exceptions.mjs` → **8/8 PASS** (checker accepts
  exact reviewed metadata; detects body/ACL/effective-authority/owner/signature/view
  changes; yoco_test_mode write protection remains).
- `node tests/tenant-isolation/waiver-closeout.mjs <disposable-socket>` (no `--fixed`)
  → **fails** at check 1 with `{ok: true}` vs `{ok:false}` (red, above).
- `node tests/tenant-isolation/waiver-closeout.mjs <disposable-socket> --fixed`
  → **11/11 PASS** (NULL/wrong/missing/expired/stored-NULL tokens denied without
  mutation; valid signing + DOB sync + idempotent replay; malformed DOB does not
  block signing; marketing-contact trigger semantics preserved incl. curated-name
  and unsubscribed-status preservation; exact active SUPER_ADMIN business edit audited
  without values, suspended admin not audited; all three corrected paths verified on a
  real catalog; checker accepts the corrected paths on real PostgreSQL).

The disposable cluster was destroyed after the run.

## Design points verified

- **Baseline deltas trace to real migrations.** The seven removed authenticated grants
  are `businesses` UPDATE + six `slot_check_ins` privileges; `20260921120000` revokes
  businesses/table+column UPDATE and `20260920100000` revokes all `slot_check_ins`
  but SELECT (writes go through service-only RPCs). The 14 added service grants and two
  service-only RLS tables (`mfa_recovery_state`, `notification_jobs`) match
  `20260921120000`/`20260921140000`. The `check_ins_admin` predicate change
  (`IN unnest(...)` → `= ANY(current_business_ids())`) matches the policy text in
  `20260920100000`. No rubber-stamped drift detected.
- **`yoco_test_mode` disposition is deliberate and scoped.** Removed only from the
  anon-SELECT secret set (public test-mode indicator, explicitly preserved per
  STATE.md); it remains in `protectedBusinessUpdates` and is column-REVOKE'd from
  client roles in `20260921120000`. Reads public, writes MFA/service-gated.
- **Hash-pinned exceptions are fail-closed.** The 20 reviewed `search_path=public`
  functions and the `operator_directory` owner-rights view are exempted only when
  definition MD5, owner `postgres`, exact settings, and exact client grants all match,
  and only while `public` is not client-writable (`writableSchemas` gate). Any drift
  re-flags. The exception mechanism was tested adversarially (5 mutation classes).
- **Temp-shadowing residual does not bite the client-executable set.** `search_path=public`
  leaves implicit pg_temp-first shadowing possible in principle; the only reviewed
  functions with `authenticated` EXECUTE (`get_my_admin_onboarding`,
  `complete_my_admin_onboarding`, `set_my_help_chat_hidden`) have fully qualified
  relation references (verified in source). The rest are service-role-only.

## Non-blocking observations (not regressions of this patch)

1. `sign_waiver`'s UPDATE has no `FOUND`/`RETURNING` check: a concurrent token rotation
   between the SELECT and UPDATE yields `{ok: true}` without signing. Cosmetic,
   pre-existing; self-service UI would show success once. Consider a follow-up if
   token rotation becomes a real flow.
2. Waiver signing creates/updates `marketing_contacts` whenever a DOB is present,
   with no explicit marketing-consent field checked (pre-existing since
   `20260717145119_sign_waiver_dob_sync.sql`). Consent/POPIA behavior of this path
   should be confirmed under V01's consent coverage, not changed here.

## Limitations of this review

- ~~The 20 frozen `definitionMd5` values were captured from a reviewed database; this
  review verified the freeze mechanism and source-level bodies but could not
  independently re-derive the hashes.~~ **Closed 2026-09-25: see MD5 re-derivation below.**
- No live/hosted database was touched; `npm run check-security-drift` against a deployed
  target was not run (requires DATABASE_URL and is out of scope for this pass).
- Effective permissions were exercised on PostgreSQL 17.11 locally via the test
  fixtures, not against the deployed Supabase project.

## MD5 re-derivation (2026-09-25, limitation closed)

Every frozen hash was re-derived from migration source in a disposable PostgreSQL 17.11
catalog (fixture tables + each function's definition extracted from the migration
folder; `pg_get_functiondef`/`pg_get_viewdef` normalization makes source formatting
irrelevant): **19/19 function hashes and the `operator_directory` view hash
(`1af5943a…`) match the frozen values exactly.** The freeze is faithful to source.

Two extraction notes for anyone repeating this:

1. `get_my_admin_onboarding` has four definition sites; the final one is
   `CREATE FUNCTION` (no OR REPLACE, after a DROP) in `20260712090000_help_chat_hidden_pref.sql`
   and its return type grew a column (`help_chat_hidden`). Matching the frozen
   `7415339c…` requires that final variant rendered verbatim (SQL-language bodies
   render as stored source when created without validation; the capture environment
   rendered the same way — confirmed because `set_my_help_chat_hidden`, also
   `LANGUAGE sql`, matches under the same conditions).
2. `apply_last_minute_deals`: the frozen `77c22eaf…` equals the
   `20260804134933` definition. The lexically-later
   `20260804160000_last_minute_deals_follow_config.sql` re-defines it with
   **comments only** (zero functional delta), so a strict full-folder replay ends
   with hash `3d4ad428…` and the checker would flag it. One reconciliation needed
   before the checker runs against the real target: query
   `md5(pg_get_functiondef(oid))` for `apply_last_minute_deals` on the deployed DB
   and align the freeze to the deployed state (if `77c22eaf`, the deployed DB never
   applied the 160000 re-issue and that duplicate-migration question belongs to
   V06's ledger review; if `3d4ad428`, re-freeze). Comments only either way: no
   security delta.

## Reproduction commands

    git worktree add /private/tmp/c05-review-a9ce062 a9ce062
    cd /private/tmp/c05-review-a9ce062
    ln -s <repo>/node_modules node_modules            # for `pg`
    node tests/security-drift-reviewed-exceptions.mjs
    initdb -D /private/tmp/capekayak-db-test-<rand> -U $USER --no-sync
    pg_ctl -D ... start -o "-k <sockdir> -h '' -p 55432"
    ROLLOUT_TEST_PORT=55432 node tests/tenant-isolation/waiver-closeout.mjs <sockdir>          # red
    ROLLOUT_TEST_PORT=55432 node tests/tenant-isolation/waiver-closeout.mjs <sockdir> --fixed  # green
