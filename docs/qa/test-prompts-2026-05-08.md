# BookingTours — Production-Readiness Test Prompts

**How to use:** Copy each prompt section verbatim into your test AI. Run them in order. Move to the next prompt only after the current one returns ✅ PASS. On ❌ FAIL, copy the fix prompt the test AI emits to your implementation AI, apply the fix, then re-run the failing step.

**Each prompt is self-contained** — the test AI does not need to remember the previous step. Project context is embedded in every prompt.

---

## Shared system context (embedded in every prompt below — don't copy this section alone)

```
PROJECT: BookingTours — multi-tenant booking platform for adventure/tourism businesses.

REPO: /Users/gideonlangenhoven/dev/capekayak (main, on branch main)
APPS:
  - Admin dashboard: Next.js 16 at /Users/gideonlangenhoven/dev/capekayak/app, dev port 3000
  - Customer booking site: Next.js 16 at /Users/gideonlangenhoven/dev/capekayak/booking/app, dev port 3001
  - Edge functions: Deno, at /Users/gideonlangenhoven/dev/capekayak/supabase/functions
STACK: React 19, Tailwind 3, TypeScript, Supabase (Postgres + Deno edge functions), npm only.
PAYMENTS: Yoco (single), Paysafe (combo split-pay), PayFast (legacy ITN).
TENANCY: Every business-scoped table has a business_id column. RLS is enabled on all public tables. Subdomain → business_id resolution lives in supabase/functions/_shared/tenant.ts and (for the admin) BusinessContext component.
WEBHOOKS: HMAC-SHA256 verified (Yoco/Paysafe/Viator/GYG/Meta WA). PayFast uses MD5 + server-side validation round-trip.
IDEMPOTENCY: idempotency_keys table for payment webhooks; auto_messages upserts on (booking_id, type) for reminders.
ROLES: MAIN_ADMIN, SUPER_ADMIN, OPERATOR — stored in profiles.role.
SECURITY BASELINE: supabase/security-baseline.json. Run `npm run check-security-drift` with DATABASE_URL set.

YOUR ROLE: You are a QA test executor. Run the test below and report ✅ PASS or ❌ FAIL.
ON FAIL: Emit a "Fix prompt" block formatted exactly as shown — the user copies it to a separate implementation AI.
DO NOT FIX BUGS YOURSELF. Your job is verify and report only.

OUTPUT CONTRACT:
On PASS:
  ✅ PASS — Step <N>: <name>
  Evidence: <bulleted facts: queries run, files inspected, logs checked, screenshots noted>

On FAIL:
  ❌ FAIL — Step <N>: <name>
  Severity: 🔴 BLOCKER | 🟡 SHOULD-FIX | 🟢 NICE-TO-HAVE
  Failure evidence: <bulleted facts>

  ── BEGIN FIX PROMPT (copy this to your implementation AI) ──
  Fix this issue in the BookingTours codebase.
  Location: <file:line OR table.column OR cron job name>
  Problem: <one-sentence description>
  Required change: <specific, including a code diff if applicable>
  Constraints: do not break tenant isolation, RLS, idempotency, or webhook signature verification.
  Verification: <how to confirm the fix>
  ── END FIX PROMPT ──
```

---

# PROMPT 1 — Multi-tenant isolation 🔴 BLOCKER

```
[Shared system context block goes above — embedded once is enough.]

STEP 1: Multi-tenant isolation

WHAT TO TEST:
1. Confirm that two test tenants exist in the bookings DB (or set them up): Tenant-A and Tenant-B, each with a separate admin user, at least one tour, two slots, three sample bookings each.
2. Inspect the codebase for every Supabase query against business-scoped tables (bookings, customers, slots, vouchers, marketing_contacts, holds, refunds, invoices, marketing_campaigns, marketing_automations, conversations, photos, broadcasts, refund_policies). For each, confirm an explicit .eq("business_id", X) filter is present.
3. Run these SQL queries against staging:
   - SELECT count(*) FROM bookings WHERE business_id NOT IN (SELECT id FROM businesses); -- should be 0
   - For 5 random business-scoped tables, run as anon role: SELECT count(*) FROM <table>; -- should be 0 (RLS denies)
4. Use Grep to search both apps for ".from(" calls that don't have a business_id filter within 10 lines:
   - rg --type ts '\.from\("(bookings|customers|slots|vouchers|marketing_contacts|holds|refunds|invoices)"\)' app/ booking/app/ supabase/functions/ -A 8

PASS CRITERIA (every line must be true):
- Zero bookings rows orphaned (no matching businesses row).
- Anon role returns 0 rows from every business-scoped table.
- Every .from("<table>") call against a business-scoped table has an explicit .eq("business_id", X) filter within the next 10 lines, OR the function uses service_role and is justified (webhooks, cron) with a business_id derived elsewhere.
- No code path returns Tenant-B data when the request originates from Tenant-A's session.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 2 — Role-based access control 🔴 BLOCKER

```
[Shared system context block goes above.]

STEP 2: Role-based access control (RBAC)

WHAT TO TEST:
1. Create three test users in Tenant-A: USER_OP (OPERATOR role), USER_MAIN (MAIN_ADMIN), USER_SUPER (SUPER_ADMIN).
2. For each privileged route, perform an unauthenticated GET, then a GET as USER_OP, then USER_MAIN, then USER_SUPER. Routes to test:
   /super-admin, /super-admin/data-requests, /billing, /settings, /settings/ota, /settings/chat-faq
3. For each privileged API route, attempt a POST as USER_OP. Routes to test:
   /api/admin/setup-link, /api/admin/remove, /api/admin/add, /api/admin/update,
   /api/admin/whatsapp/bot-mode, /api/admin/chat-faq, /api/billing/seats,
   /api/billing/pause, /api/billing/resume, /api/admin/data-requests
4. Inspect each route's source for an auth check at the top of the handler (look for getUser, role check, redirect-on-fail).

