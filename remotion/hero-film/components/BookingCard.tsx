import React from "react";
import { colors, shadows, typography } from "../theme";

interface BookingCardProps {
  opacity?: number;
  scale?: number;
  buttonPressed?: boolean;
  buttonLoading?: boolean;
}

export const BookingCard: React.FC<BookingCardProps> = ({
  opacity = 1,
  scale = 1,
  buttonPressed = false,
  buttonLoading = false,
}) => {
  if (opacity <= 0) return null;

  return (
    <div
      style={{
        opacity,
        transform: `scale(${scale})`,
        transformOrigin: "bottom left",
        background: colors.white,
        borderRadius: 14,
        padding: "16px 18px",
        border: `1px solid ${colors.borders.subtle}`,
        boxShadow: "0 8px 24px -6px rgba(15, 43, 31, 0.12)",
        width: 330,
        marginTop: 6,
        marginBottom: 4,
      }}
    >
      {/* Header Tag */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontFamily: typography.sans,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: colors.pine[600],
            background: colors.pine[50],
            padding: "3px 8px",
            borderRadius: 6,
          }}
        >
          Instant Hold
        </span>
        <span
          style={{
            fontFamily: typography.mono,
            fontSize: 11,
            color: colors.text.light,
          }}
        >
          08:00
        </span>
      </div>

      {/* Tour Name & Details */}
      <div
        style={{
          fontFamily: typography.sans,
          fontSize: 16,
          fontWeight: 700,
          color: colors.ink,
          marginBottom: 4,
        }}
      >
        Ocean Kayak
      </div>

      <div
        style={{
          fontFamily: typography.sans,
          fontSize: 13,
          color: colors.text.secondary,
          marginBottom: 12,
          display: "flex",
          gap: 12,
        }}
      >
        <span>Saturday · 08:00</span>
        <span>•</span>
        <span>2 guests</span>
      </div>

      {/* Price Row */}
      <div
        style={{
          borderTop: `1px solid ${colors.borders.subtle}`,
          paddingTop: 10,
          marginBottom: 14,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <span
          style={{
            fontFamily: typography.sans,
            fontSize: 12,
            color: colors.text.muted,
          }}
        >
          Total (ZAR)
        </span>
        <span
          style={{
            fontFamily: typography.display,
            fontSize: 18,
            fontWeight: 700,
            color: colors.ink,
          }}
        >
          R900
        </span>
      </div>

      {/* Pay with Yoco Button */}
      <div
        id="yoco-pay-button"
        style={{
          background: buttonLoading ? colors.pine[700] : colors.yoco.blue,
          color: colors.white,
          borderRadius: 10,
          padding: "11px 14px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          boxShadow: buttonPressed
            ? "none"
            : "0 4px 12px rgba(11, 30, 54, 0.25)",
          transform: `scale(${buttonPressed ? 0.96 : 1})`,
          transformOrigin: "center center",
          cursor: "pointer",
          transition: "none",
        }}
      >
        {buttonLoading ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                border: "2px solid rgba(255,255,255,0.3)",
                borderTopColor: colors.white,
              }}
            />
            <span
              style={{
                fontFamily: typography.sans,
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: "0.02em",
              }}
            >
              Authorizing…
            </span>
          </div>
        ) : (
          <>
            {/* Yoco icon mark */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <rect width="24" height="24" rx="5" fill="#00BCD4" />
              <path
                d="M7 12L10.5 15.5L17 8.5"
                stroke="#0B1E36"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span
              style={{
                fontFamily: typography.sans,
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              Pay with Yoco
            </span>
          </>
        )}
      </div>
    </div>
  );
};
