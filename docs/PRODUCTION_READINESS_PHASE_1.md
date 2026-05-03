# Production-Readiness Review — Phase 1: Architecture Map & Integration Seam Inventory

**Review target:** BookingTours platform (4 apps, shared Supabase)
**Reviewer:** Claude (Opus 4.7)
**Date:** 2026-04-17
**Status:** Awaiting sign-off before Phase 2 begins
**Reliability target for overall review:** ≥95% across all cross-app user interactions

---

## 0. How to read this document

Phase 1 is architecture-only. No journeys tested, no benchmarks run, no failures catalogued. Its sole purpose is to establish the ground truth of the system so Phases 2–6 land on a correct foundation.

Three things must be reviewed before Phase 2 begins:

1. The three corrections to your mental model in §2. If any are wrong, tell me.
2. The integration seam inventory in §7. If any seam is missing or mislabelled, tell me.
3. The open questions in §9. I need answers (or "unknown — investigate in Phase 4") for each.

Any text tagged **[NEEDS CONFIRMATION]** is something I inferred from code but did not verify against a live deployment.

---

## 1. Executive Summary

The BookingTours platform is **four independently-deployed Next.js / static applications that share a single Supabase project** (`ukdsrndqhsatjkmxijuj`). All backend logic — payments, email, WhatsApp, cron, marketing, AI chat — lives in Supabase Edge Functions owned by the admin repo. The other three apps are primarily front-ends against that shared backend.

- **Landing site:** static Next.js export on **Firebase Hosting** (all other apps are on Vercel). This is an architectural anomaly.
- **Onboarding:** server-rendered Next.js on Vercel; writes tenants to Supabase using the service-role key.
- **Booking site:** client-rendered multi-tenant Next.js on Vercel; resolves tenant by `window.location.origin` ↔ `businesses.booking_site_url`. Cape Kayak's customer site (`book.capekayak.co.za`) is a **tenant** of this app, not a separate codebase.
- **Admin dashboard:** Next.js on Vercel with custom SHA-256 email+password auth (not Supabase Auth), a `business_id`-scoped session in localStorage, and the full edge-function suite.

The system is **coherent but has several integration smells** that will surface in later phases: 35 duplicated ` 2.tsx` files in the booking app, two `package.json` files named `"booking"` serving opposite purposes, a client-side service-role key in the Onboarding template, dead `href="#"` CTAs on the landing page, no cross-app session (each app re-authenticates), and a single Supabase project as a hard single-point-of-failure for all four apps.

**Bottom line for Phase 1:** the architecture is understandable and tellable. The system looks like it can reach 95% reliability, but several of the smells above are likely to map directly onto Phase 5 failure modes.

---

## 2. Corrections to the initial mental model

Three assumptions in your prompt differ materially from what is on disk.

### 2.1 `desktop/capekayak` is not the Cape Kayak booking site

Your prompt described capekayak as *"the Cape Kayak Adventures instance (the original/reference implementation of the booking site)."*

**Reality:** this project is the **multi-tenant admin dashboard** ("BookingTours Admin Dashboard" per `app/layout.tsx:13`). It has no customer booking UI. Its routes are `/bookings`, `/slots`, `/refunds`, `/marketing`, `/super-admin`, etc.

The Cape Kayak customer-facing site (`book.capekayak.co.za`) is served by the **generic booking app** at `~/dev/booking`, which matches that hostname against `businesses.booking_site_url` on page load (see `booking/app/components/ThemeProvider.tsx:89–137`) and renders Cape Kayak's branding/tours/slots based on the matched row.

**Implication:** there is no "Cape Kayak codebase" to maintain separately. Cape Kayak is a row in `businesses` and a custom domain pointed at the `booking` Vercel project. Every other operator works the same way. This is *good news* — a single booking codebase to test.

### 2.2 `desktop/activityhub/onboarding` is ambiguous — there are two candidate directories

`~/Desktop/ActvityHub/` contains **both** `Onboarding/` and `onboarding2/`. Both have `"name": "booking"` in package.json.

- **`Onboarding/`** is the real operator-onboarding wizard. Deployed to Vercel as `bookingtours-onboarding` at `onboarding.bookingtours.co.za`. Recent commits (last a few days ago). Full `app/api/onboarding/route.ts` that provisions `businesses`, `admin_users`, `policies`, `tours`, `slots`, `subscriptions`, `landing_page_orders` rows.
- **`onboarding2/`** is a dead shell. No git history, blank `.env.example`, no `.vercel` config, last touch 2026-03-19. Should be deleted.

I'll use the name "Onboarding" for the live app throughout this document. I recommend deleting `onboarding2` before any launch.

### 2.3 `desktop/landingpage` is on Firebase Hosting, not Vercel

