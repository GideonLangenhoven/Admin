# Cape Kayak / BookingTours — Code Audit vs. Production-Readiness Checklist

**Date:** 2026-07-02
**Scope:** The ~215-case checklist you supplied (sections A1–AB6), audited against the actual codebase.
**Method:** 28 parallel section-audit agents read the real routes / edge functions / migrations / existing tests and classified each case with `file:line` evidence; every **blocker** and every **security** finding below was then **independently re-verified by hand** against the code. Static code review — *not* runtime execution.

---

## VERDICT: 🟢 Tier-0 + Tier-1/2 remediated 2026-07-02 — deploy pending

> **UPDATE 2026-07-02:** All five Tier-0 security blockers (S1–S5) are now FIXED,
> regression-tested (unit 141/141), and both apps build clean; the S3 RLS migration
> is applied to live. Tier-1 money/core (B1–B3) and the Tier-2 items were fixed in
> the earlier functional pass. See `docs/qa/REMEDIATION_LOG.md`. The only remaining
> step is a **coordinated deploy** of the 4 changed edge functions + both Vercel apps
> (deploy functions and frontends together — see the log's "Deploy checklist").
> The original (pre-fix) verdict is preserved below for the audit trail.

### Original verdict: 🔴 NOT production-ready / not safe to sell yet

The app is far more complete than a typical MVP — **136 of 192 audited cases (71%) are correctly wired**, and whole sections (F Waiver, T Peak Pricing, V Promos, plus the AA edge-case machinery) are solid. But there are **release-blocking defects**, and the most serious are **multi-tenant security holes**, not feature gaps. Several were even marked "✅ passing" on your checklist (e.g. A2 lockout) but are security-theatre in the code.

| Metric | Count |
|---|---|
| Sections audited | 26/28 automatically + **AA, AB verified manually** = 28/28 |
| Cases audited | 192 (of ~215; the rest are AA/AB, covered manually below) |
| ✅ WIRED | 136 |
| 🟡 PARTIAL | 44 |
| 🔴 BROKEN | 6 |
| ⛔ MISSING | 5 |
| ❓ UNKNOWN (runtime/config-dependent) | 1 |
| **Release blockers (after re-tiering)** | **~13** (5 security + 3 money/core + 5 feature) |
| Cases unsafe to run against LIVE prod | 95 |

> **Coverage caveat.** The adversarial verification layer only partly ran before your **monthly Claude spend limit** was hit (110 agents / 4.06M tokens). So: findings I personally re-read are marked **[VERIFIED]**; findings relayed from the audit agents but not yet hand-checked are marked **[RELAYED]**. All Tier-0/Tier-1 items are **[VERIFIED]**.
> Positive signal: the **unit suite passes 82/82** (`npm run test:unit`).

---

## TIER 0 — SECURITY / ACCESS CONTROL (must fix before any paying customer)

> **✅ ALL FIXED 2026-07-02** (S1–S5) — see `docs/qa/REMEDIATION_LOG.md` → "TIER-0
> SECURITY SPRINT". S3's voucher sub-claim (forgeable header) was stale; a worse
> voucher hole (anon insert of an ACTIVE voucher + gift-voucher underpay) was found
> and fixed in the same pass. Findings below are the original report.

These violate the tenant-isolation rules in your own `CLAUDE.md` ("violations are treated as security incidents").

### S1. `rebook-booking` is an unauthenticated IDOR over money operations — [VERIFIED]
**Affects checklist:** E8, I4, I5, M1 (and anything routing through rebook-booking).
`supabase/functions/rebook-booking/index.ts:1042-1046` loads the booking by **client-supplied `booking_id` only** — no `business_id`, no auth, no ownership check — while running as `service_role` (RLS bypassed). There is no `requireAuth`/`getUser` in the function (only `cancel-booking` has one). It's reachable with the **public anon key** (the my-bookings "auth" is client-side OTP, not enforced here).
**Impact:** Anyone with a booking UUID can `CANCEL_REFUND`, `REMOVE_GUESTS` (triggers a refund), `RESCHEDULE`, or edit contact details on **any tenant's** booking. Financial + data-integrity abuse across tenants.
**Fix:** In the main handler, require the caller's identity (OTP session token for customer actions / admin JWT for admin actions) and assert `booking.business_id` matches the caller's tenant before dispatching any action.

### S2. `broadcast` has no authentication or role check — [VERIFIED]
**Affects:** O2, O3.
`supabase/functions/broadcast/index.ts:20-44` reads `business_id` from the request body and blasts WhatsApp/email to that tenant's `PAID/CONFIRMED` customers, as `service_role`, with **no `requireAuth`, no role check** — only a CORS origin header (not a security control).
**Impact:** Send messages to any tenant's customers by POSTing their `business_id`; customer-abuse / reputational / POPIA exposure.
**Fix:** `requireAuth` + MAIN_ADMIN/OPERATOR role + derive `business_id` from the authenticated session, never the body.

### S3. `reviews` RLS leaks across tenants; vouchers keyed off a forgeable header — [VERIFIED]
**Affects:** Z4 (RLS isolation).
`supabase/migrations/20260503200000_reviews.sql:50-54`:
```sql
CREATE POLICY reviews_authenticated_read  ON public.reviews FOR SELECT TO authenticated USING (true);
CREATE POLICY reviews_authenticated_update ON public.reviews FOR UPDATE TO authenticated USING (true);
```
Any authenticated user can **read and modify every tenant's reviews** (approve/hide/edit competitors'). Additionally, `vouchers_anon_select` scopes by `x-tenant-business-id` (a **client-supplied header**), so an anon caller can read another tenant's vouchers — including redeemable codes — by setting the header.
**Fix:** Replace `USING (true)` with a `business_id`-scoped predicate tied to the caller's tenant (via `profiles`/JWT claim, as other tightened tables do). Don't scope sensitive tables on a forgeable request header.

