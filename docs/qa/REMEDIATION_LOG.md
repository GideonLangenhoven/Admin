# Remediation Log

Working log for the MVP functional remediation pass against `docs/qa/CODE_AUDIT_2026-07-02.md`.

---

## TIER-0 SECURITY SPRINT (S1–S5) — FIXED 2026-07-02

All five Tier-0 blockers from `CODE_AUDIT_2026-07-02.md` are closed. Unit suite
141/141; admin + booking production builds compile clean; the S3 RLS migration
is applied to live project `ukdsrndqhsatjkmxijuj` and the security baseline is
updated. **Deployment of the four changed edge functions + both Vercel apps is
the remaining release step (see "Deploy checklist" at the end of this section).**

### S1 — rebook-booking unauthenticated IDOR over money operations — FIXED
**Root cause:** `rebook-booking` runs as `service_role` and loaded the booking by
client-supplied `booking_id` with **no auth and no ownership check**, so anyone
with a booking UUID could `CANCEL_REFUND` / `REMOVE_GUESTS` (refund) /
`RESCHEDULE` / edit contact details on **any tenant's** booking.
**Fix (`supabase/functions/rebook-booking/index.ts`):** added `authorizeCaller()`,
invoked immediately after the booking loads and before any action dispatch. Three
legitimate caller classes: (1) internal cross-function calls (wa-webhook,
web-chat) presenting the service-role key; (2) `/my-bookings` customers presenting
the HMAC-signed `customer_session` token (must match the booking's email **and**
`business_id`); (3) admin JWTs (must belong to the booking's business, SUPER_ADMIN
exempt) — or any Supabase-Auth user whose email matches the booking. Unauthenticated
callers get 401. `booking/app/my-bookings/page.tsx` now sends the stored
`mb_customer_session` token with every rebook call; magic-link users are covered by
the JWT that `functions.invoke` attaches. `supabase/config.toml` sets
`verify_jwt = false` for rebook-booking (the sb_secret_* service key is not a JWT;
in-function auth is stronger than the gateway's anon-key check).
**Files:** `rebook-booking/index.ts`, `booking/app/my-bookings/page.tsx`,
`supabase/config.toml`, `tests/unit/rebook-auth.test.ts` (new, 6 assertions).

### S2 — broadcast had no authentication or role check — FIXED
**Root cause:** `broadcast/index.ts` read `business_id` from the request body and
mass-messaged that tenant's PAID/CONFIRMED customers as `service_role` with no
auth — anyone could blast any tenant's customers by POSTing their `business_id`.
**Fix:** `requireAuth(req)` runs **before** the body is read; `business_id` is now
derived from the caller's admin row (`auth.businessId`), and only accepted from the
body for SUPER_ADMIN / internal service calls. `app/broadcasts/page.tsx` sends the
admin's Supabase access token (not the anon key).
**Files:** `broadcast/index.ts`, `app/broadcasts/page.tsx`,
`tests/unit/broadcast-auth.test.ts` (new).

### S3 — reviews RLS cross-tenant leak + voucher money holes — FIXED
**Root cause (reviews):** `reviews_authenticated_read/update` used `USING (true)`,
so any logged-in admin could read/modify **every** tenant's reviews.
**Root cause (vouchers, found while verifying S3):** `vouchers_anon_insert` was
`WITH CHECK (true)` — an anon caller could insert a `status='ACTIVE'` voucher with
an arbitrary `current_balance`, fabricating spendable credit **without paying**
(book page only checks `status==='ACTIVE'` + balance). `vouchers_anon_update` was
`USING (true) WITH CHECK (true)` — anon could rewrite **any** voucher.
Compounding it, `create-checkout` charged the **client-supplied** `amount` for
gift vouchers with no check against the voucher's `value`, while the webhook
activates `current_balance = value` — so even a legit purchase could be tampered to
pay R1 for a high-value voucher.
**Fix (migration `20260702120000_s3_tenant_rls_hardening.sql`, applied live):**
reviews authenticated SELECT/UPDATE scoped to `business_id = ANY(current_business_ids())`;
`vouchers_anon_insert` restricted to `status='PENDING'` **and** matching
`x-tenant-business-id` (the purchase flow already inserts PENDING; the webhook, as
service_role, flips to ACTIVE only after a confirmed payment); `vouchers_anon_update`
dropped (no booking-site flow updates vouchers as anon — deduction runs in the
webhook as service_role). **Fix (`create-checkout/index.ts`):** for `GIFT_VOUCHER`
the charge amount is overridden to the DB face value (`voucher.value`) before the
Yoco charge is built. `security-baseline.json` updated (reviews table was
previously untracked; anon-insert predicate updated; anon-update absent).
**Files:** migration (new), `create-checkout/index.ts`, `security-baseline.json`,
`tests/unit/voucher-rls-hardening.test.ts` (new). The audit's "vouchers keyed off a
forgeable `x-tenant-business-id` header" sub-claim was **stale** — live
`vouchers_anon_select` was already `x-voucher-code`-scoped.

### S4 — subscription suspension (A8) never enforced server-side — FIXED
**Root cause:** `requireActiveSubscription` existed in `app/lib/api-auth.ts` but was
never called; a suspended (non-paying) tenant kept full API access by hitting routes
directly. **Fix:** `getCallerAdmin()` now fails closed — when the caller's
subscription is not ACTIVE/TRIAL it returns null (401), so all ~25 privileged routes
that share this boundary reject suspended tenants. SUPER_ADMIN is exempt; the five
`/api/billing/*` routes pass `{ skipSubscriptionCheck: true }` so a suspended tenant
can still reach billing to reactivate; tenants with no subscription row stay active
(fail-open on missing row, so no live tenant — all currently ACTIVE — is affected).
**A2 note:** the login-lockout "localStorage-only" finding is stale for the
server-side control — `proxy.ts` already rate-limits `/api/admin/login` +
`/api/admin/setup-link` to 5 attempts / 15 min per IP (Upstash-backed when
configured). The localStorage counter is UX on top; no redundant per-account counter
was added.
**Files:** `app/lib/api-auth.ts`, `app/api/billing/{subscription,resume,pause,seats,history}/route.ts`,
`tests/unit/subscription-gate.test.ts` (new, 8 assertions).

### S5 — external-booking HMAC bypassable for api-key-only credentials — FIXED
**Root cause:** `verifyAuth` accepts `authMode:"api_key"` when a credential has no
`hmac_secret`, so mutating actions ran unsigned (Y6). **Fix:** `create_booking`,
`cancel_booking`, `modify_booking` now require `authMode === "api_key+hmac"` (401
`SIGNATURE_REQUIRED` otherwise); read-only `check_availability` stays api-key-friendly.
**Files:** `external-booking/index.ts`, `tests/unit/external-booking-hmac.test.ts` (new).

### Verification
- `npm run test:unit` → **141/141** (24 new assertions across the 5 sprint tests).
- `npm run build` (admin) → ✓ compiled; `cd booking && npm run build` → ✓ compiled.
- `npm run lint` → 2 **pre-existing** errors only (`public/guide/sw.js`,
  `create-checkout:462 newQty` — confirmed present on HEAD, not mine); 0 new.
- `deno check` on rebook-booking/broadcast → clean; create-checkout/external-booking
  → identical pre-existing error counts to HEAD, none on changed lines.
- `npm run check-security-drift` → **run by the user with `DATABASE_URL`** before
  deploy (not available in this session's shell). Baseline already updated to the
  applied live state, so it should pass.

### MVP scope decision — remaining audit gaps (J9, X4, U16, P3) → POST-MVP

Reviewed against "what a first sales call / demo actually exercises" (the core
book → pay → confirm → manage → cancel/refund lifecycle, multi-tenant isolation,
calendar, inbox, marketing basics, waiver, vouchers, peak pricing, promos — all
WIRED per the audit). The following are **explicitly out of the sellable-MVP
scope** and tracked as fast-follow (v1.1), none block a demo:

- **J9 — abandoned-cart recovery (MISSING).** A growth/re-engagement feature
  ("Complete My Booking" nudge), not part of the core lifecycle. A demo never
  fails for its absence. Post-MVP.
- **X4 — email-overage billing (MISSING).** This is *BookingTours' own* platform
  monetization (billing tenants for email overage), not tenant-facing product.
  Under-billing = a platform revenue leak, but the product works. Do before you
  onboard many high-volume tenants; not before the first sales call. Post-MVP.
- **U16 — post_booking automation trigger (MISSING enrollment wiring).** The
  automation engine and date-based triggers work; only the on-booking enrollment
  hook is unwired. Post-MVP.
- **P3 — trip-photos email hardcodes "Cape Kayak Adventures" + a fixed Google
  place-id (Tier-3).** Demo-relevant only if you show the post-trip photo email to
  a non-CapeKayak prospect (unlikely in a first call). Flagged as polish — fix
  before onboarding the *second* tenant. Post-MVP.

Everything in Tier-0 (security) and Tier-1 (money/core flows) is fixed. The MVP is
functionally and securely complete for a sales call once the deploy below lands.

### Deploy checklist (remaining release step — coordinate function + app together)

> **Must be run from an authenticated environment.** This session's Supabase CLI
> returns 403 (insufficient privileges) and the MCP function-deploy would require
> hand-bundling each function's `_shared/*` graph (unsafe for live payment/OTA
> code), so the deploy is a **user step**. Order matters: deploy the **frontends
> first** — they only *add* a session token / JWT that the old functions ignore, so
> there is no breakage window; then deploy the functions.
Recommended order (safe — frontends are additive, so no request 401s in the gap):
1. **Frontends first.** Push both repos (handoff: both auto-deploy on Vercel push) —
   admin `caepweb-admin` (broadcasts sends JWT + subscription gate) and booking
   `booking` (my-bookings sends `mb_customer_session`). Old functions ignore the
   extra token/JWT, so nothing breaks yet. `git push` from `/…/capekayak` and
   `/…/capekayak/booking`.
2. **Then the four functions** (from an authed shell — this session is 403):
   `supabase functions deploy rebook-booking broadcast create-checkout external-booking --project-ref ukdsrndqhsatjkmxijuj`.
   Confirm the config sets `verify_jwt = false` for rebook-booking (it is currently
   `true` in prod — which is also why bot-initiated reschedules via the `sb_secret_*`
   key are failing at the gateway today; this deploy fixes that).
3. **Optional early wins (backward-compatible, deployable any time):**
   `create-checkout` (gift-voucher underpay fix) and `external-booking` (S5) need no
   frontend change — safe to ship first if you want the money/HMAC holes closed
   immediately. S5 is confirmed safe: the only live external credential (Viator) has
   an HMAC secret, so no partner breaks.
4. Run `DATABASE_URL=… npm run check-security-drift` → must exit 0 (baseline already
   updated to the applied live state).

**Already live (applied this session):** the S3 RLS migration
(`20260702120000_s3_tenant_rls_hardening.sql`) — reviews cross-tenant leak and the
anon-voucher free-credit hole are **closed in production now**; the rest of S3
(gift-voucher underpay) ships with the `create-checkout` deploy above.

---

## B1 — Partial gift-voucher checkout overcharges (G4, G8) — FIXED 2026-07-02

**Root cause:** `booking/app/book/page.tsx` built the PENDING booking payload without `voucher_amount_paid`, so `create-checkout/index.ts:175` computed `serverCashDue` from the full post-promo price, flagged a price mismatch, and overrode the charge to the full amount (also rewriting `bookings.total_amount`, which zeroed out the webhook's `original_total − total_amount` voucher-deduction gate). Net effect: customer charged full price on card, voucher never deducted.

**Fix:**
- `booking/app/book/page.tsx` — added `voucher_amount_paid: effectiveVoucherCredit` to the booking payload (voucher IDs/codes were already passed to `create-checkout` in the invoke body). Server math now yields `serverCashDue = afterPromoTotal − voucherCredit = finalTotal`, so no mismatch override.
- `supabase/functions/yoco-webhook/index.ts` — voucher deduction now uses `booking.voucher_amount_paid` when set, falling back to the `original_total − total_amount` delta. The delta includes any promo discount and would over-drain the voucher when a promo and voucher were combined.

**Files changed:** `booking/app/book/page.tsx`, `supabase/functions/yoco-webhook/index.ts`, `tests/unit/partial-voucher-checkout.test.ts` (new).

**Verification:** New regression test `tests/unit/partial-voucher-checkout.test.ts` (failed 2/3 before fix, passes after). `npm run test:unit` → 85/85 pass. `npm run lint` → 2 pre-existing errors in untouched files (`app/popia/confirm/page.tsx`, weather page `react-hooks/set-state-in-effect`), none in changed files.

---

## B2 — Expired regular holds never release slot capacity (J5) — FIXED 2026-07-02

**Root cause:** In `supabase/functions/cron-tasks/index.ts` `cleanupExpiredHolds`, the regular-hold expiry branch set `holds.status='EXPIRED'` and sent the customer a WhatsApp notice but never decremented `slots.held`. Since public availability = `capacity − booked − held`, every abandoned checkout permanently shrank the slot's sellable capacity. (The RESCHEDULE branch already released capacity correctly.)

**Fix:** Added a capacity release in the regular branch, mirroring the reschedule branch: `adjust_slot_capacity(p_slot_id: hold.slot_id, p_business_id: hold.business_id, p_held_delta: -qty)` with the same manual `slots.held` decrement fallback on RPC error. Release runs before the WhatsApp send so a notification failure cannot skip it. No double-release with the payment grace window: a late webhook only converts holds still `ACTIVE`, and its `heldDecrement` is 0 for already-expired holds.

**Files changed:** `supabase/functions/cron-tasks/index.ts`, `tests/unit/hold-expiry-capacity.test.ts` (new).

**Verification:** New regression test failed before the fix, passes after. `npm run test:unit` → 87/87 pass. `npm run lint` → unchanged (2 pre-existing errors in untouched files).

---

## B3 — Weather-cancellation self-service is non-functional (L4) — FIXED 2026-07-02

**Root cause:** `booking/app/my-bookings` offers three buttons on a weather-cancelled booking (`CANCELLED` + `refund_status='ACTION_REQUIRED'`): "Pick a New Date" (action `RESCHEDULE`), Voucher and Refund (action `CLAIM_CREDIT`). `rebook-booking` had no `CLAIM_CREDIT` handler and its state guard rejected all non-PAID/CONFIRMED/COMPLETED bookings, so every button failed.

**Fix (`supabase/functions/rebook-booking/index.ts`):**
- Added `CLAIM_CREDIT` to `validActions` and a `handleClaimCredit` handler. Eligibility (`claimEligible`) = `CANCELLED` + `refund_status='ACTION_REQUIRED'` + `refund_amount > 0` + not already converted to voucher. VOUCHER (and REFUND on voucher-paid bookings, where cash refunds are impossible) issues a CREDIT voucher via the existing `insertVoucherWithRetry` path, sets `converted_to_voucher_id`, clears `refund_status`, logs, and notifies via WhatsApp/email. REFUND sets `refund_status='REQUESTED'` (or `MANUAL_EFT_REQUIRED` for cash/EFT payments), capped at `total_captured − total_refunded`, updates `total_refunded`, logs, and notifies. No capacity changes — the slot was already released at cancellation.
- State guard now lets claim-eligible cancelled bookings through for `RESCHEDULE` ("Pick a New Date").
- `handleReschedule` equal/downgrade branch: for a credit claim, skips the old-slot `booked` decrement (already released by weather-cancel) and reactivates the booking (`status='CONFIRMED'`, refund fields and cancellation fields cleared).

**Fix (`supabase/functions/yoco-webhook/index.ts`):** reschedule-upgrade completion mirrors the same rule — skips the old-slot decrement and reactivates the booking (`status='PAID'`, refund/cancellation fields cleared) when the booking was `CANCELLED` (uplift paid via Yoco).

**Files changed:** `supabase/functions/rebook-booking/index.ts`, `supabase/functions/yoco-webhook/index.ts`, `tests/unit/claim-credit.test.ts` (new).

**Verification:** New regression test failed 4/4 before, passes after. `npm run test:unit` → 91/91 pass. `npm run lint` → unchanged (2 pre-existing errors, untouched files). `deno check` clean on `rebook-booking` and `cron-tasks` (`yoco-webhook` blocked only by unresolvable local `npm:standardwebhooks` dep, pre-existing).

---

## J6 — cleanupExpiredManualBookings shadowed by auto-messages ordering — FIXED 2026-07-02

**Root cause:** `cron-tasks` invoked `auto-messages` (action "all") first. Its `autoExpireBookingsForBusiness` cancels past-deadline PENDING bookings but releases no slot capacity (it only flips holds to EXPIRED). The later `cleanupExpiredManualBookings` — which does the real `adjust_slot_capacity(p_booked_delta: -qty)` release plus the admin WhatsApp — then found nothing still PENDING, making its release and notification dead code.

**Fix:** Reordered the `Deno.serve` body in `supabase/functions/cron-tasks/index.ts`: `cleanupExpiredHolds` → `cleanupExpiredManualBookings` → auto-messages invocation (was auto-messages first). Admin past-deadline bookings are now cancelled with the proper capacity release and admin notification; auto-messages' auto-expire still handles non-admin deadline bookings afterwards (its query skips already-CANCELLED rows, and `alreadySent(AUTO_CANCEL)` guards double-sends).

**Files changed:** `supabase/functions/cron-tasks/index.ts`, `tests/unit/cron-order.test.ts` (new).

**Verification:** New ordering regression test failed 2/2 before, passes after. `npm run test:unit` → 93/93 pass. `deno check` clean on cron-tasks.

---

## J10 — Stale DRAFT bookings never cleaned up — FIXED 2026-07-02

**Root cause:** The public book page saves best-effort DRAFT booking rows (`booking/app/book/page.tsx:332`) while the customer types. Abandoned drafts were never referenced again and no cron cleaned them — customer PII lingered indefinitely and the table bloated.

**Fix:** Added `cleanupStaleDraftBookings()` to `supabase/functions/cron-tasks/index.ts`: bulk-deletes `status='DRAFT'` bookings with `created_at` older than 24 hours, wired into the cron handler with its own try/catch and a `drafts_cleaned` result counter. Hard delete (not cancel) because DRAFTs precede holds/add-ons/capacity, so no children exist, and deletion is what actually removes the PII.

**Files changed:** `supabase/functions/cron-tasks/index.ts`, `tests/unit/draft-cleanup.test.ts` (new).

**Verification:** New regression test failed 2/2 before, passes after. `npm run test:unit` → 95/95 pass. `deno check` clean on cron-tasks.

---

## K5 — "Decline refund" action missing — FIXED 2026-07-02

**Root cause:** The admin Refund Queue (`app/refunds/page.tsx`) offered only Auto Refund / Manual / Refund-All. There was no way to decline a requested refund — no `DECLINED` setter, no button, no customer notification anywhere in the codebase.

**Fix (`app/refunds/page.tsx`):** Added a "Decline" button per pending refund row with a confirm dialog (same `confirmState` pattern as the other actions). `executeDeclineRefund` sets `refund_status='DECLINED'` + `refund_notes`, then emails the customer via the existing `send-email` `BOOKING_UPDATED` template (custom message, try/catch so a mail failure doesn't block the decline). Declined bookings remain visible: the processed list query now includes `DECLINED` with a grey "Declined" badge.

**Files changed:** `app/refunds/page.tsx`, `tests/unit/decline-refund.test.ts` (new).

**Verification:** New regression test failed 3/3 before, passes after. `npm run test:unit` → 98/98 pass. `npm run lint` → unchanged (2 pre-existing errors, untouched files).

---

## U9 — Scheduled campaigns fire on next cron tick — FIXED 2026-07-02 (finding partially stale)

**Re-verification vs audit:** The audit's exact symptom (scheduled sends fire on the next tick) no longer reproduces — `marketing-dispatch` now activates campaigns only when `scheduled_at <= now()` and skips queue items whose campaign is not `"sending"`. However the guard introduced a worse defect: the per-minute claim (`claim_marketing_queue` RPC and its fallback both select on `status='pending'` only, no campaign-status join) grabs the scheduled campaign's rows one minute after scheduling, the skip branch `continue`s without releasing them, and they strand in `"processing"` forever (no reaper exists). When the campaign's time arrived there were no `pending` rows left — **scheduled campaigns never sent at all**.

**Fix (`supabase/functions/marketing-dispatch/index.ts`):** claimed items whose campaign is `"scheduled"` or `"paused"` are collected into `deferredIds` and released back to `"pending"` after the prepare loop. Campaign activation runs before claiming in the same invocation, so on the due tick the rows are claimed after the campaign flips to `"sending"` and dispatch at the scheduled time (±1 cron minute). Cancelled/done campaign items keep their existing behaviour.

**Files changed:** `supabase/functions/marketing-dispatch/index.ts`, `tests/unit/scheduled-campaign-dispatch.test.ts` (new).

**Verification:** New regression test: activation-guard assertion passed pre-fix (stale part of the finding), release assertion failed pre-fix and passes after. `npm run test:unit` → 100/100 pass. `deno check` clean on marketing-dispatch. `npm run lint` → unchanged.

---

## Settings page inaccessible (proxy page gate vs. per-section permissions) — FIXED 2026-07-02

**Symptom:** "Can't access the settings page" — clicking Settings bounced to `/?denied=1`.

**Root cause:** `proxy.ts` `PAGE_GATES` gated `/^\/settings(\/|$)/` as PRIVILEGED (MAIN_ADMIN/SUPER_ADMIN cookie only). But the product deliberately supports regular ADMINs with granted per-section `settings_permissions` — `AppShell` shows them the Settings nav link and `app/settings/page.tsx` gates section-by-section. The proxy can't see those permissions (localStorage/DB, not cookie), so every regular ADMIN with granted sections was redirected away from a page the UI told them they could use. Reproduced with `curl -H "Cookie: ck_admin_role=ADMIN" localhost:3000/settings` → 307 `/?denied=1`. (The currently deployed build predates the gate, so it returns 200 there — the defect was in HEAD, about to ship.)

**Fix:** Removed the `/settings` entry from `PAGE_GATES` (with a comment explaining why). The page's own in-page permission state ("You do not have permission…") covers unauthorized roles — matching the gate's stated advisory-UX-only purpose; API routes remain the security boundary. `/billing`, `/privacy/data-requests`, `/super-admin`, `/ota-drift` gates unchanged.

**Verification:** New regression test `tests/unit/settings-page-gate.test.ts` (failed pre-fix). Live dev-server check post-fix: ADMIN/OPERATOR/SUPER_ADMIN cookies all → 200. Also verified end-to-end with a real SUPER_ADMIN session via Playwright that `/settings` renders fully on both the deployed build and local HEAD. `npm run test:unit` → 103/103.

---

## Bot cancellation refunds ignored tenant refund policy (WhatsApp + web chat) — FIXED 2026-07-02

**Found during:** full bot intent/routing audit (goal: WhatsApp + web chat correctness).

**Root cause:** Both bots hardcoded a 95% refund on customer cancellations — `wa-webhook` in the ACT_CANCEL_ quote and the CANCEL_REFUND action (plain and split-tender paths, `refund_notes: "95% refund via WhatsApp"`), `web-chat` in its cancel quote (`b.total_amount * 0.95`). The platform's authoritative rule (CLAUDE.md, `rebook-booking`, my-bookings web flow) is tenant-configured `refund_policies` tiers via the `calculate_refund_percent(p_business_id, p_tour_start)` RPC. A tenant configured for 100% or tiered refunds had bot cancellations quoted and actioned at the wrong amount.

**Fix:**
- `supabase/functions/wa-webhook/index.ts`: ACT_CANCEL_ (≥24h) now computes the percent via `calculate_refund_percent` using the slot's start_time (fallback 95), quotes the dynamic fee wording, and stores `cancel_pct` in `state_data`; CANCEL_REFUND actions with that percent in both plain and split-tender (cash-portion-only) paths; `refund_notes` now records the actual percent.
- `supabase/functions/web-chat/index.ts`: cancel quote computes the percent via the same RPC (fallback 95) and displays it; the actioned `refund_amount` flows from the quote as before.
- `supabase/functions/web-chat/index.ts`: slot-selection lookup now also filters `.eq("business_id", requestedBusinessId)` (was tour-scoped only), per the tenant-isolation invariant.

**Deliberately unchanged (flagged for product decision):** the <24h "no refund" hard gate in both bots (a tenant policy tier could be more generous); WhatsApp guest-removal refunds keep the flat 5% fee (web `rebook-booking` refunds the full excess) — divergent fee policy to reconcile.

**Files changed:** `supabase/functions/wa-webhook/index.ts`, `supabase/functions/web-chat/index.ts`, `tests/unit/bot-refund-policy.test.ts` (new).

**Verification:** New regression test failed 3/3 before, passes after. `npm run test:unit` → 106/106. `deno check`: web-chat 0 errors; wa-webhook error set identical to HEAD (pre-existing supabase-join typing pattern, none on changed lines).

---

## Bot hardening batch — P0/P1/P2 items from BOT_AUDIT closed — FIXED 2026-07-02

**P0 — atomic slot capacity:** All 12 inline `slots.booked` read-modify-writes across the bots (10 in `wa-webhook`: cancel ×4, weather-voucher convert, guest voucher/refund removal, MODIFY_QTY, change-tour release+book, weather refund claim; 2 in `web-chat`: cancel release, MODIFY_QTY) replaced with a shared `adjustSlotBooked()` helper that calls the atomic `adjust_slot_capacity` RPC (manual RMW retained only as the helper's RPC-failure fallback). Removes the race that could leak or oversell capacity; also adds the tenant filter the inline updates were missing.

**P0 — hold-failure junk rows:** When `create_hold_with_capacity_check` fails after the booking insert (both bots, voucher + paid paths), the never-real booking is now deleted instead of stranded as a CANCELLED "No capacity" row.

**P0 — WhatsApp reopen template:** the 24h-window template name is now `WA_REOPEN_TEMPLATE` env (fallback `hello_world`), so the Meta-approved template can be configured without a code change. **Ops action required:** create/approve the template in Meta Business Suite and set `WA_REOPEN_TEMPLATE` in edge function secrets.

**P1 — policy-aware cancel gate:** The hard "<24h = no refund" rule in both bots is replaced by the tenant's `refund_policy_tiers` (`calculate_refund_percent`): any positive policy percent offers self-service cancel at that percent (e.g. Aonyx's 12–24h → 50% tier now works); 0% shows the no-refund confirm (WA) / team-review path (web). Legacy 95%-when-≥24h retained only as RPC-failure fallback. The WhatsApp 12–24h action menu now includes Cancel Booking (previously the window had no cancel option at all, contradicting the tenant's configured 50% tier).

**P1 — guest-removal refund parity:** WhatsApp guest-removal refunds now pay the full removed-guest excess, matching the canonical `rebook-booking` web path (was 95% with a 5% fee).

**P1 — waiver enforcement:** investigated, not a defect — the platform model everywhere (web booking site included) is post-booking waiver signing with reminders; chat parity is correct.

**P2 — web-chat rate limiting:** per-client sliding-window limiter (20 msgs/min per IP, per instance) returning 429 with a friendly message.

**Files changed:** `supabase/functions/wa-webhook/index.ts`, `supabase/functions/web-chat/index.ts`, `tests/unit/bot-hardening.test.ts` (new, 9 assertions, all failing pre-fix).

**Verification:** `npm run test:unit` → 115/115. `npm run lint` → baseline (2 pre-existing errors, untouched files). `deno check` error counts identical to HEAD for both functions (5 / 53, all pre-existing join-typing noise).
