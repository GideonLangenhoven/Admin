---
title: Slots
route: /slots
required_role: OPERATOR
---

Slots are your bookable departures: a tour at a time on a date with a capacity and price. Customers can only book where an OPEN slot exists.

## Creating slots

Use **Add New Slots**: pick the tour, start time, a date range, capacity, and price — one OPEN slot is generated per day in the range. For repeating schedules, create in ranges (for example the whole month).

## Editing a slot

The **Edit Slot** modal changes time, capacity, or price. It deliberately does not change status — opening, closing, and cancelling are separate actions so a price edit can never accidentally cancel a departure.

## Open, close, cancel — the difference

- **Close** — stops new bookings but keeps existing ones. Use when a departure is full enough or you want to pause sales.
- **Reopen** — makes a closed slot bookable again.
- **Cancel Day(s)** — cancels departures entirely: capacity is released, affected customers are notified automatically and offered reschedule / voucher / refund. Use this for weather cancellations. You can cancel multiple days at once and reopen them later with **Reopen Day(s)**.

## Bulk edit

**Bulk Edit Slots** applies a new capacity, price, and/or time across a date range for one tour or all tours at once — the fast way to re-price a season or shift winter departure times.

## Hidden slots

By default, CLOSED and zero-capacity slots are hidden from the list. Use the "Show closed / 0-capacity" toggle to reveal them.

## Peak pricing on slots

Slots carry peak flags and price overrides that are managed from the Peak Pricing page — a slot inside an active peak period shows its peak price automatically.
