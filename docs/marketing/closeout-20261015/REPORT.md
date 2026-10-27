# Marketing safety closeout, 15 October 2026

**PARTIAL / BLOCKED. Not release ready. No production action or live activation performed.**

The user confirmed concurrent editing and instructed: **“Yes — pause shared-file edits.”** Shared source, workers, migrations and the original handover remain untouched. Engineering changes and a corrected handover were prepared in an isolated source copy at `/private/tmp/bookingtours-marketing-closeout-20261015/full-app`. They are delivered as [candidate.patch](candidate.patch), **not applied**. The only workspace additions from this closeout are this new evidence directory.

After continuation, the original temporary source, PostgreSQL and preview directories were no longer present, and the extra frozen-source build process could not be recovered. Its result is **unverified and not counted**. Earlier completed test/build logs, screenshots, hashes and the patch survive here. A fresh isolated source copy was reconstructed for the follow-up described in [resumed verification](resumed-verification/RESULTS.md); it does not recover the original surrounding source snapshot. No running local demo/database is claimed. The old temporary paths in commands are historical targets.

The patch passed `git apply --check` against the current working files. That is an applicability check, not integration approval or proof against later edits. [candidate-manifest.json](candidate-manifest.json) records the 24 candidate paths and baseline/candidate SHA-256 hashes. Reconcile ownership and recheck those hashes before integrating. Do not automatically apply it over concurrent work.

## Baseline and instructions

Branch: `feature/simple-view-2026-09-20`; HEAD `43304b65314c2b9974f939304e7b2ebae0a62c0c`. Latest commits included `43304b6` (phone/tablet spacing), `b152398` (Simple View layout limits), and earlier marketing changes including `615ec35` (shared tokens) and `f7ff1cf` (batch throughput). See [recent commits](recent-commits.txt), [starting status](status.txt), [starting diff summary](diff-stat.txt), and [baseline hashes](baseline-sha256.json).

The starting tree already contained 122 modified tracked files, extensive untracked marketing implementation, and concurrent usability, booking, OTA, settings, agent, dependency and documentation work. No reset, cleanup, overwrite, revert, commit, push, dependency installation or deployment was performed. No original candidate file changed between baseline capture and patch packaging; this does not override the user's edit pause. A later whole-baseline check detected changes in 20 other pre-existing paths during validation, including the operator-consistency migration. See [concurrent changes](concurrent-changes.json). These were not edited by this closeout. Original isolated results cover the original captured snapshot; follow-up results cover a new copy of current shared sources plus the candidate. Integration remains paused and requires validation after ownership reconciliation.

Read: root and parent `CLAUDE.md`, `.claude/CLAUDE.md`, `PRODUCT.md`, the complete implementation handover, marketing template prompt, relevant marketing/consent/tenant/cron/voucher migrations, workers, editor, gallery, previews and tests. No applicable `AGENTS.md`, `CONTEXT.md` or ADR directory was found in this repository/ancestor search. Used Ponytail for scoped engineering and Impeccable for UI/accessibility inspection. The product context loader found a substantive `PRODUCT.md` and no `DESIGN.md`; no visual redesign was attempted.

**Approval correction:** the old handover asserts owner approval for excluding every non-cancelled reservation, including unpaid reservations, from first-booking offers. No original approval artifact was found in supplied material, product decisions, repository documentation or relevant recent commits. That claim is **unverified**, not approval. The candidate keeps that path held. No approved collection notice exists. Imports, booking flags and stored addresses do not create permission evidence. The 24-hour frequency and 08:00–20:00 window are labelled synthetic fixtures, not approved defaults.

## Candidate changes

All paths below are candidate-only; see the patch for exact changes.

