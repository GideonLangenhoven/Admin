# Rollout review — 6 September 2026

**Historical review:** see [the 12–13 September production release verification](FIRST_FIVE_RELEASE_2026-09-12.md)
for deployed fixes, live client-isolation evidence and the remaining provider gates.
See also the later [Super Admin and Sentry closeout](SUPER_ADMIN_CLOSEOUT_2026-09-13.md).

## Verdict

Do not approve rollout yet. The current source and database configuration contain critical access-control and payment defects. Operator isolation is not guaranteed, and capacity for 2,000 users has not been demonstrated. The configured Supabase data API was also unavailable during this review because the project exceeded its database-size quota.

This was a review, not a remediation deployment. Application code and production data were not changed. Existing uncommitted work was preserved. Findings below remain open.

## Scope and evidence

Reviewed the admin application, nested `booking/` application, database migrations and security snapshot, edge functions, scheduled jobs, and test/CI coverage. Source baseline: branch `scale-security-2026-07-04`, HEAD `6a630c0`, plus the existing working-tree changes.

Evidence labels:

- **Live metadata:** read-only inspection of the configured Supabase project's policies, effective grants, function definitions, constraints, job definitions, aggregate counts, and storage. No customer records are reproduced here.
- **Local reproduction:** the current source handler executed with in-memory database/auth/messaging services. Outbound network access was disabled. Payment signature verification was mocked valid; these tests do not claim a signature bypass.
- **Source trace:** a concrete failure path established from the code, but not exercised against production.

The live data API returned HTTP 402, so end-to-end anonymous/authenticated isolation probes could not run. Deployed edge-function gateway settings were inspected; deployed function bodies were not downloaded and compared with the working tree. Live metadata plus source evidence should not be confused with a production exploit test.

The Ponytail skill guided the review toward concrete failure paths and fixes at shared authorization/database boundaries, rather than proposing new frameworks.

## Findings

### R01 — Critical: public reviews expose the identifier that unlocks private bookings

The public review policy permits approved reviews to be read, and the anonymous role has table-wide SELECT. Those rows include `booking_id`. The booking SELECT policy accepts `x-booking-success-token = bookings.id` as sufficient authorization, without an independent secret, expiry, or tenant match on that branch. An exposed review booking ID therefore unlocks the associated booking's private columns, including customer contact and waiver data. Two approved reviews with booking IDs currently satisfy the exposure precondition.

The customer success page also accepts that reference under any operator's theme without checking the returned booking's business. This is an actual route to cross-operator data presentation, not merely a missing UI filter.

Evidence: **live policies/grants and aggregate count; source trace.** See [review policy and grant](/Users/gideonlangenhoven/dev/capekayak/supabase/migrations/20260503200000_reviews.sql:47), [booking read authorization](/Users/gideonlangenhoven/dev/capekayak/supabase/migrations/20260815140223_close_anon_cross_tenant_booking_reads.sql:44), and [success-page read](/Users/gideonlangenhoven/dev/capekayak/booking/app/success/page.tsx:31).

Required fix: expose only safe review columns; replace booking-ID authorization with a separate scoped, expiring capability or verified customer session. Validate the tenant on the success page too. Test anonymous access and both directions between two unrelated operators.

### R02 — Critical: an operator MAIN_ADMIN can reset a colocated SUPER_ADMIN's password

`reset_password` verifies that the target belongs to the caller's business but never selects/checks the target's role. It then changes both the legacy password hash and Supabase Auth password. A MAIN_ADMIN can consequently take over a SUPER_ADMIN account when their business IDs match. The live database contains one SUPER_ADMIN with an active MAIN_ADMIN sharing its business. `current_business_ids()` gives that super-admin access to all businesses.

Evidence: **local reproduction returned HTTP 200 and recorded both password updates; live aggregate precondition.** [Password-reset target check](/Users/gideonlangenhoven/dev/capekayak/app/api/admin/update/route.ts:137). The role-change branch already blocks a SUPER_ADMIN target, but this branch does not.

Required fix: enforce target-role hierarchy in every account-management action, including reset/setup/permission paths. A tenant administrator must never modify a platform administrator.

### R03 — High: setup invitations can modify an administrator from another operator

