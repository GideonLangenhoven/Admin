# Customer journey review, 11 September 2026

The highest-value work before launch is to make prices, availability, payment status and cancellation credit agree throughout the journey. The current working trees have several concrete failures in those areas. Address the P1 findings before exposing the affected flows to customers. Cosmetic changes can wait.

Scope: the current administrator app, nested `booking` storefront, shared checkout/webhook functions, cancellation/refund/amendment handlers, hold cleanup, staged SQL migrations, onboarding checklist and release tests. Existing staged and unstaged work was included. This review changes no application code or production state.

Evidence: source tracing plus 13 isolated scenarios executing current handlers/functions and rendering current components against in-memory fixtures. These reproduce the described behavior without network access. They are not a live database, browser or payment-provider end-to-end run. Findings involving the staged money-stripping migration explicitly assume that its trigger executes as intended; deployed trigger/JWT configuration was not verified.

## P1: resolve before releasing the affected journeys

### J01. Staged money stripping and checkout do not form a complete pricing workflow

The new [insert trigger](../../supabase/migrations/20260911090000_payment_hold_hardening.sql) zeros anonymous `unit_price`, `total_amount`, `original_total`, voucher funding and promo fields. However, `create-checkout` still reads voucher funding and stored discounts from that row. The storefront's checkout request sends voucher IDs/codes, but no promo code. Checkout only writes `total_amount` when the requested charge differs from its calculation; it never restores the standard booking's unit price.

Executing the actual checkout handler with the zeroed row produced:

| Journey | Customer's displayed charge | Gateway charge | Stored booking result |
| --- | ---: | ---: | --- |
| Ordinary R1,000 booking | R1,000 | R1,000 | Total and unit price remain R0 |
| R1,000 booking with R400 voucher | R600 | R1,000 | Voucher funding remains R0; no voucher reservation |
| R1,000 booking with R200 promo | R800 | R1,000 | Promo absent from checkout; full charge |

This can affect confirmation totals, refunds, amendments and reports as well as what the customer pays. These are local reproductions of the intended post-trigger state, not evidence that those charges have occurred in production.

**Fix:** have the server validate the selected promo/vouchers, calculate the complete price, persist authoritative unit price/cash/voucher/discount fields on every checkout, and return the actual quote. Keep the anonymous money-write protection. Do not solve this by trusting browser prices again. Move promo-use consumption to a successful/reserved transaction with retry-safe semantics; the current storefront consumes it before checkout succeeds.

References: [storefront submitBooking](../../booking/app/book/page.tsx), lines 425–469 and 541–545; [create-checkout](../../supabase/functions/create-checkout/index.ts), lines 173–296 and 482–527; [payment confirmation](../../supabase/migrations/20260911120000_atomic_voucher_confirmation.sql).

**Acceptance:** execute anonymous insert → checkout → payment confirmation against the actual staged schema for ordinary, promo, partial-voucher and fully-voucher bookings. Check the displayed price, provider amount, saved price, voucher balance, confirmation and refundable cash together.

### J02. Paid amendments depend on a database function missing from the repository

The current reschedule and added-guest webhook branches call `confirm_booking_uplift`. A repository search finds the callers and test mocks, but no SQL definition or migration. A database built from this repository cannot complete those payments through that function. The handlers return 503 when the RPC fails, after the customer has already paid.

**Fix:** include and test the actual RPC migration before deploying the webhook. If it already exists only in an external database, capture its definition in a migration and prove a fresh database can run it. Until then, keep paid amendments under operator assistance.

References: [yoco-webhook](../../supabase/functions/yoco-webhook/index.ts), calls around lines 781 and 883; [mocked uplift tests](../../tests/unit/yoco-routing.test.ts).

**Acceptance:** use the real RPC to settle each amendment once, replay the same event, and verify money, guest count, original/new capacity and waiver state.

### J03. Cancelling an unpaid booking reduces the paid-seat counter

`cancel-booking` always sends `p_booked_delta: -qty`, including for a PENDING booking with no reserved seats. The isolated handler reproduction cancelled an unreserved two-person booking and requested a reduction of two booked seats. If that departure has two other paying guests, the counter can now advertise those occupied seats as available.

The capacity RPC clamps at zero; it does not know which booking owned those seats. The operation also separates the status change, hold cancellation and capacity adjustment, so a retry/concurrent cancellation needs protection.

**Fix:** release only the capacity owned by that booking: booked seats for an actual confirmed reservation, and held seats from its active holds. Claim the cancellation and release capacity together, once, in a transaction. Reuse that path from single and bulk cancellation.

References: [cancel-booking](../../supabase/functions/cancel-booking/index.ts), lines 151–163; [adjust_slot_capacity](../../supabase/migrations/20260511044907_scale_readiness_hardening.sql).

