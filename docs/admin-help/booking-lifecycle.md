---
title: How bookings work (statuses, payments, changes)
route: /bookings
required_role: OPERATOR
---

A quick reference for the booking lifecycle across the whole dashboard.

## Booking statuses

- **Held / Pending** — seats reserved, payment not yet received. Online checkouts hold seats for about 15 minutes; manual bookings hold for the duration you set (default 24 hours). Unpaid holds release automatically.
- **Paid** — payment confirmed (card payment webhook, or marked paid manually for EFT/cash).
- **Confirmed** — confirmed to run.
- **Completed** — the trip happened.
- **Cancelled** — cancelled by you or the customer; seats returned to the slot.

## How online payment works

At checkout the customer gets a secure card-payment page. Payment confirmation arrives from the payment provider and flips the booking to PAID automatically — you don't need to do anything. If a customer pays by EFT, mark the booking paid yourself on the Bookings page.

## Rescheduling (rebooking)

Moving a booking to a different slot or tour handles money automatically: same price swaps immediately; a more expensive slot asks the customer to pay the difference before the move; a cheaper slot refunds the difference. Customers can also reschedule themselves from their My Bookings page or by chatting with the assistant.

## Guest count changes

Increasing guests on a paid booking requires paying for the extra seats (and re-signing waivers where applicable); decreasing refunds the difference and returns capacity to the slot.

## Cancellations and refunds

When a booking is cancelled, the seats always go back to the slot. What the customer gets back follows your cancellation policy's time-based tiers — unless it's a weather cancellation you initiated, in which case they choose between reschedule, voucher, or refund. Refund requests land in the Refund Queue for your decision.

## Customer self-service

Customers manage their own bookings at your booking site's My Bookings page, logging in with a one-time email code. They can view bookings, reschedule, and request cancellations there — those requests flow into your dashboard.
