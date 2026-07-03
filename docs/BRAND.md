# BookingTours Brand System

One design language across all four surfaces: marketing site (`~/bookingtourssite`), onboarding (`~/Desktop/2026/Code Projects/ActvityHub/Onboarding`), customer booking app (`booking/`), and admin dashboard (`app/` + `components/`).

**Personality:** field guides and quality outdoor gear — warm, natural, precise. Never generic SaaS.

## Logo

The mark is a dotted trail on a deep-pine badge: an amber start-point arcing to a destination ring.

- `public/brand/bt-mark.svg` — pine badge (use on light surfaces)
- `public/brand/bt-mark-ivory.svg` — ivory badge (use on dark/pine surfaces)
- `app/icon.svg` — favicon (Next.js file convention) in each app
- Wordmark: "BookingTours" set in Fraunces 600, normal case, tracking `-0.01em`, rendered as HTML text beside the mark (never baked into an image).

## Color

| Token | Hex | Use |
|---|---|---|
| Pine 950 | `#0F2B1F` | Dark sections, hero backgrounds, logo badge |
| Pine 900 | `#123528` | Dark section gradients, hover on 950 |
| Pine 700 (accent) | `#125E40` | Primary interactive (light mode) — buttons, links, active nav |
| Pine hover | `#0E4831` | Hover of accent |
| Mint 500 | `#00D98B` | Dark-mode accent only |
| Mint wash | `#D8F0E4` | Soft accent backgrounds (light) |
| Amber | `#D9822F` | Decorative accent: eyebrows, logo dot, highlights on dark |
| Amber deep | `#B4641C` | Amber as CTA/interactive on light (AA vs white) |
| Amber wash | `#F7E8D8` | Soft amber backgrounds |
| Paper | `#F7F5F0` | App/page background (light) |
| Cream | `#F4F1E8` | Alternate warm section background, ivory logo field |
| Sand | `#E7E2D4` | Hairlines/borders on warm surfaces |
| Ink | existing gray text scale per app | Body text (near-neutral is fine on warm paper) |

Dark mode (dashboard only): pine-tinted neutrals — bg `#131614`, surface `#1B201C`, elevated `#232923`, borders `#2C332E` / `#37403A`.

**Banned:** purple/violet/indigo accents, `bg-donezo-gradient`, emoji as UI icons, arbitrary radii like `rounded-[24px]`.

## Typography

- **Display: Fraunces** (Google, variable) — marketing h1/h2, hero titles, page titles, large stat numbers. Tracking `-0.01em` to `-0.03em`.
- **UI/body: Inter** — everything else. Feature settings `"cv11","ss01","ss03","cv02","calt"`; tabular numerals in tables.
- Eyebrows/labels: Inter 600–700, uppercase, tracking `0.08–0.14em`, 11–12px.
- Load both via `next/font/google` with CSS variables `--font-display` / `--font-sans`.

## Shape, depth, motion

- Radii: 6 / 10 / 14 / 20 px (`--radius sm/md/lg/xl`). Cards 14–16px. Never 24px+ on cards; `rounded-full` only for pills/avatars/dots.
- Shadows: hairline-first (the existing `--ck-shadow-*` stack in the dashboard). No heavy drop shadows.
- Motion: 150–200ms, `cubic-bezier(0.2, 0.7, 0.2, 1)`; hover lift max `translateY(-1px)`; respect `prefers-reduced-motion`.

## Iconography

Phosphor icons (`@phosphor-icons/react`) in React apps, `regular` weight (`fill` for active states), or hand-drawn inline SVGs at `stroke-width` 1.8–2. Never emoji.

## Voice

Specific over superlative. Use the real numbers: "Live in 48 hours", "R2,000/month flat", "Zero commission", "WhatsApp replies in under 2 seconds". Avoid "seamless", "supercharge", "empower", "all-in-one".

## Per-surface notes

- **Booking app is white-label:** tenant DB colors override `--accent/--cta/--bg/...` at runtime. The brand tokens above are the *defaults*; never hardcode brand hex into components — always go through the CSS vars. Platform provenance appears only as "Powered by BookingTours" (mark + wordmark) in the footer.
- **Dashboard:** Fraunces is reserved for the page `h1` and hero stat numbers; all data UI stays Inter.
- **Landing site:** subpages under `app/(pages)/` still use the legacy compiled Tailwind; the root page is hand-built CSS. Both share fonts, favicon, and palette.
