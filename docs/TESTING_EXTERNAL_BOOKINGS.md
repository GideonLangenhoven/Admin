# Testing External Booking Integrations — Runbook

**Audience:** developers and operators verifying that OTA channels (Viator, GetYourGuide), the generic B2B `external-booking` API, and payment webhooks behave correctly end-to-end — without charging a real card or polluting production data.

**Golden rule:** always test against a **dedicated test tenant** (a real `businesses` row set up for testing) with **Yoco test mode enabled**. Never point a test at a live operator's tenant.

---

## 1. Sandbox / test-mode support matrix

| Integration | Sandbox? | Mechanism | Where configured |
|---|---|---|---|
| Viator (webhook + availability sync + reconcile) | ✅ | `ota_integrations.test_mode` switches the **outbound** API base URL to Viator's sandbox | Settings → OTA (`app/settings/ota`), MAIN_ADMIN+ |
| GetYourGuide (webhook + sync + reconcile) | ✅ | Same `test_mode` toggle, GYG sandbox base URL | Settings → OTA |
| Yoco (`create-checkout` / `yoco-webhook`) | ✅ | Per-tenant `yoco_test_mode` → test secret key + test webhook secret | Settings → Integration Credentials |
| PayFast (`payfast-itn`) | ✅ (global) | `PAYFAST_SANDBOX=true` edge-function env var — global, **not per-tenant** | Supabase function env |
| **`external-booking` (generic B2B API)** | ❌ **none** | No test mode. Only no-charge path: run against a Yoco-test-mode tenant (checkout links become test links) or use a zero-priced tour | — |
| **Paysafe (`paysafe-webhook`)** | ❌ **none** | Single global `PAYSAFE_WEBHOOK_SECRET`, no sandbox toggle | Supabase function env |

> **Prerequisite gaps (flagged, not yet built):**
> 1. `external-booking` has no first-class sandbox/test mode — see §7.
> 2. Paysafe has no sandbox path at all, so combo/split-pay flows cannot be exercised without a real Paysafe transaction — see §7.

**Important nuance on OTA `test_mode`:** it only changes the *outbound* availability-sync URL. Inbound webhooks are verified identically in test and prod — a simulated OTA booking must still be signed with the tenant's stored `webhook_secret`.

---

## 2. One-time test-tenant setup

1. Create (or reuse) the test business via Super-Admin onboarding. Note its `business_id` (UUID).
2. **Payments:** Settings → Integration Credentials → Yoco: save the Yoco **test** secret key + **test** webhook secret and enable **Test mode**. Card `4111 1111 1111 1111` (any future expiry / any CVV) then completes checkouts without charging money.
3. **OTA:** Settings → OTA → choose channel tab (Viator / GetYourGuide):
   - Save `api_key`, `api_secret`, and a `webhook_secret` (for simulation you may mint your own, e.g. `openssl rand -hex 32` — keep it, you sign test payloads with it).
   - Enable the integration; switch on **Test mode**.
   - Add a **product mapping**: `tour_id` ↔ `external_product_code` (+ option code, markup %). Inbound webhooks are matched on this code — no mapping, no booking.
4. **B2B `external-booking`:** create a credential row (source + API key) via the admin flow, then set an HMAC secret with the `admin_set_hmac` action (JWT-authed). Mutations (create/cancel/modify) **require** HMAC — API-key-only callers can only `check_availability`.
5. Create a tour + OPEN slot on a future date for the test tenant.

---

## 3. Simulating an inbound OTA booking (no card involved)

OTA bookings arrive pre-paid (the OTA holds the money), so simulating the webhook creates a `PAID` booking with **zero payment flow** — this is the safest full-cycle test.

### 3.1 Viator

Endpoint: `POST {SUPABASE_URL}/functions/v1/viator-webhook?b=<business_uuid>`
Auth: HMAC-SHA256 (hex) of the **raw body**, header `x-viator-signature` (a `sha256=` prefix is accepted).

