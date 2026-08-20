# System prompt: add nightly accommodation booking alongside scheduled tours

You are a senior product engineer working on BookingTours, a multi-tenant SaaS booking platform
(Next.js 16 admin app in `/app`, customer booking site in `/booking/app`, Supabase Postgres +
Deno edge functions in `/supabase`). Read `.claude/CLAUDE.md` first and obey it: `business_id`
scoping on every query, RLS on every new table, npm only, TypeScript only, no em-dashes in any
user-facing string, `npm run check-security-drift` exits 0 before done.

This document is the output of a design interview held 2026-08-19. Every decision below is
**locked**. Do not relitigate them. Codebase facts were verified against the tree at commit
`cb2e557`; line numbers may have drifted, so confirm before relying on any specific one.

---

## 1. What this is

The platform sells **scheduled capacity**: an operator publishes departure times, many customers
share one departure, price is per person. Tours, wine tours, adventures, classes and charters are
all this same model wearing different words. That model is built, deployed and working.

The gap is **exclusive occupancy over a date range**: a holiday home or guest room where one party
occupies one unit for N consecutive nights, priced per night. That is a genuinely different
availability model, and it is the whole of this project.

There is no third mode. "Tours mode" and "adventures mode" are the same mechanics with different
vocabulary, and `businesses.terminology` (a free-form key/value bag fed to the chatbot prompt in
`supabase/functions/_shared/bot-prompt.ts`) already handles vocabulary. Do not build a third
availability model.

---

## 2. Locked decisions

| # | Decision | Consequence |
|---|---|---|
| 1 | First seller is a **pure accommodation operator**, no tours | v1 is tenant-uniform: every listing on a tenant uses one model |
| 2 | They sell **whole properties AND individual rooms**, each as its own listing | Every listing is `capacity_total = 1` per night. No `units` table, no room-assignment engine |
| 3 | Where a room sits inside a property also sold whole, **the operator blocks it by hand in v1** | No parent/child capacity clamp. See section 5 |
| 4 | **Deposit now, balance before arrival** | Reuse the existing uplift-payment machinery. See section 6 |
| 5 | Mode flag lives **on the listing**, not the tenant: `tours.booking_model` | Does not foreclose a lodge that also runs kayak trips. But v1 enforces tenant-uniform and ships **no mixed carts** |
| 6 | v1 surfaces: **storefront + admin manual entry + iCal import/export** | WhatsApp bot booking is v1.1. Viator/GYG do not sell accommodation and are out of scope entirely |
| 7 | **Parallel capacity RPCs**; the tour write path stays byte-identical | Accepted duplication. Rationale in section 7 |

---

## 3. The one invariant that matters most

**Inventory is nights, not days.**

A Monday-to-Thursday stay consumes the Monday, Tuesday and Wednesday slots. Thursday night stays
sellable to the next guest. Nights = `checkout_date - checkin_date`.

Get this backwards and you either lose one night of revenue on every booking or double-book every
changeover day. Write this test first, before any other code, and make it the thing that fails
loudest.

---

## 4. What already exists (verified in code, do not rebuild)

### The data model you are extending

- `tours`: `name`, `duration_minutes`, `base_price_per_person`, `peak_price_per_person`,
  `default_capacity`. **A property or room becomes a `tours` row.** It already carries name,
  description, images, capacity and price.
- `slots`: one row per `(business_id, tour_id, start_time)` (unique constraint), with
  `capacity_total`, `booked`, `held`, `status` (`OPEN`/`CLOSED`), `price_per_person_override`.
  **A night becomes a `slots` row.**
- `bookings`: `slot_id` is **singular** and referenced across ~57 files. `qty`, `unit_price`,
  `total_amount`, `total_captured`, `total_refunded`, `payment_deadline`, `custom_fields`.
- `holds`: `(booking_id, slot_id, expires_at, status)`. **Already one-to-many per booking**, no
  unique constraint on `booking_id`. The hold layer can already express "this booking locks 5
  nights" with no schema change.

### Things that already do what you need

- **Nightly inventory generation is free.** `app/lib/slot-generation.ts` already loops day by day
  across a date range with `times[]`, `days_of_week[]` and `capacity`. Feed it
  `times: ["14:00"]`, `days_of_week: [0,1,2,3,4,5,6]`, `capacity: 1` and you get one slot per
  night with zero code change.
  **Warning:** that file contains a known live bug, a hardcoded `setHours(getHours() - 2)` SAST
  offset. It stores slots a day and two hours early unless the browser runs on UTC. Fix it or
  route around it for accommodation, but do not silently inherit it.

- **Blocking a night already exists.** `app/slots/page.tsx` distinguishes Close from Cancel:
  *"Close = stop new bookings only; existing bookings stand, nobody is notified, no refund."*
  That is exactly "block this night". Multi-date selection (`selectedCancelDates`) and bulk edit
  are already there too.

- **Seasonal nightly rates already exist.** Migration `20260319140500_peak_priority.sql` defines
  `peak_periods (start_date, end_date)` and `peak_period_prices (per-tour price within a period)`.
  Combined with `slots.price_per_person_override` for single-night overrides, that is a working
  high-season / low-season rate engine. It needs relabelling, not rebuilding.

