import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, "..", "public", "landing-pages", "templates");

const SKIN_PACKS = {
  sea_kayak: {
    fontLink: "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,600;0,9..144,700;1,9..144,400&family=Inter:wght@300;400;500;600;700&display=swap",
    fontDisplay: "'Fraunces', Georgia, serif",
    fontSans: "'Inter', system-ui, sans-serif",
    bg: "#F7F5F0",
    ink: "#0F2B1F",
    accent: "#D9822F",
    surface: "#ffffff",
    textMuted: "#5e6d64",
    borderAlpha: "rgba(15, 43, 31, 0.08)",
    themeName: "Sea-Kayak & Coastal",
    voice: "Paddle out at first light — we'll have the coffee ready.",
    dividerSvg: `<svg viewBox="0 0 1440 60" preserveAspectRatio="none" class="swell-progress-svg" style="width:100%;height:60px;fill:none;stroke-linecap:round;"><path d="M0,35 C240,60 480,10 720,35 C960,60 1200,10 1440,35 L1440,60 L0,60 Z" fill="var(--bg)"/><path d="M0,35 C240,60 480,10 720,35 C960,60 1200,10 1440,35" stroke="var(--accent)" stroke-width="3" class="progress-path" fill="none"/></svg>`,
    maskPath: "M0.12,0.3 C0.23,0.12,0.45,0.02,0.65,0.08 C0.82,0.13,0.95,0.35,0.91,0.58 C0.86,0.85,0.58,0.98,0.35,0.92 C0.18,0.88,0.02,0.68,0.01,0.5 C-0.01,0.38,0.04,0.36,0.12,0.3 Z",
    signatureComment: "<!-- pack: sea_kayak · signature: Tide Progress Swell - The swell line fills dynamically with tide amber as the user scrolls, cresting at the final CTA. -->",
    signatureMarkup: "",
    signatureCss: `
      .swell-progress-svg {
        position: relative;
      }
      .progress-path {
        stroke-dasharray: 1500;
        stroke-dashoffset: 1500;
        transition: stroke-dashoffset 0.1s ease-out;
      }
      /* Custom Swell Animation for Concierge Dock Header */
      .dock-swell-header {
        position: relative;
        height: 48px;
        background: var(--ink);
        color: var(--bg);
        display: flex;
        align-items: center;
        padding: 0 1.5rem;
        border-top-left-radius: inherit;
        border-top-right-radius: inherit;
        overflow: hidden;
      }
      .dock-swell-header::before {
        content: '';
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 8px;
        background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 100 10' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0,10 Q25,0 50,10 T100,10 L100,10 L0,10 Z' fill='%23F7F5F0'/%3E%3C/svg%3E");
        background-size: 50px 8px;
        animation: swellMove 4s infinite linear;
      }
      @keyframes swellMove {
        0% { background-position-x: 0; }
        100% { background-position-x: 50px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .dock-swell-header::before { animation: none; }
      }
    `,
    signatureJs: `
      const path = document.querySelector('.progress-path');
      if (path) {
        const pathLength = path.getTotalLength();
        path.style.strokeDasharray = pathLength + ' ' + pathLength;
        path.style.strokeDashoffset = pathLength;
        window.addEventListener('scroll', () => {
          const scrollPercent = (document.documentElement.scrollTop + document.body.scrollTop) / (document.documentElement.scrollHeight - document.documentElement.clientHeight);
          const draw = pathLength * (1 - scrollPercent);
          path.style.strokeDashoffset = draw;
        });
      }
    `
  },
  polar: {
    fontLink: "https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,600;0,6..72,700;1,6..72,400&family=Archivo:wght@300;400;500;600;700&display=swap",
    fontDisplay: "'Newsreader', Georgia, serif",
    fontSans: "'Archivo', system-ui, sans-serif",
    bg: "#F4F7F8",
    ink: "#1A2226",
    accent: "#2EC4B6",
    surface: "#ffffff",
    textMuted: "#57656e",
    borderAlpha: "rgba(26, 34, 38, 0.08)",
    themeName: "Polar / Expedition",
    voice: "Day 4: the ice decides the route. That's the point.",
    dividerSvg: `<svg viewBox="0 0 1440 60" preserveAspectRatio="none" style="width:100%;height:60px;fill:var(--bg);"><path d="M0,40 L120,25 L240,45 L360,15 L480,50 L600,20 L720,40 L840,10 L960,45 L1080,25 L1200,50 L1320,15 L1440,40 L1440,60 L0,60 Z"/></svg>`,
    maskPath: "M0.1,0.1 L0.9,0.05 L0.95,0.85 L0.5,0.95 L0.05,0.75 Z",
    signatureComment: "<!-- pack: polar · signature: Season Temperature Dial - Shift the visual temperature and gear tips of the polar page from Summer melt to Winter freeze. -->",
    signatureMarkup: "",
    signatureCss: "",
    signatureJs: ""
  },
  desert: {
    fontLink: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;0,700;1,400&family=Inter:wght@300;400;500;600;700&display=swap",
    fontDisplay: "'Cormorant Garamond', Georgia, serif",
    fontSans: "'Inter', system-ui, sans-serif",
    bg: "#F5EFE4",
    ink: "#2B2118",
    accent: "#C2491D",
    surface: "#ffffff",
    textMuted: "#63564c",
    borderAlpha: "rgba(43, 33, 24, 0.08)",
    themeName: "Desert Overlanding",
    voice: "Bring nothing. Leave nothing. Take everything in.",
    dividerSvg: `<svg viewBox="0 0 1440 60" preserveAspectRatio="none" style="width:100%;height:60px;fill:var(--bg);"><path d="M0,45 C360,10 720,10 1080,45 C1260,55 1380,50 1440,45 L1440,60 L0,60 Z"/></svg>`,
    maskPath: "M0.1,0.4 C0.2,0.1,0.5,0.05,0.75,0.2 C0.9,0.35,0.95,0.7,0.85,0.85 C0.7,0.95,0.3,0.9,0.15,0.75 C0.05,0.6,0.02,0.55,0.1,0.4 Z",
    signatureComment: "<!-- pack: desert · signature: Dune Route Scrubber - Hovering or dragging along the dune divider dynamically scrubs the vehicle position across the map. -->",
    signatureMarkup: "",
    signatureCss: "",
    signatureJs: ""
  },
  alpine: {
    fontLink: "https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&family=Archivo:wght@300;400;500;600;700&display=swap",
    fontDisplay: "'Source Serif 4', Georgia, serif",
    fontSans: "'Archivo', system-ui, sans-serif",
    bg: "#EEF1F4",
    ink: "#10151C",
    accent: "#E63B2E",
    surface: "#ffffff",
    textMuted: "#596068",
    borderAlpha: "rgba(16, 21, 28, 0.08)",
    themeName: "Alpine Ascent",
    voice: "Grade 4. Your legs will complain. Your photos won't.",
    dividerSvg: `<svg viewBox="0 0 1440 60" preserveAspectRatio="none" style="width:100%;height:60px;fill:var(--bg);"><path d="M0,50 L360,20 L720,45 L1080,10 L1440,50 L1440,60 L0,60 Z"/></svg>`,
    maskPath: "M0.5,0.05 L0.95,0.85 L0.05,0.85 Z",
    signatureComment: "<!-- pack: alpine · signature: Mountain Ascent Profile - An illustrative climbing ascent cross-section showing elevations as you hover/scroll. -->",
    signatureMarkup: "",
    signatureCss: "",
    signatureJs: ""
  },
  safari: {
    fontLink: "https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;0,700;1,400&family=Karla:wght@300;400;500;600;700&display=swap",
    fontDisplay: "'Lora', Georgia, serif",
    fontSans: "'Karla', system-ui, sans-serif",
    bg: "#F6F1E3",
    ink: "#3D2E1E",
    accent: "#A67C2E",
    surface: "#ffffff",
    textMuted: "#63584d",
    borderAlpha: "rgba(61, 46, 30, 0.08)",
    themeName: "Safari & Wildlife",
    voice: "The lions don't perform on schedule. We plan for that.",
    dividerSvg: `<svg viewBox="0 0 1440 60" preserveAspectRatio="none" style="width:100%;height:60px;fill:var(--bg);"><path d="M0,50 L40,30 L80,50 L120,30 L160,50 L200,30 L240,50 L280,30 L320,50 L360,30 L400,50 L440,30 L480,50 L520,30 L560,50 L600,30 L640,50 L680,30 L720,50 L760,30 L800,50 L840,30 L880,50 L920,30 L960,50 L1000,30 L1040,50 L1080,30 L1120,50 L1160,30 L1200,50 L1240,30 L1280,50 L1320,30 L1360,50 L1400,30 L1440,50 L1440,60 L0,60 Z"/></svg>`,
    maskPath: "M0.1,0.2 C0.3,0.05,0.7,0.05,0.9,0.2 C0.98,0.35,0.95,0.7,0.85,0.85 C0.7,0.95,0.3,0.95,0.15,0.85 C0.02,0.7,0.01,0.35,0.1,0.2 Z",
    signatureComment: "<!-- pack: safari · signature: Golden Hour Clock - Computes today's actual sunrise/sunset for the lodge's locale client-side. -->",
    signatureMarkup: "",
    signatureCss: "",
    signatureJs: ""
  },
  aerial: {
    fontLink: "https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@300;400;500;600;700&display=swap",
    fontDisplay: "'Archivo Black', sans-serif",
    fontSans: "'Inter', system-ui, sans-serif",
    bg: "#EDF4FB",
    ink: "#0B1B33",
    accent: "#C6F432",
    surface: "#ffffff",
    textMuted: "#4f5e73",
    borderAlpha: "rgba(11, 27, 51, 0.08)",
    themeName: "Skydive & Aerial",
    voice: "Sixty seconds of freefall. A lifetime of retelling.",
    dividerSvg: `<svg viewBox="0 0 1440 60" preserveAspectRatio="none" style="width:100%;height:60px;fill:var(--bg);"><path d="M0,30 C360,60 720,0 1080,30 C1260,40 1380,35 1440,30 L1440,60 L0,60 Z"/></svg>`,
    maskPath: "M0.5,0.05 C0.75,0.3,0.95,0.7,0.75,0.9 C0.55,1,0.45,1,0.25,0.9 C0.05,0.7,0.25,0.3,0.5,0.05 Z",
    signatureComment: "<!-- pack: aerial · signature: Altitude Scroll - Margin altimeter unwinds from 14,000 ft at the hero to 0 ft at the final CTA. -->",
    signatureMarkup: "",
    signatureCss: "",
    signatureJs: ""
  },
  jungle: {
    fontLink: "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@300;400;500;600;700&display=swap",
    fontDisplay: "'Instrument Serif', Georgia, serif",
    fontSans: "'Manrope', system-ui, sans-serif",
    bg: "#0E1F16",
    ink: "#DCE8DF",
    accent: "#D65780",
    surface: "#142a1f",
    textMuted: "#9ab3a4",
    borderAlpha: "rgba(220, 232, 223, 0.08)",
    themeName: "Jungle & River",
    voice: "Listen first. The river explains itself.",
    dividerSvg: `<svg viewBox="0 0 1440 60" preserveAspectRatio="none" style="width:100%;height:60px;fill:var(--bg);"><path d="M0,50 C180,30 360,20 540,40 C720,60 900,30 1080,45 C1260,60 1380,55 1440,50 L1440,60 L0,60 Z"/></svg>`,
    maskPath: "M0.1,0.5 C0.05,0.25,0.25,0.05,0.5,0.1 C0.75,0.05,0.95,0.25,0.9,0.5 C0.95,0.75,0.75,0.95,0.5,0.9 C0.25,0.95,0.05,0.75,0.1,0.5 Z",
    signatureComment: "<!-- pack: jungle · signature: Parting Foliage - Three depth planes of SVG foliage that slide out to reveal the content as you scroll. -->",
    signatureMarkup: "",
    signatureCss: "",
    signatureJs: ""
  },
  nordic: {
    fontLink: "https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,300;0,400;0,600;0,700;1,400&family=Instrument+Sans:wght@300;400;500;600;700&display=swap",
    fontDisplay: "'Crimson Pro', Georgia, serif",
    fontSans: "'Instrument Sans', system-ui, sans-serif",
    bg: "#F2F4F2",
    ink: "#42513F",
    accent: "#3E7CA6",
    surface: "#ffffff",
    textMuted: "#667563",
    borderAlpha: "rgba(66, 81, 63, 0.08)",
    themeName: "Nordic Hiking & Fjords",
    voice: "Pack for four seasons. Expect all of them before lunch.",
    dividerSvg: `<svg viewBox="0 0 1440 60" preserveAspectRatio="none" style="width:100%;height:60px;fill:var(--bg);"><path d="M0,30 C360,10 720,10 1080,30 L1440,30 L1440,60 L0,60 Z"/></svg>`,
    maskPath: "M0.05,0.3 L0.95,0.3 L0.95,0.7 L0.05,0.7 Z",
    signatureComment: "<!-- pack: nordic · signature: Waterline Reflection - A mirrored layout rippling effect beneath dividers simulating reflections on clear fjords. -->",
    signatureMarkup: "",
    signatureCss: "",
    signatureJs: ""
  },
  dive: {
    fontLink: "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=Public+Sans:wght@300;400;500;600;700&display=swap",
    fontDisplay: "'Playfair Display', Georgia, serif",
    fontSans: "'Public Sans', system-ui, sans-serif",
    bg: "#071E2C",
    ink: "#E8F4F6",
    accent: "#FF6F59",
    surface: "#0d2738",
    textMuted: "#8ca0ab",
    borderAlpha: "rgba(232, 244, 246, 0.08)",
    themeName: "Dive & Reef",
    voice: "Ten metres down, the noise stops.",
    dividerSvg: `<svg viewBox="0 0 1440 60" preserveAspectRatio="none" style="width:100%;height:60px;fill:var(--bg);"><path d="M0,35 C180,45 360,25 540,35 C720,45 900,25 1080,35 C1260,45 1380,35 1440,35 L1440,60 L0,60 Z"/></svg>`,
    maskPath: "M0.2,0.4 C0.1,0.2,0.3,0.05,0.5,0.1 C0.7,0.05,0.9,0.2,0.8,0.4 C0.9,0.6,0.8,0.9,0.5,0.8 C0.2,0.9,0.1,0.6,0.2,0.4 Z",
    signatureComment: "<!-- pack: dive · signature: Depth Scroll - Descent depth meter in the margin ticking down from 0m to 18m as the user scrolls. -->",
    signatureMarkup: "",
    signatureCss: "",
    signatureJs: ""
  },
  wine_cycling: {
    fontLink: "https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600;700&display=swap",
    fontDisplay: "'DM Serif Display', Georgia, serif",
    fontSans: "'DM Sans', system-ui, sans-serif",
    bg: "#FAF7F2",
    ink: "#4A5238",
    accent: "#C97B84",
    surface: "#ffffff",
    textMuted: "#717960",
    borderAlpha: "rgba(74, 82, 56, 0.08)",
    themeName: "Wine-Country Cycling",
    voice: "Eleven gentle kilometres. Two excellent estates. Zero rush.",
    dividerSvg: `<svg viewBox="0 0 1440 60" preserveAspectRatio="none" style="width:100%;height:60px;fill:var(--bg);"><path d="M0,45 C240,25 480,55 720,45 C960,35 1200,55 1440,45 L1440,60 L0,60 Z"/></svg>`,
    maskPath: "M0.5,0.5 C0.77,0.5,0.5,0.77,0.5,0.9 C0.23,0.77,0.23,0.23,0.5,0.1 C0.77,0.23,0.5,0.5,0.5,0.5 Z",
    signatureComment: "<!-- pack: wine_cycling · signature: Pedal Stroke Reveal - A circular transition lens that 'pedals' or rotates around the image on hover. -->",
    signatureMarkup: "",
    signatureCss: "",
    signatureJs: ""
  }
};

