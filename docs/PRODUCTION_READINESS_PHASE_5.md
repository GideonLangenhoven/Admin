# Production-Readiness Review — Phase 5: Failure-Mode Catalogue

**Review target:** BookingTours platform (4 apps)
**Reviewer:** Claude (Opus 4.7)
**Date:** 2026-04-17
**Inputs:** Phases 1–4 findings at `docs/PRODUCTION_READINESS_PHASE_{1,2,3,4}.md`
**Status:** Consolidation only. No new data gathering.

---

## 0. How to read this catalogue

Every finding from Phases 1–4 appears here exactly once. Severity is assigned against the user's 5%-failure-budget definition:

- **P0** = Launch blocker. Either directly produces > 5% broken user experiences at launch scale, or creates a platform-wide risk whose realisation would produce ≫ 5% breakage (e.g. security breach affecting all tenants).
- **P1** = Contributes meaningfully to the failure budget. Fix in the first week post-launch or as part of launch prep.
- **P2** = Real issue, unlikely to cause user-visible failure at initial scale, fix in the first month.
- **P3** = Cleanup / nice-to-have / deferred.

Sort order: **severity descending, then fix effort ascending** — so within a tier, the cheapest wins appear first.

Fix priority column maps to:
- **BLOCK** = must ship before launch
- **W1** = fix in first week post-launch
- **M1** = fix in first month post-launch
- **BACK** = backlog

Each row names the journey(s) it affects (see Phase 2 for the journey definitions: J1 new-operator, J2 customer booking, J3 Cape Kayak specific, J4 operator daily ops, J5 tenant isolation).

---

## 1. P0 — Launch blockers (5)

| ID | Title | Affects | Root cause (brief) | User impact (est.) | Fix | Effort | Priority |
|---|---|---|---|---|---|---|---|
| **P0-3** | `admin.bookingtours.co.za` not bound to any Vercel deployment | J1 | Domain detached from `caepweb-admin` project; Vercel returns `DEPLOYMENT_NOT_FOUND` | **100%** of new operators clicking the welcome-email login link land on 404 | Rebind in Vercel UI, re-verify SSL | 2 min | **BLOCK** |
| **P0-4** | `book.capekayak.co.za` hardcoded in admin code but DNS points at dead AWS IPs | J2 tail, J4 tail | Legacy domain never migrated; two admin code files still use it as the default `manage_bookings_url` / photo-site URL | Every customer email/SMS that includes the default "manage booking" link resolves to a hung connection | Option A: point DNS at Vercel and attach to `booking` project. Option B: delete the hardcoded defaults in `broadcasts/page.tsx:28,51` and `photos/page.tsx:22,146` and require operators to set the URL in settings | 30 min (A) / 1 h (B) | **BLOCK** |
| **P0-5** | `email-images` Supabase Storage bucket grants `anon` INSERT/UPDATE/DELETE | — (infrastructure) | Policies misconfigured: anon write not restricted. No `file_size_limit`, no `allowed_mime_types` | Latent attack: any holder of the public anon key can deface sent marketing emails by replacing referenced images, or exhaust storage quota by uploading multi-GB files | Drop the 3 anon write/update/delete policies, add service-role-only write policies, mirror the correctly-scoped `marketing-assets` pattern, set 5MB/`image/*` restrictions | 10 min SQL | **BLOCK** |
| **P0-1** | 33 `public` schema tables grant `FOR ALL USING (true)` to role `public` (anon + authenticated) | J5, indirectly all | Admin uses custom SHA-256 auth (not Supabase Auth) → arrives at Postgres as `anon` → tenant-scoped `*_tenant_select` policies (that filter by `business_id = ANY (current_business_ids())` for role `authenticated`) evaluate to `false`. To make the admin UI work, team added blanket permissive policies, which also grant anon. | **100% data exposure** — every booking (138 currently), every admin_users row (with password_hash), every invoice (111), every marketing contact, every conversation is readable by anyone who holds the browser-visible anon key | Fast path (1 day): move admin reads through Next.js `/api/*` routes with service-role key; drop the 33 permissive policies; keep anon policies only for the minimum the booking site needs. Correct path (1 week): migrate admin to Supabase Auth, drop all permissive policies. | 1 day fast / 1 week correct | **BLOCK** |
| **P0-2** | Admin `password_hash` (unsalted SHA-256) readable via anon key | — (security) | P0-1 exposes `admin_users` table to anon; unsalted SHA-256 passwords crack trivially on modern GPUs | Any attacker with the anon key can `curl` admin password hashes, crack weak passwords in minutes, log in as super admin | Fixed by P0-1 + force-reset all admin passwords + migrate hashing to bcrypt(12) or Argon2id in the same PR | 1 day (bundled with P0-1) | **BLOCK** |

