import React from "react";
import { colors, shadows, typography } from "../theme";

interface WhatsAppNotificationProps {
  opacity: number;
  translateY: number;
  scale?: number;
}

export const WhatsAppNotification: React.FC<WhatsAppNotificationProps> = ({
  opacity,
  translateY,
  scale = 1,
}) => {
  if (opacity <= 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 24,
        right: 32,
        zIndex: 50,
        opacity,
        transform: `translateY(${translateY}px) scale(${scale})`,
        transformOrigin: "top right",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          width: 380,
          background: "rgba(255, 255, 255, 0.96)",
          backdropFilter: "blur(16px)",
          borderRadius: 16,
          padding: "14px 18px",
          border: "1px solid rgba(15, 43, 31, 0.08)",
          boxShadow: shadows.float,
          display: "flex",
          gap: 14,
          alignItems: "flex-start",
        }}
      >
        {/* WhatsApp Icon Pill */}
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 12,
            background: colors.whatsapp.green,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            boxShadow: "0 4px 10px rgba(37, 211, 102, 0.3)",
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.9C17.18 3.03 14.69 2 12.04 2ZM12.04 20.15C10.56 20.15 9.11 19.75 7.85 19L7.55 18.82L4.43 19.64L5.26 16.6L5.06 16.29C4.24 14.98 3.8 13.46 3.8 11.91C3.8 7.37 7.5 3.67 12.05 3.67C14.25 3.67 16.32 4.53 17.87 6.08C19.42 7.63 20.28 9.7 20.27 11.91C20.27 16.46 16.58 20.15 12.04 20.15Z"
              fill="white"
            />
            <path
              d="M16.57 14.18C16.32 14.05 15.1 13.45 14.88 13.37C14.65 13.29 14.49 13.25 14.32 13.5C14.16 13.75 13.69 14.3 13.54 14.47C13.4 14.63 13.25 14.66 13 14.53C12.75 14.41 11.95 14.14 11 13.3C10.26 12.64 9.76 11.83 9.61 11.58C9.47 11.33 9.6 11.2 9.72 11.07C9.83 10.96 9.97 10.78 10.1 10.63C10.23 10.48 10.27 10.37 10.35 10.21C10.43 10.04 10.39 9.9 10.33 9.77C10.27 9.65 9.78 8.44 9.57 7.94C9.37 7.46 9.17 7.52 9.02 7.51C8.88 7.5 8.71 7.5 8.55 7.5C8.38 7.5 8.11 7.56 7.88 7.81C7.65 8.06 7 8.67 7 9.9C7 11.13 7.9 12.32 8.02 12.48C8.15 12.65 9.78 15.16 12.28 16.24C12.87 16.5 13.33 16.65 13.69 16.77C14.29 16.96 14.83 16.93 15.26 16.87C15.74 16.8 16.74 16.26 16.95 15.68C17.15 15.09 17.15 14.6 17.09 14.49C17.03 14.39 16.82 14.31 16.57 14.18Z"
              fill="white"
            />
          </svg>
        </div>

        {/* Notification Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 4,
            }}
          >
            <span
              style={{
                fontFamily: typography.sans,
                fontSize: 14,
                fontWeight: 600,
                color: colors.ink,
              }}
            >
              Thandi Mokoena
            </span>
            <span
              style={{
                fontFamily: typography.mono,
                fontSize: 11,
                color: colors.text.light,
              }}
            >
              just now
            </span>
          </div>

          <div
            style={{
              fontFamily: typography.sans,
              fontSize: 13,
              color: colors.text.secondary,
              lineHeight: 1.4,
            }}
          >
            “Can I book for 2 tomorrow morning?”
          </div>
        </div>
      </div>
    </div>
  );
};
