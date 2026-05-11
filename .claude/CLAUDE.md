# BookingTours Admin Dashboard

Multi-tenant admin dashboard for the BookingTours platform (`bookingtours.co.za`). Pricing: R1,500/mo + R750/extra admin; clients can pause for off-season.

**Stack:** Next.js 16 (App Router, webpack) · React 19 · TypeScript · TailwindCSS 3 · Supabase (Postgres + Edge Functions/Deno) · Yoco / Paysafe / PayFast for payments · Resend for email · vitest + playwright for tests.

**Package manager:** **npm only.** `packageManager` field is pinned in `package.json`. Do **not** introduce pnpm or yarn — Vercel defaults to npm and a stray lockfile will break deploys.

**Today's date** comes from session context — use it, don't invent dates.

---

## Operating Principles (re-read every session)

These five rules supersede everything below. They exist because every recurring drift incident in this repo violated one of them.

1. **Verify before claiming.** If you're about to reference a function, file, column, RPC, env var, route, or component — first prove it exists in *this session*, with Read/Grep/Glob output. No assertion about codebase state without evidence.
2. **Stay strictly in scope.** Touch only what the user asked you to change. No drive-by refactors, renames, formatting passes, "while I'm here" cleanups, or speculative error handling. If you spot a real bug outside scope, *mention* it — don't silently fix it.
3. **Never invent.** Do not guess Supabase tables, columns, RPC names, edge-function names, env-var names, route paths, hooks, or library APIs. If you can't locate it via Grep/Read in <30 seconds, ask the user. Hallucinated APIs are the #1 cause of broken builds here.
4. **Build before declaring done.** For any non-trivial change run the relevant verification (`npm run build`, `npm run lint`, `npm run test:unit`) and report the *actual* result. If it doesn't compile, you're not done.
5. **Respect intentional config.** Many seemingly weird settings are deliberate — `verify_jwt = false` flags, RLS policies, the `--webpack` build flag, package-manager pin, edge-function CORS. Read "Critical Landmines" before editing config files.

---

## Mandatory Verification Protocols

Before each class of action, run the corresponding check. Skipping these is the primary cause of drift.

| Action | Required check |
|---|---|
| Reference a function / component / hook | Grep for its definition (`export (function\|const\|default) <name>`) |
| Reference a Supabase column or table | Grep `supabase/migrations` or read `supabase/security-baseline.json` |
| Reference a Supabase RPC | `Grep -r "create or replace function <name>" supabase/migrations` |
| Reference an env var | Grep across the repo; if it's not there, it doesn't exist |
| Reference an app route | `Glob app/**/page.tsx` |
| Reference an edge function | `Glob supabase/functions/<name>/index.ts` |
| Modify a file | `Read` it (or the relevant section) first — every time, no exceptions |
| Use a library API | Confirm the package is in `package.json` and check usage in nearby files. Don't trust training data — Next 16, React 19, and Supabase JS v2.95 have moved on |
| Add a Next.js feature | Read https://nextjs.org/docs/app — Next 16 cache semantics differ significantly from older versions |

When fixing a bug: read the failing file end-to-end before proposing a fix. The fix is almost always different from what you'd guess from the error alone.

---

## Project Facts (canonical)

- **Auth roles:** `MAIN_ADMIN`, `SUPER_ADMIN`, `OPERATOR`. Supabase Auth + custom `profiles.role`.
- **Multi-tenancy:** `business_id` on every business-scoped table. Resolution helper: `supabase/functions/_shared/tenant.ts`. Every query must scope by `business_id` — RLS is defence-in-depth, not an excuse to skip explicit filtering.
- **Payments:** Yoco (single bookings), Paysafe (combo bookings, split payments), PayFast (ITN). All three have webhook handlers with HMAC verification.
- **OTA integrations:** Viator and GetYourGuide (availability sync + webhooks).
- **Atomic ops:** Use existing RPCs (`confirm_payment_atomic`, counter increments, `create_hold_*`). Don't reinvent transactions in app code.
- **Idempotency:** Webhooks MUST go through the `idempotency_keys` table. Yoco and Paysafe both retry — duplicate processing has caused double-charges.
- **RLS:** Enabled on every public table (`20260304150000_enable_rls_all.sql` + per-table). Prefer anon + RLS over service role where possible.
- **Encryption:** Paysafe credentials encrypted with pgcrypto in DB.

