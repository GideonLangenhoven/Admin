# Cost audit — what's actually implemented (2026-08-03)

Scope: the six-item cost checklist (Google Maps, Weather API, storage/egress, vector storage, SMS/email, commercial levers) verified against the codebase and the live production database (project `ukdsrndqhsatjkmxijuj`). Every claim below carries file:line evidence. DB numbers are live as of 2026-08-03.

## TL;DR

| # | Item | Implemented? | Current cost | Latent cost | Verdict |
|---|------|--------------|--------------|-------------|---------|
| 1 | Google Maps (dynamic/embed/static/autocomplete) | **No — none exists** | R0 | n/a | Non-issue. The only billable Maps Platform call is the reviews cron, currently dormant (0 tenants configured) |
| 1b | Google Places (fetch-google-reviews cron) | Yes, dormant | R0 | ~$0.75/tenant/mo at daily cadence, top-tier SKU | Cheap fix now: weekly cadence + auth the endpoint |
| 2 | Weather API | **No metered API at all** | R0 | ToS exposure (Open-Meteo non-commercial), not cost | Non-issue today; cache-by-geography note stands for the future |
| 3 | Storage/egress | Supabase-only, 17 MB total; no CDN/R2 | ~R0 | Email header PNGs + Paris-pinned image proxy are the real levers | Fix the cheap things; R2 decision genuinely still open |
| 4 | Vector storage | **pgvector already** (v0.8.0 live) | ~R0 | none | Already done right. No action |
| 5 | SMS | **No — zero SMS anywhere** | R0 | n/a | Nothing to remove. Customer messaging is email + WhatsApp only |
| 5b | Email | Resend only, 5 integration points | ~R0 (inside free tier) | SES switch point far away | Meter; note the 5 direct call sites for any future switch |
| 6 | Commercial levers | Pause: built (billing side only). Dunning: absent. Annual: absent. Invoicing: manual | — | Paused tenants keep consuming; unpaid invoices trigger nothing | The real gaps are enforcement-side, not infra |

Live volumes: 13 tenant rows, 7 tours, 45 bookings/30d, 6 trip photos, 17 MB total storage, 0 marketing sends/30d.

---

## 1. Google Maps — the "emergency" does not exist

**Nothing that bills per page view is implemented.** Verified absent everywhere (root, `/app`, `/booking/app`, `/components`, `/supabase/functions`, both `package.json`s):

- Maps JavaScript API / dynamic maps — absent. No `maps.googleapis.com/maps/api/js`, no `google.maps.*`, no `@googlemaps/*` or `@react-google-maps/api`.
- Maps Embed API — absent. No Google Maps iframe anywhere.
- Static Maps API — absent.
- Places Autocomplete — absent. Every `autocomplete` hit is the HTML form attribute.
- Google Geocoding — absent. Geocoding runs on free Nominatim/OpenStreetMap (`app/page.tsx:336`, admin-only) — and is CSP-blocked in prod anyway.
- No maps library of any kind installed (not Leaflet, not Mapbox either).

Customer-facing meeting points render as **plain text** plus a free `google.com/maps/search/?api=1&query=` hyperlink (`booking/app/my-bookings/BookingCard.tsx:107,414`, `booking/app/success/page.tsx:185-188`). Hyperlinks cost nothing. This is already the cheap architecture the checklist recommends — cheaper, in fact, than static map images.

### 1b. The one real Maps Platform integration: `fetch-google-reviews`

`supabase/functions/fetch-google-reviews/index.ts:28` — Places API (New) `GET https://places.googleapis.com/v1/places/{place_id}` with `X-Goog-FieldMask: reviews` (line 31), key `GOOGLE_PLACES_API_KEY` (edge env only, correctly never client-side). Daily cron `17 3 * * *` (`supabase/migrations/20260503200001_schedule_fetch_google_reviews.sql`). One call per tenant with a `google_place_id`.

**Current state: dormant.** 0 of 13 tenants have a Place ID; `google_reviews_last_synced_at` is null everywhere; reviews table has 56 rows, all `source='NATIVE'`, zero Google. Spend today: R0.

