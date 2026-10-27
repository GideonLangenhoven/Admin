# Five-operator usability study and limited pilot proposal

Status: prepared only. No operators recruited, invitations sent or sessions run. Owner approval, consent, scheduling and a moderator are needed. Simple View stays optional, with existing landing preferences unchanged.

Recruit five independent operators across business size, product/season complexity, work style and digital confidence, including frontline and owner perspectives. Experience/age are not ability proxies. Assign anonymous participant codes; record only consented characteristics and do not record real guest/payment/health data. Agree separately on recording, next-day practice and seven-day follow-up.

## Baseline and candidate

Use the same isolated synthetic model as `tests/fixtures/operator-day.json`. Prepare two equivalent scenarios with different synthetic names/references and comparable departure sizes/exception counts. Establish current-product baseline, then candidate; counterbalance scenario/order where practical and record learning effects. Verify all provider and inventory paths are isolated before practice; do not relabel a live tenant Demo.

For each task, read a neutral goal without naming the intended control. Record independent completion before assistance; record all assistance and critical errors. Ask the participant to explain payment/booking/waiver meaning in their own words. Never let a participant execute real cancellations, messages, payments or refunds.

| Task | Scenario / success criterion |
|---|---|
| Find next trip | Correct operator-local day/activity/departure and available places; explain temporary holds. |
| Add a walk-in | Correct departure, child/party and configured questions; correct total, payment meaning and notification review; one synthetic booking. |
| Find/change booking | Distinguish same-name parties using date/reference; explain a proposed change without touching a live booking. |
| Missing waiver | Open exact booking's waiver context and return to original departure; explain why arrival is blocked. |
| Future session | Find existing Slots controls and configure one synthetic future departure without inventing capacity/price. |
| Help | Find task help/glossary and describe when to ask an admin. |

Record confidence (1–5) before/after each task, independent/assisted/failed outcome, elapsed time, wrong navigation, reversals, status explanation, critical mistakes and moderator intervention. Use [study-results.csv](study-results.csv); leave absent observations blank, never zero. Store identifiable consent separately with owner-approved access/retention. No automatic telemetry or external sharing is added.

## Proposed release thresholds — validate against baseline

- At least four of five independently complete each core task.
- All five distinguish paid from confirmed and explain the waiver block.
- Zero wrong-booking, cross-tenant, oversell, accidental-message or accidental-charge critical errors.
- Median core-task time improves without new errors; do not choose a numerical improvement target before measuring baseline.
- Every participant retains advanced tasks required for their role.

Five participants are a small qualitative study, not representative market evidence or causal proof. Failure is a design finding. Fix critical issues and retest affected tasks before expanding. Include next-day repeat use and seven-day follow-up only with agreement, checking retention, workarounds, assistance and errors as well as frequency of use.

## Limited rollout proposal

After full-schema/provider rehearsal and separate deployment approval, choose a small opt-in pilot with a named operator/admin, incident owner and rollback decision maker. Keep Simple optional; do not auto-enrol staff. Reconcile capacity, balances and booking IDs daily, review errors and provider queues, and pause expansion after a critical error. More clicks/page views do not establish adoption. Support hours, escalation contact, response expectations and pilot duration must be agreed before offering them.