PASS CRITERIA:
- USER_OP receives 401 or 403 (not 200) on every privileged route and API call.
- USER_MAIN receives 403 on /super-admin* routes (super-admin only).
- USER_SUPER receives 200 on all routes.
- Every privileged route file contains a server-side role check before any data access.
- "Hidden in nav" is not the same as "secured": even direct URL access by USER_OP must be rejected.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 3 — RLS verification 🔴 BLOCKER

```
[Shared system context block goes above.]

STEP 3: Row-Level Security on every public table

WHAT TO TEST:
1. Run: npm run check-security-drift (requires DATABASE_URL env var). Expect exit code 0.
2. Execute SQL: SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity=false; — expect zero rows.
3. For 5 randomly-chosen business-scoped tables, execute as anon role: SELECT count(*) FROM <table>; — each should return 0 (or only public-readable rows like a "businesses" row marked public).
4. Inspect supabase/security-baseline.json for the canonical RLS state.
5. Compare the live state to the baseline using check-security-drift.

PASS CRITERIA:
- check-security-drift exits 0.
- Every public-schema table has rowsecurity=true.
- Anon role returns 0 rows on bookings, customers, slots, marketing_contacts, vouchers, holds.
- Live state matches baseline.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 4 — Booking happy path (Yoco) 🔴 BLOCKER

```
[Shared system context block goes above.]

STEP 4: Booking happy path on Yoco

This step is HUMAN-ASSISTED — you (the test AI) guide the human through five real bookings, then verify each in the database.

WHAT TO TEST:
1. Instruct the user to complete 5 consecutive bookings on a tenant subdomain (e.g., capekayak.booking.bookingtours.co.za in staging), alternating mobile and desktop:
   - Pick tour, pick date, pick slot, qty=2, fill name/email/phone, no promo, no voucher.
   - Click "Book Now" → land on Yoco hosted checkout.
   - Pay with Yoco sandbox success card (user gets card from Yoco docs).
   - Land on /success?ref=<booking_id>.
2. After each booking, query the database:
   - SELECT id, status, total, paid_at FROM bookings WHERE id = <id>;
   - SELECT count(*) FROM idempotency_keys WHERE booking_id = <id>;
3. Check that confirmation email arrived (Resend dashboard) and WhatsApp message arrived (test phone).
4. Inspect yoco-webhook logs in Supabase for the matching event.

PASS CRITERIA:
- All 5 bookings transition to status=PAID within 30 seconds of Yoco return.
- paid_at is recent (≤30s after webhook).
- Each booking has exactly one idempotency_keys row.
- Each customer receives exactly one confirmation email and one WhatsApp message.
- Time from "Book Now" click to /success render is ≤30s on a 4G connection.
- Zero 5xx errors in yoco-webhook logs.
- Zero console errors in browser dev tools.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 5 — Combo booking happy path (Paysafe) 🔴 BLOCKER

```
[Shared system context block goes above.]

STEP 5: Combo booking happy path on Paysafe (split-pay)

HUMAN-ASSISTED.

WHAT TO TEST:
1. Instruct the user to complete a combo booking spanning two tours from two different operators (Tenant-A + Tenant-B).
2. User pays via Paysafe sandbox card.
3. Verify in DB:
   - SELECT id, status, total, paid_at FROM combo_bookings WHERE id = <combo_id>;
   - SELECT id, status, paid_at FROM bookings WHERE combo_booking_id = <combo_id>;
   - SELECT * FROM combo_settlements WHERE combo_booking_id = <combo_id>;
4. Check paysafe-webhook logs and the confirm_combo_payment_atomic RPC log line.
5. Confirm both operators see the booking in their /bookings page.

PASS CRITERIA:
- combo_bookings.status=PAID within 30s of Paysafe return.
- Both child bookings have status=PAID with identical paid_at timestamps (atomic).
- combo_settlements split amounts sum exactly to combo_bookings.total (no R0.01 rounding error).
- Both tenants' /bookings pages show the booking.
- Paysafe webhook signature verifies (no 401 in logs).
- Customer receives confirmation email + WhatsApp.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 6 — PayFast ITN fail-closed 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 6: PayFast ITN must fail closed when validation API is unreachable

CONTEXT: A static analysis flagged that supabase/functions/payfast-itn/index.ts may proceed with payment processing when PayFast's validation API call fails (network timeout, etc.) instead of rejecting the request. If PayFast is decommissioned, mark this step as N/A — but if any tenant uses PayFast, fix before launch.

WHAT TO TEST:
1. Inspect supabase/functions/payfast-itn/index.ts:
   - Find the call to PayFast's validation API.
   - Determine the behaviour when that call throws or returns a non-200.
2. Locally simulate an unreachable validation endpoint (e.g., point the call to a non-routable address, or block PayFast's domain in the test environment).
3. Submit an ITN with a valid signature and an unreachable validation endpoint.
4. Confirm the function returns 4xx and the booking status remains PENDING_PAYMENT (not PAID).

PASS CRITERIA:
- When PayFast validation API is unreachable, the function returns 4xx.
- Booking status stays PENDING_PAYMENT.
- When validation API is reachable and signature is valid, the function returns 200 and the booking transitions to PAID.

OUTPUT: Use the contract from the shared context.
If FAIL, in the fix prompt describe the exact try/catch or return statement to add at the validation call site, with a code diff.
```

---

# PROMPT 7 — Voucher purchase + redemption 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 7: Voucher purchase + redemption

HUMAN-ASSISTED for the purchase; AI-automatable for the SQL checks.

WHAT TO TEST:
1. User buys a voucher for R500 with buyer email A and recipient email B. Pays via Yoco sandbox.
2. Confirm recipient email B receives an email with a voucher code.
3. User uses the voucher code on a real booking. Confirm the R500 deducts atomically (verify total_paid + voucher_used = booking.total).
4. User attempts to use the same voucher code on a second booking — confirm rejected (single-use) OR balance correctly decremented to 0 (multi-use).
5. SQL checks:
   - SELECT id, code, value, balance, recipient_email FROM vouchers WHERE id = <voucher_id>;
   - SELECT id, voucher_id, amount FROM voucher_redemptions WHERE voucher_id = <voucher_id>;

