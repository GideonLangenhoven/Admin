import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  hexToRgb, rgbToHex, luminance, contrast, over,
  solveSurface, solveButtonInk, computeTheme,
  INK_DARK, INK_LIGHT, type RGB,
} from "../../booking/lib/theme-engine";

// The admin app carries a vendored copy (app/lib/theme-engine.ts) because
// Vercel can't upload across the nested booking/ git repo boundary. Drift
// guard: the copy must stay byte-identical to the canonical engine (modulo
// its provenance header).
describe("vendored admin copy", () => {
  it("app/lib/theme-engine.ts matches booking/lib/theme-engine.ts", () => {
    const canonical = readFileSync(resolve(__dirname, "../../booking/lib/theme-engine.ts"), "utf8");
    const vendored = readFileSync(resolve(__dirname, "../../app/lib/theme-engine.ts"), "utf8");
    const stripped = vendored.split("\n").filter((l) => !l.startsWith("// VENDORED") && !l.startsWith("// The admin app cannot") && !l.startsWith("// (Vercel doesn't") && !l.startsWith("// copy is byte-identical")).join("\n");
    expect(stripped).toBe(canonical);
  });
});

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
const EXTREMES: RGB[] = [WHITE, BLACK];

describe("hexToRgb", () => {
  it("parses 6- and 3-digit hex, with/without #", () => {
    expect(hexToRgb("#0f5dd7")).toEqual([15, 93, 215]);
    expect(hexToRgb("fff")).toEqual([255, 255, 255]);
    expect(hexToRgb("#000")).toEqual([0, 0, 0]);
  });
  it("rejects garbage (untrusted config)", () => {
    expect(hexToRgb("")).toBeNull();
    expect(hexToRgb("red")).toBeNull();
    expect(hexToRgb("#12345")).toBeNull();
    expect(hexToRgb(null)).toBeNull();
    expect(hexToRgb("javascript:alert(1)")).toBeNull();
  });
});

describe("WCAG math", () => {
  it("white/black contrast is 21", () => {
    expect(contrast(WHITE, BLACK)).toBeCloseTo(21, 1);
  });
  it("luminance is 0 for black, 1 for white", () => {
    expect(luminance(BLACK)).toBeCloseTo(0, 5);
    expect(luminance(WHITE)).toBeCloseTo(1, 5);
  });
  it("alpha compositing interpolates", () => {
    expect(over(WHITE, 0.5, BLACK)).toEqual([127.5, 127.5, 127.5]);
    expect(over(WHITE, 1, BLACK)).toEqual([255, 255, 255]);
  });
});

describe("solveSurface", () => {
  const cases: Array<[string, string, number]> = [
    ["near-white tint (Soft Sand)", "#F5EBE0", 0.55],
    ["near-black tint (deep teal)", "#022B3A", 0.55],
    ["pastel pink (Cherry Blossom)", "#FF99C8", 0.55],
    ["pastel yellow (Pastel Dreams)", "#FCF6BD", 0.55],
    ["pure white (adversarial)", "#FFFFFF", 0.55],
    ["pure black (adversarial)", "#000000", 0.55],
  ];
  for (const [label, hex, floor] of cases) {
    it(`AA passes for ${label}`, () => {
      const tint = hexToRgb(hex)!;
      const { alpha, ink } = solveSurface(tint, floor, EXTREMES);
      expect(alpha).toBeGreaterThanOrEqual(floor);
      expect(alpha).toBeLessThanOrEqual(0.95);
      // The contract: the ONE chosen ink is ≥ 4.5:1 on EVERY backdrop
      for (const b of EXTREMES) {
        const surface = over(tint, alpha, b);
        expect(contrast(surface, ink)).toBeGreaterThanOrEqual(4.49);
      }
      expect([INK_DARK, INK_LIGHT]).toContainEqual(ink);
    });
  }

  it("never lowers the floor", () => {
    const { alpha } = solveSurface(hexToRgb("#ffffff")!, 0.72, EXTREMES);
    expect(alpha).toBeGreaterThanOrEqual(0.72);
  });

  it("raises alpha for a near-black tint (one ink must win on BOTH extremes)", () => {
    // #022B3A at 0.55 over white is a midtone (light ink fails) while over
    // black it's near-black (dark ink fails) — no single ink works until
    // alpha rises enough that the over-white surface goes dark too.
    const { alpha, ink } = solveSurface(hexToRgb("#022B3A")!, 0.55, EXTREMES);
    expect(alpha).toBeGreaterThan(0.55);
    expect(ink).toEqual(INK_LIGHT);
  });

  it("returns best-effort at the 0.95 ceiling for mid-gray tints", () => {
    // Mid grays (#767676, #808080) sit between both inks: no alpha makes one
    // ink pass on BOTH pure-white and pure-black. Engine must terminate at
    // the ceiling with the better ink. (Real backdrops are scrimmed toward
    // bg/secondary, so the pure extremes are a theoretical worst case.)
    for (const hex of ["#767676", "#808080"]) {
      const { alpha } = solveSurface(hexToRgb(hex)!, 0.55, EXTREMES);
      expect(alpha).toBe(0.95);
    }
  });
});

