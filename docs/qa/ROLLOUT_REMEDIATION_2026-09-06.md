# Rollout remediation — 6 September 2026

**Current status (13 September):** technical fixes have now been deployed and
live five-client isolation checks passed. See the
[current release evidence and remaining provider gates](FIRST_FIVE_RELEASE_2026-09-12.md)
and [onboarding instructions](FIRST_FIVE_CLIENTS_2026-09-13.md).
The dated status and local-only table below are retained as historical notes.

Latest functional follow-up: [MVP closeout](MVP_CLOSEOUT_2026-09-11.md), following
the [11 September repairs](FUNCTIONAL_REPAIRS_2026-09-11.md).
The deployment and outage statements below are historical observations, not the
current live state. The follow-up records the new checks and deployment order.

Status: in progress; not approved for production. Existing working-tree edits are preserved. No production deployment, billing change, or data deletion has been performed.

Plan: repair account boundaries; migrate public checkout/database authorization together; make payment/hold transitions safe; fix queue/pagination limits; run regression, database, build, and staged rollout checks. User-visible workflows must have positive-path tests, not only denial tests.

| Finding | State | Verification / remaining work |
| --- | --- | --- |
| R01 Public review → booking disclosure | Local fix | Booking-ID read branch removed; signed 24-hour booking/operator capability, guarded checkout issuance, verified customer polling; rollout and R05 caveats below |
| R02 Platform admin password takeover | Local fix | Shared target-role/tenant guard; runtime regression tests |
| R03 Cross-tenant setup invitations | Local fix | Target-derived authorization/branding; invite and self-reset tests |
| R04 Private business-row disclosure | Local fix | Public policies limited to anon; private fields denied and storefront reads preserved in PostgreSQL tests |
| R05 Anonymous booking modification | Local fix | Anonymous UPDATE now requires the booking's own waiver-token pair (booking insert returns it; storefront sends it via a booking-scoped client); money/status fields stripped on anon writes |
| R06 Forged discounts | Local fix | Anon money-field writes zeroed/stripped by trigger; checkout/uplift charges derived server-side; `confirm_voucher_booking` recomputes totals and ignores cross-tenant vouchers |
| R07 Unsafe elevated RPCs | Local fix | `create_hold_with_capacity_check` rejects non-positive/oversize qty and cross-tenant booking/slot pairs; `deduct_voucher_balance` rejects non-positive amounts; customer/metered helpers already service-only |
| R08 Unauthorized message/job invocation | Local fix | Six entry points authenticated; operator job scopes and stored voucher notifications tested; requires coordinated Vault/cron/edge/client deployment |
| R09 Mixed-tenant marketing relations | Local fix | Composite foreign keys, generated step reference, worker tenant checks; valid editor/deletion flows tested |
| R10 Suspension/platform fields | Local fix | Database suspension and protected-field enforcement; ordinary settings/billing support retained |
| R11 Webhook failure/replay | Local fix | `claim_yoco_payment` lease: completed replays ACK, in-progress defers, failed/stale retries; transient RPC failures return 503 for redelivery; notifications outside the lease |
| R12 Underpayment acceptance | Local fix | Strict checkout type allowlist with legacy bot-type mapping; server-derived uplift/deposit charges; `expected_amount_cents` stamped at checkout; webhook quarantines mismatches (`MISMATCH_QUARANTINE`) instead of marking PAID |
| R13 Cash/voucher accounting | Local fix | Signed integer-cent capture, shared cash/voucher split, correct refund ceilings and explicit reserved gateway amount; `20260911100000` auto-corrects captured-high rows (logged, refunds/combo skipped) and `r13_capture_report()` lists the rest for manual Yoco reconciliation |
| R14 Voucher double spend | Local fix | `voucher_reservations` ledger with lock-checked reserve at checkout, idempotent settle inside payment confirmation, release on timeout/cancellation/mismatch |
| R15 Capacity race | Local fix | `confirm_booking_payment` serializes on the booking row: slot lock, tenant check, capacity validation, hold-convert-or-reserve, booking flip — all-or-nothing |
| R16 Conflicting hold expiry | Local fix | `expire_single_hold` is the single authoritative path (5-min grace, idempotent claim, tenant-checked release; reschedule capacity owned by the edge branch). UNSCHEDULE the legacy `expire-holds-db` SQL cron before deploy — running both double-releases |
| R17 Shared-queue starvation | Local fix | Eligibility before limits in atomic queue/enrollment claims; >600 paused rows and concurrent claims tested |
| R18 Pagination/data omission | Local fix | Global booking RPC with tenant guard; operator selector, reports and registers paginated; >1,000-slot/row tests plus stale-request/operator-switch protection |
| R19 Waiver runtime/type failures | Local fix | Redirect positive-path tests; all 55 edge functions typecheck; invalid storefront page export also fixed during production build verification |
| R20 Database size quota/outage | Local fix, owner action still required | `purge_operational_logs()` deletes `cron.job_run_details` / `net._http_response` older than 7 days (called best-effort from cron-tasks); owner must still approve capacity, run `VACUUM (ANALYZE)` outside a transaction (VACUUM cannot run in a migration), and unschedule `expire-holds-db` |

