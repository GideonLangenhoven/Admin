# Security fixes: owner runbook (2026-10-29)

Steps only the project owner should perform: key rotation, Vercel and Supabase settings, applying migrations, and the
`pg_net` maintenance window. Nothing in this repo performs them. This document contains **no secret values**; refer
to secrets by name.

Companion: [FIX_SUMMARY_2026-10-29.md](FIX_SUMMARY_2026-10-29.md) (what changed, tests, what was not fixed).

---

## 0. Read this first

* The legacy **service-role JWT** (`role=service_role`, project `ukdsrndqhsatjkmxijuj`, expiry 2036) is publicly
  downloadable from `admin.bookingtours.co.za` today, in three chunks: `1051-*.js`, `4466-*.js`, `9142-*.js`.
  Treat it as **compromised now**. Anyone holding it bypasses every RLS policy.
* The code fix is merged first and is safe to deploy: the build now refuses to ship when a `NEXT_PUBLIC_*` variable holds a
  non-anon JWT, so **deploying this code with the bad Vercel value still in place will fail the build** (by design).
  Fix the value (section 1) before you deploy.
* Do **not** run a repo-wide `supabase db push` or `--include-all`. Apply only the migrations listed in section 2, one at a time.
* The scratch Vercel project named **`env-roles`** (team `jerrys-projects-f4e4eaf9`) was created by mistake during this
  work. It holds one 961-byte script and no secrets. Delete it from the Vercel dashboard when convenient. It is unrelated to
  `caepweb-admin` and `booking`.

---

## 1. S1: rotate the leaked key

### 1.1 Confirm the cause (2 minutes)

Vercel dashboard, project **caepweb-admin**, Settings, Environment Variables. Open `NEXT_PUBLIC_SUPABASE_ANON_KEY`
for **Production**, then Preview and Development. Reveal the value and decode the middle segment (or paste it into a
local `node -e 'console.log(JSON.parse(Buffer.from(process.argv[1].split(".")[1],"base64url")))' <value>`). The `role`
claim should be `anon`. If it says `service_role`, that is the root cause: the variable was set to the wrong key.

The source is not at fault: no client module can reach a service-key client (108 client entry modules traced), and
`next.config.ts` injects nothing. The browser reads exactly `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY`
(`app/lib/supabase.ts`, `app/lib/admin-auth.ts`), which Next inlines at build time.

### 1.2 Places that may hold the legacy service key

| Where | What to do |
|---|---|
| Vercel `caepweb-admin`: `NEXT_PUBLIC_SUPABASE_ANON_KEY` (all 3 environments) | Replace with the **anon** or **publishable** key (see 1.3). |
| Vercel `caepweb-admin`: `SUPABASE_SERVICE_ROLE_KEY` (all 3) | Replace with a new `sb_secret_...` key. |
| Vercel `booking`: both of the above | Check and replace the same way. (The live storefront bundle is clean today.) |
| **Supabase Vault**: one secret whose **name** is the service-role JWT (found during this work; its value is empty or a placeholder) | After rotation, delete the row: `delete from vault.secrets where name like 'eyJ%';` (check what it matches first with `select id, left(name, 6) from vault.secrets where name like 'eyJ%';`). The name is readable by anyone with database admin access. |
| Supabase Vault `edge_jobs_service_role_key` | Already an `sb_secret_...` key. Used by the cron jobs. Keep. |
| `pg_cron` job commands | Checked: none embeds a JWT or `sb_secret_` literal. One embeds a different shared secret (section 3). |
| Edge-function secrets `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEYS` | Confirm they hold `sb_secret_...` (Dashboard, Edge Functions, Secrets lists names only; re-save with the new value if unsure). |
| Local `.env.local` files, CI secrets, scripts | `.env.local` already uses `sb_secret_...`. Search your machine and GitHub Actions secrets for any `eyJ` service key. |
| The leaked chunks themselves | Already public. Rotation is the only remedy. |

### 1.3 Choose a path

**Path A: new API keys (recommended).** Switch both apps to the publishable key, switch every server to a
`sb_secret_...` key, then **disable the legacy keys** in Project Settings, API Keys, "Legacy API keys". Nobody is signed
out. This kills the leaked JWT and the old anon JWT.

