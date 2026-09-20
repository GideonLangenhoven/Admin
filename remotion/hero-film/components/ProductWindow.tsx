import React from "react";
import { colors, shadows, typography } from "../theme";

interface ProductWindowProps {
  children: React.ReactNode;
  width?: number;
  height?: number;
  scale?: number;
  opacity?: number;
  translateX?: number;
  translateY?: number;
}

export const ProductWindow: React.FC<ProductWindowProps> = ({
  children,
  width = 1440,
  height = 860,
  scale = 1,
  opacity = 1,
  translateX = 0,
  translateY = 0,
}) => {
  return (
    <div
      style={{
        transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
        opacity,
        transformOrigin: "center center",
        transition: "none",
      }}
    >
      <div
        style={{
          width,
          height,
          borderRadius: 20,
          background: colors.white,
          border: `1px solid ${colors.borders.subtle}`,
          boxShadow: shadows.window,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        {/* Subtle Top Window Chrome Bar */}
        <div
          style={{
            height: 38,
            background: colors.pine[950],
            borderBottom: `1px solid ${colors.borders.dark}`,
            display: "flex",
            alignItems: "center",
            padding: "0 18px",
            justifyContent: "space-between",
            userSelect: "none",
          }}
        >
          {/* macOS window traffic dots */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#FF5F56",
                opacity: 0.85,
              }}
            />
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#FFBD2E",
                opacity: 0.85,
              }}
            />
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#27C93F",
                opacity: 0.85,
              }}
            />
          </div>

          {/* Window Title Header */}
          <div
            style={{
              fontSize: 12,
              fontFamily: typography.sans,
              fontWeight: 500,
              letterSpacing: "0.04em",
              color: "rgba(255, 255, 255, 0.45)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ color: colors.mint[400] }}>●</span>
            <span>booking.bookingtours.co.za/admin</span>
          </div>

          <div style={{ width: 44 }} />
        </div>

        {/* Inner App Canvas */}
        <div
          style={{
            flex: 1,
            position: "relative",
            background: colors.paper,
            overflow: "hidden",
            display: "flex",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
};