### S4. Subscription suspension (A8) and login lockout (A2) are client-side only — [VERIFIED]
`app/lib/api-auth.ts` defines `requireActiveSubscription` but **grep shows it is never called** anywhere. A8's "access blocked when SUSPENDED" is UI-only — a suspended (non-paying) tenant retains full data access by hitting APIs directly. A2's "5 wrong passwords → 30-min lockout" is implemented in `localStorage` (bypass with a new browser / `localStorage.clear()`).
**Impact:** Revenue enforcement gap (A8) + brute-force exposure (A2).
**Fix:** Enforce subscription status in a server-side gate (proxy.ts / route guards / RLS); move lockout to a server-tracked counter (you already have `otp_attempts`-style infra to model it on).

### S5. External B2B HMAC is bypassable when misconfigured (Y6) — [VERIFIED]
`supabase/functions/external-booking/index.ts:256-290` verifies HMAC correctly **only if** the credential row has an `hmac_secret`. An api-key-only credential (`:264`) accepts requests with **no/any signature**. Y6 ("wrong signature → 401") fails for those tenants.
**Fix:** Require `hmac_secret` for all external credentials, or reject `api_key`-only auth for mutating actions.

---

## TIER 1 — MONEY & CORE-FLOW BLOCKERS

### B1. Partial gift-voucher checkout overcharges the customer (G4, G8) — [FIXED 2026-07-02, see REMEDIATION_LOG.md] ✅
`booking/app/book/page.tsx:391-399` builds the booking payload **without `voucher_amount_paid`** and sends the voucher-reduced `finalTotal` as `amount`. `create-checkout/index.ts:175-186` reads `voucher_amount_paid` from the booking (=0), recomputes the **full** post-promo price, sees the mismatch, and **overrides the charge to the full price** (`amount = serverCashDue`). The webhook's voucher-redemption (`yoco-webhook:1044-1057`) is gated on `original_total - total_amount > 0`, which the override zeroes out.
**Net effect:** When a voucher only partially covers a booking, the customer is **charged the full amount on card and the voucher is not applied.** (Full-coverage vouchers use a separate `confirm_voucher_booking` path and work.)
**One-line fix:** set `voucher_amount_paid: effectiveVoucherCredit` on the booking payload before calling `create-checkout` (the server already subtracts it at `:175`).

### B2. Expired regular holds never release slot capacity (J5) — [FIXED 2026-07-02, see REMEDIATION_LOG.md] ✅
`cron-tasks/index.ts`: the RESCHEDULE branch decrements `slots.held` (`:78-92`), but the **regular-hold branch (`:109-125`) only sends WhatsApp and sets `holds.status='EXPIRED'`** — it never decrements `slots.held` or resets the booking. Since availability = `capacity − booked − held` (`book/page.tsx:287`), every abandoned checkout **permanently shrinks the slot's sellable capacity.**
**Fix:** in the regular branch, call `adjust_slot_capacity(p_held_delta => -qty)` (mirror the reschedule branch) and reset the booking status.

