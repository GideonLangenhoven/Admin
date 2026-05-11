# Cape Kayak — Production Readiness Test Cases

> **310 test cases across 42 sections.**
> Work through in order: A–E (core booking flows), F–M (booking lifecycle), N–Z (admin features & platform), AA–AP (new features, edge cases & sign-off).
> When all pass, the app is production-ready and can be sold with confidence.

---

## SECTION A: ADMIN AUTHENTICATION & ONBOARDING

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| A1 | Admin login | Go to dashboard URL → enter email + password | Dashboard loads, sidebar visible | |
| A2 | Wrong password (5x) | Enter wrong password 5 times | Locked out for 30 min, unlock email sent | |
| A3 | Forgot password | Click "Forgot Password" → enter admin email | Reset email received, link works | |
| A4 | Password reset | Click reset link → set new password → log in | Login succeeds with new password | |
| A5 | Invite new admin | Settings → Admin Users → Add admin (name + email) | Admin receives welcome email with setup link | |
| A6 | New admin first login | Open welcome email → click setup link → set password | Account activated, can access dashboard | |
| A7 | Role permissions (ADMIN) | Log in as ADMIN (not MAIN_ADMIN) → check sidebar | Settings, Billing, OTA Channels, Chat FAQ hidden | |
| A8 | Role permissions (MAIN_ADMIN) | Log in as MAIN_ADMIN → check sidebar | Settings + privileged items visible, Super Admin hidden | |
| A9 | Suspended subscription | Set subscription_status to SUSPENDED → reload dashboard | Access blocked, "subscription suspended" shown | |

---

## SECTION B: TOUR & SLOT SETUP

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| B1 | Create tour | Settings → Tours → Add tour (name, price, duration, image) | Tour appears in list and on booking site | |
| B2 | Edit tour | Click tour → change price → Save | Price updated on tour and new slots | |
| B3 | Archive / hide tour | Settings → Tours → toggle "Hidden" on a tour | Tour hidden from booking site, existing bookings unaffected | |
| B4 | Set what-to-bring/wear | Settings → Tours → edit what_to_bring / what_to_wear fields | Shown on success page and confirmation email | |
| B5 | Generate slots | Slots page → Add Slots → pick date range, tour, time, days, capacity | Slots appear on calendar | |
| B6 | View week calendar | Slots page → Week View | 7-day grid with slots, occupancy bars | |
| B7 | Edit single slot | Click slot → change capacity or price → Save | Slot updated, calendar refreshes | |
| B8 | Bulk edit slots | Select date range → change capacity for all | All matching slots updated | |
| B9 | Close slot manually | Click slot → set status to CLOSED | Slot greyed out, no longer bookable | |
| B10 | Reopen closed slot | Click closed slot → Reopen | Slot returns to OPEN | |
| B11 | Custom fields | Settings → Custom Fields → add a field (text/number) | Field appears in admin new-booking form | |

---

## SECTION C: CUSTOMER BOOKING FLOW (Direct — Booking Site)

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| C1 | View tour listing | Go to booking site home page | All non-hidden tours shown with name, price, duration, image | |
| C2 | Select tour & date | Click a tour → calendar shows available dates (green dots) | Available dates highlighted, unavailable dates greyed | |
| C3 | Select time slot | Click available date → time slots shown with capacity | Slots list with remaining spots visible | |
| C4 | Select guests & add-ons | Pick qty → optional add-ons shown (if configured) | Price summary updates: base + add-ons = grand total | |
| C5 | Enter customer details | Enter name, email, phone | Fields validated, phone auto-normalized | |
| C6 | Apply promo code | Enter promo code → click Apply | Discount line in blue, total reduced | |
| C7 | Apply voucher code | Enter voucher code → click Apply | Voucher credit deducted from total | |
| C8 | Marketing opt-in | Check / uncheck marketing consent | Consent saved on booking record | |
| C9 | Pay via Yoco | Click Pay → redirected to Yoco checkout → complete payment | Redirected to /success page | |
| C10 | Full voucher coverage | Apply voucher covering 100% of total → click Confirm | Booking auto-confirmed, no Yoco redirect | |
| C11 | Success page | View /success page after payment | Booking summary, calendar add links, meeting point, what-to-bring | |
| C12 | Waiver CTA on success | View /success after payment (waiver not signed) | "Sign Waiver Now" button visible | |
| C13 | Confirmation email | Check customer email | BOOKING_CONFIRM email with ref, details, waiver link, PDF invoice | |
| C14 | Confirmation WhatsApp | Check customer WhatsApp | Booking confirmed message with ref, details, invoice # | |
| C15 | Booking in dashboard | Admin dashboard → Bookings | Booking appears with correct details, status: PAID | |

---

## SECTION D: CUSTOMER BOOKING FLOW (Web Chat)

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| D1 | Open chat widget | Go to booking site → click chat bubble | Chat opens, greeting message appears | |
| D2 | Ask general question | Type "what tours do you offer?" | AI responds with tour list and pricing | |
| D3 | Start booking via chat | Say "I want to book" → follow prompts | Bot walks through tour → date → time → guests → payment link | |
| D4 | Complete chat booking | Click payment link → pay via Yoco | Redirect to success page, booking confirmed | |

---

## SECTION E: MANUAL / ADMIN BOOKING

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| E1 | Create manual booking | New Booking → select tour, slot, customer details, qty | Booking created, status: PENDING | |
| E2 | Apply discount (admin) | New Booking → set discount (percent or flat) | Discounted total shown, saved on booking | |
| E3 | Apply voucher (admin) | New Booking → enter voucher code | Voucher balance deducted, remainder shown | |
| E4 | Apply promo code (admin) | New Booking → enter promo code | Promo validated, discount line shown in price summary | |
| E5 | Select add-ons (admin) | New Booking → select optional add-ons with qty | Add-on line items appear in price breakdown | |
| E6 | Generate payment link | On the booking → Send Payment Link | Customer receives email with payment link | |
| E7 | Customer pays link | Open payment link email → pay | Status → PAID, confirmation sent | |
| E8 | Mark paid (cash/EFT) | PENDING booking → Mark as Paid → select payment method | Status → PAID, invoice created, confirmation email + WhatsApp sent | |
| E9 | Edit booking details | Click booking → change customer name/phone/email/qty | Changes saved, customer gets BOOKING_UPDATED email | |
| E10 | Reduce guests | Edit booking → decrease qty | Guest reduction email sent, slot capacity freed | |
| E11 | Check-in guests | Dashboard → today's bookings → click Check In | Booking marked checked_in, attendance updated | |

