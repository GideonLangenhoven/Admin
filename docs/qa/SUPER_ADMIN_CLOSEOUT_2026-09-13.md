# Super Admin and monitoring closeout — 13 September 2026

**14 September payment follow-up:** the [Yoco verification record](YOCO_PAYMENT_CLOSEOUT_2026-09-14.md)
confirms the credential safeguards are deployed and both repaired test payments
return confirmed. A fresh automatic payment/notification/refund journey remains
to be verified.

The Super Admin and production-monitoring fixes are deployed. This closes the
implementation gaps below; it is not an unconditional approval to accept money
from the first five clients. Use the [onboarding checklist](FIRST_FIVE_CLIENTS_2026-09-13.md)
for each client and the [plain-English Super Admin guide](../admin-help/super-admin.md)
for daily support and Sentry instructions.

## What changed

- Business-detail loads discard stale responses; saving requires the currently
  selected business to match the loaded record. Billing, privacy and notification
  APIs use the selected client, with server-side role and suspension checks.
- Assisted onboarding creates the business, owner, subscription and policies
  together. Retries are idempotent. **Complete missing setup** repairs only
  missing subscription/policy records, without back-billing or sending invoices.
- Seats and trading status use audited database transactions. Seat reductions
  respect active staff; ordinary owners cannot remove platform suspensions.
  Staff can be suspended/reactivated, with last-owner and seat protections.
- Email overage is billed once through platform invoices. Preview and generation
  share a calculation that includes seat history. Unpaid drafts without a payment
  link can be voided and replaced; voided documents remain visible. Checkout and
  payment recording are idempotent and validate invoice, amount and currency.
- Platform bank-details and invoice-checkout edge endpoints now require a server
  identity; browser users cannot bypass the platform API authorization.
- **Client readiness & support** shows setup checks, explicit human-verified
  release checks, notification/refund problems and the latest 100 safe audit
  entries. Settings being saved never automatically marks a delivery/payment test
  as passed. Destructive or financial actions have explicit confirmations.
- Admin and booking Sentry configuration is repaired, with release/source-map
  uploads verified in both production builds. Events identify app/client/function
  where available and remove sensitive request fields. Core edge handlers also
  report returned failure responses, not only uncaught exceptions.
- Production new/regressed-error and error-spike email rules target the platform
  owner's Sentry account. The included cron monitor tracks booking cleanup and
  reminders every five minutes. Genuine production check-ins at 08:50 and 08:55
  UTC both completed successfully; these were not synthetic test events.

## Verification

- 1,042 unit tests passed; one existing test skipped. Both app typechecks passed;
  edge-function checks passed; lint has no errors (existing warnings remain).
- 152 disposable PostgreSQL scenarios passed, including the platform onboarding,
  seats, pause/suspension, readiness isolation and invoice lifecycle scenario.
  The new migration and platform scenario also passed against the real schema
  inside a transaction that rolled back. No customer payment records were edited.
- 455 live access checks passed using five disposable client accounts, including
  all ordered client pairs, platform-only API denial, credentials/inbox denial,
  forged billing targets and suspended sessions. The five businesses and auth
  accounts were removed by the test's exact-ID cleanup. No messages were sent.
- Four production browser smoke tests passed: tenant storefront, chat opening,
  admin sign-in screen and password-reset screen. This is not an authenticated
  visual walkthrough of every new Super Admin control.
- The deployed security snapshot matches the reviewed baseline. The new readiness
  table is RLS-enabled and service-only; no client-readable grant was added.
  No duplicate WhatsApp phone-ID routing was found in the configuration check.

Release changes are tracked in [admin PR #23](https://github.com/GideonLangenhoven/Admin/pull/23)
and [booking PR #15](https://github.com/GideonLangenhoven/capekayak-booking/pull/15).
The live sites are [Admin](https://admin.bookingtours.co.za) and
[Kayak's test storefront](https://jerrys.booking.bookingtours.co.za).
Migration `20260913100000_platform_admin_controls.sql` is applied. The source-map
upload destination is Sentry `bookingtours/javascript-nextjs`, environment
`production`. Existing unrelated working-tree changes were preserved.

## Still requires evidence or a separate operational process

1. Kayak now has test mode, a test payment key and a test webhook configured.
   Live keys are not configured for Kayak at this inspection. A genuine hosted
   test payment, signed confirmation and completed test refund have not yet been
   verified in this closeout. Saved keys and database simulations are not that test.
   Do not publish Kayak as a live-money checkout in its current test configuration.
2. The earlier ordinary email and WhatsApp release tests were received. Sentry
   alert-email delivery is a separate check: permission for one labelled test
   error was requested and remains pending. The available Sentry token also lacks
   issue/event-read access, so individual production issues could not be inspected.
3. Once an invoice has a payment link, do not void it or create another payable
   replacement until provider cancellation is verified. Paid-document corrections
   and credit notes require reconciliation/accounting support, not deletion.
4. Only cleanup/reminders has a missed-run monitor in this release. Marketing
   functions report failures but have no separate missed-run monitor. There is no
   independent website uptime monitor. No paid monitoring allowance was added.
5. Historical Kayak capture discrepancies and the pre-existing Lighthouse
   performance/CSP/PWA assertions remain as described in the
   [earlier release evidence](FIRST_FIVE_RELEASE_2026-09-12.md). They have not been
   silently cleared, rewritten or disabled by this work.

For launch week: check **Client readiness & support** and Sentry production
issues at the start/end of the day and after each onboarding. Investigate payment,
refund, sign-in, wrong-client-data and missed-job problems first. Share the issue
link and client name with your developer; do not repeatedly retry financial actions.
