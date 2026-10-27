# Operator usability — local implementation and release gates

Owner: Gideon Langenhoven. Evidence date: 15 October 2026. Repository: `/Users/gideonlangenhoven/dev/capekayak`, branch `feature/simple-view-2026-09-20`.

**Local candidate, not a production-readiness certificate. Nothing was deployed.**

Three candidate migrations have only been applied to disposable local PostgreSQL databases. No real guest records, messages, payments, vouchers, prices, inventory or marketing activation were used. The protected inactive marketing draft `5bb1d74b-8634-4fec-9c42-f6f13cc1c33f` was not touched.

The weather disruption preview was removed at the owner’s request on 15 October 2026, including its page, API, departure link, fixture and dedicated tests. Verification counts below describe the original implementation run before that removal.

The working tree contained extensive existing changes, including marketing, help, reports, checkout, integrations and agent work. Those were retained. The whole working-tree diff is **not** this task's change list. No commit, reset, clean, push or deployment was performed.

## Confirmed owner decisions

- Simple View remains optional for the pilot; current landing-page behavior remains in place.
- A walk-in can be confirmed with money still due. Confirmation, receipt of money, a capacity hold and arrival remain separate facts.
- Unpaid arrival is allowed only with explicit approval of an account/reseller arrangement. ADMIN, MAIN_ADMIN and SUPER_ADMIN may approve; OPERATOR may use a valid approval but cannot grant one. A reference and reason are required. A signed booking waiver remains mandatory.
- Earlier marketing decisions remain separate: any non-cancelled reservation, including unpaid, disqualifies a first-booking offer; no approved collection notice/version was supplied. This operator task does not establish marketing permission or certify the marketing release.

## Evidence inventory and verified observations

References below are relative to the repository. Line numbers identify the current candidate; they can move with later edits.