```bash
SUPABASE_URL="https://<project-ref>.supabase.co"
BUSINESS_ID="<test business uuid>"
WEBHOOK_SECRET="<the webhook_secret you saved in Settings → OTA>"

BODY='{"eventType":"BOOKING_CONFIRMED","bookingRef":"TEST-VIA-001","data":{"productCode":"<external_product_code>","travelDate":"2026-07-20T09:00:00Z","travelerCount":2,"totalNetPrice":{"amount":1200},"customer":{"name":"Test Traveller","email":"test@example.com"}}}'

SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex | sed 's/^.* //')

curl -s -X POST "$SUPABASE_URL/functions/v1/viator-webhook?b=$BUSINESS_ID" \
  -H "Content-Type: application/json" \
  -H "x-viator-signature: sha256=$SIG" \
  -d "$BODY"
```

Notes:
- `travelDate` must land within **±30 minutes** of an OPEN slot's `start_time` for the mapped tour.
- Event types route on substring: `CANCEL`→cancel, `AMEND/MODIF/UPDATE`→amend, `CONFIRM/CREAT/BOOKING`→create.
- Any auth failure returns a uniform `401 {"error":"Unauthorized"}` by design (timing-equalised) — if you get 401, re-check the secret, the `?b=` UUID, and that the integration is enabled.

### 3.2 GetYourGuide

Same recipe with header `x-gyg-signature` and endpoint `getyourguide-webhook?b=...`. Payload shape:

```bash
BODY='{"event_type":"BOOKING_CONFIRMED","booking_reference":"TEST-GYG-001","data":{"product_id":"<external_product_code>","datetime":"2026-07-20T09:00:00Z","participants":[{"count":2}],"price":{"net":{"amount":1200}},"traveler":{"name":"Test Traveller","email":"test@example.com"}}}'
```

> ⚠️ **Landmine:** if a GYG integration has **no `webhook_secret` configured**, the webhook accepts **unsigned** payloads (`getyourguide-webhook/index.ts:58-73`). Always configure a secret, including for test tenants.

### 3.3 Verifying idempotency (replay safety)

Send the exact same curl **twice**. The second call must return `200 {"replay":true}` (Viator/GYG key: `viator:<event>:<ref>` / `gyg:<event>:<ref>` in `idempotency_keys`) and must **not** create a second booking or double-increment `slots.booked`.

---

## 4. Simulating a B2B `external-booking` (API key + HMAC)

Endpoint: `POST {SUPABASE_URL}/functions/v1/external-booking`
Auth: `x-api-key` (or `Authorization: Bearer`) **plus**, for mutations, a timestamped HMAC: signature = HMAC-SHA256 over `"<unix-ts>.<raw body>"`, replay window **±300 s**.

```bash
API_KEY="<partner api key>"
HMAC_SECRET="<partner hmac secret>"
TS=$(date +%s)

BODY='{"action":"create_booking","external_ref":"TEST-EXT-001","tour_id":"<tour uuid>","date":"2026-07-20","time":"09:00","qty":2,"customer_name":"Test Traveller","email":"test@example.com","phone":"+27820000000"}'

SIG=$(printf '%s' "$TS.$BODY" | openssl dgst -sha256 -hmac "$HMAC_SECRET" -hex | sed 's/^.* //')

curl -s -X POST "$SUPABASE_URL/functions/v1/external-booking" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -H "x-timestamp: $TS" \
  -H "x-signature: $SIG" \
  -H "x-event-id: TEST-EXT-001-create" \
  -d "$BODY"
```

- `check_availability` works with the API key alone; create/cancel/modify without a valid HMAC must return `401 SIGNATURE_REQUIRED` — test that rejection path too.
- Duplicate `external_ref` → `409 DUPLICATE_BOOKING`. Duplicate `x-event-id` → replay short-circuit via `external_webhook_events`.
- **No-charge payment:** a priced booking comes back PENDING with a Yoco checkout link. On a Yoco-test-mode tenant that's a **test** link — complete it with card `4111 1111 1111 1111`; the yoco-webhook (signed with the test webhook secret) flips it to PAID. Alternatively use a **zero-priced tour** to skip payment entirely.

---

## 5. Verifying two-way sync

