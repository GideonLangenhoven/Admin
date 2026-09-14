# BookingTours — Technical Specification

**Status:** Living document · **Last updated:** 2026-07-10

BookingTours is a multi-tenant SaaS booking platform for adventure and tourism operators. Multiple independent businesses share one codebase, one Postgres database, and one set of infrastructure. Tenant isolation is a security-critical requirement at every layer.

---

## 1. System architecture

Three deployable units share one Supabase project (Postgres + Auth + Storage + Edge Functions):

| Component | Path | Runtime | Port (dev) | Deploy target |
|---|---|---|---|---|
| Admin dashboard | `/app` | Next.js 16 (webpack build), React 19 | 3000 | Vercel (`caepweb-admin`), `*.admin.bookingtours.co.za` |
| Customer booking site | `/booking/app` | Next.js 16, React 19 | 3001 | Vercel, `booking.bookingtours.co.za` + per-tenant subdomains |
| Edge functions | `/supabase/functions` | Deno | — | Supabase Edge Functions |

Shared code:

- `/components` — React components shared into the admin app (AppShell, DayView/WeekView calendar, etc.).
- `/supabase/functions/_shared` — Deno utilities: `tenant.ts` (subdomain → business_id resolution), `auth.ts`, `bot-gate.ts`/`bot-guards.ts`/`intent.ts` (chatbot), `kb.ts`/`llm.ts` (RAG), `customer-session.ts`, `otp-attempts.ts`, `viator.ts`/`getyourguide.ts` (OTA clients), `waiver.ts`, `logger.ts`, `sentry.ts`, `platform-invariants.ts`.
- `/supabase/migrations` — ~139 Postgres migrations, applied via Supabase CLI/MCP.

### Stack

- TypeScript everywhere. React 19 with the React Compiler (`babel-plugin-react-compiler`).
- Tailwind CSS 3 (no CSS modules / styled-components).
- Supabase JS client for all queries (parameterised; no raw SQL string concatenation with user input).
- npm only (no yarn/pnpm).
- Sentry on both Next.js apps and edge functions.
- Admin-only deps of note: recharts (reports), jspdf + autotable (PDF invoices/manifests), xlsx (exports), react-virtuoso (long lists), react-day-picker.
- Booking site is deliberately thin: supabase-js, dompurify, sharp.

---

## 2. Multi-tenancy model

The core invariant: **every business-scoped row carries `business_id`, and every read/write is constrained to one tenant.**

- Every business-scoped table has a `business_id` column; RLS is enabled on **all** public tables (67 tables tracked in `supabase/security-baseline.json`).
- Every Supabase `.from()` call against a business-scoped table MUST include `.eq("business_id", ...)` in the chain, OR run under `service_role` with `business_id` derived from a trusted source (verified webhook payload, cron context, authenticated session).
- Client-supplied `business_id` is never trusted. Resolution is server-side:
  - Edge functions: `supabase/functions/_shared/tenant.ts` (subdomain → business_id lookup).
  - Admin app: `BusinessContext` component from the authenticated session.
  - Booking site: subdomain of the request host.
- **Combo bookings are the only legitimate cross-tenant data flow** (§5.2). Settlements split amounts per tenant.
- Anon storefront reads use a scoped Supabase client with `persistSession: false` so a persisted `/my-bookings` session can never leak into anon-only RLS paths.

