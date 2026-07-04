# Deploy Runbook — 2026-07-04 scale/security release

All DB migrations are **already applied live** to project `ukdsrndqhsatjkmxijuj`
(via `apply_migration`). What remains is deploying the edge-function + app code
and the shared-deployment DNS cutover. Do it in this order; each step is
independently safe (the code is backward-compatible with the already-live DB).

## 0. Commit first
```bash
git checkout -b scale-security-2026-07-04
git add supabase/migrations/20260704*.sql \
        supabase/functions/_shared/tenant.ts \
        supabase/functions/{auto-messages,cron-tasks,fetch-google-reviews,getyourguide-availability-sync,ota-reconcile,viator-availability-sync,my-bookings-lookup,marketing-automation-dispatch}/index.ts \
        app/{reports,customers,super-admin}/page.tsx \
        booking/app/{layout.tsx,lib/tenant-server.ts,components/ThemeProvider.tsx,api/img/route.ts} \
        docs/qa/SCALE_READINESS_2026-07-04.md docs/qa/DEPLOY_RUNBOOK_2026-07-04.md
git commit   # message summarizing the security + scale pass
```

## 1. Edge functions (Supabase) — CLI already linked
Deploy the 8 changed functions + their shared dep. `_shared/tenant.ts` ships with
each importer automatically.
```bash
supabase functions deploy auto-messages fetch-google-reviews \
  getyourguide-availability-sync ota-reconcile viator-availability-sync \
  cron-tasks marketing-automation-dispatch my-bookings-lookup wa-webhook web-chat \
  --project-ref ukdsrndqhsatjkmxijuj
```
(`wa-webhook`/`web-chat` import the changed `_shared/tenant.ts`, so redeploy them
too even though their own source is unchanged.)

**Smoke test after deploy:**
- Send one inbound WhatsApp to a test tenant → bot replies (resolver fast-path +
  lazy backfill). Confirm `select id from businesses where wa_phone_id_lookup is
  not null` grows after messages arrive.
- Trigger `auto-messages` once (`curl` the function) → returns `{ok:true}`, no
  timeout.
- Watch `marketing-automation-dispatch` for one cycle → no duplicate sends.

## 2. Apps (Vercel) — PREVIEW first, then promote
```bash
# Admin app (root)
vercel deploy                 # preview URL — smoke-test /reports, /customers, /super-admin
vercel deploy --prod          # promote once verified

# Booking app
cd booking && vercel deploy   # preview — smoke-test a tenant booking flow end to end
vercel deploy --prod
```

## 3. Tenant-resolution cutover (the shared-deployment switch) — do LAST
The booking code now resolves the tenant server-side from the request Host and is
backward-compatible with per-tenant `NEXT_PUBLIC_BUSINESS_ID` deploys, so nothing
breaks before you flip this.

1. In the shared booking Vercel project, add domains: `*.booking.bookingtours.co.za`
   (wildcard) and any per-tenant custom domains.
2. DNS: point the wildcard `*.booking.bookingtours.co.za` CNAME at the Vercel
   deployment (`cname.vercel-dns.com`). Same for custom domains.
3. Smoke-test 3–4 real tenant subdomains: correct theme, correct `<title>`/OG
   (view source — server-rendered per host), booking flow completes.
4. Once verified, **remove `NEXT_PUBLIC_BUSINESS_ID`** from the shared
   deployment's env so host-based resolution is the sole path, and redeploy.
5. Retire the per-tenant deployments.

## 4. Post-deploy verification
- `npm run check-security-drift` (needs `DATABASE_URL`) → exit 0.
- Re-run `get_advisors(security)` → confirm no new `rls_policy_always_true` /
  `anon_security_definer_function_executable` regressions on the tightened RPCs.
- Orphan-holds check stays 0: `select count(*) from holds where expires_at <
  now() - interval '1 hour' and status='ACTIVE';`

## Rollback
- Edge functions: `supabase functions deploy <fn>` from the previous git ref.
- Apps: Vercel → Deployments → promote the prior production deployment.
- DB migrations are additive/safe (grant revokes, RLS tightening, one additive
  column); if ever needed, re-GRANT or restore a policy from the prior migration
  text in git. The `wa_phone_id_lookup` column is inert if the new edge code is
  rolled back (old code ignores it).
```