The landing page is a **static Next.js export** (`next.config.ts:4 — output: "export"`) deployed to **Firebase Hosting** (project `booking123-6106`, see `landingpage/firebase.json`, `landingpage/.firebaserc`). Every other app is Vercel. This has three knock-on effects:

- Vercel's platform observability (logs, Web Vitals, Speed Insights) does not cover the landing page.
- Operator counts, testimonials, and pricing on the landing page are hardcoded arrays — updates require a rebuild and Firebase redeploy, not a content change.
- Firebase and Vercel have separate DNS/CDN, separate regional topology, and separate failure modes. Phase 3 benchmarks must treat the landing page as a separate infrastructure lane.

Also notable: the `landing-pages/` **folder inside the admin repo** (different from the `landingpage` app) is a **separate** per-operator templated-page generator that also deploys to the same Firebase project. That makes Firebase the host of two distinct things: the root marketing site and per-operator custom pages. This is not obviously broken but it is easy to confuse — they share a Firebase project and therefore a caching/CDN lane.

---

## 3. Architecture diagram

```
                             ┌──────────────────────────────────┐
                             │   bookingtours.co.za (marketing) │
                             │   Firebase Hosting · static      │
                             │   repo: ~/Desktop/landingpage    │
                             └────────┬──────────┬──────────────┘
                                      │          │
                                      │          │ "Login"
                                      │ "Get     ▼
                                      │ Started" admin.bookingtours.co.za
                                      ▼          
           onboarding.bookingtours.co.za ──────► (operator uses dashboard)
           Vercel · Next.js SSR                       │
           repo: ~/Desktop/ActvityHub/Onboarding      │
                    │                                  │
                    │ service-role writes              │
                    ▼                                  ▼
     ┌────────────────────────────────────────────────────────────┐
     │       Supabase project  ukdsrndqhsatjkmxijuj               │
     │  ┌───────────────────────────────────────────────────────┐ │
     │  │ Postgres: businesses, tours, slots, bookings,        │ │
     │  │ admin_users, vouchers, conversations, marketing_*,   │ │
     │  │ subscriptions, combo_offers, holds, waivers, outbox… │ │
     │  │ ~25 core tables, RLS enabled, business_id tenancy    │ │
     │  └───────────────────────────────────────────────────────┘ │
     │  ┌───────────────────────────────────────────────────────┐ │
     │  │ Edge Functions (deployed from capekayak repo)        │ │
     │  │  public (verify_jwt=false): yoco-webhook,            │ │
     │  │   paysafe-webhook, wa-webhook, web-chat,             │ │
     │  │   external-booking, weather-cancel, marketing-*,     │ │
     │  │   cron-tasks, auto-messages, outbox-send, waiver-form│ │
     │  │  gated (verify_jwt=true): send-whatsapp-text,        │ │
     │  │   send-otp, send-invoice, rebook-booking,            │ │
     │  │   admin-reply, generate-invite-token, google-drive,  │ │
     │  │   super-admin-onboard, manual-mark-paid, …           │ │
     │  └───────────────────────────────────────────────────────┘ │
     │  ┌───────────────────────────────────────────────────────┐ │
     │  │ pg_cron: cron-tasks (1–5 min), marketing automations,│ │
     │  │  auto-messages, outbox-send                          │ │
     │  └───────────────────────────────────────────────────────┘ │
     └──────┬────────────────▲──────────────────────────▲─────────┘
            │                │                          │
            │ anon key       │ anon key                 │ service-role
            │ reads/writes   │ reads/writes             │ reads/writes
            ▼                │                          │
    admin.bookingtours.co.za │                          │
    Vercel · Next.js         │                          │
    repo: ~/Desktop/         │                          │
           CapeKayak/        │                          │
           capekayak         │                          │
    Vercel project:          │                          │
      caepweb-admin          │                          │
                             │                          │
                             │                          │
                  book.capekayak.co.za  ◄─────────┐    │
                  *.{operator-domains}            │    │
                  Vercel · Next.js                │    │
                  repo: ~/dev/booking         │    │
                  Vercel project: booking         │    │
                  Multi-tenant: ThemeProvider     │    │
                   resolves tenant by             │    │
                   businesses.booking_site_url    │    │
                                                  │    │
                       ▲                          │    │
                       │ 3rd-party webhooks ──────┘    │
                       │ (Yoco, Paysafe, Meta WA,      │
                       │  weather service)             │
                       │                               │
                       └───────────────────────────────┘
                         Customers arrive directly via
                         operator domain. (No outbound
                         link from landingpage to a
                         specific booking site today.)
```

Key facts the diagram encodes:

- **One Supabase project, four apps.** Rotate the anon key and all four apps must be redeployed.
- **All backend logic lives behind edge functions owned by the admin repo.** The booking, onboarding, and landing apps do not host their own server logic.
- **Payment webhooks target edge functions directly**, not the admin UI. Breaking the admin UI does not break payments.
- **No user link exists today from the root landing page (bookingtours.co.za) to any individual operator's booking site.** The marketing site's CTAs only point to onboarding and admin.

---

## 4. Per-app summaries

### 4.1 Admin dashboard · `~/Desktop/CapeKayak/capekayak`

| Field | Value |
|---|---|
| Framework | Next.js 16.2.2, React 19.2.4, TypeScript, Tailwind 3 |
| Deploy | Vercel · project `caepweb-admin` |
| Domain | `admin.bookingtours.co.za` |
| Auth | **Custom**: email + SHA-256 (client-side, no salt) against `admin_users.password_hash`; 12h localStorage session (`ck_admin_*` keys); 5-attempt lockout; setup-link flow via `send-email`. Roles: ADMIN · MAIN_ADMIN · SUPER_ADMIN. |
| Tenancy | `business_id` on every table + `BusinessContext`; SUPER_ADMIN can override via localStorage key |
| Routes | `/`, `/bookings`, `/bookings/[id]`, `/new-booking`, `/slots`, `/refunds`, `/inbox`, `/vouchers`, `/invoices`, `/weather`, `/photos`, `/broadcasts`, `/pricing`, `/reports`, `/marketing/{contacts,templates,automations/[id],promotions}`, `/settings` (privileged), `/super-admin` (privileged), `/operators` (public-ish), `/change-password`, `/google-callback`, `/case-study/cape-kayak`, `/compare/*` |
| API routes | `/api/credentials`, `/api/partnerships`, `/api/partnerships/approve`, `/api/partner-tours`, `/api/combo-offers`, `/api/combo-settlements`, `/api/combo-cancel` |
| Edge functions owned | 42 functions under `supabase/functions/` (covered in §5.2) |
| Notable files | `components/AuthGate.tsx` (session + role gating), `components/AppShell.tsx` (nav), `components/BusinessContext.tsx`, `supabase/functions/_shared/tenant.ts` |
| Smells | (a) SHA-256 without salt for admin auth; (b) permissive fallback RLS policies `FOR ALL USING (true)` from migration `20260316143000`; (c) audit-log timeline is a TODO on `/bookings/[id]`; (d) marketing content (`case-study/cape-kayak`, `compare/*`) lives in the admin deployment — unusual; (e) duplicate `case-study/cape-kayak 2/` folder; (f) setup-link error handling in `admin-auth.ts:74–91` swallows failures |

### 4.2 Customer booking site · `~/dev/booking`

| Field | Value |
|---|---|
| Framework | Next.js 16.1.6, React 19.2.3, TypeScript, Tailwind 3, DOMPurify |
| Deploy | Vercel · project `booking`, Node **24.x** in `.vercel/project.json` but `>=20.10.0` in package.json — version drift to reconcile |
| Domain | Per-operator custom domain (e.g. `book.capekayak.co.za`); tenant resolved at runtime |
| Auth | Anonymous checkout; OTP (email or phone) for `/my-bookings` only via `send-otp` edge function |
| Tenancy | `ThemeProvider.resolveBusiness()` matches `window.location.origin` to `businesses.booking_site_url`. Fallbacks: `NEXT_PUBLIC_BUSINESS_ID` env lock, `?business_id=` query param, first row in `businesses` |
| Routes | `/`, `/book` (calendar → details → payment), `/combo/[id]` (two-tour combo with Paysafe inline SDK), `/voucher` (gift voucher purchase), `/my-bookings` (OTP-gated), `/success`, `/cancelled`, `/voucher-success`, `/voucher-confirmed`, `/waiver`, `/privacy`, `/terms`, `/cookies` |
| Edge fns called | `create-checkout`, `create-paysafe-checkout`, `confirm-booking`, `send-email`, `send-otp`, `rebook-booking`, `web-chat` |
| Rate limiting | `middleware.ts`: 100 req / 60s / IP on `/api/*` — but there **are no `/api/*` routes in this app**. Rate limit is dead code. |
| Key RPCs | `validate_promo_code`, `apply_promo_code`, `deduct_voucher_balance` |
| Smells | (a) **35 files with ` 2.` or ` 3.` suffix** in `app/` — dead duplicates from manual version merges (e.g. `book/page 2.tsx`, `my-bookings/page 3.tsx`); (b) `ThemeProvider.resolveBusiness()` has no error UI — failure silently drops to `defaults`, so a customer hitting an unmapped domain sees a broken page with no message; (c) `.vercel/project.json` says Node 24.x, `package.json.engines` says Node ≥20.10.0; (d) `middleware.ts` rate-limit applies to `/api/*` that doesn't exist; (e) no retry/backoff on `create-checkout` failure — one stale edge-function instance = one lost booking |