**Latent cost when tenants configure it:** the `reviews` field is Atmosphere-class, so every call bills at the *most expensive* Place Details tier (~$25/1,000 US list — the priciest SKU in the product). Daily × 100 tenants = 3,000 calls/mo, ~2,000 past the ~1,000/mo free threshold at that tier → ~$50/mo, for data that barely changes.

**Cheap fixes, in order of value:**
1. **Cadence: weekly, not daily.** Reviews don't change daily. 100 tenants weekly = ~430 calls/mo — inside the free threshold permanently. One-line cron change.
2. **Auth the endpoint.** `verify_jwt = false` (`supabase/config.toml:59-60`) and the cron posts with **no Authorization header** — the function is publicly invokable, and each anonymous invocation triggers a full paid sweep of every configured tenant. Harmless at 0 tenants; a cost-abuse vector the moment one configures a Place ID. Add a shared-secret check (same pattern as other cron fns).
3. **Use the skip guard that already half-exists.** `businesses.google_reviews_last_synced_at` is written on success (lines 71-73) but never read — add `WHERE last_synced_at < now() - interval '7 days'` and re-runs become free.
4. The Place ID settings field (`app/settings/page.tsx:3386-3424`) does no format validation — a typo becomes a silent permanent 404 in the cron (non-2xx just logs and continues, returns 200 regardless).

## 2. Weather — no metered API exists; the moat is currently free

**Verdict: zero weather API keys, zero paid endpoints, zero weather env vars.** Exhaustive host sweep found exactly four weather hosts, all free-tier/keyless:

| Integration | Mechanism | Cost |
|---|---|---|
| Windguru widget | Client-side script embed, admin dashboard only (`components/WindguruWidget.tsx:24`, rendered `app/page.tsx:1075`) | Free official embed |
| Windy map | iframe embed beside it (`app/page.tsx:1101`) | Free embed |
| Windguru iAPI spot search | Client fetch during admin location setup (`app/page.tsx:348,362`) — **CSP-blocked in prod** (not in `connect-src`, `next.config.ts:33`); silently degrades to manual spot-ID entry | Dead in prod |
| Open-Meteo forecast + marine | **The only server-side weather call**: `supabase/functions/wa-webhook/index.ts:596-597`, two fetches per inbound WhatsApp message that passes a weather-keyword heuristic (`:554-557`). On-demand only | Keyless, free |

- **No cron polls weather.** Complete pg_cron inventory checked — none touches weather. The "poll per tenant per day" naive-implementation worry is not how it was built.
- **The admin "Weather cancel" flow calls no weather API.** `supabase/functions/weather-cancel/index.ts` (read end to end) is a purely manual operator action: close slots, cancel bookings, set `refund_status: ACTION_REQUIRED`, notify. Triggered from five admin call sites.
- **No caching** — but volume is on-demand WhatsApp messages, currently a handful per day. Caching by lat/lng grid becomes relevant only if weather ever becomes proactive (morning go/no-go broadcasts); note kept for that day.

**Two real notes:**
1. **ToS, not cost:** Open-Meteo's keyless tier is licensed for *non-commercial* use. A commercial SaaS calling it is outside those terms. Their commercial API is ~€29/mo flat — budget line if weather becomes a headline feature; irrelevant at today's volume.
2. Per-tenant config exists but is unused: `businesses.weather_widget_locations` is `[]` for all 13 tenants (everyone sees the hardcoded 72-spot SA default list, `app/page.tsx:45-127`). The bot falls back to hardcoded Cape Town coords (`wa-webhook/index.ts:574`) and takes `[0]` of the array rather than the `isDefault` entry (`:575-579`) — wrong-place forecasts for any tenant who reorders. `businesses.weather_relevance` is written by super-admin and read by nothing (dead flag).

## 3. Storage and egress — tiny today, but the pipes are worth fixing cheap

**Live inventory: one bucket with content — `email-images`, 31 objects, 17 MB.** `marketing-assets` and `trip-photos` buckets exist but are empty; `popia-exports` is referenced but was never created (route silently falls back to inline). Customer **trip photos live on Google Drive** (`app/api/guide/photo-upload/route.ts:73-96`) — Google serves 100% of those bytes, cost R0.