The setup-link handler authorizes the optional `business_id` supplied in the request, then independently loads the target administrator by ID/email without checking its business. Operator A can submit A's business ID with operator B's administrator ID. This replaces B's setup token, sets `must_set_password`, and sends B an invitation using the supplied business context.

Evidence: **local reproduction returned HTTP 200 and changed the mocked B account; delivery mocked.** [Authorization and unscoped target lookup](/Users/gideonlangenhoven/dev/capekayak/app/api/admin/setup-link/route.ts:55).

Required fix: authorize against the target row's business and role, not a caller-supplied business ID. Keep legitimate self-service reset behavior separate.

### R04 — High: authenticated users can read other businesses' private columns

`businesses_anon_select` applies to both `anon` and `authenticated` and accepts a caller-controlled business ID, subdomain, or origin header. Anonymous access has restricted column grants, but authenticated users have table-wide SELECT. Any signed-in account can therefore select another operator's full business row using that operator's public identifier. This includes internal configuration and encrypted credential fields; this finding does not assert plaintext credential decryption.

Evidence: **live policy and effective grants.** [Policy extension](/Users/gideonlangenhoven/dev/capekayak/supabase/migrations/20260706090000_extend_storefront_anon_policies_to_authenticated.sql:27), [policy snapshot](/Users/gideonlangenhoven/dev/capekayak/supabase/security-baseline.json:6833).

Required fix: separate the public storefront projection from private business data. Authenticated storefront customers must not inherit full-row access through the public policy.

### R05 — High: a spoofable tenant header authorizes anonymous booking updates

Anonymous INSERT/UPDATE is allowed for DRAFT/PENDING bookings when the row's business ID matches `x-tenant-business-id`. That value identifies the requested tenant; it does not prove ownership. The SELECT policy also admits these rows on PATCH using the same header. A caller can update another operator's pending bookings, including contact/pricing fields, using its public business ID. A bulk PATCH can target matching pending rows without first knowing each booking UUID.

Evidence: **live policies and table-wide anonymous INSERT/UPDATE/SELECT grants; source trace.** [Anonymous write policy](/Users/gideonlangenhoven/dev/capekayak/supabase/migrations/20260804140000_bookings_anon_write_tenant_scope.sql:20), [PATCH read policy](/Users/gideonlangenhoven/dev/capekayak/supabase/migrations/20260815140223_close_anon_cross_tenant_booking_reads.sql:39). No production mutation was attempted.

Required fix: authorize each checkout using a signed/random booking-scoped capability or verified customer identity, and allow only customer-editable fields. A UUID/header is routing information, not proof of tenant membership.

### R06 — Critical: customer-controlled discounts can confirm a booking without payment

Anonymous booking writes include discount fields. `confirm_voucher_booking`, executable by anonymous users with elevated database privileges, recomputes the tour price but trusts those stored discounts. A caller can create a pending booking with a 100% discount and supply an empty voucher list: the required value becomes zero, voucher coverage passes, capacity is reserved, and the booking is marked PAID. The server-side checkout calculation trusts the same purported admin-discount fields.

Evidence: **live RPC definition/grant and write grants; source trace.** [Discount calculation](/Users/gideonlangenhoven/dev/capekayak/supabase/migrations/20260716090000_vouchers_operator_scoped.sql:78), [confirmation](/Users/gideonlangenhoven/dev/capekayak/supabase/migrations/20260716090000_vouchers_operator_scoped.sql:143), [checkout discount handling](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/create-checkout/index.ts:214).

Required fix: prevent public writes to authoritative pricing/discount fields; derive valid promotions and admin discounts through authorized server paths. Do not treat a client-written price snapshot as authoritative.

### R07 — High: elevated RPCs bypass tenant ownership and amount validation

The following live SECURITY DEFINER functions have effective public-client EXECUTE privileges without corresponding ownership checks:

| Function | Callable by | Concrete impact |
| --- | --- | --- |
| `create_hold_with_capacity_check` | anon, authenticated | Accepts unrelated booking/slot IDs and non-positive quantity; can reserve another operator's capacity or reduce `held` with a negative quantity. |
| `deduct_voucher_balance` | authenticated | Accepts any known voucher ID; negative amounts increase its balance. |
| `upsert_customer` | anon, authenticated | Caller-selected business/email can overwrite an existing customer's name, phone, and marketing consent. |
| `increment_marketing_monthly_usage` | anon, authenticated | Caller-selected business/amount can alter another operator's metered email usage. |

