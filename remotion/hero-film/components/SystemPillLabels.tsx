import React from "react";
import { colors, typography } from "../theme";

interface SystemPillLabelsProps {
  opacity: number;
  activeStep: number; // 0 = none, 1 = whatsapp, 2 = bookings, 3 = payments, 4 = operations
}

export const SystemPillLabels: React.FC<SystemPillLabelsProps> = ({
  opacity,
  activeStep,
}) => {
  if (opacity <= 0) return null;

  const labels = [
    { key: "whatsapp", title: "WhatsApp" },
    { key: "bookings", title: "Bookings" },
    { key: "payments", title: "Payments" },
    { key: "operations", title: "Operations" },
  ];

  return (
    <div
      style={{
        position: "absolute",
        bottom: 40,
        left: "50%",
        transform: "translateX(-50%)",
        opacity,
        display: "flex",
        alignItems: "center",
        gap: 16,
        zIndex: 90,
      }}
    >
      {labels.map((item, index) => {
        const isActive = activeStep > index;
        const isCurrent = activeStep === index + 1;

        return (
          <React.Fragment key={item.key}>
            <div
              style={{
                background: isActive ? colors.pine[900] : "rgba(255, 255, 255, 0.8)",
                border: `1px solid ${
                  isActive ? colors.mint[400] : colors.borders.subtle
                }`,
                padding: "8px 18px",
                borderRadius: 24,
                boxShadow: isCurrent
                  ? "0 4px 14px rgba(0, 217, 139, 0.35)"
                  : "0 2px 6px rgba(0,0,0,0.04)",
                display: "flex",
                alignItems: "center",
                gap: 8,
                transition: "none",
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: isActive ? colors.mint[400] : colors.text.light,
                }}
              />
              <span
                style={{
                  fontFamily: typography.mono,
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: isActive ? colors.white : colors.text.muted,
                }}
              >
                {item.title}
              </span>
            </div>

            {index < labels.length - 1 && (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M4 2L8 6L4 10"
                  stroke={activeStep > index ? colors.pine[600] : "#CBD5E1"}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};
