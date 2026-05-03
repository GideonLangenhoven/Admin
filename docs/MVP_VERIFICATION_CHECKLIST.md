# MVP Verification Checklist

Runbook for the launch-blocker tests called out in the MVP brief. Each
test maps to the acceptance criteria. This file is the single source of
truth for "did we actually verify it?" — fill in the **Result** column
with PASS / FAIL / N/A and a one-line note. Keep evidence (request
payloads, DB rows before/after, log lines, screenshots) in the linked
locations.

> **Scope:** v1 MVP only. Combo deals + Paysafe are explicitly out of
> MVP and stay disabled via `ENABLE_COMBO_DEALS=false`.

## How to run

```bash
# Unit tests (prompt-injection regression suite for the bot guards)
npm install
npm run test:unit

# E2E (existing Playwright suite — booking flow, dashboard, etc.)
npx playwright test
```

The unit test suite at `tests/unit/bot-guards.test.ts` covers WB7
(prompt injection) and the leak / media-fallback / stale-session
contract pieces of WB6 / WB16 / WB19. Everything else in the table
below is a manual or DB-driven test against a staging environment.

## Workstream A — combo deals disabled

| Test | Steps | Expected | Evidence | Result |
|------|-------|----------|----------|--------|
| A1   | With `ENABLE_COMBO_DEALS=false`, hit `/api/combo-offers?business_id=…` | `503` with `{ ok: false, enabled: false, v2: true }` | curl output | |
| A2   | POST any action to `/api/combo-cancel` | `503` "coming soon" | curl output | |
| A3   | POST to `/api/combo-settlements` | `503` "coming soon" | curl output | |
| A4   | GET `/api/partnerships?business_id=…` | `503` "coming soon" | curl output | |
| A5   | GET `/api/partner-tours?...` | `503` "coming soon" | curl output | |
| A6   | GET `/api/partnerships/approve?token=…` | HTML "Coming Soon" page | screenshot | |
| A7   | POST to `create-paysafe-checkout` edge function | `503` "coming soon", no Paysafe API call made | function logs | |
| A8   | POST a fake Paysafe webhook to `paysafe-webhook` | `200` ACK, no booking state mutated | function logs + DB diff | |
| A9   | Search customer-facing booking site for combo cards / partner CTAs | None visible | screenshots | |

## Workstream B — standard booking blockers

### AH1: Yoco webhook idempotency

1. Send a real `payment.succeeded` webhook for a HELD booking.
2. Capture the response, the `idempotency_keys` row, and the booking
   state.
3. Replay the **exact same** webhook payload + signature.
4. Verify exactly one of each: confirmation, slot conversion, email,
   WhatsApp message.

| Check | Expected |
|-------|----------|
| `idempotency_keys` row count for that key | 1 |
| `bookings.status` | `PAID` |
| `bookings.confirmation_sent_at` | populated once |
| `logs` events for `booking_confirmation_notifications_sent` | 1 |

### AH9: promo duplicate-use (sequential + concurrent)

After applying migration `20260425120000_promo_atomic_enforcement.sql`:

1. **Sequential:** book once with email `a@b.com` + promo `WELCOME10`.
   Re-attempt with the same email. The second `validate_promo_code`
   call returns `valid:false, error:"You have already used this
   promo code"`. The `apply_promo_code` call (if reached) returns
   `{ok:false,error:"this email has already used this promo"}`.
2. **Casing:** repeat with `A@B.COM` and `a@b.com` — same result.
3. **Concurrent:** spawn 5 parallel POSTs to `create-checkout` with
   the same email + promo. Exactly one succeeds, the other four
   return the duplicate-use error.
4. **DB state:** `promotion_uses` has exactly one row for that
   `(promotion_id, lower(email))`. `promotions.used_count` increments
   by 1 only.

### AH13: expired hold releases capacity

