# Getting Your Accounts Ready for BookingTours

Welcome! Before we can switch on card payments and WhatsApp messaging for your booking site, there are two accounts **only you** can set up, because they must be registered in your business's name:

1. **Yoco** — so customer card payments go straight into your bank account.
2. **Meta (Facebook) Business Manager + a WhatsApp number** — so booking confirmations and the chat assistant run on your own WhatsApp number.

Neither requires technical skills — just some paperwork and patience with approval times. This guide walks you through both, step by step.

**Total time:** about 1–2 hours of your time, then a few days of waiting for approvals. Start early — approvals are the slow part.

---

## Part 1 — Yoco (card payments)

Yoco is the payment provider. Customers pay by card on your booking site, and Yoco pays the money out to your bank account. To get this working you need an approved Yoco account and one "key" from their dashboard.

### What to have ready before you start

- Your **South African ID** (or passport if you're a foreign national)
- Your **business bank account details**
- If you're a registered company: your **CIPC registration documents**
- If you trade as a sole proprietor: just your ID and bank details are fine — Yoco supports sole props

### Step 1: Sign up

1. Go to **https://www.yoco.com** and click **Sign up**.
2. Choose to sign up for **Yoco online payments** (you don't need to buy a card machine).
3. Enter your email and create a password.

### Step 2: Complete verification (KYC)

Yoco is legally required to verify who you are before paying money out to you.

1. Log in to the **Yoco Business Portal** at **https://portal.yoco.co.za**.
2. Follow the prompts to complete your business profile:
   - Upload a photo/scan of your **ID document**.
   - Enter your **business details** (registered company: CIPC number and documents; sole prop: your trading name).
   - Enter your **bank account** details — this is where your payouts will go.
3. Submit and wait. **Approval usually takes 1–3 business days.** Yoco will email you if they need anything else — check your spam folder.

> ⚠️ Until Yoco approves your account, you only have "test" access. Real customer payments can't be taken, so please start this step as early as possible.

### Step 3: Get your live API key

Once Yoco confirms your account is approved:

1. Log in to **https://portal.yoco.co.za**.
2. In the menu, go to **Sell Online → Payment Gateway** (sometimes shown as **Online → API keys**).
3. You will see a **Live Secret Key** — it starts with `sk_live_...`.
4. Copy it. This is the key we need.

### Step 4: Send us the key — securely

The secret key is like a bank password. **Please don't email or WhatsApp it in plain text.**

Send it to us using one of these:
- A one-time secret link: paste the key at **https://onetimesecret.com**, and send us the link it gives you, **or**
- Read it out to us over a phone/video call while we type it in.

That's it for Yoco — we handle all the technical wiring (webhooks, checkout, receipts) on our side.

---

## Part 2 — Meta Business Manager + WhatsApp number

Your booking confirmations, reminders, and chat assistant are sent through the **official WhatsApp Business API**. Meta (the company behind Facebook and WhatsApp) requires two things from you:

1. A **verified Meta Business Account** (proof that your business is real).
2. A **phone number** dedicated to the API — one that is **not currently being used in the normal WhatsApp app** on any phone.

### 2A. Create your Meta Business Account

If your business already has a Facebook page you manage, you may already have one — check step 2 below first.

1. Go to **https://business.facebook.com** and log in with your personal Facebook account (this is normal — Meta requires a personal profile to administer a business account; other people cannot see your personal profile through it).
2. If you don't already have a business portfolio: click **Create a business portfolio** and enter:
   - Your **legal business name** (exactly as it appears on your CIPC documents — this matters later)
   - Your name and **business email address**
3. Confirm the verification email Meta sends you.

### 2B. Verify your business with Meta

This is the step most people haven't done before. Meta checks your paperwork to prove the business is real. You can start using WhatsApp before verification is approved, but unverified accounts are capped by Meta (roughly 250 business-started conversations per day), so submit this early and let it run in parallel.

**Documents to have ready (South Africa):**
- **CIPC registration certificate** (companies) — or for sole props, a document showing your trading name (e.g. a bank letter or municipal invoice in the business name)
- **Proof of business address**, less than 90 days old: utility bill, bank statement, or lease — the business name and address on it must match what you typed into Meta
- A **business phone number or business email** Meta can use to confirm you

**Steps:**

1. In **business.facebook.com**, open **Settings** (gear icon, bottom left).
2. Go to **Security Centre** (sometimes under "Business settings → Security Centre").
3. Under **Business verification**, click **Start verification**.
4. Confirm your business details — legal name, address, phone, website. Use your booking site or business website address.
5. Upload the documents listed above when asked.
6. Choose how to receive the confirmation code (email, phone call, or SMS) and enter the code.
7. Submit and wait. **Verification typically takes 1–5 business days**, occasionally longer. You'll get an email and a notification in Business Manager either way.

> 💡 The most common rejection reason: the business name or address on the document doesn't **exactly** match what you entered in Meta. Double-check spelling, punctuation and address format before submitting.

### 2C. Prepare your WhatsApp phone number

This part catches everyone out, so read carefully.

**The rule (Meta's, not ours):** a number connected to the WhatsApp API **cannot at the same time be registered in the normal WhatsApp or WhatsApp Business app on a phone**.

**What this means in practice** — your number keeps working:
- Calls and SMS are completely unaffected.
- Customers still WhatsApp the number exactly as before.
- You read and answer every chat from your **BookingTours Inbox** (on any computer or phone browser) instead of the WhatsApp app.
- The AI assistant can be switched on or off anytime in your Settings — that toggle only controls auto-replies, it doesn't affect the number itself.

**You have two options:**

**Option A — use a brand-new number (recommended).**
Buy a new prepaid SIM (any network, ±R10). Put it in any phone just long enough to receive one SMS or voice call during setup. Keep the SIM somewhere safe afterwards — you may need it again if Meta ever re-verifies the number.
- A **landline** also works: Meta can phone it and read a code out loud.
- ⚠️ Keep the SIM active per your network's rules (usually one call/SMS or a small top-up every few months), otherwise the network may recycle the number.

**Option B — use your existing business number.**
Only do this if you're comfortable that from then on you'll **chat from the BookingTours Inbox instead of the WhatsApp app** for this number. If yes:

1. **Back up anything you want to keep** — deleting the account erases your chat history on that number. In WhatsApp: **Settings → Chats → Chat backup → Back up now.** You can also export individual important chats (**open chat → tap the name → Export chat**).
2. In WhatsApp on the phone that uses this number: **Settings → Account → Delete my account.**
3. Enter the phone number and confirm. (This deletes the WhatsApp registration for that number — it does not affect your SIM, calls or SMS.)
4. Wait a few hours before we register it on the API, to let Meta's systems catch up.

> ⚠️ **Do not skip the backup step.** Deleting the account permanently removes your message history for that number.

**Whichever option you choose, the number must be able to receive one SMS or one voice call** during setup — so have the phone/SIM at hand for our setup call.

### 2D. Give our team access

We do all the technical setup (connecting the number, tokens, webhooks) inside your Business Manager — but we need access first:

1. In **business.facebook.com → Settings → People**, click **Invite people**.
2. Enter the email address we give you.
3. Grant **Admin access** (we can reduce this to a lower level after setup if you prefer — just ask).
4. We'll take it from there and arrange a short call with you.

### 2E. The setup call (±20 minutes, together with us)

During registration Meta sends a **6-digit code by SMS or voice call to your WhatsApp number** — so we need you (and that SIM/phone) available. On the call we will:

1. Connect your number to the WhatsApp API and enter the code you receive.
2. Set your **display name** — the business name customers see in WhatsApp. Meta must approve it, and it should match your real business name.
3. Test a message end-to-end with you.

---

## Quick checklist — what we need from you

**Yoco**
- [ ] Yoco account created and **approved** (KYC done)
- [ ] **Live Secret Key** (`sk_live_...`) sent to us via a secure link or read out on a call

**Meta / WhatsApp**
- [ ] Meta Business Account created at business.facebook.com
- [ ] **Business verification submitted** (CIPC docs + proof of address) and approved
- [ ] A phone number that is **not registered in the WhatsApp app** (new SIM, landline, or your old number after backing up + deleting its WhatsApp account)
- [ ] Our team invited as **Admin** in your Business Manager
- [ ] A 20-minute call booked with us, with that phone/SIM at hand

Stuck on any step? Send us a screenshot of where you got stuck and we'll walk you through it — most snags are small (usually a document mismatch or a spam-foldered email).