PASS CRITERIA:
- Voucher email arrives at email B within 60s.
- Redemption deducts the correct amount atomically (no partial-state failures).
- Second redemption is either rejected or correctly balance-tracks.
- vouchers.balance never goes below zero.
- voucher_redemptions records exactly one row per redemption.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 8 — Webhook idempotency & signature integrity 🔴 BLOCKER

```
[Shared system context block goes above.]

STEP 8: Webhook idempotency and signature integrity (Yoco, Paysafe, PayFast)

AI-AUTOMATABLE via curl replay.

WHAT TO TEST (repeat for each provider):

A. IDEMPOTENCY:
1. Capture a real successful webhook payload + signature for Yoco. Save to a JSON file.
2. Replay the exact request 5 times via curl to your staging webhook URL.
3. Verify in DB:
   - SELECT count(*) FROM bookings WHERE id = <booking_id> AND status='PAID'; → 1
   - SELECT count(*) FROM idempotency_keys WHERE yoco_payment_id = <pid>; → 1
   - SELECT count(*) FROM auto_messages WHERE booking_id = <booking_id> AND type='BOOKING_CONFIRM'; → 1
4. Repeat for Paysafe (use paysafe_payment_id) and PayFast.

B. SIGNATURE INTEGRITY:
1. Send a webhook with valid signature but tampered body (change one byte).
   → expect 401, no DB writes.
2. Send a webhook with valid body but tampered signature.
   → expect 401, no DB writes.
3. Send a webhook missing the signature header.
   → expect 401, no DB writes.

PASS CRITERIA:
- 5 replays of identical webhook produce exactly: 1 PAID transition, 1 email, 1 WhatsApp, 1 idempotency_keys row, 1 auto_messages row.
- All three providers (Yoco, Paysafe, PayFast) tested.
- Tampered body → 401, zero DB writes.
- Tampered signature → 401, zero DB writes.
- Missing signature → 401, zero DB writes.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 9 — My-bookings OTP login 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 9: Customer self-service /my-bookings OTP login

HUMAN-ASSISTED.

WHAT TO TEST:
1. Visit <tenant>.booking.bookingtours.co.za/my-bookings.
2. Enter an email previously used for a real booking.
3. Verify OTP email arrives within 60s.
4. Enter the OTP within validity window. Confirm:
   - Booking list renders with only that customer's bookings.
   - Tenant isolation: a customer with bookings on Tenant-A and Tenant-B sees only Tenant-A bookings on the Tenant-A subdomain.
5. Test expired OTP (wait >10 min, then submit). Expect a clear error.
6. Test wrong OTP three times. Expect rate-limit or progressive lockout.

PASS CRITERIA:
- OTP email arrives in ≤60s.
- Successful OTP shows only the customer's own bookings.
- Tenant isolation enforced server-side.
- Expired OTP returns a user-readable error (not a stack trace).
- Three wrong attempts result in lockout or rate-limit (not infinite retries).

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 10 — Reschedule, edit guests, cancel 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 10: Customer reschedule / edit guests / cancel flows

HUMAN-ASSISTED.

WHAT TO TEST: Run all 8 sub-flows, each on a separate booking:
1. Reschedule to slot of equal price → no payment, atomic slot swap.
2. Reschedule to more expensive slot → uplift payment captured before swap commits.
3. Reschedule to cheaper slot → refund issued for difference.
4. Edit guests 2 → 3 → uplift, payment, waiver invalidated.
5. Edit guests 3 → 2 → refund, slot capacity returns.
6. Cancel within full-refund window → 100% refund, slot released.
7. Cancel within partial-refund window → tier refund, slot released.
8. Cancel outside refund window → no refund, slot released.

For each, after completion, run SQL:
- SELECT status, slot_id, total, refunded_amount FROM bookings WHERE id = <id>;
- SELECT count(*) FROM holds WHERE expires_at < NOW(); — must be 0
- SELECT capacity, current_bookings FROM slots WHERE id = <new_slot_id>;
Verify customer received an email + WhatsApp for each transition.

PASS CRITERIA:
- Every state transition produces correct DB state (status, refund amount, slot capacity).
- Zero orphaned holds (expires_at < NOW() should be empty).
- No double-charges, no missing refunds.
- Customer notified for every transition.
- Waiver invalidation triggers on guest count increase.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 11 — Waiver regression (commit f722913) 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 11: Waiver Day/Month/Year selects retain values (regression for fix in commit f722913)

HUMAN-ASSISTED.

WHAT TO TEST:
1. Open a waiver link from a real booking confirmation email.
2. For Guest 1, pick Day=5, Month=May, Year=1990. Confirm all three selects display "5", "May", "1990" after each pick (do not reset to placeholder).
3. With qty>1, fill DOBs for all guests.
4. If any DOB shows age<18, confirm guardian section auto-appears.
5. Submit. Run SQL:
   - SELECT waiver_status, waiver_signed_at, waiver_signed_name, waiver_payload FROM bookings WHERE id = <id>;
6. Test on iPhone Safari AND Chrome desktop (375px viewport AND 1280px viewport).

PASS CRITERIA:
- All three selects retain selected values (do NOT reset to placeholder after selection).
- Guardian section auto-shows for age<18.
- waiver_status='SIGNED', waiver_payload.participant_dobs is set, guardian fields stored if minor.
- Waiver token expiry honored (link past expiry returns 410).
- Tested on iPhone AND desktop, mobile-width AND desktop-width.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 12 — Review submission 🟢 NICE-TO-HAVE

```
[Shared system context block goes above.]

STEP 12: Customer review submission

HUMAN-ASSISTED for the click-through; AI verifies SQL after.

WHAT TO TEST:
1. Trigger a 7-day post-trip review email (use a backdated booking; or run auto-messages cron with action=review_reminders manually).
2. User clicks email link → /review/<token>.
3. User picks rating 5, writes text, submits.
4. User clicks the same link again → expect "already submitted" message (HTTP 410 or visible UI).
5. User submits an invalid rating (0 or 6) — expect rejection.

After:
- SELECT * FROM reviews WHERE token = <token>;
- SELECT review_submitted, review_submitted_at FROM <waiver_or_booking_table> WHERE token = <token>;

