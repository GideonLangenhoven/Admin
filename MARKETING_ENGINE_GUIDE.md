# Cape Kayak Marketing Engine — Complete Feature Guide

## Overview

The Marketing Engine is a built-in email marketing system accessible from the **Marketing** tab in the admin dashboard. It provides contact management, a visual email builder with 13 block types, campaign sending with tracking, automation workflows, usage billing, and list cleaning — all integrated with your existing Cape Kayak business.

**Navigation:** The Marketing section has 4 tabs:
- **Overview** — Dashboard with stats, usage, and campaign history
- **Contacts** — Manage your email list
- **Templates** — Build and manage email designs
- **Automations** — Set up automated email sequences

---

## 1. Overview Dashboard

**What it shows:** A read-only analytics view of your marketing activity.

### Top Stats (4 cards)
| Card | What it shows |
|------|--------------|
| Active Contacts | Count of active contacts + breakdown of unsubscribed/bounced |
| Templates | Total email templates you've created |
| Emails Sent | Lifetime total emails sent |
| Campaigns | Total campaigns created |

### Email Usage This Month
A progress bar showing how many of your included monthly emails you've used:
- **Below 80%** — Green bar, all good
- **80–99%** — Amber bar + warning: "Approaching limit"
- **100%+** — Red bar + overage alert showing cost (e.g. "23 extra emails = R3.45 at R0.15/email")

### Engagement Rates (shown after first campaign)
| Metric | Calculation |
|--------|------------|
| Open Rate | total opens ÷ total sent |
| Click Rate | total clicks ÷ total sent |
| Unsubscribes | Raw count |
| Bounced | Raw count |

### Recent Campaigns Table
Shows the last 20 campaigns with: name, status badge, sent/total recipients, opens, clicks, unsubscribes, and date. Status badges are color-coded (draft=gray, scheduled=violet, sending=blue, done=green, cancelled=red).

### Quick Actions
- **"+ Add Contacts"** → jumps to Contacts page
- **"+ Create Template"** → jumps to Templates page

---

## 2. Contacts Management

### Adding Contacts

**Single contact:** Click **"+ Add Contact"** → fill in:
- Email (required)
- First name, Last name (optional)
- Tags — comma-separated (e.g. "vip, kayaker")
- Date of Birth (optional — used for birthday automations)
- Anniversary Date (optional — used for anniversary automations)

**Bulk import:** Click **"Import CSV"** → paste rows in format:
```
email, first_name, last_name, date_of_birth, anniversary_date
john@example.com, John, Smith, 1990-05-15, 2020-06-01
jane@example.com, Jane, Doe,,
```
Duplicates are automatically skipped. The notification shows how many were imported vs skipped.

### Managing Contacts

**Search:** Filter by email, first name, or last name in real-time.

**Filter by status:** All / Active / Unsubscribed / Bounced / Inactive

**Filter by tag:** Select any tag to show only contacts with that tag.

**Inline tagging:** Click the small tag icon on any contact row → type a tag → press Enter. Tags are shown as blue pills. Click the "×" on any pill to remove that tag.

**Toggle status:** Click the status badge on any contact to toggle between Active and Unsubscribed.

**Delete:** Red trash icon removes the contact permanently.

### List Cleaning
Click **"Clean List"** to find stale contacts. A contact is considered stale if they:
- Are currently active
- Have received 5 or more emails
- Have zero opens ever

The modal shows all stale contacts. Click **"Deactivate X Contacts"** to set them all to "inactive" status — they'll be excluded from future campaigns without being permanently deleted.

### Auto-Enrollment
When you add a contact or add a tag, the system automatically checks for matching automations:
- Adding a new contact triggers any **"Contact Added"** automations
- Adding a tag triggers any **"Tag Added"** automations matching that tag

---

## 3. Email Templates & Builder

### Creating a Template

1. Go to **Templates** → click **"+ New Template"**
2. A gallery of 11 pre-built starter templates appears:

| Template | Best for |
|----------|---------|
| Blank | Starting from scratch |
| Welcome Email | New subscriber onboarding |
| Newsletter | Monthly updates with header, sections, CTA |
| Promotional Sale | Discount offers with countdown timer |
| Event Announcement | Event invitations with date/location |
| Booking Follow-up | Post-booking thank you |
| Birthday / Anniversary | Date-triggered personal offers |
| Re-engagement | Win back inactive contacts |
| Feedback Request | Post-experience surveys |
| Holiday Special | Seasonal promotions |
| Tour Showcase | Highlighting multiple tours with Tour Cards |