describe("solveButtonInk", () => {
  it("dark CTA gets light ink, no overlay", () => {
    const { ink, overlay } = solveButtonInk(hexToRgb("#022B3A")!);
    expect(ink).toEqual(INK_LIGHT);
    expect(overlay).toBeNull();
  });
  it("pastel CTA gets dark ink, no overlay", () => {
    const { ink, overlay } = solveButtonInk(hexToRgb("#FCF6BD")!);
    expect(ink).toEqual(INK_DARK);
    expect(overlay).toBeNull();
  });
  it("default platform CTA #0c8a59 is mid-tone: gets a light overlay fix", () => {
    // Real-world regression guard: the shipped default CTA is 4.19:1 with
    // white — below AA. The engine must repair it with an overlay, not pass it.
    const base = hexToRgb("#0c8a59")!;
    const { ink, overlay } = solveButtonInk(base);
    expect(overlay).not.toBeNull();
    const m = overlay!.match(/rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/)!;
    const surface = over([+m[1], +m[2], +m[3]] as RGB, +m[4], base);
    expect(contrast(surface, ink)).toBeGreaterThanOrEqual(4.49);
  });
  it("mid-tone CTA gets an overlay strong enough for AA", () => {
    const base = hexToRgb("#767676")!;
    const { ink, overlay } = solveButtonInk(base);
    expect(overlay).not.toBeNull();
    // Reconstruct the overlaid surface and verify AA
    const m = overlay!.match(/rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/)!;
    const ovColor: RGB = [+m[1], +m[2], +m[3]];
    const surface = over(ovColor, +m[4], base);
    expect(contrast(surface, ink)).toBeGreaterThanOrEqual(4.49);
  });
});