**Total P0 effort: ~1.5–2 days.** Four of five are fast (under an hour combined). P0-1/2 is the one real chunk of work.

---

## 2. P1 — Contributes to the 5% budget (7)

| ID | Title | Affects | Root cause | User impact | Fix | Effort | Priority |
|---|---|---|---|---|---|---|---|
| **P1-6** | Resend Free tier (3,000 emails/month, 100/day) cannot carry 10-operator volume | J1 welcome, J2 confirmation, J4 marketing | Free tier, projected ~23,500 emails/month at 10-op scale | Silent email drops once daily/monthly cap hit → no confirmations, no reminders, no receipts | Upgrade Resend → Pro ($20/mo, 50K/mo) | 30 min | **BLOCK** |
| **P1-7** | SPF/DKIM/DMARC on `bookingtours.co.za` unverified | J1, J2, J4 | Domain set-up status unknown; resend.com requires DNS records to avoid spam classification | Potentially 30–80% of confirmation/reminder emails land in spam folders on gmail/outlook — bookings feel "lost" to customers | Run mail-tester.com and Resend's domain verification; add DNS TXT records | 1 hour | **BLOCK** |
| **P1-1** | Supabase Free project auto-pauses after 7 days inactivity | all | Free-tier policy; cron presumably prevents pause by firing every minute, but any pg_cron disable = 7-day clock starts + no backups | On pause, every edge function, webhook, cron, and edge-function read fails. No recovery to point-in-time if anything goes wrong. | Upgrade Supabase → Pro ($25/mo) | 30 min | **BLOCK** |
| **P1-2** | `create-checkout` has no idempotency key — cold start + user retry = duplicate booking | J2 | Client calls `functions.invoke("create-checkout", …)` once, no retry token, no server-side dedupe | ~1–5% of checkouts under normal cold-start conditions; higher if Yoco is slow. Customer sees duplicate HELD bookings and is confused / double-charged on second payment | Add `x-idempotency-key = hash(slot_id, email, total)`; store in existing `idempotency_keys` table; short-circuit on repeat | 2–4 h | **W1** |
| **P1-5** | Route-level access control in admin is nav-only; any operator can type `/settings` or `/super-admin` into URL | J4 | AppShell hides nav items by role; page components don't re-check; edge functions don't always re-check either | Non-privileged operator can trigger privileged actions. Internal threat, not external. At 2 operators today it's zero risk; at 10+ with staff roles it becomes real | Add a server-side route guard (Next middleware or per-page session check) for `/settings`, `/super-admin`, `/billing` | 4–6 h | **W1** |
| **P1-4** | No server-side session invalidation on admin logout | J4 | Session state lives only in localStorage; `clearSession()` deletes locally but any previously-grabbed `ck_admin_*` token is valid for 12h | If attacker grabs tokens via XSS, operator can't revoke; full 12h access window | Add `admin_sessions (token_hash, expires_at, revoked_at)` table; validate on every admin request; revoke on logout | 1 day | **W1** |
| **P1-3** | Admin password hashing is unsalted SHA-256 (no salt, no work factor) | J4 | Custom auth implementation chose SHA-256 instead of bcrypt/Argon2 | Combined with P0-1/2 exposure: password recovery is trivial once hashes are leaked. Standalone (after P0-1 fixed): still weak — DB admin dump = password recovery | Switch to bcrypt (cost ≥12). Migrate by forcing next-login reset for all users OR re-hash on next successful login | 1 day (including forced-reset comms) | **W1** |

**Total P1 effort: ~3 days.** P1-6, P1-7, P1-1 are all short and belong before launch; P1-2 through P1-5 can slip to first week post-launch if monitored.

---

## 3. P2 — Fix in first month (23)

Sorted within tier by fix effort ascending.

