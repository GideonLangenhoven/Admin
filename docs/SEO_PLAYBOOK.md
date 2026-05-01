# BookingTours SEO Playbook

> **Goal:** rank bookingtours.co.za in the top 3 Google results for high-intent queries from South African tour operators looking for booking software — within 60–90 days.
>
> **Reality check before we start:** the diesel-dudes case study in the video worked because (a) the market was unsophisticated, (b) the intent was "buy now / I'm broken down", and (c) it was local. Your situation is different: SaaS buyers research for days/weeks, and global competitors (FareHarbor, Rezdy, Bokun, Checkfront, Peek Pro) are sophisticated. **BUT** — the *South African* tour-software market is genuinely underserved, most competitor pages don't target SA keywords, and you have three real differentiators nobody else in SA has: native WhatsApp, weather-triggered cancellations, and Yoco/Paysafe (local payments). That's the wedge.

---

## 1. Strategy — why this works for us

The diesel-dudes playbook was **local service, high intent, weak competition**. We translate that to SaaS as:

| Video playbook | Our translation |
|---|---|
| "Mobile diesel mechanic Charlotte" | "Tour booking software South Africa" (geo + vertical) |
| Location pages (Charlotte, Raleigh…) | **Vertical pages** (kayak, safari, wine, whale-watching, quad-biking…) + **geo pages** (Cape Town, Joburg, Durban, Garden Route) |
| "Emergency repair near me" | "WhatsApp tour booking", "Yoco tour booking" (unique feature searches) |
| Google Business Profile for the workshop | Google Business Profile *and* G2/Capterra/GetApp listings |
| Local reviews | **Case studies from real tenants** (Cape Kayak already exists) + G2/Capterra reviews |

Three pillars:

1. **Vertical landing pages** — one page per tour type (kayak, safari, wine, whale, quad, paragliding, surfing, hiking, fishing charter, MTB). Each ranks for `"{vertical} booking software South Africa"` and similar long-tail.
2. **Feature moat pages** — one page per unique feature that global competitors don't emphasise for SA (WhatsApp inbox, weather-cancel, Yoco, combo bookings, automatic rebooking). These are the **trucker-broken-down-on-the-side-of-the-highway** keywords — operators actively searching solve a specific pain.
3. **Comparison + case study pages** — "BookingTours vs FareHarbor", "BookingTours vs Rezdy", "BookingTours vs spreadsheets", plus tenant case studies. These convert at 3–5x the rate of a homepage.

We will NOT try to outrank FareHarbor for "tour booking software" globally. We will own SA + feature-specific long-tail first, then expand.

---

## 2. What I need from you BEFORE I start building

I can write copy, but I cannot invent facts. Please answer these in one reply (or a Google Doc):

### Business basics
- [ ] Confirm pricing page copy: R1,500/month + R750/additional admin user — still accurate? Any tiered plans coming?
- [ ] Target customer segments (tick all that apply): kayak operators / safari lodges / wine-tour operators / whale-watching / quad-bike / hiking / fishing charter / other: ________
- [ ] Geographic focus for year 1: SA only, or also Namibia/Botswana/Mauritius/Kenya?
- [ ] Company registered address (needed for Google Business Profile schema)
- [ ] Support phone + hours
- [ ] Real founding date (used in `foundingDate` schema)

### Proof points
- [ ] List of **current live tenants** I can mention as customers (with permission)
- [ ] 2–3 tenants willing to give a 1-paragraph testimonial + headshot
- [ ] Any usage stats I can cite: bookings processed, GMV, avg booking size, uptime, customer count
- [ ] Cape Kayak case study — I see `/case-study/cape-kayak` exists. Is the data in there real and approved for public use?

### Competitors you want me to call out by name
- [ ] FareHarbor (yes/no)
- [ ] Rezdy (yes/no)
- [ ] Bokun (yes/no)
- [ ] Peek Pro / TrekkSoft / Checkfront (yes/no)
- [ ] Spreadsheets / WhatsApp-only (yes — this is the biggest competitor in SA)

### Keyword sanity check
I'll run Claude (Opus) on your site + competitor sites and propose a 40-keyword target list. You'll approve/reject each one in a checklist. I won't write a single page until you sign off on the list.

