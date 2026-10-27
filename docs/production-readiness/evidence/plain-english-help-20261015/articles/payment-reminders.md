---
title: Payment reminders and unpaid bookings
route: /bookings
required_role: OPERATOR
---

Payment reminders are managed through actions on [Bookings](/bookings). There is no separate /payment-reminders dashboard page.

## Sending a payment reminder

Find the unpaid booking and open its action menu. **Payment Reminder** resends its existing checkout link. If that action is unavailable because no link exists, use **Payment Link** first. Verify the reported result before assuming a message was delivered.

## Deadlines and automatic reminders

Manual bookings use the payment deadline set by **Hold booking for** in New Booking. Online checkout holds have a shorter expiry. Scheduled reminder and pre-trip auto-cancel behaviour depends on the business's automation configuration; the current dashboard does not expose a separate global reminder settings page. Ask BookingTours support if that configuration needs changing.

## Letting a specific booking through

For an approved pay-on-arrival or invoice arrangement, use **Allow Without Payment** on the booking. It is excluded from reminders and automatic expiry, and its seats stay reserved. **Require Payment** restores the normal rules. This exception does not record a payment or bypass check-in eligibility; confirm the actual payment before checking in.

## Following up a failed Yoco payment

The **Payment recovery** panel on the Dashboard and Simple View lists failed booking payments reported by Yoco. **Needs payment** shows outstanding bookings. **Email payment link** sends the guest an email explaining that their payment was rejected or could not be completed, with their secure Yoco checkout link. The panel records when the email service accepts the email; this is not a delivery receipt.

The action checks availability and renews the booking's seat hold for up to 24 hours, ending at least an hour before departure. Missing contact details, unavailable seats, or expired voucher funding must be reviewed in the booking first. Cancelled and paid bookings cannot receive recovery emails.

When Yoco confirms successful payment, the booking leaves **Needs payment** and appears as **Paid** under **All outcomes**. The panel refreshes automatically; **Refresh** checks immediately. A duplicate or delayed failure event cannot turn a paid booking back into an unpaid booking.