### 4.3 Operator onboarding · `~/Desktop/ActvityHub/Onboarding`

| Field | Value |
|---|---|
| Framework | Next.js 16 App Router, TypeScript, Tailwind (package name `"booking"` is misleading) |
| Deploy | Vercel · project `bookingtours-onboarding` |
| Domain | `onboarding.bookingtours.co.za` |
| Auth | None on the form itself; rate-limit 3 attempts / IP / hour |
| Flow | One-page wizard → POST `/api/onboarding` → provisions ~7 tables → sends setup email to operator via Resend and notification to SUPER_ADMIN_EMAIL |
| Tables written | `businesses`, `admin_users`, `policies`, `tours`, `slots` (auto-generated from schedule), `subscriptions`, `landing_page_orders` |
| Key file | `app/api/onboarding/route.ts` — does all the writes |
| External calls | Resend (email), Supabase with **service-role key** |
| Smells | (a) **service-role key in `.env.example`** — one misconfigured deployment = admin DB access from a public endpoint; (b) package.json name collides with `~/dev/booking`; (c) credential encryption for WhatsApp/Yoco happens server-side in the route (review the key custody model in Phase 4); (d) auto-slot-generation to `slots` happens in one big transaction — behaviour at scale (operator enters 50 tours × 180 days of slots = 9000 rows) untested |

### 4.4 Marketing landing · `~/Desktop/landingpage`

| Field | Value |
|---|---|
| Framework | Next.js 16.2.2 **static export**, React 19.2.4, Tailwind 4, Framer Motion |
| Deploy | **Firebase Hosting** · project `booking123-6106` |
| Domain | `bookingtours.co.za` |
| Data | Fully static — no Supabase, no API, hardcoded arrays for features, pricing, testimonials |
| CTAs | All route to `https://onboarding.bookingtours.co.za` (Get Started / Book a Demo) or `https://admin.bookingtours.co.za` (Login) via `src/lib/links.ts` |
| Env | None required; env overrides optional (`NEXT_PUBLIC_ONBOARDING_URL`, etc.) |
| Smells | (a) **Dead CTAs in `CTA.tsx`** — two buttons use `href="#"` instead of the link constants; (b) branding inconsistency — Navbar says "Cape Kayak", Footer says "ActivityHub"; (c) hardcoded "Trusted by 120+ adventure operators" will rot; (d) no sitemap.xml / robots.txt; (e) images not optimized (`images.unoptimized: true` is forced by Firebase static export) |

---

## 5. Shared infrastructure inventory

### 5.1 Supabase project

**One project**, shared by all four apps: `ukdsrndqhsatjkmxijuj.supabase.co`. Confirmed from `.env.local` / `.env.example` in admin, booking, and onboarding. Landing has no Supabase connection.

Failure mode: if this project is degraded, **all four apps fail**. Landing page keeps serving but CTAs lead to a broken onboarding flow. Customer bookings fail at slot-load or at payment-create. Admin cannot log in.

This is the single biggest production risk in the system. It is *expected* for a small SaaS, but it must be named.

### 5.2 Edge functions — caller map

Owned by the admin repo; deployed to Supabase. Grouped by who calls them.

**Called by external services (payment / WhatsApp / weather provider):**
- `yoco-webhook` · `paysafe-webhook` · `wa-webhook` · `weather-cancel` · `external-booking` · `marketing-track` (email tracking pixel) · `marketing-unsubscribe` · `waiver-form` (public signing page) — all `verify_jwt=false`.

**Called by the booking site:**
- `create-checkout` (Yoco) · `create-paysafe-checkout` (combos) · `confirm-booking` (fallback on `/success`) · `send-email` (voucher balance, reschedule confirmation) · `send-otp` (my-bookings login) · `rebook-booking` · `web-chat`.

**Called by the admin dashboard:**
- `send-whatsapp-text` · `send-invoice` · `admin-reply` · `generate-invite-token` · `manual-mark-paid` · `process-refund` · `batch-refund` · `broadcast` · `google-drive` · `super-admin-onboard` · `debug-logs` · `send-email` (setup link).

**Called by pg_cron inside Supabase:**
- `cron-tasks` (holds expiry, reschedule processing, reminders, outbox) · `marketing-dispatch` · `marketing-automation-dispatch` · `auto-messages` · `reminder-scheduler` · `outbox-send`.

**Called by the onboarding app:** none directly — `route.ts` writes to Postgres and calls Resend itself, then relies on the operator clicking the emailed setup link (handled by admin).

### 5.3 Payment providers

| Provider | Checkout created by | Webhook handler | Used for |
|---|---|---|---|
| Yoco | `booking` via `create-checkout` edge fn | `yoco-webhook` (public) | Standard tour bookings, gift vouchers |
| Paysafe | `booking` via `create-paysafe-checkout` edge fn + inline SDK | `paysafe-webhook` (public) | **Combo bookings only** (split payment between two operators) |