---

## Related Apps (paths, don't get them wrong)

- **Booking site (customer-facing):** `~/dev/booking` — **NOT** `~/Desktop/booking`. The Desktop iCloud copy was deleted because iCloud sync corrupted git refs and produced ` 2.tsx` duplicates. **Do not restore it.**
- **Onboarding app:** `~/Desktop/ActvityHub/Onboarding`
- **Landing pages:** `landing-pages/` in this repo (4 templates + generator)

---

## File Map

For canonical lists, prefer `Glob` over this map — directories evolve faster than docs. Use this as a starting point, not source of truth.

### App routes (`app/`)
| Route | Purpose |
|---|---|
| `/` | Dashboard home |
| `/bookings`, `/bookings/[id]` | Booking list & detail |
| `/new-booking` | Create booking |
| `/slots` | Schedule / capacity |
| `/refunds` | Refund processing |
| `/invoices` | jsPDF invoices |
| `/vouchers` | Gift voucher mgmt |
| `/inbox` | WhatsApp + web chat |
| `/weather` | Weather monitoring |
| `/photos` | Trip photo tracking |
| `/broadcasts` | Bulk WhatsApp |
| `/pricing` | Peak pricing |
| `/reports` | Analytics |
| `/marketing` | Campaigns, automations, contacts, templates, promotions |
| `/billing` | Admin seat billing (privileged) |
| `/settings` | Business config (privileged) |
| `/super-admin` | Tenant mgmt (privileged) |
| `/operators` | Operator mgmt |

### Edge functions (`supabase/functions/`)
Run `Glob supabase/functions/*/index.ts` for the live list. Categories:

- **Booking & payment:** `confirm-booking`, `rebook-booking`, `cancel-booking`, `external-booking`, `create-checkout` (Yoco), `create-paysafe-checkout`, `yoco-webhook`, `paysafe-webhook`, `payfast-itn`, `manual-mark-paid`, `process-refund`, `batch-refund`, `hold-expiry`
- **Communications:** `send-email`, `send-whatsapp-text`, `wa-send`, `wa-webhook`, `web-chat`, `admin-reply`, `send-otp`, `send-invoice`, `broadcast`, `auto-messages`, `outbox-send`, `reminder-scheduler`, `send-trip-photos`
- **Marketing:** `marketing-dispatch`, `marketing-automation-dispatch`, `marketing-track`, `marketing-unsubscribe`
- **OTA / external:** `viator-webhook`, `viator-availability-sync`, `getyourguide-webhook`, `getyourguide-availability-sync`, `ota-reconcile`, `fetch-google-reviews`, `google-drive`
- **Admin / ops:** `super-admin-onboard`, `generate-invite-token`, `cron-tasks`, `cron-jobs`, `weather-cancel`, `waiver-form`, `bank-details`, `debug-logs`
- **Shared:** `_shared/tenant.ts`, `_shared/waiver.ts`, `_shared/logger.ts`, `_shared/chat-booking-pricing.ts`

### Other
- **Migrations:** `supabase/migrations/YYYYMMDDHHMMSS_<description>.sql`
- **Security baseline:** `supabase/security-baseline.json` (canonical grants/RLS snapshot)
- **Components:** `components/` (incl. `marketing/`, `AvailabilityCalendar`, `AppShell`, `AuthGate`, `BusinessContext`, `RichTextEditor`, `ThemeProvider`)
- **Tests:** `tests/unit/*.test.ts` (vitest), `tests/e2e/*.spec.ts` (playwright)
- **Scripts:** `scripts/` (test-bookings.js, apply_migration.js, check-security-drift.mjs, etc.)
- **Path alias:** `@/*` → project root

---

## Critical Landmines

These have broken production. Read every time before touching the related area.

### 1. Edge function JWT verification (per-function, intentional)

**`verify_jwt = false`** is set deliberately on these (they need public access OR are invoked by `pg_cron` with a service-role bearer that is *not* a JWT):

- Public webhooks: `yoco-webhook`, `paysafe-webhook`, `payfast-itn`, `wa-webhook`, `web-chat`, `external-booking`, `process-refund`, `viator-webhook`, `getyourguide-webhook`
- Cron-invoked: `marketing-dispatch`, `marketing-automation-dispatch`, `marketing-track`, `marketing-unsubscribe`

