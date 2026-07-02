# Landing-Page Builder Review — 2026-07-02

**Scope:** The "Landing Pages" website builder in the super-admin dashboard (`app/super-admin/page.tsx` → `LandingPageManager`) and all nine templates under `public/landing-pages/templates/`.
**Method:** Every template was rendered with the live Aonyx business + tours data using the builder's exact `render()` logic, screenshotted at desktop (1440px) and mobile (390px), and code-audited for SEO, accessibility, content integrity and deploy behaviour. All renders completed with zero JS errors and zero unrendered `{{…}}` placeholders.
**Bar being judged against (per product goal):** "state-of-the-art tourism websites that compete with the best in the world."

## Verdict

**Not competitive yet — no template currently ships a page an operator could proudly put in front of customers.** The nine templates split into two tiers with different failure modes:

| Template | Size | Page height | Tier | Blocking problems |
|---|---|---|---|---|
| adventure | 8.9KB | 2,668px | Thin | No imagery, 5-section skeleton |
| modern | 9.3KB | 2,538px | Thin | No imagery, 5-section skeleton |
| luxury | 8.7KB | 2,884px | Thin | Hero is a flat grey gradient |
| safari | 8.0KB | 2,541px | Thin | No imagery, 5-section skeleton |
| coastal | 69KB | 8,477px | Rich | **All stock images 404**, fabricated stats/testimonials |
| minimal | 42KB | 10,924px | Rich | Same |
| dark | 57KB | 9,441px | Rich | Same |
| retro | 53KB | 11,333px | Rich | Same + no lazy-loading |
| tropical | 63KB | 9,310px | Rich | Same |

## P0 — Blocking defects

### 1. Every stock image in the five rich templates is broken
The rich templates reference 8–16 local images each (`/landing-pages/images/act-kayaking.jpg`, `act-surfing.jpg`, `nature-lake.jpg`, `cat-adventure1.jpg`, …). **`public/landing-pages/images/` does not exist anywhere in the repo.** Result: broken-image icons / empty grey voids throughout — in the super-admin preview iframe AND on any deployed Firebase site (the paths are root-relative, so a standalone `index.html` deploy can never resolve them). Screenshots show pages that read as half-loaded. This single defect disqualifies all five flagship templates.
**Fix options:** ship a curated image library into `public/landing-pages/images/` (and bundle them into the deploy package), or rewrite those sections to be data-driven from tour `image_url`s / the `photos` table, or hide image blocks when the asset is missing.

### 2. Fabricated business claims baked into the rich templates
All five hardcode **"4,500+ Happy Guests"** and **"15+ Experiences"** (Aonyx has 3 tours), plus invented customer testimonials ("The sunrise paddle was the highlight of our entire trip…" — no such review exists). For a real operator this is false advertising, and it's doubly unnecessary because the platform already stores real reviews (`reviews` table + Google-reviews sync) and real tour counts.
**Fix:** feed real numbers into the render context (tour count, review count/average, real quotes from approved reviews) and hide the section when there's no data.

### 3. The builder never passes a hero image
`generateLandingPage()` hardcodes `hero_image: ""`, so every template's `{{#if hero_image}}` branch falls through to a flat colour/gradient hero — even though the templates support hero photos and every tour already has an image. World-class tourism sites are photography-first; these heroes are typography on a paint swatch (see `luxury`: a plain grey gradient).
**Fix:** add a hero-image field to business settings (or default to the first tour's `image_url`).

## P1 — Gaps vs. state-of-the-art

- **SEO/social is table-stakes-only.** All nine have `<title>`, meta description and viewport — but **zero OpenGraph/Twitter-card tags** (every WhatsApp/Facebook share renders a blank card — critical for tourism), **zero JSON-LD structured data** (`LocalBusiness`/`TouristTrip`/`Product` with price + geo is standard for operators competing on Google), no favicon, no canonical URL.
- **No mobile navigation in any template.** Zero hamburger/mobile-menu implementations across all nine; nav links are simply lost or cramped on phones. Mobile is the majority of tourism traffic.
- **Generic canned copy.** Body copy is template boilerplate not derived from the business ("From waterfall gorge tours to open-ocean paddles" on a kayak operator). Real per-business copy fields exist (`what_to_bring`, `directions`, tagline) but carry test data ("Yo") straight onto the page with no minimum-content guard.
- **`retro` has no `loading="lazy"`** on its 13 images (the other rich templates do).
- **Thin-tier templates are structurally underbuilt**: hero → 3 tour cards → one info strip → CTA → footer. No about/story, no gallery, no social proof, no FAQ, no location/map, no trust signals. They read as stubs next to the rich tier's structure (which is genuinely decent: features, booking explainer, stats, testimonials, pricing narrative, FAQ, multi-column footer, scroll animations).

## P2 — Builder/deploy UX

- **"Deploy to Firebase" is manual**: it downloads `index.html` + `firebase.json` and tells the admin to run the Firebase CLI. No integrated deploy, no per-tenant hosting story (e.g. serving generated pages from the platform under the tenant subdomain would remove the CLI entirely).
- Dead code in `downloadProject()`: a combined `content` string with embedded firebase.json comments is built and never used (`app/super-admin/page.tsx:1082`).
- The template list must be manually kept in sync with files on disk (acknowledged in a code comment) — a missing file only surfaces as a preview 404.
- `render()` silently prints raw `{{…}}` for typo'd keys — currently clean, but there's no validation step.

## What good looks like (reference bar)

Best-in-class operator sites (the standard the goal sets) lead with full-bleed hero photography/video, real reviews with schema markup, live availability/price teasers, mobile-first nav, sub-2s LCP, and share-ready OG cards. The rich tier's *bones* (structure, sections, animation polish) are ~70% of the way there; the *content pipeline* (images, real social proof, real stats, hero photography) is the missing 30% that makes the difference between "template demo" and "world-class site" — and it's currently broken, not just missing.

## Recommended sequence

1. **P0.1** Restore/replace the missing image library (or make image sections data-driven). Without this the five best templates are unshippable.
2. **P0.2** Replace fabricated stats/testimonials with real data from `tours`/`reviews`; hide when empty.
3. **P0.3** Wire a real hero image (settings field, fallback to first tour image).
4. **P1** OG/Twitter + JSON-LD + favicon; mobile nav; lazy-load in `retro`; minimum-content guards.
5. **P2** One-click deploy (platform-hosted per-tenant pages), retire the thin tier or rebuild it on the rich tier's structure.
