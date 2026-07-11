# Ten Adventure Sites, One Design System — Design Plan

**Brief:** design 10 adventure-company websites that read as siblings — same world-class DNA — while each is unmistakably its own brand. Benchmarks: Niarra Travel (editorial restraint, hover-mask reveals), Travel Next Level (scroll-driven narrative), 66°Nord (Visual Product Sheets — art direction married to a converting commerce engine).

**Ponytail architecture: one system, ten skins.** We do NOT design ten websites. We design **one layout/motion/component system** and **ten art-direction packs** (palette, type pairing, terrain motif, hero treatment, one signature interaction each). Distinctness comes from the pack; consistency and build-cost sanity come from the system. This maps directly onto the platform's existing tenant theming (`color_main/secondary/cta/bg/nav`, `brand_colors`, hero fields, tenant token overrides in the booking app) — every skin is ultimately a token set + asset pack, not a fork.

---

## Part 1 — The shared DNA (identical across all ten)

### 1.1 Layout: the Anti-Grid
- 12-col base grid that content deliberately breaks: images bleed across 7/12 offset by half a row; text columns cap at 34rem and never center-align with their imagery.
- Section seams are never straight lines: each brand gets ONE signature SVG divider (its "terrain line" — wave, ridge, dune…) reused at every seam. One motif per brand, used everywhere — repetition is what makes it feel designed rather than decorated.
- Whitespace budget: minimum 20vh between narrative sections. When in doubt, remove a section rather than shrink the gaps (the Niarra lesson).