| Paths | Change |
|---|---|
| `supabase/migrations/20261015180000_marketing_closeout_hold.sql` | New candidate migration, after the existing 15 October prerequisites. Adds tenant-scoped RLS policy configuration, **no enabled rows or approvals**, configurable interval/window, named-zone requirement, final policy recheck, indefinite uncertain-acceptance quarantine across journey keys, first-booking approval hold, unsupported domain-event/offer holds and activation guard. Replaces the existing gate functions without leaving an alternate callable reserve implementation. |
| `supabase/security-baseline.json` | Adds expected new policy-table RLS/grants/policies. This is candidate metadata, not a hosted drift result. Full-schema drift validation remains unverified. |
| `marketing-dispatch`, `marketing-automation-dispatch` | Keep configurable/pending-policy work held; preserve enrollment state on unsupported domain/offer holds. |
| `broadcast`, `send-email`, `auto-messages` | Hold free-form broadcasts, manual marketing test/partnership email routes, WhatsApp review/reminder/re-engagement paths and expired-checkout rebooking nudges. Keep ordinary booking/payment/privacy/auth messages separate. Remove review/rebooking offers from transactional photo delivery. |
| `_shared/marketing-batch.ts` | Blank or duplicate provider IDs require reconciliation rather than successful accounting. |
| `_shared/marketing-outbox.ts`, `wa-webhook` | Old broadcasts and unclassified delayed free-form messages cannot drain merely because a customer replies. A cancellation follow-up must bind to the same tenant and an actually cancelled booking. Unclassified/admin delayed messages remain held; this limitation must be reviewed before integration. |
| `app/lib/marketing-journey.ts`, marketing layout/gallery/builder | Label policy proposals, unavailable recipe delivery and unavailable estimates; disable activation while keeping Pause; retain all ten recipes as drafts. Current edited-step explanations remain separate from illustrative gallery emails. No invented audience, overlap, delivery or revenue estimate. |
| Tests/preview configuration | New reduced-schema policy/concurrency and schema-attempt scripts, provider-response/outbox/legacy-route regressions, transactional photo assertions and fifth browser scenario. Preview uses separate ports 3186/3187 and its own pointer file. |
| `docs/marketing/IMPLEMENTATION_20261015.md` | Candidate correction distinguishes historical assertions, reproduced results, pending approval and release blockers. Original shared handover is not edited during the pause. |

The engine is **not completed** by these holds. Event contracts, atomic promotional offer issuance, actual edited-journey audience estimation and reconciliation tooling still require implementation and representative validation. The patch does not approve commercial terms, gift values, expiry policy, review completion, WhatsApp capability or production activation.

## Ten retained recipes and execution map

Common UI entry points: `/marketing` goals; `/marketing/automations` gallery; `/marketing/automations/[id]` editor; `/marketing/templates` campaign/manual paths. Installed data: `marketing_automations`, steps, templates, enrollments/logs. All automation sends converge on `marketing-automation-dispatch`, `reserve_marketing_delivery`, `confirm_marketing_delivery`, then Resend. Campaigns use `marketing_campaigns` → `marketing_queue` → `marketing-dispatch` → the same reserve/confirm gate → Resend batch.

Contact/tag enrollment originates from contact/tag triggers; inactivity enrollment uses `enroll_welcome_back_sequences`; annual date enrollment runs in the automation worker. `cron-tasks` derives behavioral tags from booking/status history. Tags are not necessarily authenticated, booking-bound completion events. No recipe is certified by this map.

| Recipe / trigger | Dependencies and intended stops | Existing re-entry/duplicate behavior and closeout limitation |
|---|---|---|
| Welcome Series / `contact_added` | Auditable permission; approved first-booking definition; current reservations; offer semantics. Stop on opt-out/suppression and the approved booking goal. | Unique contact/journey enrollment; no approved general manual re-entry policy. Old synthetic behavior excludes non-cancelled/unpaid/refunded reservations; approval absent. **Delivery unavailable**, including initial emails. Percentage voucher unsupported. |
| Post-Tour Review / `completed-tour` tag | Real completed booking, cancellation/payment state and operator review links. Stop promotional delivery on suppression. Review submission cannot be inferred from an open. | Contact/journey uniqueness means a repeat booking does not establish a fresh booking-bound review run. Two bounded emails in the draft; tag can be stale/out of order. **Unavailable** pending event binding. |
| Welcome-back / `booking_inactive` | Last paid-booking anchor, current bookings/upcoming departures, refunds and approved offers. Rebooking should stop. | Re-entry once per changed anchor; same anchor excluded. Existing status/history SQL is not proof against actual payment/refund identifiers. **Unavailable** pending event contract and atomic offers. |
| Birthday / `date_field` | Optional date provenance/retention/minor policy, named timezone, approved reward and expiry. | Annual local-calendar enrollment exists; historical enrollment reset is not a general event ledger. **Unavailable**; percentage-as-money vouchers denied. |
| Referral / `left-review` tag | Actual review-completion/qualification and commercial referral/reward rules. | Unique tag-based enrollment, not proof of a positive review or qualifying referral. **Unavailable**; no earned reward is inferred. |
| Voucher expiry / `voucher-expiring-30d` tag | Tenant/contact/voucher identity, actual expiry, balance, redemption/refund state. Stop on invalidity/redemption. | Relative 23/6-day waits do not prove expiry-day delivery; late tags drift. **Unavailable**, including historical saved paths. No expiry behavior invented. |
| VIP / `vip` tag | Verified repeat paid/completed bookings; approved benefits and reward. | Daily derived tag plus contact/journey uniqueness; cancellation/refund correction and reward re-entry not proven. **Unavailable**; percentage vouchers unsupported. |
| Seasonal launch / `manual` | Actual launch content/availability and approved commercial terms. | Existing manual enrollment can reset completed/exited enrollment; overlapping reward/re-entry policy not approved. Whole recipe **unavailable** because it contains unsupported percentage-voucher issuance. |
| Anniversary / `anniversary-1yr` tag | Actual booking/departure anniversary and approved reward. | No trustworthy source/re-entry contract was demonstrated. **Unavailable**; percentage voucher unsupported. |
| Photo share / `photos-ready` tag | Booking-bound gallery readiness and recipient access; social/rebooking content is promotional. | No reliable tag-to-gallery/booking completion signal demonstrated; unique contact/journey enrollment is insufficient. **Recipe unavailable**. Separate transactional photo delivery remains, without review/rebooking offers. |

