# Manual Stress Tests — what's left for you to run

Everything code/security/data is fixed and deployed, and these phases are already
proven (don't redo them): **0** (gates), **1.2** (double-spend, ran live 20-way),
**1.5** (refund ceiling), **2.1** (cross-tenant isolation), **2.3/2.4** (drift +
reviews RLS), **3.2 logic** (no 1000-row truncation), **5.1/5.2/5.4** (unsigned +
bad-sig webhooks, SSRF), **S8** (combo overbooking guard).

Below is what still needs a human, a real Yoco test checkout, or an announced
window. Do them in order; stop and report on any red gate.

## Before you start (one-time setup)
1. **Dedicated stress tenant.** Create ONE business you'll abuse — e.g. `STRESS Co`.
   Never run these against a real operator.
2. **Yoco test mode ON** for that tenant; use test card `4111 1111 1111 1111`.
3. **Announce the window.** `pg_cron` is shared platform-wide; tell anyone watching
   that reminders/marketing may fire during the test.
4. `k6` is installed. Scripts live in this folder. Invariants: `invariants.sql`.
5. After EVERY scenario below, run `invariants.sql` — all rows must say PASS.

---

## Phase 1 — payment races that need a real Yoco test checkout (½–1 day)

These need a genuine checkout because they exercise the real Yoco webhook + signature,
which I can't fabricate safely.

**1.1 Webhook replay.** Make one real test-mode booking to PAID. Capture the Yoco
`payment.succeeded` payload + your test webhook secret. Fire it 50× concurrently
(clone `webhook-replay.k6.js`, fill BASE/SECRET/CHECKOUT_ID).
→ **Pass:** exactly ONE booking PAID, ONE invoice, ONE confirmation; the other 49 return
200 with no duplicate side-effects. Verify: `SELECT count(*) FROM idempotency_keys WHERE key='yoco_payment:<id>'` = 1.

**1.3 Hold-expiry vs late webhook (grace window).**
- Start a checkout, **wait 16 min** (past the 15-min hold, into the 5-min grace), then
  deliver the payment webhook. → **Pass:** booking still confirms.
- Repeat but **wait 21 min** (past grace). → **Pass:** booking does NOT confirm into a
  released seat; payment is refunded/flagged. Check the slot didn't oversell.

**1.4 Reschedule / remediation races.** On one CANCELLED-with-credit booking, fire
`CLAIM_CREDIT(VOUCHER)` + `CLAIM_CREDIT(REFUND)` + `RESCHEDULE` at the same time (three
browser tabs / three curl calls). → **Pass:** exactly one wins; no voucher AND refund
both issued; `refund_amount` consumed once. Then: two concurrent RESCHEDULEs into a
1-seat slot → only one succeeds.

---

## Phase 3 — fleet scale (needs the announced window) (1–2 days)

**3.1 Seed the fleet.** Run `seed-fleet.sql` (service role, SQL editor). Default 1,500
tenants. Confirm the final SELECT shows ~1,500 tenants / ~30,000 bookings.

**3.2 Cron sweeps at fleet size.** Manually invoke each cron once and time it:
`auto-messages` (action `all`), `cron-tasks`, `marketing-dispatch`, both OTA syncs.
→ **Pass, each:** completes < 300s (check the function log duration); reminders logged
for the LAST-seeded tenant (proves it processed past #1,000); one tenant with garbage
credentials doesn't abort the whole sweep; **re-run produces ZERO duplicate sends**
(the `auto_messages` unique key holds).

**3.3 Messaging burst.** Arrange 500 reminders due in one sweep. Watch Resend + Meta
throughput. → **Pass:** no silent drops — every 429/failure lands in `wa_messages` as
FAILED (visible in the WhatsApp-failures screen) or is retried. **Write down the real
ceiling (sends/min)** — that's your operational number.

**3.4 Hot pages under load (k6).** 100 concurrent operators on `/bookings` (largest
seeded tenant); 500 concurrent customers browsing the booking site + availability.
→ **Pass:** p95 < 2s for booking-site reads, p95 < 4s for admin day-view, zero 5xx.
Compare to `docs/perf/` baselines; any regression >2× needs an explanation.

**3.5 Realtime/polling.** Open 50 inbox tabs (it polls every 3s). → **Pass:** no
PostgREST rate-limit errors; the conversation list stays correct.

---

## Phase 4 — 48-hour soak (mostly unattended)

Run the platform like ~30 businesses for 48h: a "day-in-the-life" loop
(browse → hold → pay test-mode → sign waiver → reschedule/cancel some → review request
→ my-bookings OTP login → chat with human escalation), a signed OTA feed every few
minutes, and one marketing campaign to 1k seeded contacts mid-soak (unsubscribe some,
confirm they get nothing after).

→ **Pass after 48h:** `invariants.sql` all green; zero unhandled 5xx in Vercel + edge
logs; Sentry shows no new error classes; email/WA failure rate < 2% and all failures
visible in the operator UI; DB connections stable (no pool exhaustion); every pg_cron
job still on schedule (`SELECT * FROM cron.job_run_details ORDER BY start_time DESC` —
no stuck/failed runs); DB size growth linear and explained.

---

## Phase 5 — abuse (the parts I couldn't hit) (½ day)
Already proven: unsigned/bad-sig webhooks → 401, SSRF blocked. Still do:
- **OTP brute force:** request an OTP, then submit wrong codes repeatedly. → **Pass:**
  locks out after the threshold; doesn't leak whether the code was close.
- **Review-submit rate limit:** POST 20+ reviews/min from one client. → **Pass:** limit holds.
- **Chat rate limit:** hammer the web-chat/WA endpoints. → **Pass:** throttles; legit chats unaffected.
- **Garbage in:** malformed + >1MB payloads + invalid signatures at 100 rps → all 4xx/200-noop,
  ZERO DB writes, no function crash-loops (watch edge logs).

---

## Phase 6 — operational readiness (½ day, checklist)
- **Restore drill:** point-in-time-restore the DB to a Supabase branch; confirm a booking
  lookup works there. *(An untested backup is not a backup.)*
- **Key storage:** confirm `SETTINGS_ENCRYPTION_KEY` is stored separately from DB backups;
  write down the key-holder.
- **Runbook walk:** actually follow `PRODUCTION_RUNBOOK.md` on-call steps once — do they work?
- **Alerting:** wire the 5 pages a human must get — payment-webhook error rate, cron missed
  2+ runs, WA failure spike, 5xx spike, security-drift failure in CI.
- **Load-ceiling doc:** record the numbers from Phase 3/4 (max sends/min, max concurrent
  checkouts, tenant-sweep duration) so sales/ops know the envelope.

---

## Verdict
- All 🔴 (payments, isolation) + 🟠 pass → **roll out**, onboard in cohorts of ~10, watch
  the Phase-6 alerts for two weeks.
- 🔴 pass, 🟠 partial → capped pilot (≤5 clients) while finishing 🟠.
- Any 🔴 failure → **no rollout**; fix, then re-run that phase + Phase 4.

## Teardown (after all phases)
```sql
DELETE FROM bookings WHERE customer_email LIKE 'stress+%@example.test';
DELETE FROM slots  WHERE tour_id IN (SELECT id FROM tours WHERE name LIKE 'STRESS %');
DELETE FROM tours  WHERE name LIKE 'STRESS %';
DELETE FROM businesses WHERE name LIKE 'STRESS %';
```

