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
- **Rebook** — move the booking to another slot or tour. Equal-price moves swap instantly; a more expensive slot requires the customer to pay the difference first; a cheaper slot triggers a refund of the difference.
- **Refund** — start a refund for a paid booking.
- **WhatsApp** — open a conversation with the customer.
- **Resend payment link or invoice** — for unpaid bookings or when the customer lost the email.

## Bulk actions

Tick multiple bookings and a sticky action bar appears:

- **Check in** — only available when all selected bookings are paid.
- **Mark paid (EFT)** — only when all selected are unpaid.
- **Cancel** — when none are already cancelled.
- **Refund** — when all selected are paid.

Bulk runs show per-row progress so you can see exactly which succeeded.

## Cancelling a paid booking

Cancelling a paid booking releases the seats back to the slot and starts the refund flow according to your cancellation policy — the customer may be offered a refund, a voucher, or a reschedule depending on how close to departure it is. Refund amounts follow the time-based tiers configured in Settings.

## Exporting

**Export CSV** downloads the current filtered list. There are two variants: a masked export, and a sensitive export including special requests, which is limited to MAIN_ADMIN and above and writes an audit-log entry recording who exported and when.
