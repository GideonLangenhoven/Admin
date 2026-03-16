"use client";

import { useTheme } from "./ThemeProvider";

export default function ThemeToggle({ size = "md" }: { size?: "sm" | "md" }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  const w = size === "sm" ? 36 : 44;
  const h = size === "sm" ? 20 : 24;
  const dot = size === "sm" ? 14 : 18;
  const pad = size === "sm" ? 3 : 3;

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="relative shrink-0 rounded-full transition-all duration-300 ease-in-out"
      style={{
        width: w,
        height: h,
        background: isDark
          ? "linear-gradient(135deg, #00d98b 0%, #5ba3d9 100%)"
          : "linear-gradient(135deg, #d1d5db 0%, #9ca3af 100%)",
      }}
    >
      <span
        className="absolute top-1/2 block rounded-full bg-white shadow-sm transition-all duration-300 ease-in-out"
        style={{
          width: dot,
          height: dot,
          transform: `translateY(-50%) translateX(${isDark ? w - dot - pad : pad}px)`,
        }}
      />
    </button>
  );
}