**Rule:** Any edge function called by `pg_cron` via `net.http_post` MUST have `verify_jwt = false` in `supabase/config.toml`. The cron sends `Bearer <service_role_key>` which is *not* a JWT — verification will reject with 401. This bug has bitten us once.

When adding a new edge function: decide JWT setting deliberately and document it in `config.toml`. Don't blindly copy a neighbour.

### 2. Migrations only — never the Dashboard SQL Editor

All DDL, GRANT, REVOKE, RLS-policy changes go through timestamped migration files. No exceptions. Use `npx supabase migration new <description>`.

If a migration changes grants/RLS/policies, update `supabase/security-baseline.json` **in the same commit**. `npm run check-security-drift` (needs `DATABASE_URL`) compares production against the baseline and exits non-zero on drift.

### 3. Multi-tenant scoping

Every server-side query against a business-scoped table needs an explicit `business_id` filter. Never write `select * from bookings` server-side without it. RLS is the safety net, not the primary defense.

### 4. Idempotency for webhooks

Webhook handlers must check `idempotency_keys` before processing. Both Yoco and Paysafe retry. Don't process a webhook event twice.

### 5. Marketing dispatch crash safety

If `RESEND_API_KEY` is unset, dispatch returns 503 (not crashes). Preserve this guard if you touch dispatch code.

### 6. Build flag

The build is pinned to webpack: `next build --webpack`. Don't switch to turbopack in `package.json` without explicit user approval — turbopack has compatibility issues with parts of this codebase.

### 7. Submodule corruption (ongoing)

`.activityhub-onboarding-staging` has a corrupted tree (`0ef65bb...`). Some bulk git operations fail because of it. If git index breaks: use a fresh clone at `/tmp/capekayak_fresh` for commits/pushes. Don't try to "fix" the submodule — it's a known issue.

### 8. Disk corruption recipe

`marketing-dispatch` and `marketing-track` were silently truncated once during a bulk file op ("short read while indexing"). After bulk file mutations, verify files still exist. Fix recipe: `cp file /tmp/fix && rm file && mv /tmp/fix file`.

### 9. Backup files

Duplicate/backup files live in `.backups/` (component & function files with ` 2` suffix). Don't delete without checking — some are referenced by tooling.

---

## Commands

| Command | Use |
|---|---|
| `npm run dev` | Dev server :3000 (webpack, port pre-check) |
| `npm run dev:turbo` | Dev with turbopack (use only if explicitly debugging turbo issues) |
| `npm run dev:clean` | Kill :3000, clear `.next`, restart |
| `npm run build` | Production build (webpack) |
| `npm run lint` | ESLint |
| `npm run test:unit` | vitest |
| `npm run test:e2e` | playwright (full) |
| `npm run test:e2e:smoke` | playwright smoke only |
| `npm run check-security-drift` | Compare prod grants/RLS vs baseline (needs `DATABASE_URL`) |
| `npx supabase migration new <desc>` | New migration file |

---

## Environment Variables

**Frontend (Next.js, `NEXT_PUBLIC_` prefix):**
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

**Server-side:**
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

**Edge function secrets** (set via Supabase dashboard, never committed):
- `SUPABASE_URL`, `SERVICE_ROLE_KEY`, `SETTINGS_ENCRYPTION_KEY`, `RESEND_API_KEY`, `GEMINI_API_KEY`, `WA_VERIFY_TOKEN`

If you reference any other env var, **first grep** to confirm it exists. Don't invent new ones mid-feature without flagging it to the user.

---

## Stop Conditions — declare done only when…

Before saying "done":

- [ ] All files I changed compile (`npm run build` for app changes; `deno check` mentally for edge fns)
- [ ] Lint passes for files touched (`npm run lint`)
- [ ] Unit tests pass for the area I touched (`npm run test:unit`)
- [ ] Migration: timestamped, applies cleanly, `security-baseline.json` updated if grants/RLS changed
- [ ] Edge function: `config.toml` JWT setting is correct, CORS headers present
- [ ] Multi-tenant query: `business_id` filter is explicit
- [ ] Webhook: `idempotency_keys` check + signature verification both present
- [ ] UI change: I either tested in a browser OR explicitly told the user "I haven't tested this in the browser"
- [ ] No `TODO`/`// TEMP`/`console.log` debris in the diff
- [ ] No new files created unless required by the task
- [ ] No unrelated files touched

