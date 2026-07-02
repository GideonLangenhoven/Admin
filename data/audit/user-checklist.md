# Cape Kayak — User-Supplied Production Readiness Checklist (audit source of truth)

Audit each case against the ACTUAL code. IDs below are authoritative for this audit.

### SECTION A: ADMIN AUTHENTICATION & ONBOARDING
- A1 — Admin login. Steps: dashboard URL → email + password. Expected: Dashboard loads, sidebar visible.
- A2 — Wrong password (5x). Steps: wrong password 5 times. Expected: Locked out for 30 min, unlock email sent.
- A3 — Forgot password. Steps: "Forgot Password" → enter admin email. Expected: Reset email received, link works.
- A4 — Password reset. Steps: reset link → set new password → log in. Expected: Login succeeds with new password.
- A5 — Invite new admin. Steps: Settings → Admin Users → Add admin (name + email). Expected: Admin receives welcome email with setup link.
- A6 — New admin first login. Steps: welcome email → setup link → set password. Expected: Account activated, can access dashboard.
- A7 — Role permissions. Steps: log in as ADMIN (not MAIN_ADMIN) → try Settings. Expected: Settings page hidden/restricted.
- A8 — Suspended subscription. Steps: set subscription_status=SUSPENDED → reload dashboard. Expected: Access blocked, "subscription suspended" shown.

### SECTION B: TOUR & SLOT SETUP
- B1 — Create tour. Steps: Settings → Tours → Add tour (name, price, duration, image). Expected: Tour appears in list and on booking site.
- B2 — Edit tour. Steps: tour → change price → Save. Expected: Price updated on tour and new slots.
- B3 — Archive / hide tour. Steps: Settings → Tours → toggle "Hidden". Expected: Tour hidden from booking site, existing bookings unaffected.
- B4 — Set what-to-bring/wear. Steps: edit what_to_bring / what_to_wear fields. Expected: Shown on success page and confirmation email.
- B5 — Generate slots. Steps: Slots → Add Slots → date range, tour, time, days, capacity. Expected: Slots appear on calendar.
- B6 — View week calendar. Steps: Slots → Week View. Expected: 7-day grid with slots, occupancy bars.
- B7 — Edit single slot. Steps: slot → change capacity or price → Save. Expected: Slot updated, calendar refreshes.
- B8 — Bulk edit slots. Steps: select date range → change capacity for all. Expected: All matching slots updated.
- B9 — Close slot manually. Steps: slot → status CLOSED. Expected: Slot greyed out, not bookable.
- B10 — Reopen closed slot. Steps: closed slot → Reopen. Expected: Slot returns to OPEN.
- B11 — Custom fields. Steps: Settings → Custom Fields → add field (text/number). Expected: Field appears in admin new-booking form.

### SECTION C: CUSTOMER BOOKING FLOW (Direct — Booking Site)
- C1 — View tour listing. Steps: booking site home. Expected: All non-hidden tours shown with name, price, duration, image.
- C2 — Select tour & date. Steps: tour → calendar (green dots). Expected: Available dates highlighted, unavailable greyed.
- C3 — Select time slot. Steps: available date → time slots with capacity. Expected: Slots list with remaining spots visible.
- C4 — Select guests & add-ons. Steps: pick qty → optional add-ons. Expected: Price summary updates: base + add-ons = grand total.
- C5 — Enter customer details. Steps: name, email, phone. Expected: Fields validated, phone auto-normalized.
- C6 — Apply promo code. Steps: enter promo → Apply. Expected: Discount line in blue, total reduced.
- C7 — Apply voucher code. Steps: enter voucher → Apply. Expected: Voucher credit deducted from total.
- C8 — Marketing opt-in. Steps: check/uncheck consent. Expected: Consent saved on booking record.
- C9 — Pay via Yoco. Steps: Pay → Yoco checkout → complete. Expected: Redirected to /success.
- C10 — Full voucher coverage. Steps: voucher covering 100% → Confirm. Expected: Booking auto-confirmed, no Yoco redirect.
- C11 — Success page. Steps: view /success. Expected: Booking summary, calendar add links, meeting point, what-to-bring.
- C12 — Waiver CTA on success. Steps: /success, waiver not signed. Expected: "Sign Waiver Now" button visible.
- C13 — Confirmation email. Expected: BOOKING_CONFIRM email with ref, details, waiver link, PDF invoice.
- C14 — Confirmation WhatsApp. Expected: Booking confirmed message with ref, details, invoice #.
- C15 — Booking in dashboard. Steps: admin → Bookings. Expected: Booking appears, status PAID.

