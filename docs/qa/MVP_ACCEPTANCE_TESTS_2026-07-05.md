# BookingTours — MVP User Acceptance Test Plan
_Created 2026-07-05. Goal: prove every current feature works ~99% of the time for both a **guest booking** and an **operator**, page by page._

## How to use this document
- Each test has an **ID**, a **priority**, **steps**, and an **expected result**. Tick the box when it passes on the deployed production build.
- **Priorities:** **P0** = MVP blocker (money, data loss, security, core flow); **P1** = important, must work for launch; **P2** = polish / edge case.
- **Definition of "workable MVP" (sign-off gate):** 100% of P0 pass, ≥95% of P1 pass, no known money/security defect open. Record failures in the "Defects found" log at the end.
- **Test in two browsers** (Chrome desktop + mobile Safari/Chrome) unless noted. Booking site is mobile-first; the Guide app is mobile-only.

## Test environment & data prerequisites
- [ ] **ENV-1** A dedicated **test tenant** exists with: at least 2 tours, upcoming open slots (one >24h away, one <24h, one <12h), Yoco in **test mode**, invoice/banking details set, a logo uploaded, WhatsApp credentials configured.
- [ ] **ENV-2** A test **customer email + phone** you control (for OTP + emails), and a Yoco **test card** for payments.
- [ ] **ENV-3** A second tenant exists (for multi-tenant isolation checks).
- [ ] **ENV-4** For WhatsApp tests, your test phone number is **added to Meta's allowed-recipients list** (or the number is Live) — otherwise all sends fail with Meta error `#131030` (known constraint, not a bug).
- [ ] **ENV-5** Operator accounts for each role: **OPERATOR**, **MAIN_ADMIN**, **SUPER_ADMIN**.

---

# PART A — GUEST / BOOKING SITE
_Customer-facing site (per-tenant subdomain, e.g. `aonyx.booking.bookingtours.co.za`)._

## A1. Tenant resolution & landing (`/`)
- [ ] **G-001** (P0) Open the tenant subdomain → the correct tenant's branding (name, colours, logo) loads; page title/OG in view-source shows the tenant name (server-rendered).
- [ ] **G-002** (P1) Open a second tenant's subdomain → different branding; no data bleed from tenant #1.
- [ ] **G-003** (P1) Header, footer, cookie banner render; theme colours match Settings.
- [ ] **G-004** (P2) Chat widget button appears; the avatar Lottie animation renders (not a blank/broken box).

## A2. Booking flow (`/book`)
- [ ] **G-010** (P0) Select a tour → available future slots load; sold-out/past slots are not selectable.
- [ ] **G-011** (P0) Pick a slot, set guest count → price updates correctly (unit price × qty).
- [ ] **G-012** (P1) Add add-ons → total updates; remove add-on → total reverts.
- [ ] **G-013** (P1) Apply a valid **promo code** → discount applied; invalid/expired code → clear error, no discount.
- [ ] **G-014** (P1) Apply a **voucher** with balance → balance deducted from amount due; over-balance handled.
- [ ] **G-015** (P0) Enter name, email, phone (required) → cannot proceed with blank/invalid email or blank phone.
- [ ] **G-016** (P1) Tick **"Booking on behalf of a company"** → Company Name + VAT Number fields appear and are saved with the booking.
- [ ] **G-017** (P0) Accept terms (required) → proceed to Yoco checkout; a PENDING/DRAFT booking is created (not PAID).
- [ ] **G-018** (P0) Complete Yoco test payment → redirected to **/success**; booking flips to **PAID**; slot capacity decremented by qty.
- [ ] **G-019** (P0) Cancel/abandon at Yoco → returned to **/cancelled**; booking stays PENDING and is later released by cron (hold expiry); capacity not double-consumed.
- [ ] **G-020** (P0) Confirmation **email** arrives, branded with tenant logo/colours, correct details, with a **PDF tax invoice attached** showing the operator's company/VAT/logo — and, if a company booking, the customer's company name + VAT in "Billed To".
- [ ] **G-021** (P1) Book the **last remaining spot**, then a second person tries same slot → the second is blocked (no overbooking).
- [ ] **G-022** (P1) Widget/embed booking (`/embed`) completes end-to-end inside an iframe.
- [ ] **G-023** (P2) Refresh mid-flow / use browser back → no duplicate bookings, no stuck state.

## A3. Combo bookings (`/combo/[id]`)
- [ ] **G-030** (P0) Start a combo (multi-operator) offer → both legs shown with combined price.
- [ ] **G-031** (P0) Pay via Paysafe test → both child bookings flip to PAID **atomically**; settlements split per tenant.
- [ ] **G-032** (P1) Combo confirmation email + both tenants see their leg in admin.
- [ ] **G-033** (P0) Failed combo payment → neither leg is marked PAID (no partial state).

