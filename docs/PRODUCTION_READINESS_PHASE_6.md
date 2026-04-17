# Production-Readiness Review — Phase 6: Verdict

**Review target:** BookingTours platform (4 apps, shared Supabase + Resend + WhatsApp + Vercel + Firebase)
**Date:** 2026-04-17
**Question:** Can you invite 10 operators to use this system next Monday with confidence that it will work 95% of the time?
**Answer:** Not yet. Two days of focused work gets you there.

---

## Reliability estimate — honest

| State | Estimate | Why |
|---|---|---|
| **Today, as-is** | **~60%** | Journey 1 (new operator onboarding) fails 100% — `admin.bookingtours.co.za` returns Vercel 404 (P0-3). Journey 5 (tenant isolation) fails 100% as a latent security exposure (P0-1/2/5). Journeys 2, 3, 4 work for the existing 2 operators at low volume — call those ~85–90% reliable. Weighted across journeys, ~60%. |
| **After 5 P0s fixed** | **~85%** | Doors open, security hole closed. Idempotency, session hygiene, capacity, and deliverability concerns remain. |
| **After 5 P0s + 3 launch-blocking P1s (Supabase Pro, Resend Pro, SPF/DKIM)** | **~95%** | Hits the brief. |
| **After remaining P1s (W1)** | **~97%** | Comfortable launch posture. Idempotency, session, route-guard fixes done. |

The estimate is dragged down today by two trivially-fixable items (P0-3, P0-4 — together: 32 minutes) and one significant item (P0-1/2/5 — together: 1 day).

---

## Top 3 risks for the first month of production

1. **P0-1 — Tenant isolation breach via the public anon key.** Anyone with the browser-visible anon key can read all bookings, customer PII, invoices, and admin password hashes. The admin password hashes are unsalted SHA-256, recoverable in minutes via standard cracking tools. **First-month likelihood: high** — once you onboard 10 operators and announce publicly, the surface is searchable, and Supabase project refs in HAR files are not a secret. Realisation = full platform compromise.

2. **P0-3 — `admin.bookingtours.co.za` is 404.** Every new operator following the welcome-email login link lands on Vercel's "Deployment Not Found" page. **First-month likelihood: 100% per new onboarding.** Currently a P0 because of who-bears-the-cost: the operator self-blames, churns, and your trial-to-paid conversion plummets.

3. **P1-2 — `create-checkout` has no idempotency.** Cold-start or user-retry on the payment button creates duplicate HELD bookings. At 10 operators × 700 bookings/month × 2–5% retry rate, that's roughly **15–35 duplicate bookings per month** that operators have to manually resolve. Erodes operator trust quickly.

The full top-10-by-impact list is in Phase 5. P0-2 (passwords) and P0-5 (storage anon write) are P0 by category but low first-month probability unless someone targets you specifically; the three above are the ones that hurt by accident.

---

## Launch blockers — exact list

These must ship before inviting the 10 operators. Not negotiable.

| ID | Title | Effort |
|---|---|---|
| P0-3 | Rebind `admin.bookingtours.co.za` to `caepweb-admin` Vercel project | 2 min |
| P0-4 | Fix `book.capekayak.co.za` (rebind DNS to Vercel + attach to `booking` project, OR remove hardcoded defaults in admin code) | 30 min |
| P0-5 | Drop `email-images` anon write/update/delete policies; add scoped service-role policies; set 5MB / `image/*` limits | 10 min SQL |
| P0-1 + P0-2 | Drop the 33 permissive RLS policies; route admin reads via `/api/*` server routes with service-role; force-reset all admin passwords; migrate hashing to bcrypt(12) | 1 day |
| P1-1 | Upgrade Supabase Free → Pro (R470/mo) | 30 min |
| P1-6 | Upgrade Resend Free → Pro (R375/mo) | 30 min |
| P1-7 | Verify SPF/DKIM/DMARC for `bookingtours.co.za` via Resend domain verification + mail-tester.com check | 1 h |

Eight items. The cheap five (P0-3, P0-4, P0-5, P1-1, P1-6) total ~80 minutes — knock them out in one sitting. P1-7 is a coffee. P0-1/2 is the day's work.