Evidence: **live definitions, effective grants, and constraints.** [Hold function](/Users/gideonlangenhoven/dev/capekayak/supabase/migrations/20260711190000_hold_qty_insert_fix.sql:7), [voucher arithmetic](/Users/gideonlangenhoven/dev/capekayak/supabase/migrations/20260414140000_edge_case_rpc_guards.sql:39), [customer overwrite](/Users/gideonlangenhoven/dev/capekayak/supabase/migrations/20260503180000_customers_table.sql:70). The live hold relationships have independent foreign keys, not an enforced same-business relationship.

Required fix: restrict internal RPCs to the service role. For genuinely public operations, enforce caller/capability ownership, positive bounded amounts, valid slot state and expiry, and same-tenant relationships inside the transaction. Review effective privileges including inherited PUBLIC grants.

### R08 — High: message senders and global job endpoints lack caller authorization

`send-whatsapp-text` takes caller-selected tenant, recipient, and message, then sends using tenant credentials without authenticating the request. The ordinary `{type,data}` branch of `send-email` also lacks authorization; signature verification protects only the separate Auth-hook payload shape. Global dispatch endpoints (`cron-tasks`, `auto-messages`, `marketing-dispatch`, and `marketing-automation-dispatch`) likewise run privileged work without authenticating the invoker. All six were deployed ACTIVE with `verify_jwt=false` at review time.

Evidence: **local unauthorized WhatsApp request reached the mocked send; source trace and live gateway settings for the rest.** [WhatsApp entry](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/send-whatsapp-text/index.ts:15), [email entry](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/send-email/index.ts:2513), [marketing entry](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/marketing-dispatch/index.ts:77).

Required fix: authenticate internal invocations and scope interactive admin actions. Public booking flows must derive permitted recipients and business from an authorized booking, not accept an arbitrary send request. Move existing public direct-mail callers behind that boundary as part of the fix; changing gateway flags alone is insufficient.

### R09 — High: mixed-tenant marketing references reach service-role workers

Marketing queue/enrollment policies validate the row's `business_id`, but independent foreign keys do not require its campaign/automation/contact to belong to that business. The workers load referenced objects by ID with service privileges and do not verify business consistency. Given a foreign ID, an operator can queue another operator's template or contact through its own row, mixing messaging data and counters across businesses.

Evidence: **live policies/constraints and source trace.** [Campaign/template load](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/marketing-dispatch/index.ts:103), [automation load](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/marketing-automation-dispatch/index.ts:183), [contact load](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/marketing-automation-dispatch/index.ts:232), [template load](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/marketing-automation-dispatch/index.ts:265). No existing enrollment mismatch was found in the aggregate check.

Required fix: enforce same-business relations at the database boundary and validate them in privileged workers. Preserve explicit, authorized cross-operator partnership flows separately.

### R10 — High: direct database permissions bypass suspension and platform-only settings

The live `current_business_ids()` selects administrators by `user_id` without excluding suspended accounts. A still-valid Supabase session therefore retains database access even if the application refuses a fresh login. Separately, `businesses_update_own` plus table-wide UPDATE allows ordinary tenant staff to edit canonical subscription/billing/seat fields, not just editable operator settings.

Evidence: **live helper definition, policy, and grants.** [Business-update policy snapshot](/Users/gideonlangenhoven/dev/capekayak/supabase/security-baseline.json:6860). The helper grants super roles all business IDs and other admin rows their business IDs without a suspension check.

Required fix: enforce account suspension in the database authorization helper and revoke/refresh sessions appropriately. Restrict platform-owned columns to a privileged server operation. UI role checks are not sufficient protection for the direct data API.

### R11 — High: transient webhook failures permanently lose payment processing

The webhook inserts the payment idempotency key before completing the booking updates. If the PAID update fails, it returns HTTP 200; a provider retry finds the key and returns HTTP 200 without reprocessing. The outer exception handler also acknowledges failures. A customer can be charged while the booking remains unconfirmed.

Evidence: **local reproduction:** two deliveries, one attempted PAID update, both HTTP 200, booking still HELD. [Early idempotency claim](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/yoco-webhook/index.ts:371), [acknowledged failed update](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/yoco-webhook/index.ts:1249).

