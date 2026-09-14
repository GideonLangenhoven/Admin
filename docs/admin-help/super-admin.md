---
title: Super Admin
route: /super-admin
required_role: SUPER_ADMIN
---

Super Admin is your platform control room. It can access every business. Never give this role to a client.

## Before handing a client their booking link

Open **Client readiness & support** and expand their business. Automatic checks show whether the owner account, subscription, policies, activity, future availability and provider settings exist. “Saved” does not mean a payment or message worked.

Perform the six client tests and record only what you actually verified. Every confirmation has an actor and timestamp in the audit trail. The checklist is not an automatic launch approval: unresolved support problems still need attention.

If billing or policies are missing, use **Complete missing setup** once. It creates only missing records from today, preserves existing records, and does not send an invoice or take money.

Use one onboarding route per client: **Onboard New Client** for assisted setup, or **Onboarding Invites** for self-service. Each creates a separate business and Main Admin. A retried assisted submission uses the same request ID to avoid duplicates. Do not start a second business after an interrupted setup without checking the list.

## Support and staff access

Select the client before opening their settings, billing, privacy requests or notifications. The server verifies the selected business against your sign-in; ordinary clients cannot switch into another business by editing a request.

In the client's detail panel, **Send setup link** emails a secure password link. Let the owner choose their password. **Suspend** blocks staff access and revokes refresh sessions without deleting records. **Reactivate** requires an available seat. You cannot suspend yourself, another platform account, or the last active Main Admin. Increase seats or promote another active Main Admin first, as appropriate.

Business suspension requires confirmation and an audit reason. It stops trading and is not automatically lifted just because an invoice is paid. Pausing/resuming billing and changing seats update billing records atomically. Seat reductions cannot fall below active staff.

## Monthly invoices

Use **Platform Invoices** for operator billing. The email usage panel is a usage/pricing view; email overage is included once in the platform invoice, not in a second customer invoice.

The preview and generated invoice share one calculation: plan, seat history, active days, email overage and AI overage. Review a draft before sending it. Generating a draft does not charge a card; sending it sends a real email and can create a payment link.

For a wrong unpaid draft without a payment link, use **Void draft**, give a reason, correct the source settings, then generate a replacement for the same month. The old document stays in **Voided history**. Paid documents are not editable or voidable here.

If a payment link exists or checkout creation started, correction is blocked until provider cancellation is verified. The Checkout API does not expose a documented cancellation operation in the reviewed API reference. Do not create a second payable invoice or delete the first to get around this protection; arrange cancellation/reconciliation with Yoco and platform support.

**Mark Paid** is for money you have actually received. Check the amount and reference in your bank first. If an old payment link has already been shared, arrange its cancellation as well so the client cannot accidentally pay twice.

## Daily monitoring in plain English

Sentry tells you when software reports a problem. It does not replace checking that customers actually received messages or money.

1. Open [Sentry errors](https://bookingtours.sentry.io/issues/?environment=production). Select **production**, **Unresolved** and the last 24 hours.
2. Open new or repeating issues. Copy the issue link; note first/last seen, event count and tags. **app** identifies admin, booking or edge. **business_id** identifies a client when available; **function.name** identifies an edge service.
3. Prioritise payment/refund failures, sign-in failures, any wrong-client information and missed scheduled jobs. Use this page's support counts to find the affected client. Do not blindly repeat a payment, refund or message.
4. Send the issue link, client name and a plain-English description to your developer. Resolve the issue only after a deployed fix has been checked. “Regressed” means a previously resolved problem returned.

Open [Sentry monitors](https://bookingtours.sentry.io/monitors/) and check **Booking cleanup and reminders**. It should start every five minutes and report completion. A missed/failed run needs investigation even if customers have not complained.

Check the control room and Sentry at the start and end of every day, after each onboarding, and after a release. Production new/regressed-error and error-spike rules route to the platform owner's Sentry account. A test alert must actually arrive before email monitoring is considered proven.

The included cron monitor covers cleanup/reminders. Marketing functions report returned failures to Sentry, but have no separate missed-run monitor in this release. Sentry is not an independent website uptime check; if the whole site or telemetry is unavailable, inspect the hosting dashboard and public booking page.

Sources: [Sentry cron monitoring](https://docs.sentry.io/product/monitors-and-alerts/monitors/crons/), [Sentry issue triage](https://docs.sentry.io/product/issues/states-triage/), [Yoco Checkout API](https://developer.yoco.com/api-reference/checkout-api/checkout/create-checkout).
