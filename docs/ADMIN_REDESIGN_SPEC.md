# BookingTours Admin — Design System v3 "Field Console"

Redesign spec for the admin dashboard (`/app` + `/components`). Successor to the current near-monochrome pass. Goal: an interface with the warmth and precision of a field guide and the depth of a physical instrument panel — visually distinctive, effortlessly readable, never generic SaaS.

**Status: awaiting sign-off. No code changes until approved.**

---

## 0. Design principles

1. **Warm paper, deep pine.** The canvas is warm paper with faint atmospheric light; the sidebar is a deep pine rail. The contrast between the two gives the app its instant depth — no more flat white-on-white.
2. **Three type voices.** Fraunces (editorial serif) speaks titles and hero numbers. Inter speaks all UI and data. Geist Mono speaks micro-labels, timestamps and table headers — the "instrument voice". Never mixed within a role.
3. **Depth is layered light, not grey fog.** Shadows are pine-tinted and layered (contact + ambient), cards carry an inset top highlight like lifted paper. Hairlines still do the structural work.
4. **Color has a job.** Pine = interactive. Amber = the trail marker (active nav, highlights, add-ons). Ocean/fjord = data viz and informational accents. Status hues for status only. Purple/violet/indigo stay banned.
5. **Motion is felt, not seen.** 150–200ms micro-transitions, 1–2px lifts, a single 420ms entrance rise per page. `prefers-reduced-motion` disables all of it.

---

## 1. Typography

Loaded via `next/font/google` in `app/layout.tsx` (replaces Geist + Instrument Sans):

| Font | CSS var | Role |
|---|---|---|
| **Fraunces** (variable, `axes: ["opsz"]`) | `--font-display` | Page `h1`, hero/stat numerals only |
| **Inter** (applied as body class) | `--font-sans` | All UI, body, forms, tables |
| **Geist Mono** | `--font-mono` | `.ui-mono-label`, `th`, timestamps, IDs, kbd |

Inter gets `font-feature-settings: "cv11","ss01","ss03","cv02","calt"` globally; tabular numerals stay opt-in (`tabular-nums`, all `td/th`).

Scale:

| Use | Spec |
|---|---|
| Page title | Fraunces 28–30px, weight ~590, tracking −0.015em |
| Hero numeral (dashboard) | Fraunces 48–56px, weight ~560, tracking −0.02em |
| Card stat numeral | Fraunces 32–34px |
| Section/card title | Inter 15px semibold, tracking −0.01em |
| Body / table cells | Inter 13.5–14px |
| Micro-label / eyebrow | Geist Mono 10–11px, 500, uppercase, tracking 0.12em |

Rule (unchanged from BRAND.md): Fraunces never appears in buttons, forms, or table data.

---

## 2. Color

### 2.1 Light theme tokens

