# BookingTours — Production Readiness Test Plan

**Date:** 2026-05-08
**Use:** A sequential, concrete test plan with binary pass/fail benchmarks per feature. Run in order — earlier steps are foundational.
**How to read each step:** *Why it matters* → *What to test* → *Pass benchmark* (concrete, measurable). A step is "PASS" only when **every** benchmark line is satisfied. One unmet line = FAIL.

**Estimated total time:** 18–24 hours of careful testing across 1–2 testers + a SQL console.

**Notation used:**
- `🔴 BLOCKER` — failure here means do not launch.
- `🟡 SHOULD-FIX` — failure means launch with caveats and a known-bug list.
- `🟢 NICE-TO-HAVE` — minor; can ship and fix in the next sprint.

---

# Phase 1 — Foundation (must pass before any other testing)

## Step 1: Multi-tenant isolation 🔴 BLOCKER

**Why it matters:** If Operator A can see or modify Operator B's data, this is a P0 data-leak bug that cannot ship under any circumstances.

**What to test:**
1. Create two test businesses: `Tenant-A` and `Tenant-B`. Each gets one admin user, one tour, two slots, three sample bookings.
2. Log in as Tenant-A admin. Walk every list/grid/dropdown in the dashboard: bookings, customers, refunds, inbox, marketing/contacts, vouchers, slots, photos, broadcasts, pricing, reports, marketing/automations.
3. For each list, manually inspect the rows for any `business_id` or `Tenant-B`-related identifier.
4. Try to navigate to `Tenant-B`'s booking detail by URL guessing: `/bookings/<known-tenant-b-booking-id>`.
5. Run SQL while logged in as Tenant-A: do any `select` queries return rows where `business_id != Tenant-A`?

**Pass benchmark:**
- Zero rows belonging to Tenant-B appear in any list, dropdown, or detail page accessed as Tenant-A.
- Direct URL access to a Tenant-B booking ID returns 404 or 403 — never the booking detail.
- All `select` queries from Tenant-A's session return only `Tenant-A` rows (RLS enforced).
- Same test reversed: Tenant-B sees zero Tenant-A data.

**Time:** 2 hours.

---

## Step 2: Role-based access control (RBAC) 🔴 BLOCKER

**Why it matters:** OPERATOR and MAIN_ADMIN have different scopes. SUPER_ADMIN routes (`/super-admin`) must be inaccessible to non-super-admins.

**What to test:**
1. Create three users in Tenant-A: one MAIN_ADMIN, one SUPER_ADMIN, one OPERATOR.
2. As OPERATOR, attempt to navigate to `/super-admin`, `/billing`, `/settings`. Attempt API calls to `/api/admin/*` routes.
3. As MAIN_ADMIN, attempt the same.
4. As SUPER_ADMIN, confirm full access.

**Pass benchmark:**
- OPERATOR cannot reach `/super-admin`, `/billing`, `/settings` — gets either redirected or a 403.
- OPERATOR `/api/admin/*` POST/PUT/DELETE calls return 403 or 401 (never 200).
- MAIN_ADMIN cannot reach `/super-admin/data-requests` if it's a SUPER_ADMIN-only page.
- Hidden ≠ secured: even if the link is hidden in nav, direct URL or API call must be rejected server-side.

**Time:** 1 hour.

---

## Step 3: RLS verification on every public table 🔴 BLOCKER

**Why it matters:** RLS is the safety net behind multi-tenant filtering. If it's disabled on any table, a single missing `business_id` filter in app code becomes a data leak.

**What to test:**
1. Run `npm run check-security-drift` (needs `DATABASE_URL`).
2. In SQL: `select schemaname, tablename, rowsecurity from pg_tables where schemaname = 'public' and rowsecurity = false;` — should return zero rows.
3. For 5 random business-scoped tables, run as anon: `select count(*) from <table>` — should return 0 (or only public-readable rows).

**Pass benchmark:**
- `check-security-drift` exits 0.
- Zero public-schema tables have `rowsecurity = false`.
- Anon `select` against `bookings`, `customers`, `slots`, `marketing_contacts`, `vouchers` returns 0 rows.

**Time:** 30 minutes.

---

# Phase 2 — Customer money path

## Step 4: Booking happy path (Yoco) 🔴 BLOCKER

**Why it matters:** The single most important flow. Every other feature is meaningless if customers can't book.

**What to test:**
1. On `<tenant>.booking.bookingtours.co.za`, complete a booking on **mobile (real phone)** and **desktop**:
   - Pick a tour, date, slot, qty=2, fill name/email/phone, no promo, no voucher.
   - Click "Book Now" → land on Yoco hosted checkout.
   - Pay with a Yoco sandbox success card.
   - Land on `/success?ref=<booking_id>`.
