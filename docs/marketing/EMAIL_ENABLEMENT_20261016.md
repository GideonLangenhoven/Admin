# Marketing email enablement

Checked 16 October 2026. The dashboard and draft tools are available. Customer marketing sending and automatic welcome-back delivery have not been enabled.

## Confirmed hosted state

- The Resend API-key and sender variables exist. Their presence does not verify the sender domain, current quota or deliverability.
- `RESEND_WEBHOOK_SECRET` is absent. The deployed callback refuses unconfigured requests.
- `marketing_delivery_policy` has zero rows, so zero operators are enabled.
- The deployed eligibility function explicitly holds booking-based welcome-back journeys, automatic offers and several other unfinished event-based recipes.
- The new read-only `marketing-setup-status` function reports configuration flags and the selected operator's current policy reason. It cannot send, activate or change settings. The dashboard no longer assumes that every account has the same setup problem.

## Account work for BookingTours

1. In the BookingTours Resend account, verify the sending domain/address used by the workers. Inspect the account's sending limits and current sender status.
2. Register the existing callback URL: `https://ukdsrndqhsatjkmxijuj.supabase.co/functions/v1/resend-webhook` for `email.bounced`, `email.complained` and `email.suppressed`. These are supported [Resend email events](https://resend.com/docs/webhooks/event-types); see the [provider's setup instructions](https://resend.com/docs/webhooks/introduction).
3. Store the callback signing secret as the Supabase Edge secret `RESEND_WEBHOOK_SECRET`, through the private provider/project settings. A random value installed only on Supabase will not establish a working callback.
4. Test signed callback handling and match the provider's email ID to the durable delivery record. Confirm that bounces, complaints and unsubscribes exclude the contact from later campaigns. Invalid signatures and unknown provider IDs must remain rejected or held for reconciliation.

No Resend account credential or active Resend browser session was used in this task. No provider settings, DNS records or secrets were changed.

## Product and engineering work before sending

- Finish and verify a real permission-capture path. Existing email addresses, imported contacts and bookings must not be treated as permission by themselves.
- Confirm the allowed sending hours, minimum time between marketing emails, operator time zone, and any offer limits with the business owner. Record actual decisions rather than inserting invented approval references.
- Complete the booking/payment/refund event handling for welcome-back journeys. Use the last paid booking, stop on a rebooking or upcoming reservation, and handle duplicate or delayed events without duplicate emails.
- Complete offer issuance and the affected journey prerequisites before removing their explicit holds. Configuring the email provider alone will not make these recipes available.
- Prove permission, opt-out, duplicate-worker, ambiguous-provider-result, cancellation and tenant-boundary behavior in an isolated complete-schema environment. Preserve existing operational booking/payment emails.
- Review old queued campaigns and enrollments before activation. Enable one explicitly selected operator first, using only an agreed internal test recipient for any live send. Verify actual callback handling and provider acceptance before wider sending.

Only after these checks should the service-managed per-operator delivery policy be enabled and the relevant UI activation actions made available. The current status check is diagnostic and does not certify sending readiness.
