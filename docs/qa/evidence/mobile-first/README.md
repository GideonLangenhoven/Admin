# Mobile-first screenshot evidence

Status: **NOT RUN on 2026-09-15**.

The host computer-use service reported `No browser is available` when asked to open the local booking build. No implementation screenshots were invented or copied from the earlier live review.

The runnable matrix is [mobile-first-layout.spec.ts](../../../../tests/e2e/mobile-first-layout.spec.ts). It writes deterministic screenshots into this directory when run from a browser-enabled, isolated test environment:

```bash
MOBILE_TEST_ADMIN_EMAIL='isolated-fixture@example.invalid' \
MOBILE_TEST_ADMIN_PASSWORD='fixture-password' \
ADMIN_URL='http://127.0.0.1:3000' \
BASE_URL='http://127.0.0.1:3001' \
npx playwright test tests/e2e/mobile-first-layout.spec.ts
```

Do not use a production operator account. The admin tests navigate through real controls and therefore require an isolated fixture database with mocked provider boundaries.

Expected outputs include customer home at every acceptance width, the 320 × 568 booking calendar and open chat, admin Today at 390 × 844, and the mobile guest-action sheet. The test rejects page-wide overflow greater than 1px, undersized standalone mobile controls, clipped chat geometry, the wrong mobile-navigation state, or missing action parity.