2. Verify in DB: `select status, total, paid_at from bookings where id = <id>` — status = PAID, total matches, paid_at is recent.
3. Verify in `idempotency_keys` table: row exists with `yoco_payment_id`.
4. Verify confirmation email received within 60 seconds (check Resend logs).
5. Verify confirmation WhatsApp received within 60 seconds (if WA template configured).

**Pass benchmark:**
- 5 consecutive successful bookings complete end-to-end without console errors.
- Each booking transitions to PAID within 30s of Yoco return.
- Each triggers exactly one confirmation email and one WhatsApp (no duplicates).
- Time from "Book Now" click to `/success` render is < 30s on a 4G connection.
- No 500s in `yoco-webhook` logs.

**Time:** 2 hours (across mobile + desktop).

---

## Step 5: Combo booking happy path (Paysafe split-pay) 🔴 BLOCKER

**Why it matters:** Combos are split-payment bookings across two operators. If split-pay logic breaks, partner operators don't get paid.

**What to test:**
1. Complete a combo booking with two tours from two different operators.
2. Pay via Paysafe sandbox card.
3. Verify in DB: `combo_bookings` row created, `confirm_combo_payment_atomic` RPC ran successfully, both child `bookings` rows transitioned to PAID atomically.
4. Verify `combo_settlements` shows the split correctly (e.g., 60/40 or however configured).
5. Both operators receive their respective confirmation notifications.

**Pass benchmark:**
- Combo booking shows status PAID in both operator dashboards.
- `confirm_combo_payment_atomic` runs to completion in <5s.
- Both child bookings show identical `paid_at` timestamps (atomic).
- Split amounts in `combo_settlements` sum exactly to the total paid (no R0.01 rounding error).
- Paysafe webhook signature verifies correctly (no 401s in logs).

**Time:** 1.5 hours.

---

## Step 6: PayFast ITN (only if PayFast is active in production) 🟡 SHOULD-FIX

**Why it matters:** Per the static review (`docs/qa/production-readiness-2026-05-08.md` §5.1), `payfast-itn` currently fails open on validation. If PayFast is decommissioned, skip this step. If it's live, do not launch until the fail-open is fixed.

**What to test:**
1. Disable network reachability to PayFast's validation API (block `payfast.co.za` in `/etc/hosts` for the test).
2. Submit an ITN with valid signature.
3. Confirm the function rejects with 4xx instead of marking the booking as PAID.

**Pass benchmark:**
- Function returns 4xx when validation API is unreachable (fail closed).
- Booking status remains PENDING_PAYMENT, not PAID.
- Test passes when PayFast API is reachable and the ITN is valid.

**Time:** 1 hour. **Status:** STATIC FAIL until §5.1 is fixed.

---

## Step 7: Voucher purchase 🟡 SHOULD-FIX

**Why it matters:** Vouchers are a separate revenue stream and the recipient experience must work end-to-end.

**What to test:**
1. Buy a voucher for R500. Use a different email for buyer vs recipient.
2. Pay via Yoco sandbox.
3. Verify recipient receives an email with a working voucher code.
4. Use the voucher in a real booking — verify R500 deducts atomically.
5. Replay the voucher code on a second booking — verify it's blocked (single-use or balance-tracking).

**Pass benchmark:**
- Voucher email received by recipient within 60s.
- Voucher code redeems exactly once or balance decrements correctly (no double-spend).
- Voucher record in DB has correct value, recipient_email, expiry.
- After first redemption, balance is correct in `vouchers` table.

**Time:** 1 hour.

---

## Step 8: Webhook integrity & idempotency 🔴 BLOCKER

**Why it matters:** Yoco/Paysafe retry webhooks. Without idempotency, a single retry could double-charge, double-confirm, or send two confirmation emails. Verified statically — needs runtime verification.

**What to test (per provider — Yoco, Paysafe, PayFast):**
1. Capture a real successful webhook payload + signature.
2. Replay the exact request 5 times via curl.
3. Confirm the booking transitions to PAID **once**, the customer receives **one** email and **one** WhatsApp, no double-charge.
4. Send a webhook with a tampered body (change one byte) and original signature — expect 401.
5. Send a webhook with a valid body and tampered signature — expect 401.

**Pass benchmark:**
- 5 replays of identical webhook → exactly 1 PAID transition, 1 email, 1 WhatsApp, 1 row in `idempotency_keys`.
- Tampered body + valid signature → 401, no DB writes.
- Tampered signature → 401, no DB writes.
- All three providers (Yoco, Paysafe, PayFast) tested.

**Time:** 1.5 hours.

---

# Phase 3 — Customer self-service

## Step 9: My-bookings OTP login 🟡 SHOULD-FIX

**Why it matters:** This is the customer's primary post-booking touchpoint.