### External accounts — give me credentials or do it yourself
- [ ] Google Search Console access for bookingtours.co.za (I'll need this to submit sitemaps and monitor rankings)
- [ ] Google Analytics 4 property
- [ ] Access to Vercel project (confirmed — you already deploy there)
- [ ] Logo in SVG + PNG, 1200×630 OG image, favicon set

---

## 3. What I will build — technical implementation plan

> All of this is work I do in this repo. Each step is a PR you review before merging.

### Phase 0 — audit (1 day)

```
claude code: "Ultra-think. Audit this repo end-to-end for SEO readiness. Produce a
prioritised punch-list covering: missing meta, no sitemap, no robots, no schema,
mixed client/server rendering of marketing pages, duplicate routes (I see `case-study/cape-kayak 2`
and `compare/manual-vs-disconnected-tools 2` — those are suspicious), AuthGate
blocking crawlers, Core Web Vitals on /pricing-style pages, bundle size."
```

Deliverable: `docs/seo-audit-<date>.md` with a ranked list. Nothing merged yet.

### Phase 1 — marketing-site foundation (2–3 days)

**Current problem:** your `/` route is the authenticated admin dashboard (I read `app/page.tsx` — it renders the manifest/weather UI and is wrapped in `AuthGate` via `app/layout.tsx:44`). Google cannot index a gated dashboard. We need a public marketing surface.

**Solution** — split the app into two Next.js route groups:
- `app/(marketing)/` — public, no AuthGate, its own layout with nav + footer, generous metadata
- `app/(app)/` — everything currently authenticated, keeps the existing `AuthGate` + `AppShell`

Routes that move into `(marketing)`:
```
/                            → new public home
/pricing                     → rename current "Peak Pricing" dashboard tool to /admin/peak-pricing
/features                    → index of feature pages
/features/whatsapp-inbox
/features/weather-cancel
/features/yoco-integration
/features/combo-bookings
/features/landing-pages      → advertise the 9 templates as a feature
/for/kayak-operators         → vertical page
/for/safari-lodges
/for/wine-tours
/for/whale-watching
/for/quad-biking
/for/fishing-charters
/for/hiking-guides
/case-study/cape-kayak       → already exists, needs SEO polish
/compare/fareharbor
/compare/rezdy
/compare/bokun
/compare/spreadsheets
/blog                        → launch with 6 pieces (below)
/about
/contact
```

Each page is a **React Server Component** (no `"use client"` at the top level) so the HTML is static and crawlable. I'll enforce this in a build-time lint.

**AuthGate change** — it must allow the entire `(marketing)` group through without auth. Right now `AuthGate` wraps everything in `app/layout.tsx`. I'll either (a) move `AuthGate` inside `(app)/layout.tsx`, or (b) make `AuthGate` a no-op for paths in a public allowlist. Option (a) is cleaner.

### Phase 2 — technical SEO foundation (1 day)

All of these are files I add or modify in this repo:

1. **`app/robots.ts`** — allow all crawlers, disallow `/admin`, `/bookings`, `/settings`, `/inbox`, `/super-admin`, etc. Reference `/sitemap.xml`.
2. **`app/sitemap.ts`** — dynamic sitemap that lists every marketing page + blog post. Regenerates on build.
3. **`app/(marketing)/layout.tsx`** — `generateMetadata` with `title`, `description`, `openGraph`, `twitter`, `alternates.canonical`, `robots: { index: true, follow: true }`.
4. **Per-page `generateMetadata`** — every marketing route overrides title/description/OG/canonical.
5. **JSON-LD schema** (structured data) injected per page type:
   - `Organization` + `WebSite` schema on every page (in `(marketing)/layout.tsx`)
   - `SoftwareApplication` + `AggregateRating` on `/pricing` and `/`
   - `FAQPage` on vertical pages
   - `Article` on blog posts
   - `BreadcrumbList` everywhere
6. **`public/llms.txt`** — allow LLM crawlers; state canonical URLs. (Doesn't move rankings but signals you're modern.)
7. **`next.config.ts`** — add:
   - `async headers()` for marketing pages: cache-control `public, s-maxage=86400, stale-while-revalidate=604800`
   - Compress images automatically (already default, but confirm)
   - `async redirects()` — kill any duplicates (the `cape-kayak 2` and `manual-vs-disconnected-tools 2` directories are dead weight — I'll delete them after confirming they aren't referenced).
8. **Core Web Vitals**:
   - Remove `"use client"` from marketing routes that don't need it
   - Lazy-load any below-the-fold embeds (weather widgets, videos)
   - Use `next/image` with explicit width/height everywhere
   - Use `next/font` (you already use it for Inter) with `display: "swap"`
   - Preconnect to Supabase + any other third-party origins only on authenticated routes, NOT marketing
   - Run Lighthouse via `@vercel/toolbar` + Google PageSpeed Insights, paste any fail into Claude, iterate until ≥95 desktop / ≥90 mobile.

### Phase 3 — keyword-targeted pages (1 week)

For each approved keyword, I generate a **long-form page** (1,200–2,000 words) using this template, with Claude Opus + the ULTRATHINK flag to go deep on genuine useful content (not thin AI slop — Google has specifically devalued that since SpamBrain updates):

```
H1: {Primary keyword exact match}
Hero: {Vertical-specific pain statement}, CTA "Start free trial"
Problem section: 3 pains specific to this vertical/feature
How BookingTours solves it: 3–5 bullet points with screenshots
Pricing: embed the same pricing module used on /pricing
Proof: 1 case study quote + logo row
FAQ: 6–8 questions (FAQPage schema → rich results in SERP)
Internal links: 3–5 to related verticals/features
CTA footer
```

**Vertical pages** (one each):
- `/for/kayak-operators` — Cape Kayak as the hero case study
- `/for/safari-lodges`
- `/for/wine-tours`
- `/for/whale-watching`
- `/for/quad-biking`
- `/for/fishing-charters`
- `/for/hiking-guides`
- `/for/surfing-schools`

**Feature pages** (the "trucker-broken-down-on-the-highway" high-intent ones):
- `/features/whatsapp-booking-system` — target "WhatsApp booking system South Africa", huge intent
- `/features/weather-cancellations` — unique to you; operators are actively looking for this
- `/features/yoco-tour-booking` — "Yoco booking software" is a real search in SA
- `/features/paysafe-combo-bookings` — operator-to-operator revenue-share bookings
- `/features/automatic-rebooking`
- `/features/tour-operator-crm` — broad-term page

**Comparison pages** (highest conversion):
- `/compare/fareharbor-alternative-south-africa`
- `/compare/rezdy-alternative`
- `/compare/bokun-alternative`
- `/compare/spreadsheet-to-booking-software`

Each competitor comparison is a fair, factual table (do NOT trash competitors — Google and readers punish that). Show where *they* win too. This builds trust.

### Phase 4 — blog + topical authority (ongoing)

Launch with 6 pillar posts that will each become permanent evergreen ranking assets. I write them with Opus + ULTRATHINK, you edit for voice + factual accuracy:

1. "How to start a tour operator business in South Africa (2026)"
2. "Best payment processor for SA tour operators: Yoco vs Paysafe vs Stripe"
3. "WhatsApp vs email for tour booking confirmations: what converts better"
4. "How weather cancellations destroy tour operator cash flow (and how to automate them)"
5. "Combo tours: how operators in Cape Town are splitting revenue with partners"
6. "Capacity pricing for tour operators: peak vs off-peak dynamic pricing"

Each post links to 2–3 relevant vertical/feature pages. This creates **topical authority** — the signal Google uses to decide you're the SA tour-software expert.

### Phase 5 — automation I'll set up

- **Cron in `vercel.ts`** to ping Google via Indexing API when new pages publish
- **GitHub Action** that runs Lighthouse on every PR and blocks merges that drop CWV below threshold
- **Weekly SERP rank check** via a simple Vercel Cron Function that hits SerpAPI for your 40 keywords and writes to a `seo_rank_history` table in your existing Supabase — you get a dashboard tile showing rank movement over time

---

## 4. What you do — the business side (non-negotiable)

Tech is ~40% of SEO. The rest is stuff only you can do.

### Week 1
- [ ] **Google Business Profile** — create one for BookingTours at your registered address. Category: "Software Company". Add hours, phone, website, photos of your office/team. Post once a week. ([business.google.com](https://business.google.com))
- [ ] **Google Search Console** — add bookingtours.co.za, verify via DNS or Vercel meta tag, submit the sitemap I'll generate
- [ ] **Google Analytics 4** — set up + install tag (I'll wire it in)
- [ ] **Bing Webmaster Tools** — yes, really. Bing drives ChatGPT search results. 5 minutes to set up.

### Week 2–4
- [ ] **Get 5 real reviews on Google Business Profile** — ask happy tenants. 5-word reviews are fine. Consistency matters more than length.
- [ ] **List BookingTours on software directories**:
  - G2 (the big one — free basic listing)
  - Capterra / GetApp / Software Advice (same Gartner family, one signup)
  - Product Hunt (one-day spike of backlinks — plan the launch with me)
  - BetaList (free)
  - SaaSHub (free)
  - South African directories: Startuplist Africa, Venture Burn partnerships, Silicon Cape member directory
- [ ] **Ask 3 tenants for testimonials** — a short quote + headshot + logo, with written permission to use on the site. Offer them something small in return (a month free, a backlink, co-marketing)

### Month 2
- [ ] **Backlinks — 10 quality ones beats 500 spammy ones**:
  - Guest post on 2 SA tourism/travel blogs (offer real value, not spun content)
  - Get listed in Wesgro / Tourism Business Council of South Africa partner directories
  - Sponsor a small tourism industry event → earn a backlink from the event site
  - HARO (Help A Reporter Out) / Qwoted / Connectively — respond as an expert on tour-ops topics, earn journalist backlinks
- [ ] **Record 3 customer video testimonials** — I'll embed them with `VideoObject` schema, which surfaces in Google video results
- [ ] **Create one piece of SA-specific industry research** — e.g. "2026 State of SA Adventure Tourism Bookings" — based on anonymised aggregated data from your platform. This is *enormously* linkable. Press will cite it, competitors can't copy it.

### Ongoing (every week, 30 min)
- [ ] Respond to every Google review within 24h (Google ranks responsive profiles higher)
- [ ] Post one update to Google Business Profile (new tenant, feature, blog post)
- [ ] Share each new blog post on LinkedIn + X with real commentary (not just a link)
- [ ] Log anything surprising a prospect asks on a call → becomes a blog post / FAQ

### Never do these
- ❌ Buy backlinks from anywhere cheap. You will get a manual penalty and recover in ~6 months.
- ❌ Generate 500 AI blog posts and publish them unedited. Google's SpamBrain detects this pattern and demotes the whole domain.
- ❌ Copy-paste competitor copy, even as "inspiration".
- ❌ Stuff keywords. Modern Google detects this in <100 words.
- ❌ Use doorway pages (10 near-identical pages targeting "booking software {city}"). We build one **genuinely useful** page per city, max 5 cities, only if content differs meaningfully.

---

## 5. Timeline & realistic expectations

| Week | Milestone | What's ranking |
|------|-----------|----------------|
| 1 | Audit + marketing site skeleton live, GSC/GA4 verified | Nothing yet — just indexable |
| 2 | Technical SEO + 5 vertical pages + 4 feature pages live | Brand term "BookingTours" #1 |
| 4 | All 20 core pages live, first case study video, 5 Google reviews | Long-tail ("whatsapp tour booking south africa") starts appearing pg 2–3 |
| 8 | 6 pillar blog posts, 3 comparison pages, 10 backlinks | Several long-tails on pg 1, comparison pages may rank fast because intent is razor-sharp |
| 12 | Industry research report published, press coverage | First mid-competition keywords on pg 1. Phone should start ringing for demos. |
| 24 | Domain authority established | Competitive keywords ("tour booking software south africa") on pg 1 |

**The diesel-dudes "thousands in 24 hours" is not realistic for SaaS.** That was local emergency-intent search, 48-hour sales cycle. SaaS sales cycles are weeks. Honest expectation: first qualified demo request from organic search ~week 3–4, steady flow by week 8–12.

---

## 6. How we'll measure

- **Leading indicators** (weekly): impressions + clicks in Google Search Console per target keyword, average position for your 40 keywords, Core Web Vitals
- **Lagging indicators** (monthly): demo requests from organic traffic, trial signups from organic, closed revenue attributed to organic (I'll wire UTM tracking + a `referrer` column to your existing signups table)
- **Reporting cadence**: I can build you a Supabase-backed dashboard tile on your existing admin — "SEO Pulse" — showing rank movement, traffic, demo conversion. Takes me ~half a day.

---

## 7. First concrete thing I recommend we ship

**This week**: I do the Phase 0 audit + Phase 1 marketing-site skeleton. That's 3–4 days of my work, 0 of yours until review. Deliverable is a PR with:
- Route-group split (public vs app)
- Public home at `/` with hero, features, pricing teaser, CTA
- `robots.ts` + `sitemap.ts` + `Organization` schema
- Keyword target list document in `docs/seo-keywords.md` for you to approve

Once that's merged and deployed, nothing else happens until (a) you approve the keyword list and (b) you've done the Week 1 checklist above (GSC, GA4, Google Business Profile). Otherwise I'd be writing pages into a void with no measurement.

**Say "go" and I'll start Phase 0 now.** Or tell me which phase to skip/reorder.

---

## Appendix A — starter keyword hypotheses (for your sanity check)

I haven't pulled volume data yet — this is my hypothesis list. I'll validate with Search Console data + Google's Keyword Planner + answerthepublic.com before writing anything.

**Buyer-intent (operator shopping)**
- tour booking software south africa
- adventure tour booking system
- tour operator crm south africa
- small tour operator software
- whatsapp tour booking system ⭐ (unique, lower competition)
- yoco tour booking software ⭐ (unique to SA, likely <50 searches/mo but 40% conversion)
- weather cancellation tour software ⭐ (unique)
- paysafe combo booking ⭐
- fareharbor alternative south africa ⭐ (high intent)
- rezdy alternative south africa
- booking software for kayak tours
- booking software for safari lodges
- booking software for wine tours

**Vertical long-tail**
- kayak tour booking system cape town
- safari booking platform south africa
- wine tour booking software stellenbosch
- whale watching booking system hermanus

**Problem-aware (top-of-funnel blog)**
- how to take bookings on whatsapp
- how to handle weather cancellations tours
- automate tour reminders
- yoco vs paysafe for tour operators

**Branded (will rank #1 automatically within days)**
- bookingtours.co.za
- bookingtours south africa
- bookingtours login

---

## Appendix B — files I'll create or touch

**New files:**
- `app/(marketing)/layout.tsx`
- `app/(marketing)/page.tsx`
- `app/(marketing)/features/whatsapp-inbox/page.tsx` (…and siblings)
- `app/(marketing)/for/kayak-operators/page.tsx` (…and siblings)
- `app/(marketing)/compare/fareharbor/page.tsx` (…and siblings)
- `app/(marketing)/blog/[slug]/page.tsx` + MDX content files
- `app/robots.ts`
- `app/sitemap.ts`
- `app/opengraph-image.tsx` (auto-generated OG images per route)
- `components/marketing/Hero.tsx`, `PricingTeaser.tsx`, `FeatureGrid.tsx`, `CaseStudyCard.tsx`, `FAQ.tsx`
- `lib/schema.ts` — JSON-LD generators
- `public/llms.txt`
- `docs/seo-audit-<date>.md`
- `docs/seo-keywords.md`

**Existing files I'll modify:**
- `app/layout.tsx` — slim down, move AuthGate to `(app)/layout.tsx`
- `next.config.ts` — headers, redirects, image config
- `middleware.ts` — make sure public routes bypass tenant resolution
- `components/AuthGate.tsx` — scoped to `(app)` only

**Existing things I'll delete (with your approval):**
- `app/case-study/cape-kayak 2/` (duplicate from disk corruption — see `.claude/CLAUDE.md` Lab Notes)
- `app/compare/manual-vs-disconnected-tools 2/` (same)

---

*Playbook v1 · 2026-04-18*
