# BookingTours Admin Dashboard

## Project Overview
Multi-tenant Next.js 16 admin dashboard for the BookingTours platform — a complete booking system for adventure/tourism businesses. Built with React 19, Supabase (PostgreSQL + Edge Functions), and TailwindCSS.

**Platform:** BookingTours (bookingtours.co.za)
**Pricing:** R1,500/month + R750/additional admin user. Clients can pause for off-season (no charge).

## Related Apps
- **Booking Site:** `~/Desktop/booking` — customer-facing booking pages (multi-tenant via subdomain)
- **Onboarding App:** `~/Desktop/ActvityHub/Onboarding` — client self-service setup form
- **Landing Pages:** `landing-pages/` folder — 4 templates (adventure, luxury, safari, modern) + generator

**Stack:** Next.js 16 · React 19 · Supabase · TailwindCSS 3 · TypeScript · Deno (edge functions)

## Commands
- `npm run dev` — dev server on :3000
- `npm run dev:turbo` — dev with turbo mode
- `npm run dev:clean` — kill :3000, clear .next, fresh start
- `npm run build` — production build
- `npm run lint` — ESLint

## Architecture

### App Routes (app/)
| Route | Purpose |
|-------|---------|
| `/` | Dashboard home |
| `/bookings` `/bookings/[id]` | Booking list & detail |
| `/new-booking` | Create booking |
| `/slots` | Schedule/capacity management |
| `/refunds` | Refund processing |
| `/invoices` | Invoice generation (jsPDF) |
| `/vouchers` | Gift voucher management |
| `/inbox` | WhatsApp + web chat |
| `/weather` | Weather monitoring |
| `/photos` | Trip photo tracking |
| `/broadcasts` | Bulk WhatsApp |
| `/pricing` | Peak pricing |
| `/reports` | Analytics |
| `/marketing` | Email campaigns, automations, contacts, templates, promotions |
| `/billing` | Admin seat billing (privileged) |
| `/settings` | Business config (privileged) |
| `/super-admin` | Tenant management (privileged) |
| `/operators` | Operator management |

### Edge Functions (supabase/functions/)
**Booking & Payment:**
- `confirm-booking` `rebook-booking` `external-booking` — booking lifecycle
- `create-checkout` — Yoco payment checkout
- `create-paysafe-checkout` — Paysafe combo booking checkout with split payments
- `yoco-webhook` `paysafe-webhook` — payment webhook handlers (HMAC verified)
- `manual-mark-paid` `process-refund` `batch-refund` — payment ops

**Communications:**
- `send-email` — Resend API email (JWT verified)
- `send-whatsapp-text` `wa-webhook` `web-chat` `admin-reply` — messaging
- `send-otp` `send-invoice` — transactional
- `broadcast` — bulk WhatsApp
- `auto-messages` — automated sequences

**Marketing:**
- `marketing-dispatch` — batch campaign email sending with Resend, retry logic, open/click tracking injection
- `marketing-automation-dispatch` — automation workflow step execution (wait, send_email, generate_promo)
- `marketing-track` — open pixel + click redirect tracking
- `marketing-unsubscribe` — one-click unsubscribe

**Admin:**
- `super-admin-onboard` `generate-invite-token` — tenant setup
- `cron-tasks` — scheduled jobs
- `weather-cancel` — weather-triggered cancellations
- `waiver-form` — waiver handling
- `debug-logs` — debug utility

**Shared:** `_shared/tenant.ts` (multi-tenant resolution), `_shared/waiver.ts`, `_shared/logger.ts`

### Key Patterns
- **Multi-tenant:** business_id on all tables, tenant resolution via `_shared/tenant.ts`
- **Auth:** Supabase Auth with role-based access (MAIN_ADMIN, SUPER_ADMIN, OPERATOR)
- **Payments:** Yoco (primary) + Paysafe (combo bookings with split payments)
- **Atomic ops:** RPCs for `confirm_payment_atomic`, counter increments, hold creation
- **Idempotency:** `idempotency_keys` table prevents duplicate webhook processing
- **RLS:** Row Level Security on all public tables
- **Encrypted credentials:** Paysafe keys stored with pgcrypto encryption

### Component Structure (components/)
- `AuthGate` — auth wrapper, `AppShell` — sidebar layout
- `BusinessContext` — provides current business data
- `AvailabilityCalendar` `DayView` `WeekView` — calendar views
- `RichTextEditor` — email template editing
- `marketing/` — EmailBuilder, block editors, starter templates
- `ThemeProvider` `ThemeToggle` — dark/light mode

## Environment Variables
```
NEXT_PUBLIC_SUPABASE_URL     # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY # Client anon key
SUPABASE_URL                  # Server-side URL
SUPABASE_ANON_KEY             # Server-side anon key
SUPABASE_SERVICE_ROLE_KEY     # Admin operations
```

