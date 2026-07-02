# BookingTours — Operator User Manual

**Your complete guide to running your business on BookingTours.**

This manual is written for the people who run a tour/activity business day-to-day: owners, managers, and front-desk staff. It explains every feature, where to find it, and exactly how to use it. If you are brand new, start with **Part 1 — Getting Started**, then keep this manual handy as a reference.

> **What is BookingTours?** An all-in-one booking platform for adventure and tourism operators. It gives you an admin dashboard (to manage everything) and a branded customer booking website (where your customers book and pay). Payments, WhatsApp/email messaging, waivers, marketing, and reporting are all built in.

---

## Table of Contents

**Part 1 — Getting Started**
1. Logging in
2. Understanding your role
3. First-time setup checklist

**Part 2 — Daily Operations**
4. Dashboard
5. Bookings
6. New Booking (manual bookings)
7. Slots (your calendar)
8. Guide mode & check-in
9. Pending Reschedules

**Part 3 — Money**
10. Refunds
11. Vouchers
12. Invoices
13. Peak Pricing
14. Billing (your subscription)

**Part 4 — Talking to Customers**
15. Inbox (WhatsApp & web chat)
16. Broadcasts
17. Notifications
18. Reviews
19. Photos
20. Weather & weather cancellations

**Part 5 — Marketing**
21. Marketing hub
22. Contacts
23. Email templates & campaigns
24. Automations
25. Promotions (promo codes)

**Part 6 — Setup & Configuration**
26. Settings overview
27. Tours & activities
28. Add-ons
29. Shared resources
30. Booking site branding
31. Email customisation
32. Invoice & banking details
33. Refund policies
34. Integration credentials (Yoco, WhatsApp, Google Drive)
35. Chat FAQ (chatbot answers)
36. Team members (admin users)

**Part 7 — Reference**
37. Customers (CRM)
38. Reports & exports
39. Data requests (POPIA)
40. What your customers experience
41. Troubleshooting
42. Glossary

---

# Part 1 — Getting Started

## 1. Logging in

Your admin dashboard lives at your admin web address (provided when your account was created). To sign in:

1. Go to the admin dashboard URL.
2. Enter your email address and request a **magic link** (a one-time sign-in link emailed to you), or sign in with the **password** you set from your invitation link.
3. If you were just invited, open the **setup email**, click the link, and create a password (minimum 8 characters). You are then signed straight into the dashboard.

**Forgot your password?** On the sign-in screen use "Forgot password" (or go to **Change Password**), enter your email, and request a fresh reset link. Setup/reset links expire after a short window — if yours has expired, just request a new one.

**Changing your password later:** Open **Change Password** from the menu, enter your current password and a new one.

## 2. Understanding your role

Every team member has one of three roles. Your role decides what you can see and do:

| Role | What they can do |
|---|---|
| **Operator** | Day-to-day work: bookings, inbox, manifest/check-in, refunds, marketing, photos, weather. Cannot open Settings, Billing, Notifications, or team management. |
| **Main Admin** | Everything an Operator can do, **plus** Settings, Billing, team management, integrations, invoices, and data requests. Full control of your business. |
| **Super Admin** | Platform staff at BookingTours (not a tenant role). Covered in the separate Super Admin Manual. |

**Important:** Menu items you don't have permission for are hidden, and the system also blocks access if you try to reach them by URL. A Main Admin can grant a regular admin access to **specific Settings sections** without making them a full Main Admin (see Section 36).

## 3. First-time setup checklist

If you're setting up a brand-new business, do these in order. Each links to its full section below.

1. **Add your tours** — Settings → Tours & Activities (Section 27). Create each activity and auto-generate time slots.
2. **Brand your booking site** — Settings → Booking Site Config (Section 30). Logo, colours, hero text, contact details.
3. **Connect payments** — Settings → Integration Credentials (Section 34). Add your Yoco keys so customers can pay by card.
4. **Set your cancellation policy** — Settings → Refund Policies (Section 33).
5. **Add invoice & banking details** — Settings → Invoice Details (Section 32).
6. **Connect WhatsApp** (optional but recommended) — Settings → Integration Credentials (Section 34).
7. **Invite your team** — Settings → Admin Users (Section 36).
8. **Do a test booking** on your booking site (use Yoco test mode first — Section 34).

---

# Part 2 — Daily Operations

## 4. Dashboard