> **Prerequisite for the storefront.** A publishable key is not a JWT. Two functions the storefront calls anonymously
> still have the gateway JWT check **on**: **`send-otp`** (My Bookings sign-in) and **`create-paysafe-checkout`** (combo
> checkout). With a publishable key they would return 401 at the gateway. Before switching the **booking** project to the
> publishable key, add to `supabase/config.toml`:
>
> ```toml
> [functions.send-otp]
> verify_jwt = false
> [functions.create-paysafe-checkout]
> verify_jwt = false
> ```
>
> then add both to `supabase/functions-auth-review.json` (suggested: `send-otp` as `public-by-design`, marker
> `OTP_EMAIL_SEND_LIMIT`; `create-paysafe-checkout` as `capability-token`) and update the "short and deliberate" list in
> `tests/unit/edge-function-auth-review.test.ts`. This is security-neutral (the anon key is public, and `send-otp` has
> its own email and IP rate limits), but it moves money, so review it. Deploy both functions and test My Bookings OTP and a
> combo checkout **before** disabling legacy keys. The admin app is not affected: signed-in calls carry the user's JWT.

**Path B: rotate the project JWT secret.** Project Settings, JWT Keys. This replaces the anon **and** service-role
keys and signs out every user. Update every Vercel env var and edge secret with the new keys. Simpler, but disruptive,
and the booking site breaks until its env var is updated and redeployed.

### 1.4 Path A, in order

1. Project Settings, API Keys. A `default` publishable key (`sb_publishable_...`) already exists and is enabled. Create a
   new secret key (`sb_secret_...`, name it e.g. `backend-2026-10`). Copy both into your password manager.
2. If you are switching the booking site: do the prerequisite above first.
3. Vercel, **caepweb-admin**: set `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Production, Preview, Development) to the publishable key
   and `SUPABASE_SERVICE_ROLE_KEY` to the new secret key. Same for **booking** if applicable.
4. Supabase Edge Functions, Secrets: set `SUPABASE_SERVICE_ROLE_KEY` to the new secret key if it is not one already.
5. Update the vault: `select vault.update_secret(id, '<new sb_secret_ value>') from vault.secrets where name = 'edge_jobs_service_role_key';`
   (skip if the current value is already the key you are keeping).
6. Redeploy admin and booking. The build now runs `check-client-bundle-secrets.mjs env` before and `... static` after.
   A failure means a variable is still wrong; the message names the variable, never the value.
7. Run the checks in 1.6. Only when they pass, **disable the legacy keys** (API Keys, Legacy API keys tab).
8. Run test B (1.6) with the old key.
9. Delete the vault secret named after the JWT (1.2).

### 1.5 Path B, in order

1. Take note of the new anon and service-role keys after rotating (Project Settings, JWT Keys).
2. Update Vercel (both projects, all environments), edge secrets, vault `edge_jobs_service_role_key`, local `.env.local`.
3. Redeploy both apps. Users sign in again.
4. Run 1.6.

### 1.6 Verify

```bash
# Test C (anon access matrix; the public key only; read-only apart from refused writes). Expect 26/26.
SUPABASE_URL=https://ukdsrndqhsatjkmxijuj.supabase.co SUPABASE_ANON_KEY=<publishable or anon key> \
  node scripts/security-surface-check.mjs anon

# Test B (owner-run; the retired key is dead). The key goes in the environment, never on the command line.
read -rs OLD_KEY && export OLD_KEY
SUPABASE_URL=https://ukdsrndqhsatjkmxijuj.supabase.co node scripts/security-surface-check.mjs old-key