### Tour-photo path (upload → customer)

Upload with client-side compression (max 2560px, q0.82, 5 MB hard cap — `app/settings/page.tsx:1380-1411`) → public Supabase URL stored on `tours.image_url` → two delivery paths:

- **Path A (optimized, Vercel egress):** booking-app tour cards go through `next/image` → custom loader (`booking/lib/imageLoader.ts:4`) → `/api/img` sharp proxy. **Vercel Image Optimization is OFF by construction** (custom loader means `/_next/image` never exists) — the billing line the checklist warns about cannot occur in the booking app.
- **Path B (raw hotlink, Supabase egress):** directory hero (`booking/app/components/OperatorDirectory.tsx:384`), success page, embed, GlassBackdrop, and several admin surfaces hotlink the full-size public URL — including a 2.4 MB tour photo served uncompressed.

Admin app: no `images` config at all; its only two `<Image>`s pass `unoptimized` (`components/AppShell.tsx:216,363`). Zero billing today, but nothing fences it — one careless `<Image>` starts billing. Add `images: { unoptimized: true }` to the admin `next.config.ts` as a guard rail.

### The actual egress levers, ranked

1. **Email header PNGs — the biggest one.** Nine ~1 MB PNGs (`cancel_weather.png` 1.9 MB, `payment.png` 1.2 MB, …) are ~60% of all stored bytes and are embedded full-size in every transactional email (`send-email/index.ts:552`), re-fetched by every mail client that renders images. Recompressing them to ~100 KB WebP/JPEG is a 90% cut to the single largest recurring egress source, for an afternoon's work. The upload path already has a compressor — it skips files under 600 KB and these slipped through as one-offs.
2. **`/api/img` has browser caching but no CDN caching.** It sets `Cache-Control: public, max-age=31536000, immutable` (`booking/app/api/img/route.ts:50-51`) but **no `s-maxage`** — every cold edge POP pays a full function invocation + sharp transform. Adding `s-maxage=31536000` is a one-line change that converts repeat traffic from compute into CDN hits.
3. **Paris pinning.** `booking/vercel.json` = `{"regions":["cdg1"]}` — every proxied image for a South African customer routes Supabase (eu-west-3) → Paris function → Cape Town. Deliberate (near the DB), but worth knowing it's on the image path.
4. **Rate-limit collision.** `booking/middleware.ts:6,97` applies the shared 100 req/60s/IP limit to `/api/img` — a tour grid pulling a dozen images spends the same budget as booking API calls; overflow returns a JSON 429 that renders as a broken image.
5. **Directory landing first paint = 1.6 MB of hero JPEGs** rendered simultaneously as raw `<img>` (`OperatorDirectory.tsx:249-266`; `coast-hero.jpg` alone is 828 KB) — static Vercel bandwidth, no optimizer. Recompress/resize the three heroes.
6. Minor: `bt-mark.png` is a 238 KB PNG rendered at ~28 px (`booking/app/components/BrandLogo.tsx:7-8`); the 2.4 MB tour photo exceeds the 2 MB Vercel data-cache entry limit so the proxy re-fetches it from Supabase on every cache miss; sharp failure falls back to caching the *original* bytes for a year (`/api/img` route `:54-63`).

**R2/Cloudflare: confirmed absent everywhere** (all s3/r2 greps are false positives — "S3" is a security-finding ID in comments). The checklist's "decide before photo libraries exist" point stands: at 17 MB and one real tenant, migration cost is near zero, so the *decision* (R2 or Supabase-CDN-only) can be made deliberately, not urgently. Nothing needs to move this month.

Email images are all Supabase egress by design (absolute public URLs in HTML, no proxy) — fine, once the PNGs are shrunk. Social icons hotlink Google's favicon service (`send-email/index.ts:399-404`); open/click tracking bills Supabase function invocations, not Vercel.

## 4. Vector storage — already done the recommended way

