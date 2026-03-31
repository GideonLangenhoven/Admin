# Cape Kayak — Production Readiness Test Cases


> **133 test cases across 23 sections.**
> Work through in order: A-D (core flows), E-K (lifecycle), L-W (supporting features & edge cases).
> When all pass, the app is production-ready.


---


## SECTION A: ADMIN AUTHENTICATION & ONBOARDING


| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| A1 | Admin login | Go to dashboard URL → enter email + password | Dashboard loads, sidebar visible | ✅ |
| A2 | Wrong password (5x) | Enter wrong password 5 times | Unlock email sent, not hard locked | ✅ |
| A3 | Forgot password | Click "Forgot Password" → enter admin email | Reset email received, link works | ✅ |
| A4 | Password reset | Click reset link → set new password → log in | Login succeeds with new password | ✅ |
| A5 | Invite new admin | Settings → Admin Users → Add admin (name + email) | Admin receives welcome email with temp password | ☐ |
| A6 | New admin first login | Open welcome email → click setup link → set password | Account activated, can access dashboard | ☐ |
| A7 | Role permissions | Log in as ADMIN (not MAIN_ADMIN) → try Settings | Settings page hidden/restricted | ☐ |


---


## SECTION B: TOUR & SLOT SETUP


| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| B1 | Create tour | Settings → Tours → Add tour (name, price, duration) | Tour appears in list | ✅ |
| B2 | Edit tour | Click tour → change price → Save | Price updated | ✅ |
| B3 | Generate slots | Slots page → Add Slots → pick date range, tour, time, days, capacity | Slots appear on calendar | ✅ |
| B4 | View week calendar | Slots page → Week View | 7-day grid with slots, occupancy bars | ✅ |
| B5 | Edit single slot | Click slot → change capacity or price → Save | Slot updated, calendar refreshes | ✅ |
| B6 | Bulk edit slots | Select date range → change capacity for all | All matching slots updated | ✅ |
| B7 | Close slot manually | Click slot → set status to CLOSED | Slot greyed out, no longer bookable | ✅ |
| B8 | Reopen closed slot | Click closed slot → Reopen | Slot returns to OPEN | ✅ |


---


## SECTION C: CUSTOMER BOOKING FLOW (Web Chat)


| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| C1 | Open chat widget | Go to your booking site → click chat bubble | Chat opens, greeting message appears | ✅ |
| C2 | Ask general question | Type "what tours do you offer?" | AI responds with tour list and pricing | ✅ |
| C3 | Start booking | Select a tour from options | Chat asks "How many guests?" | ✅ |
| C4 | Select guests | Enter number of guests | Chat shows date picker / asks for date | ✅ |
| C5 | Select date | Pick an available date | Chat shows available time slots | ✅ |
| C6 | Select time slot | Pick a slot | Chat shows booking summary with total | ☐ |
| C7 | Enter customer details | Provide name, email, phone | Chat generates payment link | ☐ |
| C8 | Complete payment | Click payment link → pay via Yoco | Redirect to success page | ☐ |
| C9 | Confirmation email | Check customer email inbox | BOOKING_CONFIRM email with ref #, tour, date, time, guests, waiver link | ☐ |
| C10 | Confirmation WhatsApp | Check customer WhatsApp | Booking confirmed message with ref, details, invoice # | ☐ |
| C11 | Invoice in email | Open confirmation email | Tax invoice PDF attached (or link) | ☐ |
| C12 | Booking in dashboard | Admin dashboard → Bookings → check today/upcoming | Booking appears with correct details, status: PAID | ☐ |


---


## SECTION D: MANUAL / ADMIN BOOKING


| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| D1 | Create manual booking | New Booking → select tour, slot, enter customer details, qty | Booking created, status: PENDING | ✅ |
| D2 | Generate payment link | On the booking → Send Payment Link | Customer receives email with payment link | ✅ |
| D3 | Customer pays link | Open payment link email → pay | Status changes to PAID, confirmation sent | ✅ |
| D4 | Mark paid manually | On a PENDING booking → Mark as Paid | Status → PAID, confirmation email + WhatsApp sent | ✅ |
| D5 | Edit booking | Click booking → change customer name/phone/qty | Changes saved, customer gets BOOKING_UPDATED email | ✅ |
| D6 | Reduce guests | Edit booking → decrease qty | Guest reduction email sent, slot capacity freed | ✅ |