| ID | Title | Affects | Root cause | Impact | Fix | Effort | Priority |
|---|---|---|---|---|---|---|---|
| **P2-18** | `marketing-dispatch` cron fires every 1 min (43.2K invocations/mo); 5-min sufficient | — (infra) | Overly aggressive cron | Burns edge-fn quota + Supabase usage unnecessarily | Change pg_cron schedule to `*/5 * * * *` | 30 s | **M1** |
| **P2-8** | SUPER_ADMIN "switch operator" doesn't hard-refresh data; stale tenant data can stay on screen | J4 | React components with `useEffect(…, [businessId])` re-fetch; others don't; there's no forced reload | Super admin briefly sees previous tenant's data — confusing at best, mis-acts at worst | `router.refresh()` or `window.location.reload()` on switch | 30 min | **M1** |
| **P2-11** | 2 Supabase public storage buckets allow listing | — (info leak) | Both `email-images` and `marketing-assets` are public | Bucket enumeration; no data exfil beyond what's intentionally public | Review and decide whether listing is needed; if not, mark buckets non-public but keep per-object public via signed URLs | 30 min | **M1** |
| **P2-17** | `booking.bookingtours.co.za` root returns `DEPLOYMENT_NOT_FOUND` (wildcard subdomains OK) | — | Root domain never attached | Benign unless someone hits the bare root. Cleanup only | Attach root to `booking` project OR redirect root to `bookingtours.co.za` landing | 2 min | **M1** |
| **P2-12** | Hostname-mismatch tenant fallback picks "first business in table" | J2 | `booking/components/ThemeProvider.tsx:130` falls back on mismatch | Unlikely but real: DNS misconfig on a new operator routes to wrong tenant | Change fallback to show a 404 instead of silent wrong-tenant render | 30 min | **M1** |
| **P2-3** | Onboarding welcome-email Resend failure is non-blocking | J1 | `onboarding/route.ts:815–821` logs and returns `welcomeEmailSent: false` | Operator hits success page but never gets the "how to log in" email | Either block the wizard on email failure, or make the wizard UI show a "resend email" button when `welcomeEmailSent: false` | 1 h | **M1** |
| **P2-5** | Webhook idempotency race — `logs(booking_id, event)` has no unique index | J2 | `confirm-booking` uses SELECT-then-INSERT on `logs` table; race window exists | Rare duplicate confirmation email/WhatsApp on concurrent webhook + `/success` fallback | `CREATE UNIQUE INDEX CONCURRENTLY` on `logs (booking_id, event) WHERE event = 'booking_confirmation_notifications_sent'` | 15 min | **M1** |
| **P2-2** | Onboarding duplicate-name race (check-then-insert) | J1 | In-memory rate-limit + non-atomic check → concurrent wizard submissions with same name could both pass | Low-probability duplicate tenant; manual cleanup if it occurs | Unique index `CREATE UNIQUE INDEX ON businesses (lower(business_name))` OR pre-insert advisory lock | 1 h | **M1** |
| **P2-4** | Total-0 voucher path marks booking PAID before deducting vouchers | J2 | Non-transactional sequence in `book/page.tsx:268` | Voucher deduction failure leaves booking PAID with voucher value not consumed (small revenue leak) | Reorder: deduct vouchers first; then mark PAID | 1 h | **M1** |
| **P2-6** | Refund idempotency partial — concurrent clicks can both refund | J4 | `process-refund` recalculates `refundableAmount` from DB; concurrent clicks both see pre-refund state | Very rare but possible double-refund | Add a short-lived advisory lock on `bookings(id)` or a unique constraint on `refund_requests(booking_id, window)` | 2 h | **M1** |
| **P2-19** | Inbox Realtime channel uses `Date.now()` in name — potential leak | J4 | Channel name is `inbox-chat-{Date.now()}`; if cleanup is imperfect, each re-mount opens a new channel without closing the old one | At 10-op scale, could push Realtime channel count over Free cap (200) | Use a stable channel name; verify cleanup in useEffect; subscribe once | 1 h | **M1** |
| **P2-20** | `email-images` bucket egress uncached | — (cost) | No CDN cache headers on objects | Every email open repulls bytes → Free 5GB/month tight at 10-op scale | Add `cache-control: public, max-age=86400, immutable` on bucket policy or upload | 15 min | **M1** |
| **P2-7** | Client-side login lockout (5 failed attempts → 30-min lock) bypassable | J4 | Lockout counter in localStorage; `localStorage.clear()` resets | Brute-force possible for determined attacker | Move to server-side: `admin_users.locked_until` column, check on login | 2 h | **M1** |
| **P2-22** | Bulk marketing runs take hours to drain at 5-min cadence + 50-batch size | J4 | 10,000 emails ÷ 50 = 200 batches × 5 min = ~16h | Delayed campaign delivery | Optional: queue-depth-aware dispatch (fire more often when depth > threshold) | 4 h | **M1** |
| **P2-15** | Supabase region eu-west-3 (Paris) → 150–220 ms RTT from Cape Town customers | — (latency) | Region choice; Supabase has no Cape Town region | Noticeable but not breaking; dashboards 300–500 ms slower | Accept, or route booking-site reads through Vercel Function in `cpt1` / `fra1` | 0 / 1 day | **M1** |
| **P2-16** | Onboarding rate-limit is in-memory per Vercel instance | J1 | Fluid Compute instance memory is per-request-pool, not shared | Distributed attacker bypasses "3 attempts per IP per hour" trivially | Move counter to Supabase table keyed on `(ip, date_trunc('hour', now()))` | 2 h | **M1** |
| **P2-21** | 20 simultaneous `confirm-booking` can exceed Resend 10 req/s | J2 under burst | Admin.confirm-booking → send-email runs synchronously | Resend queues or rejects; confirmations delayed | Route sends through outbox queue (already exists); move confirm-booking to enqueue not send | 1 day | **M1** |
| **P2-23** | WhatsApp Business Verification not confirmed — Tier 1 = 250 conversations/day cap | J2, J4 | Meta Business Manager step required for Tier 2+ | At 50+ operators, daily cap hit | Submit business verification in Meta Business Manager | 1 day (passive waiting) | **M1** |
| **P2-9** | Audit-log timeline TODO on `/bookings/[id]` | J4 | Explicit TODO at `app/bookings/[id]/page.tsx:~149` | Compliance / dispute defensibility low — no "who did what when" trail | Merge audit_logs into timeline | 1 day | **M1** |
| **P2-1** | Onboarding provisioning not transactional (7 separate table writes) | J1 | `failWithCleanup()` is best-effort but non-atomic | Half-provisioned tenant (business + admin but no policies) can survive a failure | Wrap in a Supabase RPC or use a transaction wrapper | 4 h | **M1** |
| **P2-13** | Missing `(business_id)`, `(business_id, status)`, `(business_id, created_at DESC)` indexes on `bookings` | J4 | Schema started small, indexes not yet added | At 138 bookings: fine. At 10K+: admin list slow (seq scan) | `CREATE INDEX CONCURRENTLY` × 3 | 30 min | **M1** |
| **P2-14** | Missing unique index on `logs(booking_id, event)` | J2 | Schema gap | Enables the P2-5 race; cheap to fix | `CREATE UNIQUE INDEX CONCURRENTLY` | 15 min | **M1** |
| **P2-10** | 46 `function_search_path_mutable` Supabase advisor warnings | — | SQL functions defined without `SET search_path = public`; shadowing risk if an attacker can create a table | Low-probability SQL injection vector in the presence of P0-1 fallback policies | `ALTER FUNCTION ... SET search_path = public, pg_temp` for each | 1 day | **M1** |