Local fixes are not equivalent to deployed or production-verified fixes. Final release gates include a healthy data API, two-tenant integration tests, payment/capacity concurrency tests, and an agreed 2,000-user workload tested in staging with external messages/payments sandboxed.

## Verification — 10 September 2026

- Unit suite: 77 files, 847 passed, 1 existing skipped test (11 September 2026 batch: R05/R06/R07/R11/R12/R14/R15/R16 fixes). Includes 31 confirmation-capability/checkout/polling regressions, 5 webhook lease/quarantine regressions, updated uplift-pricing, payment-link, hold-expiry and voucher-settlement tests, plus 25 payment-accounting regressions. Financial handler tests mock the signature library, database reservation and provider; they do not prove real provider delivery or transaction concurrency.
- Disposable PostgreSQL 17: 85 checks passed. Covers operator isolation, private column grants, suspension, billing field protection, service-only helpers, Vault-backed cron SQL, composite marketing relationships, draft/template deletion compatibility, paused backlogs, simultaneous claims and 1,201 slots with interleaved unslotted bookings. Nineteen new checks cover R01: paid-booking ID attacks via GET/POST/PATCH, foreign/suspended/non-admin callers, and preserved waiver/customer/operator/service access.
- Administrator and storefront production builds passed with webpack, including Next.js route-type checks; the storefront build was rerun after R01. All 55 edge functions typecheck. Standalone TypeScript checks passed for both applications. Lint: zero errors, 288 warnings at the earlier full run; R01 changed-file error checks also passed for both repositories. Earlier builds needed network access for their configured Google Fonts. Storefront middleware deprecation and outdated Browserslist warnings remain.
- The storefront build exposed a pre-existing invalid named `BookingFlow` export from `app/book/page.tsx`. No other module imported it, so only its export keyword was removed. The default page, component body and booking flow were preserved; the subsequent full storefront build passed.
- No production migrations, deployments, messages, payments, deletions or billing changes performed. Live read-only scheduler metadata confirmed the four affected jobs currently omit authorization.

## Deployment prerequisites for this batch

1. Provision exactly one Vault secret named `edge_jobs_service_role_key`, matching the `SUPABASE_SERVICE_ROLE_KEY` used by the edge functions. Do not store the value in source control. The cron migration refuses to proceed without it.
2. Apply the new SQL migrations in timestamp order before deploying the modified workers. They preserve existing schedules/URLs, replace rather than duplicate foreign keys, and validate legacy references. Unexpected or inconsistent data stops the migration for explicit review; it is not silently deleted or reassigned.
3. Deploy the updated confirmation function before the storefront stops sending voucher-balance emails directly. Coordinate the protected email/WhatsApp functions with the administrator photo-page update and authenticated scheduler commands.
4. Verify scoped manual dispatch, scheduled invocation and message delivery in staging with external providers sandboxed. These fixtures test SQL and handler behavior, not live provider delivery or 2,000 concurrent users.
5. Deploy `list_operator_bookings` before the administrator booking-list client. Confirm its PostgREST tour/slot embeds and both date-filter modes in staging. Switching operators intentionally clears the previous operator's local page/form state; refreshing settings for the same operator keeps it.

## R01: confirmation privacy, one-at-a-time continuation