Credentials are stored **per-business** in `businesses.credentials` JSONB, encrypted with `SETTINGS_ENCRYPTION_KEY`. Decryption happens inside edge functions. Key rotation is a manual DB procedure today.

### 5.4 Email & messaging

| Service | Used by | Credential |
|---|---|---|
| Resend (email) | admin (`send-email`, `send-invoice`, `marketing-dispatch`, `outbox-send`), onboarding (`api/onboarding/route.ts`) | `RESEND_API_KEY` — one key shared; a bad rotation breaks both apps |
| WhatsApp Business API (Meta) | admin only (`send-whatsapp-text`, `wa-webhook`, `broadcast`, `auto-messages`) | Per-business `waToken`, `waPhoneId` encrypted in `businesses.credentials` |
| Gemini (Google AI) | admin edge fns (`web-chat`, auto-reply suggestions) | `GEMINI_API_KEY` platform-wide |
| Google Drive | admin only (`google-drive` edge fn, `/google-callback` admin route) | Per-business OAuth token in `businesses` (encryption status: **[NEEDS CONFIRMATION]**) |
| Nominatim + Windguru + Windy (weather) | admin UI client-side (iframes / public APIs) | None / public |

### 5.5 Domains / DNS

| Domain | App | Hosting |
|---|---|---|
| `bookingtours.co.za` | landingpage (marketing) | Firebase |
| `onboarding.bookingtours.co.za` | Onboarding | Vercel |
| `admin.bookingtours.co.za` | capekayak (admin dashboard) | Vercel |
| `book.capekayak.co.za` | booking (Cape Kayak tenant) | Vercel |
| `{subdomain}.bookingtours.co.za` | landing-pages generator (per-operator static pages) | Firebase (same project as landing) |
| Other operator domains | booking (tenant via `booking_site_url`) | Vercel |

Four different cookie domains (`.bookingtours.co.za`, `.capekayak.co.za`, operator roots, Firebase default). **No cross-domain session today.** Each app re-authenticates independently.

### 5.6 Environment variables — coordination surface

Shared across multiple apps (rotating one = redeploy several):

| Var | Admin | Booking | Onboarding | Landing |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✓ | ✓ | ✓ | — |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓ | ✓ | ✓ | — |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ (server) | — | ✓ (server) | — |
| `RESEND_API_KEY` | ✓ (edge fn secret) | — | ✓ (server) | — |
| `SETTINGS_ENCRYPTION_KEY` | ✓ (edge fn secret) | — | ✓ | — |
| `SUPER_ADMIN_EMAIL` | ✓ | — | ✓ | — |

### 5.7 Realtime, Storage, Cron

- **Realtime:** admin only (live bookings + inbox). Booking site is poll-only (no subscriptions observed).
- **Storage:** admin writes trip photos to Google Drive, not Supabase Storage (grep found no `.storage.from(`). **[NEEDS CONFIRMATION]** — verify no bucket usage for invoices, waivers, logos, before Phase 4.
- **Cron:** pg_cron inside Supabase, scheduling `cron-tasks` every 1–5 minutes plus other marketing/outbox jobs. **No** Vercel cron, **no** GitHub Actions cron.

---

## 6. Data flow map

### 6.1 New operator — landing → onboarding → admin

```
Operator on bookingtours.co.za
  ↓ clicks "Get Started"  (static href in landingpage)
onboarding.bookingtours.co.za  (fills multi-step wizard)
  ↓ POST /api/onboarding   (server-side route in Onboarding app)
Supabase (service-role writes):
  INSERT businesses · admin_users · policies · tours · slots · subscriptions · landing_page_orders
  ↓ Resend send            (setup-link email to operator)
  ↓ Resend send            (notification email to SUPER_ADMIN_EMAIL)
Operator receives email → clicks setup link
  ↓ loads admin.bookingtours.co.za/change-password?mode=setup&email=…&token=…
Admin app: set password → login → BusinessContext resolves tenant → dashboard renders.
```

### 6.2 Customer booking — landing or direct → booking → payment → admin

```
Customer on {operator-domain} (e.g. book.capekayak.co.za)
  ↓ ThemeProvider.resolveBusiness() → businesses.booking_site_url match
Select tour → calendar → slot → qty → details
  ↓ (optional) validate_promo_code / apply_promo_code RPC
  ↓ (optional) deduct_voucher_balance RPC
Branch A: total = 0 after vouchers → booking marked PAID inline, skips payment.
Branch B: total > 0 → call create-checkout (or create-paysafe-checkout for combos)
  ↓ redirect to provider hosted checkout (or inline Paysafe SDK)
Provider success → provider hits yoco-webhook / paysafe-webhook (public edge fn)
  ↓ UPDATE bookings SET status = PAID · INSERT invoices row · INSERT outbox row
  ↓ confirm-booking handles confirmation email + WhatsApp template
Customer redirected to /success?ref=<booking_id>
  ↓ /success calls confirm-booking as idempotent fallback (belt-and-braces)
Admin sees booking via Supabase Realtime subscription on bookings table.
```

