# Simple view: SOL MAX implementation prompt

Prepared with GPT-6 Astra at xhigh, then checked against the repository by the parent agent on 2026-09-20. Intended implementation target: SOL with maximum reasoning. Select the model and reasoning setting in the runner; this document does not change them.

Everything below is the self-contained implementation instruction.

---

You are the implementation agent for BookingTours in `/Users/gideonlangenhoven/dev/capekayak`. Implement the optional Simple view specified below end to end, including the necessary shared data changes, verification, and a concise handoff.

This request authorizes local implementation, local migrations, and isolated testing. It does not authorize deployment, remote database changes, production bookings or payments, or sending messages to real customers. Finish the locally authorized work before reporting any release step that needs separate authorization.

The product decisions below are settled. Do not restart the product interview or ask the user to reconfirm them. Inspect the repository, resolve ordinary implementation choices yourself, and continue until the feature is implemented and verified as far as the available local environment permits. Ask only about a material blocker that cannot be resolved from the repository and these instructions. Do not substitute a prototype or another plan for implementation.

## 1. Working context and boundaries

This is a Next.js App Router application using React, TypeScript, and Supabase. Read applicable repository instructions, `PRODUCT.md`, and relevant implementation files before editing. Use applicable skills within this scope. Follow existing business terminology, authorization, design tokens, and testing conventions.

Operations staff work quickly on phones and shared devices. Prioritize phone usability, then tablet, then desktop. The product's character is warm, natural, and precise. Target WCAG AA. Extend the established interface without introducing a competing design system.

Inspect Git status before starting and before handing off. Preserve unrelated work, including these changes present when this prompt was prepared:

- Modified `docs/launch/ai-acquisition-system.md`.
- Modified `docs/launch/first-1000-users-lean-rollout.md`.
- Untracked `docs/production-readiness/`.

Do not revert, overwrite, stage, or absorb unrelated changes. Do not commit or publish unless separately requested. Use the repository's normal file-editing mechanisms.

Keep the implementation small and coherent. Reuse existing business logic, extracting shared pieces only where necessary to prevent inconsistent behavior. Avoid new dependencies, a generalized mode framework, and unrelated refactors.

## 2. Authoritative user decisions

1. Simple view is **optional for everyone who can use the existing app**, subject to their current permissions. It is not a new role, restricted account type, or replacement dashboard. Existing permissions, subscription restrictions, and read-only/demo protections remain effective.
2. **Every fresh normal login opens the full dashboard.** Users explicitly click **Simple view** to enter. Do not remember Simple view across sign-ins, add a preferred-mode setting, or make it the default landing page.
3. Simple view contains **Today**, **Calendar**, and a separate **Check-ins** page. A prominent **Add walk-in** action is available throughout, with a clear **Full dashboard** exit.
4. Today is organized by **departures**, chronologically. Show departure time, tour, guest counts, and availability. Expand a departure to see its bookings.
5. Calendar is **view and book**: browse scheduled departures, availability, and guest lists, and add bookings. No departure time, price, capacity, or cancellation controls in Simple view. Full-app management remains available under existing permissions.
6. Walk-ins reuse the existing booking flow. **Customer name, email, and mobile are mandatory. Both email and mobile must remain required.** The user explicitly rejected optional email.
7. Check-ins supports recording payment received at the desk: show the actual amount owed, confirm payment received and the supported payment method, use the existing payment flow, then check guests in.
8. **Partial group arrivals are required.** A six-person booking can show **4 of 6 arrived**, then **6 of 6 arrived**. Do not require individual passenger names.
9. Device priority is **phone, tablet, desktop**, in that order.

Distinguish fresh sign-in from restoring an already authenticated session. Authenticated refreshes, deep links, and internal navigation within Simple view must continue working. A normal fresh sign-in from a Simple view URL returns to the full dashboard. Preserve password setup, recovery, host/tenant checks, and special demo flows; do not add an unconditional redirect that breaks them.

## 3. Repository map and verified integration details

These paths are starting points, not an exhaustive inventory. Recheck the current code and search every affected reader and writer before choosing the implementation.

