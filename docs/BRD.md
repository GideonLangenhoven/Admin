# Business Requirements Document — BookingTours

**Version:** 0.2 (draft for mentor review)
**Date:** 10 July 2026
**Owner:** Gideon Langenhoven
**Status:** Draft. Pricing, traction posture, and the 12-month goal are decided (v0.2); remaining `[TO CONFIRM]` items are genuinely open.

---

## 1. Executive summary

BookingTours is a multi-tenant SaaS booking platform for adventure and tourism operators in Southern Africa. It replaces the patchwork most operators run on today — WhatsApp group chats, spreadsheets, a WordPress site, and commission-charging booking software — with one flat-fee platform: a branded customer booking website, an admin console for operations, a mobile app for guides, and built-in payments, WhatsApp AI, waivers, invoicing, marketing, and OTA channel sync.

The main competitor is **Activitar**, the established South African activity-booking platform. Activitar is a marketplace-first system: operator inventory is distributed through Activitar's shared network of booking sites, sales offices, and OTA connections, with the customer relationship mediated by the network. BookingTours takes the opposite position: **the operator's own direct channel comes first** — their own branded booking site, their own WhatsApp number answered by AI, their own customer data and marketing list — at a flat fee with **zero commission**, using OTAs only as supplementary channels the operator controls.

The commercial wedge is threefold: **direct-first at a flat fee** (R2,000/month instead of network fees and OTA-style 20–30% commission), **built for South African reality** (ZAR, Yoco payment rails, WhatsApp-first customers, POPIA compliance, offline guide check-in), and **built for the wild side of tourism** (one-click weather cancellation with customer self-rebooking, seasonal billing pause, shared equipment capacity pools).

The platform is live with an anchor tenant (Cape Kayak Adventures) and is engineered toward a ~2,000-tenant target, with onboarding planned in cohorts of ~10 operators.

---

## 2. Problem statement

Adventure and tour operators in Southern Africa (typically 2–20 staff, R500k–R10M annual revenue) lose money in four ways that generic booking software does not address:

