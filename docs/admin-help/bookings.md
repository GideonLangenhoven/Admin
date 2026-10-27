---
title: Bookings
route: /bookings
required_role: OPERATOR
---

The Bookings page is the master ledger of every booking, grouped by day and slot.

## Filtering and finding a booking

**Today** shows only today’s bookings in the business timezone. **Day** shows the selected date; **Week** shows Monday through Sunday for that date. Use the arrows to move by a day or a week. The month filter still shows a full month, and selecting a calendar date returns to Day.

Use the status filter across the top: **Pending, Paid, Confirmed, Completed, Cancelled** — each shows a live count. The Pending bucket includes bookings still awaiting payment and temporary holds. Use the search box to find a booking by customer name, email, or phone. Day and slot sections expand and collapse.

## Actions on a single booking

Open a booking's action menu to:

- **Edit**: correct guest and reservation details. Edit has no status or payment fields; those change through the other guest actions.
- **Mark Paid**: record money received outside online checkout, such as cash, EFT or a card machine.
- **Rebook** — move the booking to another slot or tour. Equal-price moves can complete immediately. A more expensive slot requires payment of the difference before the move; a cheaper slot uses the available credit-voucher or refund options.
- **Refund** — start a refund for a paid booking.
- **WhatsApp** — compose a message through the business messaging service.
- **WhatsApp on device** — copy the guest’s international phone number and open a chat in WhatsApp on your device. Write and send the message there. If clipboard access is blocked, the number is shown so you can copy it manually.
- **Resend payment link or invoice** — for unpaid bookings or when the customer lost the email.
- **Payment Reminder** — sends the existing checkout link again; send a payment link first if none exists.
- **Allow Without Payment** — keeps an unpaid reservation valid for pay on arrival and exempts it from reminders and automatic expiry. **Require Payment** restores the normal payment rules.

Choose **View** (or **View booking** on mobile) to review the booking source, payment, waiver and customer notes. Reference numbers and booking sources are hidden from the Bookings list. To record money you have already received, use **Guest actions → Mark Paid**, described below.

## Recording a cash, EFT or card-machine payment

Open the booking's **Guest actions → Mark Paid**. Enter the amount received, choose the method (Cash, EFT (bank transfer), Card machine or Other), add the receipt or bank reference, and save. Record only money you have actually received. An amount below the balance is saved as a part-payment and leaves the rest due.

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

Open [Reports](/reports) for reports and exports. The Bookings page has no Export control.

## Returning guests

Expand a departure to see its guests. A small number to the left of a returning guest's name counts their earlier paid bookings, excluding the booking being viewed. Hover over the number, focus it with the keyboard, or tap it to see the count and latest previous paid/completed booking date. Guests with no earlier paid bookings have no number or history label. History matches saved email addresses or phone numbers within your own business. Failed, pending and cancelled bookings do not count. Returning guests also receive a welcome-back greeting in their booking confirmation email.

Configure repeat-booking, return-time and group-size offers under [Marketing → Promotions](/marketing/promotions).
