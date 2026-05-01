# Weather Cancellation Test Plan — BookingTours

**Version:** 1.0
**Date:** 2026-04-14
**Author:** Claude (for Gideon / Alicia)
**Scope:** 6 behavioural tests (L1–L6) + 9 cross-cutting accuracy checks

---

## Table of Contents

1. [Phase 1 — Implementation Verification](#phase-1--implementation-verification)
2. [Phase 2 — Test Environment Preparation](#phase-2--test-environment-preparation)
3. [Phase 3 — Per-Test Execution Scripts](#phase-3--per-test-execution-scripts)
4. [Phase 4 — Accuracy and Cross-Cutting Checks](#phase-4--accuracy-and-cross-cutting-checks)
5. [Phase 5 — Reporting](#phase-5--reporting)

---

## Phase 1 — Implementation Verification

### 1A. Implementation Map

There are **two code paths** for weather cancellation:

| Path | Location | Used By | Notes |
|------|----------|---------|-------|
| **Edge function** | `supabase/functions/weather-cancel/index.ts` | Weather page (`app/weather/page.tsx`) | Preferred path. Accepts `slot_ids[]`, processes in bulk. |
| **Inline client-side** | `app/slots/page.tsx` lines 85–320 | Slots calendar page | Duplicate implementation, runs cancel logic directly from the browser via Supabase client. |

**The edge function is the primary path tested below.** The slots page inline path is a secondary concern — flag it for dedup refactoring later but test the edge function path.

### 1B. Per-Test Implementation Trace

#### L1 — Cancel Slot (Weather)

| Aspect | Detail |
|--------|--------|
| **Trigger** | Operator clicks "Cancel and notify all" on Weather page → POST to `/functions/v1/weather-cancel` |
| **Code** | `weather-cancel/index.ts` line 31 |
| **DB writes** | `slots.status` → `CLOSED` (line 31) |
| **External services** | None for slot closure itself |
| **Transaction model** | Single UPDATE, not wrapped in a DB transaction with booking cancellations |

#### L2 — Paid Bookings Cancelled

| Aspect | Detail |
|--------|--------|
| **Code** | `weather-cancel/index.ts` lines 33–67 |
| **DB reads** | `bookings` WHERE `business_id` AND `slot_id IN slot_ids` AND `status IN ('PAID','CONFIRMED','HELD','PENDING')` |
| **DB writes** | Per booking: `bookings.status` → `CANCELLED`, `cancellation_reason`, `cancelled_at`. For PAID/CONFIRMED: also `refund_status` → `ACTION_REQUIRED`, `refund_amount`, `refund_notes`. Per slot: decrements `slots.booked` and `slots.held`. Per hold: `holds.status` → `CANCELLED`. |
| **Transaction model** | **Sequential per-booking, NOT transactional.** Each booking is updated individually in a for-loop. If the function crashes mid-loop, some bookings will be cancelled and others won't. |

**CONFIRMED BEHAVIOUR:** The code cancels ALL active statuses (PAID, CONFIRMED, HELD, PENDING). This is correct — HELD/PENDING should be cancelled when the payment link has timed out since the trip isn't happening. Only PAID/CONFIRMED get `refund_status: ACTION_REQUIRED` (correct, since HELD/PENDING had no payment taken).

#### L3 — Customer Notifications

| Aspect | Detail |
|--------|--------|
| **Code** | `weather-cancel/index.ts` lines 79–132 |
| **WhatsApp** | Sent per-booking via `sendWhatsappTextForTenant()` with template fallback `weather_cancellation`. Message differs for paid vs unpaid customers. |
| **Email** | Sent per-booking via HTTP POST to `send-email` function with `type: "CANCELLATION"`, `is_weather: true`. Email template at `send-email/index.ts` line 784+ uses weather-specific language and a "Manage My Booking" CTA button. |
| **Dispatch model** | **SYNCHRONOUS, in the same for-loop as cancellation.** No queue, no worker. Each booking's WhatsApp and email are sent inline before moving to the next booking. |
| **Error handling** | try/catch per notification — error is logged (`console.error`) but does NOT stop the loop. The booking is still cancelled even if notification fails. |

**PERFORMANCE FLAG:** For L5 (bulk cancel of e.g. 80 bookings), this means 80 sequential WhatsApp sends + 80 sequential email sends. At ~1s per WhatsApp send, that's ~80s+ of execution time. Supabase edge functions have a default timeout. For large bulk operations, this could time out.

**PARTIAL FAILURE FLAG:** If WhatsApp fails for one customer, the booking is already cancelled but the customer doesn't know. There is no retry mechanism — the failed notification is lost (only logged to console). This is the exact "partial notification" failure mode the test plan must catch.

#### L4 — Self-Service Options

| Aspect | Detail |
|--------|--------|
| **WhatsApp message** | Includes `manageBookingUrl` — resolved from `business.manage_bookings_url` or derived from subdomain (e.g., `https://capekayak.booking.bookingtours.co.za/my-bookings`) |
| **Email** | Contains a green "Manage My Booking" button linking to the same URL |
| **Self-service UI** | Lives in the **separate booking site** (`~/Desktop/booking`), NOT this admin app. The My Bookings page lets customers choose reschedule / voucher / refund. |
| **Authentication** | Customer authenticates via OTP or booking lookup — no bearer token in the link itself |
| **Implementation status** | The links are generated and sent. The actual self-service reschedule/voucher/refund UI is in the booking site — **verify it exists and works by clicking the link manually.** |

#### L5 — Bulk Weather Cancel

| Aspect | Detail |
|--------|--------|
| **Code** | Same edge function, same code path. Weather page sends all visible slot IDs in one request: `slot_ids: allSlotIds`. |
| **Bulk operation** | Slot closure is a single `.in("id", slot_ids)` UPDATE. Booking cancellation + notification is sequential per-booking for ALL bookings across ALL slots. |
| **Transactionality** | **NOT atomic across slots.** Slots are closed in one UPDATE, but bookings are processed one at a time. A failure mid-way leaves a partial state. |

#### L6 — Reopen After Weather

| Aspect | Detail |
|--------|--------|
| **Code** | `app/slots/page.tsx` lines 340–390 — **CLIENT-SIDE ONLY**, no edge function. |
| **Trigger** | Operator selects dates on the calendar, clicks "Reopen Slots" |
| **DB writes** | `slots.status` → `OPEN` for all CLOSED slots on selected dates |
| **What it does NOT do** | Does NOT reinstate cancelled bookings. Does NOT send notifications. Does NOT adjust capacity counters. |
| **Timezone** | Uses **hardcoded `+02:00` (SAST)** for date boundaries — `new Date(dateStr + "T00:00:00+02:00")`. This will be wrong during SAST (South Africa doesn't observe DST, so +02:00 is always correct for SAST — this is actually fine). |

**CONFIRMED:** After reopening, cancelled bookings remain cancelled — customers must rebook. The reopened slot is empty and available for new bookings. This is correct behaviour.

### 1C. Implementation Gaps

| # | Gap | Severity | Impact |
|---|-----|----------|--------|
| 1 | **No notification retry mechanism.** Failed WhatsApp/email sends are logged but never retried. A customer whose notification fails will never be told their trip is cancelled. | **HIGH** | Customer shows up at the harbour. |
| 2 | **No idempotency guard on the edge function.** Calling it twice with the same slot_ids won't double-cancel (bookings are already CANCELLED, so the second call finds nothing) but slot closure is a no-op UPDATE. Safe, not guarded. | LOW | No customer harm, but no explicit protection. |
| 3 | **Synchronous dispatch.** Bulk cancel of 50+ bookings risks edge function timeout. | MEDIUM | Partial cancellation — some customers cancelled and notified, others not. |
| 4 | **No notification log table.** The function logs to `logs` table at the end with aggregate counts, but does not record per-customer notification success/failure. | MEDIUM | Cannot audit "did customer X receive their notification?" after the fact. |
| 5 | **Duplicate cancel logic in slots page.** `app/slots/page.tsx` has its own inline cancel implementation. If the edge function is fixed/improved, the slots page version will drift. | LOW | Maintenance risk, not customer-facing. |

### Phase 1 Sign-Off Gate

- [ ] Confirmed: HELD + PENDING bookings are intentionally cancelled (not just PAID/CONFIRMED)
- [ ] Confirmed: Cancelled bookings stay cancelled after reopen (not reinstated)
- [ ] Acknowledged: No notification retry — accepted risk or will fix before go-live?
- [ ] Acknowledged: Synchronous dispatch — accepted risk for typical slot sizes (< 20 bookings)?

---

## Phase 2 — Test Environment Preparation

### 2A. Environment Recommendation

**Recommended: Production with isolation safeguards.** Same reasoning as the cron test plan — no staging environment exists, and the weather-cancel edge function must be tested where it actually runs (Supabase edge runtime + WhatsApp API + Resend).

**Safeguards:**
1. Use the existing test business (or create one as per the cron test plan)
2. All test customers named `WXTEST_*`
3. Use 3 distinct test WhatsApp numbers you control
4. Use Gmail aliases (`gideon+wx1@gmail.com`, `gideon+wx2@gmail.com`, etc.)
5. Clean up after testing

### 2B. Test Data Setup

#### Create test tour and slots

```sql
-- Use existing TEST_BIZ_ID and TEST_TOUR_ID from cron test plan,
-- or create new ones per that plan's Phase 2B.

-- SLOT A: tomorrow 09:00 (single-slot tests L1, L2, L3, L4)
INSERT INTO slots (id, tour_id, business_id, start_time, capacity_total, booked, held, status)
VALUES (
  gen_random_uuid(),
  '<TEST_TOUR_ID>',
  '<TEST_BIZ_ID>',
  (CURRENT_DATE + INTERVAL '1 day' + INTERVAL '9 hours')::timestamptz,
  20, 0, 0, 'OPEN'
)
RETURNING id;
-- >>> Save as SLOT_A_ID

-- SLOT B: tomorrow 13:00 (for L5 multi-slot test)
INSERT INTO slots (id, tour_id, business_id, start_time, capacity_total, booked, held, status)
VALUES (
  gen_random_uuid(),
  '<TEST_TOUR_ID>',
  '<TEST_BIZ_ID>',
  (CURRENT_DATE + INTERVAL '1 day' + INTERVAL '13 hours')::timestamptz,
  20, 0, 0, 'OPEN'
)
RETURNING id;
-- >>> Save as SLOT_B_ID

-- SLOT C: tomorrow 16:00 (for L5 multi-slot test)
INSERT INTO slots (id, tour_id, business_id, start_time, capacity_total, booked, held, status)
VALUES (
  gen_random_uuid(),
  '<TEST_TOUR_ID>',
  '<TEST_BIZ_ID>',
  (CURRENT_DATE + INTERVAL '1 day' + INTERVAL '16 hours')::timestamptz,
  20, 0, 0, 'OPEN'
)
RETURNING id;
-- >>> Save as SLOT_C_ID
```

#### Create test bookings — mixed statuses for L2

```sql
-- Helper: create N PAID bookings on a slot
-- Repeat with different customer names, phones, emails
-- Use 3 real WhatsApp numbers rotated across bookings

-- 5 PAID bookings on SLOT_A
INSERT INTO bookings (id, business_id, tour_id, slot_id, customer_name, phone, email, qty, status, total_amount)
VALUES
  (gen_random_uuid(), '<TEST_BIZ_ID>', '<TEST_TOUR_ID>', '<SLOT_A_ID>', 'WXTEST_01 Alice',   '+27XXXXXXXXX', 'gideon+wx1@gmail.com', 2, 'PAID', 500),
  (gen_random_uuid(), '<TEST_BIZ_ID>', '<TEST_TOUR_ID>', '<SLOT_A_ID>', 'WXTEST_02 Bob',     '+27YYYYYYYYY', 'gideon+wx2@gmail.com', 1, 'PAID', 250),
  (gen_random_uuid(), '<TEST_BIZ_ID>', '<TEST_TOUR_ID>', '<SLOT_A_ID>', 'WXTEST_03 Charlie', '+27ZZZZZZZZZ', 'gideon+wx3@gmail.com', 3, 'PAID', 750),
  (gen_random_uuid(), '<TEST_BIZ_ID>', '<TEST_TOUR_ID>', '<SLOT_A_ID>', 'WXTEST_04 Dina',    '+27XXXXXXXXX', 'gideon+wx4@gmail.com', 2, 'PAID', 500),
  (gen_random_uuid(), '<TEST_BIZ_ID>', '<TEST_TOUR_ID>', '<SLOT_A_ID>', 'WXTEST_05 Elsa',    '+27YYYYYYYYY', 'gideon+wx5@gmail.com', 1, 'PAID', 250);

-- 1 CONFIRMED booking
INSERT INTO bookings (id, business_id, tour_id, slot_id, customer_name, phone, email, qty, status, total_amount)
VALUES (gen_random_uuid(), '<TEST_BIZ_ID>', '<TEST_TOUR_ID>', '<SLOT_A_ID>', 'WXTEST_06 Frank', '+27ZZZZZZZZZ', 'gideon+wx6@gmail.com', 2, 'CONFIRMED', 500);

-- 1 HELD booking (no payment)
INSERT INTO bookings (id, business_id, tour_id, slot_id, customer_name, phone, email, qty, status, total_amount)
VALUES (gen_random_uuid(), '<TEST_BIZ_ID>', '<TEST_TOUR_ID>', '<SLOT_A_ID>', 'WXTEST_07 Grace', '+27XXXXXXXXX', 'gideon+wx7@gmail.com', 1, 'HELD', 0);

-- 1 PENDING booking (no payment)
INSERT INTO bookings (id, business_id, tour_id, slot_id, customer_name, phone, email, qty, status, total_amount)
VALUES (gen_random_uuid(), '<TEST_BIZ_ID>', '<TEST_TOUR_ID>', '<SLOT_A_ID>', 'WXTEST_08 Henry', '+27YYYYYYYYY', 'gideon+wx8@gmail.com', 1, 'PENDING', 0);

-- 1 already-CANCELLED booking (should not be touched)
INSERT INTO bookings (id, business_id, tour_id, slot_id, customer_name, phone, email, qty, status, cancelled_at, cancellation_reason, total_amount)
VALUES (gen_random_uuid(), '<TEST_BIZ_ID>', '<TEST_TOUR_ID>', '<SLOT_A_ID>', 'WXTEST_09 Irene', '+27ZZZZZZZZZ', 'gideon+wx9@gmail.com', 1, 'CANCELLED', NOW() - INTERVAL '1 day', 'Customer requested', 250);

-- 1 booking with NO phone (email only) — tests email-only notification
INSERT INTO bookings (id, business_id, tour_id, slot_id, customer_name, phone, email, qty, status, total_amount)
VALUES (gen_random_uuid(), '<TEST_BIZ_ID>', '<TEST_TOUR_ID>', '<SLOT_A_ID>', 'WXTEST_10 Jan', NULL, 'gideon+wx10@gmail.com', 1, 'PAID', 250);

-- Update slot booked/held counts to match
UPDATE slots SET booked = 12, held = 1 WHERE id = '<SLOT_A_ID>';
```

After inserting, verify:
```sql
SELECT id, customer_name, status, total_amount, phone IS NOT NULL AS has_phone, email IS NOT NULL AS has_email
FROM bookings
WHERE slot_id = '<SLOT_A_ID>'
ORDER BY customer_name;
-- Expect: 10 rows with the distribution above
```

#### Bulk test data for L5

```sql
-- Create 5 PAID bookings on SLOT_B
INSERT INTO bookings (id, business_id, tour_id, slot_id, customer_name, phone, email, qty, status, total_amount)
VALUES
  (gen_random_uuid(), '<TEST_BIZ_ID>', '<TEST_TOUR_ID>', '<SLOT_B_ID>', 'WXTEST_B1 Kim',   '+27XXXXXXXXX', 'gideon+wxb1@gmail.com', 2, 'PAID', 500),
  (gen_random_uuid(), '<TEST_BIZ_ID>', '<TEST_TOUR_ID>', '<SLOT_B_ID>', 'WXTEST_B2 Liam',  '+27YYYYYYYYY', 'gideon+wxb2@gmail.com', 1, 'PAID', 250),
  (gen_random_uuid(), '<TEST_BIZ_ID>', '<TEST_TOUR_ID>', '<SLOT_B_ID>', 'WXTEST_B3 Mia',   '+27ZZZZZZZZZ', 'gideon+wxb3@gmail.com', 3, 'PAID', 750),
  (gen_random_uuid(), '<TEST_BIZ_ID>', '<TEST_TOUR_ID>', '<SLOT_B_ID>', 'WXTEST_B4 Noah',  '+27XXXXXXXXX', 'gideon+wxb4@gmail.com', 2, 'PAID', 500),
  (gen_random_uuid(), '<TEST_BIZ_ID>', '<TEST_TOUR_ID>', '<SLOT_B_ID>', 'WXTEST_B5 Olive', '+27YYYYYYYYY', 'gideon+wxb5@gmail.com', 1, 'PAID', 250);
UPDATE slots SET booked = 9 WHERE id = '<SLOT_B_ID>';

-- Create 5 PAID bookings on SLOT_C
INSERT INTO bookings (id, business_id, tour_id, slot_id, customer_name, phone, email, qty, status, total_amount)
VALUES
  (gen_random_uuid(), '<TEST_BIZ_ID>', '<TEST_TOUR_ID>', '<SLOT_C_ID>', 'WXTEST_C1 Pete',  '+27ZZZZZZZZZ', 'gideon+wxc1@gmail.com', 2, 'PAID', 500),
  (gen_random_uuid(), '<TEST_BIZ_ID>', '<TEST_TOUR_ID>', '<SLOT_C_ID>', 'WXTEST_C2 Quinn', '+27XXXXXXXXX', 'gideon+wxc2@gmail.com', 1, 'PAID', 250),
  (gen_random_uuid(), '<TEST_BIZ_ID>', '<TEST_TOUR_ID>', '<SLOT_C_ID>', 'WXTEST_C3 Rita',  '+27YYYYYYYYY', 'gideon+wxc3@gmail.com', 3, 'PAID', 750),
  (gen_random_uuid(), '<TEST_BIZ_ID>', '<TEST_TOUR_ID>', '<SLOT_C_ID>', 'WXTEST_C4 Sam',   '+27ZZZZZZZZZ', 'gideon+wxc4@gmail.com', 2, 'PAID', 500),
  (gen_random_uuid(), '<TEST_BIZ_ID>', '<TEST_TOUR_ID>', '<SLOT_C_ID>', 'WXTEST_C5 Tina',  '+27XXXXXXXXX', 'gideon+wxc5@gmail.com', 1, 'PAID', 250);
UPDATE slots SET booked = 9 WHERE id = '<SLOT_C_ID>';
```

### 2C. Manual Trigger

The weather cancel can be triggered via curl:

```bash
curl -X POST 'https://ukdsrndqhsatjkmxijuj.supabase.co/functions/v1/weather-cancel' \
  -H 'Authorization: Bearer <SUPABASE_ANON_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{
    "slot_ids": ["<SLOT_A_ID>"],
    "business_id": "<TEST_BIZ_ID>",
    "reason": "Testing — storm forecast"
  }'
```

Or via the Weather page UI at `/weather` in the admin dashboard.

### 2D. Self-Service Link Verification

The self-service link in notifications points to the booking site's My Bookings page. To verify it works in the test environment:

1. Check what `manage_bookings_url` is set to for the test business:
   ```sql
   SELECT manage_bookings_url, booking_site_url, subdomain FROM businesses WHERE id = '<TEST_BIZ_ID>';
   ```
2. If NULL, it will derive from subdomain: `https://<subdomain>.booking.bookingtours.co.za/my-bookings`
3. For a test business with subdomain `crontest`, the link would be `https://crontest.booking.bookingtours.co.za/my-bookings`
4. If this domain doesn't resolve, set `manage_bookings_url` explicitly to a working URL

### Phase 2 Sign-Off Gate

- [ ] Test business, tour, and 3 slots created
- [ ] 10 bookings on Slot A (mixed statuses), 5 each on Slots B and C
- [ ] 3 distinct test WhatsApp numbers verified
- [ ] 10 distinct test email aliases created
- [ ] Self-service link URL confirmed as reachable
- [ ] Manual curl trigger tested (returns 200 with `ok: true` on a disposable slot)

---

## Phase 3 — Per-Test Execution Scripts

### Recommended Execution Order

| Order | Tests | Reason |
|-------|-------|--------|
| 1 | **L1 + L2 + L3** | Shared setup on Slot A. L1 is the trigger, L2 + L3 are immediate verification. |
| 2 | **L4** | Depends on L3 — uses the notification links sent in L3. |
| 3 | **L5** | Bulk cancel on Slots B + C. Independent of L1–L4. |
| 4 | **L6** | Reopen Slot A (already closed by L1). Must run after L1. |

---

### L1 + L2 + L3 — Cancel Slot, Bookings Cancelled, Notifications Sent

These three tests share one trigger and are verified together.

**What this verifies:**
- L1: A slot can be closed for weather via the edge function.
- L2: Every active booking on that slot is cancelled. PAID/CONFIRMED get `refund_status: ACTION_REQUIRED`. HELD/PENDING are cancelled without refund fields. Already-CANCELLED bookings are untouched.
- L3: Every affected customer receives a WhatsApp (if they have a phone) and an email (if they have an email). Paid customers get self-service options. Unpaid customers get a simpler notice.

**Preconditions:**
- Slot A exists with status OPEN
- 10 bookings exist on Slot A (5 PAID, 1 CONFIRMED, 1 HELD, 1 PENDING, 1 already-CANCELLED, 1 PAID with no phone)
- Test WhatsApp numbers are active
- Test email addresses are receiving mail

**Setup — verify initial state:**

```sql
-- Record the exact booking IDs and statuses before triggering
SELECT id, customer_name, status, total_amount,
       phone IS NOT NULL AS has_phone, email IS NOT NULL AS has_email
FROM bookings
WHERE slot_id = '<SLOT_A_ID>'
  AND customer_name LIKE 'WXTEST_%'
ORDER BY customer_name;
-- Save this result — you'll compare against it after the trigger
```

```sql
-- Verify slot is OPEN
SELECT id, status, booked, held FROM slots WHERE id = '<SLOT_A_ID>';
-- Expect: OPEN, booked=12, held=1
```

**Trigger:**

```bash
curl -X POST 'https://ukdsrndqhsatjkmxijuj.supabase.co/functions/v1/weather-cancel' \
  -H 'Authorization: Bearer <SUPABASE_ANON_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{
    "slot_ids": ["<SLOT_A_ID>"],
    "business_id": "<TEST_BIZ_ID>",
    "reason": "Testing — storm forecast"
  }'
```

**Expected response:**
```json
{"ok": true, "slots_closed": 1, "bookings_cancelled": 9}
```

(9 because: 5 PAID + 1 CONFIRMED + 1 HELD + 1 PENDING + 1 PAID-no-phone = 9 active bookings. The already-CANCELLED booking is not counted.)

**Verification — L1 (Slot closed):**

```sql
-- V-L1-1: Slot status
SELECT status FROM slots WHERE id = '<SLOT_A_ID>';
-- Expect: CLOSED
```

**Verification — L2 (Bookings cancelled):**

```sql
-- V-L2-1: All booking statuses after cancel
SELECT id, customer_name, status, refund_status, refund_amount, cancelled_at, cancellation_reason
FROM bookings
WHERE slot_id = '<SLOT_A_ID>'
  AND customer_name LIKE 'WXTEST_%'
ORDER BY customer_name;
```

Expected row-by-row:

| Customer | Before | After Status | refund_status | refund_amount | cancelled_at | reason |
|----------|--------|-------------|---------------|---------------|-------------|--------|
| WXTEST_01 Alice (PAID) | PAID | CANCELLED | ACTION_REQUIRED | 500 | set | Weather... |
| WXTEST_02 Bob (PAID) | PAID | CANCELLED | ACTION_REQUIRED | 250 | set | Weather... |
| WXTEST_03 Charlie (PAID) | PAID | CANCELLED | ACTION_REQUIRED | 750 | set | Weather... |
| WXTEST_04 Dina (PAID) | PAID | CANCELLED | ACTION_REQUIRED | 500 | set | Weather... |
| WXTEST_05 Elsa (PAID) | PAID | CANCELLED | ACTION_REQUIRED | 250 | set | Weather... |
| WXTEST_06 Frank (CONFIRMED) | CONFIRMED | CANCELLED | ACTION_REQUIRED | 500 | set | Weather... |
| WXTEST_07 Grace (HELD) | HELD | CANCELLED | NULL | NULL | set | Weather... |
| WXTEST_08 Henry (PENDING) | PENDING | CANCELLED | NULL | NULL | set | Weather... |
| WXTEST_09 Irene (CANCELLED) | CANCELLED | **CANCELLED (unchanged)** | NULL | NULL | yesterday | Customer requested |
| WXTEST_10 Jan (PAID, no phone) | PAID | CANCELLED | ACTION_REQUIRED | 250 | set | Weather... |

```sql
-- V-L2-2: Capacity released
SELECT booked, held FROM slots WHERE id = '<SLOT_A_ID>';
-- Expect: booked = 0, held = 0
```

```sql
-- V-L2-3: Active holds cancelled
SELECT id, status FROM holds WHERE booking_id IN (
  SELECT id FROM bookings WHERE slot_id = '<SLOT_A_ID>' AND customer_name LIKE 'WXTEST_%'
) AND status = 'ACTIVE';
-- Expect: 0 rows
```

**Verification — L3 (Notifications):**

```sql
-- V-L3-1: Check logs table for the weather_cancel event
SELECT event, payload FROM logs
WHERE event = 'weather_cancel'
  AND payload->>'slot_ids' LIKE '%<SLOT_A_ID>%'
ORDER BY created_at DESC
LIMIT 1;
-- Expect: bookings_cancelled = 9, paid_action_required = 6
```

Manual verification (cannot be automated from SQL):

- **V-L3-2:** Check 3 test WhatsApp numbers. Each should have received messages for their bookings:
  - `+27XXXXXXXXX`: Messages for Alice (PAID), Dina (PAID), Grace (HELD — unpaid variant)
  - `+27YYYYYYYYY`: Messages for Bob (PAID), Elsa (PAID), Henry (PENDING — unpaid variant)
  - `+27ZZZZZZZZZ`: Messages for Charlie (PAID), Frank (CONFIRMED)
  - Jan (no phone): NO WhatsApp

- **V-L3-3:** Check email inboxes. Each `gideon+wxN@gmail.com` should have one cancellation email:
  - wx1–wx6, wx10: Weather cancellation email with "Your options" block (reschedule/voucher/refund)
  - wx7–wx8: Weather cancellation email with simpler "no payment was taken" variant
  - wx9: NO email (already-cancelled, not affected)

- **V-L3-4:** Verify PAID customer emails contain the "Manage My Booking" button with a working link
- **V-L3-5:** Verify unpaid customer emails do NOT contain refund options
- **V-L3-6:** Verify WXTEST_09 Irene received NO email and NO WhatsApp

**Common failure modes:**
- Edge function returns 401 — wrong auth token (use anon key for JWT-verified functions)
- WhatsApp template `weather_cancellation` not approved in Meta — fallback to free-form text succeeds only within 24h window
- Email fails silently — check `send-email` function logs
- Slot capacity goes negative — `GREATEST(0, ...)` should prevent this
- WXTEST_09 (already cancelled) gets accidentally re-cancelled — her `cancelled_at` and `cancellation_reason` would change

**Pass criteria:**
- [ ] L1: Slot is CLOSED
- [ ] L2: All 9 active bookings CANCELLED. 6 have `ACTION_REQUIRED`. 3 do not. Irene unchanged.
- [ ] L3: 8 WhatsApp messages sent (9 affected minus 1 with no phone). 9 emails sent. Irene got nothing.

**If failed:** Check Supabase Dashboard → Edge Functions → `weather-cancel` → Logs. Look for `WA weather-cancel err` or `Email weather-cancel err`. Then check `send-email` logs.

---

### L4 — Self-Service Options

**What this verifies:** That the links in the cancellation notifications actually work — clicking "Manage My Booking" takes the customer to a UI where they can choose reschedule, voucher, or refund.

**Preconditions:** L3 has been executed. You have the cancellation email for at least one PAID test customer.

**Steps:**

1. Open the cancellation email for WXTEST_01 Alice in your Gmail inbox
2. Click the "Manage My Booking" button
3. Verify the page loads (not a 404 or broken URL)
4. Verify the page shows Alice's specific cancelled booking with:
   - Tour name
   - Original date/time
   - Cancellation reason mentioning weather
   - Options: Reschedule / Get Voucher / Request Refund
5. If authentication is required (OTP), complete it and verify you see YOUR booking, not someone else's
6. Repeat for one WhatsApp link — tap the `manageBookingUrl` in the WhatsApp message

**Verification:**
- V-L4-1: Link resolves (HTTP 200, not 404)
- V-L4-2: Page shows the correct booking reference
- V-L4-3: Reschedule option is clickable
- V-L4-4: Voucher option is clickable
- V-L4-5: Refund option is clickable

**Note:** Testing the actual reschedule/voucher/refund EXECUTION is a separate test plan. L4 only verifies the links work and the options are presented.

**Pass criteria:**
- [ ] Link works for both email and WhatsApp
- [ ] Correct booking displayed
- [ ] All three options visible and clickable

---

### L5 — Bulk Weather Cancel

**What this verifies:** That cancelling multiple slots in one request processes all bookings across all slots, notifies all affected customers, and the operation completes without partial failure.

**Preconditions:**
- Slots B and C exist with status OPEN
- 5 PAID bookings each on Slots B and C (10 total)
- All bookings have phone and email

**Trigger:**

```bash
curl -X POST 'https://ukdsrndqhsatjkmxijuj.supabase.co/functions/v1/weather-cancel' \
  -H 'Authorization: Bearer <SUPABASE_ANON_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{
    "slot_ids": ["<SLOT_B_ID>", "<SLOT_C_ID>"],
    "business_id": "<TEST_BIZ_ID>",
    "reason": "Testing — full storm day"
  }'
```

**Expected response:**
```json
{"ok": true, "slots_closed": 2, "bookings_cancelled": 10}
```

**Verification:**

```sql
-- V-L5-1: Both slots closed
SELECT id, status FROM slots WHERE id IN ('<SLOT_B_ID>', '<SLOT_C_ID>');
-- Expect: both CLOSED

-- V-L5-2: All 10 bookings cancelled with refund status
SELECT id, customer_name, status, refund_status, slot_id
FROM bookings
WHERE slot_id IN ('<SLOT_B_ID>', '<SLOT_C_ID>')
  AND customer_name LIKE 'WXTEST_%'
ORDER BY customer_name;
-- Expect: 10 rows, all CANCELLED, all ACTION_REQUIRED

-- V-L5-3: Capacity released on both slots
SELECT id, booked, held FROM slots WHERE id IN ('<SLOT_B_ID>', '<SLOT_C_ID>');
-- Expect: both booked = 0, held = 0
```

**Notification audit (critical):**
- V-L5-4: Check all 3 test WhatsApp numbers. Count total unique messages received. Expected: 10 (some phones will have multiple messages for different bookings)
- V-L5-5: Check all 10 email inboxes (`gideon+wxb1` through `gideon+wxc5`). Each should have exactly 1 cancellation email.

```sql
-- V-L5-6: Verify the log entry
SELECT payload->>'bookings_cancelled' AS cancelled,
       payload->>'paid_action_required' AS refunds
FROM logs
WHERE event = 'weather_cancel'
  AND payload->>'reason' = 'Testing — full storm day'
ORDER BY created_at DESC
LIMIT 1;
-- Expect: cancelled = 10, refunds = 10
```

**Pass criteria:**
- [ ] Both slots CLOSED
- [ ] All 10 bookings CANCELLED with ACTION_REQUIRED
- [ ] Exactly 10 WhatsApp messages sent
- [ ] Exactly 10 emails sent
- [ ] Response returned within 30 seconds (performance check)

---

### L6 — Reopen After Weather

**What this verifies:** That after weather clears, an operator can reopen previously-closed slots, making them available for new bookings. Previously-cancelled bookings stay cancelled.

**Preconditions:** Slot A was closed by L1. It has 9 cancelled bookings on it.

**Trigger:** Navigate to the Slots page (`/slots`). Select tomorrow's date on the calendar. Click "Reopen Slots".

Or via SQL (to test without the UI):
```sql
UPDATE slots SET status = 'OPEN' WHERE id = '<SLOT_A_ID>';
```

**Verification:**

```sql
-- V-L6-1: Slot is OPEN again
SELECT status, booked, held, capacity_total FROM slots WHERE id = '<SLOT_A_ID>';
-- Expect: OPEN, booked = 0, held = 0, capacity_total = 20

-- V-L6-2: Cancelled bookings are STILL cancelled (not reinstated)
SELECT id, status FROM bookings
WHERE slot_id = '<SLOT_A_ID>'
  AND customer_name LIKE 'WXTEST_%'
  AND status != 'CANCELLED';
-- Expect: 0 rows (all should still be CANCELLED, including the pre-existing one)

-- V-L6-3: Slot is bookable (available capacity > 0)
SELECT capacity_total - booked - COALESCE(held, 0) AS available
FROM slots
WHERE id = '<SLOT_A_ID>';
-- Expect: 20 (full capacity, since all bookings were cancelled)
```

- V-L6-4: No notifications sent for the reopen (check WhatsApp — no new messages)

**Pass criteria:**
- [ ] Slot is OPEN with full capacity
- [ ] All cancelled bookings remain cancelled
- [ ] Slot is available for new bookings
- [ ] No customer notifications triggered by the reopen

---

## Phase 4 — Accuracy and Cross-Cutting Checks

### CC-W1 — All-Customers-Notified Audit

**What this verifies:** That 100% of affected customers received both WhatsApp and email. Not 90%, not 95% — 100%.

**Run after L1+L2+L3 on Slot A (9 affected bookings):**

```sql
-- Count affected bookings with phone
SELECT COUNT(*) AS expected_wa FROM bookings
WHERE slot_id = '<SLOT_A_ID>'
  AND customer_name LIKE 'WXTEST_%'
  AND status = 'CANCELLED'
  AND cancellation_reason LIKE 'Weather%'
  AND phone IS NOT NULL;
-- Expected: 8

-- Count affected bookings with email
SELECT COUNT(*) AS expected_email FROM bookings
WHERE slot_id = '<SLOT_A_ID>'
  AND customer_name LIKE 'WXTEST_%'
  AND status = 'CANCELLED'
  AND cancellation_reason LIKE 'Weather%'
  AND email IS NOT NULL;
-- Expected: 9
```

Now manually count:
- WhatsApp messages received across all test phones: must equal the `expected_wa` count
- Emails received across all test inboxes: must equal the `expected_email` count

**Any discrepancy is a FAIL** even if 8 out of 9 received their notification. One missed customer = one person showing up at the harbour for a cancelled trip.

**Pass criteria:** WhatsApp count = 8, Email count = 9, zero discrepancy.

---

### CC-W2 — Idempotency

**What this verifies:** Calling weather-cancel twice with the same slot_ids does not double-cancel or double-notify.

**After L1 has run on Slot A (already CLOSED):**

```bash
# Call weather-cancel again with the same slot
curl -X POST 'https://ukdsrndqhsatjkmxijuj.supabase.co/functions/v1/weather-cancel' \
  -H 'Authorization: Bearer <SUPABASE_ANON_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{
    "slot_ids": ["<SLOT_A_ID>"],
    "business_id": "<TEST_BIZ_ID>",
    "reason": "Testing — duplicate call"
  }'
```

**Expected response:**
```json
{"ok": true, "slots_closed": 1, "bookings_cancelled": 0}
```

(0 bookings because the query filters by `status IN ('PAID','CONFIRMED','HELD','PENDING')` — all bookings are already CANCELLED.)

**Verification:**
- No new WhatsApp messages on any test phone
- No new emails in any test inbox
- `cancelled_at` timestamps on bookings are unchanged (still from the first cancel)

**Pass criteria:** Second call is a no-op for bookings and notifications.

---

### CC-W3 — Partial Failure Recovery (WhatsApp Down)

**What this verifies:** If WhatsApp sends fail, bookings are still cancelled and emails still sent.

**This test requires temporarily breaking WhatsApp credentials.** The credentials are encrypted in the database — you cannot easily modify them. **Alternative approach:** Create a test booking with a completely invalid phone number (e.g., `+000000000000`). The WhatsApp API will reject it, simulating a failure.

```sql
-- Create a slot with one booking that has a bad phone
INSERT INTO slots (id, tour_id, business_id, start_time, capacity_total, booked, held, status)
VALUES (gen_random_uuid(), '<TEST_TOUR_ID>', '<TEST_BIZ_ID>',
  (CURRENT_DATE + INTERVAL '2 days' + INTERVAL '10 hours')::timestamptz, 10, 2, 0, 'OPEN')
RETURNING id;
-- >>> Save as SLOT_FAIL_ID

INSERT INTO bookings (id, business_id, tour_id, slot_id, customer_name, phone, email, qty, status, total_amount)
VALUES
  (gen_random_uuid(), '<TEST_BIZ_ID>', '<TEST_TOUR_ID>', '<SLOT_FAIL_ID>', 'WXTEST_FAIL1 Valid',   '+27XXXXXXXXX', 'gideon+wxfail1@gmail.com', 1, 'PAID', 250),
  (gen_random_uuid(), '<TEST_BIZ_ID>', '<TEST_TOUR_ID>', '<SLOT_FAIL_ID>', 'WXTEST_FAIL2 Invalid', '+000000000000', 'gideon+wxfail2@gmail.com', 1, 'PAID', 250);
```

Trigger weather cancel on SLOT_FAIL_ID. Verify:

```sql
-- Both bookings should be CANCELLED regardless of WhatsApp failure
SELECT customer_name, status, refund_status FROM bookings WHERE slot_id = '<SLOT_FAIL_ID>';
-- Expect: both CANCELLED, both ACTION_REQUIRED
```

- WXTEST_FAIL1 Valid: should receive both WhatsApp AND email
- WXTEST_FAIL2 Invalid: should receive email but NOT WhatsApp (API rejection)
- Check edge function logs for `WA weather-cancel err` — should show the failed phone

**Pass criteria:**
- [ ] Both bookings cancelled despite WA failure
- [ ] Valid customer got both channels
- [ ] Invalid customer got email only
- [ ] No unhandled crash — function returned 200

---

### CC-W4 — Refund Status Accuracy

**What this verifies:** Every PAID/CONFIRMED booking gets `refund_status = 'ACTION_REQUIRED'` and `refund_amount` set correctly. Every HELD/PENDING booking does NOT get refund fields. Check every row, not a sample.

**Run after L1+L2:**

```sql
-- Check PAID/CONFIRMED bookings have correct refund fields
SELECT id, customer_name, refund_status, refund_amount, total_amount,
       refund_amount = total_amount AS amount_matches
FROM bookings
WHERE slot_id = '<SLOT_A_ID>'
  AND customer_name LIKE 'WXTEST_%'
  AND cancellation_reason LIKE 'Weather%'
  AND status = 'CANCELLED';
```

For every PAID/CONFIRMED row: `refund_status = 'ACTION_REQUIRED'` AND `refund_amount = total_amount`.
For HELD/PENDING rows: `refund_status IS NULL` AND `refund_amount IS NULL`.

```sql
-- Explicit: count any mismatches
SELECT COUNT(*) AS mismatches FROM bookings
WHERE slot_id = '<SLOT_A_ID>'
  AND customer_name LIKE 'WXTEST_%'
  AND cancellation_reason LIKE 'Weather%'
  AND (
    -- PAID/CONFIRMED should have refund fields
    (total_amount > 0 AND (refund_status != 'ACTION_REQUIRED' OR refund_amount != total_amount))
    OR
    -- HELD/PENDING should NOT have refund fields
    (total_amount = 0 AND (refund_status IS NOT NULL OR refund_amount IS NOT NULL))
  );
-- Expect: 0
```

**Pass criteria:** Zero mismatches.

---

### CC-W5 — Self-Service Link Validity

**What this verifies:** Each notification contains a valid self-service link that loads the correct customer's booking.

**Steps:**
1. From L3's emails, extract the "Manage My Booking" URL from 3 different customers
2. Open each URL in an incognito browser
3. Verify each URL loads and shows the correct booking (check booking ref matches)
4. Verify you cannot see other customers' bookings by modifying the URL

**Pass criteria:**
- [ ] All 3 links load successfully
- [ ] Each shows the correct booking
- [ ] No cross-customer data leakage

---

### CC-W6 — Bulk Operation Atomicity

**What this verifies:** L5's multi-slot cancel either fully succeeds or leaves a clear recoverable state.

**Already tested by L5.** Additional check:

```sql
-- After L5: verify no booking on SLOT_B or SLOT_C is still in an active state
SELECT id, customer_name, status FROM bookings
WHERE slot_id IN ('<SLOT_B_ID>', '<SLOT_C_ID>')
  AND customer_name LIKE 'WXTEST_%'
  AND status NOT IN ('CANCELLED');
-- Expect: 0 rows (all should be CANCELLED)
```

If any row is NOT cancelled, it means the loop failed mid-way — partial failure.

**Pass criteria:** Zero active bookings remain on either slot.

---

### CC-W7 — Reopen State Cleanliness

**What this verifies:** After reopening (L6), no ghost data lingers.

```sql
-- After L6: verify slot is cleanly bookable
SELECT id, status, booked, held, capacity_total,
       capacity_total - booked - COALESCE(held, 0) AS available
FROM slots WHERE id = '<SLOT_A_ID>';
-- Expect: OPEN, booked=0, held=0, capacity_total=20, available=20

-- Verify no active holds exist for cancelled bookings
SELECT COUNT(*) FROM holds
WHERE booking_id IN (SELECT id FROM bookings WHERE slot_id = '<SLOT_A_ID>')
  AND status = 'ACTIVE';
-- Expect: 0

-- Verify the slot appears in available-slots queries (customer-facing)
-- This depends on the booking site's slot query — verify manually by
-- checking if the slot shows up on the booking page
```

**Pass criteria:** Slot is fully clean and bookable.

---

### CC-W8 — Timezone Correctness

**What this verifies:** The reopen operation uses correct timezone boundaries.

The reopen code in `slots/page.tsx` uses:
```js
new Date(dateStr + "T00:00:00+02:00")
```

South Africa doesn't observe DST, so +02:00 is always correct for SAST. However, if the platform is used by an operator in a different timezone (e.g., UTC+0 or UTC+1), the reopen would use SAST boundaries regardless.

**Test:**
```sql
-- Verify the test business timezone
SELECT timezone FROM businesses WHERE id = '<TEST_BIZ_ID>';
-- Should be 'Africa/Johannesburg'
```

For SAST operators, the hardcoded +02:00 is correct. For non-SAST operators, this is a known limitation.

**Pass criteria:** Reopen selects the correct slots for the selected dates in SAST.

---

### CC-W9 — Message Template Correctness

**What this verifies:** The email and WhatsApp use weather-specific language.

From L3's outputs:
1. Open a PAID customer's cancellation email — verify:
   - Subject or heading mentions weather/trip cancelled
   - Body says "cancelled due to weather conditions" (not a generic cancel)
   - Contains the green "Your options" block with Reschedule/Voucher/Refund
   - Hero image is the weather variant (`IMG_CANCEL_WEATHER`)

2. Open an unpaid customer's cancellation email — verify:
   - Says "No payment was taken, so no action is needed"
   - Does NOT contain the refund/voucher options block

3. Check WhatsApp messages:
   - PAID: Contains "reschedule, get a voucher, or request a full refund"
   - Unpaid: Contains "No payment was taken, so no action is needed on your side"

**Pass criteria:** Weather-specific language used in all notifications. Paid/unpaid variants are correct.

---

## Phase 5 — Test Report Template

```
================================================================
 BOOKINGTOURS WEATHER CANCELLATION TEST REPORT
================================================================

Environment:      ___________
Date:             ___________
Tester:           ___________
Test Business ID: ___________
Slot A / B / C:   ___________ / ___________ / ___________

================================================================
 PHASE 1 — IMPLEMENTATION VERIFICATION
================================================================

- [ ] HELD + PENDING cancellation behaviour confirmed
- [ ] Reopen-doesn't-reinstate behaviour confirmed
- [ ] No-retry-on-notification-failure acknowledged
- [ ] Synchronous-dispatch risk acknowledged

================================================================
 PHASE 3 — BEHAVIOURAL TESTS
================================================================

| Test | Name                   | P | F | B | Notes / Failure                    |
|------|------------------------|---|---|---|------------------------------------|
| L1   | Cancel slot (weather)  |[ ]|[ ]|[ ]|                                    |
| L2   | Bookings cancelled     |[ ]|[ ]|[ ]|                                    |
| L3   | Customer notifications |[ ]|[ ]|[ ]|                                    |
| L4   | Self-service options   |[ ]|[ ]|[ ]|                                    |
| L5   | Bulk weather cancel    |[ ]|[ ]|[ ]|                                    |
| L6   | Reopen after weather   |[ ]|[ ]|[ ]|                                    |

================================================================
 PHASE 4 — ACCURACY CHECKS
================================================================

| ID    | Name                       | P | F | Notes                            |
|-------|----------------------------|---|---|----------------------------------|
| CC-W1 | All-customers-notified     |[ ]|[ ]| WA: __/__ Email: __/__           |
| CC-W2 | Idempotency                |[ ]|[ ]|                                  |
| CC-W3 | Partial failure (WA down)  |[ ]|[ ]|                                  |
| CC-W4 | Refund status accuracy     |[ ]|[ ]| Mismatches: __                   |
| CC-W5 | Self-service link validity |[ ]|[ ]|                                  |
| CC-W6 | Bulk operation atomicity   |[ ]|[ ]|                                  |
| CC-W7 | Reopen state cleanliness   |[ ]|[ ]|                                  |
| CC-W8 | Timezone correctness       |[ ]|[ ]|                                  |
| CC-W9 | Message template correct   |[ ]|[ ]|                                  |

================================================================
 NOTIFICATION AUDIT (Critical)
================================================================

| Slot | Affected | WA Expected | WA Received | Email Expected | Email Received |
|------|----------|-------------|-------------|----------------|----------------|
| A    |          |             |             |                |                |
| B    |          |             |             |                |                |
| C    |          |             |             |                |                |

100% notification rate achieved? [ ] Yes  [ ] No

================================================================
 CUSTOMER IMPACT ASSESSMENT (for any failures)
================================================================

| Failure | Severity | Impact if shipped |
|---------|----------|-------------------|
|         |          |                   |

Severity scale:
- CRITICAL: Customer shows up for cancelled trip, or money stuck with no path to resolution
- HIGH: Customer not notified but can discover status via My Bookings
- MEDIUM: Notification sent but with wrong information
- LOW: Cosmetic or operator-facing only

================================================================
 BUGS FOUND
================================================================

| # | Test | Description | Severity | Customer Impact |
|---|------|-------------|----------|-----------------|
| 1 |      |             |          |                 |

================================================================
 KNOWN ISSUES (pre-existing, not new bugs)
================================================================

1. No notification retry — failed WA/email sends are lost (Gap #1 from Phase 1)
2. Synchronous dispatch — bulk cancel of 50+ bookings risks timeout (Gap #3)
3. No per-booking notification log — cannot audit send success after the fact (Gap #4)
4. Duplicate cancel logic in slots page vs edge function (Gap #5)

================================================================
 GO / NO-GO RECOMMENDATION
================================================================

[ ] GO — All critical paths pass. Notification audit confirms 100% delivery.
[ ] CONDITIONAL GO — Minor issues exist but no customer-harm bugs.
      Conditions: ___________
[ ] NO-GO — Blocking issues:
      ___________

CRITICAL GATE: If CC-W1 (all-customers-notified audit) returned less than
100% on any channel, this is an automatic NO-GO regardless of other results.
Reason: partial notification = customers showing up for cancelled trips.

Signed: ___________  Date: ___________
================================================================
```

---

## Cleanup SQL (Run After All Testing)

```sql
-- Delete test bookings
DELETE FROM holds WHERE booking_id IN (
  SELECT id FROM bookings WHERE customer_name LIKE 'WXTEST_%'
);
DELETE FROM bookings WHERE customer_name LIKE 'WXTEST_%';

-- Delete test slots
DELETE FROM slots WHERE id IN ('<SLOT_A_ID>', '<SLOT_B_ID>', '<SLOT_C_ID>', '<SLOT_FAIL_ID>');

-- Delete test log entries
DELETE FROM logs WHERE event = 'weather_cancel' AND payload->>'reason' LIKE 'Testing%';
```

---

## Open Questions for Gideon

1. ~~HELD + PENDING cancellation~~ — **RESOLVED:** Correct to cancel all active statuses. HELD/PENDING should be cancelled when the payment link has timed out.

2. ~~Reopen doesn't reinstate~~ — **RESOLVED:** Correct. Cancelled bookings stay cancelled; customers rebook.

3. **No notification retry:** If WhatsApp fails for a customer, they are never notified. Is this an accepted risk, or should we build a retry queue before go-live?

4. **Notification log:** There's no per-booking record of whether the notification succeeded. Should we add a `weather_cancel_notifications` table (or use `auto_messages`) to track this? It would make the CC-W1 audit automatable instead of manual.

5. ~~Self-service UI~~ — **RESOLVED:** Self-service (reschedule/voucher/refund) exists in the booking site at My Bookings. Customers visit the booking site and manage their bookings there.
