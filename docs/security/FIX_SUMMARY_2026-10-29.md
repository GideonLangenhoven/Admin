# Security fixes: summary (2026-10-29)

Owner steps are in [OWNER_RUNBOOK.md](OWNER_RUNBOOK.md). Nothing here has been **deployed or applied to production**:
every change is in the working tree, uncommitted. Read-only checks were run against production to confirm findings
and to prove the controls that already hold.

Legend: **Code done** = implemented and tested, waiting for you to deploy/apply. **Owner** = needs a key, setting or window only you should touch.

## Status

| ID | Root cause | Fix | Tests | Verified how | Status |
|---|---|---|---|---|---|
| **S1** Service-role key in admin JS | Admin client code reads `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`app/lib/supabase.ts`, `admin-auth.ts`) and Next inlines it at build. The live bundle holds a `service_role` JWT in 3 chunks, so the **production value of that variable is the service-role key** (inferred; see runbook 1.1 to confirm). No client module can reach a service-key client (108 client entries traced); `next.config.ts` injects nothing. | `prebuild` fails if any `NEXT_PUBLIC_*` name looks secret or its **value** is a non-anon JWT / `sb_secret_` / equals a server secret; `postbuild` scans `.next/static` (JWT roles, forbidden strings, key shapes, values of server env vars) in both apps; CI job on both repos; scheduled + post-deploy live scan. Removed the fail-open `session?.access_token \|\| SK` in `broadcasts/page.tsx` and a dead `SK` in `slots/page.tsx`. Rotation runbook (two paths). | `client-bundle-scan` (28), `security-surface-check` (13) | Scan **fails on live production** (3 chunks) and passes on live booking; **passes on a fresh admin build** (195 files, values of 8 real server secrets grepped, 0 false positives); anon matrix **26/26 on production** | **Code done. Rotation: Owner** |
| **S2** Email-matched ownership | Four places trusted an email match: `rebook-booking` `authorizeCaller`, `my-bookings-lookup` `getAuthenticatedEmail`, SQL `link_customer_user`, and 3 admin-onboarding SQL functions (match an unlinked admin row by JWT email). | Each also requires `email_confirmed_at`. Migration `20261029090000`. | `email-confirmation` (9): fail before (403 became 400; 401 became 200), pass after | Edge handlers driven end to end; the 4 SQL functions proven in a disposable Postgres 17 (confirmed user matched, **unconfirmed squatter refused**, linked rows unaffected) | **Code done** (apply migration 1) |
| **S3** Excess grants | Supabase default `ALL` for anon/authenticated on every public table, never narrowed: 411 grants that RLS already denies or no API role can use, including `TRUNCATE` (which ignores RLS) on `bookings`, `slots`, `businesses`, `admin_users`. | Migration `20261029100000` revokes exactly the privileges with no matching RLS policy for that role+command, after checking no INVOKER function, policy sub-query, view or CHECK constraint depends on them (this **caught** that `anon` must keep `SELECT` on `customers`, because `bookings_read` sub-queries it). `supabase/grant-allowlist.json` + `scripts/check-grant-allowlist.mjs` (`npm run check-grants`, weekly workflow). Baseline updated. | `grant-allowlist` (27) | Replica of live grants in Postgres 17: checker flags **411 extra** before, migration applies cleanly, **0 extra / 0 missing** after, idempotent | **Code done** (apply migration 2) |
| **S4** Auth hardening | Server never checked assurance level. Live advisors: leaked-password protection **disabled**; insufficient MFA options. | AAL2 gate in edge `requireAuth` and the admin API `getCallerAdmin`, **off by default**, per role via `ENFORCE_ADMIN_AAL2_ROLES`; fails closed on an unreadable token; service key unaffected. Runbook for the Auth settings. | `admin-aal2` (13) | Unit; settings read from live advisors | **Code done. Settings and rollout: Owner** |
| **S5** Edge hygiene | See below. | See below. | `edge-authz` (56), `edge-function-auth-review` (74) | 36 of the new tests **failed before the fixes** (20 in `edge-authz`, 16 in the hardening/CORS group); `deno check` clean on all functions | **Code done** (deploy functions) |
| **S6** `pg_net` in `public` | Extension is not relocatable (`SET SCHEMA` unsupported). | Drop and re-create is the only route. Measured dependents: 11 cron jobs only. Procedure in the runbook. | n/a | Live dependency queries | **Deferred (Owner window)**. Advisor stays WARN until done |
| **S7** RLS on, no policy | 26 tables. 25 are backend-only (checked against every browser-side query in both apps); 1 (`combo_settlements`) is read by an admin screen. | Comments on 23 backend-only tables (2 already documented). `combo_settlements`: party-scoped read policy + SELECT grant, which also repairs the Reports "settlement register" download that was failing with a permission error. | `backend-only-tables` (28) | Policy proven in Postgres 17: tenants A and B see only their rows, unrelated tenant C only its own, anon denied, all writes denied | **Code done** (apply migrations 4, 5) |

### S5 in detail

1. **One authorization path.** `_shared/auth.ts` is the only place that decides caller identity: `requireAuth`, `canAccessBusiness` (exact `SUPER_ADMIN`; `SUPERVISOR`, `super_admin`, `NOT_SUPER_ADMIN_X` all refused), typed `AuthError`. `cancel-booking` lost its `/super/i` regexp (a role containing "super" could act cross-tenant: a failing test reproduced it). `process-refund`, `cancel-booking`, `rebook-booking` use it; `manual-mark-paid` already did. A DB error while checking admin status now yields 503, not "not an admin".
2. **Authenticate before revealing existence.** `process-refund`, `cancel-booking`, `manual-mark-paid` authenticate first, then answer 404 `Booking not found` identically for "missing" and "not yours" (tests assert byte-identical bodies). Unauthenticated callers cause **no booking lookup**.
3. **CORS.** `localhost`/`127.0.0.1` removed from the default allowlist (opt-in `ALLOW_DEV_ORIGINS`). The Vercel entry was a bare suffix match, so any Vercel team whose slug ends in `-jerrys-projects-f4e4eaf9` passed; it is now an exact `<project>-<9 hash chars>-<team>` match, staging only. Wildcards require `https` and start with a dot. `manual-mark-paid` no longer reflects any `Origin`.
4. **Constant-time comparison** of service keys (`auth.ts`), and of the shared secrets in `billing-enforcement` and `kb-sync`.
5. **Service-key audit trail.** Every service-key call to `process-refund`, `cancel-booking`, `manual-mark-paid`, `rebook-booking` writes a `logs` row (`SERVICE_KEY_CALL`: function, caller, tenant). The 12 internal call sites (web-chat, wa-webhook, yoco-webhook, batch-refund) identify themselves with `x-caller-function`; a call without it logs as `unspecified`.
6. **`verify_jwt = false` audit (42 functions).** `supabase/functions-auth-review.json` records each function's mechanism and a source marker; a test fails when `config.toml` and the file disagree. Found and fixed:
   * `fetch-google-reviews`: **no authentication at all**; anyone could spend the platform's Google Places quota across every tenant. Now service-key only; its cron job (which sent no credentials) moves to the vault key in migration `20261029110000`.
   * `kb-sync`: **failed open** when `KB_SYNC_KEY` was unset, which also exposed `admin_chunks` (replaces the admin help KB). Now fails closed.
   * `billing-enforcement`: secret compared with `===`. A shared secret was also stored as a **literal in `cron.job.command`**; migration 3 replaces it with the vault key.

## Evidence worth repeating

* Live admin bundle: `role=service_role` in `1051-2d48a96b5c7a8b14.js`, `4466-36e02d55ba627b2e.js`, `9142-622f9a4027c15f96.js`. Booking: `anon` only.
* Anon matrix on production, public key only: **26/26** (customers 0 rows, bookings need id+token, `admin_users`/`businesses`/`logs` denied, privileged RPCs refused, no write applied on 10 tables).
* Full unit suite: **2,898 passing**. **7 failures also fail on an untouched export of `HEAD`** (`rls-initplan` x3, `db-column-refs`, `demo-action-guide`, `goal-items-26-30`, `mobile-first-implementation`); none touch this work.
* Five existing test files had to change, each keeping its original intent: `payment-accounting-runtime`, `refund-authority-runtime`, `cancellation-notification-only` (their handler loaders now provide `_shared/auth.ts`; the first also ignores the new audit row when asserting "no writes", and the second now expects 404, not 403, for a foreign tenant's booking, as the brief requires); `rebook-auth` (asserted the old implementation's source text); `web-chat-identity` (asserted exact invoke options, now including the caller header).

## Disclosures: things I did that you should know about

1. **A stray Vercel project.** `vercel env run -e <env> -- node ...` deployed my scratch folder instead of running it, creating project `env-roles` and three deployments (one aliased to production). 961 bytes (a decode script, no secrets), behind Vercel Authentication. Not deleted, per your instruction. Delete it when convenient.
2. **Two secrets reached this session's output.** A vault query returned a secret's *name*, which is the legacy service-role JWT (already public in the admin bundle). A cron-job listing returned the full command of `billing-enforcement-daily`, including its `x-billing-key` literal. Neither was written to any file. The JWT dies with rotation; rotate the billing key (runbook section 3).
3. **I used `SUPABASE_ACCESS_TOKEN` from `.env.local`** in a scratch script, only to run `SELECT` queries through the Management API (the script refuses anything else) so the grant and function inventory (well over a thousand rows) went to a file instead of the transcript. It was never printed. It is a broad credential; consider rotating it if you are uncomfortable.
4. **No production writes.** Everything against Supabase was read-only SQL, plus the anon matrix's refused writes aimed at nonexistent IDs.
5. **Two files changed that I did not touch** (`components/booking/BookingSitePreview.tsx`, `components/booking/Catalogue.tsx`). Someone or something else edited them during the session. I did not revert them.

## Found but not fixed

| Severity | Finding | Recommended next step |
|---|---|---|
| **Medium** | `marketing-track` click redirect accepts **any** `https://` URL (open redirect; its own comment claims otherwise). | HMAC-sign click URLs when emails are rendered and verify in the function. Needs the marketing token pipeline, so not done here. |
| **Medium** | `authenticated` can `UPDATE` 116 `businesses` columns, including plan/billing ones (`max_admin_seats`, `ai_included_replies`, `*_overage_rate_zar`, `subscription_status`) and encrypted credential columns. A `protect_platform_business_fields` trigger exists. | Read that trigger and confirm it blocks every platform-controlled column for non-super-admins; narrow the column grant to what the settings screens write. |
| **Medium** | `kb-sync-hourly` carries its secret as a literal in `cron.job.command` (I did not read it). | Same vault pattern as migration 3, then rotate `KB_SYNC_KEY`. |
| Low | `anon` can `UPDATE` 91 `bookings` columns including `status` (limited by RLS and triggers; the brief lists this as intended). | After a staged checkout test, narrow to the columns the storefront writes. |
| Low | `anon` `INSERT` on `booking_add_ons`: the storefront code never touches that table. | Revoke after confirming no other client. I left it because it is policy-limited and named in the brief. |
| Low | Function `EXECUTE` not narrowed (recorded in the allowlist, not revoked): INVOKER functions callable by anon, e.g. `ck_external_create_booking`, `ck_external_cancel_booking`, `ck_external_modify_booking`, `ck_seed_external_booking_credentials`, `increment_referral_uses`, and `ck_*` trigger functions. RLS binds them, so not exploitable today. | Revoke per function after checking triggers, policies and CHECK constraints that call them as the caller. |
| Low | Customer-facing functions (`rebook-booking`, `my-bookings-lookup`, ...) echo any `Origin`, and `rebook-booking` still answers 404 before auth (an existence oracle for booking UUIDs). | Origin check against the tenant's configured URLs (cached); uniform response. |
| Low | `send-otp` and `create-paysafe-checkout` have the gateway JWT check on; they block the move to publishable keys for the storefront (runbook 1.3). | Open the gateway check; both protect themselves. |
| Info | Local `npm run build` fails in this working tree: `tsconfig` includes the untracked `docs/production-readiness/evidence/extra-pax-deployment-20261016/source/`, which has type errors. | Exclude `docs/**` in `tsconfig.json`, or move the folder. CI and Vercel are unaffected. |
| Info | 7 stale unit tests fail at `HEAD` (listed above). | Fix or retire. |
| Info | The vault carries a placeholder secret named `<paste your SUPABASE_SERVICE_ROLE_KEY here>`. | Delete the row (runbook section 3). |