3. Select a template (or Blank) to open the **Email Builder**.

### The Email Builder

**Top bar:** Template name (required), subject line, and category dropdown.

**Block toolbar:** 13 block types you can add:

| Block | What it does |
|-------|-------------|
| **Text** | Rich text paragraph. Supports HTML (`<b>`, `<a>`, `<p>`) and `{first_name}` personalization |
| **Image** | Upload an image with alt text and width control |
| **Button** | Call-to-action button with custom text, URL, and color |
| **Divider** | Horizontal line separator |
| **Spacer** | Adjustable vertical space (4–200px) |
| **Header** | H1/H2/H3 heading with custom color |
| **Social** | Row of social media icons (Facebook, Instagram, WhatsApp, YouTube, TikTok, LinkedIn, Twitter/X) with links |
| **Video** | Video thumbnail with play button overlay. Auto-detects YouTube thumbnails |
| **Quote** | Styled testimonial with left accent border, italic text, attribution, and optional circular photo |
| **Columns** | 2 or 3 column layout. Each column can contain text, images, and buttons. Stacks vertically on mobile |
| **Countdown** | "Offer ends in X days Y hours" — set a target date and label |
| **Tour Card** | Image + tour title + price + CTA button in a bordered card |
| **Footer** | Company name, address, phone + social media icon row |

**Editing blocks:** Each block has a dedicated editor panel with relevant fields. Blocks can be:
- Dragged to reorder (grab the grip handle)
- Moved up/down with arrow buttons
- Deleted with the red trash icon

**Preview:** Toggle between Editor and Preview mode. In Preview mode, switch between:
- **Desktop** (600px width)
- **Mobile** (375px width, phone-shaped frame)

The preview shows exactly how the email will render in inboxes.

**Personalization:** Use `{first_name}` anywhere in text blocks — it's replaced with each contact's actual name when the email is sent.

**Save:** Click **"Save Template"** to save and return to the template grid.

### Template Actions

On each template card in the grid:

| Action | What it does |
|--------|-------------|
| **Edit** (pencil icon) | Opens the Email Builder |
| **Send** (send icon) | Opens the Send Campaign modal |
| **Test** (test tube icon) | Sends a test email to your own admin email address |
| **Duplicate** (copy icon) | Creates a copy named "Template Name (copy)" |
| **Delete** (red trash icon) | Permanently deletes the template |

---

## 4. Sending Campaigns

Click **"Send"** on any template to open the campaign modal.

### Campaign Setup

| Field | Description |
|-------|-------------|
| **Campaign Name** | Required. Used for tracking (e.g. "March Newsletter") |
| **Subject Line** | Pre-filled from template. Override here for this campaign only |
| **Audience** | "All active contacts" or "Filter by tags" (select one or more tags) |
| **Schedule** | Leave empty to send immediately, or pick a future date/time |

The modal shows a live count: **"X contacts will receive this campaign"**

### Sending Options
- **Send Now:** Click "Send Campaign" — emails are queued and dispatched within a minute via the background cron job
- **Schedule:** Set a date/time → click "Schedule Campaign" (button turns violet). The campaign waits until the scheduled time

### After Sending
- Campaign appears in the Overview dashboard's Recent Campaigns table
- Track: opens, clicks, unsubscribes, bounces in real-time
- Each email includes an automatic tracking pixel (opens) and link rewriting (clicks)
- Each email includes an unsubscribe link at the bottom

---

## 5. Automations

Automations let you set up multi-step email sequences that run automatically when triggered.

### Creating an Automation

1. Go to **Automations** → click **"+ New Automation"**
2. Name it (e.g. "Welcome Series")
3. Choose a **Trigger Type**:

| Trigger | When it fires | Extra config |
|---------|--------------|-------------|
| **Contact Added** | When a new contact is added to your list | None |
| **Tag Added** | When a specific tag is added to a contact | Tag name field (e.g. "vip") |
| **Post Booking** | After a booking is confirmed | None |
| **Date Field** | On a contact's birthday or anniversary | Field selector + "Days Before" (e.g. 7 days before birthday) |
| **Manual** | Only when you manually enroll a contact | Enrollment search panel appears |

### Building Steps

Click the **"+"** button between steps to add:

| Step Type | What it does | Configuration |
|-----------|-------------|--------------|
| **Send Email** | Sends a template to the contact | Template dropdown + optional subject override |
| **Delay** | Waits before the next step | Duration + unit (minutes/hours/days) |
| **Condition** | Checks if the contact meets criteria | Opened Email / Clicked Link / Has Tag — if false, contact exits |
| **Generate Voucher** | Creates a unique voucher code | Type (% or fixed), amount, code prefix, validity days |