- Shell/navigation: `app/layout.tsx`, `components/AppShell.tsx`, and `components/MobileMenuDrawer.tsx`. AppShell already provides standalone chrome for `/guide`.
- Auth/business: `components/AuthGate.tsx`, `components/BusinessContext.tsx`, `app/lib/api-auth.ts`, `app/lib/admin-auth.ts`, `app/lib/operator-sections.ts`, and `proxy.ts`.
- Dashboard manifest and direct check-in writes: `app/page.tsx`.
- Booking management and actions: `app/bookings/page.tsx`, `app/lib/booking-actions.ts`.
- Walk-in form: `app/new-booking/page.tsx`; currently requires mobile and email and redirects to `/bookings` on success.
- Calendars: `app/slots/page.tsx`, `components/CalendarHeader.tsx`, `components/WeekView.tsx`, `components/DayView.tsx`, `components/BookingsMonthCalendar.tsx`, and `components/AvailabilityCalendar.tsx`.
- Availability/time/realtime: `app/lib/slot-availability.ts`, `app/lib/admin-timezone.ts`, and `app/lib/bookings-realtime.ts`.
- Guide: `app/guide/page.tsx`, `app/guide/GuideShell.tsx`, `app/guide/slot/[slotId]/page.tsx`, and `app/api/guide/check-in/route.ts`.
- Money calculations: `app/lib/report-accounting.ts`, including `amountOutstanding`, `amountReceived`, and `derivePaymentMethod`.
- Manual payment: `supabase/functions/manual-mark-paid/index.ts` and the `account_manual_booking` RPC introduced in `supabase/migrations/20260911170000_manual_booking_capacity.sql`.
- Check-in schema: `supabase/migrations/20260307100000_add_checked_in.sql` and `supabase/migrations/20260504170000_guide_pwa.sql`.
- Booking changes: `supabase/migrations/20260911180000_immediate_booking_changes.sql`; `apply_booking_change` currently resets boolean attendance when the departure changes.

Current arrival state is primarily `bookings.checked_in` plus `checked_in_at`. `slot_check_ins` records the actor, timestamp, and a unique `(booking_id, client_event_id)` for replay protection. Partial arrivals need shared persistence, not just a new screen.

There are inconsistent existing writers: the dashboard writes booleans directly; `checkInAction` checks confirmed/paid status and a signed waiver; the Guide endpoint inserts an event and then separately updates the booking. Do not copy this non-atomic sequence into the new flow. Inspect actual waiver and eligibility rules and preserve their intended enforcement; neither silently remove a required waiver guard nor invent a blanket requirement unsupported by the business rules.

Manual payment already accepts the exact methods **Cash**, **EFT**, **Card (terminal)**, and **Other**, plus an optional note. `markPaidAction` currently hardcodes EFT, so extend its inputs compatibly if reusing it. The existing server flow handles capacity, holds, settlement, logging, invoices, and notifications. Do not replace it with a direct paid-status update.

Use current CSS tokens and loaded fonts. `app/layout.tsx` currently uses Satoshi, Plus Jakarta Sans, and Geist Mono. `docs/BRAND.md` and `docs/ADMIN_REDESIGN_SPEC.md` contain older typography/specification details; do not revert the current implementation or restart an unrelated historical redesign approval process.

## 4. Recommended structure and interaction defaults

These are implementation defaults, not additional user-requested features. Adjust them when the existing architecture provides a simpler equivalent.

- Prefer `/simple` for Today, `/simple/calendar`, and `/simple/check-ins`.
- Use a small shared shell retaining authentication, business identity, and applicable restrictions while removing the full dashboard's navigation and unrelated operational panels.
- Put a clearly labeled Simple view entry in the full app where it is discoverable on phones and desktops. Full dashboard exits to `/`.
- Use three labeled navigation destinations on phones, with comfortable touch targets and a prominent Add walk-in action. Adapt the same hierarchy to tablet and desktop; do not restore the large dashboard sidebar inside Simple view.
- Prefer chronological departure rows and progressive disclosure. A small summary line is enough; do not add revenue tiles or a wall of metrics.
- On phones, calendar date selection plus a selected-day agenda is acceptable. Reuse the existing calendar pieces where suitable without forcing a wide desktop grid onto a small screen.
- Expanded bookings show customer identity, group size, payment state, and arrival count. Check-ins owns arrival editing; Today may link directly to the chosen departure's Check-ins context instead of duplicating that interface.

Use the existing theme preference and semantic tokens. Design for staff glancing at a phone in daylight or working at a reception tablet. Prioritize readable contrast, clear labels, and approximately 44px or larger touch targets. Do not communicate state by color alone. Keep keyboard focus visible and respect reduced motion.

Handle loading, empty, failure, stale-data, and pending-action states. A failed data load must not look like a day with zero bookings. Keep actions disabled when the necessary state is unknown or a mutation is in progress; surface recoverable errors without claiming success.

Out of scope: new roles, mode preferences, a second booking/payment system, offline infrastructure, individual passenger profiles, partial-payment or split-tender features, revenue reporting, refund/cancellation controls, and departure management in Simple view. Preserve existing Guide offline compatibility if touched, without extending offline behavior to the new workspace.