**Acceptance:** cancel an unreserved pending booking beside paid bookings and assert the paid-seat count does not change. Repeat cancellation and race two operator requests.

### J04. Abandoned amendments can keep seats unavailable after expiry

The expiry sweep treats the original booking's PAID status as evidence that any related hold has been paid. For a pending reschedule it checks for COMPLETED, but then falls through to the same CONVERTED branch even when the amendment remains PENDING. Added-guest holds use that branch too.

Both isolated scenarios changed the expired amendment hold to CONVERTED without releasing capacity. The new-slot/extra-guest held counter stays elevated and the normal ACTIVE-hold sweep will not visit it again. The staged `expire_single_hold` RPC has the same parent-payment shortcut.

**Fix:** determine settlement from the specific amendment/hold payment. Expire an unpaid amendment, release its own held seats exactly once, and preserve the original booking. Update both the worker and SQL path.

References: [cron-tasks](../../supabase/functions/cron-tasks/index.ts), lines 36–60; [expire_single_hold](../../supabase/migrations/20260911090000_payment_hold_hardening.sql), lines 437–451.

**Acceptance:** abandon an uplift on a PAID booking beyond expiry plus grace. Its extra seats become available; the original trip remains booked; a second cleanup changes nothing.

### J05. Weather/bulk operator cancellations can omit voucher-funded credit

Weather cancellation calculates compensation from `total_amount`, which the current accounting convention defines as the cash portion. A fully voucher-funded R1,000 paid booking therefore becomes CANCELLED without ACTION_REQUIRED or any claimable amount. My Bookings requires both that status and a positive amount to show the recovery actions.

The same omission exists in `cancel-booking`, used by bulk cancellation. The single-booking UI has a separate voucher branch, so customers receive different outcomes depending on which operator workflow is used. For split-funded bookings, choosing a credit voucher can likewise return only the cash portion.

**Fix:** derive total compensation from the existing `getPaidPortions()` helper and preserve cash/voucher funding separately. Voucher-funded value must be recoverable as voucher or rebooking credit, without becoming cash-refundable.

References: [weather-cancel](../../supabase/functions/weather-cancel/index.ts), lines 93–104; [cancel-booking](../../supabase/functions/cancel-booking/index.ts), lines 120–139; [credit eligibility](../../supabase/functions/rebook-booking/index.ts), around line 1678; [paid portions helper](../../supabase/functions/_shared/vouchers.ts).

**Acceptance:** weather-cancel fully voucher-funded and split-funded bookings, then exercise every offered recovery choice. Total returned value must match entitlement, with no duplicate voucher issuance.

### J06. Pending refunds are reported as failed and made refundable again

