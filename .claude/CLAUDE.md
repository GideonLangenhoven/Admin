BookingTours
Multi-tenant SaaS booking platform for adventure and tourism operators. Multiple independent businesses share one codebase, database, and infrastructure. Tenant isolation is a security-critical requirement at every layer.

The name of the company is BookingTours, not Cape Kayak Adventures

Architecture
/app                    → Admin dashboard (Next.js 16, port 3000)
/booking/app            → Customer booking site (Next.js 16, port 3001)
/supabase/functions     → Deno edge functions
/supabase/migrations    → Postgres migrations
/components             → Shared React components
Stack: React 19, Tailwind 3, TypeScript, Supabase (Postgres + Deno edge functions), npm only (no yarn/pnpm).
Multi-tenancy — read this first
Every decision in this codebase must account for tenant isolation. Violations are treated as security incidents.
Rules:

Every business-scoped table has a business_id column. RLS is enabled on all public tables.
Every Supabase .from() call against a business-scoped table MUST include .eq("business_id", ...) within the query chain, OR use service_role with business_id derived from a trusted source (webhook payload, cron context, authenticated session).
Never trust a client-supplied business_id. Always resolve it server-side from the authenticated session or subdomain lookup.
Subdomain → business_id resolution lives in supabase/functions/_shared/tenant.ts (edge functions) and the BusinessContext component (admin app).
Combo bookings intentionally span tenants. Settlements must split amounts correctly per tenant. This is the only legitimate cross-tenant data flow.