---


## SECTION E: WAIVER / INDEMNITY


| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| E1 | Waiver link in confirm email | Open booking confirmation email | Waiver link visible (if waiver pending) | ✅ |
| E2 | Open waiver form | Click waiver link | Form loads with booking details, full indemnity text | ✅ |
| E3 | Sign waiver | Fill name, optional ID, check consent boxes → Submit | "Waiver signed" confirmation shown | ✅ |
| E4 | Waiver status in dashboard | Admin → Booking detail | Waiver status: SIGNED with timestamp | ✅ |
| E5 | Auto waiver reminder | Don't sign waiver → wait for day-before cron | INDEMNITY email sent automatically | ✅ |
| E6 | Waiver notice in checkout | /book page → reach details step | Amber info box: "All participants must sign a waiver before the trip" | ☐ |
| E7 | Waiver CTA on success page | Complete a paid booking → view /success page | "Sign Waiver Now" button visible if waiver pending; green "Completed" badge if already signed | ☐ |


---


## SECTION F: PAYMENT FLOWS


| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| F1 | Yoco checkout | Customer pays via Yoco on booking site | Webhook fires, booking → PAID | ✅ |
| F2 | Payment success redirect | After Yoco payment | Customer sees success page, confirm-booking fallback fires | ✅ |
| F3 | Payment cancel | Customer clicks cancel on Yoco page | Customer redirected to cancel URL, booking stays PENDING | ✅ |
| F4 | Voucher at checkout | Apply voucher code during checkout | Amount reduced, checkout for remainder | ✅ |
| F5 | Full voucher coverage | Apply voucher that covers full amount | No Yoco redirect needed, booking auto-confirmed | ✅ |
| F6 | Promo code (percent) | Enter a PERCENT promo code (e.g. "SUMMER20") at checkout | Discount line shows "−R___" in blue in summary, total reduced | ☐ |
| F7 | Promo code (flat) | Enter a FLAT promo code (e.g. "LOCALS") at checkout | Flat discount deducted from total | ☐ |
| F8 | Promo + voucher combined | Apply promo code first, then apply voucher code | Promo discount applied to grand total first, voucher credit drains the remainder | ☐ |
| F9 | Remove promo at checkout | Apply promo → click Remove | Promo cleared, prices revert to original total | ☐ |


---


## SECTION G: GIFT VOUCHERS


| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| G1 | Create voucher (admin) | Vouchers → Create → fill type, amount, recipient | Voucher created with CK-XXXX code | ☐ |
| G2 | Purchase voucher (customer) | Chat → "gift voucher" → select tour → pay | Recipient gets GIFT_VOUCHER email with code | ☐ |
| G3 | Redeem voucher | Book a tour → enter voucher code at checkout | Balance deducted from total | ☐ |
| G4 | Check voucher balance | Admin sends VOUCHER_BALANCE email | Customer sees remaining balance | ☐ |
| G5 | Partial redemption | Use voucher worth R600 on R400 tour | R200 balance remains, VOUCHER_BALANCE email sent | ☐ |
| G6 | Voucher from cancellation | Cancel a paid booking → choose voucher refund | New voucher created, VOUCHER email sent to customer | ☐ |


---


## SECTION H: AUTO-MESSAGES (Cron-Triggered)


| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| H1 | Day-before reminder | Have a PAID booking for tomorrow → wait for cron | WhatsApp: "reminder for tomorrow, [tour], [time], arrive 15 min early" | ☐ |
| H2 | Waiver reminder email | Have unsigned waiver for tomorrow's booking | INDEMNITY email sent automatically | ☐ |
| H3 | Review request | Complete a tour → wait 2-6 hours | WhatsApp: "thanks for joining, review link" | ☐ |
| H4 | Booking status → COMPLETED | After review request sends | Booking status auto-updates to COMPLETED | ☐ |
| H5 | Hold expiry | Create booking with hold → don't pay → wait 15-20 min | Hold expires, capacity released, WhatsApp: "hold expired" | ☐ |
| H6 | Payment deadline expiry | Create admin booking with deadline → let it pass | Auto-cancelled, email + WhatsApp sent | ☐ |
| H7 | Re-engagement | Customer with 90+ day old booking, no recent activity | WhatsApp: "it's been a while, welcome back" | ☐ |
| H8 | Human chat timeout | Conversation stuck in HUMAN state > 48h | Auto-reverts to IDLE | ☐ |
| H9 | Abandoned cart recovery | Enter email on /book → abandon without paying → wait 30+ min | ABANDONED_CART email: "Looks like you didn't finish booking" with "Complete My Booking" link | ☐ |
| H10 | Stale draft cleanup | Abandon a draft booking → wait 24+ hours | Draft auto-cancelled (CANCELLED with reason "abandoned draft"), no lingering DRAFT records | ☐ |