PASS CRITERIA:
- Review record persists with correct rating, comment, reviewer_name, submitted_at.
- Token marked submitted; second visit returns 410.
- Invalid ratings (<1 or >5) rejected client-side AND server-side.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 13 — Email delivery (every template) 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 13: Email delivery for every template

HUMAN-ASSISTED for trigger; AI inspects Resend logs.

WHAT TO TEST: Trigger one email per template (~12 templates) and verify each:
- Booking confirmation (Yoco)
- Booking confirmation (Paysafe combo)
- Reschedule confirmation
- Guest-add confirmation (incl. waiver re-invalidation)
- Cancellation confirmation
- Refund confirmation (full / partial / none — three sub-cases)
- Voucher gift email (recipient)
- Voucher purchase confirmation (buyer)
- Indemnity / waiver request
- 24h reminder
- Review request
- Manual invoice resend (from /invoices)

For each, inspect:
- Resend dashboard for delivery status (delivered, not bounced).
- Inbox in Gmail (NOT spam folder).
- Rendered HTML in browser preview.

PASS CRITERIA:
- Every template arrives in ≤60s, in Gmail Inbox (not Spam).
- Rendered correctly: subject populated, sender name set, no {{template_var}} literals visible, images load, all links resolve.
- "From:" address is per-tenant when configured (not generic).
- Unsubscribe link present where required (POPIA + marketing).
- Resend logs show 0 bounces, 0 complaints across the test batch.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 14 — WhatsApp delivery (every template) 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 14: WhatsApp delivery for every template

HUMAN-ASSISTED.

WHAT TO TEST: Trigger one WA message per template (~6 templates):
- Booking confirmation
- Reschedule confirmation
- Guest-add confirmation
- 24h reminder
- Thank-you (post-trip)
- OTP

For each:
- Confirm message arrives on test phone within 60s.
- Variables rendered correctly (no {{1}} or {{2}} placeholders visible).
- Reply to the message — confirm reply routes back to /inbox.
- Inspect wa-send logs for any rate-limit errors from Meta.

PASS CRITERIA:
- Every template arrives in ≤60s.
- Variables are populated (no template placeholders visible).
- Reply routing to /inbox works within 5s.
- Zero rate-limit 429 errors in wa-send logs across the batch.
- Inbound webhook signature verification (x-hub-signature-256 with WA_APP_SECRET) succeeds — no 401s.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 15 — Auto-message timing (incl. timezone) 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 15: Auto-message timing across timezones

WHAT TO TEST:
1. Create three test bookings on three tenants in different timezones: Africa/Johannesburg, Europe/London, Pacific/Auckland.
   - Tenant-JHB: booking for tomorrow 09:00 SAST.
   - Tenant-LDN: booking for tomorrow 09:00 BST.
   - Tenant-AKL: booking for tomorrow 09:00 NZST.
2. Wait for the cron tick that fires 24h reminders.
3. For each booking, verify:
   - Reminder fires within ±1 hour of (slot_start - 24h) in tenant's local time.
   - SELECT * FROM auto_messages WHERE booking_id = <id> AND type='REMINDER_24H'; → exactly 1 row.
4. Manually trigger the cron a second time — verify NO duplicate reminder is sent (auto_messages upsert on conflict).
5. Backdate a booking 7 days, manually trigger auto-messages with action=review_reminders, verify the review request fires once.

PASS CRITERIA:
- Each timezone fires within ±1 hour of expected local time.
- No duplicate reminders for any (booking_id, type).
- Review request fires for 7-day-old bookings.
- Idempotency: re-running cron does not produce a second message.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 16 — Cron jobs (all 7) 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 16: All 7 cron jobs

AI-AUTOMATABLE via SQL.

WHAT TO TEST:
1. SQL: SELECT jobname, schedule, active FROM cron.job;
   Expect 7 rows, all active=true:
   - marketing-dispatch (* * * * *)
   - cron-tasks (*/5 * * * *)
   - fetch-google-reviews (17 3 * * *)
   - viator-availability-sync (7 * * * *)
   - getyourguide-availability-sync (12 * * * *)
   - ota-reconcile (37 2 * * *)
   - auto-messages-review-reminders (23 9 * * *)
2. SQL: SELECT jobname, status, return_message FROM cron.job_run_details WHERE start_time > NOW() - INTERVAL '24 hours';
   Expect each job to have at least one successful run, zero "failed" status.
3. Inspect supabase/config.toml — confirm verify_jwt=false on every cron-invoked function.
4. Inspect each function's logs in the last 24h — search for "401 Unauthorized" or "Invalid JWT" — expect zero hits.

PASS CRITERIA:
- 7 cron jobs exist, all active.
- Each job has at least one successful run in last 24h.
- Zero JWT-related 401s across all 7 cron-invoked functions.
- Zero exceptions in the function logs that result in non-zero exit.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 17 — Hold expiry & race condition 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 17: Hold expiry with grace window

WHAT TO TEST:
1. Start a booking via the customer site. Get to the Yoco checkout screen. Note the booking_id and hold_id.
2. Abandon the checkout (close the browser). The hold has expires_at = now + 15 min.
3. Wait 20 min total (5 min beyond hold expiry). The cron-tasks job should run during that window with a 5-min grace period.
4. SQL:
   - SELECT id, expires_at, released_at FROM holds WHERE booking_id = <id>;
   - SELECT capacity, current_bookings FROM slots WHERE id = <slot_id>;
5. Race-condition test:
   - Start a fresh booking, get to Yoco checkout. Note hold expires_at.
   - Just before expires_at, complete the Yoco payment.
   - Verify the late-arriving webhook still confirms the booking (does NOT cancel due to hold expiry within grace window).

PASS CRITERIA:
- Abandoned hold released within 10 min of expiry (5 min cron tick + 5 min grace).
- Slot capacity returns correctly.
- A late-arriving Yoco webhook within grace window still confirms the booking.
- Zero orphan holds older than 1 hour: SELECT count(*) FROM holds WHERE expires_at < NOW() - INTERVAL '1 hour' AND released_at IS NULL; → 0.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 18 — OTA sync & reconciliation 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 18: Viator + GetYourGuide sync and reconciliation drift