**What to test:**
1. Visit `/my-bookings`. Enter email used for an existing booking.
2. Verify OTP email arrives within 60s.
3. Enter OTP within the validity window. Confirm login + booking list shows.
4. Enter expired OTP (wait >10 min). Confirm rejection with clear error.
5. Enter wrong OTP 3 times. Confirm progressive lockout or rate-limit (per-email or per-IP).

**Pass benchmark:**
- OTP email arrives in <60s.
- Successful OTP returns the customer to a booking list filtered to their own bookings only.
- Tenant isolation: customer with bookings at Tenant-A and Tenant-B sees ONLY the bookings for the tenant whose subdomain they're on.
- Expired OTP rejected with user-readable error.
- 3 wrong OTP attempts → blocked / rate-limited.

**Time:** 1 hour.

---

## Step 10: Reschedule, edit guests, cancel 🟡 SHOULD-FIX

**Why it matters:** Customer self-service reduces operator support burden. Each of these has price-impact and slot-impact logic that must be correct.

**What to test (each as a separate booking):**
1. **Reschedule** to a slot of equal price → no payment, slot atomically swapped.
2. **Reschedule** to a more expensive slot → payment uplift required, only after payment does the swap commit.
3. **Reschedule** to a cheaper slot → refund issued for the difference (or credit, per policy).
4. **Edit guests** from 2 to 3 → price uplift, payment captured, waiver invalidated and re-prompted.
5. **Edit guests** from 3 to 2 → refund issued, slot capacity returns.
6. **Cancel** within full-refund window → 100% refund, slot released.
7. **Cancel** within partial-refund window → tier-based refund, slot released.
8. **Cancel** outside refund window → no refund, slot released.

**Pass benchmark:**
- Every state transition produces the correct DB state (status, refund amount, slot capacity, hold release).
- No orphaned holds (verify `holds.expires_at < NOW()` queue is empty after each test).
- No double-charges, no missing refunds.
- Customer receives a confirmation email + WhatsApp for every state change.
- Waiver re-invalidation works on guest count increase.

**Time:** 3 hours.

---

## Step 11: Waiver (regression for today's fix) 🟡 SHOULD-FIX

**Why it matters:** Just fixed in commit `f722913`. Day/Month/Year selects must retain values.

**What to test:**
1. Open a waiver link from a real booking confirmation email.
2. Pick Day=5, Month=May, Year=1990 for guest 1 — verify all three selects show "5", "May", "1990" after each pick.
3. With qty>1, fill DOBs for all guests.
4. If any DOB indicates age <18, verify the guardian section appears.
5. Submit waiver. Verify `bookings.waiver_status = SIGNED` and `waiver_signed_at` set.
6. Test on **mobile** (375px) and **desktop** (1280px).

**Pass benchmark:**
- All three selects (Day/Month/Year) retain selected values without resetting to placeholder.
- Guardian section auto-shows for age <18.
- Submission writes `waiver_signed_name`, `waiver_signed_at`, `waiver_payload.participant_dobs`, and (if minor) guardian fields.
- Waiver token expiry honoured (link past expiry returns 410).
- Confirmed working on iPhone Safari and Chrome desktop.

**Time:** 30 minutes.

---

## Step 12: Review submission 🟢 NICE-TO-HAVE

**Why it matters:** Reviews drive trust, but are not on a critical revenue path.

**What to test:**
1. Receive a review request email 7 days post-trip (use a backdated booking).
2. Click link → land on `/review/<token>`.
3. Pick rating, write text, submit.
4. Re-click link — verify "already submitted" message (idempotent token).
5. Submit invalid rating (0 or 6) — verify rejection.

**Pass benchmark:**
- Review record persists with correct rating + text.
- Token marked `review_submitted = true`, second visit returns 410.
- Invalid ratings rejected client-side AND server-side.

**Time:** 30 minutes.

---

# Phase 4 — Communications

## Step 13: Email delivery (every template) 🟡 SHOULD-FIX

**Why it matters:** A customer who doesn't receive a confirmation email assumes the booking failed and may double-pay.

**What to test (one trigger per template — total ~12 templates):**
- Booking confirmation (Yoco)
- Booking confirmation (Paysafe combo)
- Reschedule confirmation
- Guest-add confirmation (incl. waiver re-invalidation)
- Cancellation confirmation
- Refund confirmation (full / partial / none)
- Voucher gift email (recipient)
- Voucher purchase confirmation (buyer)
- Indemnity / waiver request
- 24h reminder
- Review request (7-day post-trip)
- Manual invoice resend (from `/invoices`)