### SECTION D: CUSTOMER BOOKING FLOW (Web Chat)
- D1 — Open chat widget. Steps: booking site → chat bubble. Expected: Chat opens, greeting appears.
- D2 — Ask general question. Steps: "what tours do you offer?". Expected: AI responds with tour list and pricing.
- D3 — Start booking via chat. Steps: "I want to book" → prompts. Expected: Bot walks tour → date → time → guests → payment link.
- D4 — Complete chat booking. Steps: payment link → pay via Yoco. Expected: Redirect to success page, booking confirmed.

### SECTION E: MANUAL / ADMIN BOOKING
- E1 — Create manual booking. Steps: New Booking → tour, slot, customer, qty. Expected: Booking created, status PENDING.
- E2 — Apply discount (admin). Steps: set discount (percent or flat). Expected: Discounted total shown, saved on booking.
- E3 — Apply voucher (admin). Steps: enter voucher code. Expected: Voucher balance deducted, remainder shown.
- E4 — Generate payment link. Steps: booking → Send Payment Link. Expected: Customer receives email with payment link.
- E5 — Customer pays link. Steps: open link → pay. Expected: Status → PAID, confirmation sent.
- E6 — Mark paid (cash/EFT). Steps: PENDING → Mark as Paid → method. Expected: Status → PAID, invoice created, confirmation email + WhatsApp sent.
- E7 — Edit booking details. Steps: change name/phone/email/qty. Expected: Saved, customer gets BOOKING_UPDATED email.
- E8 — Reduce guests. Steps: decrease qty. Expected: Guest reduction email sent, slot capacity freed.
- E9 — Check-in guests. Steps: today's bookings → Check In. Expected: Booking checked_in, attendance updated.

### SECTION F: WAIVER / INDEMNITY
- F1 — Waiver link in confirm email. Expected: Waiver link visible (if waiver pending).
- F2 — Open waiver form. Steps: click waiver link. Expected: Form loads with booking details, full indemnity text.
- F3 — Sign waiver (adult). Steps: name, optional ID, consent boxes → Submit. Expected: "Waiver signed" confirmation.
- F4 — Sign waiver (minor). Steps: DOB under 18 → guardian fields appear → sign. Expected: Guardian name/ID captured, waiver signed.
- F5 — Waiver status in dashboard. Steps: booking detail. Expected: Waiver status SIGNED with timestamp.
- F6 — Auto waiver reminder. Steps: unsigned waiver for tomorrow → cron. Expected: INDEMNITY email sent automatically.
- F7 — Waiver notice in checkout. Steps: /book details step. Expected: Amber info box "All participants must sign a waiver before the trip".
- F8 — Waiver CTA on success page. Steps: paid booking → /success. Expected: "Sign Waiver Now" if pending; green "Completed" badge if signed.

### SECTION G: PAYMENT FLOWS
- G1 — Yoco checkout. Expected: Webhook fires, booking → PAID.
- G2 — Payment success redirect. Expected: Customer sees success page, confirm-booking fallback fires.
- G3 — Payment cancel. Steps: cancel on Yoco. Expected: Redirect to /cancelled, booking stays HELD/PENDING.
- G4 — Voucher at checkout. Expected: Amount reduced, checkout for remainder.
- G5 — Full voucher coverage. Expected: No Yoco redirect, booking auto-confirmed.
- G6 — Promo code (percent). Expected: Discount line in summary, total reduced.
- G7 — Promo code (flat). Expected: Flat discount deducted from total.
- G8 — Promo + voucher combined. Steps: promo first, then voucher. Expected: Promo discount first, voucher drains remainder.
- G9 — Remove promo at checkout. Expected: Promo cleared, prices revert.
- G10 — Server-side price verification. Steps: tamper with client total (dev tools). Expected: create-checkout rejects mismatched amount.