Observed risk: **confirm-booking is called twice on the happy path** (webhook + /success fallback). Assumed idempotent. **[NEEDS CONFIRMATION]** — read the edge fn for a duplicate-send guard.

### 6.3 Ongoing — cron, marketing, inbox

- pg_cron fires `cron-tasks` every ≤5 min → holds expiry, reschedule processing, reminders queued into `outbox`.
- `outbox-send` drains the queue via Resend / WhatsApp.
- `marketing-dispatch` / `marketing-automation-dispatch` run from cron for campaigns and automations.
- `wa-webhook` + `web-chat` write to `conversations`; admin subscribes via Realtime and can reply via `admin-reply`.

---

## 7. Integration seam inventory

Each seam is a place where one app touches another, or an external system touches one of the four apps. These are where cross-app bugs live. Phase 2 journey tests must exercise each one at least once.

| # | Seam | From | To | Mechanism | Failure mode |
|---|---|---|---|---|---|
| S1 | Marketing → Onboarding | landing | onboarding | static href `PRIMARY_CTA_HREF` | Bad domain / CORS / redirect chain; user dead-ends on 404 |
| S2 | Marketing → Admin | landing | admin | static href `LOGIN_HREF` | Same |
| S3 | Marketing CTA (broken) | landing | — | `href="#"` in `CTA.tsx` | **Known dead CTA** — 0% success |
| S4 | Onboarding → Supabase | onboarding `api/onboarding/route.ts` | DB (service role) | PostgREST | Partial writes if transaction not atomic across all 7 tables |
| S5 | Onboarding → Resend | onboarding | Resend | HTTP | Email delayed/undelivered; operator never gets setup link |
| S6 | Onboarding → Admin handoff | email setup-link | admin `/change-password` | URL with `token` | Token expiry / mismatch / wrong domain |
| S7 | Admin → Supabase | admin UI | DB (anon) | PostgREST + RLS | RLS policy mismatch leaks cross-tenant data |
| S8 | Admin → Supabase Storage / Drive | admin | Google Drive | OAuth | Token expiry, quota |
| S9 | Admin → Edge fns (privileged) | admin UI | `send-whatsapp-text`, `send-invoice`, … | Supabase client `functions.invoke` | Cold start, JWT validation |
| S10 | Admin Realtime subscription | admin | Postgres Realtime | WebSocket | Reconnect storms, dropped events |
| S11 | Admin custom marketing pages | admin deployment | — | Static Next.js | Marketing content in admin app is an odd coupling — moving pages later will break SEO paths |
| S12 | Booking → Supabase | booking UI | DB (anon) | PostgREST + RLS | Cross-tenant read if RLS misconfigured + `resolveBusiness()` picks fallback row |
| S13 | Booking → create-checkout (Yoco) | booking UI | edge fn | `functions.invoke` | Cold start → payment never initiated → lost booking |
| S14 | Booking → create-paysafe-checkout | booking UI | edge fn | `functions.invoke` + inline SDK | Inline SDK load failure |
| S15 | Booking → send-otp | booking UI (my-bookings) | edge fn | `functions.invoke` | OTP rate-limit collision with onboarding's rate limit |
| S16 | Booking → confirm-booking | booking `/success` | edge fn | `functions.invoke` + fetch in parallel with webhook | Double-send if not idempotent |
| S17 | Yoco → admin infra | Yoco servers | `yoco-webhook` edge fn | HTTP POST | Signature validation, idempotency |
| S18 | Paysafe → admin infra | Paysafe servers | `paysafe-webhook` edge fn | HTTP POST | Signature validation, idempotency |
| S19 | Meta WhatsApp → admin infra | WA Business API | `wa-webhook` edge fn | HTTP POST + verify token | 24-hour window expiration, template approval |
| S20 | Weather service → admin infra | unknown weather provider | `weather-cancel` edge fn | HTTP POST | Auth model unclear — **[NEEDS CONFIRMATION]** |
| S21 | Admin email tracking | Recipient mail client | `marketing-track` edge fn | Pixel GET + redirect | Bot prefetch false positives (Gmail, Apple Mail) |
| S22 | Admin unsubscribe | Recipient | `marketing-unsubscribe` edge fn | GET | Privacy compliance, GDPR |
| S23 | Landing generator | admin UI | Firebase Hosting deploy | Build script `landing-pages/generator/build.mjs` | Deploy failures leave orphan subdomains |
| S24 | Cross-app session | All apps | — | Each app re-auths | No single-sign-on between admin and booking — OK today, risk if an operator needs to impersonate a booking view |
| S25 | Same Supabase project for all apps | All apps | `ukdsrndqhsatjkmxijuj` | Anon key + service role | Single point of failure; also single point of quota contention |

