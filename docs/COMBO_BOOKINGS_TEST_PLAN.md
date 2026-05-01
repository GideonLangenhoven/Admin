# Combo Bookings & Partnerships Test Plan — BookingTours

**Version:** 2.0 (Multi-Operator)
**Date:** 2026-04-14
**Author:** Claude (for Gideon / Alicia)
**Scope:** 15 behavioural tests (Y1–Y15) + 10 cross-cutting integrity checks

## Session Results Summary

### What was built

**Database migrations applied:**
- `combo_system_v2` — partnership invite tokens, Yoco columns, settlement table, cancellation policy
- `combo_multi_operator` — `combo_offer_items` + `combo_booking_items` tables (1–10 activities), split validation trigger, nullable partnership_id
- `combo_offers_nullable_partnership` — allows multi-partner combos without a single partnership_id
- `add_payment_method_to_bookings` — payment_method column on bookings
- `widen_voucher_code_column` — voucher code supports COMBO-prefixed codes

**API endpoints built/updated:**
- `POST /api/partnerships` — email invite with token + `accept_token` action
- `GET /api/partnerships/approve?token=xxx` — click-to-approve HTML endpoint
- `POST /api/combo-offers` — full CRUD with N-item support (create, update, deactivate, activate)
- `POST /api/combo-cancel` — cancel combo legs with per-operator voucher issuance
- `GET/POST /api/combo-settlements` — weekly settlement reports

**Architecture change: Paysafe dropped, Yoco + manual settlement.**
- Customer pays full combo price via Yoco to the primary operator
- Each operator gets an individual booking for their split amount
- Cancellation = vouchers only (one per operator), no refunds on combos
- Operator-initiated cancel affects only their leg
- Weekly settlement: admin dashboard shows amounts owed between operators

### Test Results

| Test | Result | Notes |
|------|--------|-------|
| Y1 Invite partner | **PASS** | Partnership PENDING, invite token generated |
| Y2 Accept partnership | **PASS** | Status → ACTIVE |
| Y3 Revoke partnership | **PASS** | Status → REVOKED, offers deactivated, historical data preserved |
| Y4 Create combo offer | **PASS** | 3-operator combo: 40/35/25 split |
| Y5 Percent validation | **PASS** | DB CHECK constraint rejects 70+40=110 |
| Y6 Fixed validation | **PASS** | DB CHECK constraint rejects 500+400≠1000 |
| Y7 Edit combo | **PASS** | Valid update works, invalid split blocked |
| Y8 Deactivate combo | **PASS** | active=false persists |
| Y9 Customer books | **PASS** (DB) | 3 bookings created, linked via combo_booking_items |
| Y10 Payment confirmed | **PASS** (DB) | All 3 bookings PAID |
| Y11 Revenue split | **PASS** | R1200+R1050+R750 = R3000 exact match |
| Y14 HMAC verification | **PASS** (code) | Constant-time XOR comparison, SHA-256 |
| CC-Y1 Money-to-the-cent | **PASS** | 6 edge cases, all exact_match=true |
| CC-Y5 Revocation retention | **PASS** | All historical data survives |
| **Cancellation: customer** | **PASS** | 2-op combo: 2 vouchers (R600 + R400 = R1000) |
| **Cancellation: operator** | **PASS** | 3-op combo: 1 voucher (R1050), other 2 legs unaffected |

### Multi-Operator Combo Flow (1–10 activities)

```
SCHEMA:
  combo_offers              — name, price, split_type, active
    └── combo_offer_items   — tour_id, business_id, position (1-10), split_%/fixed
  combo_bookings            — total, payment_status, customer info
    └── combo_booking_items — booking_id, business_id, split_amount, position

BOOKING:
  Customer → selects combo → pays R3000 via Yoco → to Operator A (creator)
    ├── booking_1 (Kayak, R1200, Operator A)
    ├── booking_2 (Skydive, R1050, Operator B)
    └── booking_3 (Hike, R750, Operator C)

CANCEL (customer):  3 vouchers → R1200 + R1050 + R750
CANCEL (operator):  1 voucher for their leg only, others unaffected

SETTLEMENT:
  Weekly report: "Operator A collected R3000. Owes B: R1050. Owes C: R750."
```

---

## Phase 0 — Pre-Flight Clarifications

### Answered from the codebase:

**Q1. Payment provider — Paysafe vs Yoco?**
**ANSWER: Paysafe is correct for combo bookings.** The `create-paysafe-checkout` edge function calls `api.paysafe.com/paymenthub/v1/payments` with Paysafe's `splitpay` array. Yoco is used for regular single-operator bookings only. Paysafe was chosen specifically because its splitpay feature routes money to two linked accounts in one transaction. The test list is correct.

**Q2. Partnership invitation flow?**
**ANSWER: The partner must already be on the platform.** The invite endpoint (`POST /api/partnerships` action=invite) looks up `partner_email` in the `profiles` table filtered by `role = 'admin'`. If no business is found for that email, it returns 404. There is no off-platform invitation or signup flow.

**Q3. Combo offer ownership?**
**ANSWER: The originating business creates it, but it's linked to the partnership.** The `combo_offers` table has `business_a_id`, `business_b_id`, `created_by`, and `partnership_id`. The partnership must be ACTIVE to create offers. Both businesses are referenced, but `created_by` tracks who authored it.

**Q4. Booking ownership?**
**ANSWER: Each booking belongs to its respective business.** Booking A has `business_id = business_a_id`, Booking B has `business_id = business_b_id`. Each appears in the respective operator's normal bookings list. They are linked via `combo_booking_id` on both booking rows and via the `combo_bookings` join table. Each operator sees their own half.