- `20260910080000_remove_booking_reference_read_access.sql` removes the `x-booking-success-token = booking.id` SELECT branch. Independent waiver tokens, verified customers and operator sessions retain their existing paths. No booking rows or credentials are rewritten.
- `booking-success` validates an HMAC before reading the database. The capability binds the booking ID, business ID and 24-hour expiry; it grants only a bounded confirmation response, not generic database or customer-session access. Both IDs constrain the service-role query; mismatched tour/slot tenants fail closed. Responses are private/no-store.
- New Yoco success URLs carry the token in their fragment, outside HTTP request queries and Referer headers. All three shared checkout branches and five direct WhatsApp checkout branches use the same signer. Credential-bearing provider responses are no longer logged. The signer uses the existing server-only service key, with an optional project-wide `BOOKING_SUCCESS_SECRET` override; no dependency or token table was added.
- Public `create-checkout` callers must supply the independent waiver secret already returned by their booking insert. Existing internal service and same-operator admin calls retain their authenticated path. Knowing an existing paid booking ID cannot mint a new confirmation link. This is not the complete R05 authorization fix: anonymous DRAFT/PENDING read-back and writes still expose pre-payment data/secrets and require their own booking-specific protections before release.
- The storefront sends the proof, reads confirmations through the new endpoint, rejects wrong booking/operator responses, ignores stale responses and bounds pending-payment retries. Missing/expired links provide Retry and verified My Bookings access instead of asserting an unverified successful payment. Normal paid confirmations retain their existing details, waiver/calendar links and notification fallback. My Bookings polls its existing verified lookup, constrained to the specific booking so the 100-row history limit cannot hide it.
- Stage the new `booking-success` endpoint and backward-compatible `my-bookings-lookup` update first, then the storefront, then the guarded checkout/WhatsApp issuers and R01 SQL migration as a coordinated release. Do not enable the checkout guard before the storefront supplies `booking_token`. Old cached checkout pages may need a reload; pre-existing reference-only payment return links still allow payment but require verification in My Bookings to see private details. Never restore reference-only access as a compatibility fallback.
- Before production, verify Yoco's real hosted redirect preserves the fragment across all configured operator domains, including WhatsApp/admin links, rescheduling and added guests. Use sandbox payments and two staging tenants. The [Yoco checkout API](https://developer.yoco.com/api-reference/checkout-api/checkout/create-checkout) supports configured success URLs; local URL/handler tests do not prove the provider/browser redirect round-trip. No live payment, browser/provider end-to-end or 2,000-user load result is claimed.
- Next single issue: R05 anonymous booking writes and read-back. R06 pricing and R07 elevated RPC authorization remain separate release gates.

## Payment follow-up before rollout

- `20260911100000_r13_capture_reconciliation.sql` auto-corrects the safe direction only: PAID/COMPLETED rows with zero prior refunds whose `total_captured` exceeds the `getPaidPortions()` convention cash are revised downward, each logged (`capture_reconciled_r13`) with before/after values. Lower-capture rows, refunded rows and combo legs are NOT touched — run `SELECT * FROM r13_capture_report()` and reconcile those against Yoco records before approving further refunds on them.
- The shared cancellation helpers now recognize cash-due-after-voucher rows and the existing `original_total` marker for legacy inclusive rows. Fully voucher-paid customer cancellations reissue the voucher value rather than the zero cash due.
- Yoco's documented `succeeded` response is now accepted alongside the existing `successful` spelling. The API expects integer cents and supports explicit refund amounts; both are tested. [Yoco refund API](https://developer.yoco.com/api-reference/checkout-api/checkout/refund-checkout), [payment notification](https://developer.yoco.com/api-reference/checkout-api/webhook-events/payment-notification).
- Remaining refund lifecycle risk found while tracing R13: pending/unknown provider outcomes need durable reservation reconciliation. The current failure path can release a reservation for a pending response, and the webhook ignores refund events. Address this with R11's retry/settlement work before deployment. Success-spelling handling alone is not a complete refund-state fix.
- MVP rollout path is `docs/qa/MVP_SMOKE_RUNBOOK.md` (single stress tenant, Yoco test mode, half a day): webhook replay, last-seat double-spend, checkout-type matrix, reschedule/voucher-split, expired-hold link, two-tenant adversarial spot-checks, `invariants.sql` green after every scenario. Full fleet soak (`seed-fleet.sql`, 1,500 tenants) is deferred past MVP.
- R01 still needs its coordinated deployment/staged verification above. R13 lower-capture rows still need manual Yoco reconciliation (report query above); R20 owner capacity/VACUUM approval still blocks live API verification. No production-ready claim is made from passing local tests.

Native regression command: `npm run test:isolation:local -- <local-Postgres-host-or-test-socket>`. Only loopback or a disposable `/private/tmp/capekayak-db-test-*` socket is accepted; no `.env.local` or production connection URL is loaded. The runner creates and drops only its own randomly named test database. It needs permission to create that database and fixture roles on a disposable local cluster.
