# Release checks

`ci.yml` runs on PRs/pushes to main and manual dispatch. It builds Admin and
the exact storefront and onboarding commits pinned in the workflow under
Node 22.23.2, with synthetic Supabase configuration and no provider keys. It
requires full and production dependency audits, lint, TypeScript, companion
contracts, Admin unit tests, Edge checks and payment/isolation transactions in
a disposable PostgreSQL 17 database. The deployed browser smoke runs only on
manual dispatch after these source checks pass; it checks the URLs in
`BASE_URL` and `ADMIN_URL` secrets, not the candidate builds. Use the actual
booking link, including `.booking.`. Hosted Lighthouse audits are also manual;
their real-tenant credentials are never used by automatic candidate checks.

Publish the pinned storefront and onboarding commits before publishing the
Admin workflow commit, or its companion checkouts cannot resolve. Companion
repositories also run their own source checks on PRs and main. GitHub branch
rules must require the desired jobs separately.

`e2e-on-main.yml` is a **manual, provider-writing** test. It never silently skips
its payment case. Configure these dedicated secrets before dispatching it:

- `RELEASE_TEST_BOOKING_URL`, `RELEASE_TEST_ADMIN_URL`
- `RELEASE_TEST_ADMIN_EMAIL`, `RELEASE_TEST_ADMIN_PASSWORD`
- `RELEASE_TEST_CUSTOMER_EMAIL`, `RELEASE_TEST_CUSTOMER_PHONE`

The account must be a MAIN_ADMIN for a dedicated test business with Yoco test
keys, a test webhook and test mode enabled. Customer recipients must approve
receiving test messages. The test refuses a storefront from another business.
Never run it using a real client's live merchant configuration.

The database harness needs no production credentials. Provider completion,
message delivery and refunds still require the human checks in
`docs/qa/MVP_SMOKE_RUNBOOK.md`; unit/mock success is not provider evidence.
