# external-booking

Shared multi-tenant Supabase Edge Function for supplier and OTA webhook traffic.

## How Tenant Routing Works

- Every business gets its own credential row in `external_booking_credentials`
- Clients send one shared endpoint request to `/functions/v1/external-booking`
- The function resolves the business by hashing the incoming `x-api-key` and looking up the matching credential row
- No `BUSINESS_ID` env var is required for this function

## Environment

Required:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Auth

Required headers:

- `x-api-key`
- `x-source` or `source` in the JSON body

Optional HMAC mode:

- If the credential row has an `hmac_secret`, the client must also send `x-timestamp` and `x-signature`
- Signature format: `HMAC_SHA256(secret, `${x-timestamp}.${raw-json-body}`)`
- The function rejects signatures older than 5 minutes

## Event Tracking

Use `x-event-id` when your supplier provides a stable event identifier. If omitted, the function falls back to `event_id`, `webhook_event_id`, or `external_ref` from the body.

Every authenticated request is logged in `external_webhook_events` with:

- raw payload
- action
- source
- business id
- event id
- retry count
- processed status
- HTTP response body

## Response Contract

Every response returns:

```json
{
  "success": true,
  "code": "BOOKING_CREATED",
  "message": "Booking created",
  "request_id": "...",
  "event_id": "...",
  "source": "VIATOR",
  "action": "create_booking"
}
```

Use `code` for integration logic. Not `message`.

## Supported Actions

### `check_availability`

```json
{
  "action": "check_availability",
  "source": "VIATOR",
  "tour_name": "Sea Kayak Tour",
  "date": "2026-03-15",
  "time": "09:00",
  "qty": 4
}
```

### `create_booking`

```json
{
  "source": "VIATOR",
  "external_ref": "VIA-123456",
  "tour_name": "Sea Kayak Tour",
  "date": "2026-03-15",
  "time": "09:00",
  "qty": 4,
  "customer_name": "John Smith",
  "email": "john@example.com",
  "phone": "+44...",
  "total_paid": 2800,
  "status": "PAID",
  "supplier_payment_status": "PAID",
  "supplier_settlement_status": "PENDING",
  "supplier_payout_amount": 2100,
  "supplier_commission_amount": 700
}
```

### `cancel_booking`

```json
{
  "action": "cancel_booking",
  "source": "VIATOR",
  "external_ref": "VIA-123456",
  "cancel_reason": "Customer cancelled on supplier platform"
}
```

### `modify_booking`

```json
{
  "action": "modify_booking",
  "source": "VIATOR",
  "external_ref": "VIA-123456",
  "new_date": "2026-03-16",
  "new_time": "09:00",
  "new_qty": 3
}
```

## Admin Setup

Use the Settings page to:

- create one credential per business/source
- rotate API keys
- enable or disable HMAC signing
- manage product mappings per business

For bulk rollout across all active businesses, run:

```sql
select *
from public.ck_seed_external_booking_credentials('VIATOR', true);
```

This creates one credential row per active business for that source and returns the plaintext API key and HMAC secret once.

## Database Setup

Run the migration in [20260308_external_booking.sql](/Users/gideonlangenhoven/Desktop/CapeKayak/capekayak/supabase/migrations/20260308_external_booking.sql).