### SECTION H: GIFT VOUCHERS
- H1 — Create voucher (admin). Steps: Vouchers → Create → type, amount, recipient. Expected: Voucher created with CK-XXXX code.
- H2 — Purchase voucher (customer). Steps: /voucher → select tour → pay. Expected: Recipient gets GIFT_VOUCHER email with code.
- H3 — Redeem voucher. Steps: book → enter voucher code at checkout. Expected: Balance deducted from total.
- H4 — Partial redemption. Steps: R600 voucher on R400 tour. Expected: R200 balance remains, VOUCHER_BALANCE email sent.
- H5 — Voucher from cancellation. Steps: cancel paid booking → voucher refund. Expected: New voucher created, VOUCHER email sent.
- H6 — Expired voucher blocked. Expected: Error "Voucher expired".
- H7 — Abandoned voucher cleanup. Steps: start voucher purchase → don't pay → wait 24h. Expected: PENDING voucher auto-deleted by cron.

### SECTION I: CUSTOMER SELF-SERVICE (My Bookings)
- I1 — OTP login. Steps: /my-bookings → email + phone → request OTP. Expected: OTP email with 6-digit code.
- I2 — Verify OTP. Steps: enter OTP. Expected: Authenticated, all bookings for email shown.
- I3 — View bookings. Expected: List with status, tour, date, actions.
- I4 — Reschedule booking. Steps: Reschedule → pick new slot. Expected: Booking moved (or upgrade payment link generated).
- I5 — Cancel booking. Steps: Cancel → confirm. Expected: Booking cancelled, refund options shown.
- I6 — OTP rate limiting. Steps: request OTP 4+ times in 10 min. Expected: Rate limited, error shown.

### SECTION J: AUTO-MESSAGES (Cron-Triggered)
- J1 — Day-before reminder. Steps: PAID booking for tomorrow → cron. Expected: WhatsApp reminder for tomorrow, tour, time, arrive 15 min early.
- J2 — Waiver reminder email. Steps: unsigned waiver for tomorrow → cron. Expected: INDEMNITY email sent automatically.
- J3 — Review request. Steps: tour completed → wait 2-6h. Expected: WhatsApp "thanks for joining, review link".
- J4 — Booking → COMPLETED. Steps: after review request sends. Expected: Booking status auto-updates to COMPLETED.
- J5 — Hold expiry. Steps: booking with hold → don't pay → wait 20 min. Expected: Hold expires, capacity released, WhatsApp "hold expired".
- J6 — Payment deadline expiry. Steps: admin booking with deadline → pass it. Expected: Auto-cancelled, capacity freed, admin notified via WhatsApp.
- J7 — Re-engagement. Steps: customer with 90+ day old booking, no activity. Expected: WhatsApp "it's been a while, welcome back".
- J8 — Human chat timeout. Steps: conversation HUMAN > 48h. Expected: Auto-reverts to IDLE.
- J9 — Abandoned cart recovery. Steps: enter email on /book → abandon → wait 30+ min. Expected: ABANDONED_CART email with "Complete My Booking" link.
- J10 — Stale draft cleanup. Steps: abandon draft → wait 24+ h. Expected: Draft auto-cancelled, no lingering DRAFT records.
- J11 — Abandoned voucher cleanup. Steps: start voucher purchase → don't pay → wait 24h. Expected: PENDING voucher deleted by cron.

### SECTION K: CANCELLATION & REFUND FLOWS
- K1 — Admin cancel booking. Expected: Status CANCELLED, customer gets CANCELLATION email + WhatsApp.
- K2 — Refund appears in queue. Expected: Refund in queue on Refunds page with correct amount.
- K3 — Process Yoco refund. Steps: Refunds → Refund on Yoco-paid booking. Expected: Yoco API called, refund processed, status REFUNDED.
- K4 — Manual refund (EFT). Steps: refund on EFT-paid booking. Expected: Marked MANUAL_EFT_REQUIRED, admin does bank transfer.
- K5 — Decline refund. Steps: Decline with reason. Expected: Status DECLINED, customer notified.
- K6 — Batch refund. Steps: Refunds → Refund All. Expected: All pending refunds processed sequentially.
- K7 — Voucher-paid cancel. Expected: New voucher issued for full amount (no card refund).