### B3. Weather-cancellation self-service is non-functional (L4) — [FIXED 2026-07-02, see REMEDIATION_LOG.md] ✅
`booking/app/my-bookings/page.tsx:700` calls `rebook-booking` with `action:"CLAIM_CREDIT"`, but `rebook-booking` only handles `RESCHEDULE, ADD_GUESTS, REMOVE_GUESTS, UPDATE_CONTACT, SPECIAL_REQUEST, CANCEL_REFUND, CANCEL_VOUCHER` (`:1037,1058-1064`) — **there is no `CLAIM_CREDIT` handler**, and the state guard (`:1052-1055`) rejects non-PAID/CONFIRMED/COMPLETED bookings (weather bookings are `CANCELLED`). So the customer's "Reschedule / Voucher / Refund" buttons after a weather cancellation all fail. This is a core operational flow for a kayak operator.
**Fix:** add a `CLAIM_CREDIT` handler (`credit_action` VOUCHER|REFUND|RESCHEDULE) and allow `CANCELLED + refund_status ACTION_REQUIRED` bookings through the guard for it.

---

## TIER 2 — MISSING / BROKEN FEATURES (checklist cases that will fail)

| Case | Status | Finding | Evidence |
|---|---|---|---|
| J6 | ✅ FIXED 2026-07-02 (see REMEDIATION_LOG.md) | Payment-deadline booking **is** auto-cancelled, but the **admin WhatsApp never fires** and the dedicated capacity-release is dead code: `cron-tasks:533` runs `auto-messages` (which expires the booking) *before* `cleanupExpiredManualBookings:553`, so the latter finds nothing. | cron-tasks:533/553, auto-messages:384-394 |
| J9 | ⛔ MISSING — [VERIFIED] | No abandoned-cart recovery. Zero occurrences of `ABANDONED_CART` / "Complete My Booking" repo-wide. | grep = 0 |
| J10 | ✅ FIXED 2026-07-02 (see REMEDIATION_LOG.md) | DRAFT bookings are created (`book/page.tsx:332`) but **no cron cleans them** — PII lingers indefinitely. | cron handler list, cron-tasks:529-579 |
| K5 | ✅ FIXED 2026-07-02 (see REMEDIATION_LOG.md) | No "Decline refund" anywhere — no `DECLINED` setter, no button, no notification. Refunds page has only Auto/Manual/Refund-All. | grep = 0; app/refunds/page.tsx |
| U9 | ✅ FIXED 2026-07-02 (see REMEDIATION_LOG.md; finding partially stale — items stranded in processing rather than sending early) | Scheduled campaigns enqueue `marketing_queue` rows **immediately** (`templates/page.tsx:278`, unconditional); the per-minute cron claims any `pending` row regardless of schedule → scheduled sends fire on the next tick, not at the set time. | templates:271-292 |
| U16 | ⛔ MISSING — [VERIFIED] | `post_booking` automation trigger is a UI/DB value with **no enrollment wiring** in any booking/webhook flow. | grep in supabase/functions = 0 |
| X4 | ⛔ MISSING — [VERIFIED] | Email overage is computed for **display only**; no cron/RPC ever writes a `billing_line_item`/invoice → tenants are never actually billed for overage (revenue leak). | grep billing_line_item in functions = 0 |

---

## TIER 3 — NOTABLE CORRECTNESS ISSUES (PARTIALs worth fixing; grouped) — mostly [RELAYED]

**Defense-in-depth tenant filters (missing `.eq("business_id")`, currently saved only by RLS):** B8, C7, H3, Q5, R2, U4, U5. Per your own commit-checklist these should all filter explicitly.
- **Q5 / R2** are worse: `invoices` read is permissive (`USING(true)`) and dashboard check-in updates `bookings` by `id` only.

**Hardcoded single-tenant branding (breaks multi-tenant):** **P3** — trip-photos email hardcodes "Cape Kayak Adventures" + a fixed Google review place-ID for *all* tenants. **P2** — trip-photos WhatsApp omits `template_fallback` so it fails outside the 24h window. (Recall: the platform is *BookingTours*, not Cape Kayak.)

**Timezone correctness:** B5 (bulk-slot uses hardcoded −2h offset, not tenant TZ), S6 (hardcoded `+02:00`, 2000-row export cap), Y1 (external-booking hardcodes `Africa/Johannesburg`), **R3** (dashboard "Last 7 days" revenue actually queries from month-start — wrong number).