**Total P2 effort: ~5–6 days** if you do all 23. You can pick the half-dozen cheapest ones for the first week and defer the rest.

---

## 4. P3 — Cleanup / backlog (5)

| ID | Title | Affects | Fix | Effort |
|---|---|---|---|---|
| **P3-1** | 35 dead `page 2.tsx` / `page 3.tsx` files in `~/Desktop/booking/app/` | — | `find … -name '* 2.tsx' -delete` after confirming nothing imports | 15 min |
| **P3-2** | Realtime auto-reconnect has no missed-event backfill | J4 | On reconnect, re-fetch initial state | 4 h |
| **P3-3** | No RUM agent (no Vercel Speed Insights, no GA4, no Sentry) | — | Install Vercel Speed Insights on all 3 Vercel projects | 1 h |
| **P3-4** | Lighthouse + Playwright tooling not set up for automated perf checks | — | `npm i -D lighthouse playwright` + GitHub Actions workflow | 2 h |
| **P3-5** | `email-images` bucket has no file-size/mime-type limit (bundled with P0-5) | — | Set `file_size_limit = 5242880`, `allowed_mime_types = image/*` | 5 min |

---

## 5. Summary

| Tier | Count | Total effort |
|---|---|---|
| P0 (BLOCK) | 5 | ~1.5–2 days |
| P1 (BLOCK / W1) | 7 | ~3 days |
| P2 (M1) | 23 | ~5–6 days |
| P3 (BACK) | 5 | ~1 day |
| **Total** | **40** | **~11 days** |

Of the 40 issues, 3 are literally **2-minute fixes** (P0-3, P2-17, P2-18) and 8 more are under an hour each. Fifteen of the forty can be completed in the first afternoon.

---

## 6. Minimum viable launch set

If you insist on the fastest path to "safe enough for 10 monitored operators," here's the exact set you must ship first:

1. **P0-3** (rebind admin domain) — 2 min
2. **P0-5** (storage bucket fix) — 10 min SQL
3. **P0-4** (book.capekayak hardcode) — 30 min
4. **P2-18** (drop marketing-dispatch cron to 5 min) — 30 s SQL
5. **P1-6** (upgrade Resend to Pro) — 30 min
6. **P1-1** (upgrade Supabase to Pro) — 30 min
7. **P1-7** (SPF/DKIM/DMARC verification) — 1 h
8. **P0-1 + P0-2** (drop permissive policies, add scoped anon policies, migrate admin reads to `/api/*`, force-reset admin passwords, migrate hashing to bcrypt) — 1 day bundled

Total minimum launch effort: **1.5–2 days** (6 hours of config + 1 day of focused code/SQL).

Everything else is first-week-post-launch or first-month polish. The verdict in Phase 6 is built on this launch-set.
