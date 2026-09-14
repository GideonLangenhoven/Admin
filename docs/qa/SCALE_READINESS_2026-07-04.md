# 2000-Tenant SaaS Readiness Audit — 2026-07-04

Scope: tenant isolation + scale for the platform at ~2000 tenants. Live project
`ukdsrndqhsatjkmxijuj`. Method: live DB introspection (pg_policies, pg_proc,
grants, advisors, pg_cron) + code read across admin app, booking app, edge
functions. Three parallel sub-audits (cron fan-out, admin app, booking app) plus
direct DB verification of every security claim.

## Verdict

**Not yet 100%, but the acute blockers are now closed.** Tenant isolation at the
DB layer is fundamentally sound (RLS on every public table; hot tables indexed on
`business_id`). Four cross-tenant / money / PII holes were found and **fixed +
verified live this session**. What remains is a scale backlog (cron fan-out,
per-request full scans, unbounded list pages) and one architectural decision
(per-tenant deployment model) — none are cross-tenant leaks, but several will
silently mis-serve tenants beyond ~1000 until fixed.

## FIXED THIS SESSION (4 migrations applied live + committed)

| # | Sev | Issue | Fix (migration) |
|---|-----|-------|-----------------|
| 1 | P0 | `confirm_combo_payment_atomic` executable by `anon` — flips combo child bookings to PAID with no payment check. Anyone with a combo UUID could confirm combos for free. Same class exposed `get_business_credentials`, `set_yoco_test_credentials` (payment secrets) and `deduct_voucher_balance` (voucher griefing). Root cause: Supabase grants EXECUTE to PUBLIC by default. | `20260704120000_revoke_anon_execute_sensitive_rpcs` — REVOKE FROM PUBLIC, GRANT only service_role (deduct keeps authenticated). |
| 2 | P0 | `bookings_anon_insert` had `WITH CHECK (true)`. Anon could INSERT `status='PAID'` for any tenant (trigger only checks monthly quota, not payment) → free confirmed bookings, cross-tenant, burns victim billing quota. | `20260704130000_rls_anon_booking_and_combo_read` — `WITH CHECK (status IN ('DRAFT','PENDING'))`. |
| 3 | P1 | `combo_bookings` had `SELECT ... TO public USING (true)` + anon SELECT grant → any anon client could read every tenant's combo customer PII (name/email/phone) + payment IDs. POPIA breach. | same migration — dropped the public read policy; all real readers are service_role (RLS-exempt). |
| 4 | P1 | `subscriptions` allowed authenticated tenants to UPDATE/INSERT/DELETE their own row. A suspended tenant could `PATCH status='ACTIVE'` via PostgREST, bypassing the S4 suspension gate (also bump seats / zero overage). All billing writes go through service_role `/api/billing/*`. | `20260704140000_subscriptions_no_tenant_self_write` — dropped tenant write policies; kept SELECT. |

Verification: final grants/policies re-queried live; `npm run test:unit` → 141/141.

## ALSO FIXED THIS SESSION (cron fan-out + one resolver — code, type-checked)

The 1000-row silent-truncation class is closed. Added `fetchAllRows()` helper to
`_shared/tenant.ts` (pages past the PostgREST cap) and applied it to every
iterate-all-tenants sweep, plus bounded concurrency where the loop was the
bottleneck:

- `auto-messages` — `getBusinesses()` paginated; the 7-stage per-tenant sweep now
  runs with a concurrency pool of 8 (safe: every send is idempotent via the
  `auto_messages` upsert) + per-tenant try/catch so one tenant can't abort the
  run. This is the every-5-min, all-tenants job — the biggest wall-clock risk.
- `fetch-google-reviews` — businesses paginated.
- `viator-availability-sync`, `getyourguide-availability-sync`, `ota-reconcile`
  — `ota_integrations` (the tenant-count axis) paginated.
- `cron-tasks:autoTagContacts` — businesses **and** per-tenant `marketing_contacts`
  paginated.