---

## 8. Auth boundaries

- **Landing:** no auth.
- **Onboarding:** no auth for the form; rate-limited by IP in the route (3 / hour).
- **Booking:** anonymous checkout; `/my-bookings` gated by OTP sent via `send-otp` to the email or phone tied to the booking.
- **Admin:** custom SHA-256 email+password against `admin_users`; localStorage session; role-gated nav (`ADMIN` / `MAIN_ADMIN` / `SUPER_ADMIN`).
- **Edge functions:** 19 public (`verify_jwt=false`), the rest require a Supabase JWT. `cron-tasks` and marketing-dispatch are public because pg_cron calls them with a bearer that isn't a real JWT — this is **intentional and documented in the main CLAUDE.md** but note the implication: anyone who guesses those URLs can invoke them.
- **Supabase Auth is not used for admin sessions.** The project's `admin_users` table is the source of truth. That means `auth.uid()` inside RLS policies returns NULL for admin-originated reads **unless** there's an implicit anon session. This is worth re-reading before Phase 4.

**[NEEDS CONFIRMATION]** — how do the RLS policies that reference `auth.uid()` evaluate for admin UI requests that use the anon key and have no Supabase Auth session? If `auth.uid()` is null, a policy of `business_id IN (SELECT au.business_id FROM admin_users au WHERE au.id = auth.uid())` would match nothing, and admin reads would require either a permissive fallback policy or a service-role key. I saw the permissive fallback exists (`20260316143000`), which suggests the app is relying on it. That is a security finding.

---

## 9. Open questions for sign-off

I need a yes/no/unknown on each of these before I start Phase 2.

1. **Cape Kayak customer site** is `book.capekayak.co.za` served by the `booking` Vercel project. Correct?
2. **Is the admin dashboard's custom auth** (SHA-256, no salt, localStorage) intentional? If yes, acknowledged as a known tradeoff for Phase 5 catalogue. If no, this becomes a P0.
3. **RLS reliance**: does the admin UI use the anon key or the service-role key for reads? If anon, then the permissive fallback policy `FOR ALL USING (true)` from migration `20260316143000` is load-bearing — confirm.
4. **Which Supabase plan** is the shared project on? (Free / Pro / Team / Enterprise). Phase 4 connection-pool and Realtime analysis depends on this.
5. **Who owns the weather provider** that calls `weather-cancel`? Is this a scheduled internal job or a third-party webhook? Auth model?
6. **Confirmation of app identities**:
   - `~/Desktop/ActvityHub/Onboarding` is the live onboarding app, `onboarding2` is dead. Can I assume so for Phase 2?
   - The `landing-pages/` folder inside capekayak is a per-operator generator that deploys to the same Firebase project as the root landing page. Correct?
7. **`book.capekayak.co.za` custom domain**: is this attached to the Vercel `booking` project with `NEXT_PUBLIC_BUSINESS_ID` set? Or does it rely purely on runtime `resolveBusiness()` by hostname? The former is safer; the latter means a DNS misconfig could swap a customer into the wrong tenant.
8. **35 ` 2.tsx` / ` 3.tsx` files** in the booking app: safe to treat as dead code, or are any of them live (via an unusual import)? I recommend running `grep -r "page 2"` before Phase 3 to be sure.
9. **Landing page domain owner**: Firebase project `booking123-6106` — do you have admin access? Phase 3 will need Firebase Performance or WebPageTest to benchmark it.
10. **Staging environment**: is there one, or is `main` pushing to prod? Phase 2 journey tests should run against staging if it exists; otherwise against prod carefully (no real charges, no real WhatsApp sends).
11. **Secret isolation**: the Onboarding app's `.env.example` references `SUPABASE_SERVICE_ROLE_KEY`. Is the deployed env actually populated with it, and is it only used server-side in `api/onboarding/route.ts`? Grep suggests yes, but I need a confirmation.
12. **Rhys review**: you mentioned Rhys knows where the seams actually are. Would you like me to prepare a 1-page handoff for him from this document, or will you share the full file?

---

## 10. Phase 1 sign-off checklist

Before I start Phase 2 I need from you:

- [ ] Confirmation or correction on §2 (the three corrections).
- [ ] Confirmation or correction on §7 (the seam inventory) — specifically flag any seam I missed.
- [ ] Answers to §9 (open questions), even if the answer is "unknown, investigate in Phase 4".
- [ ] Rhys's sanity check if you want it before testing begins.
- [ ] Decision: Phase 2 journey testing against staging or prod. If prod, give me the rules of engagement (max 1 real booking per journey, test-mode Yoco keys, etc.).

