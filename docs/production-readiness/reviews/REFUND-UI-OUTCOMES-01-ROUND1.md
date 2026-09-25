# REFUND-UI-OUTCOMES-01 independent review

**Decision: CHANGES_REQUIRED**

Reviewed 2026-09-21. Base HEAD: `718dee28df58df0cab527eb3f4aea7f8ae513389`.

Only the four frozen files were reviewed for acceptance. The actual process-refund server implementation and affected callers were read to establish the contract. Application sources were not edited. No real provider, database, refund, credentials, or remote calls were made. All executed paths used explicit local doubles.

## Required corrections

### R1 — P1: a delayed session lookup can dispatch money requests after the run is invalidated

Location: [app/lib/booking-actions.ts:36](/private/tmp/bookingtours-simple-view-1812677/app/lib/booking-actions.ts:36), especially the unconditional fetch at [line 51](/private/tmp/bookingtours-simple-view-1812677/app/lib/booking-actions.ts:51).

All four callers are affected: [bookings runBulk:327](/private/tmp/bookingtours-simple-view-1812677/app/bookings/page.tsx:327), [queue automatic:119](/private/tmp/bookingtours-simple-view-1812677/app/refunds/page.tsx:119), [queue manual:145](/private/tmp/bookingtours-simple-view-1812677/app/refunds/page.tsx:145), and [queue all:178](/private/tmp/bookingtours-simple-view-1812677/app/refunds/page.tsx:178).

The callers' refs stop later loop iterations and suppress stale results, but they cannot stop the current helper while `supabase.auth.getSession()` is pending. The helper accepts no context guard and performs `fetch` as soon as that await resolves. A tenant change or component unmount during this wait therefore causes a new request to be sent afterward, even though no network request existed at the time of invalidation. This includes `confirm_manual`, which records a manual transfer as complete. Server authority does not substitute for the UI context requirement: an operator remains authorized for their own booking after leaving the page, and a SUPER_ADMIN remains authorized for the old tenant's booking after switching tenants.

Concrete actual-source reproduction in `probes.cjs`:

1. Invoke each real caller using the real `processRefundAction` module with a deferred `getSession` double.
2. Wait until the helper is inside `getSession`; assert there have been zero fetches.
3. Set `run.cancelled = true` and either change `businessIdRef` to tenant B or set `mountedRef = false`.
4. Resolve the session with a synthetic token.
5. Observe **one POST after invalidation** in each of eight cases; expected zero. The POST targets booking A (with `action: "confirm_manual"` for manual confirmation). No UI reload or bulk audit follows, because those outer guards do correctly see the invalidation.

Minimum correction: pass the run's validity predicate or cancellation state through both refund action APIs, check it at entry and again immediately after the session await / immediately before fetch, and stop without submission if invalid. Both queue individual entry points should also exit when their captured context is already stale. A request already dispatched is a different case: do not abort it and claim it was unprocessed. Preserve known results or uncertainty, while suppressing stale UI and stopping later items. Add actual-helper delayed-auth tests for every caller, covering tenant changes and unmounts.

### R2 — P2: pending errors are replaced with an inaccurate provider-waiting claim

Location: [app/lib/booking-actions.ts:70](/private/tmp/bookingtours-simple-view-1812677/app/lib/booking-actions.ts:70) and [queue pending label:334](/private/tmp/bookingtours-simple-view-1812677/app/refunds/page.tsx:334).

Every `pending: true` response receives the same message: “Refund submitted and awaiting provider confirmation.” The actual server returns pending responses for materially different states:

- [process-refund:134](/private/tmp/bookingtours-simple-view-1812677/supabase/functions/process-refund/index.ts:134) returns HTTP 503 `{error: "Payment credentials for the original payment mode are missing", pending: true}` before the provider call.
- [process-refund:164](/private/tmp/bookingtours-simple-view-1812677/supabase/functions/process-refund/index.ts:164) returns HTTP 503 `{error: "Cash refunded; voucher credit still needs to be reissued. Please retry.", pending: true}` after the cash operations have succeeded.

