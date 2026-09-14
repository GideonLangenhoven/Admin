# Functional repairs — 11 September 2026

Scope: password resets for all admin roles, reset email delivery, scheduled
workers, checkout updates, and voucher/capacity transaction correctness.
The broader cybersecurity review is deferred at the user's request.

## Password resets and worker calls

The user reported `Unauthorized` when requesting a reset. The admin server uses
a `sb_secret_` project key, while the shared edge helper recognized only the
legacy `SUPABASE_SERVICE_ROLE_KEY`. The helper now also matches the project's
configured `SUPABASE_SECRET_KEYS` values, including calls using the `apikey`
header. Existing administrator role and operator checks remain in place.

Read-only checks confirmed that the configured local server key can access the
data API (HTTP 200, zero rows requested) and that the hosted edge environment
contains `SUPABASE_SECRET_KEYS`. Supabase documents
the separate [edge key environment](https://supabase.com/docs/guides/functions/secrets)
and [API-key headers](https://supabase.com/docs/guides/functions/auth-headers).

Password completion, privileged reset, self-service change, and legacy account
provisioning now share `setAdminAuthPassword`. An Auth failure is reported before
changing the legacy login hash or consuming the setup link. An unlinked existing
Auth account can be found beyond the first 1,000 accounts. Reset tests sign in
with the resulting password for ADMIN, MAIN_ADMIN, and SUPER_ADMIN.

`20260911110000_message_job_key_compatibility.sql` preserves the four existing
worker URLs and schedules, and reads the configured Vault key into the `apikey`
header. It does not rotate keys or run any jobs. Deploy the worker helper update
before applying this migration. The legacy key format also remains supported.

## Checkout and payment confirmation

The storefront now uses its booking client for HELD/cancellation updates and
booking RPCs. Updates request the changed row and report failure instead of
continuing after a zero-row write. Sold-out bookings clear their saved draft.
Voucher confirmations reuse the returned waiver token for the waiver link.

`20260911120000_atomic_voucher_confirmation.sql` corrects four existing RPCs:

- Reservation retries replace their own reservation amount and can reopen a
  released reservation without adding the amount twice.
- Settlement checks complete funding and rolls back earlier voucher deductions
  if any later voucher fails. Missing ledger coverage is rejected.
- Payment confirmation checks capacity before settlement, converts its own
  matching holds, and checks the expected currency.
- Reservation release serializes with reservation and settlement on the booking.

The migration changes definitions only; it does not reconcile historical money
records. Existing service-only grants are preserved. Legacy checkouts claiming
voucher funding without a reservation require reconciliation rather than being
silently treated as fully funded.

## Verification and rollout state

- 106 targeted unit tests passed: reset/sign-in, worker compatibility, checkout.
- 99 disposable PostgreSQL checks passed, including positive checkout writes,
  insufficient funding, multiple-voucher rollback, payment replay, competing
  last-seat confirmations, and concurrent reservations.
- Both applications passed TypeScript checks and webpack production builds; the
  storefront's default Turbopack build also passed. All 55 edge functions passed
  `deno check`. Changed application files passed ESLint with no errors.
- The broader unit run found three failures in older source-text assertions for
  reschedule/add-guest handling. Those files were being edited by another session;
  their final implementation and `confirm_booking_uplift` migration must be
  verified after that work finishes.

The parallel [customer journey review](CUSTOMER_JOURNEY_REVIEW_2026-09-11.md)
also records open pricing, cancellation, refund and amendment issues. This batch
does not resolve that separate review or establish whole-application readiness.

No production deployment, migration, password reset, customer message, or payment
was performed in this repair session. The observed live configuration is newer
than the original 6 September remediation document: some changes were already
deployed, the data API responds, and scheduled jobs already include credentials.
Reconcile installed SQL definitions with migration history before deployment.

Pricing-trigger compatibility and the privileged-RPC review remain deferred with
the broader cybersecurity work. These functional checks do not establish a
complete security review or provider/browser end-to-end payment delivery.
