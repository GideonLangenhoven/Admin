import React from "react";
import { colors, shadows, typography } from "../theme";

interface PaymentConfirmedProps {
  opacity: number;
  scale: number;
  checkScale?: number;
}

export const PaymentConfirmed: React.FC<PaymentConfirmedProps> = ({
  opacity,
  scale,
  checkScale = 1,
}) => {
  if (opacity <= 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        right: 48,
        bottom: 70,
        zIndex: 70,
        opacity,
        transform: `scale(${scale})`,
        transformOrigin: "center center",
        width: 380,
        borderRadius: 20,
        background: colors.white,
        border: `1px solid ${colors.borders.subtle}`,
        boxShadow: shadows.float,
        padding: "26px 28px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
      }}
    >
      {/* Calm Circular Emerald Indicator */}
      <div
        style={{
          width: 54,
          height: 54,
          borderRadius: "50%",
          background: colors.status.paidBg,
          border: `1px solid ${colors.status.paidBorder}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 16,
          transform: `scale(${checkScale})`,
        }}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
          <path
            d="M5 13L9.5 17.5L19 7"
            stroke={colors.status.paidText}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {/* Eyebrow Label */}
      <div
        style={{
          fontFamily: typography.mono,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: colors.status.paidText,
          marginBottom: 8,
        }}
      >
        Payment Received
      </div>

      {/* Large Bold Amount */}
      <div
        style={{
          fontFamily: typography.display,
          fontSize: 40,
          fontWeight: 800,
          color: colors.ink,
          lineHeight: 1,
          marginBottom: 12,
          letterSpacing: "-0.03em",
        }}
      >
        R900
      </div>

      {/* Booking Details */}
      <div
        style={{
          fontFamily: typography.sans,
          fontSize: 14,
          fontWeight: 600,
          color: colors.ink,
          marginBottom: 4,
        }}
      >
        Thandi Mokoena
      </div>

      <div
        style={{
          fontFamily: typography.sans,
          fontSize: 13,
          color: colors.text.muted,
          marginBottom: 18,
        }}
      >
        2 guests · Saturday 08:00 Ocean Kayak
      </div>

      {/* Verified Status Pill */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: colors.pine[50],
          padding: "6px 14px",
          borderRadius: 20,
          border: `1px solid ${colors.pine[200]}`,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: colors.pine[600],
          }}
        />
        <span
          style={{
            fontFamily: typography.mono,
            fontSize: 11,
            fontWeight: 600,
            color: colors.pine[800],
            letterSpacing: "0.02em",
          }}
        >
          YOCO #BK-8492 · REVENUE SYNCED
        </span>
      </div>
    </div>
  );
};