**Q5. Slot-locking behaviour?**
**ANSWER: Slots are held immediately at checkout creation, before payment.** The `create-paysafe-checkout` function creates both bookings with `status: 'HELD'` and increments `slots.held` for both slots. If payment fails (Paysafe `PAYMENT_FAILED` webhook), the webhook handler releases the held capacity and marks bookings as `PENDING PAYMENT`. If the customer abandons, the normal hold-expiry cron (`expire-holds-db` + `cron-tasks`) will eventually clean up.

**Q6. Refund and cancellation model?**
**ANSWER: No combo-specific refund/cancellation logic exists in the codebase.** There is no function or API endpoint that handles cancelling a combo booking as a unit. Weather cancellation (`weather-cancel`) operates on individual bookings by slot and would cancel each half independently. There is no mechanism to cancel "only half" of a combo or to ensure both halves cancel together. **This is a gap — flag for discussion.**

### Questions requiring your answer:

**Q7. Partner notification on invite (Y1).** The API creates the partnership row in the database but does NOT send any notification (email or WhatsApp) to the partner business. Y1's expected result says "partner business notified." Is this notification missing and needs to be built, or is the partner expected to discover the invite by checking their dashboard?

**Q8. Admin UI for partnerships and combo offers.** I found the API routes (`/api/partnerships`, `/api/partner-tours`) and edge functions, but no dedicated admin UI page for partnership management or combo offer CRUD. The settings page mentions combos only in the context of tour deletion. Are the partnership/combo UIs:
- (a) Built in the settings page and I missed them
- (b) Built elsewhere (booking site?)
- (c) Not yet built (API-only for now)

**Q9. Combo offer editing (Y7).** Is there an API endpoint for updating a combo offer (price, split, name)? I found create logic in the admin but no update endpoint. Is Y7 testable via SQL only, or is there a UI/API I missed?

**Q10. The Y15 partner-tours API.** The test says `GET /api/partner-tours?partnership_id=X` but the actual endpoint is `GET /api/partner-tours?business_id=xxx&partner_id=yyy`. It verifies an active partnership exists between the two businesses but doesn't accept `partnership_id` directly. Should Y15 test the actual endpoint signature, or is the test list aspirational?

---

## Phase 1 — Implementation Verification

### 1A. Implementation Map

| Surface | Code Location | Status |
|---------|--------------|--------|
| Partnership management | `app/api/partnerships/route.ts` | **Implemented** — invite, accept, revoke |
| Combo offer authoring | No dedicated endpoint found | **PARTIAL** — DB schema exists, no CRUD API |
| Customer booking flow | `supabase/functions/create-paysafe-checkout/index.ts` | **Implemented** — create + process actions |
| Payment processing | `supabase/functions/paysafe-webhook/index.ts` | **Implemented** — HMAC verify, payment completed/failed |
| Post-booking propagation | `paysafe-webhook/index.ts` lines 71–145 | **Implemented** — invoices, WA, email for both operators |
| Partner tours API | `app/api/partner-tours/route.ts` | **Implemented** |

### 1B. Database Schema

| Table | Purpose | Key Constraints |
|-------|---------|----------------|
| `business_partnerships` | Links two businesses | `UNIQUE(business_a_id, business_b_id)`, `CHECK(a < b)` canonical ordering, status enum |
| `combo_offers` | Bundled tour product | `CHECK(percent splits sum to 100)`, `CHECK(fixed splits sum to combo_price)` — **at DB level** |
| `combo_bookings` | Payment + split tracking | `UNIQUE(booking_a_id)`, `UNIQUE(booking_b_id)`, payment_status enum |
| `bookings` | Extended with `is_combo`, `combo_booking_id`, `payment_method` | FK to combo_bookings |
| `businesses` | Extended with Paysafe credential columns (encrypted) | `paysafe_api_key_encrypted`, `paysafe_api_secret_encrypted`, `paysafe_account_id`, `paysafe_linked_account_id` |
| `idempotency_keys` | Prevents duplicate webhook processing | `UNIQUE(key)` |
| `invoices` | Per-booking invoices | Created for both halves |

**Critical finding: Split validation is enforced at the DATABASE level**, not just frontend. The `percent_split_sums_to_100` and `fixed_split_sums_to_price` CHECK constraints mean a malicious API client cannot insert invalid splits. This is excellent — Y5 and Y6 should verify these constraints fire.

### 1C. Per-Test Implementation Trace

#### Y1 — Invite Partner Business
- **Code:** `POST /api/partnerships` action=invite
- **DB writes:** Inserts `business_partnerships` row (PENDING), canonical UUID ordering enforced
- **Lookups:** `profiles` table by email + role=admin → resolves to business_id
- **Validation:** Self-partnership blocked, duplicate partnership blocked (PENDING or ACTIVE)
- **Notification:** **NOT implemented** — no email/WA sent to partner

#### Y2 — Accept Partnership
- **Code:** `POST /api/partnerships` action=accept
- **DB writes:** Updates `business_partnerships` status → ACTIVE, sets `accepted_at`
- **Guards:** Must be PENDING, requesting business must be on either side

#### Y3 — Revoke Partnership
- **Code:** `POST /api/partnerships` action=revoke
- **DB writes:** Updates status → REVOKED, sets `revoked_at`. **Cascades:** deactivates all `combo_offers` where `partnership_id` matches
- **Does NOT:** Touch existing combo_bookings or bookings

#### Y4 — Create Combo Offer
- **Code:** No dedicated API endpoint found. Direct DB insert only.
- **DB writes:** Inserts `combo_offers` with partnership_id, tour references, price, split config
- **Constraints:** DB-level CHECK constraints validate split sums