**Inbound (OTA → us):** after §3, confirm in the admin app:
1. Booking exists (Bookings page, source `OTA_VIATOR` / `OTA_GETYOURGUIDE`), status PAID, correct qty/amount.
2. `slots.booked` incremented — the slot shows reduced availability.
3. The booking is on the **test tenant only** (tenant isolation).

**Outbound (us → OTA):** the hourly `viator-availability-sync` (`:07`) / `getyourguide-availability-sync` (`:12`) push OPEN-slot availability + marked-up prices for mapped products. To verify without waiting, invoke the function directly, then check `ota_integrations.last_sync_at/status/error` and the sandbox portal's availability view (test_mode targets the sandbox base URL).

**Reconciliation:** `ota-reconcile` (daily 02:37 UTC, or invoke manually) pulls the OTA's last-48h booking list and records `missing_locally` / `missing_on_ota` / `amount_mismatch` / `status_mismatch` in `ota_reconciliation_runs`. After a webhook-simulated booking, expect it to appear as `missing_on_ota` for a **simulated** ref (the sandbox OTA doesn't know it) — that's the reconciler working, not a bug. It reports only; it never auto-heals.

---

## 6. Rolling back a test booking

**OTA booking — replay a cancel webhook (cleanest):** same signing recipe, `eventType: "BOOKING_CANCELLED"` (Viator) / `event_type: "BOOKING_CANCELLED"` (GYG) with the same booking ref. Effect: booking → CANCELLED, `cancelled_at` stamped, `slots.booked` decremented, audit-logged. **No refund is attempted** (OTA-held money), so this is side-effect-free. Idempotent — safe to re-send.

**B2B booking:** `{"action":"cancel_booking","external_ref":"TEST-EXT-001"}` (HMAC-signed). `BOOKING_ALREADY_CANCELLED` on repeat is expected and harmless.

**Yoco-paid test booking:** cancel via the admin UI / `cancel-booking` function. Note this path **computes a policy refund** and calls Yoco — fine in test mode (test refund), but never do it against live keys for a test.

**Do NOT** hand-delete booking rows in the DB as the primary cleanup — you'll orphan slot counters, holds, and audit trails. Direct DB cleanup is a last resort on the test tenant only.

---

## 7. Known gaps — prerequisites before this runbook is fully self-service

1. **`external-booking` sandbox mode (missing).** No `test_mode` on `external_booking_credentials`; a partner integration test needs a Yoco-test-mode tenant or zero-priced tour as a workaround. Build: per-credential test flag that tags created bookings and blocks live checkout links.
2. **Paysafe sandbox (missing).** `paysafe-webhook` verifies against one global `PAYSAFE_WEBHOOK_SECRET`; combo/split-pay cannot be tested without real money movement. Build: sandbox secret + per-tenant/test-mode routing, mirroring the Yoco pattern.
3. **GYG unsigned-webhook acceptance.** With no stored `webhook_secret`, GYG payloads are accepted unsigned. Until fixed in code, treat "webhook secret configured" as mandatory in onboarding.
4. **PayFast fails open** on validation-server network errors (`payfast-itn/index.ts:73`) and uses a single global `BUSINESS_ID` (single-tenant legacy). Do not use PayFast paths for new integration tests; provider is slated for decommission.
5. **No signed-payload replay scripts in `scripts/`** — the curl recipes above are the current tooling. A `scripts/simulate-ota-booking.ts` wrapper would make this one-command.

---

## 8. Quick verification checklist (copy per test run)

- [ ] Test tenant used (never a live operator)
- [ ] Yoco test mode ON for any priced flow
- [ ] Inbound booking created via signed webhook → PAID, correct tenant, slot decremented
- [ ] Same payload replayed → `replay:true`, no duplicate booking
- [ ] Unsigned/garbage-signature payload → 401, zero DB writes
- [ ] Mutation without HMAC (B2B) → `401 SIGNATURE_REQUIRED`
- [ ] Availability sync ran → `ota_integrations.last_sync_at` fresh, no error
- [ ] Cancel webhook/action replayed → booking CANCELLED, capacity returned, idempotent on repeat
- [ ] `npm run check-security-drift` still exits 0