---

## SECTION F: WAIVER / INDEMNITY

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| F1 | Waiver link in confirm email | Open booking confirmation email | Waiver link visible (if waiver pending) | |
| F2 | Open waiver form | Click waiver link | Form loads with booking details, full indemnity text | |
| F3 | Sign waiver (adult) | Fill name, optional ID, check consent boxes → Submit | "Waiver signed" confirmation shown | |
| F4 | Sign waiver (minor) | Enter DOB under 18 → guardian fields appear → sign | Guardian name/ID captured, waiver marked signed | |
| F5 | Waiver status in dashboard | Admin → Booking detail | Waiver status: SIGNED with timestamp | |
| F6 | Auto waiver reminder | Unsigned waiver for tomorrow's booking → wait for cron | INDEMNITY email sent automatically | |
| F7 | Waiver notice in checkout | /book page → reach details step | Amber info box: "All participants must sign a waiver before the trip" | |
| F8 | Waiver CTA on success page | Complete a paid booking → view /success | "Sign Waiver Now" button if pending; green "Completed" badge if signed | |
| F9 | Token-based waiver access | Open waiver link with unique token | Correct booking loaded without login, form pre-filled | |

---

## SECTION G: PAYMENT FLOWS

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| G1 | Yoco checkout | Customer pays via Yoco on booking site | Webhook fires, booking → PAID | |
| G2 | Payment success redirect | After Yoco payment | Customer sees success page, confirm-booking fallback fires | |
| G3 | Payment cancel | Customer clicks cancel on Yoco page | Redirected to /cancelled, booking stays HELD/PENDING | |
| G4 | Voucher at checkout | Apply voucher code during checkout | Amount reduced, checkout for remainder | |
| G5 | Full voucher coverage | Apply voucher that covers full amount | No Yoco redirect, booking auto-confirmed | |
| G6 | Promo code (percent) | Enter PERCENT promo code at checkout | Discount line in summary, total reduced | |
| G7 | Promo code (flat) | Enter FLAT promo code at checkout | Flat discount deducted from total | |
| G8 | Promo + voucher combined | Apply promo first, then voucher | Promo discount first, voucher drains remainder | |
| G9 | Remove promo at checkout | Apply promo → click Remove | Promo cleared, prices revert | |
| G10 | Server-side price verification | Tamper with client-side total (dev tools) | create-checkout rejects mismatched amount | |
| G11 | Add-ons in checkout total | Select add-ons → proceed to payment | Checkout amount includes base + add-ons + promo/voucher adjustments | |

---

## SECTION H: GIFT VOUCHERS

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| H1 | Create voucher (admin) | Vouchers → Create → fill type, amount, recipient | Voucher created with CK-XXXX code | |
| H2 | Purchase voucher (customer) | Booking site → /voucher → select tour → pay | Recipient gets GIFT_VOUCHER email with code | |
| H3 | Redeem voucher | Book a tour → enter voucher code at checkout | Balance deducted from total | |
| H4 | Partial redemption | Use R600 voucher on R400 tour | R200 balance remains, VOUCHER_BALANCE email sent | |
| H5 | Voucher from cancellation | Cancel paid booking → choose voucher refund | New voucher created, VOUCHER email sent | |
| H6 | Expired voucher blocked | Try using an expired voucher code | Error: "Voucher expired" | |
| H7 | Abandoned voucher cleanup | Start voucher purchase → don't pay → wait 24h | PENDING voucher auto-deleted by cron | |

---

## SECTION I: CUSTOMER SELF-SERVICE (My Bookings)

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| I1 | OTP login | Go to /my-bookings → enter email + phone → request OTP | OTP email received with 6-digit code | |
| I2 | Verify OTP | Enter OTP code | Authenticated, all bookings for that email shown | |
| I3 | View bookings | After login | List of bookings with status, tour, date, actions | |
| I4 | Reschedule booking | Click Reschedule → pick new slot | Booking moved (or upgrade payment link generated) | |
| I5 | Cancel booking | Click Cancel → confirm | Booking cancelled, refund options shown | |
| I6 | OTP rate limiting | Request OTP 4+ times in 10 min | Rate limited, error shown | |

---

## SECTION J: AUTO-MESSAGES (Cron-Triggered)

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| J1 | Day-before reminder | PAID booking for tomorrow → wait for cron | WhatsApp: "reminder for tomorrow, [tour], [time], arrive 15 min early" | |
| J2 | Waiver reminder email | Unsigned waiver for tomorrow's booking → cron runs | INDEMNITY email sent automatically | |
| J3 | Review request | Tour completed → wait 2-6 hours | WhatsApp: "thanks for joining, review link" | |
| J4 | Booking → COMPLETED | After review request sends | Booking status auto-updates to COMPLETED | |
| J5 | Hold expiry | Create booking with hold → don't pay → wait 20 min | Hold expires, capacity released, WhatsApp: "hold expired" | |
| J6 | Payment deadline expiry | Create admin booking with deadline → let it pass | Auto-cancelled, capacity freed, admin notified via WhatsApp | |
| J7 | Re-engagement | Customer with 90+ day old booking, no activity | WhatsApp: "it's been a while, welcome back" | |
| J8 | Human chat timeout | Conversation in HUMAN state > 48h | Auto-reverts to IDLE | |
| J9 | Abandoned cart recovery | Enter email on /book → abandon → wait 30+ min | ABANDONED_CART email with "Complete My Booking" link | |
| J10 | Stale draft cleanup | Abandon a draft booking → wait 24+ hours | Draft auto-cancelled, no lingering DRAFT records | |
| J11 | Abandoned voucher cleanup | Start voucher purchase → don't pay → wait 24h | PENDING voucher deleted by cron | |
| J12 | Review reminder (7-14 days) | Review request sent but no review submitted → wait 7 days | REVIEW_REMINDER WhatsApp sent | |

---