- `my-bookings-lookup` resolver — no longer scans all tenants per lookup; runs a
  targeted subdomain/URL query (≤50 candidates) then the same authoritative
  matcher, with a full-scan fallback so there's zero regression risk.

All 7 edited edge files pass `deno check` individually; `npm run test:unit`
still 141/141. Deploy with the other edge functions. Pre-existing unrelated
type error in `web-chat/index.ts:924` (postgrest `.match()` overload) is not
from this work.

## REMAINING BACKLOG (not fixed — needs prioritization / staged commits)

### Scale-correctness still open

- **`cron-tasks:autoTagContacts` N+1×N+1** (`:498`) — the automation/enrollment
  lookups per contact×tag remain; pagination made it *correct* at scale but it's
  still a per-tenant cost multiplier. Batch the automation/enrollment queries.
- ~~`marketing-automation-dispatch:129` double-send~~ — **FIXED**: added an
  optimistic atomic claim (guarded `next_action_at` push-out on `next_action_at <=
  runStart`) before processing each enrollment, so only one concurrent run sends
  a given enrollment's email. Type-checked.
- **`auto-messages` re-engagement (`:350`)** check-then-insert with no unique
  constraint → duplicate WhatsApps if a sweep overlaps the next tick (much less
  likely now with the concurrency fix, but the unique constraint is the real fix).
- **OTA per-mapping slot scans** (`viator/gyg :52`) are still unbounded, but this
  is bounded by one tour's 90-day schedule (not the tenant-count axis), so it's
  independent of the 2000-tenant goal.

### Per-request scale (2000-tenant hot paths)

- **`super-admin/page.tsx:86,1257`** loads all businesses unbounded (sees only
  first 1000) **and** `:98` runs one admin-count query per business inside
  Promise.all (1000 concurrent round-trips per page load → pool exhaustion).
  ~~SUPER_ADMIN page~~ — **FIXED**: `super-admin/page.tsx loadBusinesses()` now
  pages past the 1000 cap and replaces the per-tenant N+1 admin-count with a
  single paged `admin_users` fetch counted client-side. Admin build ✓.
- ~~**WhatsApp resolver**~~ — **FIXED**: added indexed `wa_phone_id_lookup`
  column (migration `20260704160000`); `resolveTenantByWhatsappPayload` now does
  an O(1) indexed lookup first, falling back to a **paged** scan (no 1000-row
  truncation) that lazily backfills the lookup so the platform self-heals to the
  fast path after the first inbound message per tenant. `deno check` ✓.
- ~~**Unbounded admin list pages**~~ — **reports** & **customers FIXED**:
  `reports/page.tsx` now pages the bookings query to completion (ceiling 20k with
  a visible truncation banner) so revenue/CSV totals are complete;
  `customers/page.tsx` pages past the 500 cap so header stats reflect the full
  base. Admin build ✓. Still open: `bookings/page.tsx:303` slot-ID prefetch cap.
- `bookings/page.tsx:303` slot-ID prefetch capped at 1000 (drops bookings on
  excess slots in a wide range) — remaining list-page item.

### Isolation / hardening (lower blast radius, still fix)

