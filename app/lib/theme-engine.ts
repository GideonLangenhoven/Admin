// VENDORED COPY — canonical source: booking/lib/theme-engine.ts.
// The admin app cannot import across the nested booking/ git repo boundary
// (Vercel doesn't upload it). tests/unit/theme-engine.test.ts asserts this
// copy is byte-identical to the canonical one — update BOTH together.
// Legibility engine for the glassmorphic booking site.
//
// Operator theme colors are UNTRUSTED input — any six hex values, including
// all-white or all-black. This module derives every color the UI actually
// uses (ink, glass alphas, button inks, scrim) so that WCAG 2.1 AA holds for
// ANY palette. Components never consume raw config colors for text.
//
// Pure TS, no DOM: unit-testable, and runs identically on server and client.

export type RGB = [number, number, number];

export const INK_DARK: RGB = [11, 18, 32]; // #0B1220
export const INK_LIGHT: RGB = [248, 250, 252]; // #F8FAFC

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Parse "#rgb" | "#rrggbb" (with or without #). Returns null on garbage. */
export function hexToRgb(hex: string | null | undefined): RGB | null {
  const m = String(hex || "").trim().match(HEX_RE);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  const to = (c: number) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0");
  return "#" + to(r) + to(g) + to(b);
}

export function rgba([r, g, b]: RGB, alpha: number): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${+alpha.toFixed(3)})`;
}

// ── WCAG math ─────────────────────────────────────────────────────────────

function lin(c: number): number {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance([r, g, b]: RGB): number {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [h, l] = la >= lb ? [la, lb] : [lb, la];
  return (h + 0.05) / (l + 0.05);
}

/** Alpha-composite fg at `alpha` over bg — what a glass tint actually looks like. */
export function over(fg: RGB, alpha: number, bg: RGB): RGB {
  return [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha)) as RGB;
}

// ── Surface solving ───────────────────────────────────────────────────────

export type SurfaceSolution = { alpha: number; ink: RGB };

/**
 * Raise a glass surface's alpha from `floorAlpha` in 0.05 steps until ONE ink
 * reaches AA (4.5:1) against EVERY backdrop the surface can sit on. (Solving
 * against only the single worst backdrop — as in the original sketch — lets
 * the chosen ink fail on a different backdrop: a near-black tint over white
 * wants dark ink, over black that same ink is ~1:1. The ∀-backdrop invariant
 * is what actually guarantees one ink per elevation.)
 *
 * Alpha never decreases (glass look preserved). At the 0.95 ceiling — only
 * reachable for tints engineered to sit exactly between both inks — we return
 * the ink with the best worst-case contrast.
 */
export function solveSurface(tint: RGB, floorAlpha: number, worstBackdrops: RGB[]): SurfaceSolution {
  const backdrops = worstBackdrops.length > 0 ? worstBackdrops : [[255, 255, 255] as RGB, [0, 0, 0] as RGB];

  const minContrast = (alpha: number, ink: RGB) =>
    Math.min(...backdrops.map((b) => contrast(over(tint, alpha, b), ink)));

  for (let alpha = floorAlpha; alpha <= 0.951; alpha += 0.05) {
    for (const ink of [INK_DARK, INK_LIGHT]) {
      if (minContrast(alpha, ink) >= 4.5) return { alpha: +alpha.toFixed(2), ink };
    }
  }
  // Ceiling: best-effort ink at max alpha.
  const ink = minContrast(0.95, INK_DARK) >= minContrast(0.95, INK_LIGHT) ? INK_DARK : INK_LIGHT;
  return { alpha: 0.95, ink };
}

/**
 * Ink for text sitting directly on a solid config color (CTA button, active
 * chip). If neither ink reaches AA (mid-tone colors), returns an overlay the
 * button must render under its label: a translucent black/white layer strong
 * enough to get the chosen ink to 4.5:1 — the operator's hue shows through.
 */
export type ButtonInk = { ink: RGB; overlay: string | null };

export function solveButtonInk(base: RGB): ButtonInk {
  const dark = contrast(base, INK_DARK);
  const light = contrast(base, INK_LIGHT);
  if (Math.max(dark, light) >= 4.5) {
    return { ink: dark >= light ? INK_DARK : INK_LIGHT, overlay: null };
  }
  // Mid-tone: darken under light ink (usually cheaper perceptually).
  const white: RGB = [255, 255, 255];
  const black: RGB = [0, 0, 0];
  for (let a = 0.1; a <= 0.75; a += 0.05) {
    const darkened = over(black, a, base);
    if (contrast(darkened, INK_LIGHT) >= 4.5) {
      return { ink: INK_LIGHT, overlay: rgba(black, +a.toFixed(2)) };
    }
    const lightened = over(white, a, base);
    if (contrast(lightened, INK_DARK) >= 4.5) {
      return { ink: INK_DARK, overlay: rgba(white, +a.toFixed(2)) };
    }
  }
  return { ink: light >= dark ? INK_LIGHT : INK_DARK, overlay: rgba(black, 0.75) };
}

// ── Theme derivation ──────────────────────────────────────────────────────

export type OperatorColors = {
  main: string | null | undefined;
  secondary: string | null | undefined;
  cta: string | null | undefined;
  bg: string | null | undefined;
  nav: string | null | undefined;
  hover: string | null | undefined;
};

export const DEFAULT_COLORS: Record<keyof OperatorColors, string> = {
  main: "#0f5dd7",
  secondary: "#101828",
  cta: "#0c8a59",
  bg: "#f5f5f5",
  nav: "#ffffff",
  hover: "#48cfad",
};

// Alpha floors from the spec — solveSurface may raise, never lower.
const FLOOR_CARD = 0.55;
const FLOOR_NAV = 0.6;
const FLOOR_SHEET = 0.72;

export type GlassTheme = {
  scheme: "light" | "dark";
  /** every value is a ready-to-use CSS custom property */
  vars: Record<string, string>;
};

/**
 * Compute the full token set from raw operator colors (+ optional average
 * hero-image color for worst-case testing). Invalid hexes fall back to the
 * platform defaults, never to broken CSS.
 */
export function computeTheme(colors: Partial<OperatorColors>, heroAverage?: RGB | null): GlassTheme {
  const pick = (key: keyof OperatorColors): RGB =>
    hexToRgb(colors[key] as string) ?? hexToRgb(DEFAULT_COLORS[key])!;

  const main = pick("main");
  const secondary = pick("secondary");
  const cta = pick("cta");
  const bg = pick("bg");
  const nav = pick("nav");
  const hover = pick("hover");

  const scheme: "light" | "dark" = luminance(bg) >= 0.35 ? "light" : "dark";

  // Worst-case backdrops any glass surface can sit over: the extremes plus
  // the hero image average (post-scrim imagery trends toward this).
  const worst: RGB[] = [[255, 255, 255], [0, 0, 0]];
  if (heroAverage) worst.push(heroAverage);

  const card = solveSurface(bg, FLOOR_CARD, worst);
  const navS = solveSurface(nav, FLOOR_NAV, worst);
  const sheet = solveSurface(bg, FLOOR_SHEET, worst);

  // One ink per elevation — but for visual coherence use the card ink as the
  // page-wide ink (cards dominate), each elevation still guaranteed AA by its
  // own solved alpha. If solutions disagree (rare: nav tint vs bg tint), the
  // nav surface uses its own ink.
  const ink = card.ink;
  const navInk = navS.ink;
  const sheetInk = sheet.ink;

  const ctaInk = solveButtonInk(cta);
  const mainInk = solveButtonInk(main);

  // Accent as TEXT (links, eyebrows): only when the raw accent passes AA on
  // the card surface over every worst backdrop; otherwise fall back to ink
  // (callers add underline for affordance). Spec §5 rule 6.
  const accentTextOk = worst.every((b) => contrast(over(bg, card.alpha, b), main) >= 4.5);
  const accentText = accentTextOk ? main : ink;

  // Backdrop scrim: just enough tint that the backdrop reads as the
  // operator's world, but weak enough that imagery/mesh stays vivid — the
  // glass effect is only visible when there's real contrast to blur.
  // (AA is unaffected: ink is solved against pure white/black extremes,
  // strictly worse than anything a weak scrim lets through.)
  const scrimTop = scheme === "light" ? rgba(bg, 0.14) : rgba(secondary, 0.25);
  const scrimBottom = scheme === "light" ? rgba(bg, 0.42) : rgba(secondary, 0.55);

  const glassBorder = scheme === "dark" ? "rgba(255, 255, 255, 0.28)" : rgba(secondary, 0.24);

  const vars: Record<string, string> = {
    "--cfg-main": rgbToHex(main),
    "--cfg-secondary": rgbToHex(secondary),
    "--cfg-cta": rgbToHex(cta),
    "--cfg-bg": rgbToHex(bg),
    "--cfg-nav": rgbToHex(nav),
    "--cfg-hover": rgbToHex(hover),

    "--ink": rgbToHex(ink),
    "--ink-muted": rgba(ink, 0.72),
    "--ink-faint": rgba(ink, 0.55),
    "--ink-nav": rgbToHex(navInk),
    "--ink-sheet": rgbToHex(sheetInk),
    "--ink-on-cta": rgbToHex(ctaInk.ink),
    "--ink-on-main": rgbToHex(mainInk.ink),
    "--cta-overlay": ctaInk.overlay ?? "transparent",
    "--main-overlay": mainInk.overlay ?? "transparent",

    "--glass-alpha-card": String(card.alpha),
    "--glass-alpha-nav": String(navS.alpha),
    "--glass-alpha-sheet": String(sheet.alpha),
    "--glass-tint-card": rgba(bg, card.alpha),
    "--glass-tint-nav": rgba(nav, navS.alpha),
    "--glass-tint-sheet": rgba(bg, Math.max(sheet.alpha, FLOOR_SHEET)),
    "--glass-solid-card": rgba(bg, 0.96),
    "--glass-solid-nav": rgba(nav, 0.96),
    "--glass-solid-sheet": rgba(bg, 0.97),
    "--glass-border": glassBorder,
    "--glass-blur": "24px",

    "--accent": rgbToHex(main),
    "--accent-text": rgbToHex(accentText),
    "--cta": rgbToHex(cta),
    "--hover-overlay": rgba(hover, 0.14),
    "--backdrop-scrim": `linear-gradient(180deg, ${scrimTop} 0%, ${scrimBottom} 100%)`,
    "--scrim-photo": `linear-gradient(180deg, rgba(0,0,0,0) 30%, ${rgba(secondary, 0.72)} 100%)`,

    "--radius-xl": "28px",
    "--radius-lg": "20px",
    "--radius-md": "16px",
    "--radius-pill": "9999px",
    "--shadow-card": "0 8px 32px rgb(0 0 0 / 0.22)",
    "--focus-ring": `0 0 0 3px ${rgba(main, 0.55)}`,
    "--theme-color": rgbToHex(scheme === "light" ? bg : secondary),
  };

  return { scheme, vars };
}