**pgvector 0.8.0 is live in the production database.** RAG runs on `kb_chunks` (58 rows) + `admin_kb_chunks` (129 rows) with `match_kb_chunks`/`match_admin_kb_chunks` RPCs and the `kb-sync` cron — per-tenant exact scan by design (plain btree on `business_id`, no HNSW; the file header documents this as the 2000-tenant-proof choice). Confirmed absent: Pinecone, Weaviate, Qdrant, Chroma, Milvus, Turbopuffer, Upstash Vector, LanceDB, FAISS. **No action; this item is already closed.**

**Embeddings are Google Gemini, not OpenAI:** one shared helper for both write and read sides — `supabase/functions/_shared/kb.ts:22-34`, `gemini-embedding-001` at 768 dims (env-overridable via `GEMINI_EMBED_MODEL`), key `GEMINI_API_KEY`. Cost controls already in place: `content_hash` skip means unchanged chunks are never re-embedded (`kb-sync/index.ts:105`), and `kb-sync` is guarded by the `KB_SYNC_KEY` shared secret precisely because embedding sweeps cost money (`kb-sync/index.ts:204-207`). Query-time embedding: one call per bot question (`wa-webhook/index.ts:350,2904`, `web-chat/index.ts:268`, `admin-help-chat/index.ts:88`). At Gemini embedding prices this line is rounding error.

## 5. SMS / Email

### SMS — confirmed: none, anywhere

Word-boundary grep for `sms` and every SA/global provider (Twilio, Clickatell, BulkSMS, SMSPortal, WinSMS, Vonage, MessageBird, Africa's Talking, Nexmo, Plivo, Sinch) across all code and both `package.json`s: **zero hits**. The only "SMS" mentions repo-wide are docs prose (Meta sending a WhatsApp registration code to the operator's SIM, and marketing copy about competitors). **The checklist item "remove SMS from confirmation flows" has nothing to remove.** Customer messaging is email + WhatsApp only — and since 2026-07-31, transactional notifications are email-canonical with WhatsApp gated to no-email-on-file customers, which already minimised the WA line ahead of the October pricing change.

### Email — Resend, single provider, five integration points

Provider: **Resend** (`RESEND_API_KEY`, sender `RESEND_FROM_EMAIL`, `@resend.dev` sandbox refused — `send-email/index.ts:12,28-31`). No SES, SendGrid, Mailgun, Postmark, SMTP, or nodemailer anywhere.

Worth knowing for a future switch: there is **no single funnel**. Five functions call the Resend API directly:

| Function | Endpoint | Mode |
|---|---|---|
| `send-email/index.ts:87` | `/emails` | single (29 email types; the main transactional funnel) |
| `marketing-dispatch/index.ts:234` | `/emails/batch` | **batch** (every-minute cron; highest volume by design) |
| `marketing-automation-dispatch/index.ts:300` | `/emails` | single per contact |
| `send-invoice/index.ts:207` | `/emails` | single |
| `send-otp/index.ts:250` | `/emails` | single (admin OTP; customer OTP routes via send-email) |

A Resend→SES switch therefore touches 5 files, not 1. Not worth consolidating now; worth remembering then.

**Volume today is negligible:** 45 bookings/30d and 0 marketing sends/30d — deep inside Resend's free tier. The SES switch point (~R400+/mo gap) sits around tens of thousands of emails/month, i.e. dozens of active tenants running campaigns. **Meter, don't move.** The volume drivers to watch when metering: marketing-dispatch (batch, cron every minute), auto-messages/reminder-scheduler (per-booking reminders + indemnity), cron-tasks (payment links/reminders), webhook confirmations, and vouchers.

## 6. Commercial levers — the machinery is half-built, and it's the enforcement half that's missing

### Dormant tenant tiering — pause EXISTS and is well built, but only on the billing side

What exists (all server-side, audit-logged):

- Self-service pause/resume: `POST /api/billing/pause` and `/resume` (`app/api/billing/pause/route.ts`, `resume/route.ts`) — sets `subscriptions.status='PAUSED'`, mirrors to `businesses.subscription_status`.
- **Pro-rated invoicing that replays pause history**: `app/lib/platform-billing.ts:53-123` walks the chronological `BILLING_PAUSED`/`BILLING_RESUMED` audit log, carries the cursor across month boundaries, and bills `activeDays/totalDays` with a human-readable pause note (`app/api/platform-invoices/generate/route.ts:61-66`). This is the hard part of "seasonal pause", already done.
- Dashboard + API lockout: `components/AuthGate.tsx:492-503` blocks PAUSED/SUSPENDED; `app/lib/api-auth.ts:43-64` fails closed server-side for non-ACTIVE/TRIAL (billing routes exempted so a paused tenant can reactivate).