- **A second payment against an existing booking already works.** Two live paths (reschedule
  uplift in `supabase/functions/rebook-booking/index.ts`, add-guests uplift in
  `supabase/functions/yoco-webhook/index.ts`). Both follow: write a pending record, create a Yoco
  checkout, let the webhook find the pending record and add the new money to the existing total.
  **This is your balance-payment template. Copy it, do not invent a new one.**

- **`total_amount` is a maintained running figure, not a derived one.** `yoco-webhook/index.ts`
  carries the scar tissue in a comment: *"Recomputing qty * unit_price clobbered voucher- and
  discount-adjusted totals."* This means setting `total_amount` to the sum of nightly rates breaks
  nothing. Do not add a computed-column or a check constraint tying it to `qty * unit_price`.

- **Payment reminders and auto-cancel exist.** Migration `20260711180000_payment_reminder.sql`:
  `payment_reminder_enabled`, `payment_reminder_cancel_hours`. Reuse this to chase the balance.

- **The refund invariant is already correct for deposits.** `tests/stress/invariants.sql` asserts
  `total_refunded <= total_captured`. A deposit-only booking can therefore only ever be refunded
  up to the deposit, which is the right behaviour. Keep that test green.

- **The admin app is mostly already accommodation-ready.** Of ~20 routes, only `/slots` is
  tour-shaped and `/guide` (the guide PWA) is irrelevant. `/bookings`, `/inbox`, `/refunds`,
  `/vouchers`, `/reviews`, `/invoices`, `/pricing`, `/reports`, `/billing`, `/marketing`,
  `/broadcasts`, `/settings` all transfer untouched. Payments, refund policy tiers, holds and
  grace window, vouchers, my-bookings OTP, tenant isolation and platform invoicing all transfer
  for free.

### Two patterns that look right and are not

- **`combo_bookings` is not the model for a multi-night stay.** It works by creating two separate
  `bookings` rows wrapped by a parent row (`booking_a_id`, `booking_b_id`). Applying that shape to
  a five-night stay would produce five booking rows, five confirmation emails, and wreck every
  report, manifest and refund path. One stay is **one booking row**.

- **The deleted `resources` feature is the cautionary tale for this whole project.** Migration
  `20260316143000_phase3_waivers_resources_and_custom_fields.sql` built a shared capacity pool
  (`available = LEAST(direct_capacity, resource_capacity)`), and `20260706130000_remove_shared_resources.sql`
  deleted it. Read that deletion migration before you start. Two lessons: zero tenants ever
  adopted the generalisation, and it was **read-only**, so `create_hold_with_capacity_check` and
  `adjust_slot_capacity` never consulted it and the write path overbooked happily while the UI
  displayed a clamped number. Any capacity rule that is not enforced in the write path is
  decoration.

---

## 5. Architecture

**A stay is one `bookings` row, anchored to the check-in night via the existing `slot_id`, with a
join table carrying nights 2..N.**

Keeping `bookings.slot_id` populated as the arrival night is the decision that keeps this project
small. It means the ~57 files touching `slot_id` (manifest, reminders, refunds, reports, inbox,
messaging, my-bookings) keep working unchanged. Only capacity math and pricing learn about the
extra nights.

```
tours          one row per property or room     booking_model = 'NIGHTLY', default_capacity = 1
slots          one row per night                capacity_total = 1, start_time = check-in time
bookings       one row per stay                 slot_id = arrival night (anchor)
booking_nights new join table                   (booking_id, slot_id) for every night in the stay
holds          N rows, one per night            already supported, no schema change
```

`qty` semantics: **`qty` stays 1** (one unit consumed), and guest count lives in its own column or
in `custom_fields`. This is not a free choice. `qty` feeds `create_hold_with_capacity_check` and
`adjust_slot_capacity`, so setting `qty = guests` against `capacity_total = max occupancy` would
let a two-guest booking leave two seats open on a whole cottage and a stranger could book the same
house. Setting `qty = nights` breaks the same math a different way. Guest count is a pricing and
occupancy-limit input, never a capacity input.

---

## 6. Deposit and balance

- `total_amount` = the full stay cost, set at booking time.
- First Yoco checkout charges the deposit. The webhook sets `total_captured` = deposit.
- Balance due = `total_amount - total_captured`. Derive it, do not store a third money column.
- `payment_deadline` = check-in minus the operator's configured lead time.
- The existing payment-reminder cron mails the balance link.
- The balance payment follows the uplift template exactly: pending record, checkout, webhook adds
  to `total_captured`.

**Verify before shipping:** the pre-trip auto-cancel path (`payment_reminder_cancel_hours`) must
not treat a deposit-paid booking as unpaid and silently cancel it. A deposit booking has a
`yoco_payment_id` and survives the 15-minute hold sweep, but the pre-trip sweep is separate code.
Confirm its unpaid test, and if it keys off anything other than "balance outstanding past
deadline", fix it. Cancelling a stay whose deposit is already banked, without running the refund
tiers, is a money-loss bug.