**Pass benchmark:**
- Each template arrives in <60s in a Gmail inbox (not spam).
- Each renders correctly: subject populated, sender name set, no `{{template_var}}` literals visible, images load, all links resolve.
- "From:" address is per-tenant (not generic `noreply@bookingtours.co.za` if a tenant has set their own).
- Unsubscribe link present where required (POPIA + marketing emails).
- Resend logs show 0 bounces, 0 complaints across the test batch.

**Time:** 2 hours.

---

## Step 14: WhatsApp delivery (every template) 🟡 SHOULD-FIX

**Why it matters:** South African customers rely on WhatsApp more than email; non-delivery is silent if not monitored.

**What to test (one trigger per WA template — ~6 templates):**
- Booking confirmation
- Reschedule confirmation
- Guest-add confirmation
- 24h reminder
- Thank-you (post-trip)
- OTP

**Pass benchmark:**
- Each template arrives in <60s.
- Variables rendered correctly (no `{{1}}` or `{{2}}` placeholders visible).
- Replying to the WA message routes back to the inbox correctly (verified in `/inbox`).
- No rate-limit errors from Meta Graph API in `wa-send` logs.
- WhatsApp signature verification on inbound webhooks succeeds (Step 8 covers this).

**Time:** 1.5 hours.

---

## Step 15: Auto-message timing 🟡 SHOULD-FIX

**Why it matters:** Reminders and reviews are time-based. Off-by-one errors in timezones produce reminders at 3am or never.

**What to test:**
1. Create a booking for tomorrow's slot. Wait for the 24h reminder cron tick. Confirm reminder received.
2. Create a booking for a slot ending 2h ago. Confirm thank-you message fires.
3. Create a backdated booking 7 days old. Confirm review request fires.
4. Verify idempotency: cron must not send duplicate reminders if it runs twice. Check `auto_messages` table for `(booking_id, type)` upsert.
5. Test across 3 different timezones (e.g., a Tenant in Africa/Johannesburg vs Europe/London vs Pacific/Auckland) — confirm reminders fire at correct local time.

**Pass benchmark:**
- Each timing trigger fires within ±1 hour of expected.
- No duplicate reminders for the same `(booking_id, type)`.
- Timezone-aware: reminder for a Johannesburg booking fires at the right SAST hour.

**Time:** Set up takes time but verification is short. **3 hours wall-clock + 30 min verification.**

---

# Phase 5 — Background processes

## Step 16: Cron jobs (all 7) 🟡 SHOULD-FIX

**Why it matters:** Per the static review, all cron jobs have correct `verify_jwt = false` settings and are wired up. Behavioural pass is still required.

**What to test (one tick per job, observed in real time):**
- `marketing-dispatch` (every minute) — drains queue, sends emails
- `cron-tasks` (every 5 min) — hold cleanup, abandoned vouchers, auto-tag
- `fetch-google-reviews` (03:17 daily) — pulls Google reviews into DB
- `viator-availability-sync` (minute 7 hourly)
- `getyourguide-availability-sync` (minute 12 hourly)
- `ota-reconcile` (02:37 daily) — drift detection
- `auto-messages` review_reminders (09:23 daily)

**Pass benchmark:**
- Each cron job logs a successful run in the last 24h (`cron.job_run_details` table or Supabase logs).
- Zero `verify_jwt` 401s in any cron-invoked function in the last 24h.
- Each job either processes work OR completes with "no work to do" cleanly (no exceptions).
- No job has been silently disabled (`cron.job` shows `active = true` for all 7).

**Time:** 1 hour active + observation overnight.

---

## Step 17: Hold expiry 🟡 SHOULD-FIX

**Why it matters:** Slot capacity is a finite resource. Stale holds block real bookings.

**What to test:**
1. Start a booking, get a hold, abandon at the payment screen.
2. Wait for `cron-tasks` to run (every 5 min).
3. Verify the hold is released and the slot is bookable again.
4. Verify any booking that arrives at Yoco webhook before the grace window expires is NOT cancelled (race condition).

**Pass benchmark:**
- Abandoned hold released within 10 min (5-min cron + 5-min grace).
- Held slots return to capacity correctly.
- A late-arriving Yoco webhook (within grace window) still confirms the booking.
- Zero orphan holds older than 1 hour.

**Time:** 45 min.

---

## Step 18: OTA sync & reconciliation drift 🟡 SHOULD-FIX

**Why it matters:** OTA bookings (Viator / GetYourGuide) bypass the customer flow. Drift = mis-billed, double-booked, or missing-from-system bookings.

**What to test:**
1. Create a Viator sandbox booking via their API.
2. Verify it appears in `/bookings` within the next minute-7 sync window.
3. Repeat for GetYourGuide.
4. Trigger `ota-reconcile` manually. Inspect `ota_reconciliation_runs` for drift entries.
5. If drift entries exist, verify they're surfaced in the `/ota-drift` admin page.