# Test A against production (every script the live pages load)
node scripts/check-client-bundle-secrets.mjs url https://admin.bookingtours.co.za
node scripts/check-client-bundle-secrets.mjs url https://booking.bookingtours.co.za
```

Test A against production is expected to **fail today** (three chunks) and pass after redeploy.

---

## 2. Applying this change set

Apply **one migration at a time**, in this order, using the controlled-package procedure you already use (a placeholder
workdir containing only these files, with a dry run first; never a repo-wide push, because ~34 older migration files are
mis-versioned). Each is forward-only.

| Order | File | Effect | Reversible? |
|---|---|---|---|
| 1 | `20261029090000_require_confirmed_email_matching.sql` | 4 SQL functions also require a confirmed email | Re-apply the previous function bodies |
| 2 | `20261029100000_revoke_unused_api_grants.sql` | Removes 411 unused grants from anon/authenticated | `GRANT` them back; see the allowlist diff |
| 3 | `20261029110000_cron_jobs_use_vault_service_key.sql` | `fetch-google-reviews` and `billing-enforcement` cron jobs now send the vault key | Re-run `cron.alter_job` with the old command |
| 4 | `20261029120000_combo_settlements_party_read.sql` | Both parties to a settlement can read it (fixes the Reports "settlement register" download) | `DROP POLICY`, `REVOKE SELECT` |
| 5 | `20261029121000_document_backend_only_tables.sql` | Comments only | n/a |

Then:

1. `npm run check-security-drift` (needs `DATABASE_URL`) must exit 0. `supabase/security-baseline.json` was updated for
   migrations 2 and 4 (411 grant rows removed, 1 grant and 1 policy added). Run it **after** applying; before, it reports
   exactly that difference.
2. `npm run check-grants` (same `DATABASE_URL`) must exit 0. This is test G.
3. Deploy edge functions: `fetch-google-reviews` **after** migration 3 (otherwise its next run gets a 401), then
   `process-refund`, `cancel-booking`, `manual-mark-paid`, `rebook-booking`, `my-bookings-lookup`, `kb-sync`,
   `billing-enforcement`, `batch-refund`, `web-chat`, `wa-webhook`, `yoco-webhook`.
4. **Before deploying `kb-sync`**: confirm the edge secret `KB_SYNC_KEY` is set. The function used to allow everyone when it
   was unset; it now rejects everyone in that case, including its hourly cron job.
5. Deploy admin, then booking.
6. Optional CI: in GitHub, branch protection for `main` on both repos, require the checks **"Client bundle secret scan"**
   and (admin) "Lint + Typecheck" / "Payments, tenant isolation and edge functions". Add the `SUPABASE_DB_URL` secret
   if it is not already present (the weekly drift workflow now also runs `check-grants`).

### Edge-function environment switches introduced

| Secret (edge) / env (Vercel) | Default | Purpose |
|---|---|---|
| `ALLOW_DEV_ORIGINS=true` | unset | Adds `localhost` and the apps' own Vercel preview URLs to the CORS allowlist. **Leave unset in production.** Local development against the production project will fail CORS until you set it, or point local development at a staging project. |
| `ENFORCE_ADMIN_AAL2_ROLES` (edge secret **and** Vercel env on `caepweb-admin`) | unset | e.g. `SUPER_ADMIN,MAIN_ADMIN`. Requires an AAL2 (TOTP-verified) session for those roles on privileged endpoints. See section 4. |

---

## 3. Other credentials found while auditing

| Finding | Action |
|---|---|
| The `billing-enforcement-daily` cron job carried a shared secret (`x-billing-key`) as a **literal in `cron.job.command`**. Migration 3 replaces the header with the vault service key. | After migration 3: set a new `BILLING_ENFORCEMENT_KEY` edge secret (or remove the secret; the function also accepts the service key), and treat the old literal as exposed. It authorises a run that can suspend tenants. |
| `kb-sync-hourly` carries `x-kb-sync-key` as a literal in `cron.job.command` (not inspected, to avoid printing it). | Same pattern. Move it to the vault key: `'apikey', (select btrim(decrypted_secret) from vault.decrypted_secrets where name = 'edge_jobs_service_role_key')`, then rotate `KB_SYNC_KEY`. |
| Vault secret **named** with the service-role JWT | Delete the row after rotation (1.2). |
| Vault secret named `<paste your SUPABASE_SERVICE_ROLE_KEY here>` | Placeholder; delete the row (`delete from vault.secrets where name like '<paste%';`). |

---

## 4. S4: authentication hardening (Supabase Auth settings are yours to change)

1. **Leaked-password protection.** Dashboard, Authentication, Sign In / Providers (Password): turn on the leaked-password protection toggle (HaveIBeenPwned check). Availability depends on your Supabase plan; if the toggle is not offered, record that and treat it as an accepted gap.
2. **Email confirmation stays required** (Authentication, Sign In / Providers, Email: "Confirm email" on). Code now also refuses an unconfirmed address wherever an email is matched to a booking, customer or admin row (S2), so this is defence in depth.
3. **MFA methods.** Authentication, Multi-Factor: TOTP enabled, **and a second method** (the dashboard offers phone and, depending on plan, WebAuthn). The live advisor `auth_insufficient_mfa_options` is a WARN today and clears only once a second method is on. Each `SUPER_ADMIN` and `MAIN_ADMIN` then enrols at least one factor, ideally two (one as backup; the app already has recovery handling in `mfa_recovery_state`).
4. **Enforce AAL2 (do this last, after everyone has enrolled).**
   1. Staging first: set `ENFORCE_ADMIN_AAL2_ROLES=SUPER_ADMIN,MAIN_ADMIN` as an edge secret **and** as a Vercel env var on `caepweb-admin`, redeploy admin.
   2. Sign in as each role **without** completing MFA and confirm privileged calls return 403 "Multi-factor authentication required" (edge) or 401 (API routes); then with MFA, confirm they work.
   3. Production. Add `OPERATOR`/`ADMIN` later if you want all admins covered.
   4. Rollback is unsetting the variable.
5. **Sessions.** Authentication, Sessions: shorten the JWT expiry for admin sessions if you can (e.g. 1 hour); keep "Detect and revoke potentially compromised refresh tokens" on; set a sensible inactivity timeout / time-box (Pro). Record the values you choose.

Test H checklist. Live security advisors on 2026-10-29 reported these WARNs:

| Advisor | Status after this work |
|---|---|
| `auth_leaked_password_protection` (disabled) | **Yours**: step 1 above |
| `auth_insufficient_mfa_options` | **Yours**: step 3 above |
| `extension_in_public` (`pg_net`) | Section 5 (maintenance window), or accept |
| `anon_security_definer_function_executable` x3: `current_business_ids`, `sign_waiver`, `validate_promo_code` | Intentional (the documented list) |
| `authenticated_security_definer_function_executable` x32 | Intentional: tenant-checked functions the admin app calls by RPC. Test H as worded whitelists only the three anon ones, so add these 32 to the documented list, or the test cannot reach zero |
| `rls_enabled_no_policy` x26 (INFO) | Documented by migration 5 (and `combo_settlements` gets a policy in migration 4) |

---

## 5. S6: move `pg_net` out of `public` (maintenance window, **not** applied)

`pg_net` is installed in `public` and is not relocatable (`ALTER EXTENSION ... SET SCHEMA` is not supported), so the only
route is drop and re-create. Measured on 2026-10-29: the **only dependents are 11 `pg_cron` jobs** (3 inactive); there are
no database-webhook triggers and no other SQL function uses `net.http_*`. The cost is that cron-driven HTTP calls fail
for the minute it takes, and any request still queued in `net` is lost. `marketing-dispatch` and `notification-jobs` run
every minute and catch up on the next run.

```sql
-- 1. Note which jobs are active, then pause the ones that call net.*
select jobid, jobname, active from cron.job where command ~* 'net\.http_' order by jobid;
select cron.alter_job(jobid, active := false) from cron.job where command ~* 'net\.http_' and active;

