---
title: Refunds
route: /refunds
required_role: OPERATOR
---

The Refund Queue lists customer refund requests waiting for your decision, with the pending count and total value at the top.

## What appears here

Only bookings where the customer has actually requested a refund appear in the queue. Cancelled bookings where the customer hasn't yet chosen between refund, voucher, or reschedule are not in the queue — they're still deciding, and their booking shows "action required" until they pick.

## Processing a refund

For each request you can:

- **Auto Refund** — refunds the card payment automatically through Yoco. Available when the booking was paid by card online.
- **Manual** — mark the refund as processed when you've paid it outside the system (for example an EFT).
- **Decline** — declines the request; the customer is emailed. No money moves.

The amount field is editable, so you can process a **partial refund** up to the amount paid. Every destructive action asks for confirmation, and the customer is notified by WhatsApp and email when their refund completes.

## Refund All

**Refund All** processes every pending card refund in one confirmed run, one after another — useful after a weather cancellation day.

## History

Expand **Processed Refunds** to see recent completed, failed, and declined refunds.

## Where refund amounts come from

Refund amounts follow your cancellation policy tiers (configured in Settings): how much a customer gets back depends on how far before the trip they cancelled. Weather cancellations initiated by you typically entitle the customer to a full refund, voucher, or free reschedule — their choice.