### SECTION L: WEATHER CANCELLATION
- L1 — Cancel slot (weather). Steps: Weather → slot → Cancel → reason. Expected: Slot CLOSED.
- L2 — Paid bookings cancelled. Expected: All PAID bookings → CANCELLED, refund_status ACTION_REQUIRED.
- L3 — Customer notifications. Expected: CANCELLATION email with weather flag; WhatsApp with options.
- L4 — Self-service options. Steps: customer opens My Bookings link. Expected: Can choose Reschedule / Voucher / Refund.
- L5 — Bulk weather cancel. Steps: cancel multiple slots. Expected: All affected bookings cancelled, all customers notified.
- L6 — Reopen after weather. Steps: next day clear → Reopen Day. Expected: Slots back to OPEN, available for booking.

### SECTION M: RESCHEDULE / REBOOK
- M1 — Reschedule (same price). Expected: Booking moved instantly, confirmation sent.
- M2 — Reschedule (upgrade). Expected: Payment link for price difference sent to customer.
- M3 — Pay upgrade. Steps: customer pays difference via Yoco. Expected: Booking moved to new slot, confirmation sent.
- M4 — Reschedule (downgrade). Expected: Voucher created for difference, sent to customer.
- M5 — Reschedule hold expiry. Steps: start reschedule → don't pay → wait 15 min. Expected: New slot hold released, original booking unchanged.

### SECTION N: WHATSAPP & INBOX
- N1 — Customer messages in. Expected: Appears in Inbox, AI bot responds.
- N2 — AI FAQ response. Steps: "how much is a tour?". Expected: Bot answers with pricing from tour data.
- N3 — Book via WhatsApp. Steps: "I want to book" → prompts. Expected: Bot walks tour → date → time → guests → payment link.
- N4 — Escalate to human. Steps: "speak to a person". Expected: Bot handoff message, conversation → HUMAN.
- N5 — Admin replies. Steps: Inbox → conversation → reply → Send. Expected: Customer receives admin reply on WhatsApp.
- N6 — Return to bot. Steps: "Return to Bot". Expected: Conversation → IDLE, bot resumes.
- N7 — 24-hour window. Steps: send after 24h without inbound. Expected: Template message used (24h-compliant).
- N8 — Unread badge. Expected: Inbox nav shows unread count badge.

### SECTION O: BROADCASTS
- O1 — Select slot & compose. Expected: Recipients list populated from bookings on those slots.
- O2 — Send broadcast. Expected: All selected customers receive WhatsApp/email.
- O3 — Weather cancel mode. Steps: Weather Cancel → slots → reason. Expected: Slots closed, bookings cancelled, notifications sent.

### SECTION P: PHOTOS
- P1 — Upload trip photos. Steps: Photos → past trip → paste photo URLs. Expected: URLs saved.
- P2 — Send to customers. Steps: Send Photos. Expected: All lead bookers on that slot get email + WhatsApp.
- P3 — Customer receives photos. Expected: TRIP_PHOTOS email with gallery link + review CTA.

### SECTION Q: INVOICES
- Q1 — Auto-generated invoice. Expected: Invoice auto-created with sequential number.
- Q2 — Invoice has VAT. Expected: 15% VAT breakdown shown correctly.
- Q3 — View invoice list. Steps: Invoices → filter by date. Expected: Invoices grouped by date with totals.
- Q4 — Resend invoice. Steps: Bookings → Resend Invoice. Expected: INVOICE email sent with PDF attachment.
- Q5 — Invoice in booking detail. Expected: Invoice number, payment method, amounts shown.

### SECTION R: DASHBOARD & CHECK-IN
- R1 — Daily manifest. Expected: Today's bookings grouped by slot, pax counts, check-in status.
- R2 — Check in guest. Expected: Marked checked in, count updates.
- R3 — Revenue stats. Expected: Revenue summary (today / this week / this month).
- R4 — Trip calendar. Expected: Monthly view with pax counts per date.
- R5 — Weather widget. Expected: Windguru wind/swell data loads for configured spots.

### SECTION S: REPORTS
- S1 — Bookings report. Expected: Table of bookings with status, sortable.
- S2 — Financial report. Expected: Revenue breakdown by status (paid/pending/cancelled).
- S3 — Marketing attribution. Expected: Source breakdown (ADMIN, WEB_CHAT, WA_WEBHOOK, EXTERNAL).
- S4 — Attendance report. Expected: Checked-in vs not, pax counts.
- S5 — Waiver report. Expected: Signed vs pending counts.
- S6 — Date filter. Expected: Data filters correctly.
- S7 — CSV export. Expected: Correct data downloaded.