| Area | Code / data / enforcement evidence | Finding and classification |
|---|---|---|
| Full dashboard | `app/page.tsx:408`, `:486`; `app/lib/operator-day.ts:4`; migration `20261015170000_operator_daily_consistency.sql`, `get_operator_dashboard` | Existing dashboard retained. Browser-local midnight and time-based grouping were verified in the prior implementation. Now uses operator-local days and exact slot identity. Presentation/query-definition corrections, locally tested. |
| Simple Today, calendar, arrivals | `app/simple/page.tsx`; `app/simple/calendar/page.tsx`; `app/simple/check-ins/page.tsx`; `app/simple/simple-data.ts:48`; `app/simple/use-simple-day.ts:9` | Existing routes and roll call retained. Shared manifest replaces divergent status filters. Freshness, unavailable/empty states and response-order guards added. Implemented/tested locally. |
| Canonical manifest | `20261015170000_operator_daily_consistency.sql`, `operator_departure_manifest`; existing `slots`, `tours`, `bookings`, `booking_add_ons` | Tenant admission plus exact business/slot/tour joins. Shared by full, Simple and guide. Active holds included, cancelled/expired excluded. SQL and browser fixture reconciles IDs and totals. |
| Thursday/Friday same-name observation | `tests/fixtures/operator-day.json`; `tests/operator-usability-local.mjs`; `tests/e2e/operator-usability-mocked.spec.ts` | Two same-named parties, a rescheduled record and simultaneous activities reconcile by ID in synthetic data. The exact historical live records were not inspected; the live discrepancy's cause remains observed-only. |
| Arrival policy and audit | Existing `20260920100000_partial_booking_arrivals.sql:88`, `:227`; existing authenticated arrival wrapper; candidate `20261015170000...`, `sync_booking_arrival_state`, `record_booking_arrival`, `approve_account_arrival` | Original server already required SIGNED waiver: visible full/Simple difference was not proof of a server bypass. Now payment readiness is consistent too. Existing locks, stale-write checks, replay IDs, partial arrivals and audit are preserved. |
| Approval authorization | Candidate `booking_arrival_approvals` table/RLS/immutable trigger; `components/booking/ArrivalApproval.tsx:6` | Tenant-scoped history, no direct client insert/update/delete; actor role/read-only/suspension/subscription checks in RPC. Moving away and back invalidates approval via a version counter. Admin explicitly confirms arrangement; `allow_unpaid` alone grants no exception. |
| Waiver and resolution | `app/bookings/[id]/page.tsx:275`, `:372`; `supabase/functions/_shared/waiver.ts`; `app/lib/simple-view.ts:70` | Existing booking-level signature/token/configured URL reused. Exact booking anchor, focus and safe return context added. Missing configuration is honest. Participant/legal sufficiency remains a product/legal decision, not established by a UI test. |
| Walk-in form | `app/new-booking/page.tsx:337`, `:513`, `:865`, `:1131`, `:1314`; `/simple/new-booking` reuses it | Existing form retained as a progressive page. Explicit review/create/receipt; native accessible controls; supported payment actions; optional advanced price/promo settings. Fixes lost preselected slot caused by a deferred state updater. |
| Booking transaction | `20261015171000_operator_booking_transaction.sql:105`, `create_operator_booking`; existing `account_manual_booking`, `create_hold_with_capacity_check`, promo validation/use and invoice sequence | Previous browser performed separate writes and cleanup. New authenticated atomic RPC validates tenant, role, price, questions and capacity, then creates booking/extras/promo/invoice/receipt together. Retries share a durable request ID. Tests prove rollback on injected invoice failure and concurrency protection. |
| Safety questions / child counts | `components/booking/BookingQuestions.tsx`; existing `supabase/functions/_shared/booking-custom-fields.ts`; candidate `operator_booking_fields`, `operator_question_answer` | Reuses current question model: activity scope, enabled fields, text/number/date/choices, booking/participant scope, definitions/history. Server validates configuration and every guest's required answers. Adult/child counts stored without inventing age, names or DOB. |
| Reviewed manual price | Candidate `20261015171000...`, replacement `prepare_booking_checkout` | Existing checkout would remove an upward manual adjustment. Verified operator receipt now preserves reviewed adjustment through checkout; explicit extras/promo changes require price review. Existing voucher/hold processing retained. Actual provider payment not tested. |
| Cancellation amounts | `20261015172000_operator_cancellation_money.sql`; prior `20260911150000_booking_cancellation.sql:15` | Verified CONFIRMED with zero capture could be treated as refundable total. Candidate corrects that cash fallback while preserving capacity/hold, late-choice, voucher and service-only behavior. Synthetic unpaid/partial/refunded/legacy-paid/adjusted-price cases pass. No refund executes in tests. |
| Money display/email | Existing `app/lib/report-accounting.ts:29`, `:53`; `supabase/functions/send-email/index.ts:832`; tests `message-job-boundaries.test.ts` | Reuses received/outstanding helpers. Confirmation/invoice with booking ID reads tenant-filtered canonical amounts; missing payment state blocks before provider. Copy now separates total, received and due. Mock handler tests cover unpaid/partial/paid/unavailable. |
| Availability/date UI | `components/AvailabilityCalendar.tsx:74`; `app/lib/simple-view.ts:21`; `components/AppShell.tsx` | Uses date-specific IANA boundaries instead of today's offset for other dates. Calendar failures cannot become available zeroes. Header/day labels use operator timezone. Midnight and NY DST tested. |
| Booking search/detail | Existing `app/bookings/page.tsx`, `app/bookings/[id]/page.tsx`; `app/simple/bookings/page.tsx` | Simple reuses full existing search, not a duplicate engine. Detail separates received/due/status; exact waiver/payment links preserve date/slot and numeric scroll position. Existing amendment/refund/external actions retained, not certified by these previews. |
| Weather cancellation | Existing `supabase/functions/weather-cancel/index.ts:86`; `app/bookings/page.tsx:1167` | Existing bulk tool retained. External partial-success/reconciliation remains unverified. |
| Navigation/help | `components/SimpleViewShell.tsx:41`; `/simple/help`; existing `components/AuthGate.tsx:544`, `components/HelpChat.tsx`, `docs/admin-help` | Today/Bookings/Help and full-dashboard escape; existing sign-in preference/default unchanged. Existing help/setup reused. No new live practice-mode badge or promised support hours. |
| Inbox/notifications | `app/inbox/page.tsx`; `app/inbox/components/BotStatusBanner.tsx`; `components/inbox/PhoneAlerts.tsx` | Plain labels, keyboard conversation buttons and browser/device instructions. Existing inbox machinery retained. Real push permissions/device delivery not tested. |
| Stack and deployment | `package.json`; `next.config.ts`; `supabase/config.toml`; migrations and `supabase/functions` | Next 16.3.8 / React 19; Supabase/PostgreSQL 17; Deno edge functions; Vercel configuration already exists. No replacement infrastructure, paid dependency or credentials added. |
| Tenant/role boundary | Existing `app/lib/api-auth.ts:31`, `components/AuthGate.tsx`; candidate SQL `current_business_ids`, explicit actor checks and RLS | UI visibility supplements server enforcement. New cross-tenant create/manifest/approval attempts fail locally. Exhaustive hosted RLS/auth testing still required. |
| Providers, webhook/jobs | Existing `create-checkout`, `yoco-webhook`, `manual-mark-paid`, `send-email`, `auto-messages`, `weather-cancel`, `cron-tasks`; guide offline queue | Existing payment/email/WhatsApp adapters and jobs retained. No credentials loaded or live delivery performed. The guide retains its prior queue semantics; no new general offline guarantee. |