- `bookings_anon_update` / `booking_add_ons` anon policies are not tenant-scoped
  (need a known DRAFT/PENDING UUID to exploit; can't reach PAID).
- `combo_bookings` / `combo_booking_items` anon INSERT still `WITH CHECK (true)`.
- `/api/img` SSRF allowlist uses bare-suffix `endsWith` → `evilsupabase.co`
  passes (`booking/app/api/img/route.ts:24`). Use `host===h || host.endsWith("."+h)`.
- 33 SECURITY DEFINER RPCs still anon-executable — the remainder are legit anon
  booking-flow functions (apply/validate_promo_code, create_hold_with_capacity_check,
  sign_waiver, upsert_customer). Re-audit periodically via
  `get_advisors(security)`.

### DB performance at scale

- `auth_rls_initplan` — **26 → 15** (see "RLS performance" section above). The
  hot tenant tables are done; the remaining 15 are low-row-count anon header
  policies (`bt_request_header`/`current_setting`), intentionally left — wrapping
  them is cosmetic (each query is single-tenant-scoped) and carries
  customer-facing RLS risk that outweighs the negligible gain.
- **48 multiple-permissive-policy** warnings — follow-up (consolidate duplicate
  permissive policies per role/action on hot tables).
- 68 unindexed foreign keys (mostly low-traffic); hot tables already indexed.

### Process gap

- `check-security-drift` diffs GRANTS, not policy predicates — so the P0/P1 RLS
  regressions above would have passed it silently. Extend it to diff `pg_policies`
  qual/with_check. (Migration files have already drifted from live RLS; live is
  the source of truth.)

## Architectural decision — RESOLVED + FOUNDATION SHIPPED

Decision (user, 2026-07-04): move to a **shared booking deployment with
server-side per-request tenant resolution** ("fix tenant resolution once, the
right way"). Implemented and building:

- `booking/app/lib/tenant-server.ts` — `getRequestTenant()` resolves the tenant
  from the request Host (indexed subdomain lookup → custom-domain origin →
  `NEXT_PUBLIC_BUSINESS_ID` fallback), React-`cache()`d so metadata + layout
  share one query per request. Single indexed anon query per branch (RLS
  satisfied by the matching `x-tenant-*` header) — no table scan.
- `booking/app/layout.tsx` — `generateMetadata` now resolves per-Host, so every
  tenant subdomain gets correct server-rendered `<title>`/OG from ONE deployment
  (crawlers/scrapers included). Root layout passes the resolved `business_id`
  into `ThemeProvider`.
- `booking/app/components/ThemeProvider.tsx` — takes `initialBusinessId` and
  resolves theme from it first (client env/subdomain chain kept as fallback).
- `npm run build` (booking) → ✓ compiled; all routes now `ƒ (Dynamic)` — correct
  for per-host multi-tenancy. Backward-compatible: existing per-tenant deploys
  keep working via the env fallback.

**Remaining cutover steps (need staging + DNS, not code):** point a wildcard
`*.booking.bookingtours.co.za` (and custom domains) at one deployment; verify
resolution against several real subdomains; then drop `NEXT_PUBLIC_BUSINESS_ID`
from the shared deployment. The WhatsApp resolver still needs a plaintext/hashed
`wa_phone_id` lookup column (schema decision) to become a single indexed lookup.

## RLS performance (initplan) — PARTIALLY DONE

`20260704150000_rls_initplan_wrap_stable_fns` (applied live) rewrote every
`business_id = ANY(current_business_ids())` policy to
`business_id IN (SELECT unnest((select current_business_ids())))` and wrapped
`auth.uid()` as `(select auth.uid())` — evaluated once per query instead of per
row. Isolation verified unchanged (predicates still scope by `business_id`).
Advisor `auth_rls_initplan` dropped 26 → 15; the remaining 15 are anon
header-based policies (`current_setting`/`bt_request_header`, a different
function class) — lower query volume, follow-up.

## What's genuinely solid

Holds/capacity is race-safe (`create_hold_with_capacity_check` FOR UPDATE +
atomic `adjust_slot_capacity` service-role RPC; only residual RMW is an
RPC-error fallback at `wa-webhook:636`). `/my-bookings` OTP flow is strong
(server-side business_id + email scoping, hashed tokens, per-email/per-IP limits,
5-attempt lockout). `getCallerAdmin` is real server-side auth (JWT verify +
admin_users role + suspension + subscription gate) applied uniformly across
privileged API routes. No service_role query was found missing its `business_id`
filter. Anon read surface is locked down (token-gated booking reads, column-
restricted businesses). Payment webhooks verify signatures + use idempotency_keys.