### SECTION T: PEAK PRICING
- T1 — Create peak period. Steps: date range, label, priority. Expected: Period created.
- T2 — Set peak prices. Steps: peak_price_per_person per tour. Expected: Prices saved.
- T3 — Apply to slots. Expected: Matching slots updated to peak pricing.
- T4 — Customer sees peak price. Expected: Checkout shows peak price, not base.
- T5 — Overlap resolution. Steps: overlapping periods with different priorities. Expected: Higher priority wins.

### SECTION U: MARKETING MODULE
- U1 — Marketing overview. Expected: Contact count, campaign stats, email usage vs quota.
- U2 — Add contact. Expected: Contact appears in list.
- U3 — Import contacts (CSV). Expected: Contacts imported with correct fields + tags.
- U4 — Tag management. Expected: Tags saved, filterable.
- U5 — Clean list. Expected: Stale/bounced contacts marked inactive.
- U6 — Create template. Steps: New → starter → drag-drop builder. Expected: Template saved with blocks.
- U7 — Send test email. Expected: Test email received at admin inbox.
- U8 — Send campaign. Steps: filter audience → Send. Expected: Campaign queued, emails delivered.
- U9 — Schedule campaign. Expected: Campaign "Scheduled", fires at set time.
- U10 — Track opens. Expected: Open tracked in campaign analytics.
- U11 — Track clicks. Expected: Click tracked, redirected to destination.
- U12 — Unsubscribe. Expected: Contact → unsubscribed, confirmation page shown.
- U13 — Create automation. Steps: Browse Templates → use template. Expected: Automation created in draft with steps.
- U14 — Activate automation. Expected: Status active.
- U15 — Automation: contact trigger. Steps: add new contact (Welcome Series). Expected: Contact enrolled, first email sends.
- U16 — Automation: post-booking. Expected: Enrolled in post-booking automation, emails fire on schedule.
- U17 — Automation: birthday. Steps: contact with DOB today. Expected: Birthday email sent automatically.
- U18 — Automation: generate voucher. Expected: Unique voucher per contact, {voucher_code} replaced in email.
- U19 — Automation: generate promo. Expected: Unique promo code created, {promo_code} replaced in email.

### SECTION V: PROMO CODE MANAGEMENT (Admin)
- V1 — Create promo code. Steps: code, type, value, dates, max uses. Expected: Promo in table with badge and status.
- V2 — Edit promo code. Expected: Updated value shown in table.
- V3 — Toggle active/inactive. Expected: Status flips (Active ↔ Paused).
- V4 — Auto-generate code. Expected: Random code populated (e.g. "PROMO-A8F2K1").
- V5 — Copy & delete promo. Expected: Code copied; promo removed from table.
- V6 — Promo usage tracking. Expected: "Uses" column shows used / max (e.g. "3 / 100").

### SECTION W: SETTINGS & BRANDING
- W1 — Update business name. Expected: Name updated across dashboard and emails.
- W2 — Update brand colors. Expected: Dashboard and emails reflect new colors.
- W3 — Update logo. Expected: Logo appears in header and emails.
- W4 — Configure WhatsApp. Steps: token + phone ID. Expected: Status Connected.
- W5 — Configure Yoco. Steps: secret + webhook key. Expected: Status Connected.
- W6 — Update booking URLs. Expected: Payment redirects go to correct URLs.
- W7 — Edit legal docs. Steps: Terms/Privacy/Cookies → edit → Save. Expected: Updated text on booking site legal pages.
- W8 — Customize directions. Expected: Shown in confirmation email and success page.
- W9 — Edit chatbot avatar. Expected: New avatar shown in web chat widget.
- W10 — Resources setup. Steps: add equipment (kayaks, paddles). Expected: Resources linked to tours with units-per-guest.

### SECTION X: BILLING & SUBSCRIPTION
- X1 — View plan. Expected: Current plan name, features, seat limit shown.
- X2 — Seat tracking. Expected: Correct count of active admins.
- X3 — Email usage. Expected: Matches actual emails sent.
- X4 — Overage invoice. Steps: exceed email limit → cron. Expected: Overage invoice auto-generated with correct amount.

