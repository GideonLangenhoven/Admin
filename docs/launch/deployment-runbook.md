# Deployment Runbook - CapeKayak SaaS Launch v3

## Scope
This runbook deploys:
- Billing/plan schema and enforcement triggers
- Top-up payment flow and idempotent webhook handling
- Landing page add-on billing lifecycle
- Admin + booking cap enforcement UI updates
- Public launch pages (`/operators`, `/case-study/cape-kayak`, `/compare/manual-vs-disconnected-tools`)

## Preconditions
- Supabase CLI installed and authenticated.
- Production project linked (`supabase link --project-ref <PROJECT_REF>`).
- Required secrets set for edge functions in production:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `YOCO_SECRET_KEY`
  - `WA_ACCESS_TOKEN`
  - `WA_PHONE_NUMBER_ID`
  - `BUSINESS_ID`
- Web app deployment target available (Vercel or equivalent).

## Migrations to Deploy
Run in this order:
1. `20260302113000_launch_billing_and_limits.sql`
2. `20260302121500_landing_hosting_lifecycle.sql`
3. `20260302123000_subscription_line_items.sql`
4. `20260302124500_topup_payment_ids.sql`

## Edge Functions to Deploy
Deploy these updated functions:
- `create-checkout`
- `yoco-webhook`
- `web-chat`
- `wa-webhook`

## Web App Changes to Deploy
Pages/components added/updated include:
- `app/billing/page.tsx`
- `app/operators/page.tsx`
- `app/case-study/cape-kayak/page.tsx`
- `app/compare/manual-vs-disconnected-tools/page.tsx`
- `app/layout.tsx`
- `components/AppShell.tsx`
- `components/AuthGate.tsx`
- `app/new-booking/page.tsx`
- `app/bookings/page.tsx`
- `app/settings/page.tsx`
- `app/page.tsx`

## Deployment Commands

### 1) Verify code quality
```bash
npm ci
npm run lint
npx tsc --noEmit --pretty false --incremental false
```

### 2) Deploy database migrations
```bash
supabase db push
```

### 3) Deploy edge functions
```bash
supabase functions deploy create-checkout
supabase functions deploy yoco-webhook
supabase functions deploy web-chat
supabase functions deploy wa-webhook
```

### 4) Deploy frontend
Use your standard deploy pipeline (example for Vercel):
```bash
npm run build
# then deploy via your CI/Vercel integration
```

## Post-Deploy Verification

### Database checks
Run queries from:
- `docs/launch/metrics-sql.md`

Additionally confirm:
```sql
select id, name, seat_limit, monthly_paid_booking_limit, uncapped_flag from plans order by monthly_price_zar;
```

```sql
select business_id, plan_id, status from subscriptions where status = 'ACTIVE';
```

### Functional checks
1. Billing page loads and shows current plan/usage.
2. Plan switch enforces seat-limit guardrail.
3. Top-up purchase opens Yoco checkout URL.
4. Yoco webhook credits top-up once (retry-safe).
5. Manual PAID booking creation fails at cap with clear message.
6. Payment link generation returns cap-reached message at limit.
7. Landing page order creates one-off line item and recurring hosting line item.
8. Disabling hosting marks recurring hosting line item as cancelled.
9. Public pages are accessible without login:
   - `/operators`
   - `/case-study/cape-kayak`
   - `/compare/manual-vs-disconnected-tools`

## Rollback Plan

### If migration causes failure
- Stop function/frontend deploys.
- Restore database from latest backup/snapshot.
- Re-run previous stable release deploy.

### If function behavior regresses
- Re-deploy previous known-good versions of:
  - `create-checkout`
  - `yoco-webhook`
  - `web-chat`
  - `wa-webhook`

### If frontend behavior regresses
- Roll back web deployment to previous release.
- Keep DB/function changes only if verified safe.

## Launch Gate (Go/No-Go)
Go live only when all are true:
- No migration errors.
- No edge function deploy errors.
- Billing page functional in production.
- Top-up crediting confirmed from real/sandbox payment.
- Cap enforcement and seat enforcement confirmed.
- Public launch pages reachable and indexed-ready.
