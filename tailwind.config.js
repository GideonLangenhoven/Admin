/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // BookingTours evolved brand — pine anchor, warm paper canvas,
        // ocean/fjord support hues for data viz, sunset amber highlights.
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
        mint: {
          200: "#A9F5D6",
          300: "#7FEEC4",
          400: "#33E4A4",
          500: "#00D98B",
          600: "#00B876",
        },
        ocean: {
          50: "#EEF6F7",
          100: "#D8EBEE",
          300: "#7FBFC9",
          500: "#1E8496",
          600: "#0F6773",
          700: "#0C525C",
        },
        fjord: {
          100: "#DCE9F2",
          300: "#93B8D3",
          500: "#3E7CA6",
          600: "#316487",
        },
        sunset: {
          DEFAULT: "#D9822F",
          deep: "#B4641C",
          wash: "#F7E8D8",
        },
        paper: "#F7F5F0",
        cream: "#F4F1E8",
        sand: "#E7E2D4",
        ink: "#17221C",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "-apple-system", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        card: "inset 0 1px 0 rgba(255,255,255,0.65), 0 1px 2px rgba(15,43,31,0.05), 0 10px 28px -14px rgba(15,43,31,0.12)",
        "card-hover": "inset 0 1px 0 rgba(255,255,255,0.65), 0 2px 4px rgba(15,43,31,0.06), 0 20px 44px -16px rgba(15,43,31,0.18)",
        hero: "0 28px 64px -24px rgba(15,43,31,0.45), 0 4px 12px -4px rgba(15,43,31,0.20)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 420ms cubic-bezier(0.2, 0.7, 0.2, 1) both",
      },
    },
  },
  plugins: [],
}