## A4. Gift vouchers (`/voucher`, `/voucher-success`, `/voucher-confirmed`)
- [ ] **G-040** (P0) Buy a gift voucher → charged the **face value** (not a tampered amount); PENDING voucher created.
- [ ] **G-041** (P0) After payment → voucher becomes ACTIVE with `current_balance = value`; code emailed to buyer.
- [ ] **G-042** (P1) Redeem the voucher on a new booking → balance deducts correctly; partial balance leaves remainder.
- [ ] **G-043** (P1) Anonymous user cannot forge an ACTIVE voucher / arbitrary balance (security).

## A5. My Bookings (`/my-bookings`)
- [ ] **G-050** (P0) Request OTP with the booking email+phone → **branded** code email arrives (tenant logo/colours, not plain green).
- [ ] **G-051** (P0) Enter correct OTP → logged in and see own bookings only. Wrong OTP 5× → locked out; expired OTP rejected.
- [ ] **G-052** (P0) Rate-limit: repeated OTP requests are throttled (per-email + per-IP).
- [ ] **G-053** (P1) **Gear icon** opens Settings/Profile (does NOT log out); a separate **logout** button logs out.
- [ ] **G-054** (P1) Bookings are grouped **Upcoming / Past / Cancelled**; each shows correct tour, date, guests, amount, reference.
- [ ] **G-055** (P0) **Reschedule** (>24h): equal price = instant swap; higher = uplift payment link; lower = refund/voucher difference.
- [ ] **G-056** (P0) **Edit guests → increase**: a **"Pay R… now" link renders in the modal** (not a blocked popup); paying confirms the extra guest and updates the booking.
- [ ] **G-057** (P1) **Edit guests → decrease**: choose voucher or refund; capacity returned.
- [ ] **G-058** (P1) **Update contact details** and **special request** save and reflect back.
- [ ] **G-059** (P0) **Customer-initiated cancel**: refund amount follows the tenant's time-based policy tiers; slot released.
- [ ] **G-060** (P0) **OPERATOR-CANCELLED (weather) trip is impossible to miss** — it appears in a prominent **"Action needed"** section at the **top** of My Bookings.
- [ ] **G-061** (P0) That cancelled trip offers **all three actions**: **Pick a new date**, **Voucher (R…)**, **Refund (R…)** — and each completes successfully.
- [ ] **G-062** (P1) After choosing an action, the trip leaves "Action needed" and reflects the chosen outcome (voucher issued / refund requested / rescheduled).
- [ ] **G-063** (P2) Trip photos link appears on completed trips; countdown/waiver reminders show on upcoming ones.

## A6. Waiver (`/waiver?booking=&token=`)
- [ ] **G-070** (P0) Open waiver link from confirmation → loads the correct booking; expired/invalid token is rejected.
- [ ] **G-071** (P0) **Every participant requires a full Date of Birth** — submit is **blocked** until each guest has day+month+year.
- [ ] **G-072** (P0) **Each guest has a name field + individual "accepts liability" tick**; submit blocked until every name is filled and every tick is checked.
- [ ] **G-073** (P0) If a DOB indicates **under-18**, the parent/guardian countersignature section appears and is required.
- [ ] **G-074** (P1) On submit → waiver saved; booking `waiver_status = SIGNED`; per-guest names/DOBs/acceptances stored in the payload.
- [ ] **G-075** (P2) Re-opening a signed waiver shows a signed/thank-you state (no PII re-exposed).

## A7. Reviews (`/review/[token]`)
- [ ] **G-080** (P1) Open a review link → submit a rating + comment → recorded; duplicate/invalid token handled.
- [ ] **G-081** (P2) Submitted review appears in the operator's Reviews page as pending/approved per config.

## A8. Legal / privacy (`/terms`, `/privacy`, `/cookies`, `/popia`, `/popia/confirm`)
- [ ] **G-090** (P1) All legal pages render tenant-appropriate content; `/legal/*` redirects work.
- [ ] **G-091** (P1) POPIA data request can be submitted and confirmed via the emailed link.

---

# PART B — OPERATOR / ADMIN
_Admin dashboard (`caepweb-admin` / operator subdomain)._