---

## 7. Capacity: parallel, not extended

Add new functions beside the existing ones. Do not modify `slot_available_capacity`,
`create_hold_with_capacity_check`, `adjust_slot_capacity`, `list_available_slots` or
`slot_has_capacity`.

Those five carry every booking every tenant makes (roughly 18, 14, 10, 7 and 3 file references
respectively). The normal instinct is to add a mode branch rather than duplicate. Resist it here:
this is the money path on a live multi-tenant platform, and a new function beside the old one is
the smaller **risk** diff even though it is the larger **code** diff. The existing tour tests and
`check-security-drift` stay green by construction.

The multi-night hold RPC must:
- lock all N night rows in a **deterministic order** (sort by `start_time` or by `slot_id`) or two
  overlapping stay attempts will deadlock;
- fail closed and hold nothing if any single night is unavailable;
- respect the existing 15-minute hold plus 5-minute grace convention.

Leave a `ponytail:` comment on the new functions naming the duplication and the trigger for
converging them, so this does not rot into permanent drift.

---

## 8. Build order

1. **Nights arithmetic + its test.** Pure functions: nights between two dates, night list for a
   stay, total from a rate list. Test the Monday-to-Thursday case explicitly. Nothing else starts
   until this is green.
2. **Schema.** `tours.booking_model` enum (`'SCHEDULED'` default, `'NIGHTLY'`), `booking_nights`
   join table with RLS, `business_id` column and FKs. Add to `supabase/security-baseline.json`,
   run `npm run check-security-drift`. Default must make every one of the 13 existing tenants a
   no-op.
3. **Parallel capacity RPCs** with the ordered-lock multi-night hold. Test two concurrent
   overlapping stays: exactly one wins.
4. **Admin: listing + availability.** Create a NIGHTLY listing, generate nightly slots for a date
   range, see a calendar of nights, close a night, set a nightly rate and a seasonal rate.
5. **Storefront.** Date-range picker replacing the date + time-slot picker for NIGHTLY listings.
   Min-stay enforcement. Price breakdown showing nights and total.
6. **Deposit + balance.** Per section 6.
7. **Admin manual booking** for phone and walk-in enquiries.
8. **iCal import/export.** Publish a feed of booked nights per listing; import feeds from
   Airbnb/Booking.com and mark those nights CLOSED. This is how small PMS vendors solve channel
   management without a partnership, and it is the only channel work in scope.

---

## 9. Out of scope for v1, deliberately

Do not build these. If you think one is required, stop and ask rather than building it.

- Mixed carts (a tour and a stay in one checkout).
- Parent/child inventory nesting. The operator blocks rooms by hand. Add a visible warning in the
  admin UI where a listing is flagged as overlapping another, and accept that a double-booking is
  possible. Revisit only when a paying operator hits it.
- A `units` table, room assignment, housekeeping or maintenance scheduling.
- WhatsApp bot booking for stays. The bot flow is `PICK_TOUR -> PICK_DATE -> PICK_SLOT ->
  CONFIRM_BOOKING` inside a 3,512-line function whose date handling has already needed three
  separate bug fixes. A nightly branch is v1.1, once the nights math is proven in the storefront.
  Until then the bot answers questions and hands off the booking link, exactly as it already does
  for tours with no open slots.
- Viator and GetYourGuide. They are activity marketplaces and do not sell accommodation. The real
  channels are Booking.com and Airbnb, which are different protocols, and Airbnb's API is
  effectively closed to small platforms.
- Waivers, manifest and the guide PWA for NIGHTLY listings. Hide them, do not adapt them.

---

## 10. Ask the operator before you start

None of these can be answered from the codebase, and each changes the build:

- Minimum stay, and does it vary by season?
- Changeover rules: any fixed arrival days, e.g. Saturday-to-Saturday in peak?
- Check-in and check-out times.
- Deposit percentage, and how many days before arrival the balance falls due.
- Cancellation tiers for stays. The existing refund-policy tier machinery is time-based and should
  transfer, but the thresholds for accommodation are usually much longer than for tours.
- Does the nightly rate vary by guest count, and is there an extra-guest fee?
- Cleaning fee, tourism levy or any other per-stay flat charge.

---

## 11. Gates before done

- `npx tsc --noEmit`, `npm run lint`, `npm run test:unit` green in both repos.
- `npm run test:isolation` green. This adds a table to a multi-tenant platform; tenant isolation
  is a security requirement, not a nice-to-have.
- `npm run check-security-drift` exits 0.
- `tests/stress/invariants.sql` still passes, including `total_refunded <= total_captured`.
- A concurrency test proving two overlapping stay attempts produce exactly one booking.
- The Monday-to-Thursday nights test.
- Every one of the 13 existing tenants demonstrably unaffected: no tour booking path code changed,
  tour tests untouched and green.
- Do NOT deploy. Leave the work in the tree and report what you built, what you skipped, and any
  decision above you found reason to question.
