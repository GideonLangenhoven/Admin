# Release checks

`ci.yml` runs on PRs/pushes to main and manual dispatch. It checks lint,
TypeScript, unit tests in both apps, all edge functions and payment/isolation
transactions in a disposable PostgreSQL 17 database. Read-only public browser
smoke tests run after those checks pass. Smoke URLs are `BASE_URL` and
`ADMIN_URL` secrets; use the actual booking link, including `.booking.`.

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

Required branch checks must be enabled separately in GitHub repository rules.
