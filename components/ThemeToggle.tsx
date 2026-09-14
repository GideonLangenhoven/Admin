"use client";

import { useTheme } from "./ThemeProvider";
import { MoonStars, Sun } from "@phosphor-icons/react";

export default function ThemeToggle({ size = "md" }: { size?: "sm" | "md" }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  const w = size === "sm" ? 40 : 48;
  const h = size === "sm" ? 22 : 26;
  const dot = h - 6;
  const icon = size === "sm" ? 11 : 13;

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="relative shrink-0 rounded-full border transition-colors duration-300"
      style={{
        width: w,
        height: h,
        background: isDark ? "linear-gradient(135deg, #0F2B1F 0%, #123528 100%)" : "#EBE7DE",
        borderColor: isDark ? "rgba(0, 217, 139, 0.35)" : "var(--ck-border-strong)",
      }}
    >
      <span
        className="absolute top-1/2 flex items-center justify-center rounded-full transition-transform duration-300"
        style={{
          width: dot,
          height: dot,
          left: 2,
          transform: `translateY(-50%) translateX(${isDark ? w - dot - 6 : 0}px)`,
          background: isDark ? "#00D98B" : "#FFFFFF",
          boxShadow: "0 1px 3px rgba(15, 43, 31, 0.25)",
          transitionTimingFunction: "var(--ck-ease)",
        }}
      >
        {isDark
          ? <MoonStars size={icon} weight="fill" color="#06130C" />
          : <Sun size={icon} weight="fill" color="#B4641C" />}
      </span>
    </button>
  );
}