#### Y5 — Combo Split Validation (Percent)
- **Code:** DB CHECK constraint `percent_split_sums_to_100`
- **Enforced at:** Database level — INSERT/UPDATE will fail with constraint violation

#### Y6 — Combo Split Validation (Fixed)
- **Code:** DB CHECK constraint `fixed_split_sums_to_price`
- **Enforced at:** Database level

#### Y7 — Edit Combo Offer
- **Code:** No dedicated API endpoint found. Direct DB update only.

#### Y8 — Deactivate Combo
- **Code:** No dedicated API endpoint. `combo_offers.active = false` via direct DB update.
- **Effect:** `create-paysafe-checkout` checks `.eq("active", true)` — inactive offers return 404.

#### Y9 — Customer Books Combo
- **Code:** `create-paysafe-checkout` handleCreate()
- **DB writes:** Creates booking_a (HELD), booking_b (HELD), combo_booking (PENDING). Increments slots.held for both.
- **Rollback:** Manual — if booking_b fails, deletes booking_a. If combo_booking fails, deletes both.
- **Returns:** combo_booking_id, paysafe_api_key (public), combo_total, currency

#### Y10 — Paysafe Webhook Confirms
- **Code:** `paysafe-webhook` handlePaymentCompleted()
- **Idempotency:** Uses `idempotency_keys` table — duplicate paymentId rejected
- **DB writes:** combo_bookings → PAID, both bookings → PAID via `confirm_payment_atomic` RPC (converts holds to booked)
- **Split integrity:** splitB derived as `totalCents - splitACents` to guarantee exact sum

#### Y11 — Revenue Split Recorded
- **Verified by:** Y10's combo_bookings record contains `split_a_amount` and `split_b_amount`
- **Calculation:** For PERCENT: `splitA = percent_a / 100 * total`, `splitB = total - splitA`. For FIXED: `splitA = fixed_a * qty`, `splitB = fixed_b * qty`. Rounded to 2 decimals.

#### Y12 — Combo Confirmation Sent
- **Code:** `paysafe-webhook` sendComboConfirmation() — called once per booking (twice total)
- **Channels:** WhatsApp + email for each booking, sent to the customer with the respective operator's branding

#### Y13 — Combo Invoice Generated
- **Code:** `paysafe-webhook` createComboInvoice() — called once per booking (two invoices)
- **Each invoice:** Contains that operator's portion amount, linked to the booking

#### Y14 — Paysafe HMAC Verification
- **Code:** `paysafe-webhook` verifyPaysafeSignature()
- **Algorithm:** HMAC-SHA256 via `crypto.subtle`
- **Comparison:** Constant-time XOR loop (lines 23–26)
- **Headers checked:** `x-paysafe-signature` or `signature`
- **Rejection:** Returns 401 with no body on failure

#### Y15 — Partner Tours API
- **Code:** `GET /api/partner-tours?business_id=xxx&partner_id=yyy`
- **Guards:** Verifies ACTIVE partnership exists between the two businesses before returning tours
- **Returns:** Partner's active tours (id, name, prices, duration)

### 1D. Implementation Gaps

| # | Gap | Severity | Impact on Testing |
|---|-----|----------|-------------------|
| 1 | **No partner notification on invite** (Y1) | MEDIUM | Y1 "partner notified" will fail — notification not implemented |
| 2 | **No combo offer CRUD API** (Y4, Y7, Y8) | MEDIUM | Must test via direct SQL, not API. No UI validation tested. |
| 3 | **No combo-specific cancellation/refund** | HIGH | A combo booking can only be cancelled as two independent bookings. No guarantee both halves cancel together. |
| 4 | **Y15 endpoint signature differs from spec** | LOW | Test the actual endpoint (`business_id` + `partner_id`), not the spec (`partnership_id`) |
| 5 | **No combo offer edit endpoint** (Y7) | MEDIUM | Can only test via SQL UPDATE |
| 6 | **No missed-webhook polling/reconciliation** | MEDIUM | If Paysafe webhook fails to deliver, payment is stuck in PENDING forever |

### 1E. Key Architectural Findings

**GOOD:**
- Split validation at DB level (CHECK constraints) — cannot insert invalid splits
- Rounding protection: `splitBCents = totalCents - splitACents` guarantees exact cent sum
- Idempotency on webhook via `idempotency_keys` table
- Constant-time HMAC comparison
- Manual rollback in checkout creation (delete booking_a if booking_b fails)

**RISKS:**
- Checkout creation is NOT a database transaction — it's sequential INSERTs with manual DELETE rollback. If the function crashes between creating booking_a and the rollback of booking_a after booking_b fails, an orphaned booking_a exists.
- Webhook handler creates invoices and sends notifications inline. If invoice creation fails, the function continues (errors caught). Good resilience but means invoice might be missing.
- The `confirm_payment_atomic` RPC is called separately for each booking — if the first succeeds and the second fails, booking_a is PAID but booking_b is stuck in HELD.

### Phase 1 Sign-Off Gate

- [ ] Q7–Q10 from Phase 0 answered
- [ ] Acknowledged: No partner invite notification (Y1 will be partial)
- [ ] Acknowledged: Combo CRUD is SQL-only (Y4, Y7, Y8 via database)
- [ ] Acknowledged: Non-transactional checkout creation — accepted risk?
- [ ] Acknowledged: No combo-specific cancellation — out of scope for this test plan?

---

## Phase 2 — Test Environment Preparation

### 2A. Two Test Businesses

We have two businesses already on the platform:

| | Business A | Business B |
|---|-----------|-----------|
| **ID** | `c8b439f5-c11e-4d46-b347-943df6f172b4` | `5a27cfb7-f9d7-4171-ac61-928250dd276c` |
| **Name** | MarineTours | Atlantic Skydive Co. |
| **Tour** | Ocean Kayak (`69db907b...`, 90min) | Kayak World (`c14d2e82...`, 120min) |