## Canonical definitions for this candidate

- **Booked people**: sum of booking `qty` on exact departure IDs in the selected operator-local day. Includes PAID/CONFIRMED/COMPLETED and current HELD/PENDING/PENDING PAYMENT, excluding expired payment deadlines unless the existing `allow_unpaid` policy applies. This includes temporary reservations; it is not cash revenue or a unique-contact count.
- **Capacity used / available**: existing shared slot availability service and locked capacity functions remain authoritative. `slots.booked` and `slots.held` are ledger counters; available places use the existing capacity/resource rules. Cancelled bookings release their claims. Expiry is executed by the existing worker, with its cleanup/grace timing; a deadline can precede worker cleanup. Do not calculate a new independent capacity rule from contact counts.
- **Confirmed**: places committed without proof that money was received. **Held**: temporary capacity reservation until the server deadline. Supported manual holds are 2/6/12/24 hours, subject to existing departure cutoff and server limits. No unsupported 48-hour option.
- **Received / paid / due**: use existing captured totals and received/outstanding helpers. Historical PAID/COMPLETED rows retain the established total fallback; CONFIRMED does not. Refund-request amount is not a completed refund. No currency conversion added; current manual-booking currency assumptions are ZAR and require a separate audit before multi-currency expansion.
- **Participants vs contact**: qty is guests, not payer records. Adult/child composition for new bookings is explicit; historical composition stays null. No age/DOB inferred. Each configured participant question requires its own answer.
- **Arrived**: recorded count between zero and qty. A reduction/correction is distinct from a new arrival. Increasing arrivals requires active confirmed/paid/completed status, payment readiness or current explicit account approval, and SIGNED waiver. Staff cannot turn a screen preference into an override.
- **Waiver complete**: current product stores a booking-level SIGNED record. This does not prove that every participant, child or guardian requirement is satisfied. Staff see this limitation and can inspect the actual record.
- **Dates**: timestamps remain `timestamptz`/UTC instants; local day membership uses the business IANA timezone, half-open `[start,end)` boundaries. Date-only labels are formatted without browser-zone shifting. Tests cover Johannesburg midnight and New York 23/25-hour days. Invalid/unavailable settings are not silently replaced with booking/payment success.

The schema fixture already rejects a null base price via NOT NULL. The added unavailable-price UI/server guard is defensive against incomplete/invalid price responses; it is not evidence that a null-priced booking existed in production. The SQL test retains that constraint and additionally rejects a negative price without writes, while accepting an explicit zero.

## Scope of changes

Presentation/query changes: full daily dashboard; Simple Today/calendar/check-ins; booking detail return links and money/waiver context; shared availability calendar; guide eligibility; native walk-in controls/review/receipt; inbox wording; Simple Bookings/Help; explicit freshness/error states.

Server/schema changes: three additive candidate migrations; canonical manifest/dashboard SQL; append-only account approvals; atomic manual-booking RPC/receipts and question validation; reviewed manual quote preservation; confirmed-unpaid cancellation cash correction; canonical confirmation/invoice amount enrichment. Existing adapters, payment/capacity functions, recipe library, billing, guest self-service, slots/bulk tools and refund execution paths were retained. The cancellation/checkout replacements preserve the original routine bodies around the scoped corrections and require full-schema rehearsal before release.