## SECTION K: CANCELLATION & REFUND FLOWS

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| K1 | Admin cancel booking | Bookings → select booking → Cancel | Status: CANCELLED, customer gets CANCELLATION email + WhatsApp | |
| K2 | Refund appears in queue | After cancellation | Refund in queue on Refunds page with correct amount | |
| K3 | Process Yoco refund | Refunds → click "Refund" on Yoco-paid booking | Yoco API called, refund processed, status: REFUNDED | |
| K4 | Manual refund (EFT) | Process refund on EFT-paid booking | Marked MANUAL_EFT_REQUIRED, admin does bank transfer | |
| K5 | Decline refund | Click "Decline" with reason | Status: DECLINED, customer notified | |
| K6 | Batch refund | Refunds page → "Refund All" | All pending refunds processed sequentially | |
| K7 | Voucher-paid cancel | Cancel a voucher-paid booking | New voucher issued for full amount (no card refund) | |

---

## SECTION L: WEATHER CANCELLATION

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| L1 | Cancel slot (weather) | Weather page → select slot → Cancel → enter reason | Slot: CLOSED | |
| L2 | Paid bookings cancelled | Bookings on that slot | All PAID bookings → CANCELLED, refund_status: ACTION_REQUIRED | |
| L3 | Customer notifications | Check email + WhatsApp | CANCELLATION email with weather flag; WhatsApp with options | |
| L4 | Self-service options | Customer opens My Bookings link | Can choose: Reschedule / Voucher / Refund | |
| L5 | Bulk weather cancel | Cancel multiple slots for a stormy day | All affected bookings cancelled, all customers notified | |
| L6 | Reopen after weather | Next day is clear → Reopen Day | Slots back to OPEN, available for booking | |

---

## SECTION M: RESCHEDULE / REBOOK

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| M1 | Reschedule (same price) | Admin rebooks to same-price slot | Booking moved instantly, confirmation sent | |
| M2 | Reschedule (upgrade) | Rebook to more expensive slot | Payment link for price difference sent to customer | |
| M3 | Pay upgrade | Customer pays difference via Yoco | Booking moved to new slot, confirmation sent | |
| M4 | Reschedule (downgrade) | Rebook to cheaper slot | Voucher created for difference, sent to customer | |
| M5 | Reschedule hold expiry | Start reschedule → don't pay → wait 15 min | New slot hold released, original booking unchanged | |

---

## SECTION N: WHATSAPP, INBOX & BOT MODE

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| N1 | Customer messages in | Customer sends WhatsApp message | Appears in Inbox, AI bot responds | |
| N2 | AI FAQ response | Customer asks "how much is a tour?" | Bot answers with pricing from tour data | |
| N3 | Book via WhatsApp | Customer says "I want to book" → follow prompts | Bot walks through tour → date → time → guests → payment link | |
| N4 | Escalate to human | Customer asks "speak to a person" | Bot: handoff message, conversation status → HUMAN | |
| N5 | Admin replies | Inbox → select conversation → type reply → Send | Customer receives admin reply on WhatsApp | |
| N6 | Return to bot | Admin clicks "Return to Bot" | Conversation status → IDLE, bot resumes | |
| N7 | 24-hour window | Try sending after 24h without inbound message | Template message used (24h-compliant) | |
| N8 | Unread badge | Customer sends message → check sidebar | Inbox nav shows unread count badge | |
| N9 | Bot mode: OFF | Settings → WhatsApp Bot → select OFF → Save | All inbound messages go straight to inbox, no AI reply | |
| N10 | Bot mode: ALWAYS_ON | Settings → WhatsApp Bot → select ALWAYS_ON → Save | Bot responds to all messages 24/7 | |
| N11 | Bot mode: OUTSIDE_HOURS | Settings → WhatsApp Bot → select OUTSIDE_HOURS → Save | Bot active outside business hours only; inside hours → inbox | |
| N12 | Bot status badge | Settings → WhatsApp Bot section | Live status badge shows green (active) / amber (outside hours) / gray (off) | |
| N13 | Bot banner in inbox | Set bot mode to OFF → open Inbox | Dismissible banner: "WhatsApp bot is currently off" | |
| N14 | Bot skip logged | Send message with bot OFF → check chat_messages | bot_skipped_reason populated with reason | |
| N15 | Intent classifier | Customer sends ambiguous message | Intent classified and routed (FAQ match / booking / human) | |

---

## SECTION O: BROADCASTS

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| O1 | Select slot & compose | Broadcasts → pick date → select slot(s) → write message | Recipients list populated from bookings on those slots | |
| O2 | Send broadcast | Click Send | All selected customers receive WhatsApp/email | |
| O3 | Weather cancel mode | Broadcasts → Weather Cancel → select slots → enter reason | Slots closed, bookings cancelled, notifications sent | |

---

## SECTION P: PHOTOS

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| P1 | Upload trip photos | Photos → select past trip → paste photo URLs | URLs saved | |
| P2 | Send to customers | Click "Send Photos" | All lead bookers on that slot get email + WhatsApp | |
| P3 | Customer receives photos | Check customer email | TRIP_PHOTOS email with gallery link + review CTA | |

---

## SECTION Q: INVOICES

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| Q1 | Auto-generated invoice | After payment confirmation | Invoice auto-created with sequential number | |
| Q2 | Invoice has VAT | View invoice details | 15% VAT breakdown shown correctly | |
| Q3 | View invoice list | Invoices page → filter by date | Invoices grouped by date with totals | |
| Q4 | Resend invoice | Bookings → Resend Invoice | INVOICE email sent to customer with PDF attachment | |
| Q5 | Invoice in booking detail | Bookings → [id] → Invoice section | Invoice number, payment method, amounts shown | |
| Q6 | Combo invoice | Complete Paysafe combo booking | Invoice shows both tours, split amounts, correct total | |

---

## SECTION R: DASHBOARD & CHECK-IN

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| R1 | Daily manifest | Dashboard home page | Today's bookings grouped by slot, pax counts, check-in status | |
| R2 | Check in guest | Dashboard → click Check In on a booking | Marked as checked in, count updates | |
| R3 | Revenue stats | Dashboard | Revenue summary (today / this week / this month) shown | |
| R4 | Trip calendar | Dashboard → calendar widget | Monthly view with pax counts per date | |
| R5 | Weather widget | Dashboard → Windguru section | Wind/swell data loads for configured spots | |

---

