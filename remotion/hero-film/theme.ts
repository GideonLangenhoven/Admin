/**
 * Booking·Tours Brand Tokens & Motion Constants
 * Sourced directly from docs/BRAND.md and tailwind.config.js
 */

export const colors = {
  // Pine Scale - Core Brand Foundation
  pine: {
    50: "#F1F7F3",
    100: "#DEEDE4",
    200: "#BFDCCB",
    300: "#94C2A9",
    400: "#5FA081",
    500: "#33805F",
    600: "#125E40",
    700: "#0E4831",
    800: "#103B2A",
    900: "#123528",
    950: "#0F2B1F",
  },
  // Mint Scale - Vibrant Active Accents
  mint: {
    200: "#A9F5D6",
    300: "#7FEEC4",
    400: "#33E4A4",
    500: "#00D98B",
    600: "#00B876",
    wash: "#D8F0E4",
  },
  // Sunset / Amber - Scarcity & Highlights
  amber: {
    default: "#D9822F",
    deep: "#B4641C",
    wash: "#F7E8D8",
  },
  // Warm Paper & Canvas
  paper: "#F7F5F0",
  cream: "#F4F1E8",
  sand: "#E7E2D4",
  ink: "#17221C",
  white: "#FFFFFF",

  // Functional & Semantic Colors
  text: {
    primary: "#17221C",
    secondary: "#4B5563",
    muted: "#6B7280",
    light: "#9CA3AF",
    white: "#FFFFFF",
  },
  borders: {
    subtle: "rgba(15, 43, 31, 0.08)",
    medium: "rgba(15, 43, 31, 0.14)",
    strong: "#E7E2D4",
    dark: "rgba(255, 255, 255, 0.1)",
  },
  status: {
    paidBg: "#ECFDF5",
    paidText: "#047857",
    paidBorder: "#A7F3D0",
    fullBg: "#FEF3C7",
    fullText: "#B45309",
    fullBorder: "#FDE68A",
  },
  whatsapp: {
    green: "#25D366",
    darkGreen: "#128C7E",
    bubbleOut: "#D9FDD3",
    bubbleIn: "#FFFFFF",
  },
  yoco: {
    blue: "#0B1E36",
    cyan: "#00BCD4",
  },
};

export const typography = {
  display: '"Fraunces", "Satoshi", "Plus Jakarta Sans", Georgia, serif',
  sans: '"Plus Jakarta Sans", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: '"Geist Mono", "SF Mono", ui-monospace, Menlo, monospace',
};

export const shadows = {
  window: "0 32px 80px -20px rgba(15, 43, 31, 0.22), 0 12px 28px -8px rgba(15, 43, 31, 0.12)",
  card: "inset 0 1px 0 rgba(255, 255, 255, 0.7), 0 1px 3px rgba(15, 43, 31, 0.04), 0 8px 24px -12px rgba(15, 43, 31, 0.08)",
  float: "0 20px 48px -12px rgba(15, 43, 31, 0.25), 0 4px 12px -2px rgba(15, 43, 31, 0.08)",
  button: "0 2px 6px rgba(18, 94, 64, 0.25)",
};