const BASE_TEMPLATE = `<!DOCTYPE html>
\${signatureComment}
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{business_name}} — {{tagline}}</title>
<meta name="description" content="{{hero_subtitle}}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="\${fontLink}" rel="stylesheet">
<style>
/* ── Design Tokens & Base CSS ── */
:root {
  --bg: \${bg};
  --ink: \${ink};
  --accent: \${accent};
  --surface: \${surface};
  --text-muted: \${textMuted};
  --border-alpha: \${borderAlpha};
  --ck-ease: cubic-bezier(0.2, 0.7, 0.2, 1);
  --font-display: \${fontDisplay};
  --font-sans: \${fontSans};

  /* Glass Tint personality details */
  --glass-tint: \${bg}; /* Default light packs tint equals bg */
  --r: 24px;

  /* Tenant accent colors configured in system settings */
  --tenant-main: {{color_main}};
  --tenant-secondary: {{color_secondary}};
  --tenant-cta: {{color_cta}};
  --tenant-nav: {{color_nav}};
  --tenant-hover: {{color_hover}};
}

/* Resets */
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: var(--font-sans);
  background-color: var(--bg);
  color: var(--ink);
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}
h1, h2, h3, .editorial-heading {
  font-family: var(--font-display);
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.02em;
  text-wrap: balance;
}

/* 2026 Glass tiers with border lights & noise */
.g1 {
  background: color-mix(in srgb, var(--glass-tint) 45%, transparent);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}
.g2 {
  position: relative;
  background: color-mix(in srgb, var(--glass-tint) 66%, transparent);
  -webkit-backdrop-filter: blur(16px) saturate(1.35);
  backdrop-filter: blur(16px) saturate(1.35);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-top-color: rgba(255, 255, 255, 0.38);
  border-radius: var(--r);
}
.g3 {
  position: relative;
  background: color-mix(in srgb, var(--glass-tint) 72%, transparent);
  -webkit-backdrop-filter: blur(22px) saturate(1.5);
  backdrop-filter: blur(22px) saturate(1.5);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-top-color: rgba(255, 255, 255, 0.45);
  border-radius: var(--r);
  box-shadow: 0 24px 60px -30px rgb(0 0 0 / 0.35);
}

/* Film noise overlays inside glass */
.g2::after, .g3::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.05'/%3E%3C/svg%3E");
  mix-blend-mode: overlay;
  z-index: 1;
}

/* Film noise on Hero */
.hero-noise {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 4;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.06'/%3E%3C/svg%3E");
  mix-blend-mode: overlay;
}

/* Mono Micro-Label */
.mono-label {
  font-size: 11px;
  font-family: var(--font-sans);
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent);
}

/* Layout System: Anti-Grid */
.container {
  max-width: 1300px;
  margin: 0 auto;
  padding: 0 2rem;
}
.section-seam {
  width: 100%;
  line-height: 0;
  margin: 0;
}
.section-seam.invert svg {
  transform: scaleY(-1);
}

/* Whitespace Budget */
.narrative-section {
  padding: 20vh 0;
  position: relative;
}
.anti-grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 3rem;
  align-items: center;
}
.anti-grid-text {
  grid-column: 1 / 6;
}
.anti-grid-image {
  grid-column: 7 / 13;
  position: relative;
  height: 480px;
  border-radius: var(--r);
  overflow: hidden;
  box-shadow: 0 30px 60px rgba(0,0,0,0.12);
}

/* 2026 Scroll reveal animations */
.reveal-fade-up {
  opacity: 0;
  transform: translateY(12px);
  transition: opacity 0.5s var(--ck-ease), transform 0.5s var(--ck-ease);
}
.reveal-fade-up.active {
  opacity: 1;
  transform: translateY(0);
}

/* Hero Section */
.hero {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  overflow: hidden;
}
.hero-media {
  position: absolute;
  inset: 0;
  z-index: 1;
}
.hero-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scale(1.0);
}
.hero-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, var(--bg) 0%, rgba(0,0,0,0.4) 100%);
  z-index: 2;
}
.hero-content {
  position: relative;
  z-index: 3;
  width: 100%;
  display: grid;
  grid-template-columns: 1fr 1.1fr;
  gap: 4rem;
  align-items: center;
}
.hero-text {
  text-align: left;
}
.hero-text h2 {
  font-size: clamp(2.6rem, 7.5vw, 6.5rem);
  line-height: 1.05;
  margin: 1rem 0;
  color: var(--ink);
  font-style: italic;
  font-variation-settings: "SOFT" 100, "WONK" 100;
}
.hero-text p {
  font-size: 1.15rem;
  opacity: 0.9;
  max-width: 34rem;
  margin-bottom: 2rem;
}

/* G3 Concierge Dock inside Hero */
.concierge-dock {
  width: 100%;
  min-height: 340px;
  overflow: hidden;
  z-index: 10;
}
.concierge-body {
  padding: 2rem;
  position: relative;
  z-index: 2;
}
.concierge-suggestions {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  margin-top: 1.5rem;
}
.concierge-suggestions a {
  text-decoration: none;
  font-weight: 500;
  color: var(--ink);
  transition: color 0.2s ease;
}
.concierge-suggestions a:hover {
  color: var(--accent);
}

/* Nav */
.sticky-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  transition: padding 0.3s var(--ck-ease), background 0.3s var(--ck-ease);
  padding: 1.5rem 0;
}
.sticky-nav.scrolled {
  padding: 1rem 0;
  background: color-mix(in srgb, var(--surface) 72%, transparent);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--border-alpha);
}
.nav-inner {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.logo-area h1 {
  font-size: 1.6rem;
  color: var(--ink);
}
.logo-area img {
  height: 40px;
}
.nav-links {
  display: flex;
  align-items: center;
  gap: 2rem;
}
.nav-links a {
  text-decoration: none;
  color: var(--ink);
  font-size: 0.9rem;
  font-weight: 500;
  transition: color 0.3s ease;
}
.nav-links a:hover {
  color: var(--accent);
}
.cta-button {
  display: inline-block;
  text-decoration: none;
  background-color: var(--tenant-cta, var(--accent));
  color: #fff !important;
  padding: 0.8rem 1.6rem;
  border-radius: 8px;
  font-weight: 600;
  font-size: 0.9rem;
  transition: transform 0.2s var(--ck-ease), background 0.2s ease;
}
.cta-button:hover {
  transform: translateY(-2px);
}

/* Hamburger mobile nav */
.hamburger {
  display: none;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.5rem;
  z-index: 110;
}
.hamburger span {
  display: block;
  width: 25px;
  height: 2px;
  background: var(--ink);
  margin: 5px 0;
  transition: 0.3s;
}
.mobile-overlay {
  position: fixed;
  inset: 0;
  background: var(--bg);
  z-index: 105;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 2rem;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s ease;
}
.mobile-overlay.active {
  opacity: 1;
  pointer-events: auto;
}
.mobile-overlay a {
  font-size: 1.8rem;
  text-decoration: none;
  color: var(--ink);
  font-family: var(--font-display);
}

/* Mobile Action Bar */
.mobile-action-bar {
  display: none;
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 100;
  padding: 1rem 1.5rem;
  justify-content: space-between;
  gap: 1rem;
}
.mobile-action-bar .cta-button {
  flex: 1;
  text-align: center;
}

/* Mobile Bottom Sheet for Chat */
.mobile-sheet-overlay {
  position: fixed;
  inset: 0;
  z-index: 120;
  background: rgba(0, 0, 0, 0.4);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s ease;
}
.mobile-sheet-overlay.active {
  opacity: 1;
  pointer-events: auto;
}
.mobile-sheet {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 125;
  max-height: 78vh;
  transform: translateY(100%);
  transition: transform 0.3s var(--ck-ease);
  border-top-left-radius: var(--r);
  border-top-right-radius: var(--r);
  padding: 2.5rem 1.5rem;
}
.mobile-sheet.active {
  transform: translateY(0);
}
.close-sheet-btn {
  position: absolute;
  top: 1rem;
  right: 1rem;
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: var(--ink);
}

/* Shimmer load states */
.shimmer-placeholder {
  height: 250px;
  background: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.3) 50%, rgba(255,255,255,0) 100%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .shimmer-placeholder { animation: none; background: rgba(255,255,255,0.1); }
}

/* Flagship Hover-Mask reveal */
.hover-reveal-section {
  padding: 20vh 0;
  background-color: var(--ink);
  color: var(--bg);
  position: relative;
}
.hover-list {
  list-style: none;
  max-width: 900px;
  margin: 4rem auto 0 auto;
}
.hover-item {
  border-bottom: 1px solid rgba(255,255,255,0.1);
  padding: 2rem 0;
  position: relative;
  cursor: pointer;
}
.hover-item-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: inherit;
  text-decoration: none;
}
.hover-item-title {
  font-size: clamp(1.8rem, 4vw, 3rem);
  font-family: var(--font-display);
  transition: transform 0.3s var(--ck-ease);
}
.hover-item:hover .hover-item-title {
  transform: translateX(15px);
}
.hover-item-meta {
  font-size: 0.85rem;
  opacity: 0.6;
}
.reveal-mask-container {
  pointer-events: none;
  position: fixed;
  width: 320px;
  height: 220px;
  border-radius: var(--r);
  overflow: hidden;
  z-index: 50;
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.8);
  transition: opacity 0.3s var(--ck-ease), transform 0.3s var(--ck-ease);
  clip-path: url(#organic-mask);
}
.reveal-mask-container.active {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}
.reveal-mask-container img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.1s ease-out;
}

/* Cursor Aura */
.cursor-aura {
  position: fixed;
  width: 24px;
  height: 24px;
  border: 1px solid var(--accent);
  border-radius: 50%;
  pointer-events: none;
  z-index: 9999;
  transform: translate(-50%, -50%);
  transition: width 0.3s, height 0.3s, background 0.3s;
}
.cursor-dot {
  position: fixed;
  width: 4px;
  height: 4px;
  background: var(--accent);
  border-radius: 50%;
  pointer-events: none;
  z-index: 9999;
  transform: translate(-50%, -50%);
}

/* Product Sheet Cards */
.product-sheet {
  background-color: var(--surface);
  border-radius: var(--r);
  border: 1px solid var(--border-alpha);
  overflow: hidden;
  margin-top: 4rem;
  box-shadow: 0 20px 50px rgba(0,0,0,0.04);
}
.gear-section {
  padding: 2.5rem;
  border-bottom: 1px solid var(--border-alpha);
}
.gear-col h4 {
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 1rem;
  color: var(--text-muted);
}
.gear-copy {
  color: var(--ink);
  font-size: 0.95rem;
  line-height: 1.7;
}

/* Reviews */
.reviews-section {
  padding: 20vh 0;
  background: var(--bg);
}
.reviews-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 2.5rem;
  margin-top: 3rem;
}
.review-quote {
  padding: 2rem;
  background: var(--surface);
  border-radius: var(--r);
  border: 1px solid var(--border-alpha);
  box-shadow: 0 10px 30px rgba(0,0,0,0.02);
}
.review-quote p {
  font-family: var(--font-display);
  font-size: 1.3rem;
  line-height: 1.4;
  color: var(--ink);
}
.review-quote cite {
  display: block;
  margin-top: 1.2rem;
  font-style: normal;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
}

/* Persistent Booking Rail */
.booking-rail {
  position: sticky;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 90;
  background: color-mix(in srgb, var(--surface) 85%, transparent);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-top: 1px solid var(--border-alpha);
  padding: 1.2rem 2.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.rail-price-info {
  display: flex;
  flex-direction: column;
}

/* Footer */
footer {
  background-color: var(--ink);
  color: var(--bg);
  padding: 6rem 2rem 3rem 2rem;
  text-align: center;
  border-top: 1px solid rgba(255,255,255,0.05);
}

/* Fallback SVG styling */
.fallback-svg {
  background: radial-gradient(circle, var(--accent) 0%, var(--bg) 100%);
  fill: var(--ink);
}

/* Responsive */
@media (max-width: 1024px) {
  .hero-content {
    grid-template-columns: 1fr;
    gap: 2rem;
    text-align: center;
  }
  .hero-text { text-align: center; }
  .hero-text p { margin-left: auto; margin-right: auto; }
  .anti-grid { grid-template-columns: 1fr; }
  .anti-grid-text { grid-column: 1 / -1; }
  .anti-grid-image { grid-column: 1 / -1; height: 350px; }
}
@media (max-width: 768px) {
  .nav-links { display: none; }
  .hamburger { display: block; }
  .booking-rail { display: none; }
  .mobile-action-bar { display: flex; }
}

/* prefers-reduced-motion check */
@media (prefers-reduced-motion: reduce) {
  * {
    animation-delay: 0s !important;
    animation-duration: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0s !important;
    scroll-behavior: auto !important;
    transform: none !important;
  }
  .reveal-fade-up { opacity: 1 !important; }
}

\${signatureCss}
</style>
</head>
<body>

<!-- SVG Organic clip-path mask -->
<svg style="position: absolute; width: 0; height: 0;" width="0" height="0">
  <defs>
    <clipPath id="organic-mask" clipPathUnits="objectBoundingBox">
      <path d="\${maskPath}" />
    </clipPath>
  </defs>
</svg>

<!-- Interactive Cursor Aura (Fine pointer only) -->
<div class="cursor-aura" id="aura"></div>
<div class="cursor-dot" id="dot"></div>

<!-- Navigation -->
<header class="sticky-nav" id="main-nav">
  <div class="container nav-inner">
    <div class="logo-area">
      {{#if logo_url}}
        <img src="{{logo_url}}" alt="{{business_name}}">
      {{else}}
        <h1>{{business_name}}</h1>
      {{/if}}
    </div>
    <nav class="nav-links">
      <a href="#about">Our Story</a>
      <a href="#experiences">Experiences</a>
      <a href="#practical">Practical Guide</a>
      <a class="cta-button magnet-target" href="{{booking_url}}">Book Now</a>
    </nav>
    <button class="hamburger" id="ham-toggle" aria-label="Toggle Navigation">
      <span></span>
      <span></span>
      <span></span>
    </button>
  </div>
</header>

<!-- Mobile Navigation Drawer -->
<div class="mobile-overlay" id="mobile-nav">
  <a href="#about" id="link-about">Our Story</a>
  <a href="#experiences" id="link-experiences">Experiences</a>
  <a href="#practical" id="link-practical">Practical Guide</a>
  <a class="cta-button" href="{{booking_url}}">Book Now</a>
</div>

<!-- Hero Section -->
<section class="hero">
  <div class="hero-media">
    {{#if hero_image}}
      <img src="{{hero_image}}" alt="{{business_name}}" style="animation: kenBurns 20s infinite alternate linear;" fetchpriority="high">
    {{else}}
      <svg viewBox="0 0 100 100" class="fallback-svg" style="width:100%;height:100%;">
        <rect width="100" height="100" fill="var(--bg)"/>
        <path d="\${maskPath}" fill="var(--ink)" opacity="0.15"/>
      </svg>
    {{/if}}
  </div>
  <div class="hero-overlay"></div>
  <div class="hero-noise"></div>
  <div class="hero-content container">
    <div class="hero-text reveal-fade-up active">
      <span class="mono-label" style="color:var(--bg); font-weight:700;">{{hero_eyebrow}}</span>
      <h2>{{#if hero_title}}{{hero_title}}{{else}}\${voice}{{/if}}</h2>
      <p style="color:var(--bg); opacity: 0.85;">{{hero_subtitle}}</p>
      <a class="cta-button magnet-target" href="{{booking_url}}">Explore Excursions</a>
    </div>

    <!-- V2 G3 Concierge Dock (Desktop Inline) -->
    <div class="concierge-dock g3" id="desktop-dock">
      <div class="dock-swell-header">
        <span class="mono-label" style="color:#fff; font-size:10px;">Concierge</span>
      </div>
      <div class="concierge-body">
        {{#if has_chat}}
          <div id="concierge-mount">
            <div class="shimmer-placeholder"></div>
          </div>
          <template id="concierge-embed">{{chat_embed}}</template>
        {{else}}
          <span class="mono-label">Navigation</span>
          <p style="font-size:0.95rem; margin:0.5rem 0 1.5rem 0; line-height:1.5;">\${voice}</p>
          <div class="concierge-suggestions">
            <a href="#about" class="mono-label" style="font-size:12px;">&rarr; Our Story</a>
            <a href="#experiences" class="mono-label" style="font-size:12px;">&rarr; View Experiences</a>
            <a href="#practical" class="mono-label" style="font-size:12px;">&rarr; Plan Your Trip</a>
          </div>
        {{/if}}
      </div>
    </div>
  </div>
</section>

<!-- Section Divider Seam -->
<div class="section-seam">
  \${dividerSvg}
</div>

<!-- Narrative Anti-Grid Section -->
<section class="narrative-section" id="about">
  <div class="container anti-grid">
    <div class="anti-grid-text reveal-fade-up">
      <span class="mono-label">Narrative</span>
      <h2 style="font-size: clamp(2rem, 4vw, 3rem); margin: 1rem 0;">A deliberate pace of outdoor adventure</h2>
      <p style="color: var(--text-muted); font-size: 1.05rem; margin-bottom: 1.5rem;">We believe the best experiences are measured by depth, not distance. Our guided outings offer an intentional redirection from the haste of the world. With expert guides and custom gear, we venture into wild spaces with restraint and curiosity.</p>
      <p style="color: var(--text-muted);">Every detail is mapped. You bring the curiosity, we handle the rest.</p>
    </div>
    <div class="anti-grid-image reveal-fade-up">
      <svg viewBox="0 0 100 100" class="fallback-svg" style="width:100%;height:100%;">
        <rect width="100" height="100" fill="var(--bg)"/>
        <path d="\${maskPath}" fill="var(--accent)" opacity="0.2"/>
      </svg>
    </div>
  </div>
</section>

<!-- Section Divider Seam -->
<div class="section-seam invert">
  \${dividerSvg}
</div>

<!-- Hover-Reveal Experiences List -->
{{#if has_tours}}
<section class="hover-reveal-section" id="experiences">
  <div class="container">
    <span class="mono-label" style="color: var(--bg); opacity: 0.6;">Curated Routes</span>
    <h2 style="font-size: clamp(2rem, 4vw, 3.2rem); margin: 1rem 0 3rem 0;">Select Your Excursion</h2>

    <ul class="hover-list">
      {{#each tours}}
      <li class="hover-item" data-image="{{image_url}}">
        <a href="{{../booking_url}}" class="hover-item-content">
          <span class="hover-item-title">{{name}}</span>
          <span class="hover-item-meta mono-label" style="color: inherit;">
            {{duration_minutes}} min &middot; max {{default_capacity}} &middot; from {{../currency}}{{base_price_per_person}}
          </span>
        </a>
      </li>
      {{/each}}
    </ul>
  </div>

  <!-- Float reveal mask -->
  <div class="reveal-mask-container" id="reveal-mask">
    <img src="" id="reveal-mask-img" alt="">
  </div>
</section>
{{/if}}

<!-- Section Divider Seam -->
<div class="section-seam">
  \${dividerSvg}
</div>

<!-- Practical Guide -->
<section class="narrative-section" id="practical">
  <div class="container">
    <span class="mono-label">Preparation</span>
    <h2 style="font-size: clamp(2rem, 4vw, 3rem); margin: 0.5rem 0 1rem 0;">Trip Guidelines</h2>
    <p style="color: var(--text-muted); max-width: 45rem;">Everything you need to know to ensure a comfortable and secure journey.</p>

    <div class="product-sheet g2">
      {{#if what_to_bring}}
      <div class="gear-section">
        <div class="gear-col">
          <span class="mono-label">What to bring</span>
          <p class="gear-copy" style="margin-top:0.5rem;">{{what_to_bring}}</p>
        </div>
      </div>
      {{/if}}
      {{#if what_to_wear}}
      <div class="gear-section">
        <div class="gear-col">
          <span class="mono-label">What to wear</span>
          <p class="gear-copy" style="margin-top:0.5rem;">{{what_to_wear}}</p>
        </div>
      </div>
      {{/if}}
      {{#if directions}}
      <div class="gear-section" style="border-bottom: none;">
        <div class="gear-col">
          <span class="mono-label">Directions</span>
          <p class="gear-copy" style="margin-top:0.5rem;">{{directions}}</p>
        </div>
      </div>
      {{/if}}
    </div>
    
    \${signatureMarkup}
  </div>
</section>

<!-- Reviews -->
{{#if has_reviews}}
<section class="reviews-section">
  <div class="container">
    <span class="mono-label">Testimonials</span>
    <h2 style="font-size: clamp(2rem, 4vw, 3rem); margin: 0.5rem 0 1rem 0;">From Our Guests</h2>
    <div class="reviews-grid">
      {{#each reviews}}
      <blockquote class="review-quote g2">
        <p>"{{quote}}"</p>
        <cite>{{author}}</cite>
      </blockquote>
      {{/each}}
    </div>
  </div>
</section>
{{/if}}

<!-- Persistent Booking Rail (Desktop/Tablet) -->
<div class="booking-rail g3">
  <div class="rail-price-info">
    <span class="mono-label">Instant Booking</span>
    <span class="rail-price" style="font-size:1.2rem; font-family:var(--font-sans); font-weight:500;">Secure your calendar slot</span>
  </div>
  <a class="cta-button magnet-target" href="{{booking_url}}">Secure My Spot</a>
</div>

<!-- Mobile Bottom Action Bar -->
<div class="mobile-action-bar g3">
  <a class="cta-button" href="{{booking_url}}">Book Now</a>
  {{#if has_chat}}
    <button class="cta-button" id="chat-bar-btn" style="background:var(--ink); border:1px solid rgba(255,255,255,0.15);">Chat</button>
  {{/if}}
</div>

<!-- Mobile Chat Bottom Sheet -->
<div class="mobile-sheet-overlay" id="sheet-overlay"></div>
<div class="mobile-sheet g3" id="chat-sheet">
  <button class="close-sheet-btn" id="close-sheet" aria-label="Close Chat">&times;</button>
  <div class="dock-swell-header">
    <span class="mono-label" style="color:#fff; font-size:10px;">Concierge</span>
  </div>
  <div class="concierge-body" style="padding:1.5rem 0;">
    <div id="concierge-mount-mobile">
      <div class="shimmer-placeholder"></div>
    </div>
  </div>
</div>

<!-- Footer -->
<footer>
  <div class="container">
    <h3 style="font-size: 2.2rem; margin-bottom: 1rem; font-family: var(--font-display); font-style: italic;">\${voice}</h3>
    <p style="opacity: 0.8; max-width: 32rem; margin: 0 auto 2rem auto; font-size: 0.95rem;">Join us for an unforgettable outing. Live availability is updated in real-time.</p>
    <a class="cta-button magnet-target" href="{{booking_url}}" style="margin-bottom: 3rem;">Launch Calendar</a>
    <p style="opacity: 0.6; font-size: 0.8rem; margin-top:2rem;">&copy; {{year}} {{business_name}} &middot; {{footer_line_one}}{{#if footer_line_two}} &middot; {{footer_line_two}}{{/if}} &middot; Powered by <a href="https://bookingtours.co.za" style="color: inherit; text-decoration: underline;">BookingTours</a></p>
  </div>
</footer>

<script>
// Scroll Reveal Observer
document.addEventListener("DOMContentLoaded", () => {
  const elements = document.querySelectorAll('.reveal-fade-up');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('active');
      }
    });
  }, { threshold: 0.1 });

  elements.forEach(el => observer.observe(el));
});

// Sticky Header on Scroll
window.addEventListener("scroll", () => {
  const header = document.getElementById("main-nav");
  if (header) {
    if (window.scrollY > 20) {
      header.classList.add("scrolled");
    } else {
      header.classList.remove("scrolled");
    }
  }
});

// Mobile Hamburger Toggle
const toggleBtn = document.getElementById('ham-toggle');
const mobNav = document.getElementById('mobile-nav');
const mobLinks = document.querySelectorAll('.mobile-overlay a');

if (toggleBtn && mobNav) {
  const toggleMenu = () => {
    const active = mobNav.classList.toggle('active');
    toggleBtn.classList.toggle('active');
    document.body.style.overflow = active ? 'hidden' : 'auto';
  };
  toggleBtn.addEventListener('click', toggleMenu);
  mobLinks.forEach(link => link.addEventListener('click', toggleMenu));
  
  // Close on ESC
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mobNav.classList.contains('active')) {
      toggleMenu();
    }
  });
}

// Niarra Hover-Mask Device
const hoverItems = document.querySelectorAll('.hover-item');
const mask = document.getElementById('reveal-mask');
const maskImg = document.getElementById('reveal-mask-img');

if (hoverItems.length > 0 && mask && maskImg) {
  hoverItems.forEach(item => {
    item.addEventListener('mouseenter', () => {
      const imgUrl = item.getAttribute('data-image');
      if (imgUrl) {
        maskImg.src = imgUrl;
        mask.classList.add('active');
      }
    });

    item.addEventListener('mouseleave', () => {
      mask.classList.remove('active');
    });

    item.addEventListener('mousemove', (e) => {
      mask.style.left = e.clientX + 'px';
      mask.style.top = e.clientY + 'px';
      // Image drift
      const rect = item.getBoundingClientRect();
      const xPercent = (e.clientX - rect.left) / rect.width;
      const yPercent = (e.clientY - rect.top) / rect.height;
      maskImg.style.transform = \`translate(\${(xPercent - 0.5) * 8}px, \${(yPercent - 0.5) * 8}px)\`;
    });
  });
}

// Cursor Aura (Fine pointers only)
const aura = document.getElementById('aura');
const dot = document.getElementById('dot');

if (aura && dot && window.matchMedia('(pointer: fine)').matches) {
  window.addEventListener('mousemove', (e) => {
    dot.style.left = e.clientX + 'px';
    dot.style.top = e.clientY + 'px';
    
    // Smooth trailing ring
    aura.animate({
      left: e.clientX + 'px',
      top: e.clientY + 'px'
    }, { duration: 150, fill: 'forwards' });
  });

  // Scale aura on hoverable elements
  document.querySelectorAll('a, button, .hover-item').forEach(el => {
    el.addEventListener('mouseenter', () => {
      aura.style.width = '40px';
      aura.style.height = '40px';
      aura.style.backgroundColor = 'color-mix(in srgb, var(--accent) 15%, transparent)';
    });
    el.addEventListener('mouseleave', () => {
      aura.style.width = '24px';
      aura.style.height = '24px';
      aura.style.backgroundColor = 'transparent';
    });
  });
} else {
  if (aura) aura.style.display = 'none';
  if (dot) dot.style.display = 'none';
}

// Magnetic Buttons
document.querySelectorAll('.magnet-target').forEach(btn => {
  if (window.matchMedia('(pointer: fine)').matches) {
    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      btn.style.transform = \`translate(\${x * 0.25}px, \${y * 0.25}px)\`;
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = '';
    });
  }
});

// Deferred Chat Widget Loader
const mountWidget = (mountId) => {
  const mount = document.getElementById(mountId);
  const temp = document.getElementById('concierge-embed');
  if (mount && temp && !mount.querySelector('.chat-loaded')) {
    mount.innerHTML = ''; // clear shimmer
    const clone = temp.content.cloneNode(true);
    const scripts = clone.querySelectorAll('script');
    
    // Create wrapper to tag it
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-loaded';
    
    scripts.forEach(s => {
      const newScript = document.createElement('script');
      Array.from(s.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
      newScript.textContent = s.textContent;
      s.parentNode.replaceChild(newScript, s);
    });
    wrapper.appendChild(clone);
    mount.appendChild(wrapper);
  }
};

window.addEventListener('load', () => {
  // Check if we have chat
  const temp = document.getElementById('concierge-embed');
  if (temp) {
    // Mount on desktop concierge
    if (window.innerWidth >= 1024) {
      setTimeout(() => mountWidget('concierge-mount'), 2000);
    }
  }
});

// Mobile Bottom Sheet Trigger
const chatBtn = document.getElementById('chat-bar-btn');
const sheet = document.getElementById('chat-sheet');
const sheetOverlay = document.getElementById('sheet-overlay');
const closeSheet = document.getElementById('close-sheet');

if (chatBtn && sheet && sheetOverlay && closeSheet) {
  const openSheet = () => {
    sheet.classList.add('active');
    sheetOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    mountWidget('concierge-mount-mobile');
  };
  const closeChat = () => {
    sheet.classList.remove('active');
    sheetOverlay.classList.remove('active');
    document.body.style.overflow = '';
  };
  chatBtn.addEventListener('click', openSheet);
  closeSheet.addEventListener('click', closeChat);
  sheetOverlay.addEventListener('click', closeChat);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sheet.classList.contains('active')) {
      closeChat();
    }
  });
}

\${signatureJs}
</script>

</body>
</html>
`;

