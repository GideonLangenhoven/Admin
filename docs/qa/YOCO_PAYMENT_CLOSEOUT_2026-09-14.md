# Kayak Yoco payment verification — 14 September 2026

The payment safeguards are live. The payment-repair session ended before their
deployment, but the later 13 September platform release included them. This
continuation verified production directly; no additional deployment or payment
record changes were needed.

## Original failure and repair

Kayak's Yoco test key and webhook secret had been saved in the live credential
fields. Checkout records were labelled live while Yoco produced test payments,
which the webhook could not confirm with the missing test signing secret.

The previous repair moved those credentials into the test fields, enabled test
mode and confirmed two payments using completed checkouts independently read
from Yoco's authenticated API. On 14 September both were rechecked:

| Booking reference prefix | Amount | Database state | Original return-link confirmation |
|---|---|---|---|
| `C362B599` | R610 | PAID / CAPTURED, test mode | `payment_confirmed: true` |
| `81DBDEFA` | R1,810 | PAID / CAPTURED, test mode | `payment_confirmed: true` |

Yoco still reports both checkouts completed with the matching amounts and
payment identifiers. Kayak has a test key and test webhook secret; its live
credential fields are empty. No credentials or private confirmation tokens are
included in this record.

## Deployment evidence

- Admin production deployment `dpl_FFt9P954FjJXyuESkiNN1ijWpsfW` is Ready and serves
  `https://admin.bookingtours.co.za`. It was created on 13 September at 09:10 UTC
  from release commit `5967dc53bd49d6928285fdeb04b2e07f9b1468ff`.
- Its uploaded `app/api/credentials/route.ts` has content SHA-1
  `c13005917b56a013db51769e83646f26c04af9c0`, matching the local file exactly.
  That handler rejects test keys in live settings and live keys in test settings.
- Deployed `create-checkout` version 98 includes the shared credential checks
  that reject keys saved in the wrong mode and require a webhook secret. It also
  checks the webhook secret for the persisted checkout's own mode before calling Yoco.
- Deployed `onboarding-wizard` version 5 rejects a test key during live onboarding
  before registering a webhook or saving credentials.
- Deployed `yoco-webhook` version 125 includes the guarded shared credential
  loader. These three function versions were updated on 13 September at 08:46 UTC;
  their deployed source was read again on 14 September.
- The five focused payment suites passed again: **113 tests**, covering credential
  mode selection, checkout access, confirmation, accounting and idempotency.

## Remaining journey verification

The existing payment records and original confirmation links now agree. This
continuation did not create a new checkout, send messages or run a refund. A
fresh hosted test payment still needs to demonstrate automatic signed-webhook
confirmation and notification delivery after the configuration repair; a
completed test refund remains a separate check.

Kayak remains in test mode. Use the [release smoke runbook](MVP_SMOKE_RUNBOOK.md)
for those checks and configure its own live merchant credentials before taking
real customer payments. The broader release status remains in the
[Super Admin closeout](SUPER_ADMIN_CLOSEOUT_2026-09-13.md).
