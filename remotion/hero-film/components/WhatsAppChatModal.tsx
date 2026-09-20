import React from "react";
import { colors, shadows, typography } from "../theme";
import { BookingCard } from "./BookingCard";
import { BRAND_MARK_IVORY } from "../assets";

interface WhatsAppChatModalProps {
  opacity: number;
  scale: number;
  translateX?: number;
  translateY?: number;
  msg1Opacity: number;
  msg2Opacity: number;
  msg3Opacity: number;
  bookingCardOpacity: number;
  buttonPressed?: boolean;
  buttonLoading?: boolean;
}

export const WhatsAppChatModal: React.FC<WhatsAppChatModalProps> = ({
  opacity,
  scale,
  translateX = 0,
  translateY = 0,
  msg1Opacity,
  msg2Opacity,
  msg3Opacity,
  bookingCardOpacity,
  buttonPressed = false,
  buttonLoading = false,
}) => {
  if (opacity <= 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        right: 48,
        bottom: 36,
        zIndex: 60,
        opacity,
        transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
        transformOrigin: "bottom right",
        width: 420,
        borderRadius: 20,
        background: "#EFEAE2", // Authentic WhatsApp chat background tint
        border: `1px solid ${colors.borders.medium}`,
        boxShadow: shadows.float,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* WhatsApp Header */}
      <div
        style={{
          background: colors.whatsapp.darkGreen,
          padding: "12px 18px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          color: colors.white,
        }}
      >
        {/* Avatar */}
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            background: colors.pine[700],
            border: "2px solid rgba(255,255,255,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 14,
            fontFamily: typography.sans,
            color: colors.white,
          }}
        >
          TM
        </div>

        {/* Customer Details & AI Indicator */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: typography.sans,
              fontSize: 15,
              fontWeight: 600,
              lineHeight: 1.2,
            }}
          >
            Thandi Mokoena
          </div>
          <div
            style={{
              fontFamily: typography.sans,
              fontSize: 11,
              opacity: 0.85,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#25D366",
              }}
            />
            <span>Booking·Tours AI Assistant</span>
          </div>
        </div>

        {/* Brand Monogram Accent */}
        <img
          src={BRAND_MARK_IVORY}
          alt=""
          style={{ width: 22, height: 22, opacity: 0.85, objectFit: "contain" }}
        />
      </div>

      {/* Messages Stream */}
      <div
        style={{
          padding: "16px 16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          backgroundImage:
            "radial-gradient(circle at 10px 10px, rgba(0,0,0,0.03) 2px, transparent 0)",
          backgroundSize: "24px 24px",
        }}
      >
        {/* Msg 1: Customer Incoming */}
        {msg1Opacity > 0 && (
          <div
            style={{
              alignSelf: "flex-start",
              background: colors.whatsapp.bubbleIn,
              padding: "10px 14px",
              borderRadius: "14px 14px 14px 2px",
              boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
              maxWidth: "82%",
              opacity: msg1Opacity,
              transform: `translateY(${(1 - msg1Opacity) * 8}px)`,
            }}
          >
            <div
              style={{
                fontFamily: typography.sans,
                fontSize: 13.5,
                color: colors.ink,
                lineHeight: 1.4,
              }}
            >
              Can I book for 2 tomorrow morning?
            </div>
            <div
              style={{
                fontFamily: typography.mono,
                fontSize: 10,
                color: colors.text.light,
                textAlign: "right",
                marginTop: 3,
              }}
            >
              08:01
            </div>
          </div>
        )}

        {/* Msg 2: AI Response */}
        {msg2Opacity > 0 && (
          <div
            style={{
              alignSelf: "flex-end",
              background: colors.whatsapp.bubbleOut,
              padding: "10px 14px",
              borderRadius: "14px 14px 2px 14px",
              boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
              maxWidth: "85%",
              opacity: msg2Opacity,
              transform: `translateY(${(1 - msg2Opacity) * 8}px)`,
            }}
          >
            <div
              style={{
                fontFamily: typography.sans,
                fontSize: 13.5,
                color: colors.ink,
                lineHeight: 1.4,
              }}
            >
              Absolutely. The 08:00 Ocean Kayak has 2 spaces available.
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                gap: 4,
                marginTop: 3,
              }}
            >
              <span
                style={{
                  fontFamily: typography.mono,
                  fontSize: 10,
                  color: colors.pine[700],
                }}
              >
                08:01
              </span>
              <svg width="14" height="10" viewBox="0 0 16 11" fill="none">
                <path
                  d="M11 1L5.5 7L3 4.5M15 1L9.5 7M6 10L1 5"
                  stroke="#128C7E"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>
        )}

        {/* Msg 3: Customer "Perfect." */}
        {msg3Opacity > 0 && (
          <div
            style={{
              alignSelf: "flex-start",
              background: colors.whatsapp.bubbleIn,
              padding: "8px 14px",
              borderRadius: "14px 14px 14px 2px",
              boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
              opacity: msg3Opacity,
              transform: `translateY(${(1 - msg3Opacity) * 8}px)`,
            }}
          >
            <div
              style={{
                fontFamily: typography.sans,
                fontSize: 13.5,
                color: colors.ink,
              }}
            >
              Perfect.
            </div>
          </div>
        )}

        {/* Booking Card from AI */}
        {bookingCardOpacity > 0 && (
          <div style={{ alignSelf: "flex-end" }}>
            <BookingCard
              opacity={bookingCardOpacity}
              scale={1}
              buttonPressed={buttonPressed}
              buttonLoading={buttonLoading}
            />
          </div>
        )}
      </div>
    </div>
  );
};