**Pass benchmark:**
- OTA bookings appear in dashboard within 60 min.
- `ota-reconcile` produces zero unexpected drift entries against test data.
- Drift entries appear in `/ota-drift` UI with correct booking details.
- `idempotency_keys` prevents duplicate booking creation on webhook retry.

**Time:** 2 hours (depends on OTA sandbox access).

---

# Phase 6 — Operator daily-use

## Step 19: Manifest / dashboard home 🟡 SHOULD-FIX

**Why it matters:** First page operators see every morning. If it's wrong, every operational decision based on it is wrong.

**What to test:**
1. Verify the count on "Today's Pax" matches `select sum(qty) from bookings where slot_date = today and status = 'PAID' and business_id = <tenant>`.
2. Verify "Pending Refunds" count matches DB.
3. Verify "Inbox Action" count matches DB.
4. Toggle TODAY/TOMORROW manifest tabs — verify slots reload.
5. Click a slot row — verify roll-call check-in toggles persist on refresh.
6. Add and remove a weather location.

**Pass benchmark:**
- Every counter matches DB exactly.
- Roll-call check-ins persist across page refresh and across operator users.
- Weather location add/remove persists.
- No console errors.

**Time:** 1 hour.

---

## Step 20: Bookings list + detail 🟡 SHOULD-FIX

**Why it matters:** Most-used page after the dashboard.

**What to test:**
1. Sort by date asc/desc, customer name, total. Verify correct order.
2. Filter by status (PAID, PENDING_PAYMENT, CANCELLED, etc.) — verify counts and filtered rows.
3. Search by customer name, email, phone, ref. Verify hits.
4. Pagination — go to page 2, then back to 1. Verify state.
5. Open a booking detail — verify all fields render. Edit customer info — verify save.
6. Apply a promo code (admin-side). Apply a voucher. Test invalid codes.
7. Resend payment link. Verify customer receives a new Yoco URL.
8. Open the cancel modal — verify confirmation flow.

**Pass benchmark:**
- Every sort/filter/search returns the correct rows from DB.
- Edit customer persists and updates the bookings list.
- Promo/voucher application changes the displayed total.
- Resend payment link sends an email within 60s.
- No 500s in logs.

**Time:** 2 hours.

---

## Step 21: Inbox (chat + WhatsApp) 🟡 SHOULD-FIX

**Why it matters:** Customer support runs through here. Latency or drop affects customer experience.

**What to test:**
1. Send a WhatsApp message to the tenant's WA number from a test phone. Verify it appears in inbox within 5s.
2. Reply from the inbox. Verify the customer's phone receives the reply within 5s.
3. Switch a conversation from "bot" mode to "human" mode. Verify bot stops auto-replying.
4. Click "Return to Bot". Verify bot resumes.
5. Test web chat from `/web-chat` (or wherever the embed is). Verify messages flow both ways.
6. Open Chat History tab. Verify lazy-loaded conversations render.

**Pass benchmark:**
- Round-trip latency from customer phone → admin inbox → back to phone is <10s.
- Bot mode toggle works without losing conversation history.
- No duplicate inbound messages on retry.

**Time:** 1.5 hours.

---

## Step 22: Refunds 🟡 SHOULD-FIX

**Why it matters:** Mistakes here directly cost money.