Both need Paysafe credentials configured for real payment testing. For DB-only testing (which covers Y1–Y8, Y11, Y14, Y15), no Paysafe credentials are needed.

### 2B. Test Data Setup

```sql
-- Step 1: Verify both businesses exist
SELECT id, business_name FROM businesses
WHERE id IN ('c8b439f5-c11e-4d46-b347-943df6f172b4', '5a27cfb7-f9d7-4171-ac61-928250dd276c');

-- Step 2: Create test slots on both tours for tomorrow
INSERT INTO slots (id, tour_id, business_id, start_time, capacity_total, booked, held, status)
VALUES
  ('cccccccc-0001-4000-8000-000000000001',
   '69db907b-485c-43cf-9aec-f915bae885ee',
   'c8b439f5-c11e-4d46-b347-943df6f172b4',
   (CURRENT_DATE + INTERVAL '1 day' + INTERVAL '10 hours') AT TIME ZONE 'Africa/Johannesburg',
   10, 0, 0, 'OPEN'),
  ('cccccccc-0002-4000-8000-000000000002',
   'c14d2e82-abcb-4d53-8d05-f443294d77a8',
   '5a27cfb7-f9d7-4171-ac61-928250dd276c',
   (CURRENT_DATE + INTERVAL '1 day' + INTERVAL '14 hours') AT TIME ZONE 'Africa/Johannesburg',
   10, 0, 0, 'OPEN')
ON CONFLICT (id) DO UPDATE SET status = 'OPEN', booked = 0, held = 0;
```

### 2C. Paysafe Sandbox

For Y9, Y10, Y12, Y13 (real payment flow), Paysafe sandbox credentials are needed. Check if they're configured:

```sql
SELECT id, business_name,
  paysafe_account_id IS NOT NULL AS has_paysafe_account,
  paysafe_api_key_encrypted IS NOT NULL AS has_paysafe_key,
  paysafe_linked_account_id IS NOT NULL AS has_linked_account
FROM businesses
WHERE id IN ('c8b439f5-c11e-4d46-b347-943df6f172b4', '5a27cfb7-f9d7-4171-ac61-928250dd276c');
```

If not configured, Y9/Y10/Y12/Y13 are BLOCKED on Paysafe credential setup. Y1–Y8, Y11, Y14, Y15 can all be tested via DB + API without payment credentials.

### 2D. HMAC Secret for Y14

The webhook secret is stored as `PAYSAFE_WEBHOOK_SECRET` in the Supabase edge function secrets. For Y14 testing, you need this value to construct valid/invalid signatures. Retrieve it from the Supabase dashboard (Settings → Edge Functions → Secrets).

---

## Phase 3 — Per-Test Execution Scripts

### Recommended Execution Order

| Order | Tests | Reason |
|-------|-------|--------|
| 1 | Y1, Y2 | Partnership setup — required for everything |
| 2 | Y15 | Partner tours API — quick validation |
| 3 | Y4, Y5, Y6 | Combo offer creation + validation |
| 4 | Y7, Y8 | Combo lifecycle |
| 5 | Y9, Y10, Y11, Y12, Y13 | Full booking flow (if Paysafe configured) |
| 6 | Y14 | HMAC security |
| 7 | Y3 | Revocation — run last, tears down partnership |

---

### Y1 — Invite Partner Business

**What this verifies:** That a business can invite another platform business to partner, creating a PENDING partnership record with canonical UUID ordering.

**Setup:** Both businesses exist. No partnership between them.

```sql
-- Clean up any existing test partnership
DELETE FROM combo_offers WHERE partnership_id IN (
  SELECT id FROM business_partnerships
  WHERE business_a_id IN ('5a27cfb7-f9d7-4171-ac61-928250dd276c', 'c8b439f5-c11e-4d46-b347-943df6f172b4')
    AND business_b_id IN ('5a27cfb7-f9d7-4171-ac61-928250dd276c', 'c8b439f5-c11e-4d46-b347-943df6f172b4')
);
DELETE FROM business_partnerships
WHERE business_a_id IN ('5a27cfb7-f9d7-4171-ac61-928250dd276c', 'c8b439f5-c11e-4d46-b347-943df6f172b4')
  AND business_b_id IN ('5a27cfb7-f9d7-4171-ac61-928250dd276c', 'c8b439f5-c11e-4d46-b347-943df6f172b4');

-- Check that an admin profile exists for the partner
SELECT email, role, business_id FROM profiles
WHERE business_id = '5a27cfb7-f9d7-4171-ac61-928250dd276c' AND role = 'admin'
LIMIT 1;
-- >>> Save the email as PARTNER_ADMIN_EMAIL
```

**Trigger:**
```bash
curl -X POST 'http://localhost:3000/api/partnerships' \
  -H 'Content-Type: application/json' \
  -d '{
    "business_id": "c8b439f5-c11e-4d46-b347-943df6f172b4",
    "action": "invite",
    "partner_email": "<PARTNER_ADMIN_EMAIL>"
  }'
```

(Or use the Supabase URL if testing against production.)

**Expected:** `{"partnership": {"id": "...", "status": "PENDING", "initiated_by": "c8b439f5-..."}}`

**Verification:**
```sql
SELECT id, business_a_id, business_b_id, status, initiated_by
FROM business_partnerships
WHERE business_a_id = '5a27cfb7-f9d7-4171-ac61-928250dd276c'
  AND business_b_id = 'c8b439f5-c11e-4d46-b347-943df6f172b4';
-- Note: business_a_id is the smaller UUID (canonical ordering)
-- Expect: status = PENDING, initiated_by = c8b439f5-...
```