## SECTION S: REPORTS

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| S1 | Bookings report | Reports → Bookings tab | Table of bookings with status, sortable | |
| S2 | Financial report | Reports → Financials tab | Revenue breakdown by status (paid/pending/cancelled) | |
| S3 | Marketing attribution | Reports → Marketing tab | Source breakdown (ADMIN, WEB_CHAT, WA_WEBHOOK, EXTERNAL) | |
| S4 | Attendance report | Reports → Attendance tab | Checked-in vs not, pax counts | |
| S5 | Waiver report | Reports → Waivers tab | Signed vs pending counts | |
| S6 | Date filter | Change date range on any tab | Data filters correctly | |
| S7 | CSV export | Reports → Export CSV | Correct data downloaded | |

---

## SECTION T: PEAK PRICING

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| T1 | Create peak period | Pricing → set date range, label, priority | Period created | |
| T2 | Set peak prices | Assign peak_price_per_person per tour | Prices saved | |
| T3 | Apply to slots | Click Apply | Matching slots updated to peak pricing | |
| T4 | Customer sees peak price | Book during peak period | Checkout shows peak price, not base | |
| T5 | Overlap resolution | Create overlapping periods with different priorities | Higher priority wins | |

---

## SECTION U: MARKETING MODULE — CONTACTS & CAMPAIGNS

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| U1 | Marketing overview | Marketing → Dashboard | Contact count, campaign stats, email usage vs quota | |
| U2 | Add contact | Marketing → Contacts → Add Contact | Contact appears in list with active status | |
| U3 | Import contacts (CSV) | Contacts → Import CSV → paste data | Contacts imported with correct fields + tags | |
| U4 | Tag management | Contacts → add/remove tags on contacts | Tags saved, filterable | |
| U5 | Clean list | Contacts → Clean List | Stale/bounced contacts marked inactive | |
| U6 | Contact engagement metrics | Open contact detail | Shows total_received, total_opens, total_clicks, last_open_at | |
| U7 | Contact DOB field | Add/edit contact date of birth | DOB saved, available for birthday automation trigger | |
| U8 | Create template | Templates → New → choose starter → customize in drag-drop builder | Template saved with blocks | |
| U9 | Send test email | Templates → select → Test | Test email received at admin inbox | |
| U10 | Send campaign | Templates → Send Campaign → filter audience → Send | Campaign queued, emails delivered | |
| U11 | Schedule campaign | Set campaign send time to future date | Campaign shows "Scheduled", fires at set time | |
| U12 | Pause campaign | Sending campaign → click Pause | Campaign paused, remaining emails held | |
| U13 | Track opens | Open a campaign email | Open tracked in campaign analytics (total_opens increments) | |
| U14 | Track clicks | Click a link in a campaign email | Click tracked, redirected to destination (total_clicks increments) | |
| U15 | Unsubscribe | Click unsubscribe in marketing email | Contact status → unsubscribed, confirmation page shown | |
| U16 | Bounce tracking | Email bounces from provider | Contact bounce_status updated, bounced_at set | |
| U17 | Custom from email | Business with from_email configured → send campaign | Email arrives from custom sender address (not default) | |

---

## SECTION V: MARKETING MODULE — AUTOMATIONS

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| V1 | Browse automation templates | Marketing → Automations | Template catalog shown (Welcome, Post-Tour, Birthday, etc.) | |
| V2 | Create automation from template | Select "Welcome Series" template → Create | Automation created in DRAFT with pre-built steps | |
| V3 | Edit automation steps | Open automation → add/remove/reorder steps | Steps saved with correct positions | |
| V4 | Activate automation | Open draft automation → Activate | Status: active, ready to enroll contacts | |
| V5 | Pause automation | Active automation → Pause | Status: paused, no new enrollments, active ones held | |
| V6 | Archive automation | Paused automation → Archive | Status: archived, hidden from active list | |
| V7 | Trigger: contact_added | Add a new contact → wait for dispatch | Contact enrolled in Welcome Series, first email sends | |
| V8 | Trigger: tag_added | Add "completed-tour" tag to contact | Contact enrolled in Post-Tour Review automation | |
| V9 | Trigger: post_booking | Customer completes a paid booking | Contact enrolled in post-booking automation | |
| V10 | Trigger: date_field (birthday) | Contact with DOB = today → cron runs | Birthday email sent automatically | |
| V11 | Step: delay | Enrollment hits a delay step (e.g. 3 days) | next_action_at set correctly, resumes after delay | |
| V12 | Step: send_email | Enrollment reaches email step | Email sent via Resend, log entry created | |
| V13 | Step: generate_voucher | Automation step generates voucher | Unique voucher created per contact, `{voucher_code}` replaced in email | |
| V14 | Step: generate_promo | Automation step generates promo code | Unique promo code created, `{promo_code}` replaced in email | |
| V15 | Enrollment completion | Contact completes all steps | Status: completed, completed_count increments atomically | |
| V16 | Duplicate enrollment prevention | Same contact triggers automation twice | Only one active enrollment per automation per contact | |
| V17 | Automation logs | View automation detail → Logs tab | Full audit trail of step executions with timestamps | |

---

## SECTION W: PROMO CODE MANAGEMENT

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| W1 | Create promo code | Marketing → Promos → Create → code, type, value, dates, max uses | Promo appears in table with correct badge and status | |
| W2 | Edit promo code | Click edit → change discount value → Save | Updated value shown in table | |
| W3 | Toggle active/inactive | Click active toggle on a promo | Status flips (Active / Paused) | |
| W4 | Auto-generate code | Create promo → click auto-generate button | Random code populated (e.g. "PROMO-A8F2K1") | |
| W5 | Copy & delete promo | Click copy icon → clipboard. Click Delete → confirm | Code copied; promo removed from table | |
| W6 | Promo usage tracking | After customers redeem → check Promos table | "Uses" column shows used / max (e.g. "3 / 100") | |
| W7 | Min order amount | Create promo with min_order_amount R500 → apply to R300 booking | Error: "Minimum order of R500 required" | |
| W8 | Per-email single use | Same email applies same promo code twice | Error: "You have already used this promo code" | |
| W9 | Promo validation RPC | Call validate_promo_code RPC with edge cases | Returns correct valid/error for all scenarios | |

---