1. Create a HELD booking with `holds.expires_at = now() - 6 minutes`
   (so it's past the 5-min grace window).
2. Wait for the next `cron-tasks` tick (or trigger it manually).
3. `slots.held` decremented by the hold qty. `holds.status = 'EXPIRED'`.
4. Replay the cron call — capacity is **not** double-released.

### AH14: concurrent standard booking hold race (N=2, 5, 10)

1. Find a slot with `available_capacity = 1`.
2. Spawn N concurrent customer-site bookings via `create-checkout`.
3. Exactly one succeeds (HELD); the rest get
   `"Sorry, those spots were just taken!"`.
4. `slots.held + slots.booked <= slots.capacity_total` holds for the
   entire test.

### AH15: concurrent voucher drain (N=2, 5, 10)

1. Voucher with `current_balance = 100`, `pax_limit = 5`, on a slot
   priced at R100/pp.
2. Spawn N concurrent voucher-paid bookings (web-chat or wa-webhook).
3. With the MVP fix in place (capacity check FIRST, then voucher drain):
   - One booking succeeds, capacity decremented by 1.
   - Remaining N-1 fail at the capacity step with no voucher movement.
   - `vouchers.current_balance` is exactly the original minus the
     successful deduction (never negative).

### Voucher path order (MVP fix — verify both bots)

- **wa-webhook** `supabase/functions/wa-webhook/index.ts` line ~1942:
  `create_hold_with_capacity_check` runs **before** the voucher
  deduction loop. Confirm by reading the file.
- **web-chat** `supabase/functions/web-chat/index.ts` line ~469:
  same order.

### Booking duplicate-submit guard (admin)

1. Open `/new-booking` in the admin app.
2. Fill the form, then click "Create Booking" twice within 100ms.
3. Only one booking is inserted. Console shows
   `[NEW_BOOKING] duplicate submit blocked` for the second click.

## Workstream C — bot production readiness

### WB3: cross-channel session isolation

1. As one user, open the webchat widget on the booking site (browser A)
   and a WhatsApp chat (phone) at the same time.
2. Pick a tour in webchat, then send "show my booking" via WhatsApp.
3. Webchat's chosen tour does NOT appear in WhatsApp's response.
4. WhatsApp's `conversations` row is keyed only by `phone`; webchat
   state lives only in the webchat session (client + future
   `webchat_sessions` table after running migration
   `20260425130000_bot_hardening.sql`).

### WB6: out-of-KB refusal + handoff

1. Ask the bot a clearly off-topic question, e.g. "What's the capital
   of France?"
2. Reply contains the KB-refusal wording (or close paraphrase) and an
   offer to connect with the team. Conversation `status` is set to
   `HUMAN` if the user accepts.

### WB7: prompt-injection regression — automated

```bash
npm run test:unit
```

Expected: all `WB7: prompt-injection regression — required inputs`
tests pass. Includes the six payloads from the brief plus 12
adversarial extensions.

### WB9: duplicate WhatsApp inbound webhook

1. Send the same Meta webhook payload twice (same `message.id`).
2. `processed_wa_messages` has exactly one row for that ID.
3. Bot replies exactly once. Function logs include
   `WA dedup skip — already processed message id:…` on the second
   call.

### WB10: full slot — bot does not send payment link

1. Pick a slot at `available_capacity = 0`.
2. Walk the WhatsApp bot through booking that slot.
3. Bot replies with the no-availability message (or alt-tour offer)
   and never invokes `create-checkout` / never sends a `redirectUrl`.

### WB11: handoff last-spot race

1. Slot at `available_capacity = 1`.
2. Two customers reach the payment-link stage simultaneously.
3. The second customer's `create-checkout` call gets a graceful
   "those spots were just taken" response. They are NOT redirected to
   a Yoco page that would charge them with no slot to redeem.

### WB12: cross-channel voucher drain

1. Voucher balance R100. Customer applies it via webchat AND tries to
   apply it via WhatsApp at the same time.
2. With the row-locked `deduct_voucher_balance` RPC, exactly one
   succeeds and one fails cleanly. `vouchers.current_balance` never
   goes negative.

### WB13: expired voucher rejected by bot

1. Voucher with `expires_at < now()` (or status != ACTIVE).
2. Customer enters the code in webchat / wa-webhook.
3. Bot replies that the voucher is expired. No payment link is
   generated containing the expired voucher.

### WB16 / WB19: outbound failure not silently lost

1. Force a Graph API failure (e.g. revoke the WA token in staging) and
   trigger a bot reply.
2. The reply attempt is recorded in `outbox` with
   `status='FAILED'` and a populated `error` column. Booking state is
   NOT marked as "delivered". Function logs include
   `WA_OUTBOUND_FAILURE_RECORD_ERR` only if even the outbox write
   fails.
3. Operator inbox shows the failed message in the FAILED bucket.

## Webchat widget responsiveness

| Test | Steps | Expected | Result |
|------|-------|----------|--------|
| W1   | Load widget at viewport 320px | No horizontal scroll, all controls reachable | |
| W2   | Load widget at viewport 375px | Same | |

> Widget code lives in the customer-facing booking site repo, not in
> this admin repo. Verify in `~/dev/booking`.

## Sign-off

- [ ] All Workstream A tests PASS or N/A.
- [ ] All Workstream B blockers PASS.
- [ ] All Workstream C blockers PASS or have a documented mitigation.
- [ ] Webchat widget verified at 320px + 375px.
- [ ] `npm run test:unit` green.
- [ ] `npx playwright test` green for `tests/e2e/full-journey.spec.ts`.

Final GO/NO-GO: see `docs/MVP_PRODUCTION_READINESS.md`.