For every row, permission and suppression must be current at handoff. Late/duplicate/reordered business events are **not** generally implemented as a reliable state machine. Suppression is monotonic in the existing ledger; provider callback replay is deduplicated in the reduced test. Required event ordering, correction, cancellation, payment, completion and re-entry acceptance remains blocked by the complete-schema/event work. Do not activate a held path on the strength of its descriptive contract.

## Isolated environment and exact blockers

Created a fresh PostgreSQL 17 cluster at `/private/tmp/capekayak-db-test-MktCloseout/data`, port 55439, Unix socket only. Verified `SHOW data_directory` equals that path and `SHOW listen_addresses` is empty **before candidate application**. No hosted connection URL, `.env` file, provider credential, real contact, payment request or application-data import was used.

The complete application schema cannot be reconstructed from the checked-in migration ledger: `20260302113000_remote.sql` contains only `;`.

| Attempt | Actual result |
|---|---|
| Clean installation, chronological ledger | **FAILED/BLOCKED:** after one migration, `20260302121500_landing_hosting_lifecycle.sql`, SQLSTATE `42P01`: `public.landing_page_orders` does not exist. |
| Upgrade from checked-in September rollout fixture | **FAILED/BLOCKED:** after 22 later migrations, `20260913100000_platform_admin_controls.sql`, SQLSTATE `42P01`: `public.platform_invoices` does not exist. The fixture is itself reduced, not a complete prior schema. |
| Original marketing SQL acceptance script | **PASSED its reduced assertions.** It creates simplified tables and stub auth/history helpers; this is not representative installation or integration proof. |
| Candidate SQL tests | **PASSED limited assertions** in a new synthetic database, including two actual worker sessions. These reuse that reduced schema and are explicitly not complete-schema validation. |

See [schema attempts](schema-attempts.log), [baseline SQL](baseline-db.log), [candidate SQL](candidate-db-final.log). Required next input is a reproducible, schema-only complete application baseline and the corresponding prior migration state, with infrastructure prerequisites. Do not fetch a production dump or add fabricated schema without separate authorization.

Admin and booking source copies were built in production mode under `/usr/bin/sandbox-exec` with `(deny network*)`, sanitized environments and synthetic localhost Supabase configuration. A provider-origin fetch probe failed before connection. Initial unmodified font fetching failed, as expected. Local Next font test responses then allowed complete admin/booking compilation and prerendering, **95 admin and 28 booking static pages**. Font appearance, live authentication and provider behavior are not certified by these builds. Sentry had no credentials; network denial also covered telemetry/upload attempts. Sandbox/listener/browser permission failures were rerun only for disposable local execution.

## Commands and reproduced outcomes

Commands below used `/Users/gideonlangenhoven/dev/capekayak` for baseline inspection/tests, and `/private/tmp/bookingtours-marketing-closeout-20261015/full-app` for candidate tests. No production environment was loaded.