HUMAN-ASSISTED (requires OTA sandbox access).

WHAT TO TEST:
1. Create a Viator sandbox booking via Viator's API (or have a sandbox webhook fired).
2. Wait for next minute-7 of the hour for viator-availability-sync OR fire viator-webhook directly.
3. Verify SQL: SELECT * FROM bookings WHERE source='VIATOR' AND created_at > NOW() - INTERVAL '1 hour';
4. Repeat for GetYourGuide (minute 12 of the hour).
5. Manually fire ota-reconcile. Inspect SQL: SELECT * FROM ota_reconciliation_runs ORDER BY started_at DESC LIMIT 1;
6. If drift entries exist, verify they appear in /ota-drift admin UI.
7. Test signature replay: send a Viator webhook, then replay it 3 times. Verify exactly one booking row created.

PASS CRITERIA:
- OTA bookings appear in dashboard within 60 min of Viator/GYG creation.
- Both Viator and GetYourGuide signature verification succeed (zero 401s).
- ota-reconcile produces zero unexpected drift entries against test data.
- Drift entries surface in /ota-drift UI with correct booking details.
- Replay produces exactly one booking (idempotency_keys enforces).

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 19 — Manifest dashboard accuracy 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 19: /  (manifest / dashboard home)

WHAT TO TEST: Compare every dashboard counter to the underlying SQL.

1. As a logged-in admin, open /. Note the counters:
   - Today's Pax
   - Pending Refunds
   - Inbox Action
   - Photos Out
2. Compute the same counts via SQL:
   - SELECT sum(qty) FROM bookings b JOIN slots s ON b.slot_id=s.id WHERE date(s.start_time AT TIME ZONE business.timezone)=current_date AND b.status='PAID' AND b.business_id=<id>;
   - SELECT count(*) FROM refunds WHERE status='PENDING' AND business_id=<id>;
   - SELECT count(*) FROM conversations WHERE last_message_inbound=true AND admin_handled=false AND business_id=<id>;
   - SELECT count(*) FROM bookings WHERE photos_sent_at IS NULL AND status='COMPLETED' AND business_id=<id>;
3. Toggle TODAY/TOMORROW manifest tabs — verify slots reload correctly.
4. Click a slot row — toggle a roll-call check-in. Refresh the page. Verify the check-in persists.
5. Add a weather location, then remove it. Verify each persists across reload.

PASS CRITERIA:
- Every counter matches SQL exactly (no off-by-one).
- Roll-call check-ins persist across refresh and across operator users.
- Weather location add/remove persists.
- No console errors in browser dev tools.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 20 — Bookings list + detail 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 20: /bookings list + /bookings/[id] detail

WHAT TO TEST:
1. Sort by date asc/desc, customer name, total. Verify each sort returns the correct row order.
2. Filter by status (PAID, PENDING_PAYMENT, CANCELLED, COMPLETED). Verify counts and rows match SQL.
3. Search by customer name, email, phone, ref. Verify hits.
4. Pagination: navigate to page 2, then back to 1. Verify no state loss.
5. Open a booking detail. Verify every field renders.
6. Click "Edit customer details", update phone, click save. Verify SQL: SELECT phone FROM bookings WHERE id=<id>;
7. Apply a promo code. Verify total updates and DB reflects.
8. Apply a voucher. Verify total updates and balance decrements.
9. Apply an invalid promo code. Verify clear error message.
10. Click "Resend payment link". Verify customer receives a new Yoco URL email within 60s.
11. Click "Cancel booking". Verify confirmation modal opens with correct refund amount.

PASS CRITERIA:
- Every sort/filter/search returns exactly the rows that the equivalent SQL would.
- Edit customer persists.
- Promo and voucher application updates total correctly.
- Invalid codes show clear errors (not silent failures or stack traces).
- Resend payment link sends an email in ≤60s.
- Zero 5xx errors in logs.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 21 — Inbox (chat) 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 21: /inbox WhatsApp + web chat round-trip

HUMAN-ASSISTED.

WHAT TO TEST:
1. Send a WhatsApp message from a test phone to the tenant's WA number. Verify it appears in /inbox in ≤5s.
2. Reply from /inbox. Verify the customer's phone receives the reply in ≤5s.
3. Switch the conversation from "bot" mode to "human". Send another message from the test phone — verify bot does NOT auto-reply.
4. Click "Return to Bot". Send another message — verify bot resumes auto-replying.
5. Test web chat from the booking site. Send a message. Verify it lands in /inbox.
6. Open the Chat History tab. Verify lazy-loaded conversations render without errors.

PASS CRITERIA:
- Round-trip latency phone→inbox→phone is ≤10s total.
- Bot mode toggle works without losing message history.
- No duplicate inbound messages on Meta retry (idempotency).
- Web chat round-trip works.
- Chat history loads without errors.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 22 — Refunds 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 22: /refunds queue + processing

HUMAN-ASSISTED.

WHAT TO TEST:
1. Open /refunds. Verify pending refunds shown match SQL: SELECT count(*) FROM refunds WHERE status='PENDING';
2. Edit a refund amount inline. Try to enter an amount greater than the booking total. Verify rejection.
3. Click "Auto Refund" on one row. Verify the Yoco/Paysafe API call succeeds and refund_status='PROCESSED'. Customer receives email + WhatsApp.
4. Click "Manual Refund" on another row. Verify status='PROCESSED' without an API call (manual mark only).
5. Click "Refund All" on a multi-select. Verify all process atomically. If any fails, verify the others either roll back or remain in PENDING (not partial-failure-silent).
6. Toggle "Processed Refunds" filter. Verify history shows.
7. Trigger a refund where the original card has expired (use Yoco sandbox decline card). Verify clear error and consistent state (refund_status='FAILED' or similar).

PASS CRITERIA:
- Refund amount validation prevents over-refunding.
- Auto-refund completes ≤30s and updates refund_status correctly.
- Failed refund shows clear error, leaves state consistent (no PAID with refund_status=PROCESSED).
- Refund triggers customer notification.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 23 — Manual booking creation 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 23: /new-booking manual booking creation

