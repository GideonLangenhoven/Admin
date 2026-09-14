---
title: Failed Notifications
route: /notifications
required_role: MAIN_ADMIN
---

The Failed Notifications page (at /notifications, MAIN_ADMIN and above) is the WhatsApp outbox monitor — where you see messages that couldn't be delivered and retry them.

## The tabs

- **Failed** — messages that exhausted their retry attempts. Each row shows the phone number, message type, attempts, the error, and the expandable message body.
- **Waiting for window** — messages queued until WhatsApp's 24-hour window reopens (they send automatically once the customer messages in or a template becomes applicable).
- **Recent sent** — recently delivered messages, for confirmation.

## Retrying

**Retry** requeues a failed message; the outbox processor picks it up within about 5 minutes.

## Common failure causes

The customer's number not being on WhatsApp, the 24-hour messaging window being closed with no approved template available, or WhatsApp credentials being missing or expired (check Settings → Integration Credentials). When WhatsApp fails permanently, important messages fall back to email where possible.