Required fix: couple durable business completion and idempotency state transactionally, or use a recoverable processing lease/completed state. Retry transient failures; keep notification retries separate from financial completion.

### R12 — Critical: checkout type bypass plus warning-only validation accepts underpayments

`create-checkout` accepts arbitrary `type`. Authoritative booking pricing runs only for the exact value `BOOKING`, while unknown values fall through to ordinary booking metadata and gateway checkout creation using the caller's amount. The webhook's eventual amount mismatch check only logs a warning and proceeds to PAID.

Evidence: **source trace and local webhook reproduction:** a successful R1 payment for an R1,000 booking marked it PAID and recorded R1,000 captured. [Conditional pricing](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/create-checkout/index.ts:131), [unknown-type fallback](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/create-checkout/index.ts:346), [non-enforcing payment check](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/yoco-webhook/index.ts:1239). A real provider signature was not forged or tested.

Required fix: allowlist checkout types, derive every supported charge from trusted records, and reconcile actual provider amount/currency to an immutable expected charge before confirming. Reject/quarantine mismatches instead of acknowledging them as successful bookings.

### R13 — High: voucher-plus-cash bookings understate captured cash and refunds

The booking app stores `total_amount` as the cash remaining after vouchers. The webhook subtracts `voucher_amount_paid` again to set `total_captured`; `process-refund` repeats the double subtraction when capping refundable cash. A R1,000 booking paid R400 by voucher and R600 through the gateway records only R200 cash captured, and the refund path caps cash incorrectly.

Evidence: **local reproduction of R200 capture; source trace of the refund cap.** [Booking payload](/Users/gideonlangenhoven/dev/capekayak/booking/app/book/page.tsx:424), [capture calculation](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/yoco-webhook/index.ts:1247), [refund cap](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/process-refund/index.ts:115). The existing [paid-portions helper](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/_shared/vouchers.ts:31) already documents the convention and its legacy exception.

Required fix: reconcile capture with the real gateway amount and consistently use the existing paid-portions convention. Test full/partial refunds across cash-only, voucher-only, mixed, and legacy bookings; assess historical records before correcting them.

### R14 — High: concurrent mixed-payment checkouts can spend one voucher twice

Checkout validates voucher balance but does not reserve it. The webhook marks the booking PAID before attempting deductions, and never checks that `remainingDiscount` reached zero. Two checkouts can validate against the same balance and pay the discounted cash amount; whichever deducts second can remain PAID despite an insufficient or failed voucher deduction.

Evidence: **source trace.** [Balance-only validation](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/create-checkout/index.ts:241), [deduction after confirmation](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/yoco-webhook/index.ts:1277).

Required fix: reserve voucher credit transactionally before initiating payment and settle/release it idempotently. Never treat incomplete voucher funding as a fully paid booking. Verify concurrent redemptions in staging.

### R15 — High: late-payment capacity check and reservation are not atomic

When a payment arrives without an active hold, the webhook checks `slot_has_capacity` and later increments booked seats with a separate RPC. Two payments competing for the last seat can both pass the check. An atomic increment prevents lost updates, but does not enforce the capacity ceiling. The live slot constraints do not supply that missing ceiling.

Evidence: **source trace and live helper/constraint inspection.** [Availability read](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/yoco-webhook/index.ts:1045), [later capacity increment](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/yoco-webhook/index.ts:1274).

Required fix: use one locked database transaction to validate capacity, confirm the booking, and convert/reserve its seats. Cover manual payment and reschedule variants in the same concurrency tests. A failed capacity reservation after capture must enter an explicit compensation/refund flow.

### R16 — High: a live legacy hold-expiry job conflicts with the application cleanup

The live `expire-holds-db` job runs every minute. It expires ACTIVE holds immediately, then repeatedly subtracts quantities for EXPIRED holds from the preceding two minutes. That overlaps successive executions and can release the same seats twice. Multiple matching bookings for a slot are not aggregated. It also expires holds before the edge cleanup's five-minute grace period, preventing that handler from finding them as ACTIVE and applying its payment/reschedule/notification handling.