HUMAN-ASSISTED.

WHAT TO TEST:
1. From /new-booking, create a booking with status=PAID (manual mark).
2. Create a booking with status=HOLD and hold_hours=2.
3. Apply a promo code, then manual price override with reason.
4. Add at least 2 add-ons.
5. Submit. Verify SQL: SELECT * FROM bookings WHERE id = <newly_created_id>;
6. Verify booking appears in /bookings list immediately.
7. Wait for cron-tasks to run (5 min) — verify the HOLD booking expires correctly if not paid.

PASS CRITERIA:
- Manual booking persists with correct status, total, customer info, add-ons.
- Manual mark-paid triggers confirmation email + WhatsApp (per business config).
- HOLD bookings expire correctly via cron-tasks within 10 min.
- Add-on totals correctly sum into booking total.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 24 — Onboarding fresh tenant E2E 🔴 BLOCKER

```
[Shared system context block goes above.]

STEP 24: Onboarding a brand-new tenant end-to-end

HUMAN-ASSISTED. This is the longest test (~3h).

WHAT TO TEST:
1. As SUPER_ADMIN, go to /super-admin. Create a new business: name, subdomain, timezone, currency, logo, WA token, Yoco secret.
2. Receive admin setup email at the configured email. Click link. Set password.
3. Log in as the new MAIN_ADMIN. Walk every section of /settings:
   - Admin users: invite a second admin (verify invite email arrives).
   - Tours & Activities: create one tour with name, description, price, capacity, duration. Save.
   - Shared Resources: create a "Kayak" resource with capacity=10. Assign to the tour with units_per_guest=1.
   - Booking Site Config: set hero_title, hero_subtitle, color_main, directions, what_to_bring.
   - Email Customisation: upload one header image URL.
   - Invoice Details: set company_name, address, vat_number.
   - Banking Details: set account_owner, account_number, bank_name.
   - Integration Credentials: confirm WA + Yoco status both ✓ (green).
   - Add-Ons: create one add-on with price.
   - Refund Policy: set tiers (e.g., 100% if 48h+, 50% if 24-48h, 0% if <24h).
   - FAQ: add 2 entries.
4. Generate slots for 14 days from the InlineSlotManager.
5. Visit the tenant's booking subdomain (e.g., <new-subdomain>.booking.bookingtours.co.za). Confirm:
   - Tour appears with correct name, price, image.
   - Branding applied (color_main, hero_title).
   - Slots show available dates.
6. Complete a real test booking on the new tenant. Verify it lands in the new admin's /bookings dashboard, NOT in any other tenant's dashboard.

PASS CRITERIA:
- Every onboarding step persists data correctly to DB.
- New tenant subdomain resolves and shows correct branding within 5 min.
- Test booking lands in new admin's dashboard only (tenant isolation).
- Confirmation email + WhatsApp work for the new tenant (using tenant's own credentials).
- No console errors in any settings page.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 25 — Tour & slot management 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 25: Tour & slot CRUD

WHAT TO TEST:
1. Create a tour. Refresh booking subdomain — verify tour appears within 5 min.
2. Edit the tour name and price. Refresh booking subdomain — verify changes appear.
3. Archive (soft-delete) the tour. Verify it disappears from booking subdomain.
4. Bulk-create 30 days of slots with weekday filter (e.g., Mon-Fri only).
5. Edit one slot's capacity. Refresh booking subdomain — verify reflected.
6. Delete a slot with no bookings. Verify success.
7. Try to delete a slot WITH active bookings. Verify clear error (cannot delete).
8. Try to set a slot capacity below current booked qty. Verify rejection.

PASS CRITERIA:
- Tour CRUD operations persist and propagate to booking site within 5 min.
- Bulk slot creation produces exactly the expected count (e.g., 22 weekdays in 30 days).
- Capacity edits cannot reduce below current booked qty.
- Slots with bookings cannot be deleted.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 26 — Marketing campaigns 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 26: Marketing campaigns end-to-end

HUMAN-ASSISTED.

WHAT TO TEST:
1. From /marketing/contacts, create a list and import 5 test contacts.
2. From /marketing/templates, create an email template using the EmailBuilder. Include an open-tracking pixel and at least one tracked link.
3. From /marketing, schedule a campaign targeting the list with the template, scheduled to fire in 5 min.
4. Wait for marketing-dispatch (every minute). Verify all 5 contacts receive the email.
5. Open one email in a browser — verify open tracking increments (SQL: SELECT opens FROM marketing_queue WHERE campaign_id=<id>;).
6. Click a tracked link — verify click tracking increments and redirects correctly.
7. Click "Unsubscribe" — verify contact's status flips to UNSUBSCRIBED.
8. Schedule a second campaign to the same list — verify the unsubscribed contact is excluded.

PASS CRITERIA:
- Campaign sends to 100% of targeted contacts in ≤5 min.
- Open and click tracking increment correctly.
- Unsubscribe flips status; next campaign excludes them.
- Zero bounces or complaints in Resend logs across the test batch.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 27 — Marketing automations 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 27: Marketing automations (date-field triggers)

WHAT TO TEST:
1. Create an automation with: trigger_type="date_field", trigger_field="date_of_birth", offset_days=-30, action="send_email" with a promo-code generation step.
2. Set a test contact's date_of_birth to (today + 31 days). The automation should fire when the date is 30 days away (i.e., tomorrow).
3. Wait for marketing-automation-dispatch cron tick.
4. Verify SQL:
   - SELECT * FROM marketing_automation_enrollments WHERE contact_id=<id>;
   - SELECT * FROM promo_codes WHERE contact_id=<id>;
5. Confirm the contact receives an email with a unique promo code.
6. Re-run the cron tick — verify NO duplicate enrollment.
7. Use the promo code on a booking — verify it applies correctly.

PASS CRITERIA:
- Trigger fires at correct day offset.
- Promo code generated is unique per contact.
- Enrollment is idempotent.
- Generated promo applies on a booking.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 28 — Promotions & vouchers (admin) 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 28: /marketing/promotions and /vouchers (admin CRUD)

WHAT TO TEST:
1. Create a promo code: 20% off, valid 30 days, total limit 50 uses, per-email limit 1.
2. Apply on Booking 1 with email A — verify discount.
3. Apply same code on Booking 2 with email A — verify rejection (per-email limit).
4. Apply with email B — verify accepted.
5. Apply 49 more times with different emails — verify accepted.
6. Apply 51st time — verify rejection (total limit).
7. Deactivate the code. Try to apply — verify rejection.
8. Create a voucher manually for R500. Send to email C. Verify they can redeem.
9. Concurrently apply the same single-use voucher from two browser tabs. Verify only one succeeds (race condition test).

PASS CRITERIA:
- Per-email limit enforced atomically (no race condition under concurrent bookings).
- Total-usage limit enforced.
- Deactivation immediate.
- Voucher creation + redemption works end-to-end.
- Concurrent voucher redemption produces exactly one successful redemption.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 29 — Mobile responsiveness 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 29: Mobile responsiveness (real devices)

HUMAN-ASSISTED. Uses a real iPhone + a real Android phone.

WHAT TO TEST: For each of these pages, on iPhone Safari and Android Chrome at 375px viewport:
- Booking site: /, /book, /combo/[id], /voucher, /my-bookings, /waiver, /success.
- Admin: /, /bookings, /inbox, /refunds, /new-booking.

For each page check:
- Zero horizontal scroll.
- All buttons are tap-friendly (≥44x44px).
- Calendar/date picker works via touch.
- Forms are usable (keyboard doesn't obscure inputs).
- WhatsApp inbox is usable one-handed.

Then complete a full booking flow on a real iPhone end-to-end.

PASS CRITERIA:
- Zero horizontal scroll at 375px on any tested page.
- Zero buttons require pinch-to-zoom for accurate tap.
- Booking flow completes successfully on a real phone end-to-end.
- No layout breakage when keyboard opens.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 30 — Performance benchmarks 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 30: Performance — Lighthouse + RUM benchmarks

WHAT TO TEST:
1. Run Lighthouse against / (booking site home) on Mobile Slow 4G profile. Record:
   - First Contentful Paint
   - Largest Contentful Paint
   - Time to Interactive
   - Total Blocking Time
2. Same for /book (booking flow) on the same profile.
3. Run Lighthouse against admin / (dashboard) on Cable.
4. Time the Yoco redirect end-to-end with stopwatch (click "Book Now" → land on /success): record duration on a real phone on 4G.
5. Measure slot availability calendar fetch: open dev tools network tab, click date, measure XHR duration.
6. Measure /inbox load with 20 conversations: time from click to first conversation visible.
7. Inspect Supabase logs for slow queries (>1s) in the last hour.

PASS CRITERIA:
- Booking site / : FCP ≤2s, LCP ≤3s, TTI ≤4s on Mobile Slow 4G.
- Admin dashboard / : page interactive ≤3s on cable.
- Yoco redirect round-trip ≤30s end-to-end on 4G.
- Slot calendar fetch ≤2s.
- Inbox load (20 threads) ≤2s.
- Zero N+1 query patterns visible in Supabase logs.
- /api/img returns from cache on 2nd request (verify with curl + headers).

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 31 — Error handling & blank-screen audit 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 31: Error handling on every failure mode

WHAT TO TEST:
1. For each major route (admin / and booking /), simulate Supabase API outage (e.g., revoke session token mid-page or block supabase domain in /etc/hosts briefly).
2. Verify each page shows a user-readable error, not a blank screen, not an infinite spinner.
3. For every form (booking, waiver, settings, marketing template), submit with intentionally invalid data:
   - Empty required fields → field-level validation error.
   - Bad email format → email-specific error.
   - Negative quantity / out-of-range numbers → range error.
4. For every async action with a timeout possibility (Yoco checkout, refund, OTP send, marketing-dispatch), simulate timeout. Verify graceful retry or clear error.
5. With JavaScript disabled, load the booking site. Should at minimum show a "JavaScript required" message, not a crash.
6. Confirm Sentry (or equivalent) captures all client + server errors with stack traces.

PASS CRITERIA:
- Zero blank screens on any failure mode.
- Zero infinite spinners (>30s without progress).
- Every form has visible field-level validation.
- Every async action has loading + success + error states.
- Sentry captures errors with stack traces (verify by triggering one and checking dashboard).

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 32 — Security pass 🔴 BLOCKER

```
[Shared system context block goes above.]