1. **Lost enquiries.** Bookings arrive by WhatsApp at all hours; a reply that takes two hours loses the sale. Operators report losing 5–15 enquiries per week to slow replies. International booking platforms have no WhatsApp story at all.
2. **Commission drain and channel dependence.** The SA incumbent, Activitar, routes bookings through its shared distribution network — the operator's inventory sells under the network's brand, on the network's terms `[TO CONFIRM: Activitar's current fee/commission structure from sales-call intel — not publicly published]`. OTAs (Viator, GetYourGuide) take 20–30%; international software like FareHarbor takes ~6% of every booking. In every case the cost scales with the operator's success, and the customer relationship belongs to the channel, not the operator.
3. **Weather chaos.** 15–30% of adventure slots are weather-affected. Cancelling a day of trips manually means hours of calls, ad-hoc refunds, and lost revenue that a reschedule or voucher could have retained.
4. **Tool sprawl and seasonality.** Operators duct-tape spreadsheets, WordPress, Mailchimp, and paper waivers together — and pay for all of it through the off-season when revenue stops. None of it is POPIA-compliant, and none of it settles in ZAR through local rails without friction.

BookingTours exists to convert more enquiries into paid bookings, keep 100% of booking revenue with the operator, turn weather disruption into retained revenue, and consolidate the operator's stack into one platform priced for seasonal businesses.

---

## 3. Business objectives and success metrics

### Objectives

| # | Objective | Measure |
|---|---|---|
| O1 | **Prove the model with the first paying cohorts (12-month primary goal)** | 10–50 paying tenants onboarded in cohorts of ~10, each cohort followed by a two-week alert-watch; low churn; referenceable customers. The ~2,000-tenant engineering target is the ceiling the platform is built for, not the year-one goal |
| O2 | Convert more operator enquiries into paid bookings | WhatsApp AI response < 2 seconds; booking completable in ≤ 3 screens; 15-minute seat hold with automated payment-link follow-up |
| O3 | Retain revenue through disruption | Weather-cancel flow where the customer self-selects reschedule / voucher / refund, biasing retention over refund |
| O4 | Keep onboarding friction near zero | Tenant live in 48 hours; super-admin onboarding of a new business in ~5 minutes; 90-minute onboarding call |
| O5 | Operate reliably at fleet scale | Cron sweeps < 300 s wall-clock at 1,500 tenants; p95 < 2 s booking-site reads; < 2% email/WhatsApp failure rate over a 48 h soak; zero cross-tenant data exposure |

### Success metrics (platform health, already instrumented or gated)

- **Payments integrity:** 1 booking per 50× webhook replay (idempotency); zero unpaid bookings marked PAID; `slots.booked ≤ capacity_total` at all times.
- **Security:** `check-security-drift` exits 0 on every deploy; RLS enabled on all business-scoped tables; tenant-isolation violations treated as security incidents.
- **Trust integrity:** no fabricated stats, reviews, or availability anywhere customer-facing (documented "golden rule").

**Traction posture (decided):** current traction is one live anchor tenant (Cape Kayak Adventures) operating as the proving ground, pre-first-cohort. The "120+ operators / R28M processed" figures in older marketing copy are aspirational and are to be **removed from all customer-facing material**; the BRD and marketing claim only what is real. At R2,000/month flat, 50 paying tenants ≈ R100k MRR — the year-one success ceiling. `[TO CONFIRM: first-cohort target date]`

---

## 4. Target market

- **Geography:** South Africa first (ZAR, Yoco, POPIA, `Africa/Johannesburg` defaults), Southern Africa ambition.
- **Verticals:** water sports (kayak, SUP, dive, shark-cage, charters, cruises), aerial (skydive, paragliding, bungee, zip-line), land (hiking, MTB, climbing, horse riding, quad, sandboarding), tours (wine, food, city, cultural), multi-day (safari, overland, trails), shuttles, activity centres, and lodge/hotel activity desks.
- **Size:** 2–20 staff, R500k–R10M annual revenue, up to 10 admin users per tenant.

### Buyer personas

1. **The Frustrated Operator (primary).** 5–15 staff, drowning in WhatsApp enquiries, non-technical, currently on spreadsheets + WordPress. Buys because enquiries stop leaking and admin stops eating evenings.
2. **The Growing Operator.** 200+ bookings/month, on Activitar (or FareHarbor), feels the channel fees and the loss of the customer relationship. Buys for zero commission, owning their own list, combos, and automation.
3. **The New Entrant.** Starting up, price-sensitive, wants everything in one place from day one. Buys for the flat fee and 48-hour go-live.

### Competitive landscape

**Primary competitor: Activitar** — the established South African activity platform ("the biggest real-time activity platform in Africa", per their own positioning). Activitar is fundamentally a **distribution network**: supplier inventory is shared across Activitar's consumer site, network booking sites, sales offices, and OTA connections, with real-time availability and a Best Price Guarantee. It is strong at operations/reservations management and at bringing **net-new demand** through the network — that is its genuine advantage and should be acknowledged.

**Where BookingTours is superior to Activitar:**

| Dimension | Activitar | BookingTours |
|---|---|---|
| Business model | Marketplace/network — inventory sells through Activitar's channels `[TO CONFIRM: fee/commission structure]` | Flat R2,000/month, **zero commission**, operator keeps 100% of every booking |
| Brand & customer ownership | Bookings flow under the network's brand; Best Price Guarantee constrains the operator's own pricing | White-label branded storefront on the operator's own subdomain + embeddable widget; customer data and marketing list belong to the operator |
| WhatsApp | No WhatsApp booking channel | **AI bot books over WhatsApp** in natural language (< 2 s replies), with per-tenant knowledge base — the channel SA customers actually use |
| Weather disruption | Standard cancellation handling | **One-click weather-cancel** for a whole day; customers self-select reschedule / voucher / refund, biasing revenue retention |
| Marketing | Not a marketing platform — operators still need Mailchimp etc. | Built-in engine: contacts, campaigns, automations with promo-code generation, broadcasts, tracking |
| Seasonality | Year-round cost | **Billing pauses free for the off-season** |
| Guides in the field | Back-office focused | Offline-capable guide PWA: manifest, check-in, waiver status, trip photos |
| Compliance | Not a stated differentiator | POPIA data-request workflow end-to-end (erasure via anonymisation, SARS retention preserved) |
| OTA strategy | OTAs reached *through* the Activitar network | Operator's **own direct** Viator/GetYourGuide connections with hourly sync and drift reconciliation — no intermediary layer |

**Where Activitar is stronger (stated honestly):** its network delivers discovery and net-new bookings that pure software cannot; it is established, referenceable, and integrated across African tourism. BookingTours' counter is that the operator's *existing* demand (their WhatsApp, their website, their repeat customers) is being taxed or lost today, and that OTAs remain available for discovery — direct-first, channels-second.

**Secondary/international:** FareHarbor and Bókun (commission-based, ~6%, no ZAR/Yoco rails, no WhatsApp, weak SA presence) matter mainly as reference points for operators comparing pricing models. **OTAs** (Viator, GetYourGuide) are channels, not competitors — BookingTours integrates them. **The real incumbent for most of the market is the status quo:** WhatsApp groups, spreadsheets, and paper waivers.

---

## 5. Users and what they achieve

### 5.1 Operator — Main Admin (tenant owner)

**Achieves:** runs the entire business from one console; owns configuration, money, and team.

- Full booking lifecycle: create (walk-up/comp/price-override), reschedule with automatic uplift-payment or refund/voucher on price difference, cancel with policy-driven refunds, mark-paid, payment links, bulk operations.
- Availability: slot generation and bulk editing, peak pricing, shared capacity pools across tours (e.g. one kayak fleet serving three tours), day close vs cancel.
- Money: Yoco card payments (next-day ZAR settlement), refund queue, pro-forma and VAT tax invoices with encrypted banking details, refund-policy tiers.
- Configuration: tours, add-ons, booking-site branding, email customisation, refund policies, integration credentials (Yoco, WhatsApp, Google Drive, Google reviews), chatbot FAQ/knowledge base, team seats with per-section settings access.
- Platform subscription self-service: seats with proration, off-season pause/resume, billing history.

### 5.2 Operator — Operations staff (OPERATOR role)

**Achieves:** runs the day without access to settings, billing, or team management.

- Live dashboard (revenue, pax, manifest, roll-call check-in, weather), bookings and slots views, unified WhatsApp + web-chat inbox with AI-bot handoff, broadcasts (including weather mode), reviews moderation, trip photos, customer CRM (read-only), reports and exports, marketing hub (contacts, templates, campaigns, automations, promotions).

### 5.3 Guide (mobile PWA)

**Achieves:** runs the trip itself from a phone, including offline.

- Trip manifest per slot with passenger details and waiver status; offline-capable passenger check-in with background sync; post-trip photo capture and delivery to customers.

### 5.4 Customer (end booker)

**Achieves:** books and manages an adventure without ever phoning the operator.

- Books in a ≤ 3-screen flow on the operator's branded site (subdomain or embedded widget), with live availability, promo codes, gift vouchers, add-ons, and a 15-minute seat hold through Yoco checkout.
- Signs digital waivers (per-participant, minors via guardian consent); receives confirmations, reminders, and review requests over WhatsApp-first messaging with email fallback.
- Self-serves via OTP-secured My Bookings: reschedule, cancel (sees the refund the policy grants), edit guest counts, redeem/check voucher balances, view trip photos, leave reviews.
- After a weather cancellation, chooses reschedule / voucher / refund without operator involvement.
- Can book conversationally through the WhatsApp AI bot or website chat.

### 5.5 Platform staff (SUPER_ADMIN)

**Achieves:** operates BookingTours as a business.

- Onboards a tenant in ~5 minutes (business, subdomain, main admin, validated payment credentials, branded URLs); manages tenant lifecycle (suspend for non-payment, pause, reactivate, password resets).
- Monitors OTA reconciliation drift; bills marketing-email overage; generates and deploys tenant landing pages; manages platform-wide assets.

---

## 6. Product scope (built and live)

| Capability | Summary |
|---|---|
| Booking engine | Slots, holds (15 min + 5 min payment grace), capacity enforcement, shared resource pools, peak pricing, custom booking questions |
| Payments | Yoco (primary), PayFast (legacy), manual bank transfer/mark-paid; webhook signature verification + idempotency on every provider |
| Refunds & policies | Time-tiered refund policies, automated Yoco refunds, refund queue, voucher-instead-of-refund |
| Messaging | WhatsApp Cloud API + web chat unified inbox; AI bot (GLM via OpenRouter, Gemini fallback) with per-tenant RAG knowledge base (pgvector); auto-messages (reminders, review requests) in tenant timezone; broadcasts |
| Waivers | Digital, per-participant, guardian consent, invalidation on guest changes, guide-visible status |
| Marketing engine | Contacts, campaigns, 13-block email templates, automations with date triggers and promo-code generation, open/click tracking, unsubscribe compliance, monthly usage metering |
| OTA channels | Viator + GetYourGuide webhooks and hourly availability sync, daily reconciliation, drift monitor |
| Invoicing | VAT-compliant tax invoices, PDF attachments, encrypted banking details |
| Reviews & photos | Google reviews fetch, review moderation, Google Drive trip-photo delivery |
| Weather ops | Open-Meteo-backed weather view; one-click per-slot weather cancellation driving customer self-rebook |
| White-label surface | Tenant subdomains (`{tenant}.booking.bookingtours.co.za`) with host-based tenant resolution, tenant theming, embeddable widget, generated landing pages (Firebase) |
| Compliance | POPIA data requests end-to-end: double opt-in, 30-day cooling-off, anonymisation (not deletion, preserving SARS 5-year financial records), JSON export, audit trail |
| Platform ops | Seat-based billing with proration, pause/resume, suspension enforced server-side, email-overage billing, security drift gate on deploys, Sentry monitoring |

---

## 7. Business model and pricing

- **Price (decided):** **R2,000/month flat + R500 per additional seat**, single plan, in ZAR. Zero commission on bookings, zero setup fee, no lock-in, **billing pause for off-season at no charge** (team keeps read access; new bookings/marketing disabled).
- **Seats:** 1 included seat; extra seats at R500/month, prorated within the billing cycle.
- **Usage component:** marketing email allowance per month; overage billed per email by platform staff.
- **Add-on:** done-for-you marketing service from R6,500/month.

**Alignment work this decision creates:**
- Code default plan is "Pro" at R1,500/month — the `plans` table and fallback constant must be updated to R2,000; a parked migration seeding R750/extra seat must be corrected or discarded.
- Marketing copy variously says R1,500 / R2,000 / R2,500 — standardise every surface on **R2,000**.
- Platform subscriptions are currently **invoiced manually** — no automated recurring card charge is wired (Yoco is the intended rail). Acceptable for the first cohorts; automation threshold is an open question (§11).
- A TRIAL subscription status exists in code with no expiry enforcement — trial policy is an open question (§11).

---

## 8. Out of scope for v1 / roadmap

| Item | Status |
|---|---|
| Combo bookings + Paysafe split payments across operators | Built but feature-flagged **off**; deferred to v2 (routes return 503) |
| Custom domains for tenant booking sites | Roadmap; subdomains only today (manual DNS possible) |
| Multi-day trips (deposit/balance splits, itineraries, min-participant auto-cancel) | Planned; schema sketched, not built |
| Self-service tenant onboarding (no super-admin involvement) | Planned |
| Referral & loyalty programmes | Schema exists; no operator UI — `[TO CONFIRM: in or out of scope]` |
| "Ten Adventure Sites" themed storefront skins + personalisation | Design plan approved-in-principle; build order defined (system → reference skin → ~2–3 days per skin) |
| Admin "Field Console" redesign; transactional email redesign | Specs written, awaiting sign-off / in progress |
| Automated platform-subscription card billing | Not wired; manual invoicing interim |

---

## 9. Constraints and non-functional requirements

1. **Tenant isolation is security-critical.** Every business-scoped table carries `business_id` with RLS; every query is tenant-filtered; violations are treated as security incidents. Combo bookings are the only sanctioned cross-tenant flow.
2. **Payment integrity.** Signature verification before any business logic; idempotency keys on all payment/OTA webhooks; fail-closed on validation errors; atomic money-state transitions.
3. **POPIA.** Right-to-erasure via anonymisation with SARS retention preserved; consented marketing; data-request SLAs with audit trail.
4. **Scale envelope.** Engineered for ~2,000 tenants on one shared deployment: paginated fleet sweeps (no 1,000-row truncation), bounded cron concurrency, per-request host-based tenant resolution.
5. **Field conditions.** Guide app works offline (background-sync check-ins); WhatsApp-first messaging with email fallback for notification failures.
6. **Stack constraints.** Next.js + Supabase (Postgres, RLS, Deno edge functions), Resend email, Meta WhatsApp Cloud API; TypeScript; ZAR only today.

### Known accepted risks (open, documented)

- `reviews` RLS is app-layer-only (`USING(true)`) — fix recommended.
- PayFast ITN fails open on validation network error — recommend disabling PayFast until needed.
- GetYourGuide webhook accepts unsigned calls when no secret is configured.
- Security-drift checker diffs grants, not policy predicates — RLS regressions could pass silently.
- Email-overage invoice generation is not idempotent.

---

## 10. Assumptions

1. Yoco remains the canonical customer-payment and (intended) platform-billing rail.
2. Operators accept a shared-platform subdomain until custom domains ship.
3. WhatsApp Cloud API pricing/policy remains viable as the primary customer channel.
4. Cohort-of-10 onboarding with two-week observation is the go-to-market rhythm until stress-test gates all pass.
5. The anchor tenant (Cape Kayak Adventures) continues as reference customer and live proving ground.

---

## 11. Decisions log and open questions

**Decided (v0.2, 10 July 2026):**
- Pricing: single flat plan, R2,000/month + R500/extra seat. (§7)
- Traction claims: "120+ operators / R28M" are aspirational — removed from all claims; market honestly from the anchor tenant. (§3)
- 12-month goal: prove the model with the first paying cohorts (10–50 tenants, low churn, referenceable), not aggressive scale. (§3)

**Still open:**
1. **First-cohort target date** — when does cohort #1 onboard? (Gated by the stress-test plan's red-phase passes.)
2. **Referral/loyalty** — v1 scope or park it? Schema exists, no UI. (§8)
3. **Platform billing automation** — at what tenant count does manual invoicing stop scaling and automated Yoco billing become a requirement? (§7)
4. **Trial policy** — is there a free trial, and how long? (Status exists in code with no enforcement.)
5. **Activitar fee structure** — their commission/fee model is not publicly published; confirm from sales-call intel or operator interviews so the comparison table in §4 can state it precisely.

---

*Sources: docs/USER_MANUAL.md, docs/SUPERADMIN_MANUAL.md, docs/bookingtours-messaging-bible.md, docs/BRAND.md, docs/ONBOARDING_GUIDE.md, docs/ADVENTURE_SITES_DESIGN_PLAN.md, docs/STRESS_TEST_PLAN.md, docs/POPIA_DATA_OBFUSCATION.md, docs/qa/SCALE_READINESS_2026-07-04.md, docs/qa/MVP_PRODUCTION_READINESS.md, and the codebase (app/, booking/app/, supabase/functions/, app/api/billing/).*
