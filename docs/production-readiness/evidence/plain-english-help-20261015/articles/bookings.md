---
title: Bookings
route: /bookings
required_role: OPERATOR
---

The Bookings page is the master ledger of every booking, grouped by day and slot.

## Filtering and finding a booking

Use the status filter across the top: **Pending, Paid, Confirmed, Completed, Cancelled** — each shows a live count. The Pending bucket includes bookings still awaiting payment and temporary holds. Use the search box to find a booking by customer name, email, or phone. Day and slot sections expand and collapse.

## Actions on a single booking

Open a booking's action menu to:

- **Edit Booking** — change status or details. Marking a booking PAID by hand is treated as a manual payment (for example EFT or cash).
- **Rebook** — move the booking to another slot or tour. Equal-price moves can complete immediately. A more expensive slot requires payment of the difference before the move; a cheaper slot uses the available credit-voucher or refund options.
- **Refund** — start a refund for a paid booking.
- **WhatsApp** — open a conversation with the customer.
- **Resend payment link or invoice** — for unpaid bookings or when the customer lost the email.
- **Payment Reminder** — sends the existing checkout link again; send a payment link first if none exists.
- **Allow Without Payment** — keeps an unpaid reservation valid for pay on arrival and exempts it from reminders and automatic expiry. **Require Payment** restores the normal payment rules.

Open the booking's detail page to review its payment, waiver and customer notes. Marking a booking paid records money you have already received; select the actual cash, EFT, card-terminal or other payment method and add the reference where available.

## Bulk actions

Tick multiple bookings and a sticky action bar appears:

- **Check in** — for eligible paid bookings; payment and waiver checks still apply when saving arrivals.
- **Mark paid (EFT)** — only when all selected are unpaid.
- **Cancel** — when none are already cancelled.
- **Refund** — when all selected are paid.

Bulk runs show per-row progress so you can see exactly which succeeded.

## Partial arrivals and customer notes

Arrival counts record how many guests in a group are actually present. [Simple View Check-ins](/simple/check-ins) lets you increase or decrease the count without marking the whole party arrived. Correcting an arrival count does not cancel the booking or refund it. Customer notes and custom-question answers stay attached to the booking for operational reference.

## Cancelling a paid booking

Cancelling a paid booking releases the seats back to the slot and emails the customer so **they choose** how to handle it: reschedule, voucher, or full refund (managed from their My Bookings page) — the same workflow as an operator/weather cancellation.

**Within 24 hours of the trip start** the booking is forfeited instead: the customer is notified but gets no refund options. When you cancel inside that window, the confirm dialog lets you override this and still offer the reschedule/voucher/refund choice — use it for goodwill cases.

Voucher-paid bookings are the exception: cancelling one re-issues a voucher for the full amount rather than offering the three options.

## Exporting

**Export CSV** downloads the current filtered list. There are two variants: a masked export, and a sensitive export including special requests, which is limited to MAIN_ADMIN and above and writes an audit-log entry recording who exported and when.

## Returning guests

Expand a departure to see each guest's booking history. **Welcome back** shows the previous paid/completed booking date and the number of earlier paid bookings, excluding the booking being viewed. History matches saved email addresses or phone numbers within your own business. Failed, pending and cancelled bookings do not count. Returning guests also receive a welcome-back greeting in their booking confirmation email.

Configure repeat-booking, return-time and group-size offers under [Marketing → Promotions](/marketing/promotions).
