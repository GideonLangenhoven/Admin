---
title: Slots
route: /slots
required_role: OPERATOR
---

Slots are your bookable departures: a tour at a time on a date with a capacity and price. Customers can only book where an OPEN slot exists.

## Creating slots

Open [Slots](/slots) and choose **Add Slot**. The **Add New Slots** dialog asks for the tour, start time, one or more date ranges, capacity and an optional price override. Blank price uses the tour default. Existing departures at the same tour and time are skipped rather than duplicated.

For repeating schedules choose **Bulk Generate**: select one or more tours, date ranges, departure times, weekdays and capacity. Review the per-tour overrides and preview before generating. Results show created slots, skipped duplicates and errors for each tour.

Generating slots adds missing departures. Changing the weekday selection does not close or remove departures that were generated earlier.

## Calendar views

Switch between **Week** and **Day**, use the arrows or date picker, or choose **Month** to open the monthly booking overview. Month helps you jump to a date; slot editing happens in the day or week calendar.

## Editing a slot

The **Edit Slot** modal changes time, capacity, or price. It deliberately does not change status — opening, closing, and cancelling are separate actions so a price edit can never accidentally cancel a departure.

## Open, close, cancel — the difference

- **Close** — stops new bookings but keeps existing ones. Use when a departure is full enough or you want to pause sales.
- **Reopen** — makes a closed slot bookable again.
- **Cancel & notify** or **Weather cancel** in a slot's dialog cancels its active bookings and sends cancellation notices. Weather cancellation gives eligible paid guests reschedule, voucher or full-refund choices even at short notice. Refunds are not automatically completed by cancellation.
- **Cancel Day(s)** applies weather cancellation across selected dates. Select the date headers in the calendar first, then review the confirmation and choose **Cancel Everything**.
- **Reopen Day(s)** opens closed departures on selected dates for new bookings. Reopening a departure does not restore previously cancelled bookings.

Cancelling a whole departure or selected days uses the main-admin cancellation service and requires MAIN_ADMIN or SUPER_ADMIN. Operations staff should ask their main admin to perform it. Closing sales and editing a slot are separate actions.

## Bulk edit

Choose **Bulk Edit** to open **Bulk Edit Slots**. Apply a new capacity, price and/or time across a date range for one tour or all tours. Blank fields keep their existing values; enter **NULL** in the price field to reset to the tour default. Editing time, capacity or price does not cancel bookings.

To make existing availability **weekends only**, choose the tour (or **All Tours**) and the date range, then choose **Close weekday slots**. Review the number of future Monday–Friday slots and confirm. Weekdays use the operator's timezone. Saturday and Sunday slots, existing bookings and holds are preserved; this does not cancel trips, refund payments or message guests. The capacity, price and time fields are ignored by this action. For future slot generation, select only Saturday and Sunday.

## Hidden slots

By default, CLOSED and zero-capacity slots are hidden from the list. Use the "Show closed / 0-capacity" toggle to reveal them.

## Peak pricing on slots

Slots carry peak flags and price overrides that are managed from the Peak Pricing page — a slot inside an active peak period shows its peak price automatically.
