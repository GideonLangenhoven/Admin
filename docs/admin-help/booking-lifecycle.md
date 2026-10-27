---
title: How bookings work (statuses, payments, changes)
route: /bookings
required_role: OPERATOR
---

A quick reference for the booking lifecycle across the whole dashboard.

## Booking statuses

- **Held / Pending** — seats reserved, payment not yet received. Online checkouts hold seats for about 15 minutes; manual bookings hold for the duration you set (default 7 days). Unpaid holds release automatically.
- **Paid** — payment confirmed (card payment webhook, or recorded with Guest actions → Mark Paid for EFT or cash).
- **Confirmed** — confirmed to run.
- **Completed** — the trip happened.
- **Cancelled** — cancelled by you or the customer; seats returned to the slot.

## How online payment works

At checkout the customer gets a secure card-payment page. Payment confirmation arrives from the payment provider and flips the booking to PAID automatically — you don't need to do anything. If a customer pays by EFT, mark the booking paid yourself on the Bookings page.

## Rescheduling (rebooking)

Moving a booking to a different slot or tour checks availability and the price difference. A same-price move can complete immediately. For a more expensive departure, the original booking stays in place until the customer pays the extra amount. A cheaper move can require a choice between voucher credit and a refund; follow the options shown rather than assuming money has already been returned. Customers can also use My Bookings or the customer chatbot.

Last-minute prices sell unsold seats. An existing paid booking does not automatically get that discount when rescheduling.

## Guest count changes

Increasing guests on a paid booking reserves extra seats pending payment and can require new waiver information. Decreasing guests releases capacity and handles any excess value through the available voucher/refund options. An unpaid booking is repriced without returning money that was never received.

## Cancellations and refunds

Cancelling a booking releases its reserved seats. Customer cancellations follow the configured time-based policy. Operator/weather cancellation can offer eligible paid guests reschedule, voucher or refund choices. Voucher-funded value is returned as voucher credit rather than a card refund. See [Refunds](/refunds) for requested refunds and pending provider outcomes; submitting a refund is not the same as completing one.

## Customer self-service

Customers manage their own bookings at your booking site's My Bookings page, logging in with a one-time email code. They can view bookings, reschedule, and request cancellations there — those requests flow into your dashboard.
