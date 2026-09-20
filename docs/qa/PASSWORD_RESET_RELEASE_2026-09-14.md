# Password reset production repair — 14 September 2026

Password-reset email requests failed because the production admin app's
`SUPABASE_SERVICE_ROLE_KEY` was an older service-role JWT that still worked for
database access but was not accepted by the deployed email service. Its HTTP 401
`Unauthorized` response was propagated through `/api/admin/setup-link` to the
password page. The booking project had the same credential mismatch.

Both production projects now use the verified current server credential and
have been redeployed. No database policies, authentication guards or edge
functions were changed. The previous page-rendering smoke test did not verify
password recovery and should not have been reported as verification of that flow.

## Release

- Admin code: `bd100ce7ee9ec0b660ddd90cae253eab42dd1637`.
- Tag: `deploy-2026-09-14-2`.
- Admin: `dpl_7WXrHXNnSE4jqQXoHs7DarbAdmLB`, Ready / production / promoted,
  serving [admin.bookingtours.co.za](https://admin.bookingtours.co.za).
- Admin deployment URL: `https://caepweb-admin-crger7qgy-jerrys-projects-f4e4eaf9.vercel.app`.
- Booking: `dpl_GGUoC3FyJDhuiwrk2kuMpHWMaJsi`, Ready / production / promoted,
  serving [Jerrys booking](https://jerrys.booking.bookingtours.co.za).
- Booking source remains `460e58d952ad570c9036bc13118eec66a2591918`; its
  production credential changed.

The admin `prebuild` script now invokes `scripts/check-service-auth.mjs` in
production. It uses the same Supabase SDK connection as password recovery and
requests an unknown email template. The expected HTTP 400 proves authorization
passed while ensuring no email is sent. HTTP 401, unavailable configuration or
an unexpected response fails the build. Both old production credentials failed
this check; the replacement passed. The hosted admin build passed it at
05:10:32 UTC before compiling the app.

To run the same non-sending check explicitly with a privately downloaded
production environment file:

```sh
node --env-file=/path/to/private-production.env scripts/check-service-auth.mjs --force
```

Verify the credential for each project when changing production configuration;
a working database query alone does not verify internal email authorization.

## Verification

- TypeScript and ESLint passed; ESLint retains 274 warnings and no errors.
- All 1,044 unit tests passed, with one pre-existing skip. All 55 edge functions
  passed type checking. The first isolated run lacked booking source fixtures;
  restoring the pinned booking source resolved those failures.
- Admin and booking production builds passed locally and on Vercel. The local
  booking build used Webpack because Turbopack cannot follow dependencies linked
  outside an isolated checkout. Font downloads required network access.
- Live database security matched the baseline: 1,240 grants, 86 tables and
  225 policies. No schema, grants or policies changed.
- Eight deployed files matched the release by content hash: the package,
  authorization check, reset/change/login routes, password page, AuthGate and
  CSP configuration.
- A clean Chrome test exercised the live password page at 05:16 UTC. An
  unauthenticated reset-email request returned HTTP 200 and showed the success
  message. The recipient was a labelled
  [Resend delivery simulator](https://resend.com/docs/dashboard/emails/send-test-emails),
  not a person. The test used a disposable, non-trading ONBOARDING tenant and
  administrator; an existing tenant's one-admin limit was preserved.
- The simulator has no inbox from which this test can retrieve the emailed
  link. The test therefore seeded a known token only on its disposable account
  and separately exercised live token validation and password completion.
  Completion returned HTTP 200, updated both password stores and consumed the
  token. Signing in through the live form with the replacement password returned
  HTTP 200 and a session. The old password returned HTTP 401.
- The password-page phase produced no console errors, unhandled page errors or
  remote Google Fonts requests. The reported Lato and extension-listener errors
  were not reproduced. A later dashboard navigation requested other Google
  fonts; that is separate from the password-page assertions. CSP was unchanged.
- The temporary Auth user, administrator and tenant were removed. At 05:18 UTC,
  live logs contained the test's ADMIN_WELCOME reset send and no matching email
  errors; database reads confirmed the administrator and tenant were gone.
- All four existing live browser smoke tests also passed: booking tours, chat
  opening, password-page rendering and admin login-page rendering.

Initial uploads failed before promotion because the isolated checkout reported
a local Git remote and then contained a dangling booking symlink. Correcting
the remote to the actual GitHub repository and replacing the temporary symlink
with source files resolved these packaging problems. Neither failed upload
replaced the previous production site.

## Rollback

The preceding admin deployment is `dpl_5xjxhY4D8AXN8Hqohs97Ey1XDcvK`; the
preceding booking deployment is `dpl_83oMmVAETKUBAc5ejukMwCk9hg6h`.
Their captured credentials caused this incident. Prefer redeploying the prior
source with the corrected production credential, then running the authorization
check and live recovery verification. A direct rollback to either old deployment
can reintroduce the password-reset failure.

Prior source commits are `18050b0d300323006bba5a758cf44f2222e90bd4` for admin
and `460e58d952ad570c9036bc13118eec66a2591918` for booking. From an isolated,
correctly linked checkout of the required source, retain the corrected project
configuration and run:

```sh
vercel deploy --prod --yes --scope jerrys-projects-f4e4eaf9
```

Private environment backups and verification artifacts are under
`/private/tmp/capekayak-password-reset-m6k786k9/`, with private directory/file
permissions. No secret values are committed. This repair verifies the recovery
paths described above; it does not establish that every application flow is
free of defects or verify delivery to a real user's inbox.