Additional local files: `app/lib/operator-day.ts`, `operator-booking-draft.ts`; `components/booking/{ArrivalApproval,BookingQuestions}.tsx`; `components/simple/DayFreshness.tsx`; isolated fixture/preview/build/PostgreSQL helpers; unit/SQL/browser tests. Existing source-harness tests were updated to supply real shared helpers; negative guide queue cases were retained.

No durable guest draft is added to browser storage. Unsaved form details live in a tab-local memory cache with 20-minute expiry checked on access, plus clearing on logout/reload. Session storage contains only a scoped retry UUID and numeric return scroll position. Unknown save outcome requires retrying the same request or opening its reference; changing the request details cannot create a second booking under that ID.

## Reproducible local checks

Environment: macOS, Node 22.23.3, Next 16.3.8 webpack, PostgreSQL 17, Deno 2.9.4, Playwright Chrome. Browser clock is synthetic `2026-10-15T05:00Z`; browser zone America/Los_Angeles deliberately differs from operator Africa/Johannesburg. SQL fixture uses future 2099 departures plus the shared October 2026 and DST cases. No project `.env.local` is read by the demo/build/database runners.

Run from the repository root:

```sh
npm run test:unit
node_modules/.bin/tsc --noEmit
node tests/helpers/operator-local-postgres.mjs
node tests/helpers/operator-build.mjs
node tests/helpers/operator-preview.mjs
# In a second terminal, while the synthetic preview is running:
npx playwright test --config playwright.operator-usability.config.ts

deno check --config supabase/functions/deno.json --node-modules-dir=none supabase/functions/manual-mark-paid/index.ts supabase/functions/send-email/index.ts supabase/functions/auto-messages/index.ts supabase/functions/confirm-booking/index.ts supabase/functions/yoco-webhook/index.ts supabase/functions/wa-webhook/index.ts

git diff --check
```

The PostgreSQL runner initializes its own `/private/tmp/capekayak-db-test-*` cluster, port 55437, creates/drops a random fixture database and stops the cluster in `finally`. It refuses hosted socket paths. It uses the schema-only rollout fixture and selected real migrations, not a production database clone. Invoice failure injection and voucher-release stubs are local; no real voucher is issued. The build copies source/config without environment files and uses fake localhost keys; existing Google font downloads may require network access. The preview uses ports 3160/3161, original components, a synthetic BusinessProvider and system fonts; AuthGate is replaced only inside the copied demo. It is not evidence of end-to-end hosted login/provider operation.

The fixture includes a future empty departure, child party, pending/partial payment, missing waiver, cancellation, moved same-name booking, group and reseller record. It is shared between SQL and browser reconciliation. External browser requests and operational API mutations are denied. Preview provider routes fail closed; each browser test asserts zero provider calls.

Results and limitations are recorded in [evidence](evidence/). Final counts are recorded after the last run below. Earlier failures exposed the prefill-ref defect, an unbound test helper, missing candidate schema metadata, a native-select locator mismatch and retry timestamp hashing; these were corrected without removing negative cases. Initial isolated font fetches were blocked by sandbox DNS and retried with network permission.

## Verification results and screenshots

- Full unit suite: **142 files passed, 2 files skipped; 2,319 tests passed, 58 skipped**, 49.64 seconds. Skips are 50 agent-MCP backend, 7 native-agent-auth and 1 anonymous cross-tenant probe; these are not counted as verified.
- Disposable PostgreSQL 17: **17 acceptance groups passed** after all three candidate migrations, including upward-adjustment preservation/refund ceiling and unknown/invalid versus explicit-zero prices. Cluster stopped afterward.
- Synthetic Chrome browser: **8 scenarios passed**. Includes differing browser/operator zones, 390px mobile, keyboard glossary/ARIA, exact waiver focus/return, no-write previews, duplicate submission, tab drafts and participant-specific required answers. Final rerun log is linked below.
- TypeScript: `tsc --noEmit` exited 0. Six affected Deno entrypoints checked successfully. Scoped new-module ESLint exited 0; this is not a claim that every pre-existing large-file lint issue was fixed.
- Isolated actual-app Next webpack build: **passed**, 97 static pages generated. Warning: existing Sentry configuration import is deprecated for its future v11; no monitoring credentials/upload were used. Final help-card/receipt wording and the defensive missing-price guard were checked separately with TypeScript and browser/SQL tests after this build.
- `git diff --check`: passed. No failing assertion was weakened to obtain a pass.