| Token | Value | Notes |
|---|---|---|
| `--ck-bg` | `#F7F5F0` | Brand paper (warmer than today's `#fbfbf9`) |
| body atmosphere | pine wash `rgba(18,94,64,.055)` top-right, amber wash `rgba(217,130,47,.05)` bottom-left, + ~1.7% grain overlay | Fixed, subtle; the canvas stops being dead flat |
| `--ck-surface` | `#FFFFFF` | Card top |
| `--ck-surface-warm` | `#FCFBF7` | Card gradient bottom, hovers |
| `--ck-surface-sunken` | `#F1EDE5` | Wells, segmented-control tracks, skeleton base |
| `--ck-border-subtle` / `-strong` | `rgba(16,44,32,.09)` / `rgba(16,44,32,.17)` | Pine-tinted ink hairlines |
| `--ck-text-strong` | `#17221C` | Headings, key numbers |
| `--ck-text` | `#46534B` | Body |
| `--ck-text-muted` | `#66736B` | Labels, meta (AA at label sizes) |
| `--ck-accent` / `-hover` / `-soft` | `#125E40` / `#0E4831` / `rgba(18,94,64,.08)` | Pine — primary interactive |
| `--ck-amber` / `--ck-amber-deep` / `-soft` | `#D9822F` / `#B4641C` / `rgba(217,130,47,.13)` | Decorative / interactive-on-light / wash |
| `--ck-ocean` / `-soft` | `#0F6773` / `rgba(15,103,115,.10)` | Info accents + chart hue 2 (replaces off-brand `#0f595e`) |
| `--ck-fjord` | `#3E7CA6` | Data-viz only |
| `--ck-success` / `-soft` | `#128A5C` / `.10` |  |
| `--ck-warning` / `-soft` | `#B47C15` / `.12` |  |
| `--ck-danger` / `-soft` | `#C6453A` / `.09` |  |

Chart ramp (CSS vars `--ck-chart-1…6`): pine `#125E40` → ocean `#0F6773` → amber `#D9822F` → fjord `#3E7CA6` → clay `#A34D3F` → moss `#6B7F3A`. Grid `rgba(16,44,32,.07)`; axis text = muted mono 10.5px.

### 2.2 Sidebar tokens (deep pine in BOTH themes — the signature move)

| Token | Light theme value |
|---|---|
| rail background | vertical `#113022 → #0C2117`, + faint mint radial top `rgba(0,217,139,.06)` + amber ember bottom `rgba(217,130,47,.05)` |
| text / muted | `#B7C9BD` / `#85998C` |
| hover wash | `rgba(244,241,232,.055)` |
| active bg / text | `rgba(244,241,232,.09)` / `#F6F3EA` |
| active marker | **3px amber bar** `#D9822F` (the trail marker) |
| icon / icon-active | `#8FA79A` / mint `#4FE0A6` (new token `--ck-sidebar-icon-active`) |
| hairlines / footer | `rgba(244,241,232,.08)` / cream at 45% |

Dark theme: rail deepens to `#090D0A → #070B08`; same cream alphas; icon-active `#00D98B`.

### 2.3 Dark theme tokens

| Token | Value |
|---|---|
| `--ck-bg` | `#0B0E0C` + mint/amber washes at .05/.04 |
| `--ck-surface` / `-warm` / `-sunken` / `-elevated` | `#131814` / `#151A16` / `#0E120F` / `#1A211B` |
| borders | `rgba(242,244,239,.09)` / `.17` |
| text strong / body / muted | `#F1F3EE` / `#B5BCB3` / `#7E867C` |
| accent (mint) / hover / soft | `#00D98B` / `#33E4A4` / `.12`; button text `#06130C` |
| amber / ocean / fjord | `#E89B4B` / `#3FC1D1` / `#6FA8D6` |
| status success/warning/danger | `#00D98B` / `#F5A623` / `#F0586A` (soft `.10`) |
| charts | `#00D98B`, `#3FC1D1`, `#E89B4B`, `#6FA8D6`, `#D07A6A`, `#9DB25E` |

All existing `html.dark` utility remaps in `globals.css` are **kept** (legacy pages depend on them); values retuned to the palette above.

### 2.4 Hex migration map (for the 222 hardcoded literals)

| Found in code | Becomes |
|---|---|
| `#0f595e`, `#1F7A8C` (off-brand teals) | `var(--ck-ocean)` |
| `#3b82f6` + blue-* accents | `var(--ck-ocean)` (info) or `var(--ck-fjord)` (data) |
| `#6b7280`, `#9ca3af` greys | `var(--ck-text-muted)` |
| `#111827`, `#374151` | `var(--ck-text-strong)` / `var(--ck-text)` |
| ad-hoc greens | `var(--ck-accent)` or `var(--ck-success)` |
| ad-hoc ambers/oranges | `var(--ck-amber)` family |

---

## 3. Depth & elevation

Shadow recipes (all pine-tinted `rgba(15,43,31,…)`, replacing near-black):

| Token | Recipe |
|---|---|
| `--ck-shadow-sm` | `0 1px 2px .06, 0 1px 3px .04` |
| `--ck-shadow-md` | `0 2px 4px .05, 0 10px 24px -8px .12` |
| `--ck-shadow-lg` | `0 4px 10px .06, 0 28px 56px -20px .20` |
| `--ck-shadow-card` | `inset 0 1px 0 rgba(255,255,255,.65)` + sm + `0 10px 28px -14px .12` |
| `--ck-shadow-hero` | `0 28px 64px -24px .45, 0 4px 12px -4px .20` |

Key moves:

- **Card recipe**: white→warm-white vertical gradient + inset top highlight + hairline + soft ambient shadow. Clickable cards lift −2px into `card-hover` on hover (180ms).
- **Global shadow upgrade**: `html.light .shadow-sm/.shadow/.shadow-md/.shadow-lg` are remapped to the pine-tinted recipes — every un-swept page gains real depth on day one.
- **Glass chrome**: topbar (and sticky table headers where used) get `color-mix(paper 78%, transparent)` + `backdrop-blur(14px)` + bottom hairline.
- **Hero surface** `.bg-bt-dark`: enriched pine glow + amber ember + vignette, plus an optional topographic contour-line SVG overlay (ivory strokes at ~7%) echoing the logo's trail motif.

---

## 4. Shape & motion

- Radii unchanged: 6 / 10 / 14 / 20. Cards 14–16px. `rounded-full` only pills/dots/avatars.
- Ease becomes the brand curve `cubic-bezier(0.2, 0.7, 0.2, 1)` (replacing `0.16,1,0.3,1`).
- Hover: max −1px buttons, −2px cards. Press: +0.5px.
- Entrance: `.anim-fade-up` (6px rise + fade, 420ms) with stagger helpers `.anim-d1/2/3` — used on page header + first card band only.
- The sidebar icon line-draw hover animation is kept (signature detail).
- `@media (prefers-reduced-motion: reduce)` kills entrances and lifts.

---

## 5. App shell

### Sidebar (264px / 80px collapsed)
- Deep pine rail per §2.2, faint topo texture optional at the very bottom.
- Brand row: **ivory brand mark variant** (cream badge, pine trail — new prop on `BrandLogo`; pine-on-pine is invisible today) or tenant logo on a cream 8% plate; tenant name Inter semibold cream.
- SUPER_ADMIN business switcher restyled as dark select (cream text, hairline).
- Group labels: mono 10px, cream 45%.
- Items: Inter 13.5 medium; hover cream 5.5% wash; active = cream 9% pill + 3px amber bar + mint icon (fill weight) + cream text. Unread badges restyled for dark bg.
- Footer: mark + "Powered by BookingTours" at 45% cream.
- All logic untouched: role filtering, suspended gating, collapse persistence, switcher.

### Topbar (h-14, glass)
- Left: breadcrumb `tenant / section` in mono (muted / strong).
- Right: live clock with breathing mint dot · redesigned ThemeToggle (pine/mint pill with Phosphor sun/moon) · SignOut as ghost icon button.
- Suspended / paused / test-mode banners keep exact semantics; restyled to token washes + icon chips.

### Mobile
- Drawer becomes the same pine rail (fixes hardcoded "Kayaks" title → business name).
- Bottom tab bar: glass, active item mint with amber dot marker.

---

## 6. Component treatments (new/updated classes in `globals.css`)

| Class | Treatment |
|---|---|
| `.ui-card` / `.ui-card-hover` | The §3 card recipe; hover variant lifts. Replaces both `.ui-surface*` and hand-rolled `bg-white rounded-xl shadow-sm border` |
| `.ui-btn-primary` | Pine vertical gradient + inset light + pine glow shadow; hover brightens & lifts −1px. Dark: mint gradient, ink text |
| `.ui-btn-ghost` | Hairline + surface; hover warms |
| `.ui-btn-soft` (new) | `accent-soft` bg + pine text — secondary emphasis |
| `.ui-btn-danger` (new) | danger-soft bg + danger text; solid on confirm dialogs |
| `.ui-control` | h-9, strong hairline, focus = pine border + 3px soft ring; standardized select chevron |
| `.ui-pill-{success,warning,danger,accent,amber,ocean,neutral}` (new) | Status pills: mono 10px uppercase on soft washes — one vocabulary for every status badge in the app |
| `.ui-seg` / `.ui-seg-item` (new) | Segmented control on sunken track; active item = surface + shadow-sm |
| `.ui-icon-chip` (new) | 36px rounded-10 soft-wash icon container for KPI cards & empty states |
| `.ui-skeleton` (new) | Shimmer blocks — replaces every spinner-only loading state |
| `.ui-progress` (new) | 6px track + pine→mint gradient fill (check-in ratios, capacity) |
| `.ui-empty` (new) | Centered icon chip + title + muted line + optional ghost CTA |
| tables | Global `th` mono voice kept; numeric cells right + tabular; row hover = sunken wash; totals rows strong-hairline |

Toasts/confirms (`AppNotifications`) restyled to `.ui-card` + tone rail.

---

## 7. Dashboard home (the showpiece)

Same data, queries, realtime and check-in logic — presentation only:

1. **Header** — mono date eyebrow · Fraunces "Dashboard" · Add Booking primary. Entrance stagger.
2. **Hero band (2-col)** — *Today's Pax* on the enriched `.bg-bt-dark` with topo overlay, amber trail dot, Fraunces 56px numeral, tomorrow/trips meta. *Revenue* card: three figures + a **28-day area sparkline** (hand-rolled SVG from the month-revenue rows already fetched — no new queries, no recharts on this page), today marked with an amber dot.
3. **KPI row (3-up)** — Refunds (amber chip), Inbox (ocean chip), Photos (fjord chip): icon chip + Fraunces 34px numeral + status-dot meta, hover lift.
4. **Manifest** — `.ui-seg` Today/Tomorrow toggle; per-slot check-in mini progress bar; past slots dimmed; totals footer.
5. **Roll Call** — slot stepper (ghost icon buttons + `2/5` mono + "Auto" chip); custom mint check-in control, checked rows get mint wash; footer progress bar + "All present" moment.
6. **Weather** — same widgets in `.ui-card` chrome, `.ui-control` select.
7. **Loading** — skeleton mirroring the exact layout (no spinner).

---

## 8. Data-viz standard

- recharts themed from the chart tokens: hairline grid, mono 10.5px axes, tooltip = `.ui-card` with mono label + Inter value, area fills 18%→0 gradients.
- Tiny inline trends = hand-rolled SVG sparklines (no dependency).
- `/reports` gets restyled to the system **and** (decision D1 below) a revenue area chart + occupancy bars from its existing data.

---

## 9. Per-page migration recipe

Mechanical steps applied to every route (visual-only; zero logic/query/handler changes):

1. Page header → eyebrow (mono) + Fraunces title + actions right.
2. `bg-white rounded-* shadow-* border` and `.ui-surface*` cards → `.ui-card` (+ `-hover` if clickable).
3. Hand-rolled buttons → `.ui-btn` variants; inputs/selects → `.ui-control`.
4. Status spans → `.ui-pill-*` vocabulary.
5. Hardcoded hexes → tokens per §2.4 map.
6. Tables → standard voice (numerics right/tabular, hover wash, totals rows).
7. Spinner loading → `.ui-skeleton` layout blocks; empty branches → `.ui-empty`.
8. Verify in dark via class toggle.

Group notes:

| Group | Routes | Notable treatments |
|---|---|---|
| Operations | bookings, bookings/[id], pending-reschedules, new-booking, slots, photos, weather | Bookings: sticky glass header, density pass, status-pill map. Slots/calendar: capacity as `.ui-progress`, today highlighted pine |
| Customers | inbox, notifications, refunds, vouchers, reviews, customers | Inbox: virtuoso row polish, unread mint dot. Refunds: amounts Fraunces, urgency amber |
| Revenue | invoices, pricing, reports, billing | Reports: §8. Pricing: peak windows amber-washed |
| Growth | marketing/*, broadcasts | Fix `--ck-border` bug → `--ck-border-subtle`; recharts themed; EmailBuilder chrome only |
| Admin | settings/*, privacy, super-admin, operators | Settings (3.3k lines): section nav cards, **lucide → Phosphor swap**; super-admin: tenant cards with health pills |
| Auth/utility | AuthGate login, change-password, popia/confirm, not-found, loading | Login: centered `.ui-card` on atmosphere canvas, brand mark, Fraunces heading. Global `loading.tsx` → skeleton shell |

---

## 10. Engineering notes

- `tailwind.config.js`: add `darkMode: "class"` (existing scattered `dark:` variants become live — audited during QA), brand color scales (`pine/mint/ocean/fjord/sunset/paper/cream/sand/ink`), `fontFamily.sans/mono`, card/hero `boxShadow`, `fade-up`/`shimmer` keyframes. **The CSS-variable architecture stays** — Tailwind theme is additive for new work, not a migration of the var system.
- No new dependencies. Atmosphere = 2 gradients + 1 tiled SVG-noise data URI; blur only on chrome; no scroll-linked effects.
- Accessibility: every text/bg pair in §2 clears WCAG AA at its size; focus-visible rings everywhere; reduced-motion honored.
- Bundled small fixes: marketing layout `--ck-border` bug · drawer "Kayaks" title · settings icon-library split · inert `dark:` variants.
- Out of scope: Guide PWA (keeps its distinct field-tool teal identity), the 3 chrome-less lead-gen pages, `/embed` (token alignment only), the customer booking app.

**Verification gates:** `npm run build` green · light+dark screenshots of Dashboard, Bookings, Reports, Settings, Inbox · grep gate (no new hex literals outside `globals.css`/`tailwind.config.js`) · zero non-visual diffs in page logic.

**Rollout order:** foundation (tokens/fonts/config) → shell → dashboard → auth → parallel page sweeps by group → QA pass.

---

## 11. Decisions requested

| # | Question | Default if unspecified |
|---|---|---|
| D1 | Add charts to `/reports` (revenue area + occupancy bars from existing data)? | **Yes** — flagship improvement, data is already fetched |
| D2 | Delete the three dead `* 2.tsx` duplicate files? | **Yes** |
| D3 | Align the Guide PWA with the new system? | **No** — separate field-tool identity, separate pass |