Steps can be reordered with up/down arrows and deleted with the trash icon.

### Template Variables in Automations

When a **Generate Voucher** step runs, it stores the voucher code and amount in the enrollment. The next **Send Email** step can use:
- `{first_name}` — Contact's first name
- `{last_name}` — Contact's last name
- `{email}` — Contact's email
- `{voucher_code}` — The generated voucher code (e.g. "BDAY-A3F92K")
- `{voucher_amount}` — The voucher value (e.g. "25" or "10%")

### Activating

Click **"Activate"** to make the automation live. You must have at least one step. Active automations can be paused and resumed at any time.

### Manual Enrollment

For **Manual** trigger automations, a search panel appears at the bottom of the builder. Search for a contact by email, then click **"Enroll"** to start them in the workflow immediately.

---

## 6. Use Cases for Clients

### Use Case 1: Welcome Series
**Goal:** Automatically welcome new contacts with a multi-email onboarding sequence.

**Setup:**
1. Create 3 email templates: Welcome, Getting Started, First Tour Offer
2. Create automation → Trigger: **Contact Added**
3. Step 1: Send Email → "Welcome" template
4. Step 2: Delay → 2 days
5. Step 3: Send Email → "Getting Started" template
6. Step 4: Delay → 5 days
7. Step 5: Generate Voucher → 10% off, prefix "WELCOME", valid 30 days
8. Step 6: Send Email → "First Tour Offer" template (uses `{voucher_code}`)
9. Activate

**Result:** Every new contact gets a 3-email welcome series spread over a week, ending with a personalized discount voucher.

---

### Use Case 2: Birthday Rewards
**Goal:** Automatically send a birthday discount 7 days before the contact's birthday.

**Setup:**
1. Create a "Birthday" email template with `{first_name}` and `{voucher_code}`
2. Create automation → Trigger: **Date Field** → Date of Birth → 7 days before
3. Step 1: Generate Voucher → 15% off, prefix "BDAY", valid 30 days
4. Step 2: Send Email → "Birthday" template
5. Activate

**Result:** Contacts with a date of birth on file automatically receive a personalized birthday email with a unique discount code, 7 days before their birthday, every year.

---

### Use Case 3: Post-Booking Follow-up
**Goal:** Send a thank-you email after a booking, then request a review 3 days later.

**Setup:**
1. Create 2 templates: "Thanks for Booking" and "Leave Us a Review"
2. Create automation → Trigger: **Post Booking**
3. Step 1: Send Email → "Thanks for Booking"
4. Step 2: Delay → 3 days
5. Step 3: Send Email → "Leave Us a Review"
6. Activate

**Result:** Every confirmed booking triggers a follow-up sequence automatically.

---

### Use Case 4: VIP Re-engagement
**Goal:** When a contact is tagged as "vip", send them an exclusive offer.

**Setup:**
1. Create a "VIP Exclusive" email template
2. Create automation → Trigger: **Tag Added** → Tag: "vip"
3. Step 1: Generate Voucher → R100 fixed, prefix "VIP", valid 60 days
4. Step 2: Send Email → "VIP Exclusive" template
5. Activate

**Result:** Tagging any contact as "vip" (from the contacts page) immediately triggers the exclusive offer.

---

### Use Case 5: Monthly Newsletter Campaign
**Goal:** Send a monthly newsletter to all active contacts.

**Setup:**
1. Create a "Newsletter" template (use the starter template as a base)
2. Edit it each month with updated content
3. From the template card, click **"Send"**
4. Campaign name: "March 2026 Newsletter"
5. Audience: "All active contacts"
6. Schedule for a specific date/time, or send immediately

**Result:** One-click send to your entire active list with full tracking.

---

### Use Case 6: Targeted Promotion by Tag
**Goal:** Send a promo to contacts tagged with "kayak" only.

**Setup:**
1. Create a promotional template
2. Click **"Send"** on it
3. Choose "Filter by tags" → select "kayak"
4. Confirm the recipient count
5. Send or schedule

**Result:** Only contacts with the "kayak" tag receive the email.

---

### Use Case 7: Seasonal Sale with Countdown
**Goal:** Create urgency with a limited-time offer.

**Setup:**
1. Create a template using the "Promotional Sale" starter
2. Add a **Countdown** block → set target date to sale end
3. Add a **Button** block → "Shop Now" linking to your booking page
4. Send as a campaign to all contacts or a tag segment