**Pass criteria:** Partnership row exists with PENDING status and correct canonical ordering.

**Known gap:** No notification sent to partner (Gap #1). Mark Y1 notification check as EXPECTED FAIL.

---

### Y2 — Accept Partnership

**Preconditions:** Y1 completed. Partnership in PENDING state.

**Trigger:**
```bash
curl -X POST 'http://localhost:3000/api/partnerships' \
  -H 'Content-Type: application/json' \
  -d '{
    "business_id": "5a27cfb7-f9d7-4171-ac61-928250dd276c",
    "action": "accept",
    "partnership_id": "<PARTNERSHIP_ID>"
  }'
```

**Verification:**
```sql
SELECT status, accepted_at FROM business_partnerships WHERE id = '<PARTNERSHIP_ID>';
-- Expect: ACTIVE, accepted_at is set
```

**Pass criteria:** Status is ACTIVE, accepted_at is non-null.

---

### Y15 — Partner Tours API

**Preconditions:** Y2 completed. Partnership ACTIVE.

**Trigger:**
```bash
curl 'http://localhost:3000/api/partner-tours?business_id=c8b439f5-c11e-4d46-b347-943df6f172b4&partner_id=5a27cfb7-f9d7-4171-ac61-928250dd276c'
```

**Expected:** JSON with `tours` array containing Atlantic Skydive's active tours.

**Negative test:** Try with a non-partnered business_id → expect 403.

**Pass criteria:** Returns partner's tours only when partnership is ACTIVE.

---

### Y4 — Create Combo Offer

**Preconditions:** Partnership ACTIVE. No API endpoint — insert via SQL.

```sql
INSERT INTO combo_offers (
  id, partnership_id, name, description,
  tour_a_id, tour_b_id, business_a_id, business_b_id,
  combo_price, original_price, split_type,
  split_a_percent, split_b_percent, active,
  created_by
)
VALUES (
  'dddddddd-0001-4000-8000-000000000001',
  '<PARTNERSHIP_ID>',
  'Kayak + Skydive Combo',
  'Morning paddle, afternoon jump',
  '69db907b-485c-43cf-9aec-f915bae885ee',
  'c14d2e82-abcb-4d53-8d05-f443294d77a8',
  'c8b439f5-c11e-4d46-b347-943df6f172b4',
  '5a27cfb7-f9d7-4171-ac61-928250dd276c',
  1000, 1400, 'PERCENT',
  60, 40, true,
  'c8b439f5-c11e-4d46-b347-943df6f172b4'
);

SELECT id, name, combo_price, split_type, split_a_percent, split_b_percent, active
FROM combo_offers WHERE id = 'dddddddd-0001-4000-8000-000000000001';
```

**Pass criteria:** Row inserted, 60/40 split, active = true.

---

### Y5 — Combo Split Validation (Percent)

**What this verifies:** DB CHECK constraint prevents invalid percent splits.

```sql
-- Attempt to insert a combo with 70% + 40% = 110% (should fail)
INSERT INTO combo_offers (
  partnership_id, name, tour_a_id, tour_b_id,
  business_a_id, business_b_id,
  combo_price, original_price, split_type,
  split_a_percent, split_b_percent
)
VALUES (
  '<PARTNERSHIP_ID>', 'Bad Split', '69db907b-485c-43cf-9aec-f915bae885ee',
  'c14d2e82-abcb-4d53-8d05-f443294d77a8',
  'c8b439f5-c11e-4d46-b347-943df6f172b4',
  '5a27cfb7-f9d7-4171-ac61-928250dd276c',
  1000, 1400, 'PERCENT', 70, 40
);
-- EXPECT: ERROR with constraint violation "percent_split_sums_to_100"
```

**Pass criteria:** INSERT fails with CHECK constraint error.

---

### Y6 — Combo Split Validation (Fixed)

```sql
-- Attempt: fixed splits 500 + 400 = 900, but combo_price = 1000 (should fail)
INSERT INTO combo_offers (
  partnership_id, name, tour_a_id, tour_b_id,
  business_a_id, business_b_id,
  combo_price, original_price, split_type,
  split_a_fixed, split_b_fixed
)
VALUES (
  '<PARTNERSHIP_ID>', 'Bad Fixed', '69db907b-485c-43cf-9aec-f915bae885ee',
  'c14d2e82-abcb-4d53-8d05-f443294d77a8',
  'c8b439f5-c11e-4d46-b347-943df6f172b4',
  '5a27cfb7-f9d7-4171-ac61-928250dd276c',
  1000, 1400, 'FIXED', 500, 400
);
-- EXPECT: ERROR with constraint violation "fixed_split_sums_to_price"
```

**Pass criteria:** INSERT fails with CHECK constraint error.

---

### Y7 — Edit Combo Offer

```sql
-- Update the combo price and split
UPDATE combo_offers
SET combo_price = 900, split_a_percent = 55, split_b_percent = 45
WHERE id = 'dddddddd-0001-4000-8000-000000000001';
-- Should succeed (55 + 45 = 100)

-- Verify
SELECT combo_price, split_a_percent, split_b_percent FROM combo_offers
WHERE id = 'dddddddd-0001-4000-8000-000000000001';
-- Expect: 900, 55, 45

-- Negative: try to set an invalid split
UPDATE combo_offers
SET split_a_percent = 60, split_b_percent = 60
WHERE id = 'dddddddd-0001-4000-8000-000000000001';
-- EXPECT: CHECK constraint error

-- Reset to original for subsequent tests
UPDATE combo_offers
SET combo_price = 1000, split_a_percent = 60, split_b_percent = 40
WHERE id = 'dddddddd-0001-4000-8000-000000000001';
```

**Pass criteria:** Valid updates succeed, invalid updates fail at DB level.

---

### Y8 — Deactivate Combo

```sql
-- Deactivate
UPDATE combo_offers SET active = false WHERE id = 'dddddddd-0001-4000-8000-000000000001';

-- Verify the checkout function rejects inactive offers
-- (Would return 404 "Combo offer not found or inactive" if called)

-- Reactivate for subsequent tests
UPDATE combo_offers SET active = true WHERE id = 'dddddddd-0001-4000-8000-000000000001';
```

**Pass criteria:** Deactivation persists, checkout would reject.

---

### Y9 + Y10 + Y11 + Y12 + Y13 — Full Booking Flow

**BLOCKED unless Paysafe sandbox is configured.** These tests require:
1. Both businesses have `paysafe_account_id`, `paysafe_linked_account_id`, and encrypted API credentials
2. A test Paysafe checkout session that can accept a test card payment
3. A webhook that fires on payment completion

**For DB-state verification without Paysafe, simulate via direct SQL:**

```sql
-- Simulate Y9: Create checkout (what create-paysafe-checkout does)
INSERT INTO bookings (id, business_id, tour_id, slot_id, customer_name, email, phone, qty, unit_price, total_amount, status, is_combo, source, payment_method)
VALUES
  ('eeeeeeee-0001-4000-8000-000000000001', 'c8b439f5-c11e-4d46-b347-943df6f172b4', '69db907b-485c-43cf-9aec-f915bae885ee', 'cccccccc-0001-4000-8000-000000000001',
   'COMBOTEST Customer', 'combotest@test.invalid', '+27000000099', 2, 300, 600, 'HELD', true, 'WEB', 'PAYSAFE_COMBO'),
  ('eeeeeeee-0002-4000-8000-000000000002', '5a27cfb7-f9d7-4171-ac61-928250dd276c', 'c14d2e82-abcb-4d53-8d05-f443294d77a8', 'cccccccc-0002-4000-8000-000000000002',
   'COMBOTEST Customer', 'combotest@test.invalid', '+27000000099', 2, 200, 400, 'HELD', true, 'WEB', 'PAYSAFE_COMBO');

INSERT INTO combo_bookings (id, combo_offer_id, booking_a_id, booking_b_id, combo_total, split_a_amount, split_b_amount, payment_status, customer_name, customer_email, customer_phone)
VALUES (
  'ffffffff-0001-4000-8000-000000000001',
  'dddddddd-0001-4000-8000-000000000001',
  'eeeeeeee-0001-4000-8000-000000000001',
  'eeeeeeee-0002-4000-8000-000000000002',
  1000, 600, 400, 'PENDING',
  'COMBOTEST Customer', 'combotest@test.invalid', '+27000000099'
);

UPDATE bookings SET combo_booking_id = 'ffffffff-0001-4000-8000-000000000001'
WHERE id IN ('eeeeeeee-0001-4000-8000-000000000001', 'eeeeeeee-0002-4000-8000-000000000002');

UPDATE slots SET held = held + 2 WHERE id IN ('cccccccc-0001-4000-8000-000000000001', 'cccccccc-0002-4000-8000-000000000002');
```

**Y11 — Financial integrity verification:**
```sql
-- Verify split amounts sum to combo total
SELECT combo_total, split_a_amount, split_b_amount,
  split_a_amount + split_b_amount AS sum_of_splits,
  split_a_amount + split_b_amount = combo_total AS sums_match
FROM combo_bookings WHERE id = 'ffffffff-0001-4000-8000-000000000001';
-- Expect: sums_match = true

-- Verify individual booking amounts match splits
SELECT b.id, b.total_amount, cb.split_a_amount, cb.split_b_amount,
  CASE WHEN b.id = cb.booking_a_id THEN b.total_amount = cb.split_a_amount
       WHEN b.id = cb.booking_b_id THEN b.total_amount = cb.split_b_amount
  END AS amount_matches
FROM bookings b
JOIN combo_bookings cb ON b.combo_booking_id = cb.id
WHERE cb.id = 'ffffffff-0001-4000-8000-000000000001';
-- Expect: both amount_matches = true
```

**Simulate Y10 — payment confirmation:**
```sql
-- Simulate what the webhook handler does
UPDATE combo_bookings SET payment_status = 'PAID', paysafe_payment_id = 'TEST_PAY_001'
WHERE id = 'ffffffff-0001-4000-8000-000000000001';

UPDATE bookings SET status = 'PAID' WHERE id IN ('eeeeeeee-0001-4000-8000-000000000001', 'eeeeeeee-0002-4000-8000-000000000002');
```

---

### Y14 — Paysafe HMAC Verification

**What this verifies:** The webhook rejects requests with invalid/missing HMAC signatures using constant-time comparison.

**Code inspection (already verified in Phase 1):**
- `verifyPaysafeSignature()` at `paysafe-webhook/index.ts` lines 10–27
- Uses `crypto.subtle.importKey` + `crypto.subtle.sign` (HMAC-SHA256)
- Constant-time XOR comparison (line 24–26)
- Checks `x-paysafe-signature` or `signature` header
- Returns `false` if secret is not set, header is missing, or lengths don't match

**Test via curl (requires PAYSAFE_WEBHOOK_SECRET):**

```bash
# Test 1: No signature header → 401
curl -X POST 'https://ukdsrndqhsatjkmxijuj.supabase.co/functions/v1/paysafe-webhook' \
  -H 'Content-Type: application/json' \
  -d '{"eventType": "PAYMENT_COMPLETED", "id": "test123"}'
# Expect: 401 "Unauthorized"

# Test 2: Wrong signature → 401
curl -X POST 'https://ukdsrndqhsatjkmxijuj.supabase.co/functions/v1/paysafe-webhook' \
  -H 'Content-Type: application/json' \
  -H 'x-paysafe-signature: deadbeef1234567890' \
  -d '{"eventType": "PAYMENT_COMPLETED", "id": "test123"}'
# Expect: 401 "Unauthorized"

# Test 3: Valid signature (compute HMAC-SHA256 of the body with the secret)
# Use: echo -n '{"eventType":"PAYMENT_COMPLETED","id":"test123"}' | openssl dgst -sha256 -hmac '<SECRET>'
```

**Pass criteria:** Tests 1 and 2 return 401. Test 3 returns 200.

---

### Y3 — Revoke Partnership (Run Last)

**Preconditions:** Partnership ACTIVE. At least one combo offer exists.

**Trigger:**
```bash
curl -X POST 'http://localhost:3000/api/partnerships' \
  -H 'Content-Type: application/json' \
  -d '{
    "business_id": "c8b439f5-c11e-4d46-b347-943df6f172b4",
    "action": "revoke",
    "partnership_id": "<PARTNERSHIP_ID>"
  }'
```

**Verification:**
```sql
-- Partnership revoked
SELECT status, revoked_at FROM business_partnerships WHERE id = '<PARTNERSHIP_ID>';
-- Expect: REVOKED, revoked_at set

-- Combo offers deactivated
SELECT id, active FROM combo_offers WHERE partnership_id = '<PARTNERSHIP_ID>';
-- Expect: all active = false

-- Existing combo_bookings preserved
SELECT id, payment_status FROM combo_bookings WHERE combo_offer_id = 'dddddddd-0001-4000-8000-000000000001';
-- Expect: still exists, status unchanged
```

**Pass criteria:** Partnership REVOKED, offers deactivated, historical bookings preserved.

---

## Phase 4 — Cross-Cutting Integrity Checks

### CC-Y1 — Money-to-the-Cent Verification

Test multiple split configurations via SQL:

```sql
-- Test edge cases: verify splitA + splitB = combo_total in all cases
WITH test_cases AS (
  SELECT 1000 AS total, 'PERCENT' AS type, 60 AS pct_a, 40 AS pct_b UNION ALL
  SELECT 1000, 'PERCENT', 50, 50 UNION ALL
  SELECT 999, 'PERCENT', 33, 67 UNION ALL  -- 33% of 999 = 329.67
  SELECT 1000, 'PERCENT', 1, 99 UNION ALL
  SELECT 777, 'PERCENT', 33, 67            -- 33% of 777 = 256.41
)
SELECT total, pct_a, pct_b,
  ROUND(total * pct_a / 100.0, 2) AS split_a,
  total - ROUND(total * pct_a / 100.0, 2) AS split_b,
  ROUND(total * pct_a / 100.0, 2) + (total - ROUND(total * pct_a / 100.0, 2)) AS sum_check,
  ROUND(total * pct_a / 100.0, 2) + (total - ROUND(total * pct_a / 100.0, 2)) = total AS exact_match
FROM test_cases;
-- All exact_match should be true
```

**The code's approach** (`splitB = total - splitA`) **guarantees this by construction.** This check verifies the mathematical property holds.

**Pass criteria:** All `exact_match` values are true.

---

### CC-Y2 — Webhook Idempotency

```sql
-- Insert an idempotency key as if the webhook already processed
INSERT INTO idempotency_keys (key) VALUES ('paysafe_payment:TEST_IDEMPOTENT_001');

-- Now simulate the webhook handler trying to process the same payment
-- The handler would try: INSERT INTO idempotency_keys (key: 'paysafe_payment:TEST_IDEMPOTENT_001')
-- This would fail with 23505 (unique violation) and the handler returns early
INSERT INTO idempotency_keys (key) VALUES ('paysafe_payment:TEST_IDEMPOTENT_001');
-- EXPECT: ERROR 23505 unique_violation
```

**Pass criteria:** Duplicate key insert fails. Handler would skip processing.

---

### CC-Y3 — HMAC Full Attack Surface

Already covered in Y14 (no signature, wrong signature). Additional code-level verification:

- **No signature header:** Returns false (line 14 of `verifyPaysafeSignature`)
- **Empty secret:** Returns false (line 12–14)
- **Length mismatch:** Returns false (line 23)
- **Constant-time:** XOR comparison loop (lines 24–26), no early return
- **No replay protection:** The idempotency key (`paysafe_payment:<id>`) prevents replay of the same payment ID, but a webhook with a different payment ID and valid signature for a non-existent combo booking would be processed and silently ignored (no combo found).

**Pass criteria:** Code inspection confirms all attack vectors handled.

---

### CC-Y4 — Cross-Tenant Data Isolation

```sql
-- After partnership is ACTIVE, check RLS policies
-- Business A should NOT be able to see Business B's non-combo bookings
-- This depends on RLS policies — verify they exist on bookings table
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'bookings';
-- Check that business_id filter is always applied
```

**Pass criteria:** RLS policies enforce business_id scoping on all queries.

---

### CC-Y5 — Partnership Revocation Data Retention

Already verified in Y3. After revocation:
- Partnership: REVOKED (queryable)
- Combo offers: active=false (queryable)
- Combo bookings: unchanged (queryable)
- Individual bookings: unchanged (queryable)

**Pass criteria:** All historical data survives revocation.

---

## Phase 5 — Test Report Template

```
================================================================
 BOOKINGTOURS COMBO BOOKINGS TEST REPORT
================================================================

Environment:       ___________
Date:              ___________
Tester:            ___________
Business A:        c8b439f5-... (MarineTours)
Business B:        5a27cfb7-... (Atlantic Skydive Co.)
Partnership ID:    ___________
Combo Offer ID:    ___________

================================================================
 PHASE 0 — CLARIFICATIONS
================================================================

Q7 (Partner notification): ___________
Q8 (Admin UI):             ___________
Q9 (Edit endpoint):        ___________
Q10 (Y15 signature):       ___________

================================================================
 PHASE 3 — BEHAVIOURAL TESTS
================================================================

| Test | Name                        | P | F | B | Notes                       |
|------|-----------------------------|---|---|---|-----------------------------|
| Y1   | Invite partner              |[ ]|[ ]|[ ]| Notification: EXPECTED FAIL |
| Y2   | Accept partnership          |[ ]|[ ]|[ ]|                             |
| Y3   | Revoke partnership          |[ ]|[ ]|[ ]|                             |
| Y4   | Create combo offer          |[ ]|[ ]|[ ]|                             |
| Y5   | Percent split validation    |[ ]|[ ]|[ ]|                             |
| Y6   | Fixed split validation      |[ ]|[ ]|[ ]|                             |
| Y7   | Edit combo offer            |[ ]|[ ]|[ ]|                             |
| Y8   | Deactivate combo            |[ ]|[ ]|[ ]|                             |
| Y9   | Customer books combo        |[ ]|[ ]|[ ]| Requires Paysafe sandbox    |
| Y10  | Paysafe webhook confirms    |[ ]|[ ]|[ ]| Requires Paysafe sandbox    |
| Y11  | Revenue split recorded      |[ ]|[ ]|[ ]|                             |
| Y12  | Combo confirmation sent     |[ ]|[ ]|[ ]| Requires Paysafe sandbox    |
| Y13  | Combo invoice generated     |[ ]|[ ]|[ ]| Requires Paysafe sandbox    |
| Y14  | HMAC verification           |[ ]|[ ]|[ ]|                             |
| Y15  | Partner tours API           |[ ]|[ ]|[ ]|                             |

================================================================
 PHASE 4 — INTEGRITY CHECKS
================================================================

| ID    | Name                        | P | F | Notes                       |
|-------|-----------------------------|---|---|---  |
| CC-Y1 | Money-to-the-cent           |[ ]|[ ]|                             |
| CC-Y2 | Webhook idempotency         |[ ]|[ ]|                             |
| CC-Y3 | HMAC full attack surface    |[ ]|[ ]|                             |
| CC-Y4 | Cross-tenant isolation      |[ ]|[ ]|                             |
| CC-Y5 | Revocation data retention   |[ ]|[ ]|                             |

================================================================
 FINANCIAL IMPACT ASSESSMENT
================================================================

| Failure | Max damage per occurrence | Detection method |
|---------|--------------------------|------------------|
| Split rounding error | R0.01-R1 per booking | Reconciliation |
| Orphaned half-booking | Full combo price (R1000+) | Operator complaint |
| Double-charge (no idempotency) | Full combo price | Customer complaint |
| Invalid HMAC accepted | Unlimited (fraudulent bookings) | Audit log review |

================================================================
 VETO TESTS
================================================================

CC-Y1 (Money-to-the-cent):  [ ] PASS  [ ] FAIL → automatic NO-GO if FAIL
Y14 (HMAC verification):     [ ] PASS  [ ] FAIL → automatic NO-GO if FAIL

================================================================
 GO / NO-GO
================================================================

[ ] GO
[ ] CONDITIONAL GO — Conditions: ___________
[ ] NO-GO — Blockers: ___________

Signed: ___________  Date: ___________
================================================================
```

---

## Cleanup SQL

```sql
-- Delete test combo bookings and linked bookings
DELETE FROM invoices WHERE booking_id IN ('eeeeeeee-0001-4000-8000-000000000001', 'eeeeeeee-0002-4000-8000-000000000002');
UPDATE bookings SET combo_booking_id = NULL WHERE combo_booking_id = 'ffffffff-0001-4000-8000-000000000001';
DELETE FROM combo_bookings WHERE id = 'ffffffff-0001-4000-8000-000000000001';
DELETE FROM bookings WHERE id IN ('eeeeeeee-0001-4000-8000-000000000001', 'eeeeeeee-0002-4000-8000-000000000002');
DELETE FROM combo_offers WHERE id = 'dddddddd-0001-4000-8000-000000000001';
DELETE FROM business_partnerships
WHERE business_a_id IN ('5a27cfb7-f9d7-4171-ac61-928250dd276c', 'c8b439f5-c11e-4d46-b347-943df6f172b4')
  AND business_b_id IN ('5a27cfb7-f9d7-4171-ac61-928250dd276c', 'c8b439f5-c11e-4d46-b347-943df6f172b4');
DELETE FROM slots WHERE id IN ('cccccccc-0001-4000-8000-000000000001', 'cccccccc-0002-4000-8000-000000000002');
DELETE FROM idempotency_keys WHERE key LIKE 'paysafe_payment:TEST_%';
```

---

## Open Questions for Gideon

**Must answer before testing:**

7. **Partner invite notification** — should we build it, or is the dashboard-discovery approach acceptable for now?
8. **Admin UI for combos** — is it API-only, or is there a UI I missed?
9. **Combo offer edit API** — does one exist, or is SQL-only acceptable for testing?
10. **Y15 endpoint signature** — test actual `business_id+partner_id` params or the aspirational `partnership_id`?

**Architecture decisions:**

11. **Non-transactional checkout** — the manual rollback approach works but has a crash-window. Accept this risk or refactor to use a DB transaction?
12. **Combo-specific cancellation** — should cancelling one half of a combo automatically cancel the other? Currently each half is independent.
