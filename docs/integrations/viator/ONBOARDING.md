# BookingTours: Viator eligibility and evaluation preparation

Updated: 2026-10-20. Stage: **pre-application; not approved for technical evaluation**.

The owner confirmed that BookingTours has no approved Viator operator for a pilot and no technical-evaluation approval. Existing connector code is an internal candidate, not a Viator-approved connection.

## The first requirement

[Viator's prerequisites](https://docs.viator.com/supplier-api/technical/#section/Prerequisites) require registered Viator operators using the reservation system and formal approval for integration work. Supplier registration, product approval, reservation-system evaluation and API certification are distinct steps.

Two possible routes:

1. If you operate a real tour business, register that business through [Viator's supplier sign-up](https://supplier.viator.com/sign-up-info), complete its verification and product review, and use BookingTours to manage it.
2. Otherwise, recruit an existing Viator operator who will genuinely use BookingTours and authorise a pilot. Record its supplier ID, products, product options and named decision-maker.

Do not create a fictitious operator or describe demo businesses as paying customers. Whether a newly registered operator or a single-operator pilot is sufficient must be confirmed with Viator; neither is a published guarantee of eligibility.

Send [the eligibility enquiry](eligibility-enquiry.txt) now. It accurately explains the current stage and asks what Viator requires before a formal application. Do not send database credentials or customer exports.

## What to prepare for evaluation

The public documentation describes capabilities, configuration, mapping, testing and operational targets; it does not provide a complete initial acceptance scorecard. The preparation below is our recommendation, not a claim about undisclosed selection criteria.

| Area | Evidence to prepare |
|---|---|
| Actual operator demand | A consenting registered operator, supplier ID and products managed in BookingTours |
| Business identity | Accurate company and website information, product demo and named commercial and technical contacts |
| Product fit | One proposed scheduled, per-person pilot tour; its options, age categories, prices, currency, timezone and booking cutoff |
| Booking correctness | Test evidence for inventory holds, simultaneous last-seat requests, repeated requests, cancellations and transaction rollback |
| Access control | Per-operator authentication, ownership checks and a demonstrated inability to access another business |
| Operations | Measured latency/error rates, monitoring, incident ownership and an agreed manual fallback procedure |
| Scope and gaps | A truthful capability matrix, including unsupported pricing/product modes and optional capabilities |

Do not promise reliability figures without measurement. [Viator's SLA section](https://docs.viator.com/supplier-api/technical/#section/SLAs) publishes latency, uptime, error-rate and throughput expectations. Confirm applicable targets during evaluation and retain measurements from the actual hosted integration.

## Existing implementation and gaps

Candidate code:

- `supabase/functions/_shared/viator.ts`: supplier request parsing and response handling.
- `supabase/functions/_shared/ota-backend.ts`: business-scoped catalogue and inventory access.
- `supabase/migrations/20261008120000_ota_transactions.sql`: transactional reservations, bookings, cancellations and retry results.
- `tests/ota-transactions-local.mjs`: disposable database tests, including shared direct/OTA capacity and rollback.

The candidate targets scheduled, per-person departures. Unit/tiered pricing and opening-hours products are unsupported. Notification connection lifecycle and amendment retry identity still need agreement and implementation. Review every mandatory capability against the version agreed with Viator, including the current special-offer APIs, before committing to scope. No provider sandbox, contract-tool, certification, sustained-load or uptime evidence exists for this connection.

Local regression tests are supporting engineering evidence only. They cannot prove Viator interoperability or confer certification. After onboarding, run Viator's official contract tool with its issued credentials, complete joint certification and obtain launch approval.

The 2026-10-20 review passed 54 unit tests, 14 local PostgreSQL regression groups and Deno type checks for the four reviewed shared modules. Results and the distinction between local and provider tests are recorded in [readiness.json](../../production-readiness/evidence/viator-onboarding-20261020/readiness.json).

## Current Supabase project

The owner requested use of the existing, pre-launch project: `ukdsrndqhsatjkmxijuj`. No additional Supabase project is required by this plan.

The read-only inventory in [project-preflight.json](../../production-readiness/evidence/viator-onboarding-20261020/project-preflight.json) found 5 businesses, 12 tours, 254 bookings, 64 customers and 200 future departures. These are database records, **not verified commercial traction**. Booking triggers include notifications and marketing updates. There are no Viator integration rows or product mappings. The existing OTA database boundary is `BLOCKED`.

For hosted tests after eligibility and scope are agreed, use isolated test tables in a private schema within this project, with synthetic records and a separately scoped test endpoint. The current shared handlers cannot use that namespace without additional implementation and verification. Do not simply mark the entire existing database `SANDBOX`: its current transaction routines write to shared booking tables and may activate messaging triggers. Keep customer delivery and payment services outside the test path. Any claim that testing is isolated must be backed by checks of writes, triggers, function permissions and outbound requests.

No test schema, credentials or live connection was provisioned during this pre-application review. The change in priority follows the owner's confirmation that no eligible pilot operator or technical approval exists yet.

## Next milestones

1. Receive Viator's eligibility requirements and identify a genuine registered pilot operator.
2. Confirm permission to proceed, accepted capability scope, test products and onboarding contacts.
3. Implement and verify the isolated test path in the current Supabase project; complete the agreed connector gaps.
4. Run local regressions, hosted correctness/performance tests and the official contract tests. Preserve failures and results.
5. Complete joint certification, map approved products and arrange a monitored production launch.

Do not advertise BookingTours as a Viator connectivity partner until Viator authorises that description.
