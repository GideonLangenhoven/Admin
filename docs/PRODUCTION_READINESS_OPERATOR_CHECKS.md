# Production Readiness — Operator Verification

These checks cannot be automated from the codebase and must be run by the
operator before launch. Capture the output as evidence per the
production-readiness manual checklist.

## F5 — Confirm `ENABLE_COMBO_DEALS` is unset / false

### Vercel (admin app)

```bash
# List all env vars for the project
vercel env ls

# If ENABLE_COMBO_DEALS or NEXT_PUBLIC_ENABLE_COMBO_DEALS appear with
# truthy values (true / 1 / yes), remove them:
vercel env rm ENABLE_COMBO_DEALS production
vercel env rm NEXT_PUBLIC_ENABLE_COMBO_DEALS production
```

Expected: neither variable appears in `production`, or both are set to
empty / `false`.

### Supabase Edge Functions

In the Supabase dashboard → **Edge Functions → Secrets**, confirm
`ENABLE_COMBO_DEALS` is not in the list, or is set to `false`.

CLI alternative:

```bash
supabase secrets list | grep -i combo
# Expect: no rows, or ENABLE_COMBO_DEALS=false
```

### Smoke check (any env)

```bash
# Should return HTTP 503 with {"v2":true,"error":"Combo deals are coming soon..."}
curl -s -o /dev/null -w "%{http_code}\n" \
  "$(vercel inspect --output url)/api/combo-offers?business_id=00000000-0000-0000-0000-000000000000"
```

Expected: `503`.

## F6 — Confirm Yoco webhook secret on every active tenant

Run in the Supabase SQL editor (production DB):

```sql
-- Tenants missing a Yoco webhook secret
SELECT
  b.id           AS business_id,
  b.business_name,
  b.active,
  bc.id IS NOT NULL              AS has_credentials_row,
  COALESCE(bc.yoco_webhook_secret, '') <> '' AS has_webhook_secret,
  COALESCE(bc.yoco_secret_key, '') <> ''     AS has_secret_key
FROM public.businesses b
LEFT JOIN public.business_credentials bc ON bc.business_id = b.id
WHERE b.active = true
ORDER BY has_webhook_secret ASC, b.business_name ASC;
```

Expected: every active tenant has `has_webhook_secret = true`.

For any row where it's `false`:

1. Open the admin dashboard → Settings → Integration Credentials
2. Paste the Yoco webhook signing secret from the Yoco dashboard
3. Save (the stored value is encrypted via `pgcrypto`)
4. Re-run the query — confirm the tenant now shows `true`

## Build pipeline note

The `"build"` script runs Next.js via the **webpack** bundler
(`next build --webpack`) rather than Turbopack. Turbopack panics on
`react-day-picker/src/style.css` at the time of writing
(TurbopackInternalError, SIGKILL on a child Node process). The
`"build:turbo"` script remains for re-trying Turbopack once the upstream
issue is fixed. Vercel will automatically pick up the webpack build via
this script.

## F1/F2/F4 — Verify the in-tree fixes

After deploying:

```bash
# F1: rate limiting active
for i in {1..7}; do
  curl -s -o /dev/null -w "%{http_code} " \
    -X POST -H 'Content-Type: application/json' \
    -d '{"email":"x@y.z","password":"x"}' \
    https://<your-domain>/api/admin/login
done
# Expect: 401 401 401 401 401 429 429   (5 attempts then rate-limited)

# F4: cron-tasks scheduled
psql "$SUPABASE_DB_URL" -c \
  "SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'cron-tasks%';"
# Expect:        jobname         |  schedule  | active
#         cron-tasks-every-5-minutes | */5 * * * * |  t
```

## Post-launch monitoring (first 24h)

```sql
-- Capacity invariant — must stay 0
SELECT id, capacity_total, booked, held
  FROM slots
 WHERE booked + held > capacity_total;

-- Stale active holds older than 10 min — should be 0
SELECT id, booking_id, slot_id, expires_at
  FROM holds
 WHERE status = 'ACTIVE' AND expires_at < now() - interval '10 minutes';

-- Negative voucher balances — must stay 0
SELECT id, code, current_balance FROM vouchers WHERE current_balance < 0;

-- Yoco webhook signature failures (last 24h)
SELECT count(*) FROM logs
 WHERE event = 'yoco_webhook_signature_failed'
   AND created_at > now() - interval '24 hours';
```
