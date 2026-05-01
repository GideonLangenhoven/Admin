# Cron Automation Test Plan — BookingTours

**Version:** 1.0
**Date:** 2026-04-12
**Author:** Claude (for Gideon / Alicia)
**Scope:** 11 cron-triggered automated messaging and status transition features (J1–J11)

---

## Table of Contents

1. [Overview](#overview)
2. [Phase 1 — Setup Verification](#phase-1--setup-verification)
3. [Phase 2 — Test Environment Preparation](#phase-2--test-environment-preparation)
4. [Phase 3 — Per-Test Execution Scripts](#phase-3--per-test-execution-scripts)
5. [Phase 4 — Cross-Cutting Checks](#phase-4--cross-cutting-checks)
6. [Phase 5 — Test Report Template](#phase-5--test-report-template)

---

## Overview

### Test Inventory (J1–J11)

| Test | Behaviour | Edge Function | Trigger Path |
|------|-----------|---------------|--------------|
| J1 | Day-before WhatsApp reminder | `auto-messages` | `cron-tasks` → HTTP POST |
| J2 | Indemnity/waiver email (day before, unsigned) | `auto-messages` | `cron-tasks` → HTTP POST |
| J3 | Post-trip review request (WhatsApp, 2–6h after) | `auto-messages` | `cron-tasks` → HTTP POST |
| J4 | Booking status → COMPLETED (side-effect of J3) | `auto-messages` | `cron-tasks` → HTTP POST |
| J5 | Hold expiry (capacity released, customer notified) | `cron-tasks` (inline) | Needs cron trigger |
| J6 | Admin booking payment deadline expiry | `cron-tasks` (inline) | Needs cron trigger |
| J7 | Re-engagement message (90–120 day lapsed) | `auto-messages` | `cron-tasks` → HTTP POST |
| J8 | Human chat timeout (revert HUMAN→BOT after 48h) | `auto-messages` | `cron-tasks` → HTTP POST |
| J9 | Abandoned cart recovery | **NOT IMPLEMENTED** | BLOCKED |
| J10 | Auto-expire unpaid bookings (stale drafts) | `auto-messages` | `cron-tasks` → HTTP POST |
| J11 | Abandoned voucher cleanup (PENDING >24h) | `cron-tasks` (inline) | Needs cron trigger |

### Key Findings Before Testing

**J9 — Abandoned Cart Recovery: DOES NOT EXIST.** No abandoned cart detection, no `ABANDONED_CART` email type, no mechanism to track browse-then-abandon on `/book`. This feature is not implemented. Marked as BLOCKED.

**J10 — "Stale Draft Cleanup":** There is no `DRAFT` booking status in the system. Booking statuses are: `PENDING`, `PENDING PAYMENT`, `HELD`, `PAID`, `CONFIRMED`, `COMPLETED`, `CANCELLED`. J10 is mapped to `autoExpireBookingsForBusiness()` which auto-cancels `PENDING`/`PENDING PAYMENT`/`HELD` bookings past their `payment_deadline`. Confirm this mapping is correct.

**J3 + J4 are the same function.** `sendReviewRequestsForBusiness()` sends the WhatsApp AND transitions status to `COMPLETED` in one operation. They are tested together as two assertions on one trigger.

**J3 timing — "2–6 hours" explained.** The code window: trip must have ended between 2 and 6 hours ago. If the cron runs every 5 minutes, delivery is ~2h0m–2h5m after trip end. After 6h the window closes permanently. This is cron-schedule-determined, not randomized.

---

## Phase 1 — Setup Verification

### 1A. Required Cron Jobs

| # | Cron Job Name (proposed) | Schedule | Target Function | External Services |
|---|--------------------------|----------|-----------------|-------------------|
| C1 | `cron-tasks-every-5-min` | `*/5 * * * *` | `cron-tasks` | WhatsApp API, `send-email` (Resend) |
| C2 | `marketing-dispatch-every-minute` | `* * * * *` | `marketing-dispatch` | Resend batch email API |
| C3 | `marketing-automation-every-5-min` (optional) | `*/5 * * * *` | `marketing-automation-dispatch` | Resend email API |

**C1** is the master orchestrator for J1–J8, J10, J11. It calls `auto-messages` via HTTP, then runs hold cleanup, manual booking expiry, voucher cleanup, and auto-tagging inline.

**C2** is the only cron with a confirmed pg_cron entry in the migrations.

**C3** processes marketing automation workflow steps (delay, send_email, generate_voucher, etc.). Include if testing J12.

### 1B. Database Tables Touched Per Cron

**C1 (`cron-tasks`):**
- **Reads:** `businesses`, `bookings`, `slots`, `tours`, `holds`, `vouchers`, `conversations`, `admin_users`, `marketing_contacts`, `marketing_automations`, `marketing_automation_enrollments`, `auto_messages`
- **Writes:** `bookings` (status changes), `holds` (status), `slots` (booked count), `vouchers` (deletes), `auto_messages` (insert), `conversations` (status), `logs` (insert), `marketing_contacts` (tags), `marketing_automation_enrollments` (insert)

**C2 (`marketing-dispatch`):**
- **Reads:** `marketing_queue`, `marketing_campaigns`, `marketing_templates`, `businesses`
- **Writes:** `marketing_queue` (status), `marketing_campaigns` (counters, status), `marketing_contacts` (last_email_at), `marketing_unsubscribe_tokens` (insert)

### 1C. Verification SQL Queries

Run these in the Supabase SQL Editor.

**Query 1 — List all pg_cron jobs:**

```sql
SELECT jobid, schedule, command, nodename, active
FROM cron.job
ORDER BY jobid;
```

Expected: At minimum `marketing-dispatch-every-minute`. Likely missing: `cron-tasks`, `marketing-automation-dispatch`.

**Query 2 — Last run status for each cron job:**

```sql
SELECT j.jobid, j.schedule,
       substring(j.command from 1 for 80) AS command_preview,
       r.runid, r.status, r.return_message,
       r.start_time, r.end_time
FROM cron.job j
LEFT JOIN cron.job_run_details r ON j.jobid = r.jobid
ORDER BY r.start_time DESC
LIMIT 20;
```

Check: recent `status = 'succeeded'` entries for each job.

**Query 3 — Required extensions:**

```sql
SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net');
```

Expected: Both `pg_cron` and `pg_net` present.

**Query 4 — App settings configured (required for pg_cron HTTP calls):**

```sql
SELECT current_setting('app.settings.supabase_url', true) AS supabase_url,
       length(current_setting('app.settings.service_role_key', true)) AS key_length;
```

Expected: URL is your project URL, key_length > 0.

**Query 5 — auto_messages idempotency constraint:**

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'auto_messages'
  AND indexdef LIKE '%booking_id%type%';
```

Expected: `uq_auto_messages_booking_type` index exists.

### 1D. config.toml Verification

| Edge Function | In config.toml? | verify_jwt = false? | Status |
|---------------|-----------------|---------------------|--------|
| `cron-tasks` | **NO** | N/A | **BLOCKER** |
| `auto-messages` | **NO** | N/A | **BLOCKER** |
| `marketing-dispatch` | YES | YES | OK |
| `marketing-automation-dispatch` | YES | YES | OK |

### 1E. Blockers

#### BLOCKER 1 — No pg_cron job for `cron-tasks`

The `cron-tasks` function orchestrates 10 of 11 tests. There is no pg_cron entry for it. Tests J1–J8, J10, J11 cannot fire automatically.

**Fix — apply this migration:**

```sql
-- File: supabase/migrations/YYYYMMDDHHMMSS_cron_tasks_schedule.sql
SELECT cron.schedule(
  'cron-tasks-every-5-min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url    := current_setting('app.settings.supabase_url') || '/functions/v1/cron-tasks',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body   := '{}'::jsonb
  ) AS request_id;
  $$
);
```

#### BLOCKER 2 — `cron-tasks` and `auto-messages` missing from config.toml

Even with a cron job, both functions will 401 because `verify_jwt` defaults to `true`. The service_role_key sent by pg_cron is an API key, not a JWT.

**Fix — add to `supabase/config.toml`:**

```toml
[functions.cron-tasks]
verify_jwt = false

[functions.auto-messages]
verify_jwt = false
```

Then redeploy edge functions.

#### WARNING — `reminder-scheduler` and `outbox-send` appear legacy

`reminder-scheduler` is hardcoded to a single `BUSINESS_ID` env var. `outbox-send` sends via direct WhatsApp API (not multi-tenant). Neither has a cron trigger. The multi-tenant `auto-messages`/`cron-tasks` pair supersedes them. Confirm these are deprecated.

### 1F. Full Setup Verification Checklist

| # | Check | How to Verify | Expected | Actual | Pass? |
|---|-------|---------------|----------|--------|-------|
| 1 | pg_cron extension installed | Query 3 | Row exists | | [ ] |
| 2 | pg_net extension installed | Query 3 | Row exists | | [ ] |
| 3 | `marketing-dispatch-every-minute` exists | Query 1 | Row with `* * * * *` | | [ ] |
| 4 | marketing-dispatch last ran OK | Query 2 | Recent `succeeded` | | [ ] |
| 5 | `cron-tasks` cron exists | Query 1 | Row exists (likely missing) | | [ ] |
| 6 | `marketing-automation-dispatch` cron exists | Query 1 | Row exists (likely missing) | | [ ] |
| 7 | `cron-tasks` in config.toml verify_jwt=false | Check file | Entry exists (missing) | | [ ] |
| 8 | `auto-messages` in config.toml verify_jwt=false | Check file | Entry exists (missing) | | [ ] |
| 9 | `marketing-dispatch` verify_jwt=false | config.toml line 19 | YES | YES | [x] |
| 10 | `marketing-automation-dispatch` verify_jwt=false | config.toml line 22 | YES | YES | [x] |
| 11 | `app.settings.supabase_url` set | Query 4 | Returns URL | | [ ] |
| 12 | `app.settings.service_role_key` set | Query 4 | key_length > 0 | | [ ] |
| 13 | `cron-tasks` function deployed | Supabase Dashboard → Edge Functions | Listed | | [ ] |
| 14 | `auto-messages` function deployed | Supabase Dashboard → Edge Functions | Listed | | [ ] |
| 15 | `marketing-dispatch` function deployed | Supabase Dashboard → Edge Functions | Listed | | [ ] |
| 16 | `marketing-automation-dispatch` deployed | Supabase Dashboard → Edge Functions | Listed | | [ ] |
| 17 | `send-email` function deployed | Supabase Dashboard → Edge Functions | Listed | | [ ] |
| 18 | `auto_messages` idempotency index exists | Query 5 | Index exists | | [ ] |
| 19 | `reminder-scheduler` status confirmed | Ask: deprecated? | Deprecated / Active | | [ ] |
| 20 | `outbox-send` status confirmed | Ask: deprecated? | Deprecated / Active | | [ ] |

### Phase 1 Sign-Off Gate

- [ ] All 20 checks completed
- [ ] Blockers 1 and 2 resolved (or workaround documented)
- [ ] Confirmed whether `reminder-scheduler`/`outbox-send` are deprecated
- [ ] Decided on J9 (abandoned cart — build or defer?)
- [ ] Confirmed J10 mapping (auto-expire unpaid bookings)

---

## Phase 2 — Test Environment Preparation

### 2A. Environment Recommendation

**Recommended: Production, with isolation safeguards.**

Reasoning:
- No staging environment exists (no Supabase branch, no separate Vercel deployment)
- The cron infrastructure (pg_cron, `net.http_post`, edge function routing) must be tested where it actually runs
- Production-safe testing is achievable with data isolation

**Isolation safeguards:**
1. Dedicated **test business** (separate `business_id`) — all test data scoped to it
2. Dedicated **test WhatsApp number** (your personal phone or second SIM)
3. Dedicated **test email** (e.g., `gideon+crontest@gmail.com`)
4. All test customers named `CRONTEST_*` for instant identification
5. Cleanup after testing: `DELETE FROM bookings WHERE customer_name LIKE 'CRONTEST_%';`

### 2B. Test Data Setup

#### Create test business

```sql
-- Check for existing test business first
SELECT id, business_name, subdomain FROM businesses
WHERE business_name ILIKE '%test%' OR subdomain ILIKE '%test%';

-- If none exists:
INSERT INTO businesses (
  id, business_name, subdomain, timezone,
  directions, what_to_bring, booking_site_url
)
VALUES (
  gen_random_uuid(),
  'CronTest Adventures',
  'crontest',
  'Africa/Johannesburg',
  'V&A Waterfront Pier 1',
  'Sunscreen, towel',
  'https://crontest.bookingtours.co.za'
)
RETURNING id;
-- >>> Save this ID as TEST_BIZ_ID for ALL subsequent steps
```

#### Create test tour

```sql
INSERT INTO tours (id, business_id, name, duration_minutes, max_capacity)
VALUES (
  gen_random_uuid(),
  '<TEST_BIZ_ID>',
  'CronTest Kayak Tour',
  90,
  4
)
RETURNING id;
-- >>> Save as TEST_TOUR_ID
```

#### Create reusable slots

```sql
-- TOMORROW slot (for J1, J2)
INSERT INTO slots (id, tour_id, business_id, start_time, capacity, booked, held)
VALUES (
  gen_random_uuid(),
  '<TEST_TOUR_ID>',
  '<TEST_BIZ_ID>',
  (CURRENT_DATE + INTERVAL '1 day' + INTERVAL '9 hours')::timestamptz,
  4, 0, 0
)
RETURNING id;
-- >>> Save as TOMORROW_SLOT_ID
```

Additional slots are created per-test in Phase 3 scripts.

#### WhatsApp test number

Use your own phone in international format (e.g., `+27821234567`). Before testing:

1. Verify the number has an active WhatsApp account
2. Check it's not in real customer records:
   ```sql
   SELECT id, customer_name FROM bookings
   WHERE phone = '+27XXXXXXXXX' AND customer_name NOT LIKE 'CRONTEST_%';
   ```
3. Verify WhatsApp templates are approved in Meta Business Manager → WhatsApp Manager → Message Templates (needed: `booking_reminder`, `review_request`, `booking_cancelled`)

#### Test email

Use `gideon+crontest@gmail.com` — all mail arrives in your main inbox, searchable by the `+crontest` tag.

### 2C. Time Compression Strategies

| Test | Real Wait | Strategy | Column(s) to Backdate | Notes |
|------|-----------|----------|----------------------|-------|
| J1, J2 | "Tomorrow" | No backdating needed — booking already has tomorrow's slot. Invoke cron manually. | None | Cron must run the day before the slot |
| J3, J4 | 2–6h after trip | Create slot with `start_time` 3h in the past. Trip has "ended". | `slots.start_time` = `NOW() - 3h` | Booking status must be PAID/CONFIRMED |
| J5 | ~20min hold window | Backdate hold expiry | `holds.expires_at` = `NOW() - 10min` | Grace period is 5min, so backdate by ≥6min |
| J6 | Deadline passes | Set deadline to past | `bookings.payment_deadline` = `NOW() - 30min` | Must be `source = 'ADMIN'`, status `PENDING` |
| J7 | 90+ days old | Backdate booking creation | `bookings.created_at` = `NOW() - 100 days` | Must be in the 90–120 day window. No recent bookings for same phone. |
| J8 | 48h in HUMAN | Backdate conversation | `conversations.updated_at` = `NOW() - 3 days` | Also set `last_message_at` to same or NULL |
| J10 | 24h+ stale | Set deadline to past | `bookings.payment_deadline` = `NOW() - 25h` | Status: PENDING/PENDING PAYMENT/HELD |
| J11 | 24h+ voucher | Backdate creation | `vouchers.created_at` = `NOW() - 25h` | Status must be PENDING |

### 2D. Manual Cron Invocation

#### Invoke `cron-tasks` (J1–J8, J10, J11)

Via SQL Editor:
```sql
SELECT net.http_post(
  url    := '<YOUR_SUPABASE_URL>/functions/v1/cron-tasks',
  headers := jsonb_build_object(
    'Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>',
    'Content-Type', 'application/json'
  ),
  body   := '{}'::jsonb
) AS request_id;
```

Via curl:
```bash
curl -X POST '<SUPABASE_URL>/functions/v1/cron-tasks' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

#### Invoke `auto-messages` with specific action (targeted testing)

```bash
# J1 only:
curl -X POST '<SUPABASE_URL>/functions/v1/auto-messages' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"action": "reminders"}'

# J2 only:
# ... -d '{"action": "indemnity"}'

# J3/J4 only:
# ... -d '{"action": "reviews"}'

# J7 only:
# ... -d '{"action": "re_engage"}'

# J8 only:
# ... -d '{"action": "human_timeout"}'

# J10 only:
# ... -d '{"action": "auto_expire"}'

# All at once:
# ... -d '{"action": "all"}'
```

#### Invoke `marketing-dispatch` (already has cron — manual override)

```bash
curl -X POST '<SUPABASE_URL>/functions/v1/marketing-dispatch' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

### 2E. Pre-Flight Verification

Before behavioural tests, do one dry run:

1. Invoke `cron-tasks` manually (curl or SQL)
2. Check Supabase Dashboard → Edge Functions → `cron-tasks` → Logs
3. Confirm you see a 200 response with a JSON body like `{"reminders": ..., "hold_cleanup": 0, ...}`
4. If you see a 401: Blocker 2 is not resolved
5. If you see a 500: Check the error in the logs

### Phase 2 Sign-Off Gate

- [ ] Test business, tour, and tomorrow slot created
- [ ] Test WhatsApp number verified (manually send a test message first)
- [ ] Test email address verified (send a test email via `send-email` function)
- [ ] Manual cron invocation returns 200 (both `cron-tasks` and `auto-messages`)
- [ ] Time compression confirmed (backdate one test row, invoke, verify function picks it up)

---

## Phase 3 — Per-Test Execution Scripts

### Recommended Execution Order

| Order | Tests | Shared Setup | Reason |
|-------|-------|-------------|--------|
| 1 | J1 + J2 | Paid booking for tomorrow, unsigned waiver | Same booking, same trigger |
| 2 | J3 + J4 | Paid booking with past slot (trip ended 3h ago) | J4 is side-effect of J3 |
| 3 | J5 | Booking with active hold, not paid | Hold infrastructure |
| 4 | J6 | Admin-created pending booking with deadline | Deadline infrastructure |
| 5 | J10 | Pending booking with expired payment deadline | Similar to J6, different path |
| 6 | J11 | Pending voucher, >24h old | Quick — voucher table only |
| 7 | J7 | Old booking from 100 days ago | Requires backdated data + phone isolation |
| 8 | J8 | Conversation in HUMAN state >48h | Conversations table |
| 9 | J9 | BLOCKED | Feature not implemented |

**Important: J7 (re-engagement) should be run with a DIFFERENT test phone number than J1–J6, because the re-engagement function checks for "no recent bookings for this phone." If J1's booking exists with the same phone, J7 will be excluded.**

---

### J1 + J2 — Day-Before Reminder + Waiver Email

**What this verifies:**
- J1: Customers with PAID/CONFIRMED bookings for tomorrow receive a WhatsApp reminder with tour name, time, meeting point, and "arrive 15 minutes early."
- J2: Customers with unsigned waivers for tomorrow's booking receive an indemnity email with a waiver link.

**Preconditions:**
- Test business exists with WhatsApp credentials and timezone set
- Test tour exists with a slot tomorrow at 09:00 SAST
- Test customer has a real WhatsApp number and real email
- Waiver status is NOT `SIGNED` (use `PENDING`)
- Booking status is `PAID`
- No prior `auto_messages` rows for this booking

**Setup steps:**

Step 1 — Create test booking:
```sql
INSERT INTO bookings (
  id, business_id, tour_id, slot_id,
  customer_name, phone, email, qty, status,
  waiver_status, waiver_token, total_amount
)
VALUES (
  gen_random_uuid(),
  '<TEST_BIZ_ID>',
  '<TEST_TOUR_ID>',
  '<TOMORROW_SLOT_ID>',
  'CRONTEST_J1 Alice Smith',
  '+27XXXXXXXXX',
  'gideon+crontest@gmail.com',
  2,
  'PAID',
  'PENDING',
  gen_random_uuid(),
  500
)
RETURNING id;
-- >>> Save as J1_BOOKING_ID
```

Step 2 — Verify clean state:
```sql
SELECT * FROM auto_messages WHERE booking_id = '<J1_BOOKING_ID>';
-- Must return 0 rows
```

**Trigger:**

```bash
curl -X POST '<SUPABASE_URL>/functions/v1/auto-messages' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"action": "all"}'
```

**Expected results:**

| # | Check | Expected |
|---|-------|----------|
| J1-a | `auto_messages` row for REMINDER | Exists: `booking_id = J1_BOOKING_ID`, `type = 'REMINDER'` |
| J1-b | WhatsApp received | Contains: "Reminder", "Alice", tour name, time, "arrive 15 minutes early", meeting point |
| J2-a | `auto_messages` row for INDEMNITY | Exists: `booking_id = J1_BOOKING_ID`, `type = 'INDEMNITY'` |
| J2-b | Email received | Indemnity/waiver email with booking ref and waiver link |

**Verification steps:**

V1 — Database check:
```sql
SELECT id, type, phone, created_at
FROM auto_messages
WHERE booking_id = '<J1_BOOKING_ID>'
ORDER BY type;
-- Expect: 2 rows (INDEMNITY, REMINDER)
```

V2 — Idempotency (re-invoke and re-check):
```sql
-- After re-invoking the function:
SELECT COUNT(*) FROM auto_messages
WHERE booking_id = '<J1_BOOKING_ID>' AND type = 'REMINDER';
-- Must still be 1
```

V3 — Check WhatsApp on test phone for reminder message.

V4 — Check test email inbox for indemnity email with waiver link.

V5 — Check Supabase Edge Function logs → `auto-messages` → no errors.

**J2 negative test — signed waiver should NOT trigger email:**

```sql
UPDATE bookings SET waiver_status = 'SIGNED' WHERE id = '<J1_BOOKING_ID>';
DELETE FROM auto_messages WHERE booking_id = '<J1_BOOKING_ID>' AND type = 'INDEMNITY';
```

Re-invoke. Verify NO new INDEMNITY email sent (function skips `waiver_status = 'SIGNED'`).

**Common failure modes:**
- 401 from function → config.toml missing `verify_jwt = false`
- WhatsApp template `booking_reminder` not approved in Meta Business Manager
- Timezone mismatch: slot is "tomorrow" in UTC but not in SAST (or vice versa)
- `business.timezone` is NULL → defaults to UTC → off by a day in the evening
- `send-email` returns 500 because `RESEND_API_KEY` not set

**Pass criteria:**
- [ ] J1: `auto_messages` has REMINDER row, WhatsApp received, idempotent on re-run
- [ ] J2: `auto_messages` has INDEMNITY row, email received, signed waiver skipped

**If failed:** Check Supabase Dashboard → Edge Functions → `auto-messages` → Logs. Look for `REMINDER_SEND_ERR`, `INDEMNITY_EMAIL_ERR`. Check `send-email` logs. Check WhatsApp Business Manager → Insights.

---

### J3 + J4 — Post-Trip Review Request + Status → COMPLETED

**What this verifies:**
- J3: 2–6 hours after a trip ends, the customer receives a WhatsApp review request.
- J4: The booking status auto-transitions from PAID → COMPLETED as a side-effect of J3.

**Preconditions:**
- Booking with status `PAID` or `CONFIRMED`
- Slot `start_time` is 3 hours in the past (trip ended 1.5h ago with 90min duration)
- Tour `duration_minutes` is set (uses 90 if NULL)
- Customer has WhatsApp number
- No prior `auto_messages` row with type `REVIEW_REQUEST`

**Setup steps:**

Step 1 — Create a past slot:
```sql
INSERT INTO slots (id, tour_id, business_id, start_time, capacity, booked, held)
VALUES (
  gen_random_uuid(),
  '<TEST_TOUR_ID>',
  '<TEST_BIZ_ID>',
  NOW() - INTERVAL '3 hours',
  4, 1, 0
)
RETURNING id;
-- >>> Save as J3_SLOT_ID
```

Step 2 — Create test booking:
```sql
INSERT INTO bookings (
  id, business_id, tour_id, slot_id,
  customer_name, phone, qty, status, total_amount
)
VALUES (
  gen_random_uuid(),
  '<TEST_BIZ_ID>',
  '<TEST_TOUR_ID>',
  '<J3_SLOT_ID>',
  'CRONTEST_J3 Bob Jones',
  '+27XXXXXXXXX',
  1,
  'PAID',
  350
)
RETURNING id;
-- >>> Save as J3_BOOKING_ID
```

Step 3 — Verify initial state:
```sql
SELECT status FROM bookings WHERE id = '<J3_BOOKING_ID>';
-- Expect: PAID
```

**Trigger:**

```bash
curl -X POST '<SUPABASE_URL>/functions/v1/auto-messages' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"action": "reviews"}'
```

**Expected results:**

| # | Check | Expected |
|---|-------|----------|
| J3-a | WhatsApp received | Contains: "thanks for joining", "Bob", review/photos link |
| J3-b | `auto_messages` row | `type = 'REVIEW_REQUEST'` exists |
| J4-a | Booking status | Changed from PAID to COMPLETED |

**Verification steps:**

V1 — Status transition:
```sql
SELECT status FROM bookings WHERE id = '<J3_BOOKING_ID>';
-- Expect: COMPLETED
```

V2 — auto_messages logged:
```sql
SELECT * FROM auto_messages
WHERE booking_id = '<J3_BOOKING_ID>' AND type = 'REVIEW_REQUEST';
-- Expect: 1 row
```

V3 — Idempotency:
```sql
-- Re-invoke, then:
SELECT COUNT(*) FROM auto_messages
WHERE booking_id = '<J3_BOOKING_ID>' AND type = 'REVIEW_REQUEST';
-- Still 1
```

V4 — Check WhatsApp for review message.

V5 — Check function logs for errors.

**6-hour window edge case:** If you set `start_time` to 8 hours ago (trip ended ~6.5h ago), the review should NOT be sent. Verify this as a negative test.

**Common failure modes:**
- `duration_minutes` is NULL → code defaults to 90, but trip end calculation may be wrong
- Booking already COMPLETED → the `update` targets only PAID/CONFIRMED, but the `select` includes COMPLETED (message still sent but status doesn't change — cosmetically fine, but verify)
- WhatsApp template `review_request` not approved

**Pass criteria:**
- [ ] J3: WhatsApp review received, auto_messages row created, idempotent
- [ ] J4: Booking status is COMPLETED

**If failed:** Check `auto-messages` logs for `REVIEW_REQUEST_ERR`.

---

### J5 — Hold Expiry

**What this verifies:** A booking that reserves capacity via a hold, but is never paid, has the hold automatically expired and the customer notified via WhatsApp.

**Preconditions:**
- Active hold in `holds` table with `expires_at` in the past (past grace period)
- Associated booking is NOT paid (no `yoco_payment_id`, status not PAID/COMPLETED)
- Customer has WhatsApp number

**Setup steps:**

Step 1 — Create a future slot:
```sql
INSERT INTO slots (id, tour_id, business_id, start_time, capacity, booked, held)
VALUES (
  gen_random_uuid(),
  '<TEST_TOUR_ID>',
  '<TEST_BIZ_ID>',
  NOW() + INTERVAL '3 days',
  4, 0, 2
)
RETURNING id;
-- >>> Save as J5_SLOT_ID
```

Step 2 — Create a PENDING booking (not paid):
```sql
INSERT INTO bookings (
  id, business_id, tour_id, slot_id,
  customer_name, phone, qty, status, total_amount
)
VALUES (
  gen_random_uuid(),
  '<TEST_BIZ_ID>',
  '<TEST_TOUR_ID>',
  '<J5_SLOT_ID>',
  'CRONTEST_J5 Charlie Hold',
  '+27XXXXXXXXX',
  2,
  'PENDING',
  700
)
RETURNING id;
-- >>> Save as J5_BOOKING_ID
```

Step 3 — Create an active hold, backdated past expiry + grace:
```sql
INSERT INTO holds (id, booking_id, slot_id, business_id, status, expires_at, hold_type)
VALUES (
  gen_random_uuid(),
  '<J5_BOOKING_ID>',
  '<J5_SLOT_ID>',
  '<TEST_BIZ_ID>',
  'ACTIVE',
  NOW() - INTERVAL '10 minutes',
  'BOOKING'
)
RETURNING id;
-- >>> Save as J5_HOLD_ID
```

Step 4 — Verify initial state:
```sql
SELECT status FROM holds WHERE id = '<J5_HOLD_ID>';
-- Expect: ACTIVE
```

**Trigger:**

```bash
curl -X POST '<SUPABASE_URL>/functions/v1/cron-tasks' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

**Expected results:**

| # | Check | Expected |
|---|-------|----------|
| J5-a | Hold status | EXPIRED |
| J5-b | WhatsApp | "held booking... has expired", tour name, slot time |

**Note on capacity:** `cleanupExpiredHolds()` expires the hold and sends WhatsApp, but does NOT decrement `slots.held`. The hold system marks status only. Verify this is intended.

**Verification steps:**

V1 — Hold expired:
```sql
SELECT status FROM holds WHERE id = '<J5_HOLD_ID>';
-- Expect: EXPIRED
```

V2 — Idempotency (re-invoke):
```sql
-- Re-invoke cron-tasks
SELECT status FROM holds WHERE id = '<J5_HOLD_ID>';
-- Still EXPIRED (function only queries ACTIVE holds)
```

V3 — Check WhatsApp for expiry notification.

V4 — Check function logs.

**Common failure modes:**
- Grace period not elapsed: code uses `Date.now() - 5 * 60 * 1000` as cutoff. If `expires_at` is only 3 min ago, hold won't be touched.
- Booking was actually paid → function converts to CONVERTED instead of EXPIRED
- WhatsApp fails silently (error caught, hold still expired but no notification)

**Pass criteria:**
- [ ] Hold status EXPIRED
- [ ] WhatsApp received
- [ ] Re-run doesn't re-process or re-send

**If failed:** Check `cron-tasks` logs for `HOLD_EXPIRY_WA_ERR`.

---

### J6 — Payment Deadline Expiry (Admin-Created Booking)

**What this verifies:** Admin-created PENDING bookings auto-cancel when the payment deadline passes, capacity is released, the event is logged, and the admin is notified.

**Preconditions:**
- Booking: `status = 'PENDING'`, `source = 'ADMIN'`, `payment_deadline` in the past
- MAIN_ADMIN user exists for the test business (with phone for notification)
- Slot has `booked` count reflecting this booking

**Setup steps:**

Step 1 — Create a slot:
```sql
INSERT INTO slots (id, tour_id, business_id, start_time, capacity, booked, held)
VALUES (
  gen_random_uuid(),
  '<TEST_TOUR_ID>',
  '<TEST_BIZ_ID>',
  NOW() + INTERVAL '5 days',
  4, 2, 0
)
RETURNING id;
-- >>> Save as J6_SLOT_ID
```

Step 2 — Create admin-created booking with expired deadline:
```sql
INSERT INTO bookings (
  id, business_id, tour_id, slot_id,
  customer_name, phone, email, qty, status,
  source, payment_deadline, total_amount
)
VALUES (
  gen_random_uuid(),
  '<TEST_BIZ_ID>',
  '<TEST_TOUR_ID>',
  '<J6_SLOT_ID>',
  'CRONTEST_J6 Dave Admin',
  '+27YYYYYYYYY',
  'gideon+j6@gmail.com',
  2,
  'PENDING',
  'ADMIN',
  NOW() - INTERVAL '30 minutes',
  600
)
RETURNING id;
-- >>> Save as J6_BOOKING_ID
```

Step 3 — Ensure MAIN_ADMIN exists:
```sql
SELECT id, phone FROM admin_users
WHERE business_id = '<TEST_BIZ_ID>' AND role = 'MAIN_ADMIN';
-- If none: INSERT INTO admin_users (business_id, role, phone, email)
-- VALUES ('<TEST_BIZ_ID>', 'MAIN_ADMIN', '+27XXXXXXXXX', 'admin@test.com');
```

Step 4 — Verify initial state:
```sql
SELECT status, source, payment_deadline FROM bookings WHERE id = '<J6_BOOKING_ID>';
-- Expect: PENDING, ADMIN, <past timestamp>
SELECT booked FROM slots WHERE id = '<J6_SLOT_ID>';
-- Expect: 2
```

**Trigger:**

```bash
curl -X POST '<SUPABASE_URL>/functions/v1/cron-tasks' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

**Expected results:**

| # | Check | Expected |
|---|-------|----------|
| J6-a | Booking status | CANCELLED |
| J6-b | `cancellation_reason` | "Auto-cancelled: payment deadline exceeded" |
| J6-c | Slot `booked` | Decremented by qty (2→0) |
| J6-d | `logs` table | Event `manual_booking_deadline_expired` |
| J6-e | Admin WhatsApp | "Manual booking expired" with ref, tour, time, customer name |

**Verification steps:**

V1 — Booking cancelled:
```sql
SELECT status, cancellation_reason, cancelled_at
FROM bookings WHERE id = '<J6_BOOKING_ID>';
-- Expect: CANCELLED, "payment deadline exceeded", non-null timestamp
```

V2 — Capacity released:
```sql
SELECT booked FROM slots WHERE id = '<J6_SLOT_ID>';
-- Expect: 0
```

V3 — Log entry:
```sql
SELECT event, payload FROM logs
WHERE booking_id = '<J6_BOOKING_ID>' AND event = 'manual_booking_deadline_expired';
-- Expect: 1 row
```

V4 — Idempotency (status is CANCELLED → won't be picked up again).

V5 — Check admin WhatsApp for notification.

**Common failure modes:**
- `source` is not `ADMIN` → `cleanupExpiredManualBookings()` skips it (this function only handles admin bookings)
- No MAIN_ADMIN with phone → notification silently skipped
- Slot `booked` goes negative if qty > current booked count

**Pass criteria:**
- [ ] Booking CANCELLED with correct reason
- [ ] Capacity released
- [ ] Log entry created
- [ ] Admin notified

**If failed:** Check `cron-tasks` logs for `MANUAL_BOOKING_CLEANUP_ERR` or `MANUAL_BOOKING_EXPIRY_NOTIFY_ERR`.

---

### J10 — Auto-Expire Unpaid Bookings (Non-Admin Path)

**What this verifies:** Non-admin bookings in `PENDING`/`PENDING PAYMENT`/`HELD` with expired `payment_deadline` are auto-cancelled, and the customer is notified via both email and WhatsApp.

**Note:** This uses `autoExpireBookingsForBusiness()` in `auto-messages`, NOT the admin-booking path in `cron-tasks`. This is the customer-facing "stale draft" equivalent.

**Preconditions:**
- Booking: `status = 'PENDING PAYMENT'`, `payment_deadline` in the past
- Customer has both phone and email

**Setup steps:**

Step 1 — Create a slot:
```sql
INSERT INTO slots (id, tour_id, business_id, start_time, capacity, booked, held)
VALUES (
  gen_random_uuid(),
  '<TEST_TOUR_ID>',
  '<TEST_BIZ_ID>',
  NOW() + INTERVAL '7 days',
  4, 1, 0
)
RETURNING id;
-- >>> Save as J10_SLOT_ID
```

Step 2 — Create booking with expired deadline:
```sql
INSERT INTO bookings (
  id, business_id, tour_id, slot_id,
  customer_name, phone, email, qty, status,
  payment_deadline, total_amount
)
VALUES (
  gen_random_uuid(),
  '<TEST_BIZ_ID>',
  '<TEST_TOUR_ID>',
  '<J10_SLOT_ID>',
  'CRONTEST_J10 Eve Stale',
  '+27XXXXXXXXX',
  'gideon+j10@gmail.com',
  1,
  'PENDING PAYMENT',
  NOW() - INTERVAL '25 hours',
  400
)
RETURNING id;
-- >>> Save as J10_BOOKING_ID
```

**Trigger:**

```bash
curl -X POST '<SUPABASE_URL>/functions/v1/auto-messages' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"action": "auto_expire"}'
```

**Expected results:**

| # | Check | Expected |
|---|-------|----------|
| J10-a | Booking status | CANCELLED |
| J10-b | `cancellation_reason` | "Auto-cancelled: payment deadline expired" |
| J10-c | CANCELLATION email | Sent to customer |
| J10-d | WhatsApp | "booking was released because the payment deadline passed" |
| J10-e | `auto_messages` row | `type = 'AUTO_CANCEL'` |

**Verification steps:**

V1 — Booking cancelled:
```sql
SELECT status, cancellation_reason FROM bookings WHERE id = '<J10_BOOKING_ID>';
-- Expect: CANCELLED, "payment deadline expired"
```

V2 — auto_messages logged:
```sql
SELECT * FROM auto_messages WHERE booking_id = '<J10_BOOKING_ID>' AND type = 'AUTO_CANCEL';
-- Expect: 1 row
```

V3 — Idempotency (re-invoke, count still 1).

V4 — Check email inbox for CANCELLATION email.

V5 — Check WhatsApp for deadline notification.

**Pass criteria:**
- [ ] Booking cancelled
- [ ] Email received
- [ ] WhatsApp received
- [ ] auto_messages row created
- [ ] Idempotent on re-run

---

### J11 — Abandoned Voucher Cleanup

**What this verifies:** PENDING vouchers older than 24 hours (abandoned checkout flows) are deleted. Active and recent-pending vouchers are not touched.

**Preconditions:**
- PENDING voucher with `created_at` > 24h ago

**Setup steps:**

Step 1 — Create three test vouchers:
```sql
-- OLD PENDING (should be deleted)
INSERT INTO vouchers (
  id, business_id, code, type, original_value, current_balance,
  status, created_at
)
VALUES (
  gen_random_uuid(),
  '<TEST_BIZ_ID>',
  'CRONTEST-ABANDON-001',
  'FIXED',
  500, 500,
  'PENDING',
  NOW() - INTERVAL '25 hours'
)
RETURNING id;
-- >>> Save as J11_OLD_ID

-- RECENT PENDING (should survive)
INSERT INTO vouchers (
  id, business_id, code, type, original_value, current_balance,
  status, created_at
)
VALUES (
  gen_random_uuid(),
  '<TEST_BIZ_ID>',
  'CRONTEST-RECENT-001',
  'FIXED',
  300, 300,
  'PENDING',
  NOW() - INTERVAL '1 hour'
)
RETURNING id;
-- >>> Save as J11_RECENT_ID

-- ACTIVE (should survive regardless of age)
INSERT INTO vouchers (
  id, business_id, code, type, original_value, current_balance,
  status, created_at
)
VALUES (
  gen_random_uuid(),
  '<TEST_BIZ_ID>',
  'CRONTEST-ACTIVE-001',
  'FIXED',
  200, 200,
  'ACTIVE',
  NOW() - INTERVAL '48 hours'
)
RETURNING id;
-- >>> Save as J11_ACTIVE_ID
```

**Trigger:**

```bash
curl -X POST '<SUPABASE_URL>/functions/v1/cron-tasks' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

**Expected results:**

| # | Check | Expected |
|---|-------|----------|
| J11-a | Old PENDING voucher | DELETED |
| J11-b | Recent PENDING voucher | Still exists |
| J11-c | ACTIVE voucher | Still exists |

**Verification steps:**

V1 — Old pending deleted:
```sql
SELECT id FROM vouchers WHERE id = '<J11_OLD_ID>';
-- Expect: 0 rows
```

V2 — Recent pending preserved:
```sql
SELECT id, status FROM vouchers WHERE id = '<J11_RECENT_ID>';
-- Expect: 1 row, PENDING
```

V3 — Active preserved:
```sql
SELECT id, status FROM vouchers WHERE id = '<J11_ACTIVE_ID>';
-- Expect: 1 row, ACTIVE
```

**Pass criteria:**
- [ ] Only the 25h-old PENDING voucher is deleted
- [ ] Recent PENDING and ACTIVE vouchers untouched

---

### J7 — Re-Engagement Message

**What this verifies:** Customers who booked 90–120 days ago with no recent activity receive a "we miss you" WhatsApp. Customers with recent bookings, future bookings, or opt-out are excluded.

**IMPORTANT: Use a DIFFERENT phone number for J7** than for other tests. The re-engagement function checks "no bookings from this phone in the last 90 days." If you've created J1/J3 bookings with the same phone, J7 will be excluded.

**Preconditions:**
- Booking from ~100 days ago, status COMPLETED/PAID
- No bookings from this phone in the last 90 days
- No future bookings for this phone
- `marketing_opt_in` is NOT `false`
- No prior `RE_ENGAGE` auto_message for this phone in the last 120 days

**Setup steps:**

Step 1 — Create a past slot:
```sql
INSERT INTO slots (id, tour_id, business_id, start_time, capacity, booked, held)
VALUES (
  gen_random_uuid(),
  '<TEST_TOUR_ID>',
  '<TEST_BIZ_ID>',
  NOW() - INTERVAL '100 days',
  4, 1, 0
)
RETURNING id;
-- >>> Save as J7_OLD_SLOT_ID
```

Step 2 — Create old completed booking (USE A DIFFERENT PHONE):
```sql
INSERT INTO bookings (
  id, business_id, tour_id, slot_id,
  customer_name, phone, qty, status, total_amount, created_at
)
VALUES (
  gen_random_uuid(),
  '<TEST_BIZ_ID>',
  '<TEST_TOUR_ID>',
  '<J7_OLD_SLOT_ID>',
  'CRONTEST_J7 Frank Lapsed',
  '+27AAAAAAAAA',             -- <<< DIFFERENT phone number
  2,
  'COMPLETED',
  800,
  NOW() - INTERVAL '100 days'
)
RETURNING id;
-- >>> Save as J7_BOOKING_ID
```

Step 3 — Verify exclusion conditions:
```sql
-- No recent bookings for this phone
SELECT id FROM bookings
WHERE phone = '+27AAAAAAAAA'
  AND business_id = '<TEST_BIZ_ID>'
  AND created_at > NOW() - INTERVAL '90 days';
-- Must return 0

-- No future bookings
SELECT b.id FROM bookings b
  JOIN slots s ON s.id = b.slot_id
WHERE b.phone = '+27AAAAAAAAA'
  AND b.business_id = '<TEST_BIZ_ID>'
  AND b.status IN ('PAID', 'CONFIRMED')
  AND s.start_time > NOW();
-- Must return 0

-- No prior RE_ENGAGE
SELECT * FROM auto_messages
WHERE phone = '+27AAAAAAAAA'
  AND business_id = '<TEST_BIZ_ID>'
  AND type = 'RE_ENGAGE'
  AND created_at > NOW() - INTERVAL '120 days';
-- Must return 0
```

**Trigger:**

```bash
curl -X POST '<SUPABASE_URL>/functions/v1/auto-messages' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"action": "re_engage"}'
```

**Expected results:**

| # | Check | Expected |
|---|-------|----------|
| J7-a | WhatsApp | "it's been a while", business name, booking site URL |
| J7-b | `auto_messages` row | `type = 'RE_ENGAGE'`, `phone = +27AAAAAAAAA` |

**Verification steps:**

V1 — auto_messages logged:
```sql
SELECT * FROM auto_messages
WHERE phone = '+27AAAAAAAAA'
  AND business_id = '<TEST_BIZ_ID>'
  AND type = 'RE_ENGAGE';
-- Expect: 1 row
```

V2 — Idempotency (re-invoke — 120-day dedup blocks re-send).

V3 — Check WhatsApp for re-engagement message.

**Negative test — recent customer NOT contacted:**
```sql
-- Create a recent booking for a different phone
INSERT INTO bookings (id, business_id, tour_id, slot_id, customer_name, phone, qty, status, created_at, total_amount)
VALUES (gen_random_uuid(), '<TEST_BIZ_ID>', '<TEST_TOUR_ID>', '<J7_OLD_SLOT_ID>',
  'CRONTEST_J7_NEG Recent', '+27BBBBBBBBB', 1, 'PAID', NOW() - INTERVAL '30 days', 400);
-- Also create 100-day-old booking for same phone
INSERT INTO bookings (id, business_id, tour_id, slot_id, customer_name, phone, qty, status, created_at, total_amount)
VALUES (gen_random_uuid(), '<TEST_BIZ_ID>', '<TEST_TOUR_ID>', '<J7_OLD_SLOT_ID>',
  'CRONTEST_J7_NEG Old', '+27BBBBBBBBB', 1, 'COMPLETED', NOW() - INTERVAL '100 days', 400);
-- Re-invoke. +27BBBBBBBBB should NOT get re-engagement.
```

**Pass criteria:**
- [ ] Target phone receives message
- [ ] Dedup works (no double-send on re-run)
- [ ] Recent-activity exclusion works

---

### J8 — Human Chat Timeout

**What this verifies:** Conversations stuck in `HUMAN` state for >48 hours are automatically reverted to `BOT` with `current_state = 'IDLE'`.

**Preconditions:**
- `conversations` row: `status = 'HUMAN'`, `updated_at` > 48h ago

**Setup steps:**

Step 1 — Create or update a stale conversation:
```sql
-- Check if conversations table has a unique constraint on (business_id, phone)
-- Adjust ON CONFLICT if needed
INSERT INTO conversations (
  id, business_id, phone, status, current_state, updated_at
)
VALUES (
  gen_random_uuid(),
  '<TEST_BIZ_ID>',
  '+27XXXXXXXXX',
  'HUMAN',
  'ACTIVE',
  NOW() - INTERVAL '3 days'
)
ON CONFLICT (business_id, phone) DO UPDATE
  SET status = 'HUMAN',
      current_state = 'ACTIVE',
      updated_at = NOW() - INTERVAL '3 days',
      last_message_at = NULL
RETURNING id;
-- >>> Save as J8_CONVO_ID
```

Step 2 — Verify:
```sql
SELECT status, current_state, updated_at FROM conversations WHERE id = '<J8_CONVO_ID>';
-- Expect: HUMAN, ACTIVE, ~3 days ago
```

**Trigger:**

```bash
curl -X POST '<SUPABASE_URL>/functions/v1/auto-messages' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"action": "human_timeout"}'
```

**Expected results:**

| # | Check | Expected |
|---|-------|----------|
| J8-a | Conversation status | BOT |
| J8-b | `current_state` | IDLE |
| J8-c | Logs | `HUMAN_TIMEOUT_REVERTED convo=<id>` in function logs |

**Verification steps:**

V1 — Status reverted:
```sql
SELECT status, current_state FROM conversations WHERE id = '<J8_CONVO_ID>';
-- Expect: BOT, IDLE
```

V2 — Idempotency (re-invoke — status is now BOT, won't be re-processed).

**Negative test — recent HUMAN should NOT timeout:**
```sql
UPDATE conversations
SET status = 'HUMAN', current_state = 'ACTIVE', updated_at = NOW()
WHERE id = '<J8_CONVO_ID>';
-- Re-invoke. Should NOT revert (< 48h old).
SELECT status FROM conversations WHERE id = '<J8_CONVO_ID>';
-- Expect: still HUMAN
```

**Common failure modes:**
- `conversations` table doesn't exist or has different schema
- `last_message_at` is recent (code checks both `updated_at` and `last_message_at`)

**Pass criteria:**
- [ ] Stale HUMAN reverted to BOT/IDLE
- [ ] Recent HUMAN left alone

---

### J9 — Abandoned Cart Recovery

**STATUS: BLOCKED — Feature Not Implemented**

No abandoned cart detection, tracking, or email sending exists in the codebase. No `ABANDONED_CART` email type in `send-email`. No mechanism to track email entry on `/book` and subsequent abandonment.

**To unblock (requires development):**
1. Frontend: store email + session when customer enters email on `/book`
2. Table: `pending_carts` or `abandoned_sessions`
3. Edge function: query sessions >30min old with no completed booking
4. Email template: "Complete My Booking" with deep link
5. Cron trigger

**Mark as: BLOCKED / NOT TESTED**

---

## Phase 4 — Cross-Cutting Checks

### CC1 — Idempotency

**What this verifies:** If the cron fires twice on the same data (retry, overlap, redeployment), each customer receives exactly one message.

**Mechanism:** The `auto_messages` table has a unique index `uq_auto_messages_booking_type ON (booking_id, type)`. The `logSent()` function uses `upsert` with `onConflict: "booking_id,type"` and `ignoreDuplicates: true`. The `alreadySent()` check also runs before attempting to send.

**Test (after J1 and J3 have run):**

Step 1 — Confirm the guard:
```sql
SELECT COUNT(*) FROM auto_messages
WHERE booking_id = '<J1_BOOKING_ID>' AND type = 'REMINDER';
-- Should be 1
```

Step 2 — Re-invoke:
```bash
curl -X POST '<SUPABASE_URL>/functions/v1/auto-messages' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"action": "reminders"}'
```

Step 3 — Check again:
```sql
SELECT COUNT(*) FROM auto_messages
WHERE booking_id = '<J1_BOOKING_ID>' AND type = 'REMINDER';
-- MUST still be 1
```

Step 4 — Check WhatsApp: no second reminder.

Step 5 — Repeat for J3 (REVIEW_REQUEST).

Step 6 — Verify the unique index exists:
```sql
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'auto_messages' AND indexdef LIKE '%booking_id%type%';
-- Must return uq_auto_messages_booking_type
```

**For J5 (hold expiry):** Inherently idempotent — function queries `status = 'ACTIVE'` holds only. After first run marks EXPIRED, second run won't find it.

**Pass criteria:**
- [ ] Double invocation produces exactly one message per booking
- [ ] Unique index exists in database

---

### CC2 — Timezone Correctness

**What this verifies:** "Tomorrow" comparisons use the business's configured timezone, not UTC.

**How the code works** (`auto-messages/index.ts` lines 17–43):
- Uses `Intl.DateTimeFormat("en-CA", { timeZone: timezone })` to compute today/tomorrow
- Reads `business.timezone` from the database
- Falls back to `UTC` if timezone is NULL

**Test procedure:**

Step 1 — Confirm timezone:
```sql
SELECT timezone FROM businesses WHERE id = '<TEST_BIZ_ID>';
-- Should be 'Africa/Johannesburg'
UPDATE businesses SET timezone = 'Africa/Johannesburg' WHERE id = '<TEST_BIZ_ID>';
```

Step 2 — Create a slot for tomorrow in SAST:
```sql
INSERT INTO slots (id, tour_id, business_id, start_time, capacity, booked, held)
VALUES (
  gen_random_uuid(),
  '<TEST_TOUR_ID>',
  '<TEST_BIZ_ID>',
  (CURRENT_DATE AT TIME ZONE 'Africa/Johannesburg'
    + INTERVAL '1 day' + INTERVAL '9 hours')::timestamptz,
  4, 0, 0
)
RETURNING id, start_time;
-- Verify: start_time is tomorrow 09:00 SAST
```

Step 3 — Create a PAID booking for this slot, invoke reminders, verify it's picked up.

**Edge case:** If `business.timezone` is NULL:
```sql
UPDATE businesses SET timezone = NULL WHERE id = '<TEST_BIZ_ID>';
-- Re-invoke reminders. With UTC fallback, the "tomorrow" check may be off
-- by a day if run after 22:00 UTC (midnight SAST).
-- Restore: UPDATE businesses SET timezone = 'Africa/Johannesburg' ...
```

**Pass criteria:**
- [ ] Reminder triggers correctly for SAST-tomorrow booking
- [ ] NULL timezone documented as a known risk

---

### CC3 — WhatsApp Delivery Failure Handling

**What this verifies:** What happens when WhatsApp delivery fails.

**Test procedure:**

Step 1 — Create booking with invalid phone:
```sql
INSERT INTO bookings (
  id, business_id, tour_id, slot_id,
  customer_name, phone, qty, status, total_amount
)
VALUES (
  gen_random_uuid(),
  '<TEST_BIZ_ID>',
  '<TEST_TOUR_ID>',
  '<TOMORROW_SLOT_ID>',
  'CRONTEST_CC3 Bad Phone',
  '0821234567',           -- Missing +27 — WhatsApp API will reject
  1, 'PAID', 200
)
RETURNING id;
-- >>> Save as CC3_BOOKING_ID
```

Step 2 — Invoke reminders:
```bash
curl -X POST '<SUPABASE_URL>/functions/v1/auto-messages' \
  -H 'Authorization: Bearer <SERVICE_ROLE_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"action": "reminders"}'
```

Step 3 — Check if auto_messages was logged:
```sql
SELECT * FROM auto_messages WHERE booking_id = '<CC3_BOOKING_ID>' AND type = 'REMINDER';
```

**What the code does** (`auto-messages/index.ts` lines 109–124):
```
try {
  await sendWhatsappTextForTenant(...);
  await logSent(..., "REMINDER");   // Only runs if WA succeeds
  sent++;
} catch (error) {
  console.error("REMINDER_SEND_ERR", ...);
  // No logSent → next cron run will retry
}
```

**Known issue:** If WA fails, `logSent` is NOT called. The next cron run will attempt to re-send to the same bad number. This creates **infinite retries** for invalid numbers.

**Document this as a potential bug.** Expected fix: log the send attempt regardless of outcome, or add a retry counter.

**Pass criteria:**
- [ ] Understood: failure does NOT log to auto_messages → infinite retry
- [ ] Documented as a known issue

---

### CC4 — Race Condition: Hold Expiry vs Payment

**What this verifies:** If payment completes just before hold expiry cron fires, the system detects the payment and does NOT expire the hold.

**How the code handles it** (`cron-tasks/index.ts` lines 27–51):
The function checks `booking.status` and `booking.yoco_payment_id` at processing time. If the booking is PAID, the hold is CONVERTED (not EXPIRED).

**Test procedure:**

Step 1 — Create a "just paid" booking with an expired hold:
```sql
-- Use J5's slot or create a new one
INSERT INTO bookings (
  id, business_id, tour_id, slot_id,
  customer_name, phone, qty, status, yoco_payment_id, total_amount
)
VALUES (
  gen_random_uuid(),
  '<TEST_BIZ_ID>',
  '<TEST_TOUR_ID>',
  '<J5_SLOT_ID>',
  'CRONTEST_CC4 RacePaid',
  '+27XXXXXXXXX',
  2,
  'PAID',
  'yoco_test_123',
  700
)
RETURNING id;
-- >>> Save as CC4_BOOKING_ID

INSERT INTO holds (id, booking_id, slot_id, business_id, status, expires_at, hold_type)
VALUES (
  gen_random_uuid(),
  '<CC4_BOOKING_ID>',
  '<J5_SLOT_ID>',
  '<TEST_BIZ_ID>',
  'ACTIVE',
  NOW() - INTERVAL '10 minutes',
  'BOOKING'
)
RETURNING id;
-- >>> Save as CC4_HOLD_ID
```

Step 2 — Invoke cron-tasks.

Step 3 — Verify:
```sql
SELECT status FROM holds WHERE id = '<CC4_HOLD_ID>';
-- Expect: CONVERTED (not EXPIRED)
```

No WhatsApp should be sent.

**Residual risk:** A true race (payment webhook and cron running simultaneously) has a millisecond-level window where the cron reads PENDING but payment updates to PAID between read and write. This is a read-then-act pattern. Impractical to test manually; document as a known low-probability risk.

**Pass criteria:**
- [ ] Hold is CONVERTED when booking is PAID
- [ ] No expiry notification sent

---

### CC5 — Recently-Paid Booking Gets Reminder

**What this verifies:** A booking paid 5 minutes before the reminder cron fires still receives the day-before reminder.

**Expected behavior:** Yes. The function queries `status IN ('PAID', 'CONFIRMED')` with no minimum age. A just-paid booking for tomorrow should still get the reminder.

**Test procedure:**

Step 1 — Create a just-paid booking:
```sql
INSERT INTO bookings (
  id, business_id, tour_id, slot_id,
  customer_name, phone, qty, status, total_amount, created_at
)
VALUES (
  gen_random_uuid(),
  '<TEST_BIZ_ID>',
  '<TEST_TOUR_ID>',
  '<TOMORROW_SLOT_ID>',
  'CRONTEST_CC5 JustPaid',
  '+27XXXXXXXXX',
  1, 'PAID', 250, NOW()
)
RETURNING id;
-- >>> Save as CC5_BOOKING_ID
```

Step 2 — Invoke reminders.

Step 3 — Verify reminder was sent:
```sql
SELECT * FROM auto_messages WHERE booking_id = '<CC5_BOOKING_ID>' AND type = 'REMINDER';
-- Expect: 1 row
```

**Pass criteria:**
- [ ] Reminder sent regardless of when payment occurred
- [ ] Confirms no accidental window that excludes recent payments

---

## Phase 5 — Test Report Template

Copy and fill in this template as you execute.

```
================================================================
 BOOKINGTOURS CRON AUTOMATION TEST REPORT
================================================================

Environment:    ___________
Date:           ___________
Tester:         ___________
Supabase Project: ___________
Test Business ID: ___________

================================================================
 PHASE 1 — INFRASTRUCTURE VERIFICATION
================================================================

| # | Check                              | Result     | Notes     |
|---|------------------------------------|------------|-----------|
| 1 | pg_cron extension installed         | PASS/FAIL  |           |
| 2 | pg_net extension installed          | PASS/FAIL  |           |
| 3 | marketing-dispatch cron exists      | PASS/FAIL  |           |
| 4 | marketing-dispatch last run OK      | PASS/FAIL  |           |
| 5 | cron-tasks cron exists              |            |           |
| 6 | marketing-automation cron exists    |            |           |
| 7 | cron-tasks verify_jwt=false         |            |           |
| 8 | auto-messages verify_jwt=false      |            |           |
| 9 | Functions deployed (all 5)          |            |           |
| 10| app.settings configured             |            |           |
| 11| auto_messages unique index exists   |            |           |

Infrastructure blockers resolved? [ ] Yes  [ ] No
Blocker details: ___________

================================================================
 PHASE 2 — TEST ENVIRONMENT
================================================================

Test business ID:     ___________
Test tour ID:         ___________
Test WhatsApp #1:     ___________  (for J1-J6, J8, J10, J11)
Test WhatsApp #2:     ___________  (for J7 — separate number)
Test email:           ___________
Manual cron verified? [ ] Yes  [ ] No

================================================================
 PHASE 3 — BEHAVIOURAL TESTS
================================================================

| Test | Name                    | P | F | B | Tester | Time  | Notes / Failure |
|------|-------------------------|---|---|---|--------|-------|-----------------|
| J1   | Day-before reminder     |[ ]|[ ]|[ ]|        |       |                 |
| J2   | Waiver reminder email   |[ ]|[ ]|[ ]|        |       |                 |
| J3   | Review request (WA)     |[ ]|[ ]|[ ]|        |       |                 |
| J4   | Status → COMPLETED      |[ ]|[ ]|[ ]|        |       |                 |
| J5   | Hold expiry             |[ ]|[ ]|[ ]|        |       |                 |
| J6   | Payment deadline expiry |[ ]|[ ]|[ ]|        |       |                 |
| J7   | Re-engagement (90d)     |[ ]|[ ]|[ ]|        |       |                 |
| J8   | Human chat timeout      |[ ]|[ ]|[ ]|        |       |                 |
| J9   | Abandoned cart          |[ ]|[ ]|[X]|  N/A   |  N/A  | Not implemented |
| J10  | Auto-expire unpaid      |[ ]|[ ]|[ ]|        |       |                 |
| J11  | Voucher cleanup         |[ ]|[ ]|[ ]|        |       |                 |

================================================================
 PHASE 4 — CROSS-CUTTING CHECKS
================================================================

| ID  | Name                        | P | F | Notes                   |
|-----|-----------------------------|---|---|-------------------------|
| CC1 | Idempotency (J1 + J3)       |[ ]|[ ]|                         |
| CC2 | Timezone correctness        |[ ]|[ ]|                         |
| CC3 | WA failure handling         |[ ]|[ ]|                         |
| CC4 | Hold expiry vs payment race |[ ]|[ ]|                         |
| CC5 | Recently-paid reminder      |[ ]|[ ]|                         |

================================================================
 SUMMARY
================================================================

Total tests:     16 (11 behavioural + 5 cross-cutting)
Passed:          ___
Failed:          ___
Blocked:         1 (J9)
Not run:         ___

BUGS FOUND:
1. ___________
2. ___________

KNOWN ISSUES (non-blocking):
1. CC3: WA failure doesn't log to auto_messages → infinite
   retry on invalid numbers
2. ___________

BLOCKERS FOR PRODUCTION:
1. ___________

================================================================
 GO / NO-GO RECOMMENDATION
================================================================

[ ] GO — All critical paths pass, known issues are low-severity
[ ] NO-GO — Blocking issues remain:
    ___________

Signed: ___________  Date: ___________
================================================================
```

---

## Cleanup SQL (Run After All Testing)

```sql
-- Delete all test bookings
DELETE FROM auto_messages WHERE booking_id IN (
  SELECT id FROM bookings WHERE customer_name LIKE 'CRONTEST_%'
);
DELETE FROM holds WHERE booking_id IN (
  SELECT id FROM bookings WHERE customer_name LIKE 'CRONTEST_%'
);
DELETE FROM logs WHERE booking_id IN (
  SELECT id FROM bookings WHERE customer_name LIKE 'CRONTEST_%'
);
DELETE FROM bookings WHERE customer_name LIKE 'CRONTEST_%';

-- Delete test vouchers
DELETE FROM vouchers WHERE code LIKE 'CRONTEST-%';

-- Delete test conversations (if created)
DELETE FROM conversations
WHERE business_id = '<TEST_BIZ_ID>' AND phone LIKE '+27%';

-- Delete test slots
DELETE FROM slots WHERE business_id = '<TEST_BIZ_ID>';

-- Delete test tour
DELETE FROM tours WHERE business_id = '<TEST_BIZ_ID>';

-- Optionally delete test business
-- DELETE FROM businesses WHERE id = '<TEST_BIZ_ID>';
```

---

## Open Questions for Gideon

1. **J9 (abandoned cart):** Build it, or defer and remove from test scope?
2. **J10 mapping:** Confirmed that "stale draft cleanup" = auto-expire via `payment_deadline`?
3. **J12:** Include `marketing-automation-dispatch` in testing? It has no cron trigger.
4. **`reminder-scheduler` / `outbox-send`:** Deprecated? Can be ignored?
5. **Capacity release on hold expiry (J5):** The cron does NOT decrement `slots.held`. Is this correct, or is it a bug?