Edge function secrets (set via Supabase dashboard):
`SUPABASE_URL` `SERVICE_ROLE_KEY` `SETTINGS_ENCRYPTION_KEY` `RESEND_API_KEY` `GEMINI_API_KEY` `WA_VERIFY_TOKEN`

## Conventions
- All edge functions use Deno + `@supabase/supabase-js` with CORS helpers
- Migrations are timestamped: `YYYYMMDDHHMMSS_description.sql`
- FIX_ and COMBINED_ prefixed migrations are ad-hoc patches
- Path alias: `@/*` maps to project root
- Security headers: X-Frame-Options DENY, nosniff, strict referrer

## Documentation
- `ONBOARDING_GUIDE.md` — client onboarding procedures
- `PRODUCTION_RUNBOOK.md` — deployment & secrets checklist
- `PRODUCTION_TEST_CASES.md` — 196 test cases across 28 sections
- `MARKETING_ENGINE_GUIDE.md` — marketing system documentation
- `docs/launch/` — launch strategy, ads playbook, KPI scorecards

## Capabilities
You can:
- Build and modify Next.js pages, components, and API routes
- Create/modify Supabase edge functions (Deno TypeScript)
- Write SQL migrations for schema changes
- Run the dev server and build
- Access Supabase via the client libraries already configured
- Use WebFetch for API documentation lookup

## Preferences
- When making widespread file changes, use one Write instead of many sequential Edits
- Always read API docs before using unfamiliar platforms
- Return absolute file paths for easy navigation
- When errors occur during development, log the failure and what was tried in the Lab Notes section below
- After completing a feature, compile learnings and update this file

---

## Lab Notes — What Not To Do
_This section is a running log of failures, learnings, and anti-patterns discovered during development. Future Claude instances should consult this before attempting similar tasks._

### Git & Repository
- The `.activityhub-onboarding-staging` submodule has a corrupted tree object (`0ef65bb...`). This breaks `git read-tree` and index rebuilds. Workaround: use a fresh clone for git operations.
- When git index is corrupted, use `/tmp/capekayak_fresh` (a clean clone) for commits and pushes.
- Several edge function files had disk-level corruption ("short read while indexing"). Fix by `cp file /tmp/fix && rm file && mv /tmp/fix file`.

### Edge Functions
- `marketing-dispatch` and `marketing-track` were lost once due to disk corruption during a file-fix operation. Always verify files exist after bulk operations.
- Edge functions with JWT verification disabled: yoco-webhook, wa-webhook, web-chat, external-booking, process-refund. Don't add JWT checks to these without updating config.toml.

### Build & Deploy
- Duplicate/backup files moved to `.backups/` folder (components and supabase functions with " 2" suffix). Don't delete without checking.
- `pnpm-lock.yaml` and `pnpm-workspace.yaml` exist alongside `package-lock.json` — project uses npm, not pnpm.
- Test/utility scripts live in `scripts/` (test-bookings.js, test-db.js, apply_migration.js, etc.)

### Marketing Dispatch
- Campaigns were stuck at "scheduled"/"sending" because `marketing-dispatch` was missing from `config.toml`, defaulting to `verify_jwt = true`. The cron job sends a `Bearer <service_role_key>` which is NOT a JWT — so the function rejected every call with 401.
- **Fix:** Added `verify_jwt = false` for: marketing-dispatch, marketing-automation-dispatch, marketing-track, marketing-unsubscribe, paysafe-webhook.
- **Rule:** Any edge function called by pg_cron via `net.http_post` MUST have `verify_jwt = false` in config.toml.
- Also added a guard: if `RESEND_API_KEY` is not set, dispatch returns 503 instead of crashing.

### Security (Audited 2026-05-02)
- **Dependencies:** 0 vulnerabilities (npm audit clean)
- **RLS:** All tables have Row Level Security enabled (bulk migration `20260304150000_enable_rls_all.sql` + per-table)
- **Secrets:** No hardcoded API keys in source. Credentials handled via encrypted DB columns + .env files
- **Paysafe webhook:** HMAC-SHA256 signature verification with constant-time comparison
- **.gitignore:** Covers .env*, *.pem, *.key, credentials.json, service-account.json
- **Payment data:** Credit card data never touches our server — Paysafe/Yoco handle PCI compliance
- Edge function JWT verification is disabled on: yoco-webhook, wa-webhook, web-chat, external-booking, process-refund (intentional — these need public access)
- **Security baseline:** `supabase/security-baseline.json` — checked-in snapshot of all grants, RLS status, and policies. Any migration that changes grants, RLS, or policies MUST update this file in the same commit.
- **Drift detection:** `npm run check-security-drift` — compares production against baseline, exits non-zero on drift. Requires `DATABASE_URL` env var. Run weekly and before releases.
- **Workflow rule:** No production schema changes via the Supabase Dashboard SQL Editor. All DDL and GRANT/REVOKE changes must go through timestamped migration files.