---


## SECTION I: CANCELLATION & REFUND FLOWS


| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| I1 | Admin cancel booking | Bookings → select booking → Cancel | Status: CANCELLED, customer gets email + WhatsApp | ☐ |
| I2 | Refund request | Refunds page → pending refund appears | Refund in queue with amount | ☐ |
| I3 | Process Yoco refund | Click "Refund" on a Yoco-paid booking | Yoco API called, refund processed, status updated | ☐ |
| I4 | Manual refund (EFT) | Process refund on EFT-paid booking | Marked MANUAL_EFT_REQUIRED, admin does bank transfer | ☐ |
| I5 | Decline refund | Click "Decline" with reason | Status: DECLINED, customer notified | ☐ |
| I6 | Batch refund | Refunds page → "Refund All" | All pending refunds processed sequentially | ☐ |
| I7 | Voucher-paid cancel | Cancel a voucher-paid booking | New voucher issued for full amount (no card refund) | ☐ |


---


## SECTION J: WEATHER CANCELLATION


| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| J1 | Cancel slot (weather) | Weather page → select slot → Cancel → enter reason | Slot: CLOSED | ☐ |
| J2 | Paid bookings cancelled | Bookings on that slot | All PAID/CONFIRMED bookings → CANCELLED, refund_status: ACTION_REQUIRED | ☐ |
| J3 | Customer notifications | Check customer email + WhatsApp | Email: CANCELLATION with weather flag. WhatsApp: compensation options | ☐ |
| J4 | Self-service options | Customer opens My Bookings link | Can choose: Reschedule / Voucher / Refund | ☐ |
| J5 | Bulk weather cancel | Cancel multiple slots for a stormy day | All affected bookings cancelled, all customers notified | ☐ |
| J6 | Reopen after weather | Next day is clear → Reopen Day | Slots back to OPEN, available for booking | ☐ |


---


## SECTION K: RESCHEDULE / REBOOK


| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| K1 | Reschedule (same price) | Admin rebooks to same-price slot | Booking moved instantly, no payment needed | ☐ |
| K2 | Reschedule (upgrade) | Rebook to more expensive slot | Customer gets payment link for difference | ☐ |
| K3 | Pay upgrade | Customer pays difference via Yoco link | Booking moved to new slot, confirmation sent | ☐ |
| K4 | Reschedule (downgrade) | Rebook to cheaper slot | Voucher created for difference, sent to customer | ☐ |
| K5 | Reschedule hold expiry | Start reschedule → don't pay → wait 15 min | New slot hold released, original booking unchanged | ☐ |


---


## SECTION L: WHATSAPP & INBOX


| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| L1 | Customer messages in | Customer sends WhatsApp message | Appears in Inbox, AI bot responds | ☐ |
| L2 | AI FAQ response | Customer asks "how much is a tour?" | Bot answers with pricing from tour data | ☐ |
| L3 | Book via WhatsApp | Customer says "I want to book" | Bot walks through tour → date → time → guests → payment | ☐ |
| L4 | Escalate to human | Customer asks "speak to a person" | Bot: handoff message, conversation status → HUMAN | ☐ |
| L5 | Admin replies | Inbox → select conversation → type reply → Send | Customer receives admin reply on WhatsApp | ☐ |
| L6 | Return to bot | Admin clicks "Return to Bot" | Conversation status → IDLE, bot resumes | ☐ |
| L7 | 24-hour window | Try sending after 24h without inbound message | Template message used (24h-compliant) | ☐ |


---


## SECTION M: PHOTOS


| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| M1 | Upload trip photos | Photos → select past trip → paste photo URLs | URLs saved | ☐ |
| M2 | Send to customers | Click "Send Photos" | All lead bookers on that slot get email + WhatsApp | ☐ |
| M3 | Customer receives | Check customer email | TRIP_PHOTOS email with gallery link + review CTA | ☐ |


---


## SECTION N: INVOICES


| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| N1 | Auto-generated invoice | After payment confirmation | Invoice auto-created with next sequence number | ☐ |
| N2 | View invoice | Invoices page → click booking | Invoice details with VAT breakdown | ☐ |
| N3 | Resend invoice | Bookings → Resend Invoice | INVOICE email sent to customer | ☐ |
| N4 | Invoice in booking detail | Bookings → [id] → Invoice section | Invoice number, payment method, amounts shown | ☐ |


---


## SECTION O: REPORTS


| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| O1 | Bookings report | Reports → Bookings tab | Table of bookings with status, sortable | ☐ |
| O2 | Financial report | Reports → Financials tab | Revenue breakdown by status (paid/pending/cancelled) | ☐ |
| O3 | Marketing attribution | Reports → Marketing tab | Source breakdown (ADMIN, WEB_CHAT, WA_WEBHOOK) | ☐ |
| O4 | Attendance report | Reports → Attendance tab | Checked-in vs not, pax counts | ☐ |
| O5 | Waiver report | Reports → Waivers tab | Signed vs pending counts | ☐ |
| O6 | Date filter | Change date range on any tab | Data filters correctly | ☐ |


---


## SECTION P: PEAK PRICING


| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| P1 | Create peak period | Pricing → set date range, label, priority | Period created | ☐ |
| P2 | Set peak prices | Assign peak_price_per_person per tour | Prices saved | ☐ |
| P3 | Apply to slots | Click Apply | Matching slots updated to peak pricing | ☐ |
| P4 | Customer sees peak price | Book during peak period | Checkout shows peak price, not base | ☐ |
| P5 | Overlap resolution | Create overlapping periods with different priorities | Higher priority wins | ☐ |


---


## SECTION Q: BILLING & SUBSCRIPTION


| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| Q1 | View plan | Billing page | Current plan name, features, seat limit shown | ☐ |
| Q2 | Seat tracking | Check seat usage vs limit | Correct count of active admins | ☐ |
| Q3 | Email usage | Check monthly email count | Matches actual emails sent | ☐ |
| Q4 | Overage tracking | If over email limit | Overage amount calculated correctly | ☐ |


---


## SECTION R: MARKETING MODULE


| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| R1 | Add contact | Marketing → Contacts → Add Contact | Contact appears in list | ☐ |
| R2 | Import contacts | Contacts → Import CSV → paste data | Contacts imported with correct fields | ☐ |
| R3 | Create template | Templates → New → choose starter → customize | Template saved | ☐ |
| R4 | Send test email | Templates → select → Test | Test email received at admin inbox | ☐ |
| R5 | Send campaign | Templates → Send Campaign → filter audience → Send | Campaign queued, emails delivered | ☐ |
| R6 | Track opens | Open a campaign email | Open tracked in campaign analytics | ☐ |
| R7 | Unsubscribe | Click unsubscribe in marketing email | Contact status → unsubscribed, confirmation page | ☐ |
| R8 | Create automation | Automations → Browse Templates → use a template | Automation created in draft with steps | ☐ |
| R9 | Activate automation | Open automation → Activate | Status: active, runs on next trigger | ☐ |
| R10 | Automation trigger | Add a contact (for "Welcome Series" automation) | Contact enrolled, first email sends | ☐ |


---


## SECTION S: SETTINGS & BRANDING


| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| S1 | Update business name | Settings → Site → change name → Save | Name updated across dashboard | ☐ |
| S2 | Update colors | Settings → Site → change brand colors → Save | Dashboard and emails reflect new colors | ☐ |
| S3 | Update logo | Settings → Site → paste logo URL → Save | Logo appears in header and emails | ☐ |
| S4 | Configure WhatsApp | Settings → Credentials → WhatsApp → enter token + phone ID | Status: Connected | ☐ |
| S5 | Configure Yoco | Settings → Credentials → Yoco → enter secret + webhook key | Status: Connected | ☐ |
| S6 | Update booking URLs | Settings → Site → update success/cancel URLs | Payment redirects go to correct URLs | ☐ |
| S7 | Edit legal docs | Settings → Terms/Privacy/Cookies → edit → Save | Updated text shown on booking site | ☐ |