Business-scoped tables (non-exhaustive; if it has `business_id`, it's scoped): bookings, customers, slots, tours, add_ons, holds, vouchers, invoices, refunds/refund_requests, conversations, messages, chat_messages, marketing_* (contacts, campaigns, templates, automations, queue, events), broadcasts, reviews, promo/promotions, auto_messages, combo_settlements, trip_photos, kb_chunks, waitlist, peak_periods.

**Adding a new table requires:** `business_id` column → RLS policies → entry in `supabase/security-baseline.json` → `npm run check-security-drift` exits 0.

---

## 3. Identity, roles, and access control

Roles live in `profiles.role`:

| Role | Access |
|---|---|
| `OPERATOR` | Day-to-day ops (bookings, inbox, manifest). No settings, billing, or admin management. |
| `MAIN_ADMIN` | Full tenant access. No super-admin routes. |
| `SUPER_ADMIN` | Platform-wide; creates/manages tenants (`/super-admin`, `super-admin-onboard` fn). |

Rules:

- Every privileged route performs a **server-side role check before data access**. Hiding a nav link is not security; direct URL access returns 401/403.
- Legacy `ADMIN` role values exist in old rows; privileged checks must account for this (has caused 403 regressions — see docs/qa remediation logs).

### Customer identity (no accounts)

Customers are identified per-booking. `/my-bookings` on the booking site uses **email OTP login**: ~10-minute validity, rate-limited failed attempts (`otp_attempts`), and the booking list is filtered by `business_id` server-side. Sessions are scoped per tenant subdomain.

---

## 4. Data model (functional groups)

67 public tables, all RLS-enabled. Key groups:

- **Tenancy & platform:** `businesses`, `plans`, `subscriptions`, `billing_line_items`, `usage_counters`, `marketing_usage_monthly`, `tenant_invoice_sequences`, `invite_tokens`, `admin_users`, `audit_logs`, `api_rate_limits`.
- **Catalog & capacity:** `tours`, `slots`, `add_ons`, `peak_periods`, `peak_period_prices`, `policies` (refund policies), `waitlist`.
- **Booking core:** `bookings`, `booking_add_ons`, `holds`, `pending_reschedules`, `paid_booking_events`, `customers` (implied by scoped queries), `invoices`, `refund_requests`, `vouchers`, `trip_photos`.
- **Combo (cross-tenant):** `combo_offers`, `combo_offer_items`, `combo_bookings`, `combo_booking_items`, `combo_settlements`, `business_partnerships`.
- **Payments & integrity:** `idempotency_keys`, `outbox`, `topup_orders`, `ngt_payments`, `ngt_intake_submissions`, `landing_page_orders`.
- **Messaging & bots:** `conversations`, `messages`, `chat_messages`, `wa_messages`, `processed_wa_messages` (WA dedup), `webchat_sessions`, `kb_chunks` (pgvector RAG), `otp_attempts`.
- **Marketing:** `marketing_contacts`, `marketing_campaigns`, `marketing_templates`, `marketing_automations`, `marketing_automation_steps`, `marketing_automation_enrollments`, `marketing_automation_logs`, `marketing_queue`, `marketing_events` (opens/clicks), `marketing_unsubscribe_tokens`, `broadcasts`.
- **Growth:** `promotions`, `promotion_uses`, `referrals`, `referral_uses`.
- **OTA/external:** `external_booking_credentials` (encrypted), `external_product_mappings`, `external_webhook_events`.

Money is ZAR. Amounts are stored as integers (cents) or decimals depending on the existing column — new code must match the column it touches and must never introduce rounding errors. Financial state transitions must be atomic (RPCs / single statements); no partial state on failure.

---

## 5. Booking flows

### 5.1 Single booking

Customer selects tour → slot → guests → add-ons → checkout (Yoco) → payment webhook confirms → booking `PAID`.

**Holds:** starting checkout places a hold on the slot (~15 min) that reserves capacity. A ~5-minute grace window past expiry allows late payment webhooks to still confirm — a webhook arriving in the grace window must **not** be cancelled for hold expiry. `cron-tasks` (every 5 min) releases holds past expiry + grace. Invariant: `SELECT count(*) FROM holds WHERE expires_at < NOW() - INTERVAL '1 hour' AND released_at IS NULL` = 0.

**Payment-link timing:** no email/WhatsApp is sent at checkout start; if the 15-min hold lapses unpaid, the cron emails the stored `payment_url` so the customer can complete payment later.

### 5.2 Combo booking (cross-tenant)

Customer selects tours from multiple operators → single Paysafe checkout → `paysafe-webhook` calls the `confirm_combo_payment_atomic` RPC → both child bookings transition to `PAID` atomically → `combo_settlements` rows split the amount per tenant. EXECUTE on the RPC is revoked from PUBLIC (a P0 was fixed 2026-07-04 where anon could execute it and create free bookings).

### 5.3 Reschedule

- Equal price → atomic slot swap, no payment.
- Higher price → uplift payment first, then swap.
- Lower price → refund the difference.
- Cross-tour and quantity-shrink reschedules are supported; `pending_reschedules` tracks in-flight ones.

### 5.4 Guest edit

Increase → uplift payment + waiver invalidation. Decrease → refund + capacity return.

### 5.5 Cancel

Refund amount comes from the tenant's time-based refund policy tiers. The slot is **always** released on cancellation. Weather cancellations are a separate admin flow (`weather-cancel` fn, per-slot UI) with its own refund handling. Slot "close" (stop selling) is distinct from "cancel" (refund guests).

---

## 6. Payments

| Provider | Use case | Signature | Notes |
|---|---|---|---|
| **Yoco** | Single-tenant card payments | HMAC-SHA256 | Primary provider; canonical for invoice issuance logic |
| **Paysafe** | Combo/split-pay across tenants | HMAC-SHA256 | Settlement splitting in combo flow |
| **PayFast** | Legacy ITN | MD5 + server-side validation round-trip | May be decommissioned |

Webhook rules (all providers):

1. **Verify signature before any business logic.** Missing/invalid → 401, zero DB writes.
2. **Idempotency:** `idempotency_keys` keyed by provider payment ID. Check before processing, insert on success. Duplicate webhook → 200, no re-processing.
3. **PayFast fails closed:** MD5 check AND a server-side validation API call. If validation fails (network error, non-200) → 4xx, booking is NOT marked PAID.
4. **Atomicity:** payment/refund state changes leave no partial state on failure.

Refunds run through `process-refund` / `batch-refund` and the tenant refund policy. Invoicing: `tenant_invoice_sequences` provides per-tenant numbering; `send-invoice` renders and emails; Yoco webhook's `createInvoice` subtotal/discount logic is the canonical implementation.

---

## 7. Edge functions (Deno)

All under `/supabase/functions`. Cross-function and external callers use the `sb_secret_*` service key, which is **not a JWT** — any function invoked that way needs `verify_jwt = false` in `supabase/config.toml` (the gateway's legacy JWT check would 401 otherwise). Internal auth is then enforced in-function (signatures, role checks, shared-secret headers).

**Payment webhooks:** `yoco-webhook`, `paysafe-webhook`, `payfast-itn`.

**OTA webhooks & sync:** `viator-webhook`, `getyourguide-webhook`, `viator-availability-sync` (hourly :07), `getyourguide-availability-sync` (hourly :12), `ota-reconcile` (daily 02:37 UTC), `external-booking` (HMAC-verified external/partner booking API).

**Messaging:** `wa-webhook` (inbound WhatsApp; Meta `x-hub-signature-256` verified with `WA_APP_SECRET`; dedup via `processed_wa_messages`), `wa-send` / `send-whatsapp-text` (Meta Cloud API outbound), `send-email` (Resend), `admin-reply`, `broadcast`, `web-chat` (site chatbot), `outbox-send`.

**Cron-invoked:** `marketing-dispatch` (every minute), `marketing-automation-dispatch`, `cron-tasks` (every 5 min — hold release, scheduled tasks, unpaid payment-link emails), `auto-messages` (daily 09:23 UTC), `reminder-scheduler` (WA-first reminders with waiver bundling), `fetch-google-reviews` (daily 03:17 UTC), `kb-sync` (hourly RAG re-embed), `hold-expiry`, `cron-jobs`.

**Booking lifecycle:** `create-checkout`, `create-paysafe-checkout`, `confirm-booking`, `manual-mark-paid`, `cancel-booking`, `rebook-booking`, `weather-cancel`, `process-refund`, `batch-refund`, `waiver-form`, `send-trip-photos`.

**Customer self-service:** `send-otp`, `my-bookings-lookup`.

**Marketing:** `marketing-track` (pixel/click), `marketing-unsubscribe`.

**Platform:** `super-admin-onboard`, `generate-invite-token`, `bank-details`, `send-invoice`, `google-drive`, `debug-logs`.

CORS on tenant-admin-invoked functions must use the shared `isAllowedOrigin` helper (supports `*.admin.bookingtours.co.za`).

---

## 8. Messaging, bots, and RAG

- **Channels:** WhatsApp (Meta Cloud API) and web chat, unified into one admin inbox (`conversations`/`messages`), with real handoff from bot to human.
- **Bot pipeline** (`_shared/bot-gate.ts`, `intent.ts`, `llm.ts`): per-tenant enable toggle → business-hours gate (incl. overnight ranges) → intent matching → LLM (GLM-5.2) with tenant knowledge.
- **RAG:** per-tenant knowledge base embedded into `kb_chunks` (pgvector), matched via `match_kb_chunks` RPC with exact per-tenant scan (scales to 2000 tenants), refreshed hourly by `kb-sync`. Used by both WA and web-chat bots.
- **Idempotency:** inbound WA messages dedup via `processed_wa_messages`; auto-messages upsert on `(booking_id, type)` so re-running crons never duplicates reminders/confirmations/review requests.
- **Timezones:** reminders and review requests fire relative to each tenant's configured timezone, never a fixed UTC offset.
- **Fallback:** WhatsApp send failures surface in admin (wa-failures API + `WaFailureWatcher`) and fall back to email for notifications.
- Broadcasts respect WhatsApp's 24-hour session window (template routing outside it).

---

## 9. Marketing

All scoped by `business_id`: contacts, campaigns, templates, automations, queue.

- `marketing-dispatch` cron drains `marketing_queue` every minute.
- Automations: date-field triggers with day offsets, multi-step (`marketing_automation_steps`), enrollment tracking, promo-code generation.
- Tracking: open pixels + click redirects → `marketing_events`.
- Unsubscribe: tokenized link flips contact status; unsubscribed contacts are excluded from all future sends.
- Monthly usage metering via `marketing_usage_monthly` feeds plan limits/billing.

---

## 10. OTA integrations (Viator, GetYourGuide)

- Bookings arrive via signature-verified webhooks; availability pushes run hourly; `ota-reconcile` audits drift daily (admin `/ota-drift` page).
- OTA bookings attach to the tenant that configured the integration (credentials in `external_booking_credentials`, encrypted).
- `idempotency_keys` prevents duplicate booking creation on webhook replay; `external_webhook_events` logs raw events.
- Product mapping: `external_product_mappings` links OTA product codes to local tours.

---

## 11. Security model

- **RLS baseline:** `supabase/security-baseline.json` records expected RLS enablement, grants, and policies for all 67 public tables. `npm run check-security-drift` (needs `DATABASE_URL`) diffs live state and **must exit 0 before any deploy**.
- **Secrets:** Yoco/Paysafe/PayFast keys, `SERVICE_ROLE` key, and `SETTINGS_ENCRYPTION_KEY` exist only in edge-function env — never in `/app`, `/booking/app`, or `/components`. The admin app (Vercel) and edge functions (Supabase) must hold the **same** `SETTINGS_ENCRYPTION_KEY` (a mismatch silently breaks all credential decrypts).
- **Encrypted columns:** Paysafe credentials and OTA `api_key_encrypted` use pgcrypto with `SETTINGS_ENCRYPTION_KEY`; the key is stored separately from DB backups.
- **RPC grants:** privileged RPCs (e.g. `confirm_combo_payment_atomic`) must have EXECUTE revoked **from PUBLIC** (revoking from `anon` alone is insufficient — anon inherits PUBLIC).
- **Content rendering:** no `dangerouslySetInnerHTML` with user-supplied content; admin-curated email templates are the only exception. Booking site sanitises with DOMPurify.
- **Image proxy:** `/api/img` validates URLs against a host allowlist; `file://`, `ftp://`, and path traversal are rejected.
- **POPIA:** data-request fulfilment (`/api/admin/data-requests`), customer-data obfuscation backend, `/popia` surfaces in both apps (see `docs/POPIA_DATA_OBFUSCATION.md`).
- **Rate limiting:** `api_rate_limits` + OTP attempt limits.
- **Audit:** `audit_logs` for privileged actions.

---

## 12. Testing & verification

| Check | Command |
|---|---|
| Unit tests (Vitest) | `npm run test:unit` |
| E2E (Playwright) | `npm run test:e2e` (suites: smoke, happy-path booking, bot regressions) |
| Edge function typecheck | `npm run check:edge` (deno check on web-chat, wa-webhook, send-otp, my-bookings-lookup) |
| Security drift | `npm run check-security-drift` — must exit 0 |
| Lint / build | `npm run lint`, `npm run build` |

Pre-commit checklist (from `.claude/CLAUDE.md`): business_id filtered on every scoped query · new tables get RLS + baseline entry · webhooks verify signature first, check idempotency, fail closed · payment/refund changes are atomic · security drift exits 0.

---

## 13. Deployment & operations

- **Admin app:** Vercel project `caepweb-admin`; tenants access via `{tenant}.admin.bookingtours.co.za`.
- **Booking site:** Vercel; bare `booking.bookingtours.co.za` plus wildcard tenant subdomains (bare name must be attached explicitly — wildcard doesn't cover it). DNS zone is on Vercel nameservers.
- **Edge functions:** deployed via Supabase CLI/MCP; cron schedules in Supabase (see §7 for times).
- **Deploy discipline:** edge functions, admin app, and booking app often change together — coordinate deploys; run security drift first. Deploys are done via `vercel --prod` and Supabase function deploy, not tied to git commits (working tree is often ahead of main).
- **Observability:** Sentry (both apps + shared edge helper), `logs`/`debug-logs`, Supabase logs via MCP.

### Known scale posture (2000-tenant readiness, audited 2026-07-04)

Resolved: 4 security P0/P1s, per-tenant exact-scan RAG. Open items: cron functions truncate at 1000 rows per query page, some per-request full scans, and the per-tenant deploy model — tracked in `docs/qa/SCALE_READINESS_2026-07-04.md`.

---

## 14. Key conventions for contributors

1. TypeScript for all new code; Tailwind for styling.
2. Supabase client queries only — never raw SQL concatenated with user input.
3. Prices in ZAR; match the existing unit (cents vs decimal) of the column you touch.
4. Every scoped query filters `business_id`; every privileged route checks role server-side.
5. Webhooks: signature → idempotency → business logic, failing closed.
6. New public table = RLS + baseline entry + drift check.
7. Related deep-dives live in `/docs` (brand system, admin redesign spec, POPIA, stress-test plan, QA remediation logs).