describe("computeTheme (full palettes)", () => {
  const palettes: Array<[string, Record<string, string>]> = [
    ["default", { main: "#0f5dd7", secondary: "#101828", cta: "#0c8a59", bg: "#f5f5f5", nav: "#ffffff", hover: "#48cfad" }],
    ["all-white adversarial", { main: "#ffffff", secondary: "#ffffff", cta: "#ffffff", bg: "#ffffff", nav: "#ffffff", hover: "#ffffff" }],
    ["all-black adversarial", { main: "#000000", secondary: "#000000", cta: "#000000", bg: "#000000", nav: "#000000", hover: "#000000" }],
    ["pastel-on-pastel", { main: "#FF99C8", secondary: "#FCF6BD", cta: "#F5EBE0", bg: "#FCF6BD", nav: "#F5EBE0", hover: "#FF99C8" }],
    ["near-black teal", { main: "#022B3A", secondary: "#022B3A", cta: "#022B3A", bg: "#022B3A", nav: "#022B3A", hover: "#022B3A" }],
  ];

  for (const [name, p] of palettes) {
    it(`${name}: every text surface is AA and every var is emitted`, () => {
      const t = computeTheme(p);
      const v = t.vars;
      // Scheme derived from bg luminance
      expect(["light", "dark"]).toContain(t.scheme);
      // Card surface AA against extremes at the solved alpha
      const bg = hexToRgb(v["--cfg-bg"])!;
      const ink = hexToRgb(v["--ink"])!;
      const alpha = parseFloat(v["--glass-alpha-card"]);
      for (const b of EXTREMES) {
        expect(contrast(over(bg, alpha, b), ink)).toBeGreaterThanOrEqual(4.49);
      }
      // Nav surface AA with its own ink
      const nav = hexToRgb(v["--cfg-nav"])!;
      const navInk = hexToRgb(v["--ink-nav"])!;
      const navAlpha = parseFloat(v["--glass-alpha-nav"]);
      for (const b of EXTREMES) {
        expect(contrast(over(nav, navAlpha, b), navInk)).toBeGreaterThanOrEqual(4.49);
      }
      // CTA ink AA (with overlay when needed)
      const cta = hexToRgb(v["--cta"])!;
      const ctaInk = hexToRgb(v["--ink-on-cta"])!;
      if (v["--cta-overlay"] === "transparent") {
        expect(contrast(cta, ctaInk)).toBeGreaterThanOrEqual(4.49);
      } else {
        expect(v["--cta-overlay"]).toMatch(/^rgba\(/);
      }
      // Alpha floors respected
      expect(alpha).toBeGreaterThanOrEqual(0.55);
      expect(parseFloat(v["--glass-alpha-nav"])).toBeGreaterThanOrEqual(0.6);
      expect(parseFloat(v["--glass-alpha-sheet"])).toBeGreaterThanOrEqual(0.72);
      // Required tokens all present
      for (const key of ["--ink", "--ink-muted", "--glass-tint-card", "--glass-border", "--backdrop-scrim", "--focus-ring", "--glass-solid-card", "--theme-color"]) {
        expect(v[key], key).toBeTruthy();
      }
    });
  }

  // Acceptance §9.1 — the full 10-theme palette matrix: 7 admin presets +
  // platform default + two adversarial configs. Every elevation must have an
  // AA ink at its solved alpha, and CTA/main button inks must be AA.
  const MATRIX: Array<[string, Record<string, string>]> = [
    ["Gentle Sea Breeze", { main: "#1F7A8C", secondary: "#022B3A", cta: "#1F7A8C", bg: "#E1E5F2", nav: "#FFFFFF", hover: "#BFDBF7" }],
    ["Earthy Green", { main: "#52796F", secondary: "#2F3E46", cta: "#52796F", bg: "#CAD2C5", nav: "#F2F4F0", hover: "#84A98C" }],
    ["Cherry Blossom", { main: "#BD632F", secondary: "#273E47", cta: "#A4243B", bg: "#D8C99B", nav: "#F8F5EE", hover: "#D8973C" }],
    ["Soft Sand", { main: "#D5BDAF", secondary: "#4A4036", cta: "#D5BDAF", bg: "#F5EBE0", nav: "#FFFFFF", hover: "#D6CCC2" }],
    ["Golden Summer Fields", { main: "#D4A373", secondary: "#3D4A27", cta: "#D4A373", bg: "#FEFAE0", nav: "#FFFFFF", hover: "#E9EDC9" }],
    ["Pastel Dreams", { main: "#FF99C8", secondary: "#2D3748", cta: "#FF99C8", bg: "#FCF6BD", nav: "#FFFFFF", hover: "#D0F4DE" }],
    ["Purple Haze", { main: "#A167A5", secondary: "#0E273C", cta: "#A167A5", bg: "#E8D7F1", nav: "#F8F4FA", hover: "#D3BCCC" }],
    ["Platform default", { main: "#0f5dd7", secondary: "#101828", cta: "#0c8a59", bg: "#f5f5f5", nav: "#ffffff", hover: "#48cfad" }],
    ["All-white adversarial", { main: "#ffffff", secondary: "#ffffff", cta: "#ffffff", bg: "#ffffff", nav: "#ffffff", hover: "#ffffff" }],
    ["All-black adversarial", { main: "#000000", secondary: "#000000", cta: "#000000", bg: "#000000", nav: "#000000", hover: "#000000" }],
  ];

  for (const [name, p] of MATRIX) {
    it(`matrix — ${name}: all elevations + buttons AA`, () => {
      const t = computeTheme(p);
      const v = t.vars;
      const elevations: Array<[string, string, string]> = [
        ["card", "--cfg-bg", "--glass-alpha-card"],
        ["nav", "--cfg-nav", "--glass-alpha-nav"],
        ["sheet", "--cfg-bg", "--glass-alpha-sheet"],
      ];
      const inkVar: Record<string, string> = { card: "--ink", nav: "--ink-nav", sheet: "--ink-sheet" };
      for (const [label, tintVar, alphaVar] of elevations) {
        const tint = hexToRgb(v[tintVar])!;
        const alpha = parseFloat(v[alphaVar]);
        const ink = hexToRgb(v[inkVar[label]])!;
        for (const b of EXTREMES) {
          expect(contrast(over(tint, alpha, b), ink), `${name}/${label}`).toBeGreaterThanOrEqual(4.49);
        }
      }
      for (const [baseVar, inkOnVar, ovVar] of [["--cta", "--ink-on-cta", "--cta-overlay"], ["--accent", "--ink-on-main", "--main-overlay"]] as const) {
        const base = hexToRgb(v[baseVar])!;
        const ink = hexToRgb(v[inkOnVar])!;
        if (v[ovVar] === "transparent") {
          expect(contrast(base, ink), `${name}/${baseVar}`).toBeGreaterThanOrEqual(4.49);
        } else {
          const m = v[ovVar].match(/rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/)!;
          const surface = over([+m[1], +m[2], +m[3]] as RGB, +m[4], base);
          expect(contrast(surface, ink), `${name}/${baseVar}+overlay`).toBeGreaterThanOrEqual(4.49);
        }
      }
    });
  }

  it("invalid hexes fall back to defaults, never break", () => {
    const t = computeTheme({ main: "not-a-color", bg: "", cta: undefined });
    expect(t.vars["--cfg-main"]).toBe("#0f5dd7");
    expect(t.vars["--cfg-bg"]).toBe("#f5f5f5");
    expect(t.vars["--cta"]).toBe("#0c8a59");
  });

  it("hero-average backdrop participates in worst-case", () => {
    const heroAvg: RGB = [128, 128, 128];
    const t = computeTheme({ bg: "#f5f5f5" }, heroAvg);
    const bg = hexToRgb(t.vars["--cfg-bg"])!;
    const ink = hexToRgb(t.vars["--ink"])!;
    const alpha = parseFloat(t.vars["--glass-alpha-card"]);
    // The chosen ink must be AA over the hero average too, not just extremes
    expect(contrast(over(bg, alpha, heroAvg), ink)).toBeGreaterThanOrEqual(4.49);
  });
});