### 1.2 Motion system (functional only, one library)
- Scroll-triggered reveals: text rises 12px + fades over 500ms; images scale 1.04→1.00. One easing curve platform-wide: `cubic-bezier(0.2, 0.7, 0.2, 1)` (already the product's `--ck-ease`).
- Hero: slow Ken-Burns drift (scale 1.0→1.06 over the section's scroll length), parallax capped at 8% — awe, not seasickness.
- The **hover-mask reveal** (Niarra's device) is the system's flagship: destination/tour names in a large editorial list; hovering paints cinematic imagery inside an organic mask shape. The mask SHAPE is per-brand (see packs).
- Hard rules: `prefers-reduced-motion` collapses everything to opacity fades; no animation may block interaction; LCP < 2.5s on 4G is a design constraint, not an engineering afterthought.

### 1.3 Depth: frosted touch
- One glass recipe system-wide: `background: color-mix(in srgb, var(--surface) 72%, transparent); backdrop-filter: blur(14px); border: 1px solid rgba(255,255,255,.14)`. Used for: sticky nav after first scroll, booking widget, tour-card meta strips. Nowhere else — glass everywhere is glass nowhere.
- Text never sits raw on photography: it sits on glass, on a scrim gradient, or in whitespace.

### 1.4 The Visual Product Sheet (66°Nord's win — our conversion core)
Every tour page replaces the wall-of-text itinerary with a scannable sheet:
- **Stat chips** (micro-animated count-up on reveal): duration, physical difficulty 1–5 (icon scale), min age, group size, season window.
- **Gear strip**: horizontal icon row — what's provided vs what to bring (feeds from existing `what_to_bring`).
- **Timeline**: vertical day/hour line with one photo + one sentence per node; the map (custom-styled to the brand palette) pins each node.
- **Persistent booking rail** (glass): price-from, next 3 available dates pulled live, one CTA. On mobile it docks to the bottom edge.
The sheet is one component with brand tokens — identical bones on all ten sites.

### 1.5 Booking flow
The flow is the trust test. Shared rules: max 3 screens (date+party → details → pay), progress shown as the brand's terrain line filling, price always visible, every error message written as a human sentence, calendar shows real availability with sold-out honesty. Microcopy voice varies per brand (packs define 3 sample strings each).

### 1.6 Personalization (v1, honest scope)
Full real-time layout pivoting is a v2 promise. V1 ships two cheap wins: (a) recently-viewed tours re-rank the homepage "For you" row (localStorage, no backend); (b) exit from an unfinished booking re-surfaces that tour + dates in the hero CTA on return. Both are one component reading one localStorage key.

### 1.7 Type & spacing scale (shared)
- Two-face system everywhere: an editorial display face + a workhorse sans; the PAIRING changes per brand (packs), the SCALE never does: display at clamp(2.6rem, 7vw, 6rem); body 1.0625rem/1.7; mono-style micro-labels (11px, tracked +0.12em, uppercase) for all data labels — the system's signature.
- Spacing: 4px base, section rhythm in 8s.

---

## Part 2 — The ten skins

Each pack = palette (5 tokens), type pairing, terrain divider, hero treatment, mask shape for the hover-reveal, ONE signature interaction, and microcopy voice. Everything else inherits Part 1.

| # | Brand / vertical | Palette (bg · ink · accent) | Type pairing (display + sans) | Terrain divider & mask shape | Hero treatment | Signature interaction | Voice sample |
|---|---|---|---|---|---|---|---|
| 1 | **Sea-kayak & coastal** (e.g. Cape Kayak) | Warm paper `#F7F5F0` · deep pine `#0F2B1F` · tide amber `#D9822F` | Fraunces + Inter | Long low swell line; mask = smooth wave-blob | Dawn water macro, slow horizontal drift | Tide-aware date picker: calendar days show a tiny swell icon scaled to conditions | "Paddle out at first light — we'll have the coffee ready." |
| 2 | **Polar / expedition cruising** | Ice white `#F4F7F8` · graphite `#1A2226` · aurora teal `#2EC4B6` | GT Sectra-style serif + Neue Haas-style grotesk | Jagged floe edge; mask = shard polygon | Monochrome vastness, 90% whitespace above the fold, single small human figure for scale | Temperature dial: dragging a season dial shifts photography + gear list live | "Day 4: the ice decides the route. That's the point." |
| 3 | **Desert overlanding** | Sun-bleached sand `#F5EFE4` · basalt `#2B2118` · ember `#C2491D` | Canela-style serif + Söhne-style sans | Dune curve; mask = drifting dune blob | Heat-haze video loop, grain overlay, type set HUGE and cropped by the fold | Route scrubber: drag along the dune divider to scrub the 4×4 route across the map | "Bring nothing. Leave nothing. Take everything in." |
| 4 | **Alpine mountaineering** | Cold slate `#EEF1F4` · midnight `#10151C` · signal red `#E63B2E` | Utopia-style serif + Univers-style sans | Sharp ridgeline; mask = triangular peak cut | Vertical panorama: hero scrolls UP a mountain face as user scrolls down | Difficulty ladder: the 1–5 physical scale is an interactive cross-section of the actual ascent profile | "Grade 4. Your legs will complain. Your photos won't." |
| 5 | **Safari & wildlife** | Savanna cream `#F6F1E3` · acacia brown `#3D2E1E` · brass `#A67C2E` | Freight-style serif + Karla-style humanist | Grass-blade fringe; mask = organic thorn-tree canopy | Golden-hour telephoto, extreme letterboxing (cinema bars) | Sighting ticker: understated live strip of recent sightings ("Leopard, Tues 06:12") — trust through specificity | "The lions don't perform on schedule. We plan for that." |
| 6 | **Skydive & aerial** (e.g. Atlantic Skydive) | Stratosphere blue `#EDF4FB` · night navy `#0B1B33` · hi-viz lime `#C6F432` | Monument-style display + Inter | Slipstream arc; mask = falling teardrop | Full-bleed freefall POV video, muted, 3s loop | Altitude scroll: page scroll = altimeter unwinding from 14,000ft to landing at the booking CTA | "Sixty seconds of freefall. A lifetime of retelling." |
| 7 | **Jungle & river** | Deep moss `#0E1F16` (DARK theme) · mist `#DCE8DF` · orchid `#D65780` | Reckless-style serif + Atlas-style grotesk | Canopy silhouette; mask = liana-framed oval | Layered parallax: three depth planes of foliage part as you scroll in | Sound on consent: ambient river/jungle audio toggle, state remembered — the only site of the ten that asks | "Listen first. The river explains itself." |
| 8 | **Nordic hiking & fjords** | Fog `#F2F4F2` · lichen `#42513F` · fjord blue `#3E7CA6` | Signifier-style serif + Suisse-style sans | Fjord waterline reflection (mirrored ridgeline); mask = long horizontal sliver | Ultra-wide 21:9 stills, almost no motion — stillness IS the art direction | Weather-truth cards: each date shows the real historical weather odds ("62% clear in June") | "Pack for four seasons. Expect all of them before lunch." |
| 9 | **Dive & reef** | Abyss `#071E2C` (DARK) · foam `#E8F4F6` · coral `#FF6F59` | Editorial New-style serif + Graphik-style sans | Caustic light ripple; mask = bubble cluster | Descent scroll: hero darkens through depth gradient as you scroll, depth meter in margin | Species index: hover-mask list of dive sites reveals what you'll likely see, live-linked to season | "Ten metres down, the noise stops." |
| 10 | **Wine-country cycling & soft adventure** | Chalk `#FAF7F2` · vine `#4A5238` · rosé `#C97B84` | Ogg-style serif + Founders-style grotesk | Rolling vineyard rows; mask = looping pedal-stroke circle | Editorial magazine spread: asymmetric photo pairs, generous captions | Route+menu pairing: choosing a route reveals the picnic/estate menu that comes with it | "Eleven gentle kilometres. Two excellent estates. Zero rush." |

**Why they stay siblings:** identical grid, spacing, motion curve, glass recipe, mono micro-labels, Visual Product Sheet bones, booking flow, and the hover-mask device. **Why they're distinct:** nothing visual survives from one pack to the next — palette, faces, divider, mask geometry, hero physics, and the one bespoke interaction are all swapped.

---

## Part 3 — Execution plan

1. **Build order:** system first as a tokenised component library (2–3 wks), then skin #1 as the reference implementation (1 wk), then each further skin ≈ 2–3 days (tokens + asset pack + signature interaction).
2. **Asset discipline:** each pack needs 12–16 licensed/commissioned photos minimum, art-directed to the palette (this killed the current landing-page templates — broken/missing imagery disqualifies everything; budget photography before pixels).
3. **Token mapping to the platform:** every pack expresses as the existing tenant fields (`color_*`, `brand_colors`, hero image/eyebrow/title, `booking_site_url` theme overrides) + one new `theme_pack` key selecting divider/mask/type/signature-interaction bundle. No per-tenant code forks.
4. **Trust checklist per site (the golden rule):** real availability on the calendar, real weather/conditions data where promised, no fabricated reviews or stats (the current templates' fake claims are disqualifying), mobile nav that exists, prices visible before any form field.
5. **Definition of world-class (per site):** Lighthouse ≥ 90 mobile, LCP < 2.5s, reduced-motion clean, booking completable in ≤ 3 screens, and one interaction memorable enough that a visitor describes it to someone else.