Once this is signed off, Phase 2 begins with the 5 cross-app journeys in your original brief.

---

## 11. Sign-off log (running)

### Round 1 — 2026-04-17

**Confirmed by user:**
- Q6a: `~/Desktop/ActvityHub/onboarding2` is dead. Will be ignored for the rest of the review.
- Q4: Supabase plan is currently **Free**. **Recommendation: upgrade to Pro ($25/mo) before launch.** Reasons:
  - Free auto-pauses a project after 1 week of inactivity → edge functions (Yoco webhook, WhatsApp, cron) go offline during quiet weeks → instant breach of the 95% target.
  - No point-in-time backups on Free (a Pro-only feature). Operating a paid SaaS without recoverable backups is reckless.
  - 5 GB bandwidth / 500K edge-fn invocations / 200 concurrent realtime connections ceilings on Free are all single-digit-operators thin. `cron-tasks` alone consumes ~8.6K invocations/month at a 5-min interval before any payment webhooks or marketing dispatches.
  - Cost of Pro (~R470/mo) is ~3% of one operator's R1,500 subscription. The economics are obvious.

**Investigated by Claude (user said "not sure", so I checked):**
- Q2 (is the custom SHA-256 admin auth intentional?): **Yes, intentional.** Confirmed by:
  - `grep -rn 'supabase\.auth\.'` across the admin app returns **zero hits** — Supabase Auth is never invoked.
  - Git log on `app/lib/admin-auth.ts` shows 3 commits, all original — this is a design choice, not migration leftover.
  - Conclusion: not an accident. It's a deliberate architecture. The security implication in Q3 below remains.
- Q3 (admin UI uses anon or service-role key?): **Anon key for UI reads, service-role only in `/api/*` server routes.**
  - `app/lib/supabase.ts:6` — the UI client is created with `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Used everywhere in the admin UI.
  - Service-role key appears in 8 server-side files (Next.js API routes): `api/partner-tours`, `api/partnerships`, `api/partnerships/approve`, `api/combo-offers`, `api/combo-settlements`, `api/combo-cancel`, `api/credentials`. All correct usages — server-side only, never shipped to the browser.
  - Implication: since admin does not use Supabase Auth, every admin UI request arrives at Postgres as role `anon` with `auth.uid() = NULL`. Any RLS policy of the form `business_id IN (SELECT ... WHERE id = auth.uid())` evaluates to false for admin requests. Therefore **the permissive fallback policies `FOR ALL USING (true)` from the `FIX_*_permissive.sql` and `*_rls_anon.sql` migrations are load-bearing**. This is confirmed by the pattern of repair migrations in `supabase/migrations/` — the team has had to add permissive policies repeatedly to unblock the admin UI, which is exactly what this architecture forces.
  - **Net security posture:** the admin app's tenant isolation is **application-code-only** — `business_id` filters in every query string. Anyone who obtains the browser-visible `NEXT_PUBLIC_SUPABASE_ANON_KEY` can call the Supabase REST API directly and read every tenant's data. This makes Journey 5 (multi-operator isolation test) a near-certain fail as currently configured. **Flagging as the top P0 candidate for Phase 5.**
- Q7 (Cape Kayak tenant resolution — env lock or runtime match?): **Env lock in dev, needs Vercel UI confirmation for prod.**
  - `~/dev/booking/.env.local` has `NEXT_PUBLIC_BUSINESS_ID=<redacted>` set. Good.
  - `~/dev/booking/.env.production.local` also exists — production uses Vercel's env-var UI, which I cannot read. If the prod env var is unset, the app falls back to runtime hostname matching, which means a DNS misconfig on a new operator could accidentally map to Cape Kayak's tenant.
  - **Action for user:** verify in Vercel that `NEXT_PUBLIC_BUSINESS_ID` is set on every production deployment of the `booking` project that is attached to a single-operator domain like `book.capekayak.co.za`.
- Q11 (Onboarding service-role key only server-side?): **Yes, correctly scoped.**
  - Service-role key is read only in `app/api/onboarding/route.ts` (server-side Next.js API route). Never shipped to the browser.
  - The smell in the Phase 1 report was that `.env.example` publicly references the key name; the runtime usage is fine.

**Still open (blocking Phase 2):**
- Q10: staging vs prod environment for Phase 2 journey tests. Most important unanswered question — see the chat conversation for rules of engagement options.
- Q5: weather-cancel provider identity and auth model (low priority — can be investigated in Phase 4).
- Q8, Q9, Q12: deferred (Firebase access for benchmarks, Rhys handoff, full read-model for admin) — not blockers for Phase 2.
