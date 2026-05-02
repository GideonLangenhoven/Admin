# BookingTours — 5-Minute Onboarding Call Script

> For the person running the setup call with a new operator.
> Goal: operator has a working dashboard and has sent their first real booking within 5 minutes.

---

## Before the Call (30 seconds)

Open these in tabs:
1. **Super Admin** — `admin-tawny-delta-92.vercel.app/super-admin`
2. **Onboarding Form** — have the link ready in case they want self-service later
3. A blank notepad for their answers

---

## Part 1 — Ask Up Front (60 seconds)

Read these out and jot down answers. Don't skip any.

| # | Question | Why you need it |
|---|----------|-----------------|
| 1 | "What's the legal business name?" | Creates the tenant |
| 2 | "What email will the main admin log in with?" | First admin account |
| 3 | "What's your mobile number?" | WhatsApp notifications |
| 4 | "What timezone are you in?" | Slot times display correctly |
| 5 | "Give me the name, price, and duration of your main tour/activity." | We create their first tour live |
| 6 | "What time slots do you run? e.g. 08:00, 10:30, 13:00" | Generate initial slots |
| 7 | "What's the max group size per slot?" | Sets default capacity |
| 8 | "Where do customers meet? Give me the address." | Meeting point for confirmations |

**That's it.** Everything else can be configured later in Settings.

---

## Part 2 — Set Up For Them (120 seconds)

Do this while they're still on the call. Talk them through what you're doing.

### Step 1: Create the business (30s)
- Go to **Super Admin > Onboard New Client**
- Fill in: business name, admin email, admin name, timezone, currency (ZAR)
- Click **Create Business**
- Say: *"I've just created your account. You'll get a password setup email in a moment."*

### Step 2: Create their first tour (30s)
- Go to **Settings > Tours & Activities**
- Click **+ New Tour**
- Enter: tour name, price, duration, capacity (from their answers)
- Set date range: today → 3 months out
- Enter their slot times
- Select operating days (Mon-Sun unless they specify)
- Click **Add Tour**
- Say: *"Your first tour is live with slots generated for the next 3 months."*

### Step 3: Quick branding (30s)
- Still in **Settings > Booking Site Configuration**
- Set business name + tagline
- Ask: *"Can you send me your logo on WhatsApp? I'll add it now."*
- If they have it ready, upload it. If not, skip — they can do it later.

### Step 4: Confirm their email arrived (30s)
- Ask: *"Check your email — you should have a password setup link from BookingTours."*
- Wait for them to confirm they see it.
- Say: *"Click that link and set your password. I'll wait."*
- Once they're in: *"Perfect — you're now logged into your dashboard."*

---

## Part 3 — Walk Through Together (90 seconds)

Now they're logged in. Give them a 90-second guided tour.

> "Let me show you the four things you'll use every day."

### 1. Dashboard (15s)
*"This is your home screen. Today's bookings, pending refunds, unread messages — all at a glance."*

### 2. New Booking (30s)
*"Let's create your first real booking together."*
- Click **+ New Booking**
- Pick the tour you just created
- Pick today or tomorrow's date
- Select a slot
- Enter: their name, their own phone number, their email
- Set status to **PAID**
- Click **Create Booking**
- Say: *"Check your email and WhatsApp — you should get a confirmation for that booking."*

### 3. Bookings list (15s)
*"Every booking lands here. You can filter, search, click into details, resend payment links, or cancel."*

### 4. Inbox (30s)
*"Your WhatsApp messages and web chat all arrive here. Customers can book, reschedule, and cancel directly through WhatsApp without you lifting a finger."*

---

## Part 4 — Leave Them To Do (30 seconds)

Before hanging up, tell them:

> "You're live. Here are three things to do when you have 10 minutes:"
>
> 1. **Upload your logo** — Settings > Booking Site Configuration
> 2. **Add your Yoco payment keys** — Settings > Integration Credentials (so online payments work)
> 3. **Share your booking link** — it's `booking-mu-steel.vercel.app?business=your-slug` — put it on your website, Instagram bio, or WhatsApp status

*"Everything else — vouchers, marketing emails, weather alerts, promo codes — is already built in. Explore when you're ready, or I can walk you through any of it on a follow-up call."*

---

## Part 5 — Confirm First Real Booking (30 seconds)

Before ending:

> "One last thing — did you get the confirmation email and WhatsApp for that test booking we just made?"

- If **yes**: *"That's exactly what your customers will see. You're all set."*
- If **no**: Check their spam folder. If still missing, verify the email address in the booking detail and check the admin inbox for errors.

End with:

> "You're live. Your booking link is ready to share. If anything comes up, just WhatsApp me."

---

## Checklist — Confirm Before Hanging Up

- [ ] Business created in Super Admin
- [ ] Admin received password setup email and logged in
- [ ] At least one tour created with slots
- [ ] First test booking created successfully
- [ ] Confirmation email received by operator
- [ ] Confirmation WhatsApp received by operator
- [ ] Operator knows where to upload logo
- [ ] Operator knows where to add Yoco keys
- [ ] Operator has their booking page URL

---

## If Something Goes Wrong

| Problem | Fix |
|---------|-----|
| Password email didn't arrive | Settings > Admin Users > click "Resend setup link" |
| Booking confirmation email missing | Check edge function logs for `send-email` errors |
| WhatsApp not sending | They need to add WhatsApp credentials in Settings > Integration Credentials |
| Slots not showing on booking page | Check the tour is set to Active and not Hidden |
| Payment link not working | Yoco credentials not configured yet — expected on first call |

---

*Total call time: ~5 minutes. Operator leaves with a working dashboard, their first booking sent, and three clear next steps.*
