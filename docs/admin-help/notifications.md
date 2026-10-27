---
title: Failed Notifications
route: /notifications
required_role: MAIN_ADMIN
---

Open [Broadcasts](/broadcasts), then the **Failed Notifications** tab at /notifications. MAIN_ADMIN and SUPER_ADMIN can inspect both WhatsApp outbox messages and transactional email jobs here.

## The tabs

- **Failed** — failed or expired messages. Each row shows the destination, channel, message type, attempts, error and expandable message body.
- **Waiting for window** — messages queued until WhatsApp's 24-hour window reopens (they send automatically once the customer messages in or a template becomes applicable).
- **Recent sent** — recently delivered messages, for confirmation.

## Retrying

**Retry** attempts WhatsApp delivery immediately. If the service window is closed, the message stays queued until the customer messages again. Email retries are queued for the next notification worker run. Check whether the result says sent, queued or failed instead of assuming every retry delivered immediately.

## Common failure causes

The customer's number not being on WhatsApp, the 24-hour messaging window being closed with no approved template available, or WhatsApp credentials being missing or expired (check Settings → Integration Credentials). When WhatsApp fails permanently, important messages fall back to email where possible.