Logs: [unit](evidence/unit.log), [PostgreSQL](evidence/postgres.log), [browser](evidence/browser.log), [build](evidence/build.log), [edge types](evidence/edge-check.log), [TypeScript](evidence/typescript.log), [scoped lint](evidence/lint.log), [diff check](evidence/diff-check.log).

Visually inspected synthetic screenshots: [full dashboard](screenshots/full-daily.png), [Simple Today](screenshots/simple-daily.png), [manifest](screenshots/simple-manifest.png), [missing waiver/mobile](screenshots/waiver-resolution-mobile.png), [walk-in review/mobile](screenshots/walk-in-review-mobile.png), [explicit create/mobile](screenshots/walk-in-confirm-mobile.png), [receipt/mobile](screenshots/walk-in-receipt-mobile.png), [unavailable day](screenshots/day-unavailable.png). [Help ARIA snapshot](screenshots/help-aria.txt) supplements, and does not replace, a real screen-reader session. These are viewport captures of the existing scrolling shell, not a claim that every control fits in one viewport.

Demo while its local process is running: `http://127.0.0.1:3160/simple`. Restart with the preview command above if a turn/environment restart clears temporary processes. Test resets intentionally clear only the in-memory synthetic fixture.

## Acceptance matrix

`Local tested` applies only to the described fixture and entry points; it does not imply all hosted workflows were exercised.

| # | Acceptance requirement | Status / evidence / remaining gap |
|---|---|---|
| 1 | Full/Simple/mobile/API reconcile | Local tested: shared manifest and identical fixture IDs/counts, exact slots; full hosted API/auth parity still needs staging. |
| 2 | IANA/midnight/DST | Local tested: SQL and pure date helpers, browser in a different timezone. |
| 3 | Error/stale/loading cannot masquerade as success | Local tested: unavailable vs empty, request-order tests, blocked actions and freshness. Reconnect automation has unit coverage; real device/network rehearsal remains. |
| 4 | Shared check-in policy / bypass protection | Local tested: full/Simple/guide shared readiness, authenticated RPC and direct legacy update rejection, approval roles and waiver requirement. |
| 5 | Concurrent booking / expiry | Local SQL tested: one winner at capacity, existing expiry release once; broad production resource configurations untested. |
| 6 | Double click / retry / back / reconnect | Local tested booking transaction replay and browser double click/back; guide queue negative tests retained. Provider delivery reconciliation is outside these no-send tests. |
| 7 | Valid departure / no silent substitution | Local tested: launch context, unavailable state and deferred/out-of-order responses. |
| 8 | Party/price/discount/partial totals | Local tested server arithmetic, extras/promo/admin overrides, reviewed quote, received/due/cancellation amounts. Real gateway rounding/settlement remains staging-only. |
| 9 | Configured safety/participant scope | Local tested SQL type/options/required/scope/version validation and browser separate guest answers; legal adequacy not asserted. |
| 10 | Consequence preview / no external effects | Local tested walk-in review. Existing general amendment previews/execution not fully retested. |
| 11 | Record money vs charge | Local tested copy/receipt and canonical email figures; no card charge attempted. Existing manual-payment provider handler retained. |
| 12 | Exact waiver/payment resolution and return | Local tested waiver focus, booking identity, day/slot return; safe-return helper tests. Real signing/payment completion not executed. |
| 13 | Tenant / role server checks | Local SQL/API negative cases pass for new paths; exhaustive hosted role matrix remains required. |
| 14 | Advanced access / view preference | Existing full dashboard and tools retained; Simple is optional. No new remembered landing preference. Real-role usability remains human testing. |
| 15 | Safe search / history | Existing search reused; exact same-name/moved IDs tested. Comprehensive search/edit and historical production reconciliation remain unverified. |
| 16 | Mixed bulk outcomes / no duplicate external actions | Per-booking cancellation transaction tested locally; full weather worker notification claims/retries/provider/reseller exceptions remain a release gate. |
| 17 | Keyboard/screen reader/touch/zoom | Local keyboard, ARIA snapshots, focus and 390px mobile browser cases pass. Manual screen reader, zoom, hardware touch and contrast audit remain required. |
| 18 | Import reconciliation / no invented history | No import behavior changed or production import run. Staging reconciliation template supplied; end-to-end migration/import remains pending. |
| 19 | Existing product regressions | Full unit suite, TS and six edge entrypoint checks; isolated build result below. No claim of full customer checkout/channel/finance hosted regression. |
| 20 | Synthetic only / no secrets or live effects | Local runners isolate data and fake keys; browser asserts zero provider calls. No real emails, charges, refunds, vouchers, contacts or deployment. |