## SECTION X: ADD-ONS / BOOKING UPSELLS

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| X1 | Create add-on | Settings → Add-Ons → Create (name, price, image, description) | Add-on appears in list, active by default | |
| X2 | Edit add-on | Click add-on → change price → Save | Price updated | |
| X3 | Deactivate add-on | Toggle active off on an add-on | Hidden from booking flow, existing bookings unaffected | |
| X4 | Sort add-ons | Drag-reorder add-ons in list | Sort order saved, reflected in booking flow | |
| X5 | Customer selects add-ons | Booking site → select tour → add-ons shown | Add-ons display with name, price, image; qty selectable | |
| X6 | Add-on price in total | Select 2x add-on at R50 each | Price summary: base + R100 add-ons = correct total | |
| X7 | Add-ons on invoice | Complete booking with add-ons → view invoice | Add-on line items listed on invoice with prices | |
| X8 | Add-ons in admin booking | Admin → New Booking → select add-ons | Add-ons recorded on booking_add_ons table | |

---

## SECTION Y: COMBO BOOKINGS & PARTNERSHIPS

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| Y1 | Invite partner business | Settings → Partnerships → Invite → enter admin email | Partnership created (PENDING), partner business notified | |
| Y2 | Accept partnership | Partner admin → view invite → Accept | Partnership status: ACTIVE, both businesses linked | |
| Y3 | Revoke partnership | Active partnership → Revoke | Status: REVOKED, combo offers deactivated | |
| Y4 | Create combo offer | Partnerships → Combo Offers → Create → select tours, set price, split | Combo offer created with correct split percentages | |
| Y5 | Combo split validation (percent) | Create combo with PERCENT split not summing to 100 | Error: splits must equal 100% | |
| Y6 | Combo split validation (fixed) | Create combo with FIXED splits not summing to combo_price | Error: fixed splits must equal combo price | |
| Y7 | Edit combo offer | Change combo price or split → Save | Updated in table, reflected on booking site | |
| Y8 | Deactivate combo | Toggle combo offer inactive | Hidden from booking site | |
| Y9 | Customer books combo | Booking site → select combo → pick slots for both tours → pay via Paysafe | Paysafe checkout created with combined amount | |
| Y10 | Paysafe webhook confirms | Paysafe webhook fires after payment | Both bookings created (booking_a, booking_b), combo_booking record linked | |
| Y11 | Revenue split recorded | View combo booking detail | split_a_amount and split_b_amount match configured percentages | |
| Y12 | Combo confirmation sent | After payment | Customer gets confirmation with both tour details, both operators notified | |
| Y13 | Combo invoice generated | After payment | Invoice created with both tours, split amounts, correct total | |
| Y14 | Paysafe HMAC verification | Send webhook with invalid signature | 401 rejected, constant-time comparison used | |
| Y15 | Partner tours API | GET /api/partner-tours?partnership_id=X | Returns available tours from partner business only | |

---

## SECTION Z: SETTINGS & BRANDING

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| Z1 | Update business name | Settings → Site → change name → Save | Name updated across dashboard and emails | |
| Z2 | Update brand colors | Settings → Site → change brand colors → Save | Dashboard and emails reflect new colors | |
| Z3 | Update logo | Settings → Site → paste logo URL → Save | Logo appears in header and emails | |
| Z4 | Configure WhatsApp | Settings → Credentials → WhatsApp → enter token + phone ID | Status: Connected | |
| Z5 | Configure Yoco | Settings → Credentials → Yoco → enter secret + webhook key | Status: Connected | |
| Z6 | Configure Paysafe | Settings → Credentials → Paysafe → enter API key + secret + account IDs | Credentials encrypted with pgcrypto, status: Connected | |
| Z7 | Update booking URLs | Settings → Site → update success/cancel URLs | Payment redirects go to correct URLs | |
| Z8 | Edit legal docs | Settings → Terms/Privacy/Cookies → edit → Save | Updated text shown on booking site legal pages | |
| Z9 | Customize directions | Settings → Site → update meeting point directions | Shown in confirmation email and success page | |
| Z10 | Edit chatbot avatar | Settings → Site → update chatbot avatar URL | New avatar shown in web chat widget | |
| Z11 | Resources setup | Settings → Resources → add equipment (kayaks, paddles) | Resources linked to tours with units-per-guest | |
| Z12 | Configure subdomain | Settings → Site → set business subdomain | Subdomain saved, booking site accessible at subdomain.bookingtours.co.za | |
| Z13 | Configure from email | Settings → Site → set custom from_email address | Outgoing emails use custom sender address | |
| Z14 | Edit hero section | Settings → Site → update eyebrow, title, subtitle | Landing page hero section updated | |
| Z15 | Edit FAQ content | Settings → Site → update FAQ JSON | FAQ section on booking site reflects changes | |
| Z16 | Customize AI system prompt | Settings → Site → update chatbot system prompt | Web chat AI uses custom personality/instructions | |

---

## SECTION AA: LANDING PAGES & TEMPLATES

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| AA1 | Select landing page template | Settings → Landing Page → choose template (adventure/luxury/safari/modern/etc.) | Template preview shown with business branding | |
| AA2 | Customize template content | Edit hero, tours, colors, footer in template config | Preview updates with custom content | |
| AA3 | Deploy landing page | Click Deploy → Firebase hosting | Landing page live at configured subdomain | |
| AA4 | Landing page loads correctly | Visit subdomain.bookingtours.co.za | Full landing page with tours, pricing, booking CTAs | |
| AA5 | Landing page booking link | Click "Book Now" on landing page | Redirects to booking site with correct tour pre-selected | |
| AA6 | Mobile responsive landing | Open landing page on mobile device | Layout adapts, all content accessible | |

---

## SECTION AB: BILLING & SUBSCRIPTION

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| AB1 | View plan | Billing page | Current plan name, features, seat limit shown | |
| AB2 | Seat tracking | Check seat usage vs limit | Correct count of active admins vs max_admin_seats | |
| AB3 | Seat limit enforced | Try adding admin when at max_admin_seats | Blocked with "seat limit reached" message | |
| AB4 | Email usage | Check monthly email count | Matches actual emails sent | |
| AB5 | Overage invoice | Exceed email limit → wait for cron | Overage invoice auto-generated with correct amount | |

---

## SECTION AC: EXTERNAL / B2B INTEGRATION

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| AC1 | Check availability | Call `/external-booking` with check_availability | Returns available slots with capacity | |
| AC2 | Create external booking | Call with create_booking + external_ref | Booking created with source: EXTERNAL | |
| AC3 | Modify external booking | Call with modify_booking | Booking updated | |
| AC4 | Cancel external booking | Call with cancel_booking | Booking cancelled | |
| AC5 | Duplicate prevention | Call create_booking with same external_ref | Returns existing booking (idempotent) | |
| AC6 | Invalid API key | Call with wrong HMAC signature | 401 Unauthorized | |