What pausing does **not** do — the cost side of the checklist's "paused = pure margin" idea is entirely absent:

- **Crons keep firing for paused tenants.** Zero `subscription_status`/`PAUSED` checks in `cron-tasks`, `auto-messages`, `marketing-dispatch`, or `reminder-scheduler`. A paused tenant still consumes Resend sends, Gemini embeddings, and edge invocations.
- **The public booking site stays live.** `booking/app/lib/tenant-server.ts:17` fetches `subscription_status` into the tenant payload but nothing in `/booking` reads it for gating — a paused or suspended tenant's storefront keeps taking bookings and payments.
- No data archival, no RAG-index drop/rebuild, no `DORMANT` state. (A richer lifecycle with `CANCELLED` and `paused_at` sits in a parked migration, `supabase/migrations/.parked/20260505100000_billing_self_service.sql:36`, never applied.)

### Involuntary churn / dunning — ABSENT entirely, and the reason matters

There is **no stored card and no auto-debit at all**: platform invoices are paid by a Yoco payment link (`platform-invoice-checkout/index.ts:51-62`, BookingTours' own merchant key, signed + idempotent webhook marks PAID) or manual EFT (`mark-paid/route.ts`). So the classic involuntary-churn failure mode (card expiry on a recurring charge) *cannot happen yet* — because nothing recurs. The actual risk today is the inverse of dunning:

- **Invoice generation is manual**, per tenant, SUPER_ADMIN-triggered (`app/api/platform-invoices/generate/route.ts:19-20`); no cron schedules platform invoicing.
- **An unpaid invoice triggers nothing.** `platform_invoices.status` and `subscriptions.status` are fully disconnected — no code path reads one to set the other. `PAST_DUE` is documented in the migration (`20260319130600_subscription_status.sql:2`) and referenced by zero lines of code. Suspension is a human clicking a toggle (`app/super-admin/page.tsx:202`).
- One fail-open: `requireActiveSubscription` defaults a tenant with **no subscription row** to ACTIVE (`app/lib/api-auth.ts:62`).
- No retry columns, no `dunning_stage`, no scheduled re-send of `PLATFORM_INVOICE_OUTSTANDING` (sent once, manually).

When recurring billing gets built, dunning should be designed in at the same time — retro-fitting it is the expensive path.

### Annual prepay — ABSENT

Monthly only: single Standard plan, R2000/mo + R500/seat (`supabase/migrations/20260716120000_single_plan_pricing.sql:9-18`), plus a marketing-email overage line (`generate/route.ts:68-80`). No `billing_interval`, no annual/prepay column or code path, no discount mechanism. Everything (invoices, period helpers) is month-denominated — adding annual later means touching the period math in `app/lib/billing-period.ts` and the invoice generator, but nothing structural blocks it.

---

## Found in passing (not cost — correctness/tenant-isolation)

These surfaced during the audit and deserve their own tickets:

1. **Broadcasts "weather cancel" bypasses the edge function** — `app/broadcasts/page.tsx:183-306` is a second client-side implementation: updates `slots` with **no `business_id` filter** (`:199`), non-atomic capacity read-modify-write (`:220-226`), and never sets `refund_status: ACTION_REQUIRED`, so paid customers cancelled via Broadcasts get no refund choice. The proper path (`weather-cancel` edge fn) does all of this correctly.
2. **Hardcoded Cape Kayak branding leaks to other tenants:**
   - Booking-confirmation email block hardcodes "Cape Kayak Adventures / 180 Beach Rd" as literal text (`send-email/index.ts:792-800`); the maps link is only rebrand-substituted when `branding.directions` is non-empty (`:507-509`).
   - Admin WhatsApp confirmation hardcodes the Cape Kayak maps URL (`app/new-booking/page.tsx:656`).
   - Google review deep links (`g.page/r/...`) hardcoded to Cape Kayak's review page in `send-trip-photos/index.ts:69`, `cron-jobs/index.ts:149`, `reminder-scheduler/index.ts:64` — despite `businesses.social_google_reviews` existing and being used elsewhere.
3. **`fetch-google-reviews` is unauthenticated** (see 1b) — cost + abuse surface.
4. Bot weather picks `weather_widget_locations[0]` instead of the `isDefault` entry, and falls back to hardcoded Cape Town coords (`wa-webhook/index.ts:574-579`).
5. `popia-exports` bucket referenced in code but doesn't exist (silent fallback).
6. Dead: `businesses.weather_relevance` flag (written, never read); `booking/app/components/ChatWidget.tsx.save` (tracked dead code with hardcoded Cape Kayak maps URL); `PAST_DUE` enum value (documented in `20260319130600_subscription_status.sql:2`, referenced by zero code).
7. **Paused/suspended tenants keep trading**: their public booking site takes bookings and payments, and their crons keep firing (see §6) — the lockout is dashboard/API only.
8. `requireActiveSubscription` **fails open** for tenants with no subscription row (`app/lib/api-auth.ts:62`, `data?.status ?? "ACTIVE"`).
9. `/api/img` sharp-failure fallback caches the *original* full-size bytes for a year under a webp content-type (`booking/app/api/img/route.ts:54-63`).

## The checklist, re-sorted against reality

**Decide now (expensive to reverse) — mostly already decided correctly:**
- Static-vs-dynamic maps: moot — no maps exist; meeting points are text + free links. Keep it that way; if maps ever ship, the booking-app CSP will force a deliberate decision anyway (no Google host allowed, and no lat/lng columns exist — text only).
- Weather by geography: moot today — weather is on-demand per WhatsApp message, not polled. The geographic-cache insight applies the day weather becomes proactive (morning go/no-go broadcasts). The real weather item is Open-Meteo's non-commercial terms (~€29/mo commercial tier when it matters).
- pgvector: already the implementation. Closed.
- R2/media: genuinely undecided, but at 17 MB of media and trip photos on Google Drive, there is nothing to migrate yet. Decide the posture when a real photo-library feature ships; nothing this month.

**Do this week (small, cost- or leak-shaped, all < an afternoon each):**
1. Recompress the 9 email header PNGs (~10 MB → ~1 MB total) — the single largest recurring egress source.
2. `fetch-google-reviews`: weekly cadence + shared-secret auth + read the `google_reviews_last_synced_at` skip guard — before any tenant configures a Place ID and turns the top-tier SKU on.
3. Add `s-maxage` to `/api/img` responses; recompress the 3 directory hero JPEGs (1.6 MB first paint).
4. Add `images: { unoptimized: true }` to the admin `next.config.ts` as a fence against accidental Image Optimization billing.

**Meter now, fix at threshold:**
- Email: Resend until tens of thousands of emails/month; remember the switch touches 5 files.
- Platform invoicing automation + auto-suspend on non-payment: fine manually at 1 real tenant; automate before ~10.
- Paused-tenant cost shedding (skip crons for PAUSED, gate the storefront): build when the first real pause happens.

**Off the checklist but on the bill:** the largest *actual* metered API line in this stack is the LLM stack — bot replies via OpenRouter (DeepSeek V4 Pro, `xhigh` reasoning effort by default since 2026-08-02) plus Gemini for embeddings/intent. None of the six checklist items comes close to it at today's volumes. If the cost mission continues, instrument that first.

## Live production volumes (2026-08-03)

| Metric | Value |
|---|---|
| Tenants (`businesses`) | 13 (mostly test; 1 real) |
| Tours | 7 |
| Bookings, last 30d | 45 |
| Marketing queue rows, last 30d | 0 |
| Tenants with `google_place_id` | **0** |
| Tenants with weather widgets configured | **0** (all `[]`) |
| Tenants with meeting point set | 1 |
| Storage total | 17 MB (31 objects, `email-images` only) |
| Trip photos | 6 (on Google Drive) |
| `kb_chunks` / `admin_kb_chunks` | 58 / 129 |
| pgvector | v0.8.0 installed |