**Where:** The home screen (the logo/house icon), available to everyone.

Your dashboard is mission control for the day. At the top you'll see quick figures:

- **Revenue** for today, the last 7 days, and this month (counted by trip date, and only for paid/confirmed/completed bookings).
- **Today's guests (pax)** and number of trips.
- **Pending refunds** awaiting your action, with the total amount.
- **Inbox** — how many conversations are waiting for a human reply.
- **Photos out** — trips in the past week that still have no photos sent.

Below that:

- **Today's Manifest** (left) — your day broken down by time slot, showing tour name, total guests, and how many are checked in. Click a slot to load it into Roll Call. You can toggle between **Today** and **Tomorrow**.
- **Roll Call** (right) — the live check-in list for the selected slot. Tick a guest to check them in; the row turns green immediately. It shows each guest's name, phone, party size, any add-ons, and status. The slot auto-advances about 4 minutes after the start time, or you can move between slots manually and press **Auto** to resume automatic advancing.
- **Weather** — Windguru/Windy forecast widgets for your locations. Use **Manage Locations** to add a spot (enter a name and it auto-finds the coordinates), set a default, or remove one.

**Tips**
- Revenue is bucketed by **trip date** (when the tour runs), not when the booking was made.
- Check-in is saved instantly and synced live — closing the page won't lose anything.
- Cancelled bookings and expired holds are excluded from the guest counts so numbers stay honest.

## 5. Bookings

**Where:** **Bookings** in the menu. Everyone can view; Main Admins can perform actions.

This is the master list of every booking. Use the left sidebar to pick a **date range** (or jump to a whole month) and filter by **status** (All, Pending, Paid, Confirmed, Completed, Cancelled). The header shows total guests and revenue for what you're viewing. Bookings are grouped by day and then by time slot, with running totals per group.

### Per-booking actions
Open a booking (or use its row buttons) to:

- **Rebook / Reschedule** — move the booking to a new slot. If the new slot costs more, a payment link is sent for the difference; if it costs less, you choose to refund the difference or issue a voucher. Only slots for the same tour with enough capacity are offered.
- **Cancel** — cancels the booking and releases the seats. For paid card bookings you choose **refund to card** or **issue a voucher**; refund amounts follow your configured refund policy (Section 33).
- **Mark as Paid** — record a cash, EFT, or in-person card payment, with an optional reference note. Use this when a customer pays you outside the online checkout.
- **Send Payment Link** — for an unpaid pending booking, generate a Yoco checkout link and send it by email + WhatsApp.
- **Reduce Guests** — lower the party size; the difference is refunded or issued as a voucher, and a seat is returned to the slot.
- **Resend Invoice** — email the invoice to the customer.
- **Check in** — mark the party present.

### Bulk actions
Tick multiple bookings (or "select all") to **Bulk Cancel**, **Bulk Refund**, **Bulk Mark Paid**, or **Bulk Check-in**. Each runs with a confirmation and shows progress row-by-row.

### Booking detail page
Clicking a booking opens its full record: customer details (editable), tour & schedule, full price breakdown (with promo and voucher shown separately), add-ons, **waiver status** (with participant dates of birth and guardian info for minors), the Yoco transaction, any payment-hold countdown, cancellation/refund details, and an **activity timeline** of everything that has happened.

**Tips**
- Editing a customer's details or changing price/quantity **invalidates any existing payment link** — you'll be warned, and you can resend a fresh link.
- Pending reschedules that are awaiting an upgrade payment show a badge with the hold time remaining.

## 6. New Booking (manual bookings)

**Where:** **New Booking** in the menu (Main Admin).

Use this to take a booking yourself — a walk-up, a phone booking, or a comp.