## 5. Today and Calendar

Define Today and date query boundaries in the active business's timezone. Reuse timezone helpers instead of browser-local midnight or UTC date substrings. Show departures in actual scheduled order.

Include relevant scheduled departures even when they have no bookings, so staff can identify availability. Full/closed/cancelled departures must be clearly distinguishable and must not offer invalid bookings. Respect existing booking cutoffs and eligibility; do not silently invent a last-minute override.

Keep bookings and guests distinct. Availability must come from the canonical capacity logic, including holds/resources where relevant, rather than subtracting the visible guest list from capacity. Inspect status semantics for pending, held, paid, confirmed, completed, cancelled, and expired records. Distinguish pending/unpaid bookings where displayed, without counting them as settled guests.

Calendar lets staff select a date, inspect its departures and booking details, and start a booking for a departure. Carry selected date/departure context into navigation. Do not simply link to the full Slots management page and call it Simple Calendar.

Refetch canonical state after mutations and use existing scoped realtime behavior where appropriate. Another device's arrival/payment/booking changes should become visible through the existing refresh mechanism. Avoid per-booking query loops, accidental row-limit truncation, cross-tenant subscriptions, and client-side counters that drift from the database.

## 6. Walk-in integration

Reuse the existing New Booking form and business logic. Use a thin route/context wrapper or a focused shared-form extraction as needed; do not copy the page into a second implementation. Keep the Simple view shell while creating a walk-in from Simple view.

From a departure, preselect tour, business-local date, and slot. From the global action, retain useful selected-day context and let staff choose the departure. Do not overwrite staff selections when data refreshes after initial prefill.

On successful creation, return to the originating Simple view page/date/departure and refresh data. Cancel/back must preserve useful context. Ordinary full-dashboard callers keep their existing `/bookings` destination.

Use validated internal return destinations, preferably a small allowlist. Treat query parameters as untrusted: supplied tenant, tour, slot, date, and return path never replace authorization, eligibility, and capacity checks.

Preserve required name, email, mobile, and existing tenant-required/custom fields. Keep pricing, add-ons, supported discounts, payment options, validation, and duplicate-submission protections working. Revalidate capacity at submission. A failure must preserve entered values and provide a useful next step.

Keep booking creation success distinct from a notification failure. Never recreate a successful booking just because a confirmation could not be sent. Use isolated fixtures for verification so tests do not contact real customers.

## 7. Shared partial-arrival model

Use the smallest shared model that provides an authoritative arrived-guest count and compatibility with existing code. A React-only counter or localStorage value is insufficient.

Maintain these invariants:

- Arrived count is an integer from zero through the booking's current guest quantity.
- Partial arrival remains explicit; `checked_in` means the whole current group has arrived.
- Legacy `checked_in=true` records migrate to their guest quantity, and false records to zero.
- Audit history remains intact. Define the meaning of `checked_in_at` for partial, full, and undone check-ins, preserving established semantics where possible.
- Moving a booking to a different departure must not carry its old attendance into the new departure.
- Increasing quantity never manufactures arrivals. A reduction below recorded arrivals must be rejected or explicitly corrected through a coherent existing workflow, never silently leave an impossible count.

Count mutation must be atomic and tenant-authorized. Use a bounded database update/transaction or equivalent existing pattern, not an unprotected browser read-modify-write. Audit insertion, event deduplication, and count changes must commit coherently.

Support concurrent devices and retries without overcounting or silently overwriting a newer count. Use a suitable idempotent delta or conflict-checked absolute update; choose one clear contract rather than building both. Return canonical count/state. Replaying the same event must not apply the change again, including after a timeout. A conflicting/stale update should refresh and explain what happened.

Resolve booking, departure, actor, business, quantity, and eligibility from trusted persisted/authenticated state. A caller-supplied departure must match the booking's actual departure. Keep RLS, server authorization, demo/read-only protections, and subscription restrictions effective for direct requests, not only UI buttons.

Inventory all relevant writers and readers: dashboard, booking list/bulk actions, Guide endpoint/client, database booking-change functions, and affected totals. Whole-booking actions should set arrived count to the current full quantity; existing undo resets it coherently to zero. Legacy booleans must not contradict counts. Dashboard and Guide headcounts must not report a partially arrived group as either wholly absent or wholly present.

Make only the compatibility changes required for this feature. Preserve Guide's existing purpose and replay contract. Include a forward migration, necessary database/type changes, and locally verified backfill and authorization behavior. Do not edit historical migrations as the deployment strategy or apply migrations remotely.