If any box is unchecked, say so explicitly. Never imply success you can't verify.

---

## Anti-patterns to refuse

- `try/catch` that swallows errors silently
- `// @ts-ignore` to mask a type error — fix the actual type
- Bypassing RLS with service-role-key when anon would work
- Renaming things "for clarity" mid-feature
- Creating new helper files when an existing one already covers the case
- Comments that just restate the code — explain *why*, not *what*, and only when non-obvious
- Reintroducing `pnpm-lock.yaml` / `pnpm-workspace.yaml`
- Editing `vercel.json` / `vercel.ts` / `supabase/config.toml` casually — they affect production deploys
- Creating `.md` files unless explicitly asked
- Generating commit messages with marketing language ("revolutionary", "robust") — keep them factual
- Destructive git ops (force push, `reset --hard`, `branch -D`, `push --force`) without explicit user approval
- Bypassing pre-commit hooks with `--no-verify`
- Polling `TaskOutput` after spawning agents — wait for them to return

---

## When you don't know something

The single biggest cause of broken code in this repo is bots making up answers when they should have asked. Acceptable responses to uncertainty:

- "I checked X but couldn't find Y — can you point me to it?"
- "I'm going to assume A; tell me if I should use B instead."
- "I don't know which approach you'd prefer — option 1 does X, option 2 does Y."

**Never acceptable:**
- Inventing function/column/env-var/API names
- Writing code "as if" something exists and hoping it does
- Claiming a build passes without running it
- Summarising what you "think" a file does without reading it

---

## Documentation Map

These files exist; read them before guessing about the area they cover:

- `ONBOARDING_GUIDE.md` — client onboarding procedures
- `PRODUCTION_RUNBOOK.md` — deploy & secrets checklist
- `PRODUCTION_TEST_CASES.md` — 196 test cases across 28 sections
- `MARKETING_ENGINE_GUIDE.md` — marketing system docs
- `docs/launch/` — launch strategy, ads playbook, KPI scorecards
- `supabase/security-baseline.json` — canonical grants/RLS snapshot

---

## Lab Notes — institutional memory

Append dated entries when something breaks. Be specific. Keep this section honest and short.

### 2026-05-07 — Marketing dispatch silent failure (resolved)
Cron-driven `marketing-dispatch` was rejected with 401 because `verify_jwt` defaulted to `true` and `pg_cron` sends `Bearer <service_role_key>` which isn't a JWT. **Fix:** explicit `verify_jwt = false` in `config.toml` for all cron-invoked functions. Also added: `RESEND_API_KEY` guard returns 503 instead of crashing.

### 2026 — pnpm artifacts removed (Prompt 29)
Project is npm-only. `packageManager` field is pinned. Don't reintroduce `pnpm-lock.yaml`/`pnpm-workspace.yaml`. Vercel defaults to npm.

### 2026 — Booking site relocation (Prompt 31)
Customer-facing booking site lives at `~/dev/booking`. Desktop iCloud copy was deleted because iCloud sync corrupted refs and produced ` 2.tsx` duplicates. Don't restore it.

### Disk corruption — edge function files
`marketing-dispatch` and `marketing-track` were silently truncated during a bulk file op. **Always verify files still exist after bulk file mutations.** Fix: `cp file /tmp/fix && rm file && mv /tmp/fix file`.

### Submodule corruption (ongoing)
`.activityhub-onboarding-staging` has a bad tree object (`0ef65bb...`). Use a fresh clone (`/tmp/capekayak_fresh`) for git operations needing a clean index.

### Security audit — 2026-05-02
- 0 npm vulnerabilities
- RLS enabled on all public tables (`20260304150000_enable_rls_all.sql` + per-table)
- No hardcoded secrets
- Paysafe webhook: HMAC-SHA256 with constant-time comparison
- Payment data: card details never touch our server (Paysafe/Yoco handle PCI)
- `.gitignore` covers `.env*`, `*.pem`, `*.key`, `credentials.json`, `service-account.json`

---

## Final reminder

This file exists because we kept losing time to drift and hallucination. The rules above aren't suggestions — they're the only reason a future session won't repeat the same mistakes. If you're tempted to skip a verification step "because the answer's obvious," that's exactly when you stop and verify.