The independent response probes supplied these exact payloads. Both returned only the generic provider-waiting message at the result's display fields; the real error survives only inside `data`, which neither caller displays. `/refunds` additionally labels both “Pending provider confirmation.” Thus missing credentials appear to need only provider confirmation, and an outstanding voucher reissue hides that cash has already been returned.

Minimum correction: retain and display the server's pending explanation (`error`/`message`) and use a neutral pending label unless the response establishes that provider confirmation is the outstanding step. Keep the `pending` category and existing refund-reference retry advice. Add tests for these two real server payloads; assert the visible explanation rather than only the outcome enum.

## Verification and accepted behavior

- Frozen source hashes matched before and after review (listed below).
- Independently ran the submitted focused suite: **13/13 passed**.
- Independently ran refund authority, payment accounting runtime, voucher branching, and decline refund suites: **67/67 passed**. Expected synthetic uncertain-response stderr appeared; no live call occurred.
- Ran [probes.cjs](/private/tmp/bookingtours-simple-view-evidence-1812677/refund-ui-outcomes-01/review-20260921/probes.cjs). It executes transpiled actual source with strict import doubles and local fake fetch. [probes.json](/private/tmp/bookingtours-simple-view-evidence-1812677/refund-ui-outcomes-01/review-20260921/probes.json) records its observations.
- Confirmed all refund-action callers by repository search: one bookings bulk call through `refundBookingAction`, three queue calls through `processRefundAction`, and the wrapper itself.
- Queue repeated calls while the session is delayed dispatch once per intended item; locks and processing state clear after normal completion. Automatic partial amount and manual amount/action arguments are preserved.
- Terminal cash, partial, voucher, and already-refunded responses classify as completed. Manual action, real provider pending, explicit provider failure, and generic HTTP 500 classify distinctly. Focused tests cover malformed/lost responses, auth absence/failure, thrown actions, actual local audit results, visible audit failures, and preservation of cancel/mark-paid/check-in arguments.
- OPERATOR authorization remains present in the accepted Edge base and its independently rerun tests. This UI diff does not remove it.

## Scope limits

This is a source and synthetic runtime review, not a live-provider or browser certification. No global TypeScript/lint or unrelated baseline suites were rerun: the provided validation records the unrelated concurrent MFA type error, seven existing lint warnings, and five known canonical/mobile baseline failures. Neither those files nor the concurrent offline/MFA changes were modified or approved here.

The bulk loops remain browser-driven. The UI's keep-open wording and unprocessed initial entries do not provide durability after browser closure. Durable background jobs are explicitly separate follow-up work and are not a condition of this review.

## Frozen hashes

```text
816aef4be50b9decbd204ef2105e8cfd77cad91d241547a9502a2148b03b23da  app/lib/booking-actions.ts
3718e4d7dcfecb3fd8f32692afd55dc045d2b92a398b59e2a4d069348ed24068  app/bookings/page.tsx
134ec579dfdffe42005b45845b96695486ec9995f8fe015729f24de1e85f506a  app/refunds/page.tsx
9e2197e19f4367170c4fd10d8c56e9f46d7b82d061a5d9b338285c61be85f75a  tests/unit/refund-ui-outcomes.test.ts
```

Executed commands:

```text
node_modules/.bin/vitest run tests/unit/refund-ui-outcomes.test.ts --no-cache
node_modules/.bin/vitest run tests/unit/refund-authority-runtime.test.ts tests/unit/payment-accounting-runtime.test.ts tests/unit/voucher-refund-branching.test.ts tests/unit/decline-refund.test.ts --no-cache
node /private/tmp/bookingtours-simple-view-evidence-1812677/refund-ui-outcomes-01/review-20260921/probes.cjs
```