function generate() {
  console.log("Generating 10 V2 Skin Pack templates...");

  for (const [key, pack] of Object.entries(SKIN_PACKS)) {
    let html = BASE_TEMPLATE;
    
    // Replace all skin-specific parameters
    html = html.replace(/\$\{fontLink\}/g, pack.fontLink);
    html = html.replace(/\$\{fontDisplay\}/g, pack.fontDisplay);
    html = html.replace(/\$\{fontSans\}/g, pack.fontSans);
    html = html.replace(/\$\{bg\}/g, pack.bg);
    html = html.replace(/\$\{ink\}/g, pack.ink);
    html = html.replace(/\$\{accent\}/g, pack.accent);
    html = html.replace(/\$\{surface\}/g, pack.surface);
    html = html.replace(/\$\{textMuted\}/g, pack.textMuted);
    html = html.replace(/\$\{borderAlpha\}/g, pack.borderAlpha);
    html = html.replace(/\$\{voice\}/g, pack.voice);
    html = html.replace(/\$\{dividerSvg\}/g, pack.dividerSvg);
    html = html.replace(/\$\{maskPath\}/g, pack.maskPath);
    html = html.replace(/\$\{signatureComment\}/g, pack.signatureComment);
    html = html.replace(/\$\{signatureMarkup\}/g, pack.signatureMarkup);
    html = html.replace(/\$\{signatureCss\}/g, pack.signatureCss);
    html = html.replace(/\$\{signatureJs\}/g, pack.signatureJs);

    const outPath = join(TEMPLATES_DIR, `${key}.html`);
    writeFileSync(outPath, html, "utf8");
    console.log(`  ✓ Generated ${key}.html`);
  }

  console.log("\nAll V2 templates generated successfully!");
}

generate();