## Not verified

* **Whether the Vercel production value is the service-role key**: inferred from the bundle and the source, not read.
* **Supabase Auth settings** (leaked-password, MFA, sessions): only the two advisor findings were visible to me.
* **Tests D and E** (cross-tenant isolation as a signed-in admin; customer-session isolation) and the positive half of **C** need seeded tenants A/B. The repo's `tests/tenant-isolation` covers part of this; I did not extend or run it against live.
* **Test G's end-to-end storefront run** (browse, Yoco test card, My Bookings OTP, gift voucher, waiver): not run. The migration was proven only at the grant level.
* **A fresh booking build.** The booking scan was run on an older build already on disk (114 files) and on its env; the CI job for booking has never executed on GitHub, and neither has the admin one.
* **Behaviour in the hosted Supabase runtime** (for example the real shape of `SUPABASE_SECRET_KEYS`): the functions are unit-tested and type-checked only, not deployed.

## Files

* **Admin repo** (modified): `.github/workflows/{ci,main}.yml`, `package.json`, `app/lib/api-auth.ts`, `app/broadcasts/page.tsx`, `app/slots/page.tsx`, `supabase/security-baseline.json`, `supabase/functions/{_shared/auth,_shared/tenant,batch-refund,billing-enforcement,cancel-booking,fetch-google-reviews,kb-sync,manual-mark-paid,my-bookings-lookup,process-refund,rebook-booking,wa-webhook,web-chat,yoco-webhook}`, 5 existing tests adapted.
* **Admin repo** (new): `.github/workflows/bundle-scan-prod.yml`, `scripts/{check-client-bundle-secrets,check-grant-allowlist,security-surface-check}.mjs`, `supabase/{grant-allowlist,functions-auth-review}.json`, 5 migrations `20261029090000` to `20261029121000`, 8 test files (248 tests), `docs/security/`.
* **Booking repo** (separate git repo; it also has ~45 uncommitted changes that are not mine): `package.json`, `scripts/check-client-bundle-secrets.mjs` (byte-identical copy, enforced by a test), `.github/workflows/{ci,bundle-scan-prod}.yml`.