---

## The 95% path

Do the launch blockers above. In this exact order:

**Day 1, morning (1.5 hours total):**
1. P0-3 — rebind admin domain (2 min). Verify SSL.
2. P0-4 — pick option A (DNS rebind) or option B (code fix). Ship.
3. P0-5 — apply the storage policy SQL.
4. P1-1 — upgrade Supabase to Pro.
5. P1-6 — upgrade Resend to Pro, rotate key into Vercel + Supabase secrets, redeploy.
6. P1-7 — verify Resend domain, run mail-tester.com.
7. P2-18 (bonus, 30 sec) — change `marketing-dispatch` cron to `*/5 * * * *`.

**Day 1, afternoon to Day 2 (1 day):**
8. P0-1 + P0-2 bundle:
   - Migration: `DROP POLICY "Allow all operations to maintain existing functionality"` on the 33 affected tables.
   - Migration: add anon policies for exactly what the customer booking site needs (read-only on `tours`, `slots`, `businesses` selected columns; insert on `bookings` + `holds` via the existing RPC).
   - Code: rewrite admin data fetches that hit `supabase.from(...)` directly to call new `/api/<resource>` Next routes; routes use the service-role key with `business_id` from a signed cookie.
   - Force-reset admin passwords via `sendAdminSetupLink()`. Tell admins via WhatsApp.
   - Switch `sha256()` to `bcrypt.hash(_, 12)` in admin-auth.ts and the onboarding route. Re-hash on next successful login.
   - Apply `CREATE UNIQUE INDEX CONCURRENTLY uq_logs_booking_event ON logs(booking_id, event)` (closes Phase 2 J2-M2 / P2-14 in the same migration).

**Day 2, end-of-day verification (1 hour):**
- Re-run my Journey 5 query (`SET LOCAL ROLE anon; SELECT count(*) FROM bookings;`) and confirm it returns **0**.
- Run `aonyx.booking.bookingtours.co.za` end-to-end: book a R1 test slot, get the email, click the manage-bookings link, see your booking.
- Hit `admin.bookingtours.co.za` — should serve the login page, not 404.

**On Day 3 you can invite 10 operators.**

The W1 P1s (P1-2 idempotency, P1-3 bcrypt complete, P1-4 server-side sessions, P1-5 route guards) get done in the first week as you watch the launch traffic.

---

## Go / no-go

**Today: NOT READY.** Five P0s and three blocking P1s prevent a 95%-target launch.

**After 1.5–2 days of focused work: READY for limited production.** "Limited" meaning:

- 10 operators, opted in for active monitoring of error logs and email deliverability.
- Watch P1-2 carefully in week 1 — if duplicate-booking incidents materialise, ship the idempotency fix immediately.
- Plan the W1 work (server-side sessions, route guards, bcrypt cleanup) for the first sprint.

**After Phase 5's full P0+P1+P2 set (≈11 days): READY for general production** — confident at 30+ operators, audit-defensible, with monitoring and backups in place.

---

## What I did not test (caveats on this verdict)

- No live payment ran end-to-end (no Yoco test-key credentials available).
- No live WhatsApp sends were exercised (no template approvals verified).
- No real Lighthouse / Web Vitals run (tooling not installed).
- No load test (no staging environment).
- No mobile-device testing on actual SA networks.
- No edge-function cold-start timing under realistic burst.

These are honest gaps. None invalidates the P0/P1 findings, but they mean Phase 6's reliability estimate is computed against the journeys I could static-trace and the hot paths I could exercise via MCP. The numbers should narrow once you stand up a staging env and run real load.

---

## One closing observation

The structural quality of this codebase is good. The atomic RPCs (`create_hold_with_capacity_check`, `deduct_voucher_balance`, `apply_promo_code`) are correct. Webhook signatures are verified with constant-time comparison. The multi-tenant model has the right foundation. The 5 P0s are configuration mistakes, not architectural flaws — domain bindings, RLS policy cleanup, storage bucket scoping. None of them require a rewrite. None of them require new infrastructure beyond Pro tier on Supabase and Resend.

You've built a real platform. Two days of cleanup and you can launch it.
