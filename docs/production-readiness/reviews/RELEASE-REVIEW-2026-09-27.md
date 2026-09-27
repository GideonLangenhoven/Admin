# Three-application release review — 27 September 2026

**Historical source review.** The current candidate, CI result and still-open release gates are in [STATE.md](../STATE.md) and [CLOSEOUT_PACKET.json](../CLOSEOUT_PACKET.json). The published pairing below is retained as the earlier review record.

**Verdict: not production ready.** This review reconstructs an exact, locally passing Admin/storefront/onboarding source pairing. It does not qualify production deployment or the customer-facing release.

## Corrected findings from the prior review

- The cited `9fd5f74` Admin assembly was superseded by `b35f841`, which already corrected the literal web-chat assertion and added the forward `check_ins_admin` policy migration. The earlier ten-failure assembly result is historical.
- Both former companion CI pins (`86588bcb…`, `b93f053b…`) still return GitHub “No commit found.” Surviving repositories have different file layouts. Seven failures were stale storefront file paths/assertions, plus one additional chat helper path found in the full run. The corrected tests execute the actual booking page and chat widget. No missing-file assertion was counted as a product pass.
- A tracked absolute `booking` symlink in the Admin candidate collided with CI's checkout path; it is removed from Git and ignored locally. The actual storefront image proxy also accepted unsafe upstream bytes on decode failure. It now requires HTTPS and an allowed host/raster type, caps bytes and pixels, and only returns re-encoded output.
- Comparison with deployed-source branch `7be561b` found the candidate retained the newer refund journal and all other compared mobile/arrival files, but lost the app shell's phone-nav clearance. The bottom padding is restored and asserted.
- The disposable PostgreSQL suite initially failed because its schema omitted the July marketing trigger that a September migration alters. Loading that real July migration fixes fixture fidelity. A new assertion checks the check-in policy's initplan shape and tenant visibility.

## Exact review pairing and local checks

| Application | Published review commit | Local result |
| --- | --- | --- |
| Admin | `f11079cb610bb89fa0bbdce88e452079f26949c1` on `codex/release-candidate-corrections-2026-09-27` | 1,513 unit tests passed, one conditional skip; TypeScript, lint (warnings only), Webpack production build, 55 frozen Edge checks/bundles and Edge-resolution negatives pass. PostgreSQL 17 suite passes 230 checks. Full and production dependency audits report zero vulnerabilities. |
| Storefront | `c09bba1d079c3786b3e1870447936185d0119d06` | Clean `npm ci`, zero audit findings, TypeScript, lint (20 warnings), ways check, Admin's executable checkout/chat/image/mobile contracts, and Webpack production build pass on Node 22.23.3. |
| Onboarding | `293d4e4a6426f9e1ccd1205e6a9b40d012a3e4eb` | Clean `npm ci`, zero audit findings, TypeScript, lint (one warning), three client transport contracts, and Webpack production build pass on Node 22.23.3. |

Admin CI checks out the two published companion SHAs above. Its obsolete command for a nonexistent storefront test file is removed; the executable Admin suite covers the surviving booking contracts. Manual source-validation runs now leave deployed-site browser smoke checks opt-in. [Hosted Actions run 36297622614](https://github.com/GideonLangenhoven/Admin/actions/runs/36297622614) passed both source jobs on exact Admin commit `f11079c`; the deployed smoke job was deliberately skipped. This evidence update changes only readiness documents. The unrecovered accepted commits cannot be compared for full behavior equivalence; that review remains open.

## Live state and remaining gates

Read-only Vercel inspection on 27 September found Admin alias `admin.bookingtours.co.za` on Ready production deployment `dpl_9ewxmGGuE7HWauQNS45V1vrunNoq`. The booking alias had moved to Ready production deployment `dpl_34PsBxRGMGY4MQz9XcFmKD3U6krn` earlier that day; its Git source was not established by this inspection. The review branches above were not promoted. The linked Supabase migration ledger ends at `20260922123000`; six subsequent candidate migrations are not applied. The Vercel environment-list command did not return a usable inventory, so current Redis and trusted recovery-origin configuration is unverified; the 25 September missing-setting observation remains historical evidence only.

Before promotion: review and apply the six migrations in order with rollback/reconciliation evidence; verify shared Redis and trusted recovery origin in the effective deployment; and complete the unchanged provider, BT500 capacity, alert delivery, isolated restore, 24-hour soak and canary gates. The previous deployed BT500 smoke failed, so source/build success cannot close that capacity gate. No production database write, provider transaction, customer message, or production promotion was performed in this review.
