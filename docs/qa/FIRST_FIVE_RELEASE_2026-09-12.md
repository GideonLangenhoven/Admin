# First-five release verification — 12 September 2026

## Decision

The technical remediation is deployed. Assisted account setup can proceed;
accepting customer payments still requires each client's payment and message
checks below. This is not an unconditional public-launch approval.

Use [the plain-English onboarding checklist](FIRST_FIVE_CLIENTS_2026-09-13.md)
separately for each owner. Never use a platform SUPER_ADMIN account as evidence
that a client's own access is isolated.

## Verified

- 960 unit tests passed; one pre-existing test skipped.
- 150 disposable PostgreSQL checks cover payment transactions, concurrent
  holds/voucher spending, refunds, tenant relations and permission boundaries.
- 340 live API checks passed with five separate temporary MAIN_ADMIN accounts.
  Every ordered pair was tested: private reads, changes, voucher debit,
  capacity reservations, refund previews, foreign record links, cancellations,
  refunds, manual payment and confirmation-message requests.
- Each owner could read its own records; valid customer proof continued to work;
  suspending an owner invalidated data access using its existing session.
- All five generated businesses and authentication accounts were removed.
  No existing client's records were deleted and no client messages were sent.
- Live aggregate checks found zero cross-client booking/tour/slot/customer/hold
  links, zero mixed marketing enrollments and zero oversold slots.
- No duplicate WhatsApp phone-ID routing was found across the configured businesses.
- Production browser smoke: booking homepage, chat opening, administrator login
  and password-reset page all passed on the canonical domains.
- Both production builds completed. TypeScript and all 55 edge checks passed;
  root lint has no errors (existing warnings remain).

This is evidence for the tested paths, not a guarantee that every possible
vulnerability or third-party failure has been eliminated.

## Deployed

Administrator: `caepweb-admin-jusfpuhsg-jerrys-projects-f4e4eaf9.vercel.app`.
Storefront: `booking-nnvaabk38-jerrys-projects-f4e4eaf9.vercel.app`.
Their live domains were promoted after successful production builds.

The September migration ledger was reconciled with verified installed batches.
Missing pricing, amendments, cancellation, durable refunds, manual capacity,
checkout request and unfulfilled-payment transactions were applied. New client
boundaries use composite foreign keys and independent booking proof; tenant
headers or booking references alone cannot grant private access.

Twenty release edge functions were deployed, including the six message workers
and the booking/payment/refund/chat handlers. Message workers now accept the
configured server API key used by scheduled jobs. The four job schedules were
preserved. Administrator-invoked functions validate sessions internally rather
than relying on the gateway's legacy JWT algorithm check.

Before deployment, private schema snapshots and deployed edge source were saved
under `/private/tmp/capekayak-release-*` and
`/private/tmp/capekayak-edge-backup-cFB3VQ`. These are deployment evidence, not a
substitute for database backups. Never commit or share those private snapshots.
The previous frontend deployments remain in Vercel; do not roll the storefront
back across the new booking-proof policy without a compatible release.

## Remaining owner/provider checks

1. No configured business had Yoco test keys and a test webhook at inspection.
   Configure a dedicated test business in Settings; never paste keys into chat.
2. An approved test email and WhatsApp recipient are still required. Verify
   actual delivery, not just a queued/sent flag in the application.
3. Complete the test payment, signed webhook confirmation, amendment and refund
   checks in [the smoke runbook](MVP_SMOKE_RUNBOOK.md). Webhook replay requires a
   genuine captured test event; it has not been claimed as live-verified here.
4. For each real client, verify their own live merchant/webhook configuration
   before sharing their public booking link. WhatsApp may be explicitly deferred
   while Meta setup is pending; tell the owner which channel is actually working.

Eight older completed bookings in the existing Kayak business have a zero
recorded cash capture despite a nonzero booking price. Historical amounts were
not rewritten. Both refund entry and reservation now refuse to invent cash
from the ticket price. Reconcile those specific payments against provider or
manual-payment records before refunding them. They are not the new clients'
bookings.

Sentry source-map/release upload reported configuration warnings during builds
(administrator project not found; storefront upload token absent). The builds
succeeded, but enriched error-reporting setup is not claimed as verified.

CI publication/check results are recorded in the release handoff once complete.