## Migration, compatibility and rollback proposal — production approval required

1. Review the actual target migration ledger and backup/restore procedure. Rehearse the **complete** target schema and relevant existing triggers/RLS, not only this selected fixture. Capture the current definitions of replaced functions and confirm outstanding financial/provider jobs and integration compatibility.
2. Apply candidates in order: `20261015170000_operator_daily_consistency.sql`, `20261015171000_operator_booking_transaction.sql`, `20261015172000_operator_cancellation_money.sql`. Each is transactional. The receipt and approval tables must exist before code uses them. Historical party composition stays unknown; no approval, consent, payment or waiver history is invented.
3. Verify tenant roles, query plans/latency at real-sized synthetic volumes, schema cache reload, grants, provider/webhook queues and old/new-client compatibility. Introduce no general fail-open fallback if the RPC is missing. Old booking forms perform multiple writes; coordinate the version transition before allowing pilot writes.
4. Release the canonical email handler and UI only after schema compatibility checks; no background journey activation, DNS change or live test is implied. A separate owner-approved staging/production plan must name target, exact revisions/migrations and test recipients/payment sandbox before any action.
5. Pilot is opt-in and limited, with Simple optional. Monitor save errors, capacity reconciliation, arrival policy rejection, provider outcomes and human task results. No operators are enrolled by this task.

Rollback: prefer UI rollback/feature containment while **retaining server safety checks, receipts and immutable approval history**. A prior UI can still be blocked by the stricter arrival policy. Do not blindly restore the old status-only payment guard or cancellation cash defect. Never drop approval/request tables or reset data as a routine rollback. Function restoration requires a reviewed compatibility patch and reconciliation of bookings/counters/invoices/request receipts first. New columns can stay unused. A sent message, payment/refund, issued voucher or external channel update cannot be undone by rolling back code. None occurred here.

## Remaining gates for a production-ready claim

- Obtain separate approval for a named staging rehearsal and eventual deployment; demonstrate full-schema migration/rollback and old-client compatibility there.
- Run the five-operator baseline/candidate study and manual accessibility checks using the supplied protocol; validate thresholds with the baseline, fix critical mistakes and retest. These cannot be replaced by unit tests.
- Confirm real participant/guardian waiver requirements, collection/access/retention for configured safety answers and approved staff procedure. A booking-level flag remains insufficient evidence for per-guest completeness.
- Reconcile the exact live Thursday/Friday booking/slot IDs in an authorized read-only review. Synthetic correctness cannot identify historical live corruption or stale data.
- Rehearse general booking edits, payment requests/partial settlement, customer self-service, OTA/reseller exceptions, refunds and mixed weather outcomes with **verified isolated providers**. Existing weather email/log decisions still include status-based paid labels; provider unknown outcomes/retry delivery require their own reviewed reconciliation. The new preview does not certify that execution path.
- Verify sender/provider/webhook readiness and queue operational ownership from actual configuration without changing DNS or sending anything. Define alerts, incident owner and support operating model. No support SLA was invented.
- Review marketing independently: approved collection notice/evidence remains absent, so unknown permission must continue to block promotions. Do not activate recipes or treat booking data as permission.

See [pilot protocol](PILOT_PROTOCOL.md), [operator quick start](QUICK_START.md) and [import reconciliation template](IMPORT_RECONCILIATION.md). No recruitment or communications have been sent.