---


## SECTION T: EXTERNAL / B2B INTEGRATION


| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| T1 | Check availability | Call `/external-booking` with check_availability | Returns available slots with capacity | ☐ |
| T2 | Create external booking | Call with create_booking + external_ref | Booking created, ref returned | ☐ |
| T3 | Modify external booking | Call with modify_booking | Booking updated | ☐ |
| T4 | Cancel external booking | Call with cancel_booking | Booking cancelled | ☐ |
| T5 | Duplicate prevention | Call create_booking with same external_ref | Returns existing booking (idempotent) | ☐ |


---


## SECTION U: SUPER ADMIN (Multi-Tenant)


| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| U1 | Onboard new business | Super Admin → fill form → Submit | Business + admin + default tours created, welcome email sent | ☐ |
| U2 | Switch tenant | Operator selector → pick different business | Dashboard shows that business's data | ☐ |
| U3 | Monitor email usage | Super Admin → Marketing Usage | All tenants listed with email counts | ☐ |


---


## SECTION V: EDGE CASES & RESILIENCE


| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| V1 | Double payment webhook | Trigger Yoco webhook twice for same booking | Second is ignored (idempotent), no duplicate email | ☐ |
| V2 | Overbooked slot | Try booking when capacity = 0 | Error: "No availability" | ☐ |
| V3 | Expired voucher | Try using an expired voucher code | Error: "Voucher expired" | ☐ |
| V4 | Invalid phone format | Enter "0821234567" in booking | Auto-normalized to "+27821234567" | ☐ |
| V5 | Cancel already-cancelled | Try cancelling a CANCELLED booking | No action, status unchanged | ☐ |
| V6 | Refund already-refunded | Try refunding a REFUNDED booking | Prevented, error shown | ☐ |
| V7 | Slot in the past | Try booking a slot that already started | Rejected (60-min cutoff) | ☐ |
| V8 | Multiple tabs (admin) | Open dashboard in 2 tabs as same user | Both work independently | ☐ |
| V9 | Duplicate promo use | Apply same promo code with same email on a second booking | Error: "You have already used this promo code" | ☐ |
| V10 | Expired promo code | Enter a promo code past its valid_until date | Error: "This promo code has expired" | ☐ |
| V11 | Exhausted promo code | Enter a promo code that has reached max_uses | Error: "This promo code is no longer available" | ☐ |
| V12 | Promo min order not met | Apply promo with min_order_amount higher than cart total | Error: "Minimum order of R___ required for this code" | ☐ |
| V13 | Draft created on email blur | Enter name + email on /book page → leave page without paying | DRAFT booking row exists in DB (best-effort, no capacity held) | ☐ |


---


## SECTION W: PROMO CODE MANAGEMENT (Admin)


| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| W1 | Create promo code | Marketing → Promos → Create → code, type (PERCENT/FLAT), value, dates, max uses | Promo appears in table with correct badge and status | ☐ |
| W2 | Edit promo code | Click edit on existing promo → change discount value → Save | Updated value shown in table | ☐ |
| W3 | Toggle active / inactive | Click active toggle on a promo | Status flips (Active ↔ Paused), customers can/can't use it at checkout | ☐ |
| W4 | Auto-generate code | Create promo → click auto-generate button | Random code populated in field (e.g. "PROMO-A8F2K1") | ☐ |
| W5 | Copy & delete promo | Click copy icon → verify clipboard. Click Delete → confirm | Code copied; promo removed from table | ☐ |
| W6 | Promo usage tracking | After customers redeem a promo → check Promos table | "Uses" column shows used / max (e.g. "3 / 100") | ☐ |
| W7 | Automation: generate promo | Create automation with "Generate Promo" step → activate → enroll contact | Unique promo code generated per contact, `{promo_code}` replaced in follow-up email | ☐ |


---


## SIGN-OFF


| | |
|---|---|
| **Tested by** | _________________________ |
| **Date** | _________________________ |
| **Total passed** | ______ / 133 |
| **Blockers found** | _________________________ |
| **Production ready** | ☐ Yes &nbsp;&nbsp; ☐ No |