## 8. Check-ins and desk payments

Check-ins is a separate page using practical date/departure selection. Show customer/group identity, booked quantity, arrived quantity, payment state, and any existing eligibility blocker. Display **4 of 6 arrived** explicitly.

Use a simple bounded count interaction with clear save feedback, later-arrival updates, and a deliberate correction/undo. Avoid accidental repeated increments, ambiguous icon-only controls, or an individual passenger roster.

Inspect and reuse `amountOutstanding` and the established money semantics. A balance is not always the booking's headline total. Preserve existing handling of captured amounts, legacy paid records, vouchers, amendments, and refunds. Do not interpret refunded money as newly owed without an existing rule that says so.

For an unpaid booking: show the actual balance and currency, let staff choose Cash/EFT/Card (terminal)/Other and confirm receipt, then call the existing manual-payment flow. Card (terminal) records money already taken on an external terminal; it must not initiate another gateway charge. This feature records the supported full settlement, not arbitrary partial payments.

Refresh payment truth after success, then allow arrival when the established eligibility rules permit it. An already eligible paid booking has a direct arrival action. Required waivers remain enforced where applicable, with a clear explanation if they block check-in.

Do not optimistically claim payment success. On failure or an uncertain response, reconcile server state before retrying. Duplicate taps/retries must not double-book seats, duplicate settlement/invoices, or re-run avoidable financial side effects. If payment succeeds but arrival fails, retain the payment and clearly offer an arrival retry; do not charge or record payment again.

## 9. Verification and acceptance

Use existing tooling and risk-focused tests. No new test framework. Start by checking test environment targets: **`tests/e2e/helpers/auth.ts` currently mints real sessions for real accounts**. A localhost frontend alone does not make its Supabase backend safe. Use mocked-network browser fixtures and/or a confirmed isolated backend for UI tests, and a disposable local database for transaction, migration, and authorization tests. Do not blindly run mutating E2E tests against `.env.local`.

Relevant repository commands include:

```sh
npm run lint
npx tsc --noEmit
npm run test:unit
npm run build
```

Run focused browser tests with the existing Playwright setup once isolated. For database changes, extend the established disposable-local tests (`npm run test:isolation:local`, with a configured local PostgreSQL instance) or equivalent focused local coverage. Run applicable edge-function/security checks if those surfaces change. Fix failures introduced by this work and distinguish unrelated baseline failures. Never report an unexecuted check as passed.

Acceptance must cover:

1. Fresh login opens the full dashboard even after prior Simple view use; explicit entry, authenticated refresh, deep links, normal navigation, and exit work.
2. Existing permissions, business isolation, read-only/demo behavior, and subscription restrictions remain effective.
3. Today handles the business timezone, chronological departures, zero-booking departures, accurate capacity, and meaningful status distinctions.
4. Calendar supports viewing and booking with no departure-management controls; full-app management still works.
5. Departure-launched walk-ins preserve selections and return context. Missing name, email, or mobile blocks creation. Existing full-app booking flows remain compatible.
6. Desk payment displays the real balance, records the selected supported method through existing logic, and handles duplicate taps, uncertain responses, and payment-success/check-in-failure independently.
7. A six-person booking progresses 0 → 4 → 6, remains consistent across pages/devices, and supports correction without an invented passenger roster.
8. Negative, fractional, excessive, duplicate, stale, unauthorized, and cross-tenant arrival mutations fail or reconcile correctly. Concurrent requests cannot lose updates or exceed quantity.
9. Backfill, full-booking/undo actions, Guide replay, slot moves, quantity changes, and aggregate guest counts remain consistent.

Visually inspect representative phone (about 390px), tablet portrait/landscape (about 768px/1024px), and desktop (about 1440px) layouts. Check expanded departures, long customer/tour names, payment/count controls, empty and error states, keyboard focus, touch targets, and booking return navigation. No horizontal overflow, obscured content behind sticky navigation, or unreachable controls when a phone keyboard is open. Capture useful screenshots where tooling permits.

## 10. Delivery

Complete the working local implementation, not just static screens. Finish with:

- What changed and where the operator enters Simple view.
- The shared attendance model and compatibility decisions.
- Migration files and any release-order requirements for later deployment.
- Tests and visual checks actually performed, with outcomes.
- Concrete remaining blockers or limitations, if any, and useful file links.

State clearly if local infrastructure prevented a required check. Do not claim production deployment, production validation, or successful tests that did not occur. Keep the final handoff concise and leave unrelated work intact.