```sh
git status --short
git branch --show-current
git log -8 --oneline
git diff --stat
git diff --cached --stat

# Baseline: 12 files / 170 tests passed
npx vitest run tests/unit/marketing*.test.ts tests/unit/automation-copy.test.ts tests/unit/message-job-boundaries.test.ts tests/unit/campaign-audience.test.ts

/opt/homebrew/opt/postgresql@17/bin/initdb -D /private/tmp/capekayak-db-test-MktCloseout/data -A trust --no-locale
/opt/homebrew/opt/postgresql@17/bin/pg_ctl -D /private/tmp/capekayak-db-test-MktCloseout/data -l /private/tmp/capekayak-db-test-MktCloseout/postgres.log -o '-k /private/tmp/capekayak-db-test-MktCloseout -p 55439 -h ""' start
node tests/marketing-safety-local.mjs /private/tmp/capekayak-db-test-MktCloseout 55439

# Candidate-only schema attempts; script records BLOCKED rather than hiding errors
node --experimental-strip-types tests/marketing-schema-closeout.ts /private/tmp/capekayak-db-test-MktCloseout 55439
# Candidate-only reduced policy/concurrency/rollback assertions
node --experimental-strip-types tests/marketing-safety-local.mjs /private/tmp/capekayak-db-test-MktCloseout 55439

# Final candidate: 140 files passed, 2 skipped; 2,316 tests passed, 58 skipped
npx vitest run
# Focused candidate before last outbox addition: 13 files / 179 tests passed
npx vitest run tests/unit/marketing*.test.ts tests/unit/automation-copy.test.ts tests/unit/message-job-boundaries.test.ts tests/unit/campaign-audience.test.ts
npx tsc --noEmit --incremental false
npx eslint app/lib/marketing-journey.ts app/marketing/layout.tsx app/marketing/automations/page.tsx 'app/marketing/automations/[id]/page.tsx' tests/unit/marketing-closeout.test.ts
deno check --deny-import --config supabase/functions/deno.json --node-modules-dir=none supabase/functions/marketing-dispatch/index.ts supabase/functions/marketing-automation-dispatch/index.ts supabase/functions/send-email/index.ts supabase/functions/auto-messages/index.ts supabase/functions/broadcast/index.ts supabase/functions/wa-webhook/index.ts

# Local isolated preview only: separate ports, mocks, no application writes
node tests/helpers/marketing-preview.mjs
npx playwright test --config playwright.marketing-safety.config.ts

# In original workspace: applicability only, no patch application
git apply --check docs/marketing/closeout-20261015/candidate.patch
git diff --check
```

The original executed commands inside the network boundary were `npm run build` for admin and `npm run build -- --webpack` for booking. Both completed earlier and exited 0; [admin log](admin-build-final.log), [booking log](booking-build-final.log). A subsequent frozen-source rerun has no recoverable result after continuation. The original temporary source/database/preview directories were absent when this follow-up began; the historical logs do not establish the outcome of that interrupted attempt.

The [reconstruction helper](prepare-candidate.py) now copies the current Admin and booking sources without environment files into a fresh temporary directory, applies the patch there, and verifies every candidate hash. It requires all 24 shared candidate-path baselines to match before copying; it never applies the patch to shared source. The [build runner](reproduce-builds.py) and [font fixture](font-responses.cjs) now accept that isolated source location instead of depending on the lost path. Existing installed dependencies are reused; no installation or shared package/configuration change is required.

```sh
# Prints the newly created candidate directory. Use that exact path below.
python3 docs/marketing/closeout-20261015/prepare-candidate.py
python3 docs/marketing/closeout-20261015/reproduce-builds.py CANDIDATE_DIRECTORY LOG_DIRECTORY
```

Reconstruction captures current concurrent work outside the 24 patched paths, so its results must be reported separately from the original captured snapshot. The resumed [source inventory](resumed-verification/source-snapshot.json) identifies the copied source; [shared drift](resumed-verification/shared-drift.json) preserves the 20 changed baseline paths. Those changes were not made by this closeout. See [resumed verification](resumed-verification/RESULTS.md) for the final repeat-build outcome.

TypeScript and Deno exited 0. Focused ESLint exited 0 with **two existing hook-dependency warnings**; this is not a whole-repository lint pass. [Full unit log](candidate-full-unit-final.log), [type log](candidate-types-final.log), [Deno log](candidate-deno-final.log), [lint log](candidate-lint.log).

Browser: **5 passed**, localhost mocks, 390px/mobile layout, keyboard focus/selection, unavailable/error states, unsaved draft preservation, all ten recipes retained, disabled activation and no fixture writes/provider calls. [Browser log](candidate-browser.log), [screenshots](screenshots/review-mobile.png), [ARIA snapshot](screenshots/guided-accessibility.txt). Initial browser failures were sandbox launch/connect restrictions, cold route-compilation timeout, and an ambiguous new test selector. Authorized local rerun, warmed routes and an exact accessible-name selector resolved them. These checks use a simplified synthetic shell; **no manual VoiceOver/NVDA session or comprehensive WCAG assessment was performed**. Accessible-tree snapshots are not screen-reader acceptance.