---

## SECTION AD: SUPER ADMIN (Multi-Tenant)

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| AD1 | Onboard new business | Super Admin → fill form → Submit | Business + admin + default tours created, welcome email sent | |
| AD2 | Switch tenant | Operator selector → pick different business | Dashboard shows that business's data only | |
| AD3 | Monitor email usage | Super Admin → Marketing Usage | All tenants listed with email counts | |
| AD4 | RLS data isolation | Logged in as Tenant A → query Tenant B data | No cross-tenant data visible | |
| AD5 | Set admin seat limit | Super Admin → select business → set max_admin_seats | Seat limit saved, enforced on that business | |
| AD6 | Subdomain resolution | Access subdomain.bookingtours.co.za | Correct business resolved via x-tenant-slug header | |
| AD7 | Flattened subdomain | Access business-admin.bookingtours.co.za | Correct business resolved (hyphenated format) | |
| AD8 | Super-admin-only nav | Log in as MAIN_ADMIN → check sidebar | OTA Drift, Data Requests, Super Admin NOT visible | |

---

## SECTION AE: OPERATOR MANAGEMENT

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| AE1 | View operators | Operators page | List of operators with role and status | |
| AE2 | Switch operator context | Click different operator | Dashboard switches to that operator's data | |
| AE3 | Operator role display | View operator detail | Shows ADMIN / MAIN_ADMIN / OPERATOR role correctly | |
| AE4 | Plan info display | Operators page | Shows pricing/plan tier and seat info per operator | |

---

## SECTION AF: GUIDE APP

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| AF1 | Guide dashboard | Navigate to /guide | Today's slots listed with tour name, time, pax, capacity | |
| AF2 | Change day | Guide → pick different date | Slots for selected date shown | |
| AF3 | Slot detail | Click slot on guide dashboard | Slot detail with full booking list, customer names, phone numbers | |
| AF4 | Guide check-in | Guide → slot → check in a guest | POST /api/guide/check-in fires, booking marked checked_in | |
| AF5 | Photo upload | Guide → /guide/photos/[slotId] → upload photos | Photos saved for that slot | |
| AF6 | Send thank-you | Guide → slot → click "Send Thank You" | Thank-you WhatsApp sent to all customers on slot | |
| AF7 | Guide role access | Log in as OPERATOR role → navigate to /guide | Guide pages accessible | |

---

## SECTION AG: OTA CHANNELS (Viator & GetYourGuide)

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| AG1 | Enable Viator | Settings → OTA → Viator → enter API key + merchant ID → Enable | Integration saved, status: ENABLED | |
| AG2 | Map products (Viator) | OTA Settings → Product Mapping → link Viator product to local tour | Mapping saved in ota_product_mappings | |
| AG3 | Availability sync (Viator) | Wait for hourly cron (:17) | Next 90 days of availability pushed to Viator API | |
| AG4 | Inbound booking (Viator) | Viator webhook fires with new booking | Booking created with source: VIATOR, slot capacity updated | |
| AG5 | Amend booking (Viator) | Viator sends amended qty | Local booking qty updated, capacity adjusted | |
| AG6 | Cancel booking (Viator) | Viator sends cancellation | Booking cancelled, capacity released | |
| AG7 | Viator HMAC check | Send webhook with invalid HMAC | 401 rejected | |
| AG8 | Enable GetYourGuide | Settings → OTA → GYG → enter credentials → Enable | Integration saved, status: ENABLED | |
| AG9 | Map products (GYG) | OTA Settings → link GYG option to local tour | Mapping saved | |
| AG10 | Availability sync (GYG) | Wait for hourly cron (:12) | Availability pushed to GetYourGuide API | |
| AG11 | Inbound booking (GYG) | GYG webhook fires with new booking | Booking created with source: GETYOURGUIDE | |
| AG12 | Oversold detection | OTA booking arrives when slot at capacity | Booking created but flagged as oversold in logs | |

---

## SECTION AH: OTA DRIFT MONITOR

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| AH1 | Reconciliation runs | Wait for nightly cron (02:37 UTC) | ota_reconciliation_runs record created per channel | |
| AH2 | View drift dashboard | Super Admin → OTA Drift | Recent runs listed with matched/missing/mismatch counts | |
| AH3 | Drill into run | Click a reconciliation run | Detail shows: missing locally, missing on OTA, amount mismatches | |
| AH4 | Clean run | All bookings match | Run shows 0 drifts, green checkmark | |
| AH5 | Refresh on demand | Click refresh button on OTA Drift page | Manual reconciliation triggered | |

---

## SECTION AI: GOOGLE REVIEWS

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| AI1 | Configure Google Place ID | Settings → enter google_place_id → Save | Place ID saved on business record | |
| AI2 | Auto-sync reviews | Daily cron (03:17 UTC) runs | Google reviews fetched and upserted into reviews table | |
| AI3 | View reviews | Reviews page → filter by source | Google reviews shown with star rating, author, text | |
| AI4 | Moderate review | Click review → change status (APPROVED/HIDDEN/SPAM) | Status updated, display filtered accordingly | |
| AI5 | Customer-submitted review | Customer opens review link → submits rating + text | Review created with source: DIRECT, status: PENDING | |
| AI6 | Review link in email | Complete tour → receive review request email | Link opens /review/[token] with booking pre-loaded | |

---

## SECTION AJ: CHAT FAQ MANAGEMENT

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| AJ1 | View FAQ entries | Settings → Chat FAQ | List of FAQ entries with question, answer, intent, keywords | |
| AJ2 | Add FAQ entry | Click Add → enter question, answer, intent, keywords → Save | Entry created via POST /api/admin/chat-faq | |
| AJ3 | Edit FAQ entry | Click entry → modify answer → Save | Updated via PUT /api/admin/chat-faq/[id] | |
| AJ4 | Delete FAQ entry | Click delete on entry → confirm | Removed via DELETE /api/admin/chat-faq/[id] | |
| AJ5 | FAQ auto-reply | Customer sends message matching FAQ keywords | High-confidence FAQ answer sent instantly | |
| AJ6 | FAQ fallback | Customer message partially matches FAQ | AI uses FAQ as context but generates custom reply | |

---