Evidence: **live job definition and source trace.** The database job first runs `UPDATE holds ... WHERE status = 'ACTIVE' AND expires_at < now()`, then decrements slots using already-EXPIRED holds newer than two minutes. Compare [edge cleanup selection](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/cron-tasks/index.ts:16). No checked-in definition of `expire-holds-db` was found.

Required fix: establish one authoritative expiry workflow. Claim and release each hold once, transactionally, with correct handling for pending, paid, and reschedule bookings. Reconcile counters and migrate the live schedule deliberately; do not just add another cleanup job.

### R17 — High: paused operators can block marketing work for every operator

Campaign dispatch claims the oldest pending batch before checking business/campaign eligibility, then puts paused/not-yet-due items back into pending without changing their ordering. A batch-worth of such items can be selected forever, starving later ready campaigns. Automation dispatch similarly takes the oldest 100 due enrollments before filtering paused businesses, leaving their due times unchanged. One paused operator can occupy the whole batch.

Evidence: **source trace and live claim-function definition.** [Queue selection](/Users/gideonlangenhoven/dev/capekayak/supabase/migrations/20260511044907_scale_readiness_hardening.sql:125), [deferred claim release](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/marketing-dispatch/index.ts:272), [automation limit before eligibility](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/marketing-automation-dispatch/index.ts:140).

Required fix: select eligible work before applying the batch limit and provide bounded progress across tenants. Increasing batch size only moves the starvation threshold.

### R18 — High: booking pagination drops records; other queries silently stop at 1,000 rows

The bookings dashboard applies the same page offset separately to each 500-slot batch, concatenates the results, and keeps only the first 50. With 501 slots, 51 bookings in batch A and one in batch B, page zero discards B's booking; page one skips it because B also receives offset 50. That booking never appears. Unslotted bookings appended only on page zero can similarly be discarded.

The initial slot query is also unpaginated. The live API limit is 1,000 rows. Other affected paths include date-based automation/contact selection, the super-admin business selector, and the refund register's `.limit(5000)` query; asking for 5,000 does not bypass the server limit. Date filtering for the refund register happens after truncation.

Evidence: **source trace and live PostgREST `max_rows=1000`.** [Per-batch pagination](/Users/gideonlangenhoven/dev/capekayak/app/bookings/page.tsx:345), [final slice](/Users/gideonlangenhoven/dev/capekayak/app/bookings/page.tsx:437), [automation selection](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/marketing-automation-dispatch/index.ts:46), [business selector](/Users/gideonlangenhoven/dev/capekayak/components/AuthGate.tsx:68), [refund register](/Users/gideonlangenhoven/dev/capekayak/app/reports/page.tsx:572).

Required fix: paginate one globally ordered booking result, using a joined date predicate. Paginate all potentially large scans and perform date filtering server-side. Test above 500 slots and 1,000 records/operators. This is missing data, not only slower performance.

### R19 — High: waiver redirect crashes; the normal edge check misses it

The waiver GET handler declares `waiverBaseUrl` as a constant and then assigns to it. The first assignment error is swallowed; the fallback assignment throws again and the handler returns HTTP 500. This occurs for a complete booking/token link that reaches the redirect branch.

Evidence: **local runtime reproduction and full edge-function typecheck.** [Invalid assignments](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/waiver-form/index.ts:294). The full check reports three TS2588 errors here and one in [debug-logs](/Users/gideonlangenhoven/dev/capekayak/supabase/functions/debug-logs/index.ts:17). The latter similarly reassigns a constant request-body variable.

Required fix: correct the local variable declarations and include every edge entry point in CI typechecking. The current `check:edge` covers only 12 of 54 functions.

### R20 — Critical operational blocker: database quota currently disables the data API

The configured Supabase data API returned HTTP 402 with violation `exceed_db_size_quota`, including on the read-only probe setup request. Read-only management inspection measured the database at **1,251 MB**, including **1,029 MB** in `cron.job_run_details` and **190 MB** in `net._http_response`. Scheduled-job/HTTP history dominates storage rather than core operator records.

Evidence: **live HTTP response and storage metadata.** This blocks normal data-API operation and prevented end-to-end isolation verification during the review.

Required fix: restore project service through an owner-approved capacity/retention decision; implement appropriate job-history cleanup and size alerts so the condition does not recur. No records were deleted and no billing settings were changed during this review.

## Checks completed

