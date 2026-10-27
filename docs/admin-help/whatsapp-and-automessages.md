---
title: WhatsApp and automatic messages
route: /inbox
required_role: OPERATOR
---

BookingTours messages your customers automatically at the right moments — this explains what goes out, when, and the WhatsApp rules that govern it.

## What's sent automatically

- **Booking confirmation** — on successful payment, with the invoice.
- **Payment link follow-up** — if an online checkout was started but not paid, the customer is emailed their payment link after the hold lapses.
- **Trip reminders** — before the trip, WhatsApp-first with waiver links bundled where applicable, falling back to email.
- **Review requests** — after the trip.
- **Cancellation notices** — when you cancel slots (weather or otherwise), with self-service reschedule/voucher/refund options.

Automatic jobs track sent messages and retries to avoid duplicate scheduled delivery. A queued job or successful submission is not proof of delivery; failed WhatsApp and transactional email jobs can be inspected in [Broadcasts → Failed Notifications](/notifications) by a main admin. Trip timing uses your business timezone.

## The WhatsApp 24-hour rule

WhatsApp allows free-form business messages only within 24 hours of the customer's last message. Outside that window, only pre-approved templates can be sent; other messages queue as "waiting for window" and send once the customer messages in. This is a WhatsApp platform rule that applies to every business.

## The WhatsApp bot

The AI assistant can answer customer WhatsApp messages automatically — controlled by the WhatsApp Bot Mode section in Settings (always, outside business hours, or never). Conversations the bot can't handle land in your Inbox marked as needing a reply.

## When WhatsApp fails

The Failed Notifications tab under Broadcasts tracks WhatsApp failures and transactional email jobs. Important workflows can fall back to email where configured and valid contact details exist. Review the returned outcome and failure log rather than assuming every guest was reached.