## SECTION AK: POPIA DATA SUBJECT REQUESTS

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| AK1 | Submit data request | Customer visits /popia/confirm → submits request (access/delete/rectify) | Request created via POST /api/popia/request | |
| AK2 | Confirm request (OTP) | Customer receives confirmation email → clicks confirm | Request status: CONFIRMED via /api/popia/confirm | |
| AK3 | View requests (admin) | Super Admin → Data Requests | All requests listed with type, status, requester | |
| AK4 | Export data | Admin → data request → Export | Customer data exported via /api/admin/data-requests/[id]/export | |
| AK5 | Fulfill request | Admin → Fulfill | Request status: FULFILLED, customer notified | |
| AK6 | Reject request | Admin → Reject with reason | Request status: REJECTED, reason logged | |
| AK7 | Auto-processing (cron) | Data request with type DELETE → cron runs | Personal data anonymized per POPIA requirements | |

---

## SECTION AL: EMBED WIDGET

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| AL1 | Widget loads in iframe | Embed `/embed/embed/availability` in external site | Calendar loads with available slots | |
| AL2 | Widget availability data | GET /api/widget-availability?business_id=X | Returns available slots as JSON | |
| AL3 | Widget security headers | Check response headers on /embed/* | Content-Security-Policy: frame-ancestors *, no X-Frame-Options | |
| AL4 | Non-embed pages blocked | Try iframing /bookings (non-embed route) | X-Frame-Options: DENY blocks embed | |

---

## SECTION AM: FAILED NOTIFICATIONS

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| AM1 | Failed email logged | Simulate email delivery failure (bad address) | Entry in failed_notifications with channel: email, status: FAILED | |
| AM2 | Failed WhatsApp logged | Simulate WhatsApp delivery failure | Entry in failed_notifications with channel: whatsapp | |
| AM3 | Retry notification | Admin → failed notification → Retry | Re-attempted, status: RETRYING → RESOLVED on success | |
| AM4 | Max retry expiry | Notification fails 3+ times | Status: EXPIRED, no further retries | |
| AM5 | Admin visibility | Admin views failed notifications list | Shows recipient, type, error message, attempt count | |

---

## SECTION AN: SECURITY & ENCRYPTION

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| AN1 | Paysafe keys encrypted | Store Paysafe credentials via Settings | Keys stored as pgcrypto-encrypted bytea, not plaintext | |
| AN2 | Partial credential display | View stored credentials in Settings | Only last 4 chars shown (masked), never full key | |
| AN3 | RLS on new tables | Query promotions / add_ons / combo_* without auth | Access denied, RLS blocks all unauthenticated reads | |
| AN4 | API rate limiting | Hit /api/* endpoint 101+ times in 1 min | Rate limited after 100 requests | |
| AN5 | Webhook HMAC (Paysafe) | Send Paysafe webhook with tampered payload | Rejected — HMAC-SHA256 signature mismatch | |
| AN6 | No secrets in source | Search codebase for hardcoded API keys | No credentials found in any source file | |
| AN7 | Idempotent webhooks | Fire same Yoco/Paysafe webhook twice | Second call ignored via idempotency_keys table | |
| AN8 | JWT verification config | Check config.toml for public endpoints | Only intended public endpoints have verify_jwt = false | |
| AN9 | Security headers | Check response headers on any page | X-Frame-Options: DENY, X-Content-Type-Options: nosniff, strict referrer | |

---

## SECTION AO: EDGE CASES & RESILIENCE

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| AO1 | Double payment webhook | Trigger Yoco webhook twice for same booking | Second ignored (idempotent), no duplicate email | |
| AO2 | Overbooked slot | Try booking when capacity = 0 | Error: "No availability" | |
| AO3 | Expired voucher | Try using an expired voucher code | Error: "Voucher expired" | |
| AO4 | Invalid phone format | Enter "0821234567" in booking | Auto-normalized to "+27821234567" | |
| AO5 | Cancel already-cancelled | Try cancelling a CANCELLED booking | No action, status unchanged | |
| AO6 | Refund already-refunded | Try refunding a REFUNDED booking | Prevented, error shown | |
| AO7 | Slot in the past | Try booking a slot that already started | Rejected (60-min cutoff) | |
| AO8 | Multiple tabs (admin) | Open dashboard in 2 tabs as same user | Both work independently, real-time sync | |
| AO9 | Duplicate promo use | Apply same promo code with same email twice | Error: "You have already used this promo code" | |
| AO10 | Expired promo code | Enter promo code past valid_until | Error: "This promo code has expired" | |
| AO11 | Exhausted promo code | Enter promo code at max_uses | Error: "This promo code is no longer available" | |
| AO12 | Promo min order not met | Apply promo with min_order > cart total | Error: "Minimum order of R___ required" | |
| AO13 | Draft on email blur | Enter name + email on /book → leave page | DRAFT booking row in DB (best-effort, no capacity held) | |
| AO14 | Concurrent hold race | Two customers try to book the last spot simultaneously | Atomic hold creation prevents double-booking | |
| AO15 | Concurrent voucher drain | Two customers apply same voucher simultaneously | Atomic deduction prevents over-spending | |
| AO16 | Mobile responsive (admin) | Open dashboard on mobile device | Mobile menu drawer works, all pages usable | |
| AO17 | Mobile responsive (booking) | Open booking site on mobile | Full flow works on small screen | |
| AO18 | Combo booking — one slot full | Book combo where Tour B slot is at capacity | Error shown before payment, no partial booking | |
| AO19 | Paysafe checkout — cancel | Customer cancels on Paysafe payment page | No combo booking created, both slot holds released | |
| AO20 | Add-on with zero qty | Select add-on → set qty to 0 | Add-on removed from total, not saved on booking | |
| AO21 | Resend API key missing | marketing-dispatch called without RESEND_API_KEY | Returns 503 gracefully, no crash | |
| AO22 | Dark mode toggle | Click theme toggle | All pages render correctly in dark/light mode | |
| AO23 | Bot mode OFF + inbound | Bot mode OFF → customer sends message | Message goes to inbox, no AI reply, bot_skipped_reason logged | |
| AO24 | OTA booking on closed slot | Viator/GYG webhook for a CLOSED slot | Booking created but flagged as oversold | |
| AO25 | Viator slot time tolerance | OTA booking time differs by 25 min from slot | Matched to nearest slot within ±30 min window | |

---

## SECTION AP: END-TO-END SMOKE TESTS

> These are full lifecycle tests that prove the app works as a complete system. Each test walks through multiple features in sequence.

| # | Test | Steps | Expected Result | Pass? |
|---|------|-------|-----------------|-------|
| AP1 | Full lifecycle: online booking | Customer books on website → pays → gets confirmation email + WA → signs waiver → admin sees booking → day-before reminder fires → admin checks in guest → review request sends → booking marked COMPLETED | All steps succeed end-to-end | |
| AP2 | Full lifecycle: admin booking | Admin creates booking → sends payment link → customer pays → confirmation sent → invoice generated → admin cancels → refund processed | All steps succeed end-to-end | |
| AP3 | Full lifecycle: weather cancel | Admin creates slots → customers book → weather turns bad → admin weather-cancels slots → all customers notified → refunds processed → next day: admin reopens slots | All steps succeed end-to-end | |
| AP4 | Full lifecycle: voucher | Customer buys gift voucher → recipient gets email → recipient redeems on new booking → partial balance remains → balance email sent | All steps succeed end-to-end | |
| AP5 | Full lifecycle: marketing | Admin imports contacts → creates template → sends campaign → opens tracked → clicks tracked → unsubscribe works → automation enrolls post-booking contacts | All steps succeed end-to-end | |
| AP6 | Full lifecycle: new tenant | Super admin onboards new business → admin logs in → configures WA + Yoco → creates tours + slots → first customer books successfully | All steps succeed end-to-end | |
| AP7 | Full lifecycle: combo booking | Partner invited → partnership accepted → combo offer created → customer books combo → pays via Paysafe → both bookings created → both operators notified → invoice shows split | All steps succeed end-to-end | |
| AP8 | Full lifecycle: marketing automation | Create Welcome Series automation → activate → add new contact → first email sends → delay elapses → voucher generated → conversion email sends → enrollment completed | All steps succeed end-to-end | |
| AP9 | Full lifecycle: promo campaign | Create promo code → create email template with {promo_code} → send campaign → customer uses promo at checkout → discount applied → promo usage tracked | All steps succeed end-to-end | |
| AP10 | Full lifecycle: landing page | Configure business branding → select template → deploy to Firebase → landing page loads → customer clicks Book Now → completes booking on booking site | All steps succeed end-to-end | |
| AP11 | Full lifecycle: OTA channel | Enable Viator → map products → availability syncs → customer books on Viator → webhook creates local booking → reconciliation shows match | All steps succeed end-to-end | |
| AP12 | Full lifecycle: guide day | Guide logs in → views today's slots → checks in guests → uploads photos → sends thank-you → photos emailed to customers | All steps succeed end-to-end | |
| AP13 | Full lifecycle: bot mode toggle | Admin sets bot to OUTSIDE_HOURS → customer messages during hours → goes to inbox → customer messages after hours → bot replies → admin switches to OFF → all messages go to inbox | All steps succeed end-to-end | |

---

## ROUTE REFERENCE — MANUAL TESTING URLs

### Admin Dashboard (localhost:3000)

| Route | Page |
|-------|------|
| `/` | Dashboard |
| `/bookings` | Booking list |
| `/bookings/[id]` | Booking detail |
| `/new-booking` | Create booking |
| `/slots` | Slot calendar |
| `/refunds` | Refund queue |
| `/inbox` | WhatsApp + web chat inbox |
| `/vouchers` | Gift vouchers |
| `/invoices` | Invoice list |
| `/weather` | Weather monitor |
| `/photos` | Trip photos |
| `/broadcasts` | Bulk messaging |
| `/pricing` | Peak pricing |
| `/reports` | Analytics |
| `/reviews` | Review moderation |
| `/marketing` | Campaign dashboard |
| `/marketing/contacts` | Contact list |
| `/marketing/templates` | Email templates |
| `/marketing/automations` | Automation list |
| `/marketing/automations/[id]` | Automation detail |
| `/marketing/promotions` | Promo codes |
| `/billing` | Subscription billing |
| `/settings` | Business settings |
| `/settings/chat-faq` | Chat FAQ editor |
| `/settings/ota` | OTA channel config |
| `/operators` | Operator list |
| `/guide` | Guide dashboard |
| `/guide/slot/[slotId]` | Guide slot detail |
| `/guide/photos/[slotId]` | Guide photo upload |
| `/ota-drift` | OTA reconciliation (super admin) |
| `/super-admin` | Tenant management (super admin) |
| `/super-admin/data-requests` | POPIA requests (super admin) |
| `/change-password` | Password change |
| `/popia/confirm` | POPIA confirmation |
| `/embed/embed/availability` | Embeddable widget |

### Booking Site (localhost:3001 or subdomain.bookingtours.co.za)

| Route | Page |
|-------|------|
| `/` | Tour listing + booking widget |
| `/book` | Booking checkout |
| `/combo/[id]` | Combo booking checkout |
| `/voucher` | Gift voucher purchase |
| `/voucher-success` | Voucher payment success |
| `/voucher-confirmed` | Voucher confirmed |
| `/success` | Booking success |
| `/cancelled` | Payment cancelled |
| `/my-bookings` | Customer self-service |
| `/waiver` | Indemnity waiver form |
| `/review/[token]` | Review submission |
| `/embed` | Embeddable booking widget |
| `/auth/callback` | Auth callback |
| `/privacy` | Privacy policy |
| `/terms` | Terms & conditions |
| `/cookies` | Cookie policy |

### Landing Pages (static HTML)

| Template | File |
|----------|------|
| Adventure | `public/landing-pages/templates/adventure.html` |
| Coastal | `public/landing-pages/templates/coastal.html` |
| Dark | `public/landing-pages/templates/dark.html` |
| Luxury | `public/landing-pages/templates/luxury.html` |
| Minimal | `public/landing-pages/templates/minimal.html` |
| Modern | `public/landing-pages/templates/modern.html` |
| Retro | `public/landing-pages/templates/retro.html` |
| Safari | `public/landing-pages/templates/safari.html` |
| Tropical | `public/landing-pages/templates/tropical.html` |

---

## SIGN-OFF

| | |
|---|---|
| **Tested by** | _________________________ |
| **Date** | _________________________ |
| **Total passed** | ______ / 310 |
| **Blockers found** | _________________________ |
| **Notes** | _________________________ |
| **Production ready** | Yes / No |
