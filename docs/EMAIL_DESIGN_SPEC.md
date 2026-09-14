# Transactional Email Design Spec — BookingTours

**Purpose:** implementation brief for redesigning every customer-facing email in `supabase/functions/send-email/index.ts`. The current templates work but read as bland early-2010s trans
actional mail: flat single-column tables, washed-out greys, inconsistent spacing, Georgia headings on system-font bodies, and buttons that vary per template. This spec defines one visual system to be applied to all types.

**Non-negotiable constraints (do not break these):**
1. **Everything stays in `send-email/index.ts` as template-literal HTML** — no external templating engine, no build step.
2. **The `applyBranding()` string-replacement pipeline must keep working.** Templates are written in "Cape Kayak" voice and rebranded per tenant by literal string swaps (`Cape Kayak Adventures` → brand name, `#1b3b36` → `email_color`, `#A8C2B8` → derived accent, footer address lines, `{{BOOKING_URL}}`, "Thank you for paddling with", "…incredible time on the water", the `<!--HERO_IMG:KEY:bg:alt-->` markers). Any redesigned template MUST use these exact literals so existing replacements keep matching, or the replacement list must be updated in the same PR.
3. **Hero images come from Email Customisation** (`businesses.email_img_*` via the `heroImg("IMG_X", alt)` marker + `imgMap` in `applyBranding`). Every template keeps its marker; when an operator hasn't uploaded an image the row must collapse cleanly (current behaviour — marker resolves to empty string).
4. **Email-client-safe HTML only:** nested `<table>` layout, inline styles, no flexbox/grid, no `<style>` blocks relied on for layout, no web fonts (see type ramp below), bulletproof table-based buttons (the existing `emailBtn()` pattern), max-width 600px, must render in Gmail/Outlook/Apple Mail, light and dark inbox chrome.
5. **Dynamic content contract unchanged:** the `d.*` fields each template consumes today, `d._manageUrl` / `d._siteUrl` / `d._emailTagline` injection, PDF invoice attachments on INVOICE/BOOKING_CONFIRM, `List-Unsubscribe` for BROADCAST/MARKETING_TEST.

---

## 1. Design language — "Field Console, in your inbox"

Match the product's brand system (see `docs/BRAND.md`): warm paper, deep pine, amber highlights, editorial serif display over humanist sans body. Emails should feel like a well-set boarding pass, not a receipt.

### Palette (tenant-themable)
| Token | Default | Usage | Rebrand rule |
|---|---|---|---|
| Brand deep | `#1b3b36` | Header band, primary buttons, headings | swapped to tenant `email_color` (keep this literal) |
| Accent | `#A8C2B8` | Eyebrow text on brand deep | auto-derived from email_color (keep literal) |
| Canvas | `#F7F5F0` | Page background (currently `#F7F7F6` — warm it up) | fixed |
| Card | `#FFFFFF` | Content card | fixed |
| Ink | `#17221C` | Headings on white | fixed |
| Body | `#4A5651` | Paragraph text (replaces the washed-out `#555`/`#888` mix) | fixed |
| Amber | `#D9822F` | The ONE highlight: countdowns, "action needed" chips, key amounts | fixed |
| Success wash | `#F1F7F3` / text `#128A5C` | Positive panels (waiver signed, refund issued) | fixed |
| Danger wash | `#FBF2F1` / text `#C6453A` | Cancellation notice panel | fixed |

### Type ramp (system stack only)
- Display / H1-H2: `Georgia, 'Times New Roman', serif` — 30/24px, weight 500, letter-spacing -0.01em. (Georgia is the email-safe stand-in for Fraunces.)
- Body: `'Helvetica Neue', Helvetica, Arial, sans-serif` — 16px/1.6 body, 14px secondary.
- Mono micro-label (NEW — the signature move): `'Courier New', monospace`, 11px, uppercase, letter-spacing 0.12em, color `#66736B`. Use for eyebrows ("BOOKING CONFIRMED", "REF TESTWX01"), table labels, and the footer meta line. This one device will do the most to de-blandify.