Business-scoped tables (not exhaustive —if a table has business_id, it's scoped):
bookings, customers, slots, vouchers, marketing_contacts, holds, refunds, invoices, marketing_campaigns, marketing_automations, conversations, photos, broadcasts, refund_policies, tours, add_ons, shared_resources, reviews, combo_settlements, promo_codes, auto_messages, marketing_queue
When adding a new table: Add business_id column, create RLS policies, add to supabase/security-baseline.json, and run npm run check-security-drift to confirm.
Payments
ProviderUse caseSignatureNotesYocoSingle-tenant card paymentsHMAC-SHA256Primary providerPaysafeCombo/split-pay across tenantsHMAC-SHA256Settlement splitting logic in combo flowPayFastLegacy ITNMD5 + server-side validation round-tripMay be decommissioned
Webhook rules:

Verify signature BEFORE any business logic. Missing or invalid signature → return 401, zero DB writes.
All payment webhooks use the idempotency_keys table. Check for existing key before processing. Duplicate webhooks must be safe (return 200, no re-processing).
PayFast specifically requires both MD5 signature check AND a server-side validation API call. If the validation call fails (network error, non-200), fail closed — return 4xx and do NOT mark the booking as PAID.

Idempotency

Payment webhooks: idempotency_keys table keyed by provider payment ID. Check before processing, insert on success.
Auto-messages: upsert on (booking_id, type) — prevents duplicate reminders, confirmations, review requests.
OTA webhooks (Viator, GYG): idempotency_keys prevents duplicate booking creation on webhook replay.

Roles
Stored in profiles.role. Three levels:
RoleAccessOPERATORDay-to-day operations only (bookings, inbox, manifest). No settings, billing, or admin management.MAIN_ADMINFull tenant access. Cannot access super-admin routes.SUPER_ADMINPlatform-wide access. Can create/manage tenants.
Every privileged route must have a server-side role check before data access. Hiding a nav link is not security — direct URL access must also be rejected with 401/403.
Edge functions
Located in /supabase/functions. Each function is a Deno module.
Shared utilities: /supabase/functions/_shared/ contains tenant resolution, auth helpers, and provider clients.
Webhook handlers:

yoco-webhook/ — Yoco payment confirmation
paysafe-webhook/ — Paysafe payment + combo settlement
payfast-itn/ — PayFast ITN (legacy)
viator-webhook/ — Viator OTA booking sync
gyg-webhook/ — GetYourGuide OTA booking sync
wa-receive/ — Inbound WhatsApp (Meta webhook, x-hub-signature-256 verification with WA_APP_SECRET)

Outbound:

wa-send/ — Send WhatsApp messages via Meta API
send-email/ — Send emails via Resend

Cron-invoked (verify_jwt=false in config.toml):

marketing-dispatch/ — Every minute, processes marketing email queue
cron-tasks/ — Every 5 min, releases expired holds, processes scheduled tasks
fetch-google-reviews/ — Daily at 03:17 UTC
viator-availability-sync/ — Hourly at :07
getyourguide-availability-sync/ — Hourly at :12
ota-reconcile/ — Daily at 02:37 UTC
auto-messages/ — Daily at 09:23 UTC (review reminders)

Security
Baseline: supabase/security-baseline.json defines the expected RLS state for every public table. Run npm run check-security-drift (requires DATABASE_URL env var) to compare live state. This must exit 0 before any deploy.
Secrets: Yoco/Paysafe/PayFast secret keys, SERVICE_ROLE key, and SETTINGS_ENCRYPTION_KEY must ONLY exist in edge function environment variables — never in client-side code (/app, /booking/app, /components).
Encrypted columns: Paysafe credentials and OTA api_key_encrypted use pgcrypto with SETTINGS_ENCRYPTION_KEY. This key must be stored separately from database backups.
Content rendering: Never use dangerouslySetInnerHTML with user-supplied content. Admin-curated content (email templates) is the only acceptable use case.
Image proxy: /api/img must validate URLs against an allowlist of hosts. Never allow file://, ftp://, or path traversal.
Holds and slot capacity
When a customer starts a booking, a hold is placed on the slot. The hold reserves capacity.

Hold duration: ~15 minutes.
Grace window: ~5 minutes past expiry (allows late-arriving payment webhooks to still succeed).
cron-tasks releases expired holds (past expiry + grace) every 5 minutes.
A payment webhook arriving within the grace window must still confirm the booking — do not cancel due to hold expiry if the hold is within the grace window.
Orphan check: SELECT count(*) FROM holds WHERE expires_at < NOW() - INTERVAL '1 hour' AND released_at IS NULL should always be 0.

Auto-messages and timezones
Reminders and review requests fire relative to each tenant's configured timezone, not a fixed UTC offset. The auto-messages function must read the tenant's timezone when calculating send times.
Auto-messages are idempotent via upsert on (booking_id, type). Re-running the cron must not produce duplicate messages.
Booking flows
Single booking: Customer selects tour → slot → guests → add-ons → checkout (Yoco) → webhook confirms → PAID.
Combo booking: Customer selects tours from multiple operators → single Paysafe checkout → webhook triggers confirm_combo_payment_atomic RPC → both child bookings transition to PAID atomically → settlements split per tenant.
Reschedule: Equal price = atomic slot swap, no payment. Higher price = uplift payment first. Lower price = refund difference.
Guest edit: Increase = uplift payment + waiver invalidation. Decrease = refund + capacity return.
Cancel: Refund amount determined by tenant's refund policy tiers (time-based). Slot always released on cancellation.
Customer self-service
/my-bookings uses OTP login (email-based). The booking list is filtered by business_id server-side (not just client-side). OTPs have a validity window (~10 min) and rate-limiting on failed attempts.
OTA integrations
Viator and GetYourGuide bookings sync via webhooks and periodic availability sync crons. OTA bookings must be associated with the correct tenant's business_id (the tenant that configured the integration). Webhook signatures must be verified. Idempotency prevents duplicate bookings on replay.
Marketing

Contacts, campaigns, templates, automations are all scoped by business_id.
marketing-dispatch cron runs every minute, processes the marketing_queue.
Automations support date-field triggers with day offsets and promo-code generation.
Unsubscribe flips contact status; unsubscribed contacts are excluded from future campaigns.
Open/click tracking via tracking pixels and redirect links.

Conventions

All new code in TypeScript.
Use Supabase client library for queries (parameterised by default — never use raw SQL string concatenation with user input).
Tailwind for styling. No CSS modules or styled-components.
npm only. No yarn or pnpm.
Prices in ZAR (South African Rand), stored as integers (cents) or decimals — be consistent with what the existing code uses. Never introduce rounding errors in financial calculations.

Before you commit

Does your change touch a business-scoped table? Confirm business_id is filtered in every query.
Does your change add a new public table? Add RLS policies and update security-baseline.json.
Does your change handle a webhook? Verify signature first, check idempotency key, fail closed on errors.
Does your change affect payments or refunds? Ensure atomicity — no partial state on failure.
Run npm run check-security-drift — must exit 0.