| Check | Result |
| --- | --- |
| `npm run test:unit` | 70 test files passed; 687 tests passed, 1 skipped |
| Root TypeScript, `--noEmit --incremental false` | Passed |
| Nested booking TypeScript, same flags | Passed |
| `npm run lint -- --quiet` | Passed the lint-error check |
| `npm run check:edge` | Passed its selected 12 functions |
| Deno check of all 54 edge entry points | Failed: four TS2588 errors |
| Current-handler isolated reproductions | Seven bugs reproduced, no network or real writes |
| Live database invariant counts | Zero violations in the eight checks listed below |
| End-to-end tenant-isolation probes | Blocked at setup by data-API HTTP 402 |
| 2,000-user load/soak test | Not run; capacity not certified |

The eight invariant checks covered booking/slot tenant mismatch, booking/tour tenant mismatch, booking/customer tenant mismatch, hold/booking/slot tenant mismatch, slots over capacity, ACTIVE holds expired over one hour, non-positive hold quantities, and marketing-enrollment tenant mismatch. A separate check found no future slots whose held count exceeded the sum of active holds. These clean snapshots are useful, but do not prove the policies prevent future contamination or concurrent failures.

No production build, full browser E2E run, dependency-vulnerability audit, or production stress test was completed as part of this pass. Existing stress scripts are not evidence of 2,000-user readiness. Whether 2,000 means accounts, active operators, or simultaneous sessions remains unspecified.

## Why existing green tests are insufficient

Several security/payment tests assert source strings or a checked-in snapshot rather than exercising authorization and financial state transitions. The snapshot does not include function grants; the corresponding [anonymous RPC test explicitly skips](/Users/gideonlangenhoven/dev/capekayak/tests/unit/anon-cross-tenant-reads.test.ts:46). The primary [PR workflow](/Users/gideonlangenhoven/dev/capekayak/.github/workflows/ci.yml:13) runs lint, root typechecking, and production smoke E2E, but not the unit suite, full edge-function check, or a two-tenant adversarial isolation suite. Policy drift checks also need RPC privileges/definitions and scheduled jobs in scope.

A SECURITY DEFINER routine can act with its owner's privileges, so enabled table RLS alone is not evidence that such an API is safe. Effective EXECUTE grants and authorization inside each routine matter. See the official [database-function security guidance](https://supabase.com/docs/guides/database/functions) and [RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Minimum release gates

1. Restore the data API and address storage growth. Close the access-control/payment findings before adding operators.
2. Build a disposable two-tenant staging dataset with distinct contacts, bookings, vouchers, staff roles, templates, storage objects, and webhook configurations. Prove unauthorized reads, writes, RPC calls, and job/send invocations fail in both directions, including suspended users, forged headers, known foreign IDs, and shared-browser tenant switching.
3. Enforce same-business relational integrity and authoritative pricing/capacity transitions in the database. Use the existing helpers where correct; avoid duplicating guards only in dashboards.
4. Run concurrent last-seat bookings, voucher reuse, late/duplicate/out-of-order webhooks, provider timeouts, database failure recovery, and full/partial refunds. Assert both money and seat invariants after every run.
5. Test datasets above every batch/page boundary and a 2,000-operator/account dataset. Agree on expected concurrent sessions, booking/payment rates, acceptable latency, queue delay, and recovery objectives; load/soak test that workload with external delivery sandboxed.
6. Make all unit, edge, isolation, and payment/concurrency regression checks mandatory in CI. Then deploy to staging, verify deployed configuration, and use a monitored staged rollout.

These are verification gates, not a promise that any review can establish a permanent absence of all bugs.

## Local reproduction artifacts

The read-only inspection and isolated-handler scripts used during this session are temporary local artifacts:

- [inspect.mjs](/private/tmp/capekayak-review-jHEmJz/inspect.mjs) — management read-only API/metadata inspection; credentials loaded internally and not printed.
- [reproduce.cjs](/private/tmp/capekayak-review-jHEmJz/reproduce.cjs) — seven current-source failure reproductions with mocked services and network disabled.

Re-run the isolated reproductions with `node /private/tmp/capekayak-review-jHEmJz/reproduce.cjs`. Temporary files may be removed by the operating system; convert the relevant cases into permanent regression tests during remediation.