### Layout skeleton (identical across all types)
```
canvas #F7F5F0, 24px padding
└─ card, max-width 600, radius 16, shadow 0 12px 32px -16px rgba(15,43,31,.18)
   ├─ HEADER BAND (email_color): mono eyebrow (brand name) + serif H1 (email title)
   │    · 32px top / 24px bottom padding · h1 NEVER bolded uppercase
   ├─ HERO IMAGE row (heroImg marker — full-bleed within card, 0 side padding,
   │    image radius 0, height auto; collapses when unset)
   ├─ GREETING block: serif H2 "Hi {name}," + one lead paragraph (16px)
   ├─ DETAIL CARD: sunken panel #F7F5F0, radius 12, 1px border rgba(16,44,32,.09)
   │    · rows = mono label left / value right, 13px labels, 15px values
   │    · NO zebra borders between every row (current design) — single panel,
   │      12px row spacing, one hairline above the total row only
   ├─ ACTION ZONE: one primary button (email_color, pill radius 30, 14px/600,
   │    min 44px tap height), optional ghost links BELOW it as plain text links
   │    — never three identical stacked buttons (current cancellation email)
   ├─ CONTEXT PANELS (optional): waiver ask, options, meeting point — one wash
   │    panel max per email, using success/amber/danger wash per semantics
   └─ FOOTER: hairline, then mono micro-label block: brand · address line ·
        "Reply to this email if you need anything." · social icon row (existing
        footerExtras logic) · legal line
```

### Voice rules
- Subject lines: drop the "Cape Kayak - " prefix pattern → `applyBranding` already rewrites the prefix; keep the literal but tighten the copy after it ("Your trip is tomorrow", "You're booked — see you Saturday").
- One idea per paragraph, max two paragraphs before the detail card.
- Amounts always `R 1 030.00` format, right-aligned, amber when action is needed, ink otherwise.
- The confirmation tagline is operator-set (`email_tagline`, falls back to activity-aware default) — keep the `${activityFlavor}` injection point.

---

## 2. Per-template notes (what changes beyond the skeleton)

| Type | Title | Specific treatment |
|---|---|---|
| BOOKING_CONFIRM | "You're booked." | Hero = IMG_CONFIRM. Detail card with date/time/guests/ref. Waiver panel (success wash if signed, amber wash + button if pending — keep `enrichWaiverEmailData` fields). Keep PDF invoice attachment note line. |
| PAYMENT_LINK / RESCHEDULE_PAYMENT_LINK / VOUCHER_PAYMENT_LINK | "Complete your booking" | Amber amount chip up top; ONE pay button; expiry line in mono ("HELD FOR 15 MIN"). |
| REMINDER / INDEMNITY | "Your trip is tomorrow" | Merge visual design (they already share copy paths): detail card + meeting-point panel (uses `arrival_instructions`, `what_to_bring`) + waiver panel only when unsigned. |
| CANCELLATION | "Trip cancelled" | Danger-wash notice panel with reason; hero = IMG_CANCEL_WEATHER when `is_weather`, else IMG_CANCEL (keep the `isWeather` branch exactly); then ONE primary "Manage my booking" button + a sentence naming the three options (refund / voucher / new date) — replaces today's three stacked buttons. |
| GIFT_VOUCHER / VOUCHER / VOUCHER_BALANCE | "A gift for you" | Voucher code in a dashed-border mono panel, 20px code, amber. |
| TRIP_PHOTOS | "Your photos are ready" | Hero = IMG_PHOTOS; one button to the gallery; review ask as a plain link, not a second button. |
| INVOICE | "Tax invoice {n}" | Minimal: detail card + attachment note; no hero needed but keep marker. |
| BROADCAST / MARKETING_TEST | operator subject | Keep unsubscribe footer + header; body copy is operator HTML — wrap it in the skeleton card untouched. |
| ADMIN_WELCOME / MAGIC_LINK / MY_BOOKINGS_OTP | — | Skeleton + one button/code panel. OTP code in the dashed mono panel style. |
| POPIA_* | — | Skeleton, no hero, sober copy. |

---

## 3. Implementation order for the agent
1. Build one shared set of helper snippets inside `send-email/index.ts` (`emailShell(title, eyebrow, bodyRows)`, `detailCard(rows)`, `washPanel(tone, html)`, keep `emailBtn`/`heroImg` signatures) — pure functions returning strings, no new deps.
2. Port BOOKING_CONFIRM first (highest volume), verify `applyBranding` replacements still all match (grep each literal in the replacement list against the new output).
3. Port the rest in the table order above.
4. Test matrix: one send per type to a Gmail + Outlook address for (a) Cape Kayak defaults, (b) a tenant with custom email_color + all hero images, (c) a tenant with NO hero images (rows must collapse). Confirm IMG_CANCEL_WEATHER appears for `is_weather: true` and IMG_CANCEL otherwise.
5. Do not touch `sendResend`, CORS, or the type switch/routing.