### SECTION Y: EXTERNAL / B2B INTEGRATION
- Y1 — Check availability. Steps: /external-booking with check_availability. Expected: Returns available slots with capacity.
- Y2 — Create external booking. Steps: create_booking + external_ref. Expected: Booking created with source EXTERNAL.
- Y3 — Modify external booking. Steps: modify_booking. Expected: Booking updated.
- Y4 — Cancel external booking. Steps: cancel_booking. Expected: Booking cancelled.
- Y5 — Duplicate prevention. Steps: create_booking with same external_ref. Expected: Returns existing booking (idempotent).
- Y6 — Invalid API key. Steps: wrong HMAC signature. Expected: 401 Unauthorized.

### SECTION Z: SUPER ADMIN (Multi-Tenant)
- Z1 — Onboard new business. Steps: Super Admin → form → Submit. Expected: Business + admin + default tours created, welcome email sent.
- Z2 — Switch tenant. Steps: operator selector → different business. Expected: Dashboard shows that business's data only.
- Z3 — Monitor email usage. Steps: Super Admin → Marketing Usage. Expected: All tenants listed with email counts.
- Z4 — RLS data isolation. Steps: as Tenant A → query Tenant B data. Expected: No cross-tenant data visible.

### SECTION AA: EDGE CASES & RESILIENCE
- AA1 — Double payment webhook. Steps: trigger Yoco webhook twice for same booking. Expected: Second ignored (idempotent), no duplicate email.
- AA2 — Overbooked slot. Steps: book when capacity=0. Expected: Error "No availability".
- AA3 — Expired voucher. Expected: Error "Voucher expired".
- AA4 — Invalid phone format. Steps: enter "0821234567". Expected: Auto-normalized to "+27821234567".
- AA5 — Cancel already-cancelled. Expected: No action, status unchanged.
- AA6 — Refund already-refunded. Expected: Prevented, error shown.
- AA7 — Slot in the past. Expected: Rejected (60-min cutoff).
- AA8 — Multiple tabs (admin). Expected: Both work independently, real-time sync.
- AA9 — Duplicate promo use. Steps: same promo + same email twice. Expected: Error "You have already used this promo code".
- AA10 — Expired promo code. Steps: promo past valid_until. Expected: Error "This promo code has expired".
- AA11 — Exhausted promo code. Steps: promo at max_uses. Expected: Error "This promo code is no longer available".
- AA12 — Promo min order not met. Steps: min_order > cart total. Expected: Error "Minimum order of R___ required".
- AA13 — Draft on email blur. Steps: name + email on /book → leave page. Expected: DRAFT booking row in DB (best-effort, no capacity held).
- AA14 — Concurrent hold race. Steps: two customers book last spot simultaneously. Expected: Atomic hold creation prevents double-booking.
- AA15 — Concurrent voucher drain. Steps: two customers apply same voucher simultaneously. Expected: Atomic deduction prevents over-spending.
- AA16 — Mobile responsive (admin). Expected: Mobile menu drawer works, all pages usable.
- AA17 — Mobile responsive (booking). Expected: Full flow works on small screen.

### SECTION AB: END-TO-END SMOKE TESTS
- AB1 — Full lifecycle: online booking. Customer books → pays → confirmation email + WA → signs waiver → admin sees booking → day-before reminder → admin checks in → review request → COMPLETED. Expected: All steps succeed end-to-end.
- AB2 — Full lifecycle: admin booking. Admin creates → payment link → customer pays → confirmation → invoice → admin cancels → refund processed. Expected: All steps succeed end-to-end.
- AB3 — Full lifecycle: weather cancel. Create slots → customers book → weather bad → weather-cancel slots → all notified → refunds → next day reopen. Expected: All steps succeed end-to-end.
- AB4 — Full lifecycle: voucher. Buy gift voucher → recipient email → redeem on new booking → partial balance remains → balance email. Expected: All steps succeed end-to-end.
- AB5 — Full lifecycle: marketing. Import contacts → create template → send campaign → opens tracked → clicks tracked → unsubscribe → automation enrolls post-booking contacts. Expected: All steps succeed end-to-end.
- AB6 — Full lifecycle: new tenant. Super admin onboards business → admin logs in → configures WA + Yoco → creates tours + slots → first customer books. Expected: All steps succeed end-to-end.