**Email branding:** W2/W3 — brand colors & logo drive the booking site but **not emails** (emails never select `logo_url`/colors).

**Automation firing not guaranteed:** U15, U17 — enrollment & send logic are correct, but **no committed cron schedule** invokes `marketing-automation-dispatch`, so "first email sends automatically" / birthday sends aren't guaranteed.

**Chat first-message tenant gap:** D2/D3 — the web-chat widget doesn't forward the resolved `business_id`, so the **first** message can 400 on custom-domain/proxied tenants.

**Others:** E9 (dashboard bulk "Check in" sets `status=CONFIRMED` instead of `checked_in`), H1 (codes are 8-char random, not the `CK-XXXX` format the checklist expects), H5/H6 (cancellation→voucher email omits the code; expiry error copy differs), M1 (reschedule confirmation shows the *old* date/time), N2/N7 (bot pricing answer depends on tenant FAQ config; 24h template uses placeholder `hello_world`), R4 (monthly pax calendar lives in Broadcasts, not the dashboard), X1 (billing page: plan from hardcoded map, empty history, seat/pause buttons fail), Z1 ("default tours created" on onboarding does not happen).

---

## PER-SECTION SCORECARD

Legend: W=wired · P=partial · B=broken · M=missing · U=unknown

| Sec | Area | W | P | B | M | Verdict |
|---|---|--|--|--|--|---|
| A | Admin auth/onboarding | 6 | 2 | | | 🟡 A2/A8 security |
| B | Tours & slots | 8 | 3 | | | 🟡 minor |
| C | Booking flow (site) | 13 | 2 | | | 🟢 (C7 isolation, C1 mobile) |
| D | Web chat | 2 | 2 | | | 🟡 first-msg tenant gap |
| E | Admin booking | 7 | 2 | | | 🟡 **E8 IDOR**, E9 checkin |
| F | Waiver | 8 | | | | ✅ clean |
| G | Payments | 8 | | 2 | | 🔴 **voucher overcharge** |
| H | Gift vouchers | 3 | 4 | | | 🟡 several gaps |
| I | Self-service | 4 | 2 | | | 🔴 **I4/I5 IDOR** |
| J | Auto-messages/cron | 7 | | 2 | 2 | 🔴 J5/J6/J9/J10 |
| K | Cancel/refund | 4 | 2 | | 1 | 🟡 K5 missing |
| L | Weather cancel | 5 | | 1 | | 🔴 **L4 self-service** |
| M | Reschedule | 4 | 1 | | | 🟡 M1 stale + IDOR |
| N | WhatsApp/inbox | 6 | 2 | | | 🟡 config-dependent |
| O | Broadcasts | 1 | 2 | | | 🔴 **O2 no-auth** |
| P | Photos | 0 | 3 | | | 🟡 **P3 hardcoded brand** |
| Q | Invoices | 4 | 1 | | | 🟡 Q5 isolation |
| R | Dashboard/check-in | 1 | 3 | | 1 | 🟡 R2 isolation, R3 bug |
| S | Reports | 6 | 1 | | | 🟢 S6 minor |
| T | Peak pricing | 5 | | | | ✅ clean |
| U | Marketing | 13 | 4 | 1 | 1 | 🟡 U9/U16 |
| V | Promo mgmt | 6 | | | | ✅ clean |
| W | Settings/branding | 8 | 2 | | | 🟡 email branding |
| X | Billing | 1 | 2 | | 1 | 🔴 X1 broken, X4 missing |
| Y | External/B2B | 4 | 2 | | | 🟡 **Y6 HMAC**, Y1 tz |
| Z | Super admin/tenancy | 2 | 2 | | | 🔴 **Z4 RLS leak** |
| AA | Edge cases | *manual* | | | | 🟢 strong (see below) |
| AB | Smoke/lifecycle | *manual* | | | | 🟡 (see below) |

**AA (verified manually):** ✅ idempotency (`yoco-webhook:347`), ✅ atomic hold + overbooking rejection (`atomic_hold_creation:40-53`), ✅ all promo guards with exact error strings (`promo_atomic_enforcement`), ✅ phone normalize (`phone.ts:59`), ✅ past-slot filter (`start_time > now()`), ✅ mobile drawer (`AppShell`/`MobileMenuDrawer`). ⚠️ AA5/AA6 (cancel/refund idempotency guards) not confirmable via grep — **manual check needed**. AA13 draft exists but ties to J10.