**Result:** Recipients see a live "Ends in X days Y hours" countdown in the email.

---

### Use Case 8: Tour Showcase Email
**Goal:** Highlight multiple tours in a single email.

**Setup:**
1. Create a template using the "Tour Showcase" starter
2. Add multiple **Tour Card** blocks — each with tour image, name, price, and "Book Now" CTA
3. Use **Columns** blocks to show 2 tours side by side
4. Send as a campaign

**Result:** A visually rich email showcasing your tours, each with a direct booking link.

---

### Use Case 9: Win Back Inactive Contacts
**Goal:** Re-engage contacts who haven't opened recent emails.

**Setup:**
1. Go to **Contacts** → click **"Clean List"** to review stale contacts
2. Before deactivating them, create a "We Miss You" automation:
   - Trigger: **Manual**
   - Step 1: Generate Voucher → 20% off, prefix "COMEBACK", valid 14 days
   - Step 2: Send Email → "We Miss You" template
3. Manually enroll each stale contact via the enrollment search panel
4. Wait for results — if they still don't engage, then clean the list

**Result:** One last chance to win back inactive contacts before removing them from your active list.

---

### Use Case 10: Anniversary Thank You
**Goal:** Celebrate the anniversary of a customer's first booking.

**Setup:**
1. When importing or adding contacts, include their **Anniversary Date** (e.g. first booking date)
2. Create automation → Trigger: **Date Field** → Anniversary Date → 0 days before
3. Step 1: Generate Voucher → 10% off, prefix "ANNIV", valid 30 days
4. Step 2: Send Email → "Happy Anniversary" template

**Result:** Contacts get an annual anniversary email with a personalized voucher, automatically.

---

## 7. Billing & Usage

### How it works
- Each business has an **included email allowance** (default: 500/month)
- Usage is tracked per calendar month
- The Overview dashboard shows your current usage with a progress bar

### Overage
- When you exceed your included allowance, overage charges apply (default: R0.15/email)
- Amber warning at 80% usage, red alert at 100%+
- Overage is automatically invoiced via the daily cron job

### Monitoring
- Check the **Overview** page regularly for the usage progress bar
- The exact count, included limit, and overage cost are all displayed

---

## 8. Tracking & Analytics

### What's tracked automatically
- **Opens:** Invisible tracking pixel in every email
- **Clicks:** All links are rewritten to pass through the tracking endpoint before redirecting
- **Unsubscribes:** One-click unsubscribe via signed token URL in every email footer
- **Bounces:** Hard/soft bounce detection

### Where to see analytics
- **Overview** → Engagement rate cards (aggregate across all campaigns)
- **Overview** → Recent Campaigns table (per-campaign opens, clicks, unsubscribes)
- **Contacts** → Engagement column per contact (received, opens, clicks)

### Unsubscribe handling
Every email automatically includes an unsubscribe link. When a contact unsubscribes:
- Their status changes to "unsubscribed"
- They're excluded from all future campaigns and automations
- The campaign's unsubscribe counter increments
- This is tracked as an event for analytics

---

## Quick Reference: Admin Dashboard Workflows

| I want to... | Go to... | Action |
|--------------|----------|--------|
| See my email stats | Overview | View dashboard |
| Check monthly usage | Overview | Check usage progress bar |
| Add a single contact | Contacts | Click "+ Add Contact" |
| Bulk import contacts | Contacts | Click "Import CSV" |
| Tag contacts | Contacts | Click tag icon on contact row |
| Clean inactive contacts | Contacts | Click "Clean List" |
| Create an email design | Templates | Click "+ New Template" |
| Edit an email design | Templates | Click pencil icon on template |
| Preview on mobile | Templates → Edit | Click Preview → Mobile icon |
| Send a test email | Templates | Click test tube icon |
| Send a campaign | Templates | Click send icon on template |
| Schedule a campaign | Templates → Send | Set a date in the Schedule field |
| Send to specific tags | Templates → Send | Choose "Filter by tags" |
| Create an automation | Automations | Click "+ New Automation" |
| Set up birthday emails | Automations | Trigger: Date Field → Date of Birth |
| Auto-welcome new contacts | Automations | Trigger: Contact Added |
| Auto-email after booking | Automations | Trigger: Post Booking |
| Generate voucher codes | Automations | Add "Generate Voucher" step |
| Manually enroll someone | Automations | Trigger: Manual → search & enroll |
| Pause an automation | Automations | Click pause icon or "Pause" button |
