---
title: Refunds
route: /refunds
required_role: OPERATOR
---

The Refund Queue lists customer refund requests waiting for your decision, with the pending count and total value at the top.

## What appears here

The queue includes requested refunds, failed attempts, pending provider refunds and refunds requiring a bank transfer. A cancellation awaiting the customer's choice of refund, voucher or reschedule is not yet a refund request. That booking remains action required until they choose.

## Refund percentages

The refund for a guest's cancellation depends on how long before the trip they cancel. The tiers are set in **Settings → Booking Site Configuration → Cancellation Policy**: each tier is a number of hours before the trip and the percentage refunded, and the highest tier the guest still qualifies for applies. When you cancel for weather, the tiers don't apply: guests can choose a new date, a voucher or a full refund.

## Processing a refund

For each request you can:

- **Submit refund** submits the eligible refundable card amount to Yoco. Submission can leave the booking **Refund pending**; it does not mean the customer has already received money.
- **Check status** reconciles an already pending refund with the provider. Use this to check the existing attempt rather than submitting another refund.
- **Confirm bank transfer** records a transfer you have already made outside BookingTours. It appears when a manual refund is required. Transfer and verify the money before confirming; this button does not move money from your bank.
- **Decline** rejects a requested or failed refund and notifies the customer by email. It is unavailable while a provider refund is pending or a bank transfer awaits confirmation.

Before submission, the **Refund amount** field allows a partial refund within the remaining captured balance. Pending refunds and manual-transfer confirmations have locked amounts. Review the confirmation and the returned outcome: completed, pending, manual action required, failed, unknown or not submitted. An unknown result needs reconciliation before retrying.

## Submitting the queue

**Submit All** attempts queued refunds one at a time and records the result of each. Keep the page open until submission finishes. Card refunds can remain pending and bank transfers still need manual handling. Leaving the page or changing operator stops further submissions; a batch is not proof that every refund completed.

## History

Expand **Processed Refunds** to see recent completed, failed, and declined refunds.

## Where refund amounts come from

Refund amounts follow the configured cancellation tiers and remaining captured balance. Weather cancellation offers eligible paid guests a full refund, voucher or reschedule; the guest chooses first. Voucher-funded amounts return as voucher credit rather than a card refund. Mixed payments are handled according to their paid portions.
