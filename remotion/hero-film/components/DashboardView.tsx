import React from "react";
import { colors, shadows, typography } from "../theme";
import { MetricCounter } from "./MetricCounter";
import { BRAND_MARK_IVORY } from "../assets";

export interface DashboardState {
  todayPax: number;
  revenue: number;
  capacityText: string;
  isFull: boolean;
  manifestPax: number;
  showThandiInRollCall: boolean;
  inboxCount: number;
  capacityPercent: number;
}

interface DashboardViewProps {
  state: DashboardState;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ state }) => {
  const {
    todayPax,
    revenue,
    capacityText,
    isFull,
    manifestPax,
    showThandiInRollCall,
    inboxCount,
    capacityPercent,
  } = state;

  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        fontFamily: typography.sans,
      }}
    >
      {/* 1. Left Sidebar Navigation */}
      <div
        style={{
          width: 220,
          background: colors.pine[950],
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          borderRight: `1px solid ${colors.borders.dark}`,
          flexShrink: 0,
        }}
      >
        <div>
          {/* Tenant Brand Selector */}
          <div
            style={{
              padding: "16px 14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "rgba(255,255,255,0.08)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M2 12C2 12 5 9 12 9C19 9 22 12 22 12C22 12 19 15 12 15C5 15 2 12 2 12Z"
                    stroke="#A9F5D6"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                  <circle cx="12" cy="12" r="2" fill="#A9F5D6" />
                </svg>
              </div>
              <span
                style={{
                  color: colors.white,
                  fontWeight: 600,
                  fontSize: 15,
                  letterSpacing: "-0.01em",
                }}
              >
                Kayak
              </span>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 9L12 15L18 9"
                stroke="rgba(255,255,255,0.4)"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>

          {/* Active Nav: Dashboard */}
          <div style={{ padding: "0 10px", marginTop: 4 }}>
            <div
              style={{
                position: "relative",
                background: colors.pine[900],
                borderRadius: 8,
                padding: "8px 12px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                color: colors.white,
                fontWeight: 600,
                fontSize: 13.5,
              }}
            >
              {/* Sunset orange accent pill on active item */}
              <div
                style={{
                  position: "absolute",
                  left: -10,
                  top: 4,
                  bottom: 4,
                  width: 3,
                  borderRadius: 2,
                  background: "#F97316",
                }}
              />
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <rect
                  x="3"
                  y="3"
                  width="7"
                  height="7"
                  rx="1"
                  stroke="#A9F5D6"
                  strokeWidth="2"
                />
                <rect
                  x="14"
                  y="3"
                  width="7"
                  height="7"
                  rx="1"
                  stroke="#A9F5D6"
                  strokeWidth="2"
                />
                <rect
                  x="14"
                  y="14"
                  width="7"
                  height="7"
                  rx="1"
                  stroke="#A9F5D6"
                  strokeWidth="2"
                />
                <rect
                  x="3"
                  y="14"
                  width="7"
                  height="7"
                  rx="1"
                  stroke="#A9F5D6"
                  strokeWidth="2"
                />
              </svg>
              <span>Dashboard</span>
            </div>
          </div>

          {/* Navigation Group: Operations */}
          <div style={{ padding: "16px 14px 6px" }}>
            <div
              style={{
                fontFamily: typography.mono,
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.35)",
                marginBottom: 8,
              }}
            >
              Operations
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                color: "rgba(255,255,255,0.7)",
                fontSize: 13,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 8px",
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  />
                </svg>
                <span>Bookings</span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 8px",
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <rect
                    x="3"
                    y="4"
                    width="18"
                    height="18"
                    rx="2"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  />
                  <line
                    x1="16"
                    y1="2"
                    x2="16"
                    y2="6"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  />
                  <line
                    x1="8"
                    y1="2"
                    x2="8"
                    y2="6"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  />
                  <line
                    x1="3"
                    y1="10"
                    x2="21"
                    y2="10"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  />
                </svg>
                <span>Slots</span>
              </div>
            </div>
          </div>

          {/* Navigation Group: Customers */}
          <div style={{ padding: "8px 14px 6px" }}>
            <div
              style={{
                fontFamily: typography.mono,
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.35)",
                marginBottom: 8,
              }}
            >
              Customers
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                color: "rgba(255,255,255,0.7)",
                fontSize: 13,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "6px 8px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    />
                  </svg>
                  <span>Inbox</span>
                </div>
                {inboxCount > 0 && (
                  <span
                    style={{
                      background: colors.whatsapp.green,
                      color: colors.pine[950],
                      fontSize: 10,
                      fontWeight: 800,
                      padding: "1px 6px",
                      borderRadius: 10,
                    }}
                  >
                    {inboxCount}
                  </span>
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "6px 8px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    />
                  </svg>
                  <span>Refunds</span>
                </div>
                <span
                  style={{
                    background: "#EF4444",
                    color: colors.white,
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "1px 6px",
                    borderRadius: 10,
                  }}
                >
                  9
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Platform Provenance */}
        <div
          style={{
            padding: "14px 16px",
            borderTop: `1px solid ${colors.borders.dark}`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <img
            src={BRAND_MARK_IVORY}
            alt="BookingTours"
            style={{ width: 22, height: 22, objectFit: "contain" }}
          />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span
              style={{
                fontSize: 9.5,
                fontFamily: typography.mono,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.4)",
              }}
            >
              POWERED BY
            </span>
            <span
              style={{
                fontSize: 13,
                fontFamily: typography.display,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                color: colors.white,
              }}
            >
              Booking·Tours
            </span>
          </div>
        </div>
      </div>

      {/* 2. Main Dashboard Workspace */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Top Header Bar */}
        <div
          style={{
            height: 48,
            padding: "0 28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: `1px solid ${colors.borders.subtle}`,
            background: colors.white,
          }}
        >
          {/* Breadcrumbs */}
          <div
            style={{
              fontFamily: typography.mono,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: colors.text.muted,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span>KAYAK</span>
            <span>/</span>
            <span style={{ color: colors.ink }}>DASHBOARD</span>
          </div>

          {/* Right Session Indicators */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                fontFamily: typography.sans,
                fontSize: 12,
                color: colors.text.secondary,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span style={{ color: colors.mint[600] }}>•</span>
              <span>Sat · 19 Sept, 08:00</span>
            </div>
            <div
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: `1px solid ${colors.borders.strong}`,
                fontSize: 11.5,
                fontWeight: 500,
                color: colors.text.muted,
              }}
            >
              Sign Out
            </div>
          </div>
        </div>

        {/* Scrollable Dashboard Body */}
        <div
          style={{
            flex: 1,
            padding: "24px 28px",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          {/* Title Row */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: typography.mono,
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: colors.text.light,
                  marginBottom: 2,
                }}
              >
                SATURDAY, 19 SEPTEMBER
              </div>
              <h1
                style={{
                  fontFamily: typography.display,
                  fontSize: 28,
                  fontWeight: 800,
                  color: colors.ink,
                  letterSpacing: "-0.03em",
                  margin: 0,
                }}
              >
                Dashboard
              </h1>
            </div>

            <div
              style={{
                background: colors.pine[700],
                color: colors.white,
                padding: "8px 16px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 6,
                boxShadow: shadows.button,
              }}
            >
              <span>Add Booking</span>
            </div>
          </div>

          {/* Hero Row: Today's Pax & Revenue Card */}
          <div style={{ display: "flex", gap: 18, height: 172 }}>
            {/* Card 1: Today's Pax (Emerald Gradient) */}
            <div
              style={{
                width: 380,
                borderRadius: 16,
                background:
                  "linear-gradient(135deg, #0d281e 0%, #081812 100%)",
                border: "1px solid rgba(255,255,255,0.08)",
                padding: "20px 24px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                position: "relative",
                overflow: "hidden",
                boxShadow: "0 10px 28px -10px rgba(15,43,31,0.3)",
              }}
            >
              {/* Subtle Topographic & Orbital SVG */}
              <svg
                style={{
                  position: "absolute",
                  right: -10,
                  top: -10,
                  width: 190,
                  height: 190,
                  opacity: 0.18,
                  pointerEvents: "none",
                }}
                viewBox="0 0 200 200"
              >
                <circle
                  cx="130"
                  cy="70"
                  r="60"
                  stroke="#A9F5D6"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  fill="none"
                />
                <circle
                  cx="130"
                  cy="70"
                  r="35"
                  stroke="#A9F5D6"
                  strokeWidth="1"
                  fill="none"
                />
                <circle cx="95" cy="70" r="4" fill="#F97316" />
                <path
                  d="M0 120 C 50 90, 120 150, 200 110"
                  stroke="#A9F5D6"
                  strokeWidth="1.2"
                  fill="none"
                />
                <path
                  d="M0 150 C 60 120, 140 180, 200 140"
                  stroke="#A9F5D6"
                  strokeWidth="1.2"
                  fill="none"
                />
              </svg>

              <div>
                <div
                  style={{
                    fontFamily: typography.mono,
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "rgba(255,255,255,0.55)",
                  }}
                >
                  TODAY'S PAX
                </div>
                <div
                  style={{
                    fontFamily: typography.display,
                    fontSize: 54,
                    fontWeight: 800,
                    color: colors.white,
                    letterSpacing: "-0.04em",
                    lineHeight: 1.05,
                    marginTop: 4,
                  }}
                >
                  <MetricCounter value={todayPax} />
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12.5,
                  color: "rgba(255,255,255,0.8)",
                  zIndex: 2,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: isFull ? "#F97316" : colors.mint[400],
                  }}
                />
                <span>
                  {isFull
                    ? "Fully booked · 10 pax confirmed"
                    : `${10 - todayPax} spots remaining · ${todayPax} booked`}
                </span>
              </div>
            </div>

            {/* Card 2: Revenue Card */}
            <div
              style={{
                flex: 1,
                borderRadius: 16,
                background: colors.white,
                border: `1px solid ${colors.borders.subtle}`,
                padding: "20px 24px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                boxShadow: shadows.card,
              }}
            >
              <div>
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
                      fontFamily: typography.mono,
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      color: colors.text.light,
                    }}
                  >
                    REVENUE
                  </span>
                  <span
                    style={{
                      fontFamily: typography.mono,
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: colors.pine[600],
                    }}
                  >
                    VIEW REPORTS →
                  </span>
                </div>

                <div style={{ display: "flex", gap: 36 }}>
                  <div>
                    <div
                      style={{
                        fontSize: 11,
                        color: colors.text.light,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        fontFamily: typography.mono,
                      }}
                    >
                      TODAY
                    </div>
                    <div
                      style={{
                        fontFamily: typography.display,
                        fontSize: 32,
                        fontWeight: 800,
                        color: colors.ink,
                        letterSpacing: "-0.03em",
                      }}
                    >
                      <MetricCounter value={revenue} prefix="R" />
                    </div>
                  </div>

                  <div>
                    <div
                      style={{
                        fontSize: 11,
                        color: colors.text.light,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        fontFamily: typography.mono,
                      }}
                    >
                      LAST 7 DAYS
                    </div>
                    <div
                      style={{
                        fontFamily: typography.display,
                        fontSize: 32,
                        fontWeight: 800,
                        color: colors.ink,
                        letterSpacing: "-0.03em",
                      }}
                    >
                      R14 860
                    </div>
                  </div>

                  <div>
                    <div
                      style={{
                        fontSize: 11,
                        color: colors.text.light,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        fontFamily: typography.mono,
                      }}
                    >
                      THIS MONTH
                    </div>
                    <div
                      style={{
                        fontFamily: typography.display,
                        fontSize: 32,
                        fontWeight: 800,
                        color: colors.ink,
                        letterSpacing: "-0.03em",
                      }}
                    >
                      R48 600
                    </div>
                  </div>
                </div>
              </div>

              {/* Sparkline Graph */}
              <div>
                <svg
                  width="100%"
                  height="26"
                  viewBox="0 0 400 26"
                  preserveAspectRatio="none"
                >
                  <path
                    d="M 0 20 L 50 20 L 100 18 L 150 20 L 200 19 L 250 14 L 300 16 L 350 4 L 400 15"
                    fill="none"
                    stroke={colors.pine[600]}
                    strokeWidth="2.2"
                  />
                  <circle cx="350" cy="4" r="3.5" fill={colors.pine[600]} />
                </svg>
                <div
                  style={{
                    fontFamily: typography.mono,
                    fontSize: 9.5,
                    color: colors.text.light,
                    letterSpacing: "0.08em",
                    marginTop: 2,
                  }}
                >
                  THIS MONTH, DAILY
                </div>
              </div>
            </div>
          </div>

          {/* Lower Row: Manifest & Roll Call & Weather */}
          <div style={{ display: "flex", gap: 18, height: 210 }}>
            {/* Left: Manifest Card */}
            <div
              style={{
                flex: 1.15,
                borderRadius: 16,
                background: colors.white,
                border: `1px solid ${colors.borders.subtle}`,
                padding: "18px 22px",
                display: "flex",
                flexDirection: "column",
                boxShadow: shadows.card,
              }}
            >
              {/* Manifest Header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 14,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span
                    style={{
                      fontFamily: typography.display,
                      fontSize: 18,
                      fontWeight: 700,
                      color: colors.ink,
                    }}
                  >
                    Manifest
                  </span>
                  <div
                    style={{
                      display: "flex",
                      background: colors.paper,
                      padding: 2,
                      borderRadius: 6,
                    }}
                  >
                    <div
                      style={{
                        background: colors.white,
                        padding: "3px 10px",
                        borderRadius: 4,
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: colors.ink,
                        boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                      }}
                    >
                      Today
                    </div>
                    <div
                      style={{
                        padding: "3px 10px",
                        fontSize: 11.5,
                        fontWeight: 500,
                        color: colors.text.muted,
                      }}
                    >
                      Tomorrow
                    </div>
                  </div>
                </div>

                <span
                  style={{
                    fontFamily: typography.mono,
                    fontSize: 10,
                    letterSpacing: "0.1em",
                    color: colors.text.light,
                    textTransform: "uppercase",
                  }}
                >
                  PAX PER SLOT
                </span>
              </div>

              {/* Table Column Headers */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "70px 140px 90px 1fr",
                  fontFamily: typography.mono,
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: colors.text.light,
                  paddingBottom: 8,
                  borderBottom: `1px solid ${colors.borders.subtle}`,
                }}
              >
                <span>TIME</span>
                <span>TOUR</span>
                <span>PAX</span>
                <span style={{ textAlign: "right" }}>CAPACITY</span>
              </div>

              {/* Table Row: 08:00 Ocean Kayak */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "70px 140px 90px 1fr",
                  alignItems: "center",
                  padding: "14px 0",
                  borderBottom: `1px solid ${colors.borders.subtle}`,
                  fontSize: 13.5,
                }}
              >
                <span
                  style={{
                    fontWeight: 700,
                    color: colors.pine[700],
                    fontFamily: typography.mono,
                  }}
                >
                  08:00
                </span>
                <span style={{ fontWeight: 600, color: colors.ink }}>
                  Ocean Kayak
                </span>
                <span
                  style={{
                    fontWeight: 700,
                    color: colors.ink,
                    fontFamily: typography.display,
                  }}
                >
                  <MetricCounter value={manifestPax} />
                </span>

                {/* Capacity Visual Progress Bar & Badge */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: 90,
                      height: 8,
                      borderRadius: 4,
                      background: colors.pine[100],
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${capacityPercent}%`,
                        height: "100%",
                        background: isFull ? "#F97316" : colors.pine[600],
                        borderRadius: 4,
                        transition: "none",
                      }}
                    />
                  </div>

                  <span
                    style={{
                      fontFamily: typography.mono,
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "3px 8px",
                      borderRadius: 6,
                      background: isFull
                        ? colors.status.fullBg
                        : colors.pine[50],
                      color: isFull
                        ? colors.status.fullText
                        : colors.pine[700],
                      border: `1px solid ${
                        isFull
                          ? colors.status.fullBorder
                          : colors.pine[200]
                      }`,
                    }}
                  >
                    {capacityText}
                  </span>
                </div>
              </div>

              {/* Totals Row */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  paddingTop: 10,
                  fontFamily: typography.mono,
                  fontSize: 11,
                  color: colors.text.muted,
                }}
              >
                <span>TOTALS</span>
                <span style={{ fontWeight: 700, color: colors.ink }}>
                  {manifestPax} / 10 GUESTS
                </span>
              </div>
            </div>

            {/* Right: Roll Call & Live Manifest */}
            <div
              style={{
                flex: 1,
                borderRadius: 16,
                background: colors.white,
                border: `1px solid ${colors.borders.subtle}`,
                padding: "18px 22px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                boxShadow: shadows.card,
              }}
            >
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    marginBottom: 12,
                  }}
                >
                  <span
                    style={{
                      fontFamily: typography.display,
                      fontSize: 17,
                      fontWeight: 700,
                      color: colors.ink,
                    }}
                  >
                    Roll Call
                  </span>
                  <span
                    style={{
                      fontFamily: typography.mono,
                      fontSize: 11,
                      color: colors.text.light,
                    }}
                  >
                    08:00 · Morning Launch
                  </span>
                </div>

                {/* Roll Call Guest: Thandi Mokoena */}
                <div
                  style={{
                    background: showThandiInRollCall
                      ? colors.pine[50]
                      : "transparent",
                    borderRadius: 10,
                    padding: "10px 12px",
                    border: `1px solid ${
                      showThandiInRollCall
                        ? colors.pine[200]
                        : colors.borders.subtle
                    }`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    transition: "none",
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        background: showThandiInRollCall
                          ? colors.pine[600]
                          : "#E2E8F0",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <path
                          d="M5 13L9 17L19 7"
                          stroke={colors.white}
                          strokeWidth="2.5"
                          strokeLinecap="round"
                        />
                      </svg>
                    </div>

                    <div>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: 13,
                          color: colors.ink,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <span>
                          {showThandiInRollCall
                            ? "Thandi Mokoena"
                            : "Sarah Barnes"}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            fontFamily: typography.mono,
                            fontWeight: 700,
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: colors.status.paidBg,
                            color: colors.status.paidText,
                          }}
                        >
                          PAID
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: colors.text.light,
                          fontFamily: typography.mono,
                        }}
                      >
                        {showThandiInRollCall
                          ? "+27 82 555 0192 · 2 pax"
                          : "+27 82 555 0000 · 2 pax"}
                      </div>
                    </div>
                  </div>

                  <span
                    style={{
                      fontFamily: typography.mono,
                      fontSize: 11,
                      fontWeight: 700,
                      color: colors.pine[600],
                    }}
                  >
                    CONFIRMED
                  </span>
                </div>
              </div>

              {/* Weather Status Bar */}
              <div
                style={{
                  background: colors.paper,
                  borderRadius: 10,
                  padding: "8px 12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <circle
                      cx="12"
                      cy="12"
                      r="4"
                      stroke={colors.pine[600]}
                      strokeWidth="2"
                    />
                    <path
                      d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"
                      stroke={colors.pine[600]}
                      strokeWidth="2"
                    />
                  </svg>
                  <span style={{ fontWeight: 600, color: colors.ink }}>
                    Weather
                  </span>
                  <span style={{ color: colors.text.muted }}>
                    Good · Wind 6kt Offshore · 1.2m Swell
                  </span>
                </div>

                <span
                  style={{
                    color: colors.status.paidText,
                    fontWeight: 700,
                    fontFamily: typography.mono,
                    fontSize: 11,
                  }}
                >
                  GO
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