1. **Activity details** — pick the tour, enter adults/children, and choose a date. A 5-day availability grid appears; green cells are bookable, red are full. Click a cell to select the slot.
2. **Slot & status** — confirm the slot and set the status: **Pending** (holds the seats and sends a payment link), **Held**, **Confirmed**, or **Paid**. For Pending, choose a hold length (2–48 hours).
3. **Add-ons** — set quantities for any extras.
4. **Custom fields** — fill any extra fields you've configured (e.g. dietary needs).
5. **Customer details** — name, mobile (international format, e.g. +27…), email.
6. **Price adjustment** — apply a promo code, or tick **manual override** to set a custom price with a required reason. (Promo and manual override can't be used together.)
7. Click **Create Booking**.

**What happens next:** an invoice is created. If the booking is Pending with an email and a balance due, a payment link is auto-sent by email + WhatsApp. If it's Paid/Confirmed, a confirmation is sent instead.

**Tips**
- South African mobiles starting with 0 are auto-converted to +27.
- Add-ons are included in promo discount maths, so staff discounts stay consistent.

## 7. Slots (your calendar)

**Where:** **Slots** in the menu. Everyone can view; Main Admins can edit.

Slots are the bookable time-and-capacity containers for each tour. The calendar shows a Week or Day view (Day is used on phones).

- **Add Slot** — pick a tour, time, date range, capacity, and optional price override. Slots are created for every day in the range at that time.
- **Bulk Edit** — change time, capacity, or price for many matching slots at once.
- **Bulk Generate** — a wizard for creating recurring slots in bulk.
- **Cancel Day(s) / Reopen Day(s)** — tick day headers to close (or reopen) whole days. Closing a day cancels its bookings and notifies customers.
- **Edit a slot** — click it to change status (Open/Closed), time, capacity, or price override, or to run a **weather cancel** for just that slot.
- **Show closed / 0-capacity toggle** — hidden by default to reduce clutter; switch on to manage them.

**Tips**
- Changing a slot's time can optionally move all future slots at that same time.
- Closing a slot atomically cancels its active bookings and notifies those customers by email + WhatsApp.
- Leave the price override blank to use the tour's base price.

## 8. Guide mode & check-in

**Where:** **Guide** in the menu — a mobile-friendly view for staff on the water/on-site.

- **Guide home** lists today's slots (you can change the date) with guest count and remaining capacity. Tap a slot to open its check-in list.
- **Check-in** shows every guest sorted by name, with party size, a tappable phone number, add-ons, any dietary note, and **waiver status** (green = signed). Tap **Check in** and the row turns green. **This works offline** — if you lose signal, check-ins are queued on the device and sync automatically when you're back online.
- **After the trip**, tap the photos button to open the photo uploader for that slot (take/pick photos, upload, and send a thank-you email with the gallery link to the confirmed guests).

## 9. Pending Reschedules

**Where:** **Pending Reschedules** in the menu (Main Admin).

When a customer reschedules to a more expensive slot, the booking waits here until they pay the difference. Each row shows the customer, the destination slot, the upgrade fee, and how long the seat hold has left. Use **Re-send link** to send the payment link again (by email + WhatsApp). Expired holds are greyed out but a late payment can still be processed.

---

# Part 3 — Money

## 10. Refunds

**Where:** **Refunds** in the menu (Main Admin).

This is your refund queue. Each pending refund shows the customer, tour, date, amount paid, and cancellation reason.

- **Auto Refund** — refund back to the customer's card via Yoco. You can edit the amount first for a partial refund. The customer is notified by WhatsApp + email.
- **Manual Refund** — record a refund you're paying another way (e.g. EFT/cash). Marks it processed without calling Yoco.
- **Decline** — reject a refund request with a reason; the customer is emailed.
- **Refund All** — appears when there are several pending; processes them one after another.

Statuses you'll see: **Requested**, **Action Required**, **Processed**, **Failed**, **Declined**. Processed/declined refunds move into a collapsible history at the bottom.

**Tips**
- "No Yoco checkout ID" means the booking wasn't paid by card online — use Manual Refund.
- Refund amounts follow your **refund policy tiers** (Section 33) unless you override the amount.

## 11. Vouchers

**Where:** **Vouchers** in the menu (Main Admin).

Create and track gift vouchers / credits.

1. Click to create a voucher: set the recipient name, **buyer email (required)**, an optional tour, the **value**, and an optional gift message. An 8-character code is generated.
2. Click **Send payment link** — the buyer receives an email link and pays by card. **Once paid, the voucher becomes Active** and can be redeemed at checkout.
3. Search and filter by code, name, date, or status (**Active, Redeemed, Pending, Expired**).

**Tips**
- A voucher stays **Pending** until the buyer pays — that's why the buyer email is required.
- Vouchers are valid for **3 years** and can be applied to any booking. Customers redeem them themselves during booking; there's no manual redemption step.

## 12. Invoices

**Where:** **Invoices** in the menu (Main Admin).

Pro-forma invoices are generated automatically when a booking is paid. Here you can:

- **Download** an invoice as a formatted HTML file, or **Print / save as PDF**.
- **Resend** the invoice by email to the customer.
- **Sort** by booking date or invoice-created date, and filter by a specific day.

Each invoice includes your company details, VAT breakdown (15%), the service line, amount paid, balance due, and your banking details. A dashboard figure shows total outstanding across all invoices.

**Tip:** If invoices look incomplete, set your company and banking details in **Settings → Invoice Details** (Section 32).

## 13. Peak Pricing

**Where:** **Peak Pricing** in the menu (Main Admin).

Charge more during busy seasons without touching your base prices.

- **Base vs peak price** — set each tour's everyday price and its peak-season price; the difference (uplift) is shown for reference.
- **Set a peak period** — enter start/end dates, an optional label (e.g. "Christmas Peak"), an optional priority (higher wins if periods overlap), and the peak price per tour. Click **Apply Peak Pricing**. Existing slots in that range are updated **except** those with confirmed/paid bookings (already-booked customers keep their price).
- **Remove a peak period** — reverts affected slots to base pricing.

**Tips**
- If no slots exist yet for the dates, the rule still saves and applies when you create those slots later.
- Manually price-overridden slots are never overwritten by peak pricing.

## 14. Billing (your subscription)

**Where:** **Billing** in the menu (Main Admin only).

Manage your BookingTours subscription.

- **Current plan** — your plan name, status, monthly price, seats purchased vs. active team members, and this month's running cost.
- **Seats** — add or remove team seats; charges/credits are pro-rated for the rest of the billing cycle.
- **Pause / Resume** — pause for the off-season. While paused you're not billed and your team can still sign in and view data, but new bookings, marketing, and broadcasts are disabled. Resume any time.
- **Email usage** — if your plan includes email marketing, you'll see emails sent vs. included and any overage.
- **Billing history** — past charges and credits with status.

> **Important:** If your subscription is **suspended** (e.g. for non-payment), your team loses access to the dashboard's working features — but you can still reach the **Billing** page to reactivate. Super Admin (platform staff) controls suspension.

---

# Part 4 — Talking to Customers

## 15. Inbox (WhatsApp & web chat)

**Where:** **Inbox** in the menu (Operator and above).

All customer conversations from WhatsApp and your website chat land here. Your AI assistant (the "bot") handles routine questions and booking changes automatically; when a customer needs a person — or you jump in — the conversation appears in your Inbox.

- Click a conversation to read the thread and reply. Replies go out over WhatsApp (if the customer messaged you first).
- Once you reply, you have a **2-hour window** to keep chatting before the bot may take over again.
- Use **Return to Bot** to hand control back; the conversation moves to your **Chat History**.
- A **banner** warns you if bot mode is off (every message then comes straight to the Inbox).

**Good to know**
- WhatsApp only lets you message a customer freely for **24 hours** after their last message (a Meta rule). The system warns you when you're outside that window.
- The bot automatically escalates sensitive situations to you — medical emergencies, legal threats, accessibility questions, data requests, fraud claims, or an explicit "talk to a human".

## 16. Broadcasts

**Where:** **Broadcasts** in the menu (Operator and above).

Send a message to everyone booked on chosen trips.

1. **Pick trips** — the calendar shows days with bookings; click a day and tick the slots you want.
2. **Write your message** — use `{name}` to personalise. Rich formatting shows in email; WhatsApp gets a plain-text version.
3. **Send** — you'll see who's affected and, after sending, an honest delivery count ("WhatsApp: X of Y delivered · Email: X of Y"), with reasons for any failures.

There's also a **Weather mode** that closes the selected slots, cancels the bookings, and sends customers their self-service options (reschedule / voucher / refund).

## 17. Notifications

**Where:** **Notifications** in the menu (Main Admin).

This is your outbound WhatsApp queue. The system retries failed messages automatically; anything that still fails lands here.

- **Failed** — exhausted automatic retries. Click **Retry** to re-queue for the next send cycle (runs every few minutes).
- **Waiting for window** — couldn't send because you're outside the customer's 24-hour WhatsApp window; these go out once the customer replies.
- **Recent sent** — your last 100 outbound messages.

## 18. Reviews

**Where:** **Reviews** in the menu (Operator and above).

Moderate customer reviews before they go public. Filter by **Pending, Approved, Hidden, Spam**. For each review you can **Approve** (publish), **Hide**, or mark **Spam**. Review requests are sent automatically after trips; replies appear here as Pending for your approval.

## 19. Photos

**Where:** **Photos** in the menu (Operator and above).

Share trip photos with customers.

1. Pick a recent trip (last 7 days) from the left.
2. Upload photos — directly to **Google Drive** if you've connected it (Section 34), or paste share links from Drive/Dropbox/any host.
3. Click **Send Photos to Lead Bookers** — the lead booker on each booking gets a WhatsApp nudge and a thank-you email with the gallery link.

A "Recently Sent" list shows past photo batches.

## 20. Weather & weather cancellations

**Where:** **Weather** in the menu (Operator and above).

- View a live **Windguru** forecast for your locations.
- See upcoming slots with bookings for the next 7 days.
- To cancel for weather: enter a reason and click **Cancel and notify all** on a slot (or **Cancel all slots**). The system closes the slot, cancels the bookings, returns capacity, sends WhatsApp + email with self-service options, and queues refunds according to your policy.

You can also trigger weather cancellations from **Slots** (Section 7) and **Broadcasts** (Section 16).

---

# Part 5 — Marketing

## 21. Marketing hub

**Where:** **Marketing** in the menu (Operator and above).

Your marketing overview: active contacts, templates, lifetime emails sent, and campaign counts, plus this month's **email usage** against your plan's included amount. Charts show campaign performance, open/click/unsubscribe rates, and audience breakdown. Quick links jump to Contacts and Templates.

## 22. Contacts

**Where:** **Marketing → Contacts**.

Your subscriber list.

- **Add a contact** — email (required), name, phone, tags, and optional date of birth (which can trigger a birthday automation).
- **Import** — upload a CSV/Excel file; the importer auto-maps columns, previews, skips duplicates, and enrols new contacts into matching automations.
- **Tag** contacts to segment them and trigger automations.
- **Statuses:** Active, Unsubscribed, Bounced, Inactive. Unsubscribed and bounced contacts are automatically excluded from sends.

## 23. Email templates & campaigns

**Where:** **Marketing → Templates**.

- **Create a template** with the visual builder (text, image, button blocks) and personalisation like `{first_name}` and `{business_name}`.
- **Send a test** to yourself first.
- **Send a campaign** — name it, set the subject, choose **immediate or scheduled** (in your business timezone), and target **all active contacts** or specific **tags**.
- Campaign statuses: Draft, Scheduled, Sending, Done, Paused, Cancelled.

**Tip:** Unsubscribed contacts are always excluded, even if tagged.

## 24. Automations

**Where:** **Marketing → Automations**.

Automated email sequences triggered by events.

- **Triggers:** contact added, tag added, **after a booking** (confirmed/paid), a date field (e.g. birthday), or manual.
- **Steps:** send an email, wait a delay, branch on whether the previous email was opened, or **generate a discount voucher/code**.
- **Control:** Draft → Active → Paused → Archived. Active automations enrol matching contacts automatically and show enrolled/completed counts.

Pre-built examples include a welcome series, post-tour review request, win-back, and birthday special.

## 25. Promotions (promo codes)

**Where:** **Marketing → Promotions**.

Create discount codes for checkout.

- Set the **code** (or generate one), a description, **flat or percentage** discount, valid-from/until dates, optional **max uses**, and an optional **minimum order amount**.
- Toggle **Active** to enable/disable without deleting.
- Usage is tracked ("Used 23/50"); a code stops working once it hits its cap or end date.

---

# Part 6 — Setup & Configuration

## 26. Settings overview

**Where:** **Settings** in the menu (Main Admin, or a regular admin granted specific sections).

Settings is where you configure everything about your business. Sections include: Admin Users, Tours & Activities, Booking Add-Ons, Shared Resources, External Booking, Booking Site Config, Email Customisation, Invoice Details, Refund Policies, Integration Credentials, and operational content (what to bring/wear, arrival info, FAQs, chatbot). Each is covered below.

> A Main Admin can grant a regular admin access to individual sections (e.g. only Tours). Banking details and team management always stay Main-Admin-only.

## 27. Tours & activities

**Where:** Settings → Tours & Activities.

- **Add a tour** — name, description, cover image (max 5 MB), price per person, duration, and default capacity. Tick **Active** to show it on your booking site.
- **Auto-generate slots** while creating a tour — set a date range, one or more start times, and the days of the week; the system creates a slot per matching day.
- **Edit / reorder** — drag tours to change their order on the booking site; edit any tour's details.
- **Activate/Deactivate** and **Show/Hide** control public visibility.
- **Delete** — removes the tour and its slots (blocked if there are active unredeemed vouchers tied to it).

## 28. Add-ons

**Where:** Settings → Booking Add-Ons.

Optional paid extras (e.g. wetsuit, photos). Add a name, optional description and image, and a price (can be 0). Tick **Active** to show it in checkout, drag to reorder, and deactivate or delete as needed. Existing bookings keep any add-ons even if you later deactivate them.

## 29. Shared resources

**Where:** Settings → Shared Resources.

Model equipment or capacity shared across tours (e.g. a fleet of kayaks or minibus seats).

1. **Create a resource** — name, type, and total capacity.
2. **Map it to tours** — set how many units each guest consumes (e.g. 1 kayak per guest). The system then limits bookings so you never oversell the shared pool.

## 30. Booking site branding

**Where:** Settings → Booking Site Config.

Control how your customer booking site looks and reads:

- **Business profile** — name, tagline, logo.
- **Branding & colours** — your colour palette, chatbot avatar, and hero section text.
- **Footer & social** — footer text, public contact details, and social links.
- **Navigation & labels** — your booking site URL, "Manage Bookings" and gift-voucher links, and custom button labels.
- **Policies & legal** — directions, terms & conditions, privacy and cookies policies.
- **Custom booking fields** — extra questions to collect at checkout.
- **Timezone** — used for slot times, email send times, and reports (use a valid timezone like `Africa/Johannesburg`).

## 31. Email customisation

**Where:** Settings → Email Customisation.

Upload header banner images for each type of transactional email (booking confirmation, payment receipt, invoice, gift voucher, cancellation, waiver, etc.), set your email accent colour, and add social links for the email footer. Click **Save Email Images** to apply. Changes take effect on the next email sent.

## 32. Invoice & banking details

**Where:** Settings → Invoice Details (Main Admin).

Set your company name, address, registration number and VAT number, plus your **banking details** (account owner, number, type, bank, branch code). Banking details are stored **encrypted**. These appear on invoices and payment receipts.

## 33. Refund policies

**Where:** Settings → Refund Policies.

Define time-based refund tiers, e.g. 48+ hours before = 100%, 24–48 hours = 50%, under 24 hours = 0%. Add a customer-facing policy text too. These tiers drive refund amounts everywhere — admin cancellations, customer self-service cancellations, and the WhatsApp/chat bot.

## 34. Integration credentials (Yoco, WhatsApp, Google Drive)

**Where:** Settings → Integration Credentials.

- **Yoco (card payments)** — paste your live secret key and webhook secret to accept card payments. Keys are stored encrypted.
- **Yoco Test Mode** — toggle on and add sandbox keys to test the full payment flow with test cards before going live. **Always test in test mode first.**
- **WhatsApp** — add your Meta WhatsApp access token and phone ID to enable WhatsApp messaging.
- **Google Drive** — connect an account (OAuth) so trip photos upload straight to your Drive; disconnect any time.

## 35. Chat FAQ (chatbot answers)

**Where:** Settings → Chat FAQ (Main Admin).

Teach your chatbot instant answers to common questions.

1. Click **Add a quick answer**.
2. Choose a question type/category, write the question, list **trigger words** (any of which will match an incoming message), and write the reply.
3. Toggle answers on/off, edit, or delete. A counter shows how often each answer has been used.

If nothing matches, the bot falls back to broader answers; sensitive messages are always routed to a human.

## 36. Team members (admin users)

**Where:** Settings → Admin Users (Main Admin).

- **Add an admin** — enter their name and email; they receive a secure setup link to create a password.
- **Permissions** — for a regular admin, grant access to specific Settings sections (e.g. Tours only).
- **Resend setup link** or **Remove** an admin as needed.
- Choose which admin receives **marketing test emails**.

---

# Part 7 — Reference

## 37. Customers (CRM)

**Where:** **Customers** in the menu (everyone).

A read-only list of everyone who has booked with you: name, email, phone, number of trips, total spent, last trip date, and marketing opt-in. Search by name, email, or phone. To act on a customer, open their bookings; customer records are created automatically on first booking.

## 38. Reports & exports

**Where:** **Reports** in the menu (everyone).

Filter by date range and status, and choose whether the date means **tour date** or **booking date**. Tabs give you different views: **Bookings, Financials, Marketing** (bookings by source), **Attendance** (check-ins), and **Waivers** (signature compliance). Summary cards and a chart sit above a full data table. Export any view to **CSV** or **PDF**.

**Tip:** Only paid/confirmed/completed bookings count as revenue. Large ranges are capped at 2,000 rows per query.

## 39. Data requests (POPIA)

**Where:** **Data Requests** in the menu (Main Admin).

Handle customer privacy requests under POPIA. Requests are grouped by status (Action Required, Pending, Fulfilled, Rejected, Cancelled). For each you can **Export** the person's data (for access requests), **Fulfil** a deletion (permanently anonymises personal data while keeping financial records for audit), or **Reject** with a reason. Deletion requests have a mandatory 30-day cooling-off period; unconfirmed requests expire after 24 hours.

## 40. What your customers experience

Your customers use your branded booking site at your subdomain (e.g. `yourname.booking.bookingtours.co.za`). Here's their journey, so you know what they see:

- **Browse & book** — they pick a tour, choose a date and time (shown in your timezone, with "spots left" urgency), set guests, add extras, and apply a promo code or gift voucher. A **15-minute seat hold** protects availability while they pay.
- **Pay** — they're taken to Yoco's secure checkout. On success they reach a **confirmation page** with their reference, a **Sign Waiver Now** button, meeting-point info, calendar links, and an option to book again or gift a voucher.
- **Waivers** — a digital waiver with medical/mobility notes and per-participant dates of birth; if a minor is detected, guardian consent is required. Waivers can't be signed twice.
- **Gift vouchers** — customers can buy a gift voucher (choose an amount, add a message), pay, and the recipient gets an 8-character code valid for 3 years.
- **My Bookings self-service** — customers sign in with a one-time email code and can view bookings, **reschedule**, **cancel** (seeing the refund your policy allows), **edit guest numbers**, check a voucher balance, leave a review, and view trip photos. After a weather cancellation they can choose reschedule, voucher, or refund here.
- **Embeddable widget** — you can embed the whole booking flow on your own website with a small snippet:
  ```html
  <div id="bookingtours-widget" data-tenant="your-subdomain"></div>
  <script src="https://booking.bookingtours.co.za/widget.js" async></script>
  ```

## 41. Troubleshooting

| Problem | What to check |
|---|---|
| Can't sign in | Use the magic link or request a fresh password-reset link; links expire quickly. |
| A menu item is missing | Your role or per-section permissions don't include it. Ask a Main Admin. |
| Customers can't pay | Confirm your Yoco keys are saved in Settings → Integration Credentials, and that you're not still in Test Mode for live customers. |
| Image upload fails | Use a file under 5 MB in JPG/PNG/WebP/GIF/SVG format. |
| WhatsApp message won't send | You're likely outside the customer's 24-hour window — it will send once they reply. Check Notifications. |
| Invoice looks incomplete | Set company + banking details in Settings → Invoice Details. |
| Report numbers look off | Check the date filter and whether it's set to "tour date" vs "booking date". |
| Dashboard access blocked / "subscription suspended" | Your subscription is suspended — open **Billing** to reactivate, or contact BookingTours. |

## 42. Glossary

- **Slot** — a specific tour at a specific date/time with a capacity. Can be Open or Closed.
- **Hold** — a temporary reservation of seats while a customer pays (about 15 minutes, with a short grace window).
- **Pax** — number of guests/passengers.
- **Manifest / Roll Call** — the guest list for a slot, used for check-in.
- **Add-on** — an optional paid extra selected at booking.
- **Voucher** — prepaid credit (gift voucher), valid 3 years, redeemable against bookings.
- **Promo code** — a discount code (percentage or fixed amount) applied at checkout.
- **Peak pricing** — higher prices for defined busy periods.
- **Booking statuses** — Draft, Pending, Held, Confirmed, Paid, Completed, Cancelled.
- **Refund statuses** — Requested, Action Required, Processed, Failed, Declined.
- **Waiver** — the digital liability/medical form each guest completes before the trip.

---

*BookingTours Operator User Manual · last updated 2026-07-02. For platform administration (creating and managing tenant businesses), see the Super Admin Manual.*