STEP 32: Security audit

AI-AUTOMATABLE.

WHAT TO TEST:
1. Grep: rg -n "dangerouslySetInnerHTML" app/ booking/app/ components/ — verify no user-supplied content is rendered raw. Whitelist any cases (e.g., admin-curated email templates).
2. Grep for secret leakage: rg -nE "(YOCO_SECRET|PAYSAFE_SECRET|PAYFAST_SECRET|SERVICE_ROLE|API_KEY)" app/ booking/app/ components/ — must find zero matches in client-side code.
3. Run: npm audit --omit=dev. Verify 0 vulnerabilities, or only known-acceptable ones.
4. Inspect .gitignore — confirm coverage of: .env*, *.pem, *.key, credentials.json, service-account.json.
5. SQL injection probe on every form field that hits Supabase: try ' OR 1=1 --, "; DROP TABLE bookings; --, '; SELECT * FROM auth.users; -- in name, email, notes, address, phone fields.
6. XSS probe on every text input: try <script>alert(1)</script>, <img src=x onerror=alert(1)>, javascript:alert(1) in name, notes, FAQ entries, business_name (super-admin), tour description.
7. Path traversal on /api/img?url=... — try ../../etc/passwd, file:///etc/passwd, ftp://attacker.com — verify only allowed hosts pass.
8. Run: npm run check-security-drift — verify clean exit.
9. Verify Yoco/Paysafe public keys are in client code; secret keys only in supabase/functions/* (NEVER in client).
10. Inspect last 24h of edge function logs: search for credit card patterns (^[0-9]{13,19}$), full email addresses, raw passwords. Should find zero PII leaks.

PASS CRITERIA:
- All 10 checks pass.
- Zero npm vulnerabilities.
- Zero secret keys in client code.
- Zero successful XSS / SQL injection / path traversal.
- check-security-drift exits 0.
- Zero PII in logs.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 33 — Observability 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 33: Logs, alerts, and monitoring

WHAT TO TEST:
1. Sentry (or equivalent) is wired up for both client and server.
   - Trigger a test error from the admin app (e.g., visit /api/debug/sentry-test).
   - Verify it appears in Sentry within 60s with full stack trace.
2. Edge function logs in Supabase have ≥7 days retention.
3. Cron job failure alerts are wired (email or Slack).
   - Manually fail one cron job (e.g., temporarily set the function to throw).
   - Verify someone receives an alert within 1 hour.
4. Webhook 401 / 5xx failures are visible in logs and trigger alerts if frequent.
5. Database slow queries (>1s) appear in Supabase logs.

PASS CRITERIA:
- Sentry test error appears in dashboard ≤60s.
- ≥7-day log retention confirmed in Supabase dashboard.
- Cron failure alert triggers ≤1 hour.
- Webhook failures visible in logs.
- Slow-query log is being collected.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 34 — Backup & recovery 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 34: Backup, restore, and recovery readiness

WHAT TO TEST:
1. Confirm Supabase Point-in-Time Recovery is enabled in the project dashboard (requires Pro+ tier).
2. Take a manual snapshot.
3. Restore the snapshot to a Supabase staging branch — verify data integrity.
4. Confirm encrypted backups for sensitive columns: pgcrypto-encrypted columns (Paysafe credentials, OTA api_key_encrypted) can be re-decrypted with SETTINGS_ENCRYPTION_KEY.
5. Confirm SETTINGS_ENCRYPTION_KEY is stored separately from the database backup (e.g., in a secrets manager, not in the same backup).
6. Verify a recovery runbook exists in PRODUCTION_RUNBOOK.md with: who to call, restore procedure, RTO target, RPO target.

PASS CRITERIA:
- PITR is enabled.
- Test restore succeeds and produces correct data (sample 5 rows, compare).
- Encrypted columns re-decrypt cleanly post-restore.
- SETTINGS_ENCRYPTION_KEY storage is separate from DB backup.
- Recovery runbook exists with RTO ≤4 hours and RPO ≤1 hour documented.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 35 — Data accuracy spot-checks 🟡 SHOULD-FIX

```
[Shared system context block goes above.]

STEP 35: Data accuracy across dashboard, exports, and PDFs

WHAT TO TEST:
1. Pick 5 random bookings. For each, compare every field on /bookings/[id] against:
   SELECT * FROM bookings WHERE id = <id>;
   And: SELECT * FROM bookings_view WHERE id = <id>; (if such a view exists)
   Compare to the cent.
2. Pick 3 reports from /reports (e.g., revenue today, revenue this month, top tour). Compute the same metric manually from raw SQL. Compare.
3. Verify counters on / (Today's Pax, Pending Refunds, Inbox Action) match SQL.
4. Export CSV from /bookings. Open in a spreadsheet. Verify row count and columns match the dashboard table view.
5. Generate an invoice PDF for one booking. Open the PDF. Verify total matches booking.total exactly.

PASS CRITERIA:
- Every spot-check matches exactly (no off-by-one, no rounding errors >R0.01).
- CSV row count matches dashboard table view.
- Invoice PDF total matches booking total to the cent.

OUTPUT: Use the contract from the shared context.
```

---

# PROMPT 36 — Day-one production smoke test 🔴 BLOCKER

```
[Shared system context block goes above.]

STEP 36: Day-one smoke test on actual production (the final gate)

HUMAN-ASSISTED. Run on launch day, against production (not staging).

WHAT TO TEST:
1. First real operator signup: SUPER_ADMIN creates a new tenant. Tenant admin receives email, sets password, logs in.
2. First real customer booking: a real customer completes a booking on a real tenant.
3. First real Yoco payment processes correctly.
4. First real Paysafe combo (if any tenant uses combos).
5. First real auto-message fires (e.g., 24h reminder for a booking that's tomorrow).
6. First real email delivers — confirm in Gmail Inbox (not Spam).
7. First real WhatsApp delivers.
8. marketing-dispatch cron tick processes a queue item (verify SELECT * FROM marketing_queue WHERE status='sent' AND sent_at > NOW() - INTERVAL '5 minutes';).
9. npm run check-security-drift exits 0 against production.
10. Zero 5xx errors in any edge function logs in the first hour.

PASS CRITERIA:
- All 10 smoke checks pass on production.
- Zero critical errors in the first hour of live traffic.
- Operator and customer reach success states without intervention.

OUTPUT: Use the contract from the shared context.
```

---

# How to run this in practice

1. Open Prompt 1 above. Copy from the start of the prompt block to the closing fence.
2. Paste into your test AI session.
3. Wait for ✅ PASS or ❌ FAIL.
4. If PASS: move to Prompt 2.
5. If FAIL:
   - Copy the "── BEGIN FIX PROMPT ──" block from the test AI's output.
   - Paste it into your implementation AI session.
   - Apply the fix.
   - Re-run Prompt N until PASS.
6. Repeat through Prompt 36.

**Decision matrix for launch:**
- All 🔴 BLOCKER prompts (1, 2, 3, 4, 5, 8, 24, 32, 36) must PASS.
- ≤5 🟡 SHOULD-FIX prompts may FAIL — each with a documented workaround and a fix scheduled within 1 week post-launch.
- 🟢 NICE-TO-HAVE failures don't block launch.

If even one BLOCKER fails, **do not launch.**

---

# Operator notes on prompt sizing

Each prompt above is self-contained. The shared context block at the very top is reference only — you should embed it into each prompt before sending if your test AI doesn't have memory across runs. To do that quickly: prepend the contents of the "Shared system context" code block above to each "STEP N" prompt before pasting.

If your test AI has session memory, paste the shared context block once at the start of the session, then send each STEP N prompt without re-pasting it.
