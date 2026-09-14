# MVP smoke runbook — single stress tenant, Yoco test mode

Goal: prove the payment/voucher/capacity hardening on one disposable tenant
before MVP rollout. No fleet seeding, no soak. Timeboxed: half a day.

## 0. One-time setup (Supabase dashboard)

1. Create ONE business to abuse (e.g. `STRESS Co`). Never run these against a
   real operator.
2. Configure that tenant's Yoco **test** key and **test webhook** secret, then turn test mode ON. Use Yoco's currently documented test-card details. Do not use live card details.
3. Announce the window: `pg_cron` is shared, reminders/marketing may fire.
4. Get the values you need:
   - Project ref + publishable (anon) key: Dashboard → Project Settings → API.
   - Service-role key (for SQL setup only, never paste into k6): same page.
   - Test webhook secret: your tenant's Integration Credentials page.
5. `k6` is installed (`which k6`). Scripts: `tests/stress/`.

## 1. Webhook replay (R11) — 10 min

Make one real test-mode booking to PAID. Capture the `payment.succeeded`
payload + test webhook secret, then:

```bash
k6 run -e BASE=https://<ref>.supabase.co/functions/v1 \
  -e SECRET=<test_webhook_secret> \
  -e PAYLOAD_FILE=/private/tmp/test-payment-event.json \
  tests/stress/webhook-replay.k6.js
```

Pass: exactly ONE booking PAID, ONE invoice, ONE confirmation; the other 49
return 200 with no duplicate side effects:

```sql
SELECT count(*) FROM bookings WHERE yoco_checkout_id = '<CHECKOUT_ID>' AND status='PAID'; -- = 1
SELECT count(*) FROM idempotency_keys WHERE key = 'yoco_payment:<BUSINESS_ID>:test:<PAYMENT_ID>'; -- = 1
```

Then run `tests/stress/invariants.sql` — every row must say PASS.

## 2. Double-spend on the last seat (R14/R15) — 10 min

```bash
k6 run -e URL=https://<ref>.supabase.co -e KEY=<publishable> \
  -e SLOT=<stress_slot_id> -e BOOKINGS=<id1,id2,...> \
  -e TOKENS=<waiver1,waiver2,...> -e BUSINESS=<stress_business_id> \
  -e FREE_SEATS=<expected_successes> \
  tests/stress/double-spend.k6.js
```

Pass: successes == free seats on the slot; `booked + held` never exceeds
`capacity_total` (re-check in SQL + `invariants.sql`).

## 3. Checkout-type matrix (R12) — 15 min, browser + SQL

For each type, create the checkout and confirm the Yoco amount equals the
server-derived value (never a caller-supplied number):

| Type | How | Expected charge |
|---|---|---|
| BOOKING | Storefront booking → pay | Tour × qty + add-ons − promo − voucher |
| GIFT_VOUCHER | Buy voucher page | Exact voucher face value |
| RESCHEDULE | My Bookings → reschedule to pricier slot | `pending_reschedules.diff` only |
| ADD_GUESTS | Booking detail → add guest | qty-delta × unit_price |
| Unknown (`type=ADMIN_FREE`) | curl with forged type | HTTP 400 `UNKNOWN_CHECKOUT_TYPE`, no Yoco call |

Underpayment probe: deliver a `payment.succeeded` with 1 cent for a full-price
booking (test secret). Pass: booking lands `PENDING PAYMENT` /
`MISMATCH_QUARANTINE`, never PAID.

## 4. Reschedule uplift + voucher-split (R12/R14) — 20 min

- Reschedule a PAID booking to a pricier slot, pay the uplift. Pass: new slot
  booked, old slot released, `total_amount` = cash portion only.
- Pay a booking part-voucher + part-card. Pass: voucher `current_balance`
  drained exactly `voucher_amount_paid`, `total_captured` = card amount only,
  refund ceiling = card amount.

## 5. Expired-hold payment link (R16) — 25 min wall-clock

Start a checkout, abandon it, wait 16 min (past the 15-min hold, inside the
5-min grace), then complete payment. Pass: booking confirms (grace honored).
Repeat and wait 21 min (past grace): booking must NOT confirm into a released
seat; check the payment is refunded/flagged and the slot didn't oversell.
After each: `invariants.sql` → all PASS.

## 6. Two-tenant adversarial spot-checks (R05) — 10 min, SQL editor

```sql
-- Forged header + wrong token: must affect 0 rows
SET ROLE anon;
SET request.jwt.claim.role = 'anon';
SET request.headers = '{"x-tenant-business-id":"<TENANT_B>","x-booking-id":"<TENANT_A_BOOKING>","x-booking-waiver-token":"wrong"}';
UPDATE bookings SET customer_name='Forged' WHERE id='<TENANT_A_BOOKING>'; -- UPDATE 0
RESET ROLE;
```

Positive path: with the real `waiver_token` from the booking's own insert
response and the correct tenant header, a contact-field update on a
DRAFT/PENDING booking succeeds; money fields stay unchanged (R06 trigger).

## 7. Close-out

- `SELECT * FROM r13_capture_report();` — every row needs a Yoco-record check
  before any further refund on that booking.
- Delete only the fixture IDs created for this run. Keep the dedicated test business in test mode; never switch a test fixture to live payments.
- Record results in `docs/qa/ROLLOUT_REMEDIATION_2026-09-06.md` verification.
