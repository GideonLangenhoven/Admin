import React from "react";
import { colors, typography } from "../theme";
import { BRAND_MARK_PINE } from "../assets";

interface HeadlineRevealProps {
  opacity: number;
  line1Progress: number; // 0 to 1
  line2Progress: number; // 0 to 1
  logoProgress: number;  // 0 to 1
}

export const HeadlineReveal: React.FC<HeadlineRevealProps> = ({
  opacity,
  line1Progress,
  line2Progress,
  logoProgress,
}) => {
  if (opacity <= 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        opacity,
        pointerEvents: "none",
        background: "rgba(247, 245, 240, 0.75)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 6,
        }}
      >
        {/* Line 1 */}
        <div style={{ overflow: "hidden" }}>
          <div
            style={{
              fontFamily: typography.display,
              fontSize: 64,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
              color: colors.ink,
              transform: `translateY(${(1 - line1Progress) * 40}px)`,
              opacity: line1Progress,
            }}
          >
            ONE BOOKING.
          </div>
        </div>

        {/* Line 2 */}
        <div style={{ overflow: "hidden" }}>
          <div
            style={{
              fontFamily: typography.display,
              fontSize: 64,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
              color: colors.pine[600],
              transform: `translateY(${(1 - line2Progress) * 40}px)`,
              opacity: line2Progress,
            }}
          >
            EVERYTHING UPDATED.
          </div>
        </div>

        {/* Brand Lockup */}
        <div
          style={{
            marginTop: 28,
            display: "flex",
            alignItems: "center",
            gap: 12,
            opacity: logoProgress,
            transform: `translateY(${(1 - logoProgress) * 16}px)`,
          }}
        >
          <img
            src={BRAND_MARK_PINE}
            alt="BookingTours"
            style={{ width: 34, height: 34, objectFit: "contain" }}
          />
          <span
            style={{
              fontFamily: typography.display,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: colors.ink,
            }}
          >
            Booking·Tours
          </span>
          <span
            style={{
              color: colors.borders.strong,
              fontSize: 16,
              margin: "0 2px",
            }}
          >
            |
          </span>
          <span
            style={{
              fontFamily: typography.sans,
              fontSize: 14,
              fontWeight: 500,
              color: colors.text.muted,
              letterSpacing: "0.02em",
            }}
          >
            The Operating System for Adventure Tours
          </span>
        </div>
      </div>
    </div>
  );
};
