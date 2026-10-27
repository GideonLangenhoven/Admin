---
title: Payment reminders and unpaid bookings
route: /bookings
required_role: OPERATOR
---

Payment reminders are managed through actions on [Bookings](/bookings). There is no separate /payment-reminders dashboard page.

## Sending a payment reminder

Find the unpaid booking and open its action menu. **Payment Reminder** resends its existing checkout link. If that action is unavailable because no link exists, use **Payment Link** first. Verify the reported result before assuming a message was delivered.

## Deadlines and automatic reminders

Manual bookings use **Payment due within** in New Booking, which defaults to seven days and is shortened when departure is sooner. Payment emails include the exact due date and time. For payment windows longer than 24 hours, an automatic email warns the guest 24 hours before the deadline that their payment link will expire, provided payment remains outstanding. Paid, cancelled and approved pay-on-arrival bookings are excluded.

Online checkout holds have a shorter expiry. Other scheduled reminders and pre-trip auto-cancel behaviour depend on the business's automation configuration; the current dashboard does not expose a separate global reminder settings page. Ask BookingTours support if that configuration needs changing.

## Letting a specific booking through

For an approved pay-on-arrival or invoice arrangement, use **Allow Without Payment** on the booking. It is excluded from reminders and automatic expiry, and its seats stay reserved. **Require Payment** restores the normal rules. This exception does not record a payment or bypass check-in eligibility; confirm the actual payment before checking in.

## Following up an unpaid booking

The **Payment recovery** panel on the Dashboard and Simple View lists bookings with an outstanding balance, including manually created bookings, confirmed bookings with money still due, unfinished checkouts and failed Yoco payments. Only bookings needing payment appear, with their remaining amount due. **Email payment link** sends the guest their existing secure Yoco checkout link. A failed-payment explanation is included only when a payment failure was recorded. The panel records when the email service accepts the email; this is not a delivery receipt.

On the Dashboard, Payment recovery is just above Weather. Bookings are ordered by departure, with the nearest upcoming trips first and past trips afterwards. Each date and trip can be expanded or collapsed; the trip heading shows its departure time in the operator's timezone. **Previous** and **Next** move through the bookings when there is more than one page.

The action checks availability and preserves a manual booking's existing future deadline. When a new deadline is needed, manual bookings get up to seven days and online bookings up to 24 hours, ending at least an hour before departure. Confirmed bookings retain their existing reserved places. Missing contact details, missing payment links, unavailable seats, or expired voucher funding must be reviewed in the booking first. Part-paid bookings show the remaining balance but require review in the booking before sending a payment link, so an existing full-amount link is not resent. Cancelled and paid bookings cannot receive recovery emails.

When Yoco confirms successful payment, the booking leaves **Payment recovery**; its payment status remains available in **Bookings**. The panel refreshes automatically; **Refresh** checks immediately. A duplicate or delayed failure event cannot turn a paid booking back into an unpaid booking.
