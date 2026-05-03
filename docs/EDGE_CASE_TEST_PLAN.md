# Edge Case & Resilience Test Plan — BookingTours (AH1–AH22)

**Created:** 2026-04-14
**Platform:** BookingTours (bookingtours.co.za)
**Scope:** 22 edge case tests + 8 cross-cutting checks
**Veto criteria:** AH1, AH9, AH14, AH15, AH18 failures block production launch.

---

## Table of Contents

- [Phase 1 — Categorisation & Capability Assessment](#phase-1--categorisation--capability-assessment)
- [Phase 2 — Test Environment Preparation](#phase-2--test-environment-preparation)
- [Phase 3 — Per-Test Execution Scripts](#phase-3--per-test-execution-scripts)
  - [Category A: Idempotency Tests](#category-a-idempotency-tests-ah1-ah5-ah6-ah9)
  - [Category B: Validation Tests](#category-b-validation-tests-ah2-ah3-ah4-ah7-ah10-ah11-ah12-ah18-ah20)
  - [Category C: Degraded Mode / Failure Tests](#category-c-degraded-mode--failure-tests-ah13-ah19-ah21)
  - [Category D: Race Condition / Concurrency Tests](#category-d-race-condition--concurrency-tests-ah8-ah14-ah15)
  - [Category E: UI / Responsive Tests](#category-e-ui--responsive-tests-ah16-ah17-ah22)
- [Phase 4 — Cross-Cutting Checks](#phase-4--cross-cutting-checks)
- [Phase 5 — Reporting & Triage](#phase-5--reporting--triage)

---

# Phase 1 — Categorisation & Capability Assessment

## 1.1 Categorisation Table

| Test | Name | Primary Category | Secondary | Notes |
|------|------|-----------------|-----------|-------|
| AH1 | Double payment webhook | Idempotency | — | Yoco webhook replay via curl |
| AH2 | Overbooked slot | Validation | — | Capacity check at booking time |
| AH3 | Expired voucher | Validation | — | Customer-facing booking site |
| AH4 | Invalid phone format | Validation | — | Normalization, not rejection |
| AH5 | Cancel already-cancelled | Idempotency | Validation | UI disables button; test API too |
| AH6 | Refund already-refunded | Idempotency | Validation | process-refund edge function |
| AH7 | Slot in the past | Validation | — | 60-min cutoff filter |
| AH8 | Multiple tabs (admin) | Concurrency | UI | **Clarification needed** (see below) |
| AH9 | Duplicate promo use | Idempotency | Validation | RPC checks promotion_uses table |
| AH10 | Expired promo code | Validation | — | RPC valid_until check |
| AH11 | Exhausted promo code | Validation | — | RPC used_count >= max_uses |
| AH12 | Promo min order not met | Validation | — | RPC min_order check |
| AH13 | Draft on email blur | Degraded mode | — | Best-effort, errors swallowed |
| AH14 | Concurrent hold race | Concurrency | — | **VETO test** — atomic hold RPC |
| AH15 | Concurrent voucher drain | Concurrency | — | **VETO test** — atomic deduction RPC |
| AH16 | Mobile responsive (admin) | UI | — | Tailwind breakpoints + drawer |
| AH17 | Mobile responsive (booking) | UI | — | Customer booking site |
| AH18 | Combo booking — one slot full | Validation | Concurrency | **VETO test** — pre-payment check |
| AH19 | Paysafe checkout — cancel | Degraded mode | — | No cancel webhook exists |
| AH20 | Add-on with zero qty | Validation | — | Filter + DB CHECK constraint |
| AH21 | Resend API key missing | Degraded mode | — | marketing-dispatch 503 guard |
| AH22 | Dark mode toggle | UI | — | CSS variables + class toggle |

### Categorisation Revisions

**AH5 moved to Idempotency (from your original Idempotency placement — confirmed).** The admin UI disables the Cancel button when `status === "CANCELLED"` (`app/bookings/page.tsx:1768`), so the primary test is UI-level. A secondary API-level test should verify what happens if the status update is called directly.

**AH8 — Clarification Required Before Testing:**
The term "real-time sync" is ambiguous. Investigation reveals:
- **Inbox/chat page:** Confirmed Supabase Realtime via `.on('postgres_changes')` for INSERT events on `chat_messages` table (`app/inbox/page.tsx:133-149`).
- **Bookings list, slots, and other pages:** No Realtime subscriptions found. These pages appear to use `loadBookings()` calls triggered by user actions (page load, after mutations), not live subscriptions.

**What this means for AH8:** If "real-time sync" means "Tab A sees changes made in Tab B without manual refresh," this only works on the inbox page. On the bookings page, Tab A would need to refresh to see Tab B's cancellation. The test must define which behaviour is expected. **I recommend testing the realistic scenario: both tabs function independently (no crashes, no stale-state corruption), and changes made in one tab are visible in the other after navigating away and back or refreshing.**

**AH13 recategorised to Degraded Mode (from Validation).** Draft creation is a best-effort side effect (`saveDraft()` at `~/dev/booking/app/book/page.tsx:165-183`), not a validation gate. The system silently catches errors. This is a graceful-degradation behaviour test.

**AH18 has a secondary Concurrency category** because the combination of AH18 + AH14 (combo booking where one slot has limited capacity under concurrent load) is a derived test in Phase 4.

## 1.2 Capability Assessment

### Category A: Idempotency — READY TO TEST

**Required:** Ability to replay webhook requests with valid HMAC signatures.

**Available:**
- Yoco webhook: `supabase/functions/yoco-webhook/index.ts` accepts POST with `webhook-id`, `webhook-timestamp`, `webhook-signature` headers. Secret is per-tenant in `credentials.yocoWebhookSecret`. Can construct valid signatures using the `standardwebhooks` algorithm (base64-encoded HMAC-SHA256).
- Paysafe webhook: `supabase/functions/paysafe-webhook/index.ts` accepts POST with `x-paysafe-signature` header. Secret is `PAYSAFE_WEBHOOK_SECRET` env var. Can construct via `HMAC-SHA256(secret, body)` → hex string.
- Idempotency table: `public.idempotency_keys` with UNIQUE constraint on `key` column. Can query directly via Supabase SQL.
- Cancel/refund APIs: Directly callable via Supabase client or curl.
- Promo code usage: `promotion_uses` table + `validate_promo_code` RPC.

**Blocker:** Need to obtain the Yoco webhook secret for the test business from the `credentials` table. If encrypted, need the `SETTINGS_ENCRYPTION_KEY` to decrypt.

### Category B: Validation — READY TO TEST

**Required:** Normal UI access + database access to create test data.

**Available:** All validation logic is in:
- Booking site UI (`~/dev/booking/app/book/page.tsx`)
- Database RPCs (`validate_promo_code`, `create_hold_with_capacity_check`, `deduct_voucher_balance`)
- Edge functions (`create-paysafe-checkout`)

**No blockers.**

### Category C: Degraded Mode — READY TO TEST (with caveats)

**Required:** Ability to break dependencies temporarily.

**Available:**
- AH13 (Draft): Normal booking site access. Just enter name + email and navigate away.
- AH19 (Paysafe cancel): Need a test Paysafe checkout in sandbox mode. Cancel by closing the Paysafe overlay.
- AH21 (Missing API key): Requires temporarily unsetting `RESEND_API_KEY` in Supabase Edge Function secrets.

**Caveat for AH21:** Do NOT unset `RESEND_API_KEY` in production. This test must run against a staging/local environment, or use a separate edge function deployment with the key deliberately omitted. If only production exists, flag as blocked.

### Category D: Concurrency — READY TO TEST

**Required:** Parallel HTTP request execution.

**Available:**
- `create_hold_with_capacity_check` RPC uses `SELECT...FOR UPDATE` row lock (`supabase/migrations/20260319110000_atomic_hold_creation.sql`).
- `deduct_voucher_balance` RPC uses `SELECT...FOR UPDATE` row lock (`supabase/migrations/20260319130000_atomic_voucher_deduction.sql`).
- Both are invoked via Supabase Edge Functions which are HTTP-accessible.
- **Parallel execution method:** Bash script with `curl &` (background processes) + `wait`. See Phase 2 for template.
- For AH8 (multiple tabs): Manual browser testing — open two tabs, perform actions, observe.

**No blockers.** The bash + curl approach is sufficient. No load-testing framework needed.

### Category E: UI / Responsive — READY TO TEST (first-pass)

**Required:** Device access or emulation.

**Available:**
- Chrome DevTools responsive mode for first-pass coverage
- Safari for macOS desktop testing
- **Real device gap:** Confirm availability of at least one iOS device and one Android device.

**Flagged gap:** DevTools emulation is acceptable for first-pass but NOT sufficient for launch QA. Real device testing is required before go-live. The test report will note whether real devices were used.

## 1.3 Summary

| Category | Tests | Status | Blockers |
|----------|-------|--------|----------|
| A: Idempotency | AH1, AH5, AH6, AH9 | **Ready** | Need Yoco webhook secret for test business |
| B: Validation | AH2, AH3, AH4, AH7, AH10-12, AH18, AH20 | **Ready** | None |
| C: Degraded Mode | AH13, AH19, AH21 | **Ready** (caveat) | AH21 needs non-production env for API key removal |
| D: Concurrency | AH8, AH14, AH15 | **Ready** | AH8 needs "real-time sync" definition (see above) |
| E: UI / Responsive | AH16, AH17, AH22 | **First-pass ready** | Real mobile devices for final QA |

**SIGN-OFF GATE:** Review this table. Resolve blockers before proceeding.

---

# Phase 2 — Test Environment Preparation

## 2.1 Shared Environment

| Item | Value | Notes |
|------|-------|-------|
| **Supabase project** | Production project (bookingtours) | Use test business only |
| **Test business** | Create or use existing test business | Must have Yoco + Paysafe credentials |
| **Payment: Yoco** | Yoco test/sandbox mode | For standard bookings |
| **Payment: Paysafe** | Paysafe sandbox mode | For combo bookings |
| **Test customer A** | `tester.a@bookingtours.co.za` / `+27710000001` | |
| **Test customer B** | `tester.b@bookingtours.co.za` / `+27710000002` | For concurrency tests |
| **Admin user** | Existing MAIN_ADMIN account | For admin-side tests |
| **Booking site URL** | `https://{test-subdomain}.bookingtours.co.za` | Customer-facing |
| **Admin dashboard URL** | `https://admin.bookingtours.co.za` | Admin-facing |
| **Supabase URL** | `$SUPABASE_URL` | From .env |
| **Service role key** | `$SUPABASE_SERVICE_ROLE_KEY` | For direct API calls |

### Environment Variables Needed

```bash
export SB_URL="https://YOUR_PROJECT.supabase.co"
export SB_KEY="YOUR_SERVICE_ROLE_KEY"
export SB_ANON="YOUR_ANON_KEY"
export YOCO_WEBHOOK_SECRET="FROM_CREDENTIALS_TABLE"
export PAYSAFE_WEBHOOK_SECRET="FROM_ENV"
export TEST_BUSINESS_ID="UUID_OF_TEST_BUSINESS"
export BOOKING_SITE_URL="https://test.bookingtours.co.za"
export ADMIN_URL="https://admin.bookingtours.co.za"
```

## 2.2 Idempotency Setup — Webhook Replay

### Yoco Webhook Signature Construction

Yoco uses the `standardwebhooks` library. The signature is computed as:

```
signature = base64(HMAC-SHA256(base64decode(secret), "{msg_id}.{timestamp}.{body}"))
```

**Replay script (`scripts/test-yoco-webhook.sh`):**

```bash
#!/bin/bash
# Usage: ./test-yoco-webhook.sh <booking_id> <amount_cents> [run_label]
set -euo pipefail

BOOKING_ID="${1:?Usage: $0 <booking_id> <amount_cents>}"
AMOUNT="${2:?Amount in cents required}"
LABEL="${3:-run1}"

WEBHOOK_URL="${SB_URL}/functions/v1/yoco-webhook"
MSG_ID="msg_test_$(date +%s)_${LABEL}"
TIMESTAMP=$(date +%s)
CHECKOUT_ID="test_checkout_$(echo $BOOKING_ID | cut -c1-8)"
PAYMENT_ID="test_pay_${BOOKING_ID:0:8}_${LABEL}"

BODY=$(cat <<ENDJSON
{
  "type": "payment.succeeded",
  "payload": {
    "id": "${PAYMENT_ID}",
    "amount": ${AMOUNT},
    "metadata": {
      "checkoutId": "${CHECKOUT_ID}",
      "booking_id": "${BOOKING_ID}"
    }
  }
}
ENDJSON
)

# Compute standardwebhooks signature
# Format: base64(HMAC-SHA256(base64decode(secret), "msg_id.timestamp.body"))
SIGN_INPUT="${MSG_ID}.${TIMESTAMP}.${BODY}"

# Using openssl for HMAC (secret must be base64-decoded first)
DECODED_SECRET=$(echo -n "$YOCO_WEBHOOK_SECRET" | base64 -d 2>/dev/null || echo -n "$YOCO_WEBHOOK_SECRET")
SIGNATURE=$(echo -n "$SIGN_INPUT" | openssl dgst -sha256 -hmac "$DECODED_SECRET" -binary | base64)

echo "=== Yoco Webhook Replay: ${LABEL} ==="
echo "Booking: ${BOOKING_ID}"
echo "Payment ID: ${PAYMENT_ID}"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "webhook-id: ${MSG_ID}" \
  -H "webhook-timestamp: ${TIMESTAMP}" \
  -H "webhook-signature: v1,${SIGNATURE}" \
  -d "$BODY")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
RESP_BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP ${HTTP_CODE}: ${RESP_BODY}"
echo "---"
```

### Paysafe Webhook Signature Construction

Paysafe uses plain HMAC-SHA256 → hex:

```bash
#!/bin/bash
# Usage: ./test-paysafe-webhook.sh <combo_booking_id> <payment_id> [event_type]
set -euo pipefail

COMBO_ID="${1:?Usage: $0 <combo_booking_id> <payment_id>}"
PAYMENT_ID="${2:?Payment ID required}"
EVENT="${3:-PAYMENT_COMPLETED}"

WEBHOOK_URL="${SB_URL}/functions/v1/paysafe-webhook"

BODY=$(cat <<ENDJSON
{
  "eventType": "${EVENT}",
  "id": "${PAYMENT_ID}",
  "merchantRefNum": "${COMBO_ID}"
}
ENDJSON
)

SIGNATURE=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$PAYSAFE_WEBHOOK_SECRET" | awk '{print $NF}')

echo "=== Paysafe Webhook: ${EVENT} ==="
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "x-paysafe-signature: ${SIGNATURE}" \
  -d "$BODY")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
RESP_BODY=$(echo "$RESPONSE" | sed '$d')
echo "HTTP ${HTTP_CODE}: ${RESP_BODY}"
```

## 2.3 Concurrency Setup — Parallel Request Script

```bash
#!/bin/bash
# Usage: ./test-concurrent-bookings.sh <slot_id> <tour_id> <n_requests>
# Fires N booking requests simultaneously against the same slot
set -euo pipefail

SLOT_ID="${1:?Slot ID required}"
TOUR_ID="${2:?Tour ID required}"
N="${3:-2}"

CHECKOUT_URL="${SB_URL}/functions/v1/create-checkout"
RESULTS_DIR="/tmp/concurrent_test_$(date +%s)"
mkdir -p "$RESULTS_DIR"

echo "=== Concurrent Booking Test ==="
echo "Slot: ${SLOT_ID} | N=${N} requests"
echo "Results dir: ${RESULTS_DIR}"
echo ""

# Launch N requests in parallel
for i in $(seq 1 $N); do
  EMAIL="tester.race${i}@bookingtours.co.za"
  PHONE="2771000000${i}"
  (
    curl -s -w "\n%{http_code}" -X POST "${BOOKING_SITE_URL}/api/book" \
      -H "Content-Type: application/json" \
      -d "{
        \"business_id\": \"${TEST_BUSINESS_ID}\",
        \"tour_id\": \"${TOUR_ID}\",
        \"slot_id\": \"${SLOT_ID}\",
        \"customer_name\": \"Race Tester ${i}\",
        \"customer_email\": \"${EMAIL}\",
        \"customer_phone\": \"${PHONE}\",
        \"qty\": 1
      }" > "${RESULTS_DIR}/response_${i}.txt" 2>&1
  ) &
done

echo "Waiting for all ${N} requests..."
wait
echo "All requests complete."
echo ""

# Display results
SUCCESS=0
FAIL=0
for i in $(seq 1 $N); do
  HTTP_CODE=$(tail -1 "${RESULTS_DIR}/response_${i}.txt")
  BODY=$(sed '$d' "${RESULTS_DIR}/response_${i}.txt")
  if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" ]]; then
    echo "Request ${i}: SUCCESS (${HTTP_CODE})"
    SUCCESS=$((SUCCESS + 1))
  else
    echo "Request ${i}: FAILED (${HTTP_CODE}) — ${BODY}"
    FAIL=$((FAIL + 1))
  fi
done

echo ""
echo "Summary: ${SUCCESS} succeeded, ${FAIL} failed out of ${N}"
echo ""
echo "=== Verify slot state ==="
curl -s -X POST "${SB_URL}/rest/v1/rpc/execute_sql" \
  -H "apikey: ${SB_KEY}" \
  -H "Authorization: Bearer ${SB_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"SELECT capacity_total, booked, held FROM slots WHERE id = '${SLOT_ID}'\"}"
```

### Concurrent Voucher Drain Script

```bash
#!/bin/bash
# Usage: ./test-concurrent-voucher.sh <voucher_id> <amount> <n_requests>
set -euo pipefail

VOUCHER_ID="${1:?Voucher ID required}"
AMOUNT="${2:?Amount required}"
N="${3:-2}"

RESULTS_DIR="/tmp/voucher_test_$(date +%s)"
mkdir -p "$RESULTS_DIR"

echo "=== Concurrent Voucher Drain Test ==="
echo "Voucher: ${VOUCHER_ID} | Amount: R${AMOUNT} | N=${N}"

for i in $(seq 1 $N); do
  (
    curl -s -X POST "${SB_URL}/rest/v1/rpc/deduct_voucher_balance" \
      -H "apikey: ${SB_KEY}" \
      -H "Authorization: Bearer ${SB_KEY}" \
      -H "Content-Type: application/json" \
      -d "{\"p_voucher_id\": \"${VOUCHER_ID}\", \"p_amount\": ${AMOUNT}}" \
      > "${RESULTS_DIR}/response_${i}.txt" 2>&1
  ) &
done

wait
echo "All requests complete."

for i in $(seq 1 $N); do
  echo "Request ${i}: $(cat ${RESULTS_DIR}/response_${i}.txt)"
done

echo ""
echo "=== Verify voucher state ==="
curl -s "${SB_URL}/rest/v1/vouchers?id=eq.${VOUCHER_ID}&select=code,status,current_balance,value" \
  -H "apikey: ${SB_KEY}" \
  -H "Authorization: Bearer ${SB_KEY}"
```

## 2.4 Validation Setup — Test Data SQL

Run these against the test business to create required test data:

```sql
-- ===== EXPIRED VOUCHER (AH3) =====
INSERT INTO vouchers (business_id, code, value, current_balance, status, expires_at, created_at)
VALUES (
  'TEST_BUSINESS_ID',
  'EXPTEST1',
  500.00,
  500.00,
  'ACTIVE',
  NOW() - INTERVAL '1 day',  -- expired yesterday
  NOW() - INTERVAL '30 days'
);

-- ===== ACTIVE VOUCHER WITH BALANCE (for AH15 concurrent test) =====
INSERT INTO vouchers (business_id, code, value, current_balance, status, expires_at, created_at)
VALUES (
  'TEST_BUSINESS_ID',
  'RACETEST',
  100.00,
  100.00,
  'ACTIVE',
  NOW() + INTERVAL '365 days',
  NOW()
) RETURNING id;
-- Save this ID for the concurrent voucher drain test

-- ===== EXPIRED PROMO CODE (AH10) =====
INSERT INTO promotions (business_id, code, discount_type, discount_value, active, valid_until, max_uses, used_count)
VALUES (
  'TEST_BUSINESS_ID',
  'EXPIREDPROMO',
  'percent',
  10,
  true,
  NOW() - INTERVAL '1 day',  -- expired yesterday
  100,
  0
);

-- ===== EXHAUSTED PROMO CODE (AH11) =====
INSERT INTO promotions (business_id, code, discount_type, discount_value, active, valid_until, max_uses, used_count)
VALUES (
  'TEST_BUSINESS_ID',
  'MAXEDPROMO',
  'percent',
  15,
  true,
  NOW() + INTERVAL '365 days',
  1,   -- max_uses = 1
  1    -- used_count = 1 (exhausted)
);

-- ===== PROMO WITH MIN ORDER (AH12) =====
INSERT INTO promotions (business_id, code, discount_type, discount_value, active, valid_until, max_uses, used_count, min_order)
VALUES (
  'TEST_BUSINESS_ID',
  'MINORDER',
  'flat',
  50,
  true,
  NOW() + INTERVAL '365 days',
  100,
  0,
  1000.00   -- min R1000 order
);

-- ===== PROMO FOR DUPLICATE USE TEST (AH9) =====
INSERT INTO promotions (business_id, code, discount_type, discount_value, active, valid_until, max_uses, used_count)
VALUES (
  'TEST_BUSINESS_ID',
  'ONCEONLY',
  'percent',
  20,
  true,
  NOW() + INTERVAL '365 days',
  1,
  0
);

-- ===== SLOT AT CAPACITY (AH2) =====
INSERT INTO slots (business_id, tour_id, start_time, status, capacity_total, booked, held)
VALUES (
  'TEST_BUSINESS_ID',
  'TEST_TOUR_ID',
  NOW() + INTERVAL '3 days',
  'OPEN',
  10,
  10,    -- fully booked
  0
) RETURNING id;

-- ===== SLOT WITH 1 SPOT (AH14 concurrency) =====
INSERT INTO slots (business_id, tour_id, start_time, status, capacity_total, booked, held)
VALUES (
  'TEST_BUSINESS_ID',
  'TEST_TOUR_ID',
  NOW() + INTERVAL '4 days',
  'OPEN',
  1,
  0,
  0
) RETURNING id;

-- ===== PAST SLOT (AH7) =====
INSERT INTO slots (business_id, tour_id, start_time, status, capacity_total, booked, held)
VALUES (
  'TEST_BUSINESS_ID',
  'TEST_TOUR_ID',
  NOW() - INTERVAL '2 hours',
  'OPEN',
  10,
  0,
  0
) RETURNING id;
```

## 2.5 Degraded Mode Setup

### AH21: Removing RESEND_API_KEY

**Method:** Temporarily unset the secret in Supabase Edge Function environment.

```bash
# SAVE current value first
supabase secrets list | grep RESEND_API_KEY  # confirm exists

# REMOVE (do this on staging/test only, NEVER production)
supabase secrets unset RESEND_API_KEY

# VERIFY removed
curl -s -X POST "${SB_URL}/functions/v1/marketing-dispatch" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SB_KEY}" \
  -d '{"campaign_id": "test"}' \
  -w "\nHTTP: %{http_code}\n"
# Expected: 503 with {"error":"RESEND_API_KEY not set"}

# RESTORE after test
supabase secrets set RESEND_API_KEY=<saved_value>

# VERIFY restored
curl -s -X POST "${SB_URL}/functions/v1/marketing-dispatch" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SB_KEY}" \
  -d '{"campaign_id": "test"}' \
  -w "\nHTTP: %{http_code}\n"
# Expected: NOT 503 (may be 400 for invalid campaign, but not 503)
```

**CRITICAL:** If you only have production, do NOT run this test. Create a minimal staging deployment instead, or test by reading the source code and confirming the guard exists (`marketing-dispatch/index.ts:17-20`). Note in the report: "AH21 verified by code inspection only — no staging environment available."

### AH19: Paysafe Checkout Cancel

No special setup needed. The test involves:
1. Start a combo booking flow to the point where Paysafe checkout overlay appears
2. Close/cancel the overlay instead of completing payment
3. Verify holds are not permanently stuck

The Paysafe sandbox will accept test card numbers without real charges.

## 2.6 UI / Responsive Setup

### Device Matrix

| Device | Type | Viewport | Method |
|--------|------|----------|--------|
| iPhone SE | Small mobile | 375×667 | DevTools emulation (first pass) |
| iPhone 14 Pro | Standard mobile | 393×852 | DevTools emulation |
| Samsung Galaxy S21 | Android mobile | 360×800 | Real device (if available) |
| iPad | Tablet | 768×1024 | DevTools emulation |
| MacBook | Desktop | 1440×900 | Native browser |
| External monitor | Large desktop | 1920×1080 | Native browser |

### DevTools Emulation Settings

1. Open Chrome DevTools → Toggle Device Toolbar (Cmd+Shift+M)
2. Test at these exact widths: **320px**, **375px**, **414px**, **768px**, **1280px**, **1920px**
3. For network throttling (Phase 4 cross-cut): DevTools → Network → Throttle → "Slow 3G"

### Real Device Requirements (for final QA, not first-pass)

- Minimum one **iOS device** (iPhone, any model with Safari)
- Minimum one **Android device** (Chrome browser)
- Test on actual mobile network (4G/LTE), not wifi, for at least one pass

**If real devices are unavailable:** Flag in the report. DevTools emulation covers layout but misses touch target sizing, Safari rendering quirks, and real network performance.

---

# Phase 3 — Per-Test Execution Scripts

## Category A: Idempotency Tests (AH1, AH5, AH6, AH9)

**Category setup:** These tests share webhook replay infrastructure (Phase 2.2). Run them in order to reuse the test booking.

---

### AH1 — Double Payment Webhook

**Category:** Idempotency
**What this verifies:** That sending the Yoco payment webhook twice for the same booking produces exactly one confirmation, one email, one WhatsApp message, and one status transition.

**Preconditions:**
- A test booking exists with status `HELD` (created via the booking site or admin)
- The booking has a valid `slot_id` with capacity
- The `idempotency_keys` table has no entry for this booking's payment
- The `logs` table has no `booking_confirmation_notifications_sent` event for this booking

**Setup steps:**
1. Create a test booking via the admin new-booking page or SQL:
   ```sql
   INSERT INTO bookings (business_id, tour_id, slot_id, customer_name, customer_email, customer_phone, qty, total_amount, status, source)
   VALUES ('TEST_BUSINESS_ID', 'TEST_TOUR_ID', 'TEST_SLOT_ID', 'Idemp Tester', 'tester.a@bookingtours.co.za', '27710000001', 2, 600.00, 'HELD', 'ADMIN')
   RETURNING id;
   ```
2. Note the booking ID.
3. Verify no prior idempotency key exists:
   ```sql
   SELECT * FROM idempotency_keys WHERE key LIKE '%' || 'BOOKING_ID_HERE' || '%';
   ```

**Trigger:**
1. Run `scripts/test-yoco-webhook.sh <booking_id> 60000 first` — first webhook
2. Wait 5 seconds
3. Run `scripts/test-yoco-webhook.sh <booking_id> 60000 second` — duplicate webhook

**Expected result:**
- **First call:** HTTP 200. Booking transitions to `PAID`.
- **Second call:** HTTP 200 (idempotent success, not an error).
- **Database:** Booking status = `PAID` (not double-updated). `confirmation_sent_at` set once.
- **Side effects (exactly once):**
  - One entry in `idempotency_keys` with key `yoco_payment:test_pay_<id>_first`
  - One `booking_confirmation_notifications_sent` log entry
  - One confirmation email sent (check Resend dashboard or email inbox)
  - One WhatsApp message sent (check WhatsApp logs)
  - One invoice created
- **What should NOT happen:**
  - No second idempotency key for the `second` payment ID
  - No second log entry
  - No second email or WhatsApp message
  - No second invoice

**Verification steps:**
1. ```sql
   SELECT status, confirmation_sent_at, yoco_payment_id FROM bookings WHERE id = 'BOOKING_ID';
   -- Expect: PAID, non-null timestamp, payment ID from first call
   ```
2. ```sql
   SELECT COUNT(*) FROM idempotency_keys WHERE key LIKE 'yoco_payment:test_pay_%';
   -- Expect: 1 (only the first call's key)
   ```
3. ```sql
   SELECT COUNT(*) FROM logs WHERE booking_id = 'BOOKING_ID' AND event = 'booking_confirmation_notifications_sent';
   -- Expect: 1
   ```
4. Check Resend email dashboard — exactly one email to `tester.a@bookingtours.co.za` for this booking.

**Replay mechanism:** Curl via `scripts/test-yoco-webhook.sh`
**Time gap between attempts:** 5 seconds (enough for first to complete, tight enough to be realistic)
**Side effect uniqueness check:** Count rows in `idempotency_keys`, `logs`, and verify email delivery count.

**Common failure modes:**
- Second webhook gets past the idempotency check because the key format differs (e.g., uses `checkoutId` vs `paymentId` — our script uses both, but real Yoco may vary)
- Idempotency check passes but the secondary check (`logs` table unique index `uq_logs_booking_event`) fails with an unhandled 23505 error
- Email is sent twice because the email dispatch is fire-and-forget before the idempotency key is inserted

**Pass / fail criteria:**
- **Pass:** Second call returns 200, zero additional side effects, all counts = 1.
- **Fail:** Any duplicate side effect (email, log, invoice) OR second call returns 500.

**If failed:** Check:
1. Is the idempotency key inserted BEFORE or AFTER side effects fire? (Should be before — `yoco-webhook/index.ts` inserts key early)
2. Is the `uq_logs_booking_event` unique index present? (`SELECT indexname FROM pg_indexes WHERE tablename = 'logs'`)
3. Check Supabase Edge Function logs for the second invocation — was the `IDEMPOTENCY_SKIP` log line printed?

---

### AH5 — Cancel Already-Cancelled Booking

**Category:** Idempotency
**What this verifies:** That attempting to cancel a booking that is already CANCELLED produces no state change, no duplicate notifications, and no capacity release.

**Preconditions:**
- A test booking exists with status `CANCELLED` and `cancelled_at` set
- The associated slot's `booked` count already reflects the cancellation (i.e., capacity was released on first cancel)

**Setup steps:**
1. Create and cancel a test booking:
   ```sql
   INSERT INTO bookings (business_id, tour_id, slot_id, customer_name, customer_email, customer_phone, qty, total_amount, status, cancelled_at, cancellation_reason)
   VALUES ('TEST_BUSINESS_ID', 'TEST_TOUR_ID', 'TEST_SLOT_ID', 'Cancel Tester', 'tester.a@bookingtours.co.za', '27710000001', 2, 400.00, 'CANCELLED', NOW(), 'Test cancel')
   RETURNING id;
   ```
2. Record the slot's current capacity:
   ```sql
   SELECT capacity_total, booked, held FROM slots WHERE id = 'TEST_SLOT_ID';
   ```

**Trigger (UI path):**
1. Open admin dashboard → Bookings
2. Find the cancelled test booking
3. Observe the Cancel button state

**Trigger (API path):**
4. Attempt direct status update:
   ```sql
   UPDATE bookings SET status = 'CANCELLED', cancelled_at = NOW() WHERE id = 'BOOKING_ID' AND status = 'CANCELLED' RETURNING id;
   ```

**Expected result:**
- **UI:** Cancel button is **disabled** (greyed out) for CANCELLED bookings (`app/bookings/page.tsx:1768`)
- **API:** The UPDATE returns 0 rows (WHERE clause matches but no actual change, or returns the same row)
- **Slot capacity unchanged:** `booked` and `held` values identical to pre-test
- **No duplicate notifications:** No new emails or WhatsApp messages sent

**Verification steps:**
1. Screenshot the admin UI showing the disabled Cancel button for the CANCELLED booking.
2. ```sql
   SELECT status, cancelled_at FROM bookings WHERE id = 'BOOKING_ID';
   -- Expect: CANCELLED, original timestamp (not updated)
   ```
3. ```sql
   SELECT capacity_total, booked, held FROM slots WHERE id = 'TEST_SLOT_ID';
   -- Expect: identical to pre-test values
   ```

**Common failure modes:**
- The UI disables the button but doesn't prevent keyboard/API access — a user who bypasses the UI can still trigger a cancel
- Capacity is released again on the second cancel (double-release = phantom capacity)
- The update succeeds silently (no error) but triggers a notification side-effect

**Pass / fail criteria:**
- **Pass:** UI prevents action. Direct API call produces no state change. No side effects.
- **Fail:** Capacity changes, notifications fire, or UI allows the action.

**If failed:** Check whether `cancelBooking()` in `app/bookings/page.tsx:606` has a status guard before performing the update. The current code does NOT check status before updating — it relies solely on UI disabling.

---

### AH6 — Refund Already-Refunded Booking

**Category:** Idempotency
**What this verifies:** That attempting to refund a booking whose full amount has already been refunded returns a clear error with no duplicate refund attempt.

**Preconditions:**
- A test booking exists with status `REFUNDED` or `PAID` where `total_refunded >= total_captured`
- The booking was previously refunded via the process-refund edge function

**Setup steps:**
1. Create a booking that has been fully refunded:
   ```sql
   INSERT INTO bookings (business_id, tour_id, slot_id, customer_name, customer_email, customer_phone, qty, total_amount, status, total_captured, total_refunded, yoco_payment_id)
   VALUES ('TEST_BUSINESS_ID', 'TEST_TOUR_ID', 'TEST_SLOT_ID', 'Refund Tester', 'tester.a@bookingtours.co.za', '27710000001', 1, 300.00, 'REFUNDED', 300.00, 300.00, 'test_pay_refund')
   RETURNING id;
   ```

**Trigger:**
```bash
curl -s -X POST "${SB_URL}/functions/v1/process-refund" \
  -H "Content-Type: application/json" \
  -d '{"booking_id": "BOOKING_ID", "refund_amount": 300}'
```

**Expected result:**
- HTTP 400 with body: `{"error": "Nothing left to refund (captured: 300, already refunded: 300)"}`
- No Yoco refund API call made
- No status change on the booking
- No email or notification sent

**Verification steps:**
1. Check HTTP response code = 400 and error message matches exactly.
2. ```sql
   SELECT status, total_refunded FROM bookings WHERE id = 'BOOKING_ID';
   -- Expect: unchanged (REFUNDED, 300.00)
   ```
3. Check Yoco dashboard — no new refund transaction.

**Common failure modes:**
- The function attempts the Yoco refund before checking the balance, and Yoco returns an error that gets swallowed
- Partial refund edge case: if `total_refunded = 299` and you request 300, it should cap at 1 (not attempt 300)

**Pass / fail criteria:**
- **Pass:** HTTP 400 with accurate error message. No state change. No external API call.
- **Fail:** HTTP 500, vague error, or any state change.

**If failed:** Read `process-refund/index.ts:61-68` — the refund capping logic. Verify `total_captured` and `total_refunded` columns are populated correctly.

---

### AH9 — Duplicate Promo Code Use

**Category:** Idempotency
**What this verifies:** That the same promo code cannot be used twice by the same email address, with the second attempt returning a clear error.

**Preconditions:**
- The `ONCEONLY` promo code exists (from Phase 2.4 test data) with `max_uses = 1`, `used_count = 0`
- No prior entry in `promotion_uses` for `tester.a@bookingtours.co.za`

**Setup steps:**
1. Verify promo exists and is unused:
   ```sql
   SELECT id, code, max_uses, used_count FROM promotions WHERE code = 'ONCEONLY' AND business_id = 'TEST_BUSINESS_ID';
   SELECT COUNT(*) FROM promotion_uses WHERE promotion_id = 'PROMO_ID';
   -- Expect: used_count = 0, no rows in promotion_uses
   ```

**Trigger:**
1. **First use:** Open booking site → select tour/slot → enter customer details with email `tester.a@bookingtours.co.za` → enter promo code `ONCEONLY` → click Apply
2. Complete the booking through payment
3. **Second use:** Start a new booking → same email `tester.a@bookingtours.co.za` → enter promo code `ONCEONLY` → click Apply

**Expected result:**
- **First use:** Promo applied successfully, discount reflected in total
- **Second use:** Error displayed: **"You have already used this promo code"**
- **Database after first use:** `used_count = 1`, one row in `promotion_uses`
- **Database after second attempt:** `used_count` still 1, still one row in `promotion_uses`

**Verification steps:**
1. Screenshot the error message on second application attempt.
2. ```sql
   SELECT used_count FROM promotions WHERE code = 'ONCEONLY';
   -- Expect: 1
   ```
3. ```sql
   SELECT COUNT(*) FROM promotion_uses WHERE promotion_id = 'PROMO_ID';
   -- Expect: 1
   ```
4. Verify the second booking (if it proceeded without the promo) does NOT have a discount applied.

**Replay mechanism:** Manual booking flow through the UI (two separate bookings with the same email).
**Time gap:** Complete first booking fully before starting second.

**Common failure modes:**
- The check is per-email but the validation uses case-sensitive comparison (Email vs email) — try with different casing
- The `used_count` is incremented but the `promotion_uses` INSERT fails, leaving the promo "used" but without a record of who used it
- Race condition: two simultaneous applications by the same email (covered in Phase 4 cross-cut)

**Pass / fail criteria:**
- **Pass:** Second attempt shows exact error message. `used_count` = 1. One row in `promotion_uses`.
- **Fail:** Second promo application succeeds, or error message is vague, or counts are wrong.

**If failed:** Check `validate_promo_code` RPC in `supabase/migrations/20260401100000_promo_validation_rpc.sql:60-70`. The duplicate check queries `promotion_uses` and is only enforced when `max_uses = 1`.

---

## Category B: Validation Tests (AH2, AH3, AH4, AH7, AH10, AH11, AH12, AH18, AH20)

**Category setup:** These tests require the test data from Phase 2.4. Most can run in any order. AH18 requires a combo offer setup.

---

### AH2 — Overbooked Slot

**Category:** Validation
**What this verifies:** That a customer cannot book a slot with zero remaining capacity, with a clear error message and no persistent state created.

**Preconditions:**
- Test slot exists with `capacity_total = 10`, `booked = 10`, `held = 0` (from Phase 2.4)
- The booking site is accessible

**Setup steps:**
1. Verify the slot is at capacity:
   ```sql
   SELECT id, capacity_total, booked, held, (capacity_total - booked - COALESCE(held, 0)) AS available
   FROM slots WHERE id = 'FULL_SLOT_ID';
   -- Expect: available = 0
   ```

**Trigger:**
1. Open booking site → select tour
2. Observe whether the full slot appears in the calendar/slot picker

**Expected result:**
- **UI path:** The full slot does NOT appear in the available slots list. The booking site query filters by `capacity_total - booked - held > 0` (`~/dev/booking/app/book/page.tsx:86`).
- If a slot somehow appears (e.g., another booking completes between page load and slot selection), the `create_hold_with_capacity_check` RPC returns:
  ```json
  {"success": false, "error": "Sorry, those spots were just taken! Please try another time slot.", "available": 0}
  ```
- **No persistent state:** No DRAFT, HELD, or PENDING booking created. No holds table entry.

**Verification steps:**
1. Confirm the full slot is not visible in the booking site UI.
2. If testing the RPC directly:
   ```sql
   SELECT * FROM create_hold_with_capacity_check('fake-booking-id', 'FULL_SLOT_ID', 1, NOW() + INTERVAL '15 minutes');
   -- Expect: {"success": false, "error": "Sorry, those spots were just taken!...", "available": 0}
   ```
3. ```sql
   SELECT COUNT(*) FROM bookings WHERE slot_id = 'FULL_SLOT_ID' AND created_at > NOW() - INTERVAL '5 minutes';
   -- Expect: 0 (no new bookings)
   ```
4. ```sql
   SELECT COUNT(*) FROM holds WHERE slot_id = 'FULL_SLOT_ID' AND status = 'ACTIVE';
   -- Expect: 0 (no new holds)
   ```

**Expected error message:** "Sorry, those spots were just taken! Please try another time slot."

**Common failure modes:**
- The slot listing uses a stale cache and shows the full slot as available
- The hold creation check uses `>=` instead of `>` in the available capacity calculation (off-by-one)
- A DRAFT booking is created before the capacity check runs

**Pass / fail criteria:**
- **Pass:** Full slot not visible in UI. Direct RPC returns `success: false`. Zero new persistent records.
- **Fail:** Slot visible in UI, or booking/hold created for a full slot.

**If failed:** Check the slot listing query in `~/dev/booking/app/book/page.tsx:84-86` and the `create_hold_with_capacity_check` function in `supabase/migrations/20260319110000_atomic_hold_creation.sql`.

---

### AH3 — Expired Voucher

**Category:** Validation
**What this verifies:** That an expired voucher code is rejected with the exact error "Expired" and no balance is deducted.

**Preconditions:**
- Test voucher `EXPTEST1` exists with `status = 'ACTIVE'`, `expires_at` in the past, `current_balance = 500.00` (from Phase 2.4)

**Setup steps:**
1. Verify voucher state:
   ```sql
   SELECT code, status, current_balance, expires_at FROM vouchers WHERE code = 'EXPTEST1';
   -- Expect: ACTIVE, 500.00, expires_at < NOW()
   ```

**Trigger:**
1. Open booking site → select tour/slot → enter customer details
2. Enter voucher code `EXPTEST1` in the voucher input
3. Click Apply

**Expected result:**
- Error message displayed: **"Expired"** (exact text from `~/dev/booking/app/book/page.tsx:154`)
- Voucher NOT added to the applied vouchers list
- No balance deduction
- No change to the voucher record

**Verification steps:**
1. Screenshot showing the "Expired" error message next to the voucher input.
2. ```sql
   SELECT status, current_balance FROM vouchers WHERE code = 'EXPTEST1';
   -- Expect: ACTIVE, 500.00 (unchanged)
   ```
3. Confirm the voucher does not appear in the booking summary's applied vouchers section.

**Expected error message:** "Expired"

**Common failure modes:**
- Timezone mismatch: `expires_at` is stored in UTC but compared against local time (SAST = UTC+2). A voucher expiring at midnight UTC is still valid in South Africa until 2am SAST.
- The check uses `<=` instead of `<` for the comparison (a voucher expiring today at 23:59 is valid until that moment)

**Pass / fail criteria:**
- **Pass:** "Expired" error shown. Voucher balance unchanged. Not added to cart.
- **Fail:** Voucher accepted despite being expired, or error message differs.

**If failed:** Check the expiry comparison in `~/dev/booking/app/book/page.tsx:154`. Verify the timezone handling.

---

### AH4 — Invalid Phone Format

**Category:** Validation (normalization)
**What this verifies:** That a phone number entered as "0821234567" is auto-normalized to the international format, not rejected.

**Preconditions:**
- Admin new-booking page accessible (this test applies to the admin side; the booking site already shows "+27" prefix)

**Setup steps:**
None beyond normal access.

**Trigger (Admin side):**
1. Open admin dashboard → New Booking
2. Enter phone number: `0821234567`
3. Proceed through the booking flow

**Trigger (Booking site):**
1. Open booking site → select tour/slot
2. The phone field shows `+27` prefix. Enter: `0821234567` in the field (the `0` would be included if the user ignores the prefix)

**Expected result:**
- **Admin side:** `normalizePhone("0821234567")` returns `"27821234567"` (`app/new-booking/page.tsx:110-121`)
- The booking is saved with phone `27821234567` (11 digits, valid SA number)
- No error displayed — the normalization is silent
- **Booking site:** The `+27` prefix is shown. If user enters `0821234567` after the prefix, the stored number would be `270821234567` (13 digits) — which `isValidSAPhone()` would flag. The booking site normalizes by stripping the leading 0.

**Verification steps:**
1. Complete the booking and check the stored phone:
   ```sql
   SELECT customer_phone FROM bookings WHERE customer_email = 'tester.a@bookingtours.co.za'
   ORDER BY created_at DESC LIMIT 1;
   -- Expect: 27821234567
   ```
2. Verify the phone number is displayed correctly in the booking detail.

**Common failure modes:**
- The normalization strips the `0` but doesn't add the `27` prefix
- The normalization is applied on display but not on storage (phone stored as `0821234567`)
- WhatsApp messages fail because the number format doesn't match WhatsApp's expected format

**Pass / fail criteria:**
- **Pass:** Phone stored as `27821234567`. No error shown. WhatsApp-compatible format.
- **Fail:** Phone stored with leading 0, or normalization produces wrong result.

---

### AH7 — Slot in the Past

**Category:** Validation
**What this verifies:** That a customer cannot book a slot that starts within 60 minutes or has already started.

**Preconditions:**
- A test slot exists with `start_time` 2 hours in the past (from Phase 2.4)
- A test slot exists with `start_time` 30 minutes from now (create fresh if needed)

**Setup steps:**
1. Create a slot starting in 30 minutes (within the 60-min cutoff):
   ```sql
   INSERT INTO slots (business_id, tour_id, start_time, status, capacity_total, booked, held)
   VALUES ('TEST_BUSINESS_ID', 'TEST_TOUR_ID', NOW() + INTERVAL '30 minutes', 'OPEN', 10, 0, 0)
   RETURNING id, start_time;
   ```

**Trigger:**
1. Open booking site → select tour
2. Look for the past slot and the 30-minute-away slot in the calendar

**Expected result:**
- **Past slot:** NOT visible in slot listing. Filtered by `start_time > NOW()` at the database level.
- **30-minute slot:** NOT visible. Filtered by `start_time > NOW() + 60 minutes` cutoff (`~/dev/booking/app/book/page.tsx:78-82`).
- No mechanism to submit a booking for either slot through the UI.

**Verification steps:**
1. Confirm neither slot appears in the booking site's slot picker for the relevant date.
2. Test the RPC directly for the past slot:
   ```sql
   SELECT * FROM create_hold_with_capacity_check('fake-id', 'PAST_SLOT_ID', 1, NOW() + INTERVAL '15 minutes');
   ```
   Note: The RPC does NOT check start_time. The cutoff is enforced only at the query level.
3. If the hold creation succeeds for a past slot via direct RPC, note this as a finding — the database-level protection is missing.

**Common failure modes:**
- The 60-minute cutoff is only client-side. A savvy user inspecting the API could book a slot starting in 5 minutes.
- Timezone issues: the cutoff calculation uses server time but the slot's `start_time` is in a different timezone

**Pass / fail criteria:**
- **Pass:** Neither slot visible in the booking UI. If testing direct API: note whether backend validation exists as a finding.
- **Fail:** Past or imminent slot appears in the UI and can be booked.

**If failed:** Check `~/dev/booking/app/book/page.tsx:78-86` for the cutoff filter and `list_available_slots` RPC in `supabase/migrations/20260321180000_filter_past_timeslots.sql:43`.

---

### AH10 — Expired Promo Code

**Category:** Validation
**What this verifies:** That a promo code past its `valid_until` date is rejected with the exact error message.

**Preconditions:**
- Test promo `EXPIREDPROMO` exists with `valid_until` in the past (from Phase 2.4)

**Setup steps:**
1. Verify promo state:
   ```sql
   SELECT code, active, valid_until FROM promotions WHERE code = 'EXPIREDPROMO';
   -- Expect: active = true, valid_until < NOW()
   ```

**Trigger:**
1. Open booking site → select tour/slot → enter customer details
2. Enter promo code `EXPIREDPROMO`
3. Click Apply

**Expected result:**
- Error displayed: **"This promo code has expired"**
- Promo NOT applied to the order
- No change to `used_count`

**Verification steps:**
1. Screenshot of error message.
2. ```sql
   SELECT used_count FROM promotions WHERE code = 'EXPIREDPROMO';
   -- Expect: 0 (unchanged)
   ```

**Expected error message:** "This promo code has expired"

**Pass / fail criteria:**
- **Pass:** Exact error message shown. `used_count` unchanged.
- **Fail:** Promo accepted, or error message differs.

**If failed:** Check `validate_promo_code` RPC at `supabase/migrations/20260401100000_promo_validation_rpc.sql:44-46`.

---

### AH11 — Exhausted Promo Code

**Category:** Validation
**What this verifies:** That a promo code at its `max_uses` limit is rejected.

**Preconditions:**
- Test promo `MAXEDPROMO` exists with `max_uses = 1`, `used_count = 1` (from Phase 2.4)

**Setup steps:**
1. Verify:
   ```sql
   SELECT code, max_uses, used_count FROM promotions WHERE code = 'MAXEDPROMO';
   -- Expect: max_uses = 1, used_count = 1
   ```

**Trigger:**
1. Open booking site → enter promo code `MAXEDPROMO` → Apply

**Expected result:**
- Error: **"This promo code is no longer available"**
- `used_count` unchanged at 1

**Verification steps:**
1. Screenshot of error.
2. ```sql
   SELECT used_count FROM promotions WHERE code = 'MAXEDPROMO';
   -- Expect: 1
   ```

**Expected error message:** "This promo code is no longer available"

**Pass / fail criteria:**
- **Pass:** Exact error shown. Count unchanged.
- **Fail:** Promo applied despite being exhausted.

---

### AH12 — Promo Minimum Order Not Met

**Category:** Validation
**What this verifies:** That a promo code with a `min_order` threshold rejects orders below that threshold.

**Preconditions:**
- Test promo `MINORDER` exists with `min_order = 1000.00` (from Phase 2.4)
- The test tour's price × quantity is below R1,000

**Setup steps:**
1. Verify:
   ```sql
   SELECT code, min_order FROM promotions WHERE code = 'MINORDER';
   -- Expect: min_order = 1000.00
   ```
2. Select a tour with `base_price_per_person` that produces a total under R1,000 (e.g., R300 × 2 = R600)

**Trigger:**
1. Open booking site → select tour → qty 2 (total R600) → enter promo `MINORDER` → Apply

**Expected result:**
- Error: **"Minimum order of R1000 required for this promo"** (the exact amount from the RPC)
- Promo NOT applied

**Verification steps:**
1. Screenshot of error message with the amount shown.
2. Verify the order total is displayed without the discount.

**Expected error message:** "Minimum order of R1000 required for this promo" (amount formatted from `min_order`)

**Pass / fail criteria:**
- **Pass:** Error includes the exact minimum amount. Promo not applied.
- **Fail:** Promo applied despite low order total, or error message lacks the amount.

---

### AH18 — Combo Booking — One Slot Full

**Category:** Validation (primary), Concurrency (secondary)
**What this verifies:** That a combo booking is rejected before payment when one of the two tour slots has no remaining capacity, with no partial booking created.

**VETO TEST — failure blocks production.**

**Preconditions:**
- An active combo offer exists linking Tour A and Tour B
- Tour A has an available slot with capacity
- Tour B has a slot at full capacity (`capacity_total - booked - held = 0`)

**Setup steps:**
1. Create or identify a combo offer:
   ```sql
   SELECT co.id, coi.tour_id, coi.business_id
   FROM combo_offers co
   JOIN combo_offer_items coi ON coi.combo_offer_id = co.id
   WHERE co.active = true AND co.business_id_a = 'TEST_BUSINESS_ID'
   LIMIT 1;
   ```
2. Create a full slot for Tour B:
   ```sql
   INSERT INTO slots (business_id, tour_id, start_time, status, capacity_total, booked, held)
   VALUES ('TOUR_B_BUSINESS_ID', 'TOUR_B_ID', NOW() + INTERVAL '5 days', 'OPEN', 5, 5, 0)
   RETURNING id;
   ```
3. Ensure Tour A has an available slot.

**Trigger:**
1. Open combo booking page → select date for Tour A (available slot) → select date for Tour B (full slot)
2. Enter customer details → Submit

Or directly via API:
```bash
curl -s -X POST "${SB_URL}/functions/v1/create-paysafe-checkout" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SB_ANON}" \
  -d '{
    "combo_offer_id": "COMBO_ID",
    "slot_a_id": "AVAILABLE_SLOT_A",
    "slot_b_id": "FULL_SLOT_B",
    "qty": 1,
    "customer_name": "Combo Tester",
    "customer_email": "tester.a@bookingtours.co.za",
    "customer_phone": "27710000001"
  }'
```

**Expected result:**
- Error returned BEFORE payment: **"Slot B does not have enough capacity (available: 0)"**
- No booking created for either Tour A or Tour B
- No combo_booking record created
- No holds created on either slot
- No payment initiated

**Verification steps:**
1. Check API response contains the capacity error.
2. ```sql
   SELECT COUNT(*) FROM bookings WHERE customer_email = 'tester.a@bookingtours.co.za' AND created_at > NOW() - INTERVAL '5 minutes';
   -- Expect: 0
   ```
3. ```sql
   SELECT COUNT(*) FROM combo_bookings WHERE created_at > NOW() - INTERVAL '5 minutes';
   -- Expect: 0
   ```
4. ```sql
   SELECT booked, held FROM slots WHERE id = 'AVAILABLE_SLOT_A';
   -- Expect: unchanged (no hold created on Tour A's slot)
   ```

**Expected error message:** "Slot B does not have enough capacity (available: 0)"

**Common failure modes:**
- Tour A's booking is created before Tour B's capacity is checked — partial booking state
- The capacity check passes because it uses a stale read of the slot
- The combo_booking record is created but the hold creation fails, leaving an orphaned combo record
- The error is returned but a hold was already placed on Slot A (not released)

**Pass / fail criteria:**
- **Pass:** Error before payment. Zero bookings. Zero combo records. Zero holds. Slot capacities unchanged.
- **Fail:** Any partial state — a booking for Tour A without Tour B, a combo record, a hold on either slot.

**If failed:** Check `create-paysafe-checkout/index.ts:38-46` — capacity checks should happen BEFORE any booking creation. If bookings are created first, this is a critical ordering bug.

---

### AH20 — Add-on with Zero Quantity

**Category:** Validation
**What this verifies:** That selecting an add-on and then setting its quantity to 0 removes it from the order total and does not persist it on the booking.

**Preconditions:**
- The test tour has at least one active add-on
- The booking site is accessible

**Setup steps:**
1. Verify add-ons exist:
   ```sql
   SELECT id, name, price FROM add_ons WHERE business_id = 'TEST_BUSINESS_ID' AND active = true LIMIT 3;
   ```

**Trigger:**
1. Open booking site → select tour/slot → go to add-ons section
2. Select an add-on (check the box or increment qty to 1)
3. Decrement quantity back to 0
4. Complete the booking

**Expected result:**
- The add-on is NOT included in the order total
- The order total reflects base price only (no add-on line)
- After booking completes, no `booking_add_ons` row exists for this booking
- The database `CHECK (qty > 0)` constraint on `booking_add_ons` prevents zero-qty inserts even if the filter fails

**Verification steps:**
1. Observe the booking summary — add-on should not appear in the line items.
2. ```sql
   SELECT * FROM booking_add_ons WHERE booking_id = 'NEW_BOOKING_ID';
   -- Expect: 0 rows
   ```

**Common failure modes:**
- The add-on is removed from the total display but still saved to `booking_add_ons` with qty 0 (which the CHECK constraint would reject, but the error might be unhandled)
- The filter `(selectedAddOns[ao.id] || 0) > 0` at `~/dev/booking/app/book/page.tsx:564` uses a truthy check that treats 0 as falsy — this is correct in JS but worth verifying

**Pass / fail criteria:**
- **Pass:** No add-on in order total. No `booking_add_ons` row. No DB error.
- **Fail:** Add-on appears in total, or a zero-qty row is attempted (causing a constraint violation).

---

## Category C: Degraded Mode / Failure Tests (AH13, AH19, AH21)

**Category setup:** These tests require specific environmental conditions. AH21 requires non-production environment access.

---

### AH13 — Draft Booking on Email Blur

**Category:** Degraded mode
**What this verifies:** That entering a name and email on the booking site and then leaving the page creates a DRAFT booking row as a best-effort lead capture, without holding capacity.

**Preconditions:**
- Booking site accessible
- A tour with available slots exists

**Setup steps:**
None — clean start.

**Trigger:**
1. Open booking site → select a tour → select a slot → select qty
2. Enter customer name: `Draft Tester`
3. Enter customer email: `draft.tester@bookingtours.co.za`
4. Click out of the email field (trigger blur event)
5. Wait 2 seconds for the async `saveDraft()` to complete
6. Navigate away from the page (close tab or go to another URL)

**Expected result:**
- A DRAFT booking row exists in the database with the entered name, email, and selected tour/slot
- No capacity is held — `held` column on the slot is unchanged
- No holds table entry exists
- No confirmation email is sent
- No WhatsApp message is sent
- The draft creation failing silently is acceptable (best-effort: `/* draft save is best-effort */` at `~/dev/booking/app/book/page.tsx:182`)

**How to confirm the dependency (draft mechanism) is present:**
The `saveDraft()` function is triggered by `onBlur` on the email field (`~/dev/booking/app/book/page.tsx:592`).

**Verification steps:**
1. ```sql
   SELECT id, status, customer_name, customer_email, slot_id, tour_id
   FROM bookings
   WHERE customer_email = 'draft.tester@bookingtours.co.za' AND status = 'DRAFT'
   ORDER BY created_at DESC LIMIT 1;
   -- Expect: one row with DRAFT status, correct name/email
   ```
2. ```sql
   SELECT held FROM slots WHERE id = 'SELECTED_SLOT_ID';
   -- Expect: unchanged from before the test
   ```
3. ```sql
   SELECT COUNT(*) FROM holds WHERE booking_id = 'DRAFT_BOOKING_ID';
   -- Expect: 0
   ```

**Common failure modes:**
- The `saveDraft()` function fails silently (by design) but the test doesn't verify whether the draft was actually created — always check the database
- The draft is created with the wrong status (PENDING instead of DRAFT)
- The draft accidentally holds capacity because it goes through the normal booking flow

**Pass / fail criteria:**
- **Pass:** DRAFT row exists in database. No capacity held. No side effects.
- **Fail:** No DRAFT row (unless the error is logged and handled gracefully — check browser console). Capacity held = CRITICAL fail.

**How to confirm return to normal:** Navigate back to the booking page and verify normal booking flow works. The DRAFT row should be updated (not duplicated) if the same email is entered again.

---

### AH19 — Paysafe Checkout Cancel

**Category:** Degraded mode
**What this verifies:** That when a customer cancels/abandons the Paysafe payment page during a combo booking, no combo booking is finalized, and both slot holds are eventually released.

**Preconditions:**
- A combo offer exists with two available slots
- Paysafe sandbox mode is active

**Setup steps:**
1. Identify or create a combo offer with available slots for both tours.
2. Record current `held` values for both slots:
   ```sql
   SELECT id, held FROM slots WHERE id IN ('SLOT_A_ID', 'SLOT_B_ID');
   ```

**Trigger:**
1. Open combo booking page → select slots for both tours → enter customer details
2. Click "Pay" to initiate Paysafe checkout
3. When the Paysafe payment overlay appears, **close it** (click X or navigate away) without completing payment

**Expected result:**
- No combo_booking record with status `PAID`
- Both bookings remain in `HELD` status (not transitioned to PAID)
- Holds on both slots remain temporarily (they expire after the hold duration)
- No confirmation emails or WhatsApp messages sent
- **Over time:** Holds should expire and capacity should be released. If there's no hold expiry mechanism, the holds persist indefinitely — flag this as a finding.

**How to confirm the dependency is broken:** The Paysafe overlay was closed without payment completion. No `PAYMENT_COMPLETED` webhook fires.

**Verification steps:**
1. ```sql
   SELECT id, payment_status FROM combo_bookings
   WHERE created_at > NOW() - INTERVAL '10 minutes'
   ORDER BY created_at DESC LIMIT 1;
   -- Expect: PENDING (not PAID)
   ```
2. ```sql
   SELECT id, status FROM bookings
   WHERE combo_booking_id = 'COMBO_ID' ORDER BY created_at DESC;
   -- Expect: both HELD (not PAID)
   ```
3. ```sql
   SELECT id, held FROM slots WHERE id IN ('SLOT_A_ID', 'SLOT_B_ID');
   -- Expect: held incremented by qty (holds still active)
   ```
4. Wait for hold expiry period (15 minutes or as configured), then re-check:
   ```sql
   SELECT id, held FROM slots WHERE id IN ('SLOT_A_ID', 'SLOT_B_ID');
   -- Expect: held decremented back (holds expired and released)
   ```
   **If holds don't expire automatically:** Flag as a finding — needs a hold cleanup cron job.

**Common failure modes:**
- Holds never expire — the combo_bookings record sits as PENDING forever, and capacity is permanently reduced
- The combo_booking record is marked as FAILED (which would trigger hold release via the webhook handler) even though no webhook fired
- Both bookings are left in HELD status with no mechanism to clean them up

**Pass / fail criteria:**
- **Pass:** No PAID combo booking. Holds are released (either automatically or via a cleanup mechanism). No customer notifications.
- **Partial pass:** Holds exist but will expire. Note the expiry mechanism and time.
- **Fail:** Holds never released, or partial booking state persists indefinitely.

**How to confirm return to normal:** Verify the slots' `held` values return to pre-test levels after the hold expiry period.

---

### AH21 — Resend API Key Missing

**Category:** Degraded mode
**What this verifies:** That `marketing-dispatch` returns 503 gracefully when `RESEND_API_KEY` is missing, without crashing or producing misleading output.

**Preconditions:**
- Access to a non-production Supabase environment where secrets can be modified
- OR willingness to verify by code inspection only

**Setup steps:**
1. **If staging available:** Remove the API key:
   ```bash
   supabase secrets unset RESEND_API_KEY
   ```
2. **Verify key is removed:** Call the function and check for 503.

**Trigger:**
```bash
curl -s -X POST "${SB_URL}/functions/v1/marketing-dispatch" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SB_KEY}" \
  -d '{"campaign_id": "test-missing-key"}' \
  -w "\nHTTP: %{http_code}\n"
```

**Expected result:**
- HTTP 503
- Response body: `{"error": "RESEND_API_KEY not set"}`
- No crash, no unhandled exception, no stack trace
- No emails attempted (no Resend API calls)
- The function returns cleanly
- Console log: `"MARKETING_DISPATCH: RESEND_API_KEY not configured — skipping"`

**How to confirm the dependency is broken:** Call the function and verify the 503 response.

**Verification steps:**
1. HTTP status code = 503 (not 500, not 200)
2. Response body contains `"RESEND_API_KEY not set"` (not a stack trace or generic error)
3. Check Supabase Edge Function logs — should show the console.error message, no unhandled exceptions
4. No entries in any email-sending log table

**After test — restore:**
```bash
supabase secrets set RESEND_API_KEY=<saved_value>
# Verify restoration:
curl -s -X POST "${SB_URL}/functions/v1/marketing-dispatch" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SB_KEY}" \
  -d '{"campaign_id": "test-restored-key"}' \
  -w "\nHTTP: %{http_code}\n"
# Should NOT return 503
```

**Common failure modes:**
- The function returns 503 but the response body is empty or contains a Deno runtime error
- The function reads the key at import time (module scope), not at request time — removing the key requires a function redeployment
- The `console.error` is present but the function continues executing anyway (check: does it `return` after the 503 response?)

**Pass / fail criteria:**
- **Pass:** HTTP 503 with clear error message. No crash. No emails sent.
- **Fail:** HTTP 500, stack trace visible, misleading success response, or email sending attempted.

**If failed:** Read `marketing-dispatch/index.ts:17-20`. The guard should be:
```typescript
if (!RESEND_API_KEY) {
  console.error("MARKETING_DISPATCH: RESEND_API_KEY not configured — skipping");
  return jsonRes({ error: "RESEND_API_KEY not set" }, 503);
}
```
Verify that `RESEND_API_KEY` is read from `Deno.env.get()` at function scope and that the guard is the first check.

---

## Category D: Race Condition / Concurrency Tests (AH8, AH14, AH15)

**Category setup:** Run these LAST within their group. They may leave the database in states that need cleanup. Use the concurrent execution scripts from Phase 2.3.

---

### AH8 — Multiple Tabs (Admin)

**Category:** Concurrency (primary), UI (secondary)
**What this verifies:** That two browser tabs open on the same admin account function independently without data corruption or session conflicts.

**CLARIFICATION APPLIED:** "Real-time sync" is defined as: changes made in Tab A are visible in Tab B after a page refresh or navigation event. True push-based sync (Supabase Realtime) is confirmed only for the inbox/chat page. Other pages require manual refresh.

**Preconditions:**
- Logged into the admin dashboard as a MAIN_ADMIN user
- At least one booking exists

**Setup steps:**
1. Open two browser tabs to the admin dashboard.
2. Navigate Tab A to the Bookings page.
3. Navigate Tab B to the Bookings page.

**Trigger:**
1. In Tab A: Change a booking's status (e.g., mark a PENDING booking as PAID via "Mark Paid" button).
2. In Tab B: Refresh the page (F5 or navigate away and back).
3. Observe whether Tab B shows the updated status.
4. In Tab B: Perform a different action (e.g., add a note to a different booking).
5. In Tab A: Refresh.
6. **Inbox-specific test:** Open both tabs to Inbox. In Tab A, receive or send a chat message. Observe whether Tab B shows the message without refresh (via Realtime subscription).

**Expected result:**
- **Both tabs function independently:** No authentication conflicts, no session errors, no "logged out" messages.
- **Bookings page:** Changes from one tab visible in the other AFTER refresh. No requirement for live push.
- **Inbox page:** Messages appear in both tabs WITHOUT refresh (Supabase Realtime).
- **No data corruption:** Both tabs can read and write without producing inconsistent state.

**Concurrency method:** Manual (two browser tabs, same session).
**Invariant:** No stale-state-based write corruption. If Tab A shows "status: PENDING" and Tab B has already changed it to "PAID," Tab A's subsequent write should not revert the status.

**Verification steps:**
1. After Tab A's action: confirm the database reflects the change.
2. After Tab B refreshes: confirm it shows the updated state.
3. After both actions: confirm no duplicate records, no reverted states.
4. Inbox: confirm real-time message delivery without refresh.
5. Check browser console in both tabs for errors (network errors, auth errors, subscription errors).

**Common failure modes:**
- Stale data in one tab: Tab A shows the old status and allows an action that conflicts with Tab B's change (e.g., cancelling a booking Tab B already cancelled)
- Session token refresh: One tab's token refresh invalidates the other tab's session
- Realtime subscription fails silently: The inbox appears to work but messages are duplicated or missed

**Pass / fail criteria:**
- **Pass:** Both tabs function without errors. Data consistent after refresh. Inbox shows real-time updates.
- **Fail:** Session conflicts, data corruption, or silent subscription failures.

---

### AH14 — Concurrent Hold Race

**Category:** Concurrency
**What this verifies:** That when two customers attempt to book the last available spot simultaneously, the database's atomic hold creation prevents double-booking. Exactly one succeeds; the other gets a clean error.

**VETO TEST — failure blocks production.**

**Preconditions:**
- Test slot with `capacity_total = 1`, `booked = 0`, `held = 0` (from Phase 2.4)
- Two distinct test customers
- The booking endpoint is reachable

**Setup steps:**
1. Create the slot:
   ```sql
   INSERT INTO slots (business_id, tour_id, start_time, status, capacity_total, booked, held)
   VALUES ('TEST_BUSINESS_ID', 'TEST_TOUR_ID', NOW() + INTERVAL '4 days', 'OPEN', 1, 0, 0)
   RETURNING id;
   ```
2. Verify:
   ```sql
   SELECT capacity_total, booked, held FROM slots WHERE id = 'RACE_SLOT_ID';
   -- Expect: 1, 0, 0
   ```
3. Save the concurrent booking script from Phase 2.3.

**Trigger:**
```bash
./test-concurrent-bookings.sh RACE_SLOT_ID TEST_TOUR_ID 2
```

**Expected result:**
- **Exactly one** request returns success (booking created with HELD status)
- **Exactly one** request returns error: "Sorry, those spots were just taken! Please try another time slot." (or similar capacity error)
- Slot state: `capacity_total = 1`, `held = 1`. The `held` value MUST be exactly 1, **never 2**.
- **Exactly one** booking row exists for this slot
- **No partial state:** No booking row for the losing customer. No orphaned holds.

**Concurrency method:** Bash script with `curl &` background processes, N=2 parallel requests.
**Synchronisation:** Requests launched within the same millisecond window via backgrounding.
**Invariant:** `slots.held <= slots.capacity_total` at ALL times, including during the race window.

**Verification steps:**
1. ```sql
   SELECT capacity_total, booked, held FROM slots WHERE id = 'RACE_SLOT_ID';
   -- Expect: 1, 0, 1
   ```
2. ```sql
   SELECT id, customer_email, status FROM bookings WHERE slot_id = 'RACE_SLOT_ID' AND created_at > NOW() - INTERVAL '5 minutes';
   -- Expect: exactly 1 row, status = HELD
   ```
3. Compare the two response files in `/tmp/concurrent_test_*/` — exactly one success, one failure.
4. ```sql
   SELECT COUNT(*) FROM holds WHERE slot_id = 'RACE_SLOT_ID' AND status = 'ACTIVE';
   -- Expect: 0 or 1 (depends on whether the booking flow uses holds table)
   ```
5. Check Supabase Edge Function logs for any 500 errors during the race window.

**After the test — escalation rounds:**
1. **Reset:** Delete test booking, reset slot to `held = 0`
2. **Round 2 (N=5):** Run with 5 parallel requests against capacity=1. Expect exactly 1 success, 4 failures.
3. **Round 3 (N=10 against capacity=3):** Create slot with capacity=3. Run 10 parallel. Expect exactly 3 successes, 7 failures.

**Common failure modes:**
- Both succeed because the hold logic uses `SELECT ... ; ... UPDATE` instead of `SELECT ... FOR UPDATE` or atomic `UPDATE WHERE` — classic read-then-write race
- The losing request returns HTTP 500 instead of a clean 400/409 with user-friendly message
- Both succeed at the application layer but one is "compensated" by a cleanup process later — silent corruption
- The hold creation succeeds but the capacity increment fails, leaving `held` out of sync

**Pass / fail criteria:**
- **Pass:** Exactly 1 success, exactly 1 clean error, `held = 1`, 1 booking row. No 500 errors.
- **Fail:** ANY of: both succeed, `held > capacity`, 500 errors, orphaned state.

**If failed:**
1. Check `create_hold_with_capacity_check` in `supabase/migrations/20260319110000_atomic_hold_creation.sql` — does it use `SELECT...FOR UPDATE`?
2. Check the transaction isolation level: `SHOW default_transaction_isolation;` (should be `read committed` minimum with `FOR UPDATE` locking)
3. Check whether there's a CHECK constraint: `SELECT conname FROM pg_constraint WHERE conrelid = 'slots'::regclass;`

---

### AH15 — Concurrent Voucher Drain

**Category:** Concurrency
**What this verifies:** That two simultaneous voucher deductions against the same voucher cannot over-spend the balance. Atomic deduction prevents the total deducted from exceeding the voucher's value.

**VETO TEST — failure blocks production.**

**Preconditions:**
- Test voucher `RACETEST` with `current_balance = 100.00` (from Phase 2.4)
- Two concurrent deduction requests, each for R80 (total R160 > R100 balance)

**Setup steps:**
1. Verify voucher:
   ```sql
   SELECT id, code, current_balance, status FROM vouchers WHERE code = 'RACETEST';
   -- Expect: current_balance = 100.00, status = ACTIVE
   ```
2. Save the voucher ID.

**Trigger:**
```bash
./test-concurrent-voucher.sh VOUCHER_ID 80 2
```

**Expected result:**
- **One request** deducts R80 successfully → `remaining = 20`
- **Other request** deducts R20 (capped at remaining balance) → `remaining = 0`
  OR: Second request returns `"No balance remaining"` if the first fully depleted balance
- **Final balance:** Between R0 and R20, but NEVER negative
- **Total deducted:** At most R100 (the original balance)
- **Voucher status:** If balance reaches 0 → auto-transitions to `REDEEMED`

**Concurrency method:** Bash script with parallel `curl &` calls to the `deduct_voucher_balance` RPC.
**Invariant:** `vouchers.current_balance >= 0` at all times. Total deducted across all concurrent requests <= original balance.

**Verification steps:**
1. ```sql
   SELECT current_balance, status FROM vouchers WHERE code = 'RACETEST';
   -- Expect: current_balance >= 0
   ```
2. Compare both response payloads — at most R100 total deducted.
3. If one returned an error: verify it was a clean error message, not a 500.

**After test — escalation:**
1. Reset voucher: `UPDATE vouchers SET current_balance = 100.00, status = 'ACTIVE' WHERE code = 'RACETEST';`
2. **Round 2 (N=5 × R30):** 5 parallel requests for R30 each (total R150 > R100). At most 3 full + 1 partial should succeed.
3. **Round 3 (N=10 × R20):** 10 parallel for R20 each (total R200 > R100). Exactly 5 should succeed.

**Common failure modes:**
- Both requests read `current_balance = 100` before either deducts, and both deduct R80 → balance goes to -R60 (classic read-then-write)
- The `SELECT...FOR UPDATE` lock is present but the deduction uses a separate transaction
- The `LEAST(p_amount, v_new_balance)` capping logic uses the pre-lock balance instead of the locked balance

**Pass / fail criteria:**
- **Pass:** Balance never negative. Total deducted <= original balance. Clean errors for insufficient balance.
- **Fail:** Negative balance, over-deduction, or 500 errors.

**If failed:** Check `deduct_voucher_balance` in `supabase/migrations/20260319130000_atomic_voucher_deduction.sql:31-35` — does it use `FOR UPDATE`? Is the deduction calculation `LEAST(p_amount, current_balance)` computed AFTER the lock?

---

## Category E: UI / Responsive Tests (AH16, AH17, AH22)

**Category setup:** Run in a single sitting per device. Desktop first (fastest), then DevTools mobile emulation, then real devices.

---

### AH16 — Mobile Responsive (Admin Dashboard)

**Category:** UI
**What this verifies:** That the admin dashboard is usable on mobile devices — the mobile menu drawer works, all primary pages are navigable, and interactive elements are tappable.

**Preconditions:**
- Logged into the admin dashboard
- Chrome DevTools responsive mode enabled

**Viewports to test:** 375×667 (iPhone SE), 393×852 (iPhone 14), 768×1024 (iPad)

**Setup steps:**
1. Open Chrome → admin dashboard → DevTools → Toggle Device Toolbar
2. Set viewport to 375×667

**Trigger:** Navigate through every primary admin page at each viewport.

**Pages to test:**

| # | Page | What to verify |
|---|------|---------------|
| 1 | Dashboard (/) | Stats cards readable, no horizontal scroll |
| 2 | Bookings (/bookings) | Mobile card view visible (table hidden), filter dropdowns usable |
| 3 | Booking detail (/bookings/[id]) | All sections readable, action buttons tappable |
| 4 | New Booking (/new-booking) | Form fields full-width, date picker usable |
| 5 | Slots (/slots) | Calendar navigable, slot cards readable |
| 6 | Inbox (/inbox) | Conversation list + message view, keyboard doesn't hide input |
| 7 | Weather (/weather) | Forecast cards readable |
| 8 | Photos (/photos) | Image grid adapts |
| 9 | Reports (/reports) | Charts resize, legends readable |
| 10 | Marketing (/marketing) | Campaign list readable, email builder usable |
| 11 | Settings (/settings) | All form fields accessible |
| 12 | Billing (/billing) | Invoice table readable |

**Expected result per page:**
- No horizontal scrolling
- All text readable at default zoom (minimum 14px effective size)
- All interactive elements tappable (minimum 44×44px touch target)
- Mobile menu drawer (hamburger icon) opens and closes correctly
- Primary CTA visible without scrolling (or reachable within one scroll)
- Tables switch to card view on mobile (`md:hidden` / `md:block` pattern)
- No content cut off or overlapping

**Verification steps:**
1. At each viewport × page combination:
   - [ ] No horizontal scroll
   - [ ] Text readable
   - [ ] Interactive elements tappable
   - [ ] Mobile menu works
   - [ ] No visual overflow or overlap
2. Screenshot any failures.

**Pass / fail criteria:**
- **Pass:** All pages pass all checks at all viewports.
- **Fail per page:** Note which viewport and which check failed. Classify severity per Phase 5 rubric.

---

### AH17 — Mobile Responsive (Booking Site)

**Category:** UI
**What this verifies:** That the customer-facing booking flow is fully functional on mobile devices — from tour selection through payment.

**Preconditions:**
- Booking site accessible
- A tour with available slots exists

**Viewports:** 375×667, 393×852, 320×568 (iPhone 5/SE 1st gen — stress test)

**Trigger:** Complete the entire booking flow at each viewport:
1. Landing/tour selection
2. Calendar date picker
3. Time slot selection
4. Quantity selector
5. Customer details form (name, email, phone)
6. Add-ons selection
7. Voucher/promo code entry
8. Payment summary
9. Redirect to Yoco payment page (Yoco's page is outside our control)

**Expected result per step:**
- Calendar: Dates tappable, month navigation works, selected date highlighted
- Slot picker: Time slots visible, capacity shown, tappable
- Form fields: Full-width, keyboard doesn't obscure fields, labels visible
- Add-ons: Quantity controls (+/-) tappable at small sizes
- Payment summary: All line items visible, total prominent
- No horizontal scroll at any step
- Complete flow achievable without zooming

**Verification steps:**
1. At each viewport × step:
   - [ ] Functionality works (can select, enter, proceed)
   - [ ] No horizontal scroll
   - [ ] Touch targets adequate (44×44px minimum)
   - [ ] Text readable without zooming
   - [ ] No overlapping elements
2. Complete at least one full booking at 375px width.

**Pass / fail criteria:**
- **Pass:** Full booking flow completable at all viewports. No blocking UI issues.
- **Fail:** Any step where the user cannot proceed due to UI issues.

---

### AH22 — Dark Mode Toggle

**Category:** UI
**What this verifies:** That toggling between dark and light mode renders all pages correctly, with no contrast issues, missing backgrounds, or invisible text.

**Preconditions:**
- Logged into admin dashboard
- Theme toggle accessible (ThemeToggle component)

**Setup steps:**
1. Navigate to admin dashboard
2. Locate theme toggle (usually in header or settings)
3. Confirm current mode (check `html` element for `light` or `dark` class)

**Trigger:**
1. Click theme toggle to switch to dark mode
2. Navigate through every page listed in AH16
3. Toggle back to light mode
4. Navigate through every page again

**Pages requiring extra attention in dark mode:**
- Any page with hardcoded hex colors (e.g., `#ffffff`, `#111827`) instead of CSS variables
- Tables with white backgrounds
- Charts/graphs (may use libraries with their own color schemes)
- Modals and dropdowns (may not inherit the theme)
- Toast notifications
- The booking detail page's status badges
- Email template preview (if it uses an iframe)

**Expected result per page in EACH mode:**
- Background and text have adequate contrast (WCAG AA minimum: 4.5:1 ratio for text)
- No invisible text (white-on-white or black-on-black)
- No "flash" of wrong theme on page load
- Status badges remain distinguishable
- Interactive elements (buttons, links, inputs) are visible and styled
- Toggle persists across page navigation (stored in localStorage as `ck_theme`)

**Verification steps:**
1. Per page, per mode:
   - [ ] Text visible and readable
   - [ ] Backgrounds appropriate (no white panels in dark mode)
   - [ ] Interactive elements visible
   - [ ] No contrast violations
2. Toggle back and forth 3 times rapidly — no visual artifacts or stuck states.
3. Refresh the page — correct mode persists from localStorage.

**Pass / fail criteria:**
- **Pass:** All pages render correctly in both modes. Toggle persists.
- **Fail per page:** Note which page and which element has contrast/visibility issues.

---

# Phase 4 — Cross-Cutting Checks

These derived tests catch failure patterns that individual tests miss.

---

### CC1 — Silent Partial Failure (Idempotency Side Effects)

**Applies to:** AH1, AH5, AH6, AH9
**What this catches:** The second attempt is "rejected" at the application layer but still creates a partial side effect — a duplicate log entry, an updated timestamp, a queued email.

**Test script:**
For each idempotency test, after the second attempt:

1. **Check ALL observable surfaces, not just the primary one:**
   ```sql
   -- Full side-effect audit for AH1 (double webhook)
   SELECT COUNT(*) FROM idempotency_keys WHERE key LIKE 'yoco_payment:test_pay_%';  -- Expect: 1
   SELECT COUNT(*) FROM logs WHERE booking_id = 'BID' AND event = 'booking_confirmation_notifications_sent';  -- Expect: 1
   SELECT COUNT(*) FROM logs WHERE booking_id = 'BID';  -- ALL log entries, not just confirmation
   SELECT COUNT(*) FROM invoices WHERE booking_id = 'BID';  -- Expect: 1
   SELECT confirmation_sent_at FROM bookings WHERE id = 'BID';  -- Should NOT be updated by second call
   ```

2. **Check for "shadow" side effects:**
   ```sql
   -- Were any auto_messages triggered?
   SELECT COUNT(*) FROM auto_messages WHERE booking_id = 'BID';
   -- Was there a second email dispatch entry?
   -- Check Resend dashboard for delivery count to the test email
   ```

3. **For AH9 (promo):** After second promo attempt:
   ```sql
   SELECT used_count FROM promotions WHERE code = 'ONCEONLY';  -- Must still be 1
   SELECT COUNT(*) FROM promotion_uses WHERE promotion_id = 'PID';  -- Must still be 1
   ```

**Pass criteria:** ALL counts match expected (not just the primary one). No "extra" rows anywhere.

---

### CC2 — Error Message Accuracy (Validation)

**Applies to:** AH2, AH3, AH7, AH10, AH11, AH12
**What this catches:** The system returns an error, but the message is vague ("Something went wrong") instead of actionable ("This promo code has expired").

**Test script:**
For each validation test, capture the EXACT error text shown to the user:

| Test | Expected Error Text | Acceptable? |
|------|-------------------|-------------|
| AH2 | "Sorry, those spots were just taken! Please try another time slot." | Yes — actionable |
| AH3 | "Expired" | Marginally — could be clearer ("This voucher has expired") |
| AH10 | "This promo code has expired" | Yes — specific |
| AH11 | "This promo code is no longer available" | Yes — but "no longer available" is vague about WHY |
| AH12 | "Minimum order of R1000 required for this promo" | Yes — includes the amount |

**Verification:** Screenshot each error. Compare exact text to the table. If the actual text differs from expected, note the difference. If the text says "An error occurred" or "Something went wrong" without specifics, mark as **Major** bug.

**Pass criteria:** Every error message tells the user what went wrong AND what to do about it.

---

### CC3 — Concurrency Invariant Proof (Escalation)

**Applies to:** AH14, AH15
**What this catches:** A race condition that only fires at higher concurrency levels.

**Test script:**

**AH14 escalation:**
1. N=2, capacity=1 → must produce exactly 1 success (baseline test)
2. N=5, capacity=1 → must produce exactly 1 success, 4 failures
3. N=10, capacity=3 → must produce exactly 3 successes, 7 failures
4. After each round, verify: `held <= capacity_total` and booking count = success count

**AH15 escalation:**
1. N=2, R80 each against R100 balance (baseline)
2. N=5, R30 each against R100 balance → at most R100 total deducted
3. N=10, R20 each against R100 balance → exactly 5 full deductions
4. After each round, verify: `current_balance >= 0`

**Between rounds:** Reset state (delete bookings, reset slot/voucher).

**Pass criteria:** Invariant holds at ALL concurrency levels. A failure at N=10 that passes at N=2 is still a failure.

---

### CC4 — Degraded Mode User Experience (AH21)

**Applies to:** AH21
**What this catches:** The system returns 503 correctly but the user-facing experience is broken.

**Test script:**
1. With RESEND_API_KEY missing, trigger a marketing campaign send from the admin UI (not curl).
2. Observe what the admin user sees:
   - Do they see "Service unavailable" or a useful message?
   - Does the campaign status update to "FAILED" or stay stuck at "SENDING"?
   - Is there an indication of what went wrong?
   - Does the page hang/crash?

**Verification:**
1. Campaign record status:
   ```sql
   SELECT id, status FROM marketing_campaigns WHERE id = 'TEST_CAMPAIGN_ID';
   -- Should be FAILED or SCHEDULED (not stuck at SENDING)
   ```
2. Admin UI shows a toast/notification with the error.
3. No unhandled JS errors in browser console.

**Pass criteria:** Admin sees a clear error, campaign doesn't get stuck, no page crash.

---

### CC5 — Combined AH18 × AH14 (Concurrent Combo Race)

**Applies to:** AH18 + AH14 (derived test)
**What this catches:** Two simultaneous combo bookings where Tour B has only one spot left. Worse than either test individually.

**Preconditions:**
- Combo offer linking Tour A (ample capacity) and Tour B (capacity = 1)
- Two test customers

**Test script:**
1. Create slots: Tour A capacity=10, Tour B capacity=1
2. Fire two simultaneous combo booking requests:
   ```bash
   # Request 1
   curl -s -X POST "${SB_URL}/functions/v1/create-paysafe-checkout" \
     -d '{"combo_offer_id":"CID","slot_a_id":"SA","slot_b_id":"SB","qty":1,"customer_name":"Race 1","customer_email":"race1@test.com","customer_phone":"27710000001"}' &

   # Request 2
   curl -s -X POST "${SB_URL}/functions/v1/create-paysafe-checkout" \
     -d '{"combo_offer_id":"CID","slot_a_id":"SA","slot_b_id":"SB","qty":1,"customer_name":"Race 2","customer_email":"race2@test.com","customer_phone":"27710000002"}' &

   wait
   ```
3. Verify:
   ```sql
   SELECT held FROM slots WHERE id = 'SB';  -- Tour B: must be <= 1
   SELECT COUNT(*) FROM bookings WHERE slot_id = 'SB' AND status = 'HELD';  -- Must be <= 1
   SELECT COUNT(*) FROM combo_bookings WHERE created_at > NOW() - INTERVAL '5 minutes';  -- Must be <= 1
   ```

**Invariant:** Tour B's `held <= capacity_total`. At most one combo booking succeeds. The losing request must not leave partial state (booking for Tour A but not Tour B).

**Pass criteria:** Exactly one combo succeeds. The loser gets a clean error. No partial bookings.

---

### CC6 — Mobile UI Under Poor Network

**Applies to:** AH16, AH17
**What this catches:** UIs that work on fast wifi but break on real mobile networks.

**Test script:**
1. Open Chrome DevTools → Network → Throttle → **"Slow 3G"** (400ms RTT, 400kbps)
2. Load the booking site at 375px viewport
3. Complete the full booking flow
4. Load the admin dashboard at 375px viewport
5. Navigate through 3 primary pages (bookings, inbox, slots)

**Verify at each step:**
- [ ] Page loads within 10 seconds (not 30+)
- [ ] Loading indicators/spinners appear while waiting
- [ ] No "blank screen" state where the page appears empty
- [ ] Interactive elements become usable before all resources load
- [ ] Images have appropriate `loading="lazy"` or placeholders
- [ ] The booking submission doesn't timeout
- [ ] No duplicate submission from users tapping "Submit" multiple times on slow connection

**Pass criteria:** Booking flow completable on Slow 3G. Admin dashboard navigable (may be slow but not broken).

---

### CC7 — Cancellation Cleanup Verification (AH19)

**Applies to:** AH19
**What this catches:** Half-cleaned-up checkout state that accumulates over time.

**Test script:**
After AH19 test (Paysafe checkout cancel):
1. Check the combo_bookings record:
   ```sql
   SELECT id, payment_status, created_at FROM combo_bookings
   WHERE created_at > NOW() - INTERVAL '1 hour'
   AND payment_status = 'PENDING';
   ```
2. If records exist with `PENDING` status and no payment completed:
   - Are they ever cleaned up?
   - Is there a cron job that marks stale PENDING combos as ABANDONED?
   - Check `supabase/functions/cron-tasks/index.ts` for cleanup logic.

3. Check holds:
   ```sql
   SELECT h.id, h.status, h.expires_at, h.created_at
   FROM holds h
   JOIN bookings b ON b.id = h.booking_id
   JOIN combo_bookings cb ON cb.id = b.combo_booking_id
   WHERE cb.payment_status = 'PENDING'
   AND h.status = 'ACTIVE'
   AND h.expires_at < NOW();
   ```
   If expired holds exist with status still ACTIVE → no cleanup mechanism.

**Verification:** After 30 minutes:
```sql
-- Are there stale PENDING combo records with expired holds?
SELECT cb.id, cb.payment_status, cb.created_at,
       COUNT(h.id) FILTER (WHERE h.status = 'ACTIVE') AS active_holds,
       COUNT(h.id) FILTER (WHERE h.expires_at < NOW()) AS expired_holds
FROM combo_bookings cb
LEFT JOIN bookings b ON b.combo_booking_id = cb.id
LEFT JOIN holds h ON h.booking_id = b.id
WHERE cb.payment_status = 'PENDING'
AND cb.created_at < NOW() - INTERVAL '30 minutes'
GROUP BY cb.id, cb.payment_status, cb.created_at;
```

**Pass criteria:** Either (a) a cleanup mechanism exists and runs, or (b) flag as finding: "Stale PENDING combo_bookings accumulate — needs cleanup cron."

---

### CC8 — Dark Mode Page Coverage

**Applies to:** AH22
**What this catches:** Dark mode works on main pages but breaks on edge-case pages nobody tested.

**Full page list to test in BOTH light and dark mode:**

| # | Page | Priority | Notes |
|---|------|----------|-------|
| 1 | Dashboard (/) | High | Main landing |
| 2 | Bookings list (/bookings) | High | Table/card view |
| 3 | Booking detail (/bookings/[id]) | High | Status badges, info rows |
| 4 | New Booking (/new-booking) | High | Form inputs, date picker |
| 5 | Slots (/slots) | High | Calendar, capacity indicators |
| 6 | Inbox (/inbox) | High | Chat bubbles, input area |
| 7 | Weather (/weather) | Medium | Forecast cards |
| 8 | Photos (/photos) | Medium | Image grid |
| 9 | Reports (/reports) | Medium | Charts may use hardcoded colors |
| 10 | Marketing (/marketing) | Medium | Campaign list, email builder |
| 11 | Marketing templates (/marketing/templates) | Medium | Template preview |
| 12 | Pricing (/pricing) | Medium | Price tables |
| 13 | Vouchers (/vouchers) | Medium | Table + create form |
| 14 | Refunds (/refunds) | Medium | Table |
| 15 | Invoices (/invoices) | Medium | PDF preview may not support dark |
| 16 | Settings (/settings) | Medium | Form fields, toggles |
| 17 | Billing (/billing) | Medium | Invoice table |
| 18 | Broadcasts (/broadcasts) | Medium | Message composer |
| 19 | Operators (/operators) | Low | Simple list |
| 20 | 404 page | Low | Often forgotten |
| 21 | Login/auth page | Low | May use different theme context |
| 22 | Empty states (any page with no data) | Low | "No results" messages |

**For each page, check:**
- [ ] Text visible (not white-on-white or black-on-black)
- [ ] Backgrounds appropriate (no white panels in dark mode)
- [ ] Borders visible
- [ ] Status badges/pills distinguishable
- [ ] Charts/graphs readable
- [ ] Modals/dropdowns inherit theme
- [ ] No flash of wrong theme

**Pass criteria:** All High-priority pages pass both modes. Medium-priority pages pass or are flagged as Minor issues. Low-priority failures are acceptable post-launch.

---

# Phase 5 — Reporting & Triage

## 5.1 Severity Classification Rubric

| Severity | Definition | Examples | Action |
|----------|-----------|----------|--------|
| **CRITICAL** | Real data corruption, real money loss, or real customer harm. The system does something harmful, not just something wrong. | Double-booking (AH14), double-charge (AH1), voucher over-spend (AH15), partial combo booking (AH18), duplicate promo use enabling fraud (AH9) | **Block production.** Fix before launch. No exceptions. |
| **MAJOR** | Confusing user experience, support burden, operator frustration. No data corruption, but the system fails to communicate or function correctly in a common scenario. | Vague error messages (CC2), mobile UI blocking a booking step (AH17), dark mode broken on main page (AH22), stale state across tabs (AH8), campaign stuck at SENDING (CC4) | **Fix before launch.** Can ship with documented workaround if fix is delayed. |
| **MINOR** | Cosmetic, low-impact, or affects rare scenarios. The system works but doesn't look great or has a rough edge. | Dark mode broken on 404 page, slight overflow at 320px, add-on qty=0 creates a benign empty row, phone normalization edge case | **Ship and fix later.** Track in backlog. |

## 5.2 Veto Criteria

These tests have veto power. If ANY fails, the system is not production-ready:

| Test | Veto reason |
|------|------------|
| **AH1** | Duplicate charges harm customers financially |
| **AH9** | Promo fraud costs the business money |
| **AH14** | Double-booking breaks the core product promise |
| **AH15** | Voucher over-spend is financial loss |
| **AH18** | Partial combo booking leaves customers with broken trips |

## 5.3 Test Report Template

Copy this template for each test. Every failure MUST have a severity.

```
### AH{N} — {Test Name}
**Status:** [ ] PASS  [ ] FAIL  [ ] BLOCKED  [ ] SKIPPED
**Severity (if FAIL):** [ ] CRITICAL  [ ] MAJOR  [ ] MINOR
**Tested by:** {name}
**Date:** {YYYY-MM-DD}
**Environment:** {production / staging / local}
**Device/viewport:** {if UI test}

**Result:**
{What actually happened}

**Evidence:**
- Screenshot: {path or link}
- SQL verification: {query result}
- HTTP response: {status + body}

**Discrepancy (if FAIL):**
{What was expected vs. what happened}

**Root cause (if known):**
{File:line or description of the bug}

**Notes:**
{Any additional observations, edge cases found, or suggestions}
```

## 5.4 Summary Report Template

```
# Edge Case Test Report — BookingTours
**Date:** {YYYY-MM-DD}
**Tested by:** {names}
**Environment:** {environment}
**Real devices used:** [ ] Yes  [ ] No (DevTools only)

## Results Summary

| Severity | Count | Tests |
|----------|-------|-------|
| CRITICAL | {n} | {list} |
| MAJOR | {n} | {list} |
| MINOR | {n} | {list} |
| PASS | {n} | {list} |
| BLOCKED | {n} | {list} |
| SKIPPED | {n} | {list} |

## Veto Check

| Test | Status | Veto? |
|------|--------|-------|
| AH1 | {PASS/FAIL} | {Y/N} |
| AH9 | {PASS/FAIL} | {Y/N} |
| AH14 | {PASS/FAIL} | {Y/N} |
| AH15 | {PASS/FAIL} | {Y/N} |
| AH18 | {PASS/FAIL} | {Y/N} |

## Go / No-Go Recommendation

[ ] **GO** — All veto tests pass, no CRITICAL bugs, MAJOR bugs have workarounds
[ ] **NO-GO** — Veto test failure or unresolved CRITICAL bugs
[ ] **CONDITIONAL GO** — No CRITICAL bugs, but MAJOR bugs need fix timeline

## Gaps & Limitations

- Real device testing: {done / not done}
- Staging environment: {available / not available — impacts AH21}
- Hold expiry mechanism: {confirmed / not confirmed — impacts AH19}
- AH8 real-time sync scope: {inbox only / all pages}

## Critical Findings

{List any bugs found that weren't in the original 22 tests}

## Recommended Follow-Up

{Actions for any MAJOR/MINOR bugs deferred to post-launch}
```

---

## Appendix: Proposed Additional Tests

During research, these edge cases emerged that are not in the original 22:

| ID | Test | Category | Why |
|----|------|----------|-----|
| AH23 | **Hold expiry cleanup** | Degraded mode | No automatic hold expiry mechanism was found. Abandoned holds may accumulate indefinitely, reducing available capacity over time. |
| AH24 | **Concurrent promo code race** | Concurrency | AH9 tests sequential duplicate use. Two simultaneous first-uses of a `max_uses=1` promo by different emails should produce exactly 1 success — untested. |
| AH25 | **Booking for past slot via direct API** | Validation | The 60-min cutoff is only in the booking site query filter. The `create_hold_with_capacity_check` RPC does NOT validate start_time. A savvy user could bypass the UI and book a past slot. |
| AH26 | **Combo booking where BOTH slots are full** | Validation | AH18 tests one slot full. Both full should produce a clean error, not two error messages that confuse the user. |
| AH27 | **Voucher timezone edge case** | Validation | A voucher expiring at midnight UTC is still valid in SAST (UTC+2) until 2am. If the comparison uses mixed timezones, vouchers may be prematurely rejected or accepted past expiry. |

---

## Execution Order (Recommended)

**Day 1 Morning — Validation tests (~2 hours):**
AH4 → AH3 → AH10 → AH11 → AH12 → AH2 → AH7 → AH20 → AH18

**Day 1 Midday — Idempotency tests (~1.5 hours):**
AH1 → AH9 → AH5 → AH6

**Day 1 Afternoon — Degraded mode + Concurrency (~2.5 hours):**
AH13 → AH21 → AH19 → AH14 (with N=2,5,10) → AH15 (with N=2,5,10) → AH8

**Day 1 Late afternoon — Cross-cutting checks (~1.5 hours):**
CC1 → CC2 → CC3 → CC4 → CC5 → CC7

**Day 2 (or Day 1 evening) — UI tests (~2 hours):**
AH16 → AH17 → AH22 → CC6 → CC8

**Total estimated:** 1 full day for core tests, half day for UI and cross-cuts.