## Delivery outcomes, recovery and transactional continuity

The candidate's state meanings are conservative:

- **Retryable pre-dispatch hold:** missing policy approval, pause, frequency/window hold. Campaign remains pending with backoff; a later run rechecks everything. Enrollment holds do not imply successful delivery.
- **Terminal/suppressed:** unknown permission, opt-out, bad binding, unsupported recipe or an explicit provider rejection. The same delivery key is not retried. SQL currently records definitely unattempted final rejection as `failed`; the reason must be read with queue/log context, not interpreted as a bounce.
- **Reserved:** `status=sending`, `provider_started_at IS NULL`. The final check must pass before provider start. A proven pre-provider rejection releases frequency accounting but retains the durable identity; any explicit recovery needs a distinct reviewed identity.
- **Uncertain:** `reconcile`, or `sending` with a provider-start timestamp and no known outcome. Quarantined indefinitely, even beyond Resend's idempotency retention and across new journey keys. No blind retry. Provider IDs/events can support investigation, but automatic successful-event reconciliation and operator recovery tooling are still incomplete.
- **Sent:** requires an actual nonblank provider identity; this is provider acceptance, not guaranteed inbox delivery. Durable outcome/queue aggregates and billing are not one transaction with the provider. Accounting/reconciliation around a crash is not fully solved.

Two actual PostgreSQL sessions proved one reservation for overlapping keys and stable-key replay. Deterministic reserve → opt-out/pause → confirm schedules proved handoff refusal and unattempted-slot recovery. The original reduced fixture exercised suppression/reimport, unpaid/reservation/refund exclusions, callback and unsubscribe replay, draft rollback and ordinary-role evidence RLS. This is not simultaneous opt-out/booking versus real provider acceptance, nor full-schema RLS assurance. A database check cannot recall an already handed-off email; the dispatch linearization and post-check race contract still need representative acceptance.

**Rollback release gate failed:** restoring the original reserve function inside a local transaction permitted reservation despite the candidate policy pause. The probe then rolled back and the pause held again. Do not roll back to ungated workers/functions. Retain gates plus permission/suppression/delivery/revision evidence with queued work. UI rollback can be separate. Transactional booking/update/payment/auth/photo handler positives passed while legacy promotions were held, but concurrent complete-schema pause/resume/rollback continuity has not been demonstrated.

Transactional purchased/credit vouchers were source-inspected, not proven under complete-schema concurrent issuance, retry, cancellation and partial/full refund. In particular, gift-voucher activation is read/update logic whose safety also depends on payment idempotency and accounting functions. No financial workflow was changed to manufacture a passing result. Promotional issuance remains unavailable even if a historical offer-limit row exists.

## Provider readiness and attribution

Only source and public provider documentation were inspected. No account/API/DNS lookup, credential access, quota read, provider configuration or live test was performed. Comments saying a sender is verified are not evidence of its current authentication state.