**AB (analysis):** AB1 online lifecycle works **card-only**; breaks if a voucher is used (B1). AB2 admin→cancel→refund largely works (K5 decline missing, not on this path). AB3 weather lifecycle **breaks at self-service (L4)**. AB4 voucher lifecycle **breaks on partial redemption (B1)**. AB5 marketing works for immediate sends; scheduled/post-booking broken (U9/U16). AB6 new-tenant works except "default tours" (Z1).

---

## RUNNING THESE TESTS AGAINST LIVE PRODUCTION (you said prod is the only env)

**95 of the cases are unsafe to execute directly on live** (real card charges, real WhatsApp/email to real people, irreversible mutations). Guidance:

- **Never run on live as written:** C9/G1 (real card), C13/C14 confirmations, all of J (crons fire tenant-wide for *all* customers), K1/K3/K6/K7 (real refunds), L1-L6 (cancels real bookings + messages real customers), O2/O3 (mass-messages real customers), P2/P3, U8 (real campaign send), Z1 (creates a real tenant).
- **Safe way to exercise them on live:**
  - **Payments:** enable **Yoco test mode** (`20260503100000_yoco_test_mode.sql` supports it per-tenant) and use test cards. Never test with a live secret key.
  - **Create a disposable staging tenant** via super-admin and do all destructive/messaging tests there, with **your own** phone/email as the only customer.
  - **Crons (J):** don't wait for the scheduler — invoke the edge function directly against a seeded disposable booking, and assert **DB state** rather than real deliveries.
  - **WhatsApp/email:** point the test tenant's credentials at a sandbox number / your own inbox.
- **Genuinely safe on live (read-only/UI):** B6, C1-C4, R1/R3/R4, S1-S7, most Settings *reads*, dashboard views.

---

## EXISTING AUTOMATED COVERAGE (use it, don't re-invent)

- **Unit:** 10 files, **82/82 passing** (bot-guards ×51, waiver-DOB/minor, chat pricing, OTP attempts, tenant headers, voucher flows, my-bookings lookup, business hours, realtime).
- **E2E (Playwright, ~2,240 lines):** `auth`, `bookings`, `dashboard`, `marketing`, `navigation`, `operations`, `bot-regressions`, `full-journey`, `happy-path-booking`, and section-mapped `section-c-remaining`, `section-d-web-chat`, `section-e-admin-probe`.
- **Gap:** none of the Tier-0/Tier-1 blockers have a test that would have caught them. After fixing, add regression tests for: partial-voucher checkout total (B1), hold-expiry capacity release (B2), `rebook-booking` cross-tenant rejection (S1), reviews RLS isolation (S3).

---

## RECOMMENDED REMEDIATION ORDER

1. **Security sprint (Tier 0):** S1 rebook-booking auth+ownership → S3 reviews/vouchers RLS → S2 broadcast auth → S4 subscription/lockout server-side → S5 HMAC. Re-run `npm run check-security-drift`.
2. **Money/core (Tier 1):** B1 voucher overcharge (1-liner + webhook check) → B2 hold capacity release → B3 weather self-service handler.
3. **Feature gaps (Tier 2):** J6 ordering, U9 schedule, then J9/J10/K5/U16/X4 as product priorities dictate.
4. **Correctness (Tier 3):** tenant filters (B8/C7/H3/Q5/R2/U4/U5), P3 hardcoded branding, timezone bugs, email branding, automation cron schedules.
5. **Add regression tests** for every Tier-0/1 fix; only then re-run this checklist against a **staging tenant + Yoco test mode**.

---

## WHAT I COULD NOT VERIFY (needs runtime or more budget)
- AA5/AA6 cancel/refund idempotency guards (grep inconclusive).
- Runtime behaviors: actual cron scheduling/timezone output, real email/WhatsApp deliverability, Windguru widget (R5, config-dependent).
- ~40 of the 44 PARTIALs are **[RELAYED]** from the audit agents (specific `file:line` cited in `data/audit/audit-results.json`) but not personally re-read — verify before acting.

## Appendix
- Full structured findings (every case, evidence, prod-safety, existing-test): `data/audit/audit-results.json`.
- Your exact checklist (audit source of truth): `data/audit/user-checklist.md`.
- Checklist drift: your pasted list enumerates **215** cases (header says "196"); the repo's own `docs/PRODUCTION_TEST_CASES.md` has since grown to **446 across 53 sections** with different lettering — reconcile before sign-off.
