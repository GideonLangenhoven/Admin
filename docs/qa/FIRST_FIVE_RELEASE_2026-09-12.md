# First-five release verification — 12–13 September 2026

## Decision

The technical remediation is deployed. Assisted account setup can proceed;
accepting customer payments still requires each client's payment and message
checks below. This is not an unconditional public-launch approval.

Use [the plain-English onboarding checklist](FIRST_FIVE_CLIENTS_2026-09-13.md)
separately for each owner. Never use a platform SUPER_ADMIN account as evidence
that a client's own access is isolated.

## Verified

- 974 unit tests passed; one pre-existing test skipped.
- 151 disposable PostgreSQL checks cover payment transactions, concurrent
  holds/voucher spending, refunds, tenant relations and permission boundaries.
- 407 live API/capacity checks passed with five separate temporary MAIN_ADMIN accounts.
  Every ordered pair was tested: private reads, changes, voucher debit,
  capacity reservations, refund previews, foreign record links, cancellations,
  refunds, manual payment and confirmation-message requests.
- Current owner sessions reached their own inbox handler; every cross-client
  inbox change was denied. Owners and anonymous callers were also blocked from
  platform-only client creation and invite-token management.
- All 20 cross-client integration-credential reads were denied. A live k6 race
  sent five simultaneous requests for two seats: exactly two reservations won,
  three were refused and capacity stayed at two.
- Each owner could read its own records; valid customer proof continued to work;
  suspending an owner invalidated data access using its existing session.
- All five generated businesses and authentication accounts were removed.
  No existing client's records were deleted and these isolation tests sent no messages.
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

Administrator: `caepweb-admin-42jizd3ny-jerrys-projects-f4e4eaf9.vercel.app`.
Storefront: `booking-730dapncn-jerrys-projects-f4e4eaf9.vercel.app`.
Their live domains were promoted after successful production builds.

The September migration ledger was reconciled with verified installed batches.
Missing pricing, amendments, cancellation, durable refunds, manual capacity,
checkout request and unfulfilled-payment transactions were applied. New client
boundaries use composite foreign keys and independent booking proof; tenant
headers or booking references alone cannot grant private access.

Twenty-three release edge functions were deployed, including the six message workers
and the booking/payment/refund/chat handlers. Message workers now accept the
configured server API key used by scheduled jobs. The four job schedules were
preserved. Administrator-invoked functions validate sessions internally rather
than relying on the gateway's legacy JWT algorithm check.

On 13 September the final HTTP health check caught a stale scheduler Vault
credential and pg_net's five-second timeout. The credential was replaced with
the already-working server API key, without exposing it. The four message jobs
now have a 60-second request timeout; URLs, payloads and schedules are unchanged.
Subsequent automatic cleanup runs returned HTTP 200, successful reminder results
and zero internal errors; the observed ten-minute window had no failed HTTP
requests. There were no pending marketing queue items or automation enrollments
before restoring the workers. The one scheduled campaign was for December and
had no recipients queued.

Before deployment, private schema snapshots and deployed edge source were saved
under `/private/tmp/capekayak-release-*` and
`/private/tmp/capekayak-edge-backup-cFB3VQ`. These are deployment evidence, not a
substitute for database backups. Never commit or share those private snapshots.
The previous frontend deployments remain in Vercel; do not roll the storefront
back across the new booking-proof policy without a compatible release.

## Remaining owner/provider checks

1. No configured business had Yoco test keys and a test webhook at inspection.
   Kayak was rechecked on 13 September: test key absent, test webhook absent,
   live mode still enabled. Configure test credentials in Settings; never paste
   keys into chat. Do not switch an actively trading business into test mode.
2. Approved test recipients were supplied privately. The live email provider
   accepted one labelled confirmation-template test and WhatsApp accepted one
   labelled text through the Kayak connection. No booking or payment was created.
   The recipient confirmed both messages arrived. These sends prove delivery
   through the message workers, not the complete payment-to-confirmation journey.
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

The final [GitHub CI run](https://github.com/GideonLangenhoven/Admin/actions/runs/34742530940)
passed lint/typecheck, unit/edge/database regressions and production browser smoke.
Payment/isolation regressions are now a required merge check alongside the
existing lint and smoke checks. The security baseline/drift check also passed
on the release branch after reviewing the deployed grant and policy changes.
Release PRs: [administrator #23](https://github.com/GideonLangenhoven/Admin/pull/23)
and [storefront #15](https://github.com/GideonLangenhoven/capekayak-booking/pull/15).
Existing Lighthouse checks initially lacked public build configuration; that
configuration was supplied and their reruns are tracked on the PRs.

The administrator Lighthouse report scored performance 97, accessibility 100,
best practices 100 and SEO 91. Its broader assertions still flagged CSP nonce
hardening, PWA installability and asset-size/unused-code opportunities; this is
not an all-green Lighthouse result. The login's main-content landmark and
explicit input labels were corrected afterward. The storefront audit was
misconfigured: a performance-only preset skipped its required accessibility
audits, while localhost tested the operator directory instead of a tenant.
Both configuration issues were corrected without lowering score thresholds.
The follow-up audit no longer reports the calendar's unnamed buttons or the
tour cards' visible/accessibility-label mismatch. Performance, CSP and PWA
assertions still fail; they have not been disabled or described as passing.

The storefront's previously tracked generated environment file contained an
OIDC token expired on 3 March 2026. The file was removed from the release and
environment-file ignore rules widened. Git history was not rewritten.