[Resend idempotency documentation](https://resend.com/docs/dashboard/emails/idempotency-keys) documents both send endpoints and 24-hour key retention. [Webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests) requires signature verification over the raw payload. [Domain documentation](https://resend.com/docs/dashboard/domains/introduction) describes SPF/DKIM and recommends DMARC. This does not establish actual tenant/platform sender readiness. Invalid-signature rejection was reproduced offline; actual webhook delivery, missing/unmatched provider IDs and provider reconciliation remain unverified. Current suppression callback behavior after a contact-address change and full reordered-event handling need additional validation.

Cron SQL includes authenticated service-key headers, and worker handlers use authentication checks; hosted schedules/secrets and execution history were not inspected. Quota, sender reputation, suppression/bounce configuration and supported provider capabilities remain unverified.

Actual trace: tracking links bind contact/queue/enrollment relationships to a tenant, then record opens/clicks and counters. They do **not** carry a demonstrated reliable link to booking IDs, payment IDs and refund/cancellation accounting. No model/window/currency/net-revenue rules were approved. Attribution and revenue therefore remain **unavailable**; clicks are not paid bookings. Duplicate revenue, partial/full refunds and cross-tenant attribution have not been tested against the full schema.

## Release gates

“Passed” below applies only to its stated scope. No limited pass substitutes for a required full-system gate.

| Gate | Status | Evidence / remaining work |
|---|---|---|
| Concurrent work protection | **PASSED** | No shared source edit; baseline hashes and unapplied patch. Integration remains paused. |
| All ten recipes retained and explicitly held | **PASSED, candidate UI** | Fifth browser check, catalog map, candidate SQL holds. Does not certify executable event behavior. |
| No approved-default policy activation | **PASSED, candidate/reduced SQL** | Empty policy table, default disabled, explicit synthetic values; original approval absent. |
| Permission/suppression safety | **UNVERIFIED, full system** | Limited SQL/unit checks pass; approved intake notice/process and full-schema event/RLS acceptance missing. |
| Complete-schema isolated environment | **FAILED** | Exact clean/upgrade missing-relation blockers above. |
| Clean installation and relevant prior upgrade | **FAILED** | Both attempts blocked. No production migration applied. |
| Admin and booking production compilation | **PASSED, reconstructed synthetic snapshot** | Both repeat builds exited 0, including TypeScript and page generation, with network denied and local font mocks. All 24 candidate hashes match; surrounding current sources differ from the original snapshot. See resumed verification. No live-provider/auth claim. |
| Outbound boundary in validation | **PASSED, stated tests/builds** | OS network denial for builds; offline provider dependencies; localhost page routing. |
| Shared gate across every actual promotional path | **UNVERIFIED** | Additional legacy holes held in candidate; arbitrary manual/mixed-purpose paths and full routing inventory still need acceptance. |
| Overlap/idempotency/crash/frequency | **PASSED, reduced checks; UNVERIFIED full system** | Two real sessions and indefinite uncertainty holds; operational reconciliation missing. |
| Opt-out/send and booking/send races | **UNVERIFIED** | Limited interleavings/eligibility pass; full-schema concurrent dispatch/event acceptance absent. |
| Duplicate/reordered webhooks and reconciliation | **UNVERIFIED** | Receipt dedupe and invalid signature negatives pass; ordering/recovery and unmatched IDs incomplete. |
| Tenant isolation/RLS with ordinary roles | **UNVERIFIED, complete schema** | Reduced evidence/policy RLS checks pass; real auth/membership and all paths not reproduced. |
| Domain events, exits and re-entry | **FAILED / held** | Missing authenticated booking-bound event contracts; unsupported paths inactive in candidate. |
| Actual edited-journey audience/timing/volume preview | **FAILED / unavailable** | Honest unavailable state replaces unsupported assurance; full estimator not implemented. |
| Named timezone/DST | **UNVERIFIED, end to end** | Calendar/DST units and invalid-zone holds pass; scheduling conversion and DST send-window acceptance missing. |
| Transactional continuity | **UNVERIFIED, full system** | Mocked booking/update/payment/auth/photo positives pass; full-schema concurrent pause/resume/rollback missing. |
| Atomic transactional voucher issuance/refunds | **UNVERIFIED** | Source inspection only; representative financial-state/concurrency tests blocked. |
| Unsupported offer/WhatsApp/expiry holds | **PASSED, candidate limited checks** | No offer approval applied; no WhatsApp promotional capability claimed. Unclassified delayed admin messages also held. |
| Provider/sender/domain/webhook/cron/quota readiness | **UNVERIFIED** | No account or hosted-state authorization/evidence. |
| Booking/payment/refund attribution | **FAILED / unavailable** | Reliable linkage/model not established; no attributed revenue reported. |
| Mobile/keyboard/disabled-state behavior | **PASSED, synthetic shell only** | Five browser scenarios; visual inspection. Full authenticated/mobile screen coverage remains unverified. |
| Manual screen-reader acceptance | **UNVERIFIED** | No actual screen-reader session; ARIA snapshot is insufficient. |
| Engine rollback with queued work | **FAILED** | Prior reserve implementation bypasses pause. Keep new gate/evidence on rollback. |
| Business approvals and release activation | **FAILED / pending** | Notice, first-booking rule, frequency/window, commercial/expiry terms and other required decisions absent. |

External work requires its own authorization: an explicitly isolated full-schema staging environment; read-only provider/account/DNS/cron evidence; any webhook/domain/secret configuration; any specific harmless live recipient test. Production deployment/migration, payments, live sends, real imports and activation remain outside this task. No broader account access was requested.

Before integration, reconcile ownership and the concurrent changes (including migration prerequisites), obtain the missing schema baseline, repair the failed gates, and reproduce the candidate on that complete isolated environment. Do not interpret the passing unit/build/mock checks as release readiness.