**What to test:**
1. Open `/refunds`. Verify pending refunds match DB.
2. Edit a refund amount inline. Verify validation (can't exceed booking total).
3. Trigger "Auto Refund" — verify Yoco / Paysafe API call succeeds and `refund_status` transitions to PROCESSED.
4. Trigger "Manual Refund" — verify it marks PROCESSED without API call.
5. Trigger "Refund All" with multiple bookings — verify all process atomically (or rollback on one failure).
6. Toggle "Processed Refunds" filter — verify history shows.

**Pass benchmark:**
- Refund amount validation prevents over-refunding.
- Auto-refund completes within 30s and updates `refund_status`.
- Failed refund (e.g., expired card) shows clear error and leaves state consistent.
- Refund triggers customer email + WhatsApp.

**Time:** 1.5 hours.

---

## Step 23: Manual booking creation 🟡 SHOULD-FIX

**Why it matters:** Operators frequently book on behalf of customers (phone bookings, walk-ins).

**What to test:**
1. From `/new-booking`, create a booking with status=PAID (manual mark).
2. Create with status=HOLD and a hold duration.
3. Apply a promo code, manual price override.
4. Add multiple add-ons.
5. Verify booking writes correctly to DB and appears in `/bookings`.

**Pass benchmark:**
- Manual booking persists with correct status, total, customer info.
- Manual mark-paid triggers confirmation email + WhatsApp (per business config).
- HOLD bookings expire correctly via `cron-tasks`.

**Time:** 1 hour.

---

# Phase 7 — Operator setup & configuration

## Step 24: Onboarding (fresh tenant E2E) 🔴 BLOCKER

**Why it matters:** First impression for every new operator. If onboarding fails, that's a churned customer before they pay.

**What to test:**
1. From `/super-admin`, create a new business: name, subdomain, timezone, currency, logo, WA token, Yoco secret.
2. Receive admin setup email. Set password.
3. Log in as new admin. Walk every section of `/settings`:
   - Admin users: invite a second admin, verify email.
   - Tours & Activities: create one tour with pricing, capacity, duration.
   - Shared Resources: create a kayak resource, assign to tour.
   - Booking Site Config: set colors, hero, directions, what-to-bring.
   - Email Customisation: upload one header image.
   - Invoice Details: set company name, VAT.
   - Banking Details: set account.
   - Integration Credentials: confirm WA + Yoco status are ✓.
   - Add-Ons: create one add-on.
   - Refund Policy: set tiers.
   - FAQ: add 2 entries.
4. Generate slots for the next 14 days.
5. Visit the tenant's booking subdomain. Confirm tour appears, branding applied.
6. Complete a real booking on the new tenant. Confirm it lands in the new admin's dashboard.

**Pass benchmark:**
- Every onboarding step persists data correctly.
- New tenant subdomain resolves and shows correct branding within 5 min.
- A test booking on the new tenant lands in the new admin's dashboard, NOT in any other tenant's dashboard.
- No console errors in any settings page.

**Time:** 3 hours.

---

## Step 25: Tour & slot management 🟡 SHOULD-FIX

**What to test:**
1. Create, edit, archive a tour. Verify booking site updates within 5 min.
2. Bulk-create 30 days of slots with weekday filtering.
3. Edit a single slot's capacity. Verify booking site reflects within 5 min.
4. Delete a slot with no bookings — succeeds.
5. Try to delete a slot with bookings — should fail with clear error.

**Pass benchmark:**
- Tour CRUD operations persist and propagate to booking site.
- Slot bulk creation produces exactly the expected slot count.
- Capacity edits don't allow capacity below current booked qty.

**Time:** 1.5 hours.

---

## Step 26: Marketing campaigns 🟡 SHOULD-FIX

**What to test:**
1. Create a contact list (manual import + segment).
2. Create an email template using the EmailBuilder.
3. Create a campaign targeting the list, template, scheduled to run in 5 min.
4. Wait for `marketing-dispatch` to fire. Verify all contacts receive the email.
5. Click an open-tracking pixel — verify `marketing-track` records the open.
6. Click a tracked link — verify `marketing-track` records the click and redirects.
7. Click "Unsubscribe" — verify `marketing-unsubscribe` flips the contact's status.

**Pass benchmark:**
- Campaign sends to 100% of targeted contacts within 5 min.
- Open and click tracking increment correctly.
- Unsubscribed contacts excluded from next campaign.
- No bounces or complaints in Resend logs.

**Time:** 2 hours.

---

## Step 27: Marketing automations 🟡 SHOULD-FIX

**What to test:**
1. Create an automation: trigger = "30 days before customer's birthday", action = send email with promo code.
2. Set a contact's DOB to 30 days from today + 1 day.
3. Wait for `marketing-automation-dispatch` cron tick.
4. Verify the contact gets enrolled, gets the email, gets a unique promo code.

**Pass benchmark:**
- Date-field trigger fires for the right contact at the right time.
- Promo code generated is unique per contact (no shared codes).
- Enrollment is idempotent — re-running cron doesn't double-enroll.

**Time:** 1.5 hours.

---

## Step 28: Promotions & vouchers (admin) 🟡 SHOULD-FIX

**What to test:**
1. Create a promo code: 20% off, valid 30 days, limit 50 uses, one per email.
2. Apply it on a booking. Verify discount.
3. Apply same code to second booking with same email — verify rejection.
4. Apply same code with new email — verify accepted up to 50 uses, then rejected.
5. Deactivate the code. Verify rejection.
6. Create a voucher manually. Send to a customer. Verify they can redeem.

**Pass benchmark:**
- Per-email limit enforced atomically (no race condition under concurrent bookings).
- Total-usage limit enforced.
- Deactivation immediate.
- Voucher creation + redemption end-to-end works.

**Time:** 1.5 hours.

---

# Phase 8 — Cross-cutting concerns

## Step 29: Mobile responsiveness 🟡 SHOULD-FIX

**Why it matters:** ~70% of South African web traffic is mobile. A broken mobile experience is a broken business.

**What to test (on a real iPhone + a real Android):**
- Booking site `/`, `/book`, `/combo/[id]`, `/voucher`, `/my-bookings`, `/waiver`, `/success` — all pages render and are usable on 375px width.
- Admin dashboard top 5 pages (`/`, `/bookings`, `/inbox`, `/refunds`, `/new-booking`) — usable on 375px.
- All buttons are tap-target-sized (minimum ~44x44px).
- Calendars and date pickers work via touch.
- WhatsApp inbox is usable on mobile (one-handed scroll, reply input not obscured by keyboard).

**Pass benchmark:**
- Zero horizontal-scroll on any page at 375px.
- Zero buttons require pinch-to-zoom to tap accurately.
- Booking flow completes successfully on a real phone end-to-end.
- No layout breakage when keyboard opens.

**Time:** 2 hours.

---

## Step 30: Performance benchmarks 🟡 SHOULD-FIX

**Why it matters:** Slow pages convert worse and burn operator goodwill.

**What to test (use Lighthouse / WebPageTest / Real User Monitoring):**
- `/` (booking site home) on 4G mobile: First Contentful Paint <2s, Largest Contentful Paint <3s.
- `/book` (booking flow): Time to Interactive <4s.
- Admin dashboard `/`: TTFB <1s on cable, page interactive <3s.
- Yoco checkout redirect round-trip: <30s door-to-door.
- Slot availability calendar fetch: <2s per click.
- Inbox conversation load (20 threads): <2s.

**Pass benchmark:**
- Every page meets its target on a cable connection.
- 4G mobile loads booking site in <5s end-to-end.
- No N+1 queries in DB logs (run pgBadger or similar against an hour of prod queries).
- Image optimization (`/api/img`) caches correctly — second request returns from cache.

**Time:** 2 hours.

---

## Step 31: Error handling & blank-screen audit 🟡 SHOULD-FIX

**Why it matters:** Users who hit blank screens assume the system is broken. Even an empty error message is better than nothing.

**What to test:**
1. For every route, simulate a backend failure (e.g., kill Supabase API briefly, or revoke auth token mid-session).
2. Verify each page shows a user-readable error, not a blank screen or infinite spinner.
3. For every form, submit with invalid data — verify field-level errors, not silent failures.
4. For every async action (Yoco checkout, refund, OTP send), simulate timeout — verify graceful retry or clear error.
5. Run the booking flow with JS disabled — should at minimum show a "JS required" message, not crash.

**Pass benchmark:**
- Zero blank screens on any failure mode.
- Zero infinite spinners > 30s.
- Every form has visible field-level validation.
- Every async action has loading + success + error states.
- Sentry / observability captures all errors with stack traces.

**Time:** 3 hours.

---

## Step 32: Security pass 🔴 BLOCKER

**Why it matters:** Public-facing payment platform. Attackers will probe.

**What to test:**
1. Grep codebase for `dangerouslySetInnerHTML` — confirm no user-supplied content is rendered raw.
2. Grep for any `_SECRET` or `API_KEY` env vars referenced in client code (`app/`, `booking/app/`, `components/`) — should find zero.
3. Run `npm audit` — confirm 0 vulnerabilities, or only known-acceptable ones.
4. Confirm `.gitignore` covers `.env*`, `*.pem`, `*.key`, `credentials.json`, `service-account.json`.
5. Test SQL injection on every form field that hits a Supabase query (Supabase parameterizes by default but verify with `' OR 1=1 --` style payloads).
6. Test XSS on every text input (try `<script>alert(1)</script>` in name, notes, address fields).
7. Test path traversal on `/api/img?url=...` — confirm only allowed hosts.
8. Run `npm run check-security-drift` — confirm clean.
9. Confirm Yoco / Paysafe public keys only in client; secret keys only in server / edge functions.
10. Confirm no logs leak PII (search recent logs for credit card patterns, full IDs, raw passwords).

**Pass benchmark:**
- All ten checks pass.
- Zero npm vulnerabilities.
- Zero secret keys in client code.
- Zero XSS / SQL injection successful.
- `check-security-drift` clean against production.

**Time:** 3 hours.

---

## Step 33: Observability (logs + alerts) 🟡 SHOULD-FIX

**Why it matters:** Production issues happen. Without alerts, you find out from angry customers.

**What to test:**
1. Sentry is wired up and capturing client + server errors. Trigger a test error — verify it appears in Sentry within 60s.
2. Edge function logs are accessible in Supabase dashboard with at least 7 days of retention.
3. Cron-job failures alert someone (email, Slack, etc.). Manually fail one — verify alert.
4. Webhook failures (e.g., Yoco signature verification 401) are visible in logs and alert if frequent.
5. Database slow queries are surfaced (Supabase logs slow queries by default).

**Pass benchmark:**
- Sentry captures a test error in <60s.
- A failed cron job triggers an alert within 1 hour.
- 7-day log retention confirmed.
- Slow-query log is being collected.

**Time:** 1 hour.

---

## Step 34: Backup & recovery 🟡 SHOULD-FIX

**Why it matters:** Data loss = company-ending event for a booking platform.

**What to test:**
1. Confirm Supabase point-in-time recovery is enabled (check project plan — needs Pro+ tier).
2. Take a manual snapshot. Verify restore process works (restore to a staging branch, confirm data integrity).
3. Confirm encrypted backups for sensitive data (bank details, payment credentials) — pgcrypto-encrypted columns can be re-decrypted with `SETTINGS_ENCRYPTION_KEY`.
4. Document the recovery runbook: who to call, what tier of restore, RTO and RPO targets.

**Pass benchmark:**
- PITR is enabled.
- A test restore succeeds and produces correct data.
- `SETTINGS_ENCRYPTION_KEY` is stored separately from the database (not in same backup).
- Recovery runbook exists in `PRODUCTION_RUNBOOK.md`.
- RTO target ≤4 hours documented; RPO target ≤1 hour documented.

**Time:** 2 hours.

---

## Step 35: Data accuracy spot-checks 🟡 SHOULD-FIX

**Why it matters:** Operators trust the dashboard's numbers. Off-by-one bugs in financial figures are corrosive.

**What to test:**
- Pick 5 random bookings. Compare every displayed field against `select * from bookings where id = ...`. Should match exactly.
- Pick 3 random reports (revenue today, revenue this month, top tour). Manually compute from raw data. Should match.
- Verify counters on `/` (Today's Pax, Pending Refunds, Inbox Action) match SQL queries.
- Verify CSV export from `/bookings` matches what's displayed.
- Verify invoice PDF matches the booking detail.

**Pass benchmark:**
- Every spot-check matches exactly.
- CSV export matches table view (no missing or extra columns).
- Invoice PDF matches booking total to the cent.

**Time:** 2 hours.

---

## Step 36: Day-one production smoke test 🔴 BLOCKER

**Why it matters:** Even with all tests above passing, prod often differs from staging in subtle ways.

**What to test (on actual production, day-of-launch):**
1. First real operator signup (you, manually) — completes without errors.
2. First real customer booking on a real tenant — completes, customer receives confirmation.
3. First real Yoco payment processes correctly.
4. First real Paysafe combo (if applicable).
5. First real auto-message fires.
6. First real email delivers (not in spam).
7. First real WhatsApp delivers.
8. `marketing-dispatch` cron tick processes a queue item.
9. `npm run check-security-drift` passes against prod.
10. No 500s in any edge function logs in the first hour.

**Pass benchmark:**
- All ten smoke tests pass on production.
- No critical errors in the first hour of live traffic.
- Operator and customer reach success state without intervention.

**Time:** 1 hour active + monitoring overnight.

---

# Summary — pass/fail decision matrix

A step is **PASS** only when every benchmark line is satisfied. Otherwise **FAIL**.

The system is **production-ready** when:
- All 🔴 BLOCKER steps PASS (Steps 1, 2, 3, 4, 5, 8, 24, 32, 36).
- ≤5 🟡 SHOULD-FIX steps FAIL, each with a documented workaround and a fix scheduled within 1 week.
- 🟢 NICE-TO-HAVE failures don't block launch.

If even one BLOCKER fails, **do not launch.**

---

# Estimated total time

| Phase | Steps | Hours |
|---|---|---:|
| Foundation | 1–3 | 3.5 |
| Customer money path | 4–8 | 7 |
| Customer self-service | 9–12 | 5 |
| Communications | 13–15 | 6 |
| Background processes | 16–18 | 4 |
| Operator daily-use | 19–23 | 7 |
| Operator setup | 24–28 | 9.5 |
| Cross-cutting | 29–35 | 15 |
| Day-one smoke | 36 | 1 |
| **Total** | **36 steps** | **~58 hours** |

This is realistic for a thorough pass with one tester. With two testers in parallel (one customer-facing, one operator-facing), ~30 hours wall-clock.

If you have less time: prioritize ruthlessly. The blockers (Steps 1, 2, 3, 4, 5, 8, 24, 32, 36) are non-negotiable — that's ~14 hours of the 58. Drop everything else if you must, and ship with a very small operator pilot, monitoring closely.

---

# Output template per step

When running each step, record results in this format:

```
Step N: <name>
Tester: <name>
Date: <date>
Device(s): <mobile + desktop>
Result: PASS / FAIL / PARTIAL
Evidence: <screenshot links, log excerpts, SQL query results>
Notes: <any deviations from expected, edge cases discovered>
Time spent: <hours>
```

Aggregate these into a single `production-test-results-<date>.md` file. The final production-ready verdict is computed from the aggregated PASS/FAIL counts using the decision matrix above.