-- 2. Move it
drop extension pg_net;
create extension pg_net with schema extensions;   -- Supabase's event trigger re-grants usage on schema net

-- 3. Check
select extname, extnamespace::regnamespace from pg_extension where extname = 'pg_net';   -- extensions
select net.http_get('https://example.org');   -- returns a request id (any harmless URL)

-- 4. Re-enable exactly the jobs that were active in step 1, then watch one cycle of each
select cron.alter_job(jobid, active := true) from cron.job where jobname in (/* the ones that were active */);
select jobname, status, return_message, start_time from cron.job_run_details order by start_time desc limit 30;
```

Re-test every job that was active (billing-enforcement-daily, cron-tasks-every-5-minutes, fetch-google-reviews-daily,
kb-sync-hourly, marketing-automation-every-5-min, marketing-dispatch-every-minute, notification-jobs-every-minute,
review-reminders-daily). If you prefer not to take the window, leave it and keep the advisor finding listed as accepted.

---

## 6. Rollback quick reference

* Code: revert the deploy; migrations are independent and listed in section 2 with their reversal.
* If a legitimate flow breaks after migration 2, find the table in `supabase/grant-allowlist.json`'s git history, `GRANT`
  only the privilege that flow needs, and add it back to the allowlist in the same change. Do not grant to `anon` broadly.
* CORS regression in local dev: set `ALLOW_DEV_ORIGINS=true` on a non-production project.
