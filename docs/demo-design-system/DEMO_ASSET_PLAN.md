# Demo Asset Plan — 13 Feature Briefs

Researched directly against the live codebase and production environment
(2026-07-14). Readiness labels reflect what's actually deployed, not what's
merely written. Hand the design agent `SYSTEM_PROMPT.md` plus **exactly one**
brief below per session — see `README.md`.

## Before recording anything

- **Pick one polished tenant and stay on it.** Jerry's / Aonyx Kayaks already
  has real branding, real tours, and real review data — don't demo against a
  bare test tenant.
- **Combo bookings are off in production right now** — `ENABLE_COMBO_DEALS`
  isn't set on either Vercel project. If it's going in the reel, flip it on
  for the demo tenant plus a partner tenant with an active partnership first.
- **OTA Channels / OTA Drift are staff-only** right now (deliberately hidden
  from nav). Verify current state live before filming — don't lead with
  these.
- **WhatsApp demo needs a live number.** Confirm which WA test/production
  number is wired to the demo tenant before scripting that segment.

---

## Core features (work through in order)

### 01 — Booking flow
**Status:** Live · polished
**Show:** Tour picker → live calendar with real seat counts → add-ons →
promo/voucher field → Yoco checkout.
**Hook:** Show the hold countdown ticking — it's the detail that sells "this
is real inventory, not a form."
**Where:** `booking/app/book/page.tsx`

### 02 — Customer self-service
**Status:** Live · polished
**Show:** OTP login by email → reschedule on a mini-calendar, edit guest
count, cancel with a refund quote computed live, not guessed.
**Hook:** This is the "we don't need to email you" feature.
**Where:** `booking/app/my-bookings`

### 03 — Admin dashboard
**Status:** Live · polished
**Show:** Bookings list → booking detail with a full timeline → refunds
queue → reports.
**Hook:** Pan across the nav once to establish scope before zooming into any
one page.
**Where:** `app/` (Dashboard, Bookings, Refunds, Reports)

### 04 — Vouchers & gift cards
**Status:** Live · polished
**Show:** Buy a voucher → real Yoco checkout → redeem the code at checkout
on a different booking.
**Hook:** Two-sided, not a coupon-code stub.
**Where:** `booking/app/voucher/page.tsx` · `app/vouchers`

### 05 — Digital waivers
**Status:** Live · polished
**Show:** Token-signed waiver, forced into a fixed light theme so it stays
legible regardless of tenant branding. Link it from a confirmation email,
then show the guide's manifest reflecting "signed."
**Hook:** Legal readability wins over brand consistency here, on purpose.
**Where:** `booking/app/waiver/page.tsx` · `app/guide/slot/[slotId]`

### 06 — Per-tenant refund policy
**Status:** Live · polished
**Show:** Set a tiered policy once in Settings (e.g. 100% at 48h, 50% at
24h). Then show the *same* percentage surface correctly in the admin refund
queue, the customer's cancel screen, and a WhatsApp quote.
**Hook:** One source of truth, three surfaces.
**Where:** `businesses.refund_policy_tiers` · `calculate_refund_percent()`

### 07 — White-label branding
**Status:** Live · polished
**Show:** Two tenants side by side — same platform, unrecognizably different
storefronts.
**Hook:** Colors, logo, hero copy, even the refund-policy wording are
per-tenant, not a theme picker with five presets.
**Where:** `booking/app/components/ThemeProvider.tsx`

### 08 — Marketing automations
**Status:** Live · polished
**Show:** Build one automation live: trigger on a date field (e.g. "3 days
before the trip"), add a delay step, then a generate-promo step.
**Hook:** It's a real multi-step builder, not a "send a blast" button.
**Where:** `app/marketing/automations`

### 09 — Google reviews, on autopilot
**Status:** Live · polished
**Show:** The reviews page — mention that a cron pulls new reviews in daily
and a separate job nudges past guests to leave one.
**Hook:** Neither list is touched by hand.
**Where:** `supabase/functions/fetch-google-reviews` (03:17 daily)

### 10 — Embeddable booking widget
**Status:** Live · polished
**Show:** Drop the widget script into any existing website's hero section —
live availability, real seat counts, deep-links straight into checkout.
**Hook:** For operators who don't want to abandon their existing site.
**Where:** `booking/public/widget.js` · `booking/app/embed`

### 11 — OTA sync — Viator & GetYourGuide
**Status:** Live · rough
**Show:** Availability and webhook sync both exist and run nightly, but the
admin surfaces for it are currently staff-only and hidden from nav.
**Hook:** Verify current state before deciding whether this makes the reel.
**Where:** `supabase/functions/viator-*`, `getyourguide-*`

---

## The two nobody else has (lead with these)

### 12 — A WhatsApp bot that actually completes the booking
**Status:** Live · polished
**Show:** A customer picks a tour, chooses a date and slot, pays via a real
Yoco link, reschedules, cancels with a live refund quote, buys a gift
voucher, or joins a waitlist — entirely inside a WhatsApp thread, with a
clean handoff to a human whenever it's needed.
**Hook:** The category norm is a bot that sends a confirmation SMS. This one
runs the entire transaction.
**Where:** `supabase/functions/wa-webhook` (3,322 lines · full conversational
state machine)

### 13 — A new operator is live in one API call
**Status:** Live · polished
**Show:** Business record, admin account, WhatsApp credentials, and payment
credentials — created together, atomically, from a single authenticated
request.
**Hook:** Competitors sell this as a sales-assisted onboarding call. Here
it's a form submit. The only manual step left is a custom domain's SSL
certificate.
**Where:** `supabase/functions/super-admin-onboard`
