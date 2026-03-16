# Client Onboarding Guide

## Adventure & Tourism Booking Platform

Welcome to the Adventure & Tourism Booking Platform — an all-in-one operations dashboard for adventure companies, tour operators, and tourism businesses. This guide covers everything needed to onboard a new client onto the platform.

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [Who Is This For?](#2-who-is-this-for)
3. [Onboarding Checklist](#3-onboarding-checklist)
4. [Information Required from the Client](#4-information-required-from-the-client)
5. [Platform Setup Steps](#5-platform-setup-steps)
6. [Feature Walkthrough](#6-feature-walkthrough)
7. [Multi-Tenant Configuration Map](#7-multi-tenant-configuration-map)
8. [Fields & Code That Must Change Per Client](#8-fields--code-that-must-change-per-client)
9. [Database Schema Reference](#9-database-schema-reference)
10. [Environment Variables Per Deployment](#10-environment-variables-per-deployment)
11. [Edge Functions Reference](#11-edge-functions-reference)
12. [Branding & White-Label Customisation](#12-branding--white-label-customisation)
13. [Pricing Model Suggestions](#13-pricing-model-suggestions)
14. [Appendix: Industry-Specific Setup Notes](#14-appendix-industry-specific-setup-notes)

---

## 1. Platform Overview

The platform provides:

- **Booking management** — create, edit, rebook, cancel bookings
- **Slot/schedule management** — capacity, pricing, open/close slots, weather cancellations
- **Automated customer communication** — WhatsApp bot, website chat, email confirmations
- **Payment processing** — Yoco checkout integration, payment links, split payments
- **Invoice generation** — automatic invoicing on payment confirmation
- **Refund management** — refund queue, auto-refund via payment gateway, manual processing
- **Gift vouchers** — purchase, redeem, track expiry
- **Customer inbox** — unified WhatsApp and web chat inbox with AI-assisted replies
- **Broadcasts** — bulk WhatsApp messaging to customer segments
- **Weather monitoring** — live wind/swell/conditions dashboard (configurable per location)
- **Photo management** — track trip photos sent to customers
- **Peak pricing** — seasonal/date-based price overrides
- **Reports & analytics** — booking trends, revenue, customer metrics
- **Referral & loyalty programs** — automated discounts for repeat and referred customers
- **Multi-admin support** — role-based access (Main Admin, Admin), up to 10 users

---

## 2. Who Is This For?

### Adventure Companies
- Kayaking, surfing, paddleboarding, diving, snorkelling
- Zip-lining, bungee, paragliding, skydiving
- Mountain biking, hiking, rock climbing
- Horse riding, quad biking, sandboarding
- Fishing charters, boat cruises

### Tour Operators
- Day tours (city tours, wine tours, cultural tours, food tours)
- Multi-day trips (safari, overland, hiking trails)
- Shuttle & transfer services
- Sightseeing and excursion companies

### Tourism & Hospitality
- Activity centres offering multiple experiences
- Lodge/hotel activity desks
- Event-based experiences (sunset cruises, themed dinners)
- Seasonal/festival tour operators

---

## 3. Onboarding Checklist

Use this checklist for every new client deployment:

### Phase 1: Information Gathering
- [ ] Company profile completed (Section 4.1)
- [ ] Tour/activity catalogue provided (Section 4.2)
- [ ] Operational details confirmed (Section 4.3)
- [ ] Customer policies documented (Section 4.4)
- [ ] Communication preferences set (Section 4.5)
- [ ] Payment account configured (Section 4.6)
- [ ] Branding assets received (Section 4.7)

### Phase 2: Platform Configuration
- [ ] Supabase project created
- [ ] Database seeded with client data (tours, slots, policies)
- [ ] Environment variables set
- [ ] Edge functions deployed
- [ ] WhatsApp Business API connected
- [ ] Payment gateway (Yoco) connected
- [ ] Email service (Resend) configured
- [ ] AI chat knowledge base customised
- [ ] Email templates branded
- [ ] Admin users created

### Phase 3: Go-Live
- [ ] Client admin walkthrough completed
- [ ] Test booking end-to-end (book, pay, confirm, cancel, refund)
- [ ] WhatsApp bot tested
- [ ] Web chat tested
- [ ] Email delivery confirmed
- [ ] Weather dashboard configured (if applicable)
- [ ] Slot schedule populated for launch period
- [ ] Client signs off

---

## 4. Information Required from the Client

### 4.1 Company Profile

| Field | Example | Required |
|-------|---------|----------|
| Business name | Coastal Adventures | Yes |
| Legal entity name | Coastal Adventures (Pty) Ltd | Yes |
| Tagline / slogan | "Cape Town's original ocean experience" | Optional |
| Year established | 2012 | Optional |
| Industry / activity type | Kayaking, Diving, Boat Cruises | Yes |
| Primary contact name | Jane Smith | Yes |
| Primary contact email | jane@coastaladventures.co.za | Yes |
| Primary contact phone | +27 82 123 4567 | Yes |
| Admin email (for system alerts) | admin@coastaladventures.co.za | Yes |
| Business registration number | 2012/123456/07 | Optional |
| VAT number (if registered) | 4123456789 | Optional |

### 4.2 Tour / Activity Catalogue

Provide for **each** tour or activity offered:

| Field | Example | Required |
|-------|---------|----------|
| Activity name | Morning Sea Kayak | Yes |
| Description (1–2 sentences) | Guided 90-minute paddle along the Atlantic coast | Yes |
| Duration | 90 minutes | Yes |
| Base price per person | R600 | Yes |
| Peak price per person (if different) | R750 | Optional |
| Minimum age | 6 years old | Yes |
| Maximum group size per slot | 24 | Yes |
| Departure times (list all) | 07:00, 09:00 | Yes |
| Operating days | Mon–Sun / specific days | Yes |
| Seasonal availability | Year-round / Oct–Apr only | Yes |
| What's included | Guide, equipment, safety briefing | Yes |
| What's NOT included | Transport, food, drinks | Optional |
| Difficulty level | Easy / Moderate / Advanced | Optional |
| Equipment provided | Kayak, paddle, life jacket | Yes |
| Weight/height/fitness restrictions | 95kg max per person | If applicable |
| Accessibility notes | Not wheelchair accessible | If applicable |

**For multi-day trips, also provide:**

| Field | Example | Required |
|-------|---------|----------|
| Number of days / nights | 3 days / 2 nights | Yes |
| Itinerary (day-by-day summary) | Day 1: Transfer, hike... | Yes |
| Accommodation type | Tented camp / Lodge / Hotel | Yes |
| Meals included | All meals / Breakfast only | Yes |
| Minimum participants to confirm | 4 people | Yes |
| Booking cut-off (days before departure) | 7 days before | Yes |
| Deposit required | 50% on booking | Yes |
| Balance due date | 14 days before departure | Yes |
| Packing list for customers | Hiking boots, sleeping bag... | Yes |
| Transfer/pickup details | Hotel pickup 06:00 Cape Town CBD | If applicable |

### 4.3 Operational Details

| Field | Example | Required |
|-------|---------|----------|
| Meeting point address | Three Anchor Bay, Beach Rd, Sea Point | Yes |
| Meeting point GPS coordinates | -33.9078, 18.3978 | Yes |
| Google Maps / pin link | https://maps.google.com/... | Yes |
| "Arrive X minutes early" | 15 minutes | Yes |
| Parking instructions | Free street parking on Beach Rd | Yes |
| Facilities on site | Lockers, changing rooms, toilets | Yes |
| What customers should bring | Sunscreen, hat, towel, water | Yes |
| What customers should wear | Comfortable clothes, closed shoes | Yes |
| Safety briefing details | Life jackets provided, guide-led | Yes |
| Time zone | Africa/Johannesburg | Yes |
| Operating hours (office/support) | 08:00–17:00 Mon–Fri | Yes |
| Emergency contact number | +27 82 999 8888 | Yes |

**For multi-location businesses:**

| Field | Example | Required |
|-------|---------|----------|
| Location name | Camps Bay Launch Site | Yes |
| Address per location | Beach Rd, Camps Bay | Yes |
| GPS per location | -33.9505, 18.3776 | Yes |
| Activities available at this location | Kayak, SUP | Yes |

### 4.4 Customer Policies

| Field | Example | Required |
|-------|---------|----------|
| Cancellation policy (> 24hrs) | 95% refund | Yes |
| Cancellation policy (< 24hrs) | No refund | Yes |
| Weather cancellation policy | Full refund or free reschedule | Yes |
| Rescheduling policy | Free reschedule > 24hrs, max 2 times | Yes |
| Group discount threshold | 6+ people | Optional |
| Group discount percentage | 5% | Optional |
| Loyalty discount (repeat bookings) | 10% after 2nd booking | Optional |
| Referral discount | 5% for both referrer and friend | Optional |
| Voucher validity period | 12 months from purchase | Yes |
| Minimum booking age / requirements | 6+ with adult, 18+ solo | Yes |
| Terms & conditions URL | https://example.com/terms | Optional |

### 4.5 Communication Preferences

| Field | Example | Required |
|-------|---------|----------|
| WhatsApp Business phone number | +27 21 123 4567 | Yes |
| Preferred greeting style | Friendly, casual / Professional | Yes |
| AI chat persona description | "Friendly ocean guide, short replies, 1 emoji max" | Yes |
| Business FAQ / knowledge base | (see Section 4.5.1 below) | Yes |
| Day-before reminder: send? | Yes | Yes |
| Post-trip review request: send? | Yes | Optional |
| Google review page URL | https://g.page/r/... | Optional |
| Re-engagement campaign: send? | Yes (3–4 months inactive) | Optional |

#### 4.5.1 AI Chat Knowledge Base

The website chat and WhatsApp bot use an AI assistant trained on your business. Provide answers to these common questions:

- What tours/activities do you offer? (names, prices, durations)
- What times do tours run?
- Where is the meeting point?
- What should I bring / wear?
- How long is the tour?
- Is it suitable for kids / beginners?
- What about bad weather?
- Do you provide equipment?
- Can I bring my dog / camera / phone?
- Parking and facilities?
- Payment methods accepted?
- Group discounts?
- Cancellation and refund policy?
- What wildlife / sights might I see? (if applicable)
- Food and drink included / available?
- Weight, fitness, or health restrictions?
- Support hours?

### 4.6 Payment Configuration

| Field | Example | Required |
|-------|---------|----------|
| Payment gateway | Yoco | Yes |
| Yoco Secret Key (live) | sk_live_... | Yes |
| Currency | ZAR | Yes |
| Currency symbol | R | Yes |
| Booking success URL | https://book.clientdomain.com/success | Yes |
| Booking cancel URL | https://book.clientdomain.com/cancelled | Yes |
| Bank account for manual refunds | FNB, Acc: 123456789 | Optional |

### 4.7 Branding Assets

| Asset | Format | Required |
|-------|--------|----------|
| Logo (primary) | PNG/SVG, transparent background | Yes |
| Logo (icon/favicon) | 32x32 PNG or SVG | Yes |
| Brand colour — primary | Hex code, e.g. #1b3b36 | Yes |
| Brand colour — accent | Hex code, e.g. #A8C2B8 | Yes |
| Brand colour — danger/alert | Hex code, e.g. #e53e3e | Optional |
| Hero image for emails | 600px wide JPG/PNG | Optional |
| Company description (1 paragraph) | For email footers / about section | Yes |

---

## 5. Platform Setup Steps

### Step 1: Create Supabase Project
- Create a new Supabase project for the client (or use shared multi-tenant instance)
- Run database migrations to create all tables
- Seed the `tours` table with the client's activity catalogue
- Seed the `policies` table with cancellation/discount policies
- Create initial admin user(s) in `admin_users`

### Step 2: Configure Environment
- Set all environment variables (see Section 10)
- Deploy edge functions to Supabase
- Configure WhatsApp Business API webhook URL
- Configure Yoco webhook URL

### Step 3: Customise Templates
- Update email templates with client branding (colours, logo, footer)
- Update AI chat system prompt with client knowledge base
- Update WhatsApp bot knowledge base
- Update meeting point details, what-to-bring lists
- Configure weather widget coordinates (if applicable)

### Step 4: Populate Schedule
- Create slot schedule for the launch period
- Set capacity per slot
- Configure peak pricing periods (if applicable)

### Step 5: Test
- Create a test booking through each channel (admin, web chat, WhatsApp)
- Verify payment flow end-to-end
- Verify email delivery (confirmation, invoice, cancellation)
- Verify WhatsApp delivery (confirmation, reminders)
- Test refund flow
- Test voucher purchase and redemption
- Test weather cancellation

### Step 6: Go Live
- Switch from Yoco test key to live key
- Confirm domain / booking URLs
- Hand over admin credentials
- Provide admin training (see Section 6)

---

## 6. Feature Walkthrough

### For Client Admin Training

| Page | What It Does | Key Actions |
|------|-------------|-------------|
| **Dashboard** | Today's overview — bookings, action items, weather | View manifests, check outstanding tasks |
| **Bookings** | All bookings with filtering | Edit, rebook, mark paid, send payment link, refund, cancel, resend invoice |
| **New Booking** | Create manual bookings | Select tour, date, slot, customer details, apply discounts |
| **Slots** | Manage tour schedules | Edit capacity/pricing, open/close slots, weather cancel (cancels all bookings + queues refunds) |
| **Refunds** | Process pending refunds | Auto-refund via Yoco, manual mark as refunded, batch process all |
| **Inbox** | Customer messages | View conversations, reply via WhatsApp, escalate to human |
| **Vouchers** | Gift voucher tracking | View status, filter, track redemptions |
| **Invoices** | Invoice archive | Search, view, export |
| **Weather** | Live conditions | Wind, swell, temperature at your location |
| **Photos** | Trip photo tracking | Mark as sent, track outstanding |
| **Broadcasts** | Bulk messaging | Select audience, compose, send via WhatsApp |
| **Peak Pricing** | Seasonal pricing | Set date ranges, apply price overrides to slots |
| **Reports** | Business analytics | Booking trends, revenue, customer insights |
| **Settings** | Admin users | Add/remove admins, manage roles |

---

## 7. Multi-Tenant Configuration Map

The platform already supports multi-tenancy via the `business_id` field on every table. To deploy for a new client, the following must be configured per business:

### Database Records (per client)

| Table | What to Seed |
|-------|-------------|
| `admin_users` | Admin email + hashed password |
| `tours` | All tours/activities with pricing |
| `slots` | Schedule for upcoming period |
| `policies` | Cancellation, group discount, loyalty thresholds |

### Configurable Values (per client)

| Category | Values |
|----------|--------|
| Business identity | Name, tagline, year established |
| Location | Address, GPS, maps link, time zone |
| Contact | Phone, email, WhatsApp number |
| Tours | Names, prices, durations, descriptions |
| Customer instructions | What to bring, what to wear, arrival time |
| Policies | Cancellation, refund, rescheduling |
| Discounts | Group size/%, loyalty threshold/%, referral % |
| Payment | Gateway keys, currency, success/cancel URLs |
| Branding | Logo, colours, hero image |
| AI knowledge base | Business FAQ for chat assistant |
| Weather | GPS coordinates, wind/swell thresholds |
| URLs | Booking domain, review page, maps link |

---

## 8. Fields & Code That Must Change Per Client

This section maps every hardcoded value that needs to become configurable for the platform to be sold/rented to multiple businesses.

### 8.1 Edge Functions — Hardcoded Values to Parameterise

#### `send-email/index.ts`
| Current Value | What to Change | Suggested Source |
|---------------|---------------|-----------------|
| `"Cape Kayak <onboarding@resend.dev>"` | Client name + verified sender domain | `businesses` table or env var |
| Brand colours `#1b3b36`, `#A8C2B8` | Client brand colours | `businesses` table |
| Hero image URL (travel poster) | Client hero image | `businesses` table |
| Meeting point "Three Anchor Bay, Sea Point" | Client meeting point | `tours` or `businesses` table |
| "Cape Kayak Adventures" in templates | Client business name | `businesses` table |
| Footer location text | Client address | `businesses` table |

#### `web-chat/index.ts`
| Current Value | What to Change | Suggested Source |
|---------------|---------------|-----------------|
| Yoco test key `sk_test_b1f890d6...` | Client's Yoco live key | env var per client |
| AI system prompt (entire knowledge base) | Client's FAQ/knowledge base | `businesses` table `chat_prompt` field |
| Success/cancel URLs `booking-mu-steel.vercel.app` | Client's booking domain | `businesses` table |
| Group discount logic (6+ = 5%) | Client's policy settings | `policies` table |

#### `wa-webhook/index.ts`
| Current Value | What to Change | Suggested Source |
|---------------|---------------|-----------------|
| `BUSINESS_ID` default UUID | Looked up from phone number | Dynamic lookup |
| Maps URL | Client's maps link | `businesses` table |
| Review URL | Client's review page | `businesses` table |
| Meeting point text throughout | Client's meeting point | `businesses` table |
| "What to bring" list | Client's instructions | `businesses` table |
| AI knowledge base prompt | Client FAQ | `businesses` table |
| "Since 1994" and historical references | Client's history | `businesses` table |
| Cancellation policy text (95%, 24hrs) | Client's policy | `policies` table |
| All tour-specific language (kayak, paddle) | Generic or client terms | `tours` table |

#### `yoco-webhook/index.ts`
| Current Value | What to Change | Suggested Source |
|---------------|---------------|-----------------|
| `ADMIN_EMAIL = "gideon@capeweb.co.za"` | Client admin email | `businesses` table |
| Maps URL in WhatsApp confirmation | Client maps link | `businesses` table |
| Meeting point text | Client location | `businesses` table |
| "What to bring" list | Client instructions | `businesses` table |

#### `auto-messages/index.ts`
| Current Value | What to Change | Suggested Source |
|---------------|---------------|-----------------|
| `BUSINESS_ID` default UUID | Iterate all businesses or per-client cron | Dynamic |
| Maps URL | Client maps link | `businesses` table |
| Review URL | Client review page | `businesses` table |
| Meeting point text | Client location | `businesses` table |
| "What to bring" list | Client instructions | `businesses` table |

#### `create-checkout/index.ts`
| Current Value | What to Change | Suggested Source |
|---------------|---------------|-----------------|
| Success/cancel URLs `booking-mu-steel.vercel.app` | Client booking domain | `businesses` table |
| Currency `ZAR` | Client currency | `businesses` table |

### 8.2 Frontend — Hardcoded Values to Parameterise

#### `app/layout.tsx`
| Current Value | What to Change |
|---------------|---------------|
| "Cape Kayak" title | Client business name |
| "Admin Dashboard" subtitle | Configurable or keep generic |
| "Since 1994" footer | Client year or remove |
| Emoji icons in nav | Keep or allow customisation |

#### `app/globals.css` (CSS Variables)
| Variable | Current | Change To |
|----------|---------|-----------|
| `--ck-sidebar` | Dark colour | Client brand primary |
| `--ck-danger` | Red | Keep or client preference |
| All `--ck-*` variables | Cape Kayak theme | Client brand theme |

#### Dashboard page (`app/page.tsx`)
| Current Value | What to Change |
|---------------|---------------|
| Weather widget location | Client GPS coordinates |
| Windy/Windguru embed coordinates | Client location |

### 8.3 Proposed New Table: `businesses`

To make the platform fully multi-tenant, create a `businesses` table:

```sql
CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  legal_name TEXT,
  tagline TEXT,
  year_established INTEGER,

  -- Contact
  admin_email TEXT NOT NULL,
  support_email TEXT,
  support_phone TEXT,
  whatsapp_phone TEXT,

  -- Location
  address TEXT,
  city TEXT,
  country TEXT,
  gps_lat DECIMAL,
  gps_lng DECIMAL,
  maps_url TEXT,
  review_url TEXT,
  time_zone TEXT DEFAULT 'Africa/Johannesburg',

  -- Branding
  logo_url TEXT,
  brand_color_primary TEXT DEFAULT '#1b3b36',
  brand_color_accent TEXT DEFAULT '#A8C2B8',
  hero_image_url TEXT,
  email_from_name TEXT,
  email_from_address TEXT,

  -- Operations
  currency TEXT DEFAULT 'ZAR',
  currency_symbol TEXT DEFAULT 'R',
  booking_domain TEXT,
  arrive_early_minutes INTEGER DEFAULT 15,
  what_to_bring TEXT,
  what_to_wear TEXT,
  parking_info TEXT,
  facilities TEXT,
  safety_info TEXT,

  -- Payment
  yoco_secret_key TEXT,

  -- AI Chat
  chat_knowledge_base TEXT,
  chat_persona TEXT DEFAULT 'friendly assistant',

  -- Weather
  weather_lat DECIMAL,
  weather_lng DECIMAL,
  wind_cancel_threshold_se INTEGER DEFAULT 25,
  wind_cancel_threshold_other INTEGER DEFAULT 20,
  swell_cancel_threshold DECIMAL DEFAULT 2.6,

  -- Meta
  created_at TIMESTAMPTZ DEFAULT now(),
  active BOOLEAN DEFAULT true
);
```

---

## 9. Database Schema Reference

All existing tables and their key fields:

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `bookings` | Booking records | id, business_id, tour_id, slot_id, customer_name, phone, email, qty, total_amount, status, refund_status |
| `tours` | Activity catalogue | id, business_id, name, base_price_per_person, peak_price_per_person, duration_minutes, active |
| `slots` | Time slots | id, business_id, tour_id, start_time, capacity_total, booked, held, status, price_per_person_override |
| `vouchers` | Gift vouchers | id, business_id, code, status, value, buyer_name, buyer_email, recipient_name, expires_at |
| `holds` | Temporary 15-min holds | id, booking_id, slot_id, expires_at, status |
| `invoices` | Invoice records | id, business_id, booking_id, invoice_number, customer_name, total_amount, payment_method |
| `conversations` | Chat conversations | id, business_id, phone, customer_name, status, current_state, state_data |
| `chat_messages` | Message history | id, business_id, phone, direction, body, sender |
| `auto_messages` | Automated message log | id, business_id, booking_id, phone, type |
| `trip_photos` | Photo tracking | id, business_id, slot_id |
| `logs` | Audit log | id, business_id, booking_id, event, payload |
| `policies` | Business policies | business_id, loyalty_bookings_threshold, loyalty_discount_percent, group_discount_min_qty, group_discount_percent |
| `referrals` | Referral program | id, business_id, referrer_phone, referral_code, discount_percent |
| `admin_users` | Admin accounts | id, email, password_hash, role |

**Key**: All tables include `business_id` for multi-tenant isolation.

---

## 10. Environment Variables Per Deployment

Each client deployment requires these environment variables:

### Supabase
| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (edge functions only) |

### WhatsApp Business API
| Variable | Description |
|----------|-------------|
| `WA_ACCESS_TOKEN` | WhatsApp Cloud API access token |
| `WA_PHONE_NUMBER_ID` | WhatsApp phone number ID |
| `WA_VERIFY_TOKEN` | Webhook verification token |

### Payment Gateway
| Variable | Description |
|----------|-------------|
| `YOCO_SECRET_KEY` | Yoco API secret key (live) |

### Email Service
| Variable | Description |
|----------|-------------|
| `RESEND_API_KEY` | Resend email service API key |

### AI Assistant
| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Google Gemini API key for chat AI |

### Business
| Variable | Description |
|----------|-------------|
| `BUSINESS_ID` | UUID of the business in the database |

---

## 11. Edge Functions Reference

| Function | Trigger | Purpose |
|----------|---------|---------|
| `send-email` | HTTP POST | Sends transactional emails (confirmation, invoice, cancellation, voucher, payment link) |
| `web-chat` | HTTP POST | Website chat assistant — AI-powered booking and FAQ |
| `wa-webhook` | WhatsApp webhook | Full WhatsApp booking bot — tours, payments, management, referrals, loyalty |
| `yoco-webhook` | Yoco payment webhook | Processes successful payments — updates booking, creates invoice, sends confirmations |
| `create-checkout` | HTTP POST | Creates Yoco payment checkout sessions |
| `auto-messages` | Scheduled/cron | Sends day-before reminders, post-trip review requests, re-engagement campaigns |
| `send-whatsapp-text` | HTTP POST | Utility function for sending direct WhatsApp messages |

---

## 12. Branding & White-Label Customisation

### Email Templates
The email system supports 6 template types, all using the client's branding:
- **Booking Confirmation** — sent after payment
- **Payment Link** — sent to collect payment
- **Invoice** — full invoice with line items
- **Gift Voucher** — voucher code delivery
- **Cancellation** — cancellation notice with refund info
- **Voucher Code** — standalone voucher delivery

All templates pull from the `businesses` table for: company name, colours, logo, address, contact details.

### Admin Dashboard
CSS custom properties (`--ck-*` variables in `globals.css`) control the entire theme:
- Sidebar background, text, hover states
- Button colours, borders, shadows
- Card backgrounds, accent colours

Change these variables to match any client's brand.

### Chat Persona
The AI chat assistant's personality and knowledge base are fully configurable per client via the system prompt. The prompt defines:
- Tone of voice (casual, professional, energetic)
- Emoji usage
- Response length
- Business-specific knowledge (tours, policies, FAQs, location info)

---

## 13. Pricing Model Suggestions

### For Selling / Renting the Platform

| Model | Structure | Best For |
|-------|-----------|----------|
| **Monthly SaaS** | R1,500–R5,000/month based on tier | Small–medium operators |
| **Per-booking fee** | R5–R15 per confirmed booking | High-volume seasonal operators |
| **Setup + monthly** | R10,000 setup + R2,000/month | Operators wanting customisation |
| **Revenue share** | 2–3% of booking revenue | Large operators, low commitment |
| **White-label license** | R50,000+ once-off + R3,000/month | Agencies reselling to clients |

### Suggested Tiers

| Tier | Bookings/month | Features | Price |
|------|---------------|----------|-------|
| **Starter** | Up to 100 | Core booking, email, 1 admin | R1,500/mo |
| **Growth** | Up to 500 | + WhatsApp bot, vouchers, 3 admins | R3,000/mo |
| **Pro** | Unlimited | + AI chat, broadcasts, analytics, 10 admins | R5,000/mo |

---

## 14. Appendix: Industry-Specific Setup Notes

### A. Water Sports (Kayak, SUP, Surf, Dive)
- Weather cancellation thresholds are critical (wind speed, swell height)
- Equipment tracking per slot (kayaks, boards, wetsuits)
- Tide-dependent scheduling
- Marine wildlife sighting notes
- Safety briefing emphasis in customer comms
- Weight restrictions common

### B. Aerial Adventures (Paragliding, Skydiving, Zip-line)
- Weather is the primary operational constraint
- Waiver/indemnity requirements — add waiver link to confirmation email
- Weight/health restrictions more strict
- Single-participant slots common (tandem pairs)
- Photo/video upsell after experience

### C. Land-Based Tours (Hiking, Biking, Wine Tours)
- Multi-stop itineraries — extend tour description fields
- Vehicle/transport capacity separate from activity capacity
- Pickup/dropoff locations per booking
- Meal and accommodation tracking (multi-day)
- Seasonal route variations

### D. Multi-Day Trip Operators
- **Deposit + balance due** payment flow (extend checkout to support split payments)
- **Itinerary management** — day-by-day plan linked to tour
- **Minimum participant threshold** — auto-cancel if minimum not met by cut-off date
- **Accommodation allocation** — room/tent assignments
- **Packing list** — customisable per trip, sent in confirmation email
- **Pre-trip briefing** — automated email/WhatsApp 7 days before departure
- **Balance reminder** — automated message when balance is due

#### Multi-Day Fields to Add

| Field | Table | Purpose |
|-------|-------|---------|
| `num_days` | `tours` | Trip length |
| `num_nights` | `tours` | Accommodation nights |
| `itinerary` | `tours` (JSON) | Day-by-day plan |
| `accommodation_type` | `tours` | Lodge / Camping / Mixed |
| `meals_included` | `tours` | All / Breakfast / None |
| `min_participants` | `tours` | Minimum to confirm trip |
| `booking_cutoff_days` | `tours` | Days before departure to close bookings |
| `deposit_percent` | `tours` | Deposit required (e.g. 50%) |
| `balance_due_days` | `tours` | Days before departure balance is due |
| `packing_list` | `tours` (text) | Customer packing instructions |
| `pickup_location` | `bookings` | Per-booking pickup point |
| `dietary_requirements` | `bookings` | Per-booking dietary needs |
| `emergency_contact` | `bookings` | Per-booking emergency contact |
| `room_assignment` | `bookings` | Accommodation allocation |

### E. Event-Based Experiences (Sunset Cruises, Themed Dinners)
- Fixed-date events vs recurring schedules
- Minimum headcount to run event
- Special inclusions (food, drink, entertainment)
- Premium/VIP tier pricing per event

### F. Shuttle & Transfer Services
- Route-based pricing instead of per-person
- Vehicle capacity management
- Pickup/dropoff time windows
- Real-time tracking integration (future)

---

## Summary

This platform is ready for multi-tenant deployment with minimal changes. The database is already partitioned by `business_id`. The primary work for each new client is:

1. **Collect their information** (Section 4)
2. **Seed their database** (tours, slots, policies)
3. **Configure environment variables** (payment, WhatsApp, email)
4. **Customise templates** (email branding, AI knowledge base)
5. **Train admin users** (Section 6)

The largest engineering effort for full SaaS readiness is:
- Creating the `businesses` table and making edge functions read from it dynamically
- Replacing hardcoded values in email templates, chat prompts, and WhatsApp messages with database-driven content
- Building a self-service onboarding flow (future)

---

*Document version: 1.0*
*Last updated: February 2026*