## B1. Authentication & access control
- [ ] **O-001** (P0) Login with valid operator credentials → dashboard; invalid → error; 5 failed attempts / 15 min → rate-limited.
- [ ] **O-002** (P0) **Direct-URL access control**: an OPERATOR hitting `/settings`, `/billing`, `/super-admin` is rejected server-side (not just hidden nav).
- [ ] **O-003** (P0) A logged-in admin of tenant A can never see tenant B's bookings/customers/etc. (multi-tenant isolation) — spot check by switching accounts.
- [ ] **O-004** (P1) **Change password** (`/change-password`) works; old password rejected after change.
- [ ] **O-005** (P0) A **suspended / non-paying** tenant is blocked from privileged routes but can still reach `/billing` to reactivate.

## B2. Dashboard (`/`)
- [ ] **O-010** (P1) KPIs (today's bookings, revenue, upcoming) load and match reality; empty states render.
- [ ] **O-011** (P2) Quick links/nav route correctly; loading skeletons show, no console errors.

## B3. Bookings (`/bookings`, `/bookings/[id]`)
- [ ] **O-020** (P0) Booking list loads for the tenant only; filters (status, date, search) work; pagination/"load more" works past 500+.
- [ ] **O-021** (P1) **Hover a customer name** → tooltip shows the details they added (e.g. special requests / dietary); a 📝 marker flags rows with notes.
- [ ] **O-022** (P0) Open a booking detail → all fields correct; **mark-as-paid**, **check-in**, **cancel**, **refund** actions work and reflect immediately.
- [ ] **O-023** (P0) **Reports/exports never silently under-count**: a range with >2000 bookings still totals correctly (paged) or shows a truncation banner.
- [ ] **O-024** (P1) Realtime: a new booking made on the guest site appears without manual refresh.
- [ ] **O-025** (P1) Pending-reschedules queue (`/bookings/pending-reschedules`) lists and lets you approve/decline; customer notified.

## B4. New manual booking (`/new-booking`)
- [ ] **O-030** (P1) Create a manual booking: pick tour/slot/guests/customer → saved; capacity decremented; invoice number issued.
- [ ] **O-031** (P1) Manual booking can be marked paid / sent a payment link; confirmation email/WhatsApp optional.

## B5. Slots & availability (`/slots`)
- [ ] **O-040** (P0) Create single + **bulk** slots (wizard) → appear on the calendar with correct capacity.
- [ ] **O-041** (P1) Edit capacity / price override / close a slot → reflected on the booking site.
- [ ] **O-042** (P0) **Weather-cancel a slot** → all active bookings on it are CANCELLED with `refund_status = ACTION_REQUIRED`, capacity closed, customers notified — and those trips show in each customer's My Bookings "Action needed" (ties to G-060/061).
- [ ] **O-043** (P1) Bulk weather-cancel across multiple days works and notifies all.

## B6. Weather (`/weather`)
- [ ] **O-050** (P1) Weather widget/locations render for the tenant's configured locations; used to inform cancellations.

## B7. Guide app (`/guide`, `/guide/slot/[slotId]`, `/guide/photos/[slotId]`)
- [ ] **O-060** (P0) `/guide` renders **standalone** (no admin sidebar/topbar) as its own app shell; requires OPERATOR+ role.
- [ ] **O-061** (P1) **Today's Tours**: date picker works; each tour card shows time, name, pax, bookings, capacity bar, spots left.
- [ ] **O-062** (P0) **Manifest**: passenger list correct; tap **Check in** → optimistic tick + progress bar update; persists after refresh.
- [ ] **O-063** (P0) **Offline check-in**: turn off network, check someone in → queued; restore network → syncs (no double check-in; idempotent).
- [ ] **O-064** (P1) Add-on chips, dietary, waiver status, tap-to-call all display per passenger.
- [ ] **O-065** (P1) **Photos**: upload multiple photos → stored to Google Drive; gallery shows; **Send thank-you** emails every customer on the slot with the gallery link.
- [ ] **O-066** (P1) Installable as a PWA (Add to Home Screen); works from the home-screen icon.

## B8. Customers (`/customers`)
- [ ] **O-070** (P1) Customer list loads; **header stats reflect the FULL base** (paged, not capped at 500); search works.
- [ ] **O-071** (P2) Open a customer → history/bookings correct.

## B9. Inbox / chat (`/inbox`)
- [ ] **O-080** (P1) Conversations list loads (tenant-scoped); open a thread → messages render; intent badges show.
- [ ] **O-081** (P1) Reply to a WhatsApp/web-chat conversation → sends (subject to Meta 24h-window/allow-list constraints — see ENV-4).
- [ ] **O-082** (P2) Bot vs human handoff toggle works.

## B10. Invoices (`/invoices`)
- [ ] **O-090** (P1) Invoice list loads (tenant-scoped); open/download a PDF → shows operator company/VAT/**logo** and, for company bookings, customer VAT.
- [ ] **O-091** (P1) Re-send an invoice email → branded email delivered.

## B11. Refunds (`/refunds`)
- [ ] **O-100** (P0) Pending refunds list; **approve** → refund processed (Yoco/manual) and customer notified; **decline** → status DECLINED + customer emailed.
- [ ] **O-101** (P1) Batch refund flow works; split-tender refunds don't crash.

## B12. Vouchers (`/vouchers`)
- [ ] **O-110** (P1) Voucher list (tenant-scoped); create/adjust a voucher; statuses (ACTIVE/REDEEMED/EXPIRED) correct.
- [ ] **O-111** (P1) A voucher issued from a weather cancellation appears and is redeemable.

## B13. Reviews management (`/reviews`)
- [ ] **O-120** (P1) Reviews list loads **tenant-scoped only** (no cross-tenant leak); approve/hide/reply works.
- [ ] **O-121** (P2) Google reviews sync populates (daily cron) if configured.

## B14. Marketing
- [ ] **O-130** (P1) **Contacts** (`/marketing/contacts`): list/import/tag; unsubscribe flips status and excludes from sends.
- [ ] **O-131** (P1) **Templates** (`/marketing/templates`): create/edit/preview an email template.
- [ ] **O-132** (P0) **Campaigns** (`/marketing`): send a campaign to a segment → emails dispatch via the queue; **scheduled** campaign fires at the right time (not immediately, not never); open/click tracking records.
- [ ] **O-133** (P1) **Automations** (`/marketing/automations`, `/[id]`): date-triggered automation enrolls contacts and sends steps **once** (no duplicate sends on overlapping runs).
- [ ] **O-134** (P1) **Promotions** (`/marketing/promotions`): create a promo code → usable on the booking site; usage limits enforced.
- [ ] **O-135** (P1) **Broadcasts** (`/broadcasts`): send a one-off WhatsApp/email blast to PAID/CONFIRMED customers → only your tenant's customers; requires auth.

## B15. Pricing (`/pricing`)
- [ ] **O-140** (P1) Set base prices, per-slot overrides, peak-period prices → reflected in guest booking totals.

## B16. Reports (`/reports`)
- [ ] **O-150** (P0) Financials/attendance/CSV/PDF export → **revenue totals are complete** (paged to completion; truncation banner if an extreme range is hit).
- [ ] **O-151** (P1) Waiver counts, marketing, attendance tabs compute correctly; date filters work.

## B17. Settings
- [ ] **O-160** (P1) **General** (`/settings`): business name + **logo** upload → propagates to sidebar, emails, booking site, invoices.
- [ ] **O-161** (P0) **Invoice & Banking**: company name, reg number, VAT, address, bank details save → appear on invoices.
- [ ] **O-162** (P0) **Credentials** (`/settings` + `/api/credentials`): Yoco/Paysafe/WhatsApp keys save **encrypted**; only MAIN_ADMIN/SUPER_ADMIN can view/set; test-mode toggle works.
- [ ] **O-163** (P1) **Chat FAQ** (`/settings/chat-faq`): add/edit FAQ entries → used by the chatbot.
- [ ] **O-164** (P1) **OTA** (`/settings/ota`): connect Viator/GetYourGuide credentials (stored encrypted); product mappings save.
- [ ] **O-165** (P1) **WhatsApp bot mode**: toggle bot/human/off + business hours; setting persists and governs auto-replies.
- [ ] **O-166** (P1) Refund policy tiers configurable → drive customer cancel refund amounts (ties to G-059).

## B18. Billing & subscription (`/billing`)
- [ ] **O-170** (P0) View plan/seats/usage; **pause/resume/change seats** via billing routes (service-role) works; a tenant **cannot** self-elevate subscription status via direct API.
- [ ] **O-171** (P1) Invoice/usage history renders; overage figures correct.

## B19. Operators / staff (`/operators`)
- [ ] **O-180** (P1) Invite/add an operator (setup link) → they can log in with the correct role; remove operator revokes access.
- [ ] **O-181** (P1) Seat limit enforced (can't exceed purchased seats).

## B20. Notifications (`/notifications`)
- [ ] **O-190** (P1) System/booking notifications list; retry a failed notification works.

## B21. Photos (`/photos`)
- [ ] **O-200** (P2) Trip photos gallery per slot; send-to-customers flow (overlaps Guide photos).

## B22. Super-admin (`/super-admin`) — platform staff only
- [ ] **O-210** (P0) Only SUPER_ADMIN can access; **all tenants load** (paged past 1000, not just first page); no N+1 timeout at scale.
- [ ] **O-211** (P1) Create/onboard a new tenant; set seat limits / marketing rates; changes persist.

## B23. POPIA / data requests (`/privacy/data-requests`)
- [ ] **O-220** (P1) Incoming data-subject requests list; **export**, **fulfill**, **reject** actions work and are audit-logged.

---

# PART C — CROSS-CUTTING / INFRASTRUCTURE
_These underpin "works 99% of the time" and must be verified once, not per page._

## C1. Payments & webhooks
- [ ] **X-001** (P0) Yoco webhook: valid signature → booking confirmed; **invalid/missing signature → 401, zero DB writes**.
- [ ] **X-002** (P0) **Idempotency**: replay the same payment webhook → no duplicate confirmation, no double invoice, returns 200.
- [ ] **X-003** (P0) A payment webhook arriving within the **grace window** still confirms (not cancelled by hold expiry).
- [ ] **X-004** (P0) Paysafe combo settlement splits amounts correctly per tenant; PayFast ITN (if used) does MD5 + server validation round-trip and fails closed.

## C2. Holds & capacity
- [ ] **X-010** (P0) Concurrent bookings on the last seat → exactly one succeeds (atomic `create_hold_with_capacity_check`); no oversell.
- [ ] **X-011** (P1) Expired holds released by cron every 5 min; **orphan-holds count stays 0** (`expires_at < now()-1h AND released_at IS NULL`).

## C3. Emails
- [ ] **X-020** (P1) All transactional emails (confirm, invoice, payment link, reschedule, cancel, voucher, OTP, thank-you) render **branded** (tenant logo/colour/footer) and deliver.
- [ ] **X-021** (P2) Unsubscribe link works and suppresses future marketing.

## C4. WhatsApp
- [ ] **X-030** (P0) Inbound message → tenant resolved correctly (by `phone_number_id`); bot replies **when the recipient is allow-listed / number is Live** (see ENV-4). Confirm a `wa_messages` row logs SENT.
- [ ] **X-031** (P1) Out-of-24h-window sends use an approved template (or are handled), not silently lost.
- [ ] **X-032** (P0) **Known constraint:** on a test-mode WABA, sends to non-allow-listed numbers fail with `#131030`. Verify the target phone is allow-listed before judging the bot "broken".

## C5. Cron / background jobs (verify each fires and completes without timeout)
- [ ] **X-040** (P1) `cron-tasks` (holds/drafts cleanup), `marketing-dispatch`, `marketing-automation-dispatch`, `auto-messages`, OTA availability syncs, `ota-reconcile`, `fetch-google-reviews` all return 200 and process **all** tenants (no 1000-row truncation).

## C6. Security & tenancy (regression guardrails)
- [ ] **X-050** (P0) No `SECURITY DEFINER` payment/secret RPC is anon-executable (`confirm_combo_payment_atomic`, `get_business_credentials`, etc. are service_role only).
- [ ] **X-051** (P0) `bookings` anon insert cannot create a `PAID` booking; `combo_bookings` not world-readable; `subscriptions` not tenant-self-writable.
- [ ] **X-052** (P1) `npm run check-security-drift` exits 0; Supabase security advisors show no new ERROR-level issues.
- [ ] **X-053** (P1) `/api/img` rejects non-allowlisted hosts (no SSRF); image proxy blocks `file://`/traversal.

## C7. Reliability / UX polish
- [ ] **X-060** (P1) No uncaught console errors on any page (spot-check the 10 busiest).
- [ ] **X-061** (P1) Every list page has a loading skeleton and a friendly empty state.
- [ ] **X-062** (P2) Mobile layouts don't horizontally scroll; tap targets are adequate.

---

# Sign-off

| Gate | Target | Actual | Pass? |
|---|---|---|---|
| P0 tests passing | 100% | | |
| P1 tests passing | ≥95% | | |
| Open money/security defects | 0 | | |
| Guest happy-path (A2→A5→A6) end-to-end | pass | | |
| Operator happy-path (O-001→O-042→O-060) end-to-end | pass | | |

**MVP verdict:** ☐ Ready  ☐ Not ready (see defects)

## Defects found
| ID | Test | Severity | Description | Status |
|---|---|---|---|---|
| | | | | |

---
_Coverage note: this plan maps to every route under `/app` (operator) and `/booking/app` (guest) as of 2026-07-05, plus the payment/webhook/cron/security layers. Routes intentionally excluded from MVP acceptance: internal debug (`/api/debug/sentry-test`), marketing/SEO pages (`/case-study/*`, `/compare/*`), and OAuth callbacks (`/google-callback`, `/auth/callback`) which are exercised implicitly by the OTA/Drive and magic-link tests._
