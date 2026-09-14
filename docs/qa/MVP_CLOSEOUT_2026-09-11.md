# MVP functional repair closeout — 11 September 2026

The user requested an end to further issue discovery because of the usage limit.
This closes the current functional repair batch. All existing work is preserved;
the parallel payment/amendment/refund session owns its remaining implementation
and verification. This is not a production deployment or a complete release sign-off.

## Completed locally

- **R13 accounting reconciliation:** replaced the dynamic SQL `FOUND` check with
  an explicit existence result. Every eligible booking is evaluated; actual combo
  bookings and previously refunded rows remain excluded. Three disposable database
  scenarios passed, including repeat execution without duplicate correction logs.
- **Voucher balance notices:** confirmation and Yoco handlers use the amount
  settled for this booking. Previous redemptions no longer inflate the amount shown
  in the email. Queries retain booking and operator filters.
- **Marketing audiences:** campaigns collect every matching contact in pages,
  insert recipients in batches, and become sendable only after the whole audience
  is queued. Failed audience/queue writes cannot publish a partial campaign.
  A 2,101-contact fixture verifies all recipients are retained.
- **Operator dates:** local-to-UTC conversion uses the existing date-fns timezone
  dependency. Day boundaries now round-trip correctly across Sydney and New York
  daylight-saving changes, with Johannesburg and UTC controls.
- **Trip photos:** email includes all supplied links and preserves the operator's
  location wording. WhatsApp includes the links directly. Send results inspect both
  HTTP status and the provider result; failed channels and missing contact details
  are reported. Links are saved before notifications begin.
- **Drive uploads:** failed files stay selected, partial success is reported, and
  earlier folder links survive retries.
- **Guide photos:** uploads and thank-you requests now include the administrator's
  session token. Emails use this trip's links, and the guide sees failed uploads
  and partially failed email batches.

Earlier password reset, scheduler-key and checkout repairs are recorded in
[FUNCTIONAL_REPAIRS_2026-09-11.md](FUNCTIONAL_REPAIRS_2026-09-11.md).

## Verification

- 111 focused unit tests passed: `admin-timezone`, `message-job-boundaries`,
  `rollout-pagination`, `campaign-audience`, and `photo-delivery`.
- Administrator TypeScript check passed; all 55 edge functions passed `deno check`.
- Both administrator and storefront webpack production builds passed.
- Changed-file lint passed with zero errors and nine warnings.
- The earlier full unit run was not green. Payment/confirmation fixtures and
  assertions still need alignment with the parallel session's final implementation.
  This session repaired its new shared-helper test bindings and the VM's missing
  `URLSearchParams` global. It did not suppress failing assertions.
- The full disposable database rerun did not complete: the sandbox connection
  failed and the escalation request was interrupted. The three focused R13 database
  scenarios had already passed. No production database was used.
- No new browser/provider end-to-end result is claimed. Tests made no customer
  message or payment requests.

## Deployment handoff

1. Finish the payment session's existing checklist in
   [JOURNEY_REPAIRS_2026-09-11.md](JOURNEY_REPAIRS_2026-09-11.md) and obtain its final
   unit/database results. Do not treat this batch's 111 passing tests as whole-MVP approval.
2. Reconcile already-installed September SQL with migration history before applying
   migrations. If R13 already ran, inspect remaining eligible rows before executing
   any historical correction again; no historical production values were changed here.
3. Deploy the relevant payment SQL and updated edge handlers in their documented
   order. This batch changes `send-email`, `confirm-booking`, and `yoco-webhook`
   (with `_shared/voucher-balances.ts`), followed by the administrator application.
   Include the explicit `@date-fns/tz` dependency and lockfile change.
4. Complete the existing disposable-tenant
   [MVP smoke runbook](MVP_SMOKE_RUNBOOK.md), including reset/sign-in, booking,
   payment, amendment/refund and separate-operator checks. Verify real email and
   WhatsApp outcomes with test recipients. WhatsApp can still reject messages
   outside its allowed conversation window; this batch reports that failure.

No commit, push, deployment, credential rotation, customer message or payment was
performed by this closeout. The broader cybersecurity review remains deferred.
