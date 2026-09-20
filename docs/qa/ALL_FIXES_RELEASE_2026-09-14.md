# Outstanding fixes deployed — 14 September 2026

The application fixes listed below are deployed. The admin and six edge
functions changed. The booking app already
matched its deployed release; no storefront deployment or schema migration was
needed. Existing Yoco payment safeguards remain live.

## Release

- Deployed code: `18050b0d300323006bba5a758cf44f2222e90bd4`.
- Deployment tag: `deploy-2026-09-14-1`.
- Admin deployment: `dpl_5xjxhY4D8AXN8Hqohs97Ey1XDcvK`, Ready / production,
  serving [admin.bookingtours.co.za](https://admin.bookingtours.co.za).
- Deployment URL: `https://caepweb-admin-ouaqr1whd-jerrys-projects-f4e4eaf9.vercel.app`.
- Booking remains on `dpl_83oMmVAETKUBAc5ejukMwCk9hg6h`, source
  `460e58d952ad570c9036bc13118eec66a2591918`.
- Release review: [Admin PR #23](https://github.com/GideonLangenhoven/Admin/pull/23).

| Edge function | Deployed version |
|---|---|
| `external-booking` | 65 |
| `getyourguide-availability-sync` | 22 |
| `getyourguide-webhook` | 23 |
| `ota-reconcile` | 21 |
| `viator-availability-sync` | 22 |
| `viator-webhook` | 28 |

## Behaviour

External booking credentials use the encrypted HMAC column and service-only
decryption RPC. Decryption failures cannot downgrade authentication. The old
public plaintext-backfill action returns HTTP 410. Only active MAIN_ADMINs for
the credential's business, or active SUPER_ADMINs, may change its HMAC secret.
The settings UI reports partial credential-save failures and preserves the new
API key without displaying an unsaved HMAC secret as usable.

Uncertified Viator/GetYourGuide adapters are blocked in both the admin API/UI
and all five native OTA handlers. Mapping preparation remains available; saved
mappings cannot enable bookings or synchronisation. The generic signed external
booking API remains available. See [OTA connectivity status](../OTA_DIRECT_CONNECTIVITY.md).

No native OTA integrations were configured at deployment. Cron jobs 24
(`viator-availability-hourly`, `7 * * * *`) and 26
(`ota-reconcile-nightly`, `37 2 * * *`) were paused to avoid repeated expected
503 alerts. Their definitions were preserved; other schedules were unchanged.
The legacy plaintext column still exists, but no non-null plaintext secret
lacked an encrypted counterpart. The one configured encrypted credential
decrypted successfully before deployment. No credential migration was needed.

## Verification

- Admin typecheck, lint, 1,044 unit tests and all 55 edge checks passed. One
  existing test remains skipped; lint has 274 warnings and zero errors.
- Local and Vercel production builds passed. Production source maps uploaded to
  Sentry for release `18050b0d300323006bba5a758cf44f2222e90bd4`.
- Live security state matched the reviewed baseline: 1,240 grants, 86 tables
  and 225 policies. This release changed no grants, policies or tables.
- All six deployed function sources contain the reviewed safeguards. Vercel's
  source manifest matches the reviewed OTA API, OTA page, external-booking
  settings component and shared readiness module by content hash.
- Fourteen live response checks passed: unavailable OTA responses, retired
  backfill and unauthorised HMAC administration, missing/invalid signatures,
  signed and availability-only reads, and rejection of unsigned create/modify/
  cancel requests. The temporary credential and its test events were removed.
  These checks created no bookings, payments, refunds or customer notifications.
- All four production browser smoke tests passed: tenant tours, chat opening,
  admin login-page rendering and password-reset-page rendering. These did not
  exercise reset-email submission, password replacement or authenticated login.
  The subsequent production credential failure and its verification are recorded
  in [Password reset follow-up](PASSWORD_RESET_RELEASE_2026-09-14.md).
- At 04:11 UTC, the preceding ten minutes contained 14 scheduled HTTP responses,
  all HTTP 200 without timeouts. The changed functions had no matching runtime
  error logs since verification started at 04:07 UTC. Both OTA jobs were paused.

The initial local privacy-test failures matched the checkout's `/private/tmp`
path rather than leaked response content; fixture values were made specific and
the full suite rerun. Initial font-download and Chrome-launch failures were
sandbox restrictions; both checks passed with the required access restored.

## Rollback and remaining checks

The previous admin deployment can be restored with:

```sh
vercel rollback dpl_FFt9P954FjJXyuESkiNN1ijWpsfW --scope jerrys-projects-f4e4eaf9 --yes
```

Keep the edge guards and paused OTA jobs in place during an admin-only rollback.
The prior edge source is in commit `5967dc53bd49d6928285fdeb04b2e07f9b1468ff`;
redeploy a specific function from an isolated checkout only after reviewing the
credential/authentication protections that rollback would remove. Exact previous
function bundles and metadata are saved privately under
`/private/tmp/capekayak-all-fixes-83p9naab/edge-before/`. No schema down-migration
is needed. Resume the native OTA schedules only with a verified provider release.

Kayak remains in test mode. A fresh hosted payment through signed confirmation,
notifications and refund remains outside this deployment verification; see the
[Yoco follow-up](YOCO_PAYMENT_CLOSEOUT_2026-09-14.md). Native OTA connectivity
still requires partner access, implemented supplier contracts and certification.