`process-refund` accepts only `succeeded`/`successful`; it releases the reservation and marks FAILED for `pending`. Yoco explicitly documents `pending` as an accepted refund response and supports an idempotency key. See [Yoco's refund API](https://developer.yoco.com/online/api-reference/core-resources/refund-object).

The isolated current-handler reproduction returned a pending provider result: the code reserved R100, released that reservation and recorded FAILED. The webhook currently ignores refund events. An operator retry can initiate another refund while the first outcome remains unresolved. A network failure after provider submission has a different problem: the reservation can remain without durable reconciliation.

**Fix:** persist a refund operation/provider reference, retain the reservation for pending or unknown outcomes, and reconcile to success or definitive failure. Reuse a stable idempotency key for retries. Only definitive failure should restore refundable balance. Use a controlled manual reconciliation process until that lifecycle is verified.

References: [process-refund](../../supabase/functions/process-refund/index.ts), lines 193–246; [webhook event allowlist](../../supabase/functions/yoco-webhook/index.ts). This also remains an explicitly open issue in the existing rollout remediation document.

**Acceptance:** test pending, confirmed success, definitive failure, timeout and repeated requests. Customer/operator status and reserved/refunded amounts must follow the same operation.

### J07. My Bookings can announce a paid change before it has been paid

Payment polling checks only whether the booking is PAID/CONFIRMED. The original paid booking intentionally retains that status while an amendment awaits payment. The first poll can therefore announce “Payment confirmed! Your booking is updated” with the old date/guest count. The reschedule payment screen also says the reschedule is confirmed before collecting the difference.

**Fix:** poll the specific pending amendment or its expected resulting slot/quantity plus payment settlement. Say that the original booking remains unchanged until the additional payment succeeds. Preserve a visible pending/retry state if polling times out.

References: [payment polling](../../booking/app/my-bookings/page.tsx), lines 528–556; [reschedule payment copy](../../booking/app/my-bookings/RescheduleFlow.tsx), line 42; [server's deliberate pending behavior](../../supabase/functions/rebook-booking/index.ts), lines 227 onward.

**Acceptance:** create an amendment payment link and leave it unpaid. No success message appears. Complete the amendment and verify the success message accompanies the actual changed booking.

## Small customer-journey improvements worth doing today

| Priority | Problem and customer impact | Smallest useful change |
| --- | --- | --- |
| High | **Added-guest discounts are cosmetic.** The modal can show “Add Guests (Covered)” with a R500 voucher, but `submitEditGuests` sends only booking ID/action/quantity and receives a R500 payment link. [Modal](../../booking/app/my-bookings/modals/EditGuestsModal.tsx); [submitEditGuests](../../booking/app/my-bookings/page.tsx), line 685. | Remove voucher/promo inputs for this amendment until backend redemption is implemented, or complete server validation/redemption before showing the discounted price. |
| High | **Reschedule quote ignores voucher funding.** For R600 cash + R400 voucher on a R1,000 trip, a same-price move is advertised as requiring another R400, whereas the server computes zero. [RescheduleFlow](../../booking/app/my-bookings/RescheduleFlow.tsx), line 58. | Use the same funded-value calculation as the server, ideally its returned quote. Include whether cancelled credit is still unclaimed. |
| Medium | **Reservation countdown starts before reservation.** Continue to Details starts a local 15-minute timer; the actual hold is created only on Pay. Time spent entering details also makes the displayed payment deadline earlier than the real one. [Booking flow](../../booking/app/book/page.tsx), lines 517–522, 819 and 843–849. | Show the countdown only after a real hold succeeds, using its authoritative expiry. Before then, explain that availability is checked at checkout. |
| Medium | **Invalid email produces a silent Pay button.** `guest@` enables the button but fails an early return without feedback. Actual function reproduction produced no error message. [Booking flow](../../booking/app/book/page.tsx), lines 415 and 1022. | Use form validity and a specific inline email error; focus the invalid field. |
| Medium | **Payment failure/retry loses continuity.** A gateway-link failure leaves a hold behind, and the normal submit insert does not set `draftBookingId`, so retry can create another booking/hold. The payment-cancelled page's Try Again link returns to the home page. [Submit flow](../../booking/app/book/page.tsx), lines 438–447 and 541–545; [cancelled page](../../booking/app/cancelled/page.tsx). | Retain the booking identity/proof and retry checkout against that reservation. Resume the same trip/details after cancellation and offer an explicit restart. |
| Low | **Pay requires a second handoff click.** After Pay, “Finalizing Checkout” waits for “Proceed to Secure Portal.” | Navigate directly once the verified payment link is ready, retaining the visible link as a fallback. |

These are workflow corrections. A visual redesign, new dependencies and broader feature expansion are unnecessary for today's release.

## Release evidence and checks

Both administrator and storefront TypeScript checks passed with `--noEmit --incremental false`.

The latest full unit run recorded **918 passed, 3 failed, 1 skipped**. The remaining failures are source-text assertions in `claim-credit.test.ts` and `voucher-guest-reduction.test.ts` about code removed from the webhook. Updating assertions alone is insufficient: J02's replacement database operation needs a real implementation and integration tests. An earlier run had four failures; the working tree changed during the review.

The customer payment E2E test skips unless `LIVE_PAYMENT_E2E=1`, and the checked-in main-branch workflow does not set it. A green run of that job therefore does not establish a successful customer payment. Its selectors also still target older button copy, and it does not accept the current mandatory terms checkbox. See [happy-path test](../../tests/e2e/happy-path-booking.spec.ts) and [workflow](../../.github/workflows/e2e-on-main.yml).

Before release, update and explicitly run the [single-tenant MVP smoke runbook](MVP_SMOKE_RUNBOOK.md) in a provider sandbox, adding the scenarios above. Verify the exact deployed storefront, edge functions, migrations and scheduler configuration together, including the signed payment-return link. This review did not verify production availability, apply migrations, send messages, move money, run live browser E2E, or certify load capacity.

For operator onboarding, the checklist currently treats any slot as bookable and any booking as a successful first booking. Use a future OPEN slot with remaining capacity, and a paid test booking with confirmed delivery, as the practical activation milestone. [WelcomeChecklist](../../components/WelcomeChecklist.tsx), lines 136–148.

Local review artifacts, which may be removed by the operating system:

- `/private/tmp/capekayak-journey-repro.cjs`: executes current source against explicit offline fixtures. Assertions deliberately describe the reproduced failures; they should be replaced by correct-behavior regression checks during remediation.
- `/private/tmp/capekayak-journey-repro.json`: the 13 scenario results.
- `/private/tmp/capekayak-journey-unit.json`: latest complete unit-test result.

Run the isolated reproductions with `node /private/tmp/capekayak-journey-repro.cjs`.
