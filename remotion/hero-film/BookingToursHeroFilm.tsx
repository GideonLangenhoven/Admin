import React from "react";
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Easing,
} from "remotion";
import { colors, typography } from "./theme";
import { ProductWindow } from "./components/ProductWindow";
import { DashboardView, DashboardState } from "./components/DashboardView";
import { WhatsAppNotification } from "./components/WhatsAppNotification";
import { WhatsAppChatModal } from "./components/WhatsAppChatModal";
import { PaymentConfirmed } from "./components/PaymentConfirmed";
import { Cursor } from "./components/Cursor";
import { SystemPillLabels } from "./components/SystemPillLabels";
import { HeadlineReveal } from "./components/HeadlineReveal";

export const BookingToursHeroFilm: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // =========================================================================
  // 1. CAMERA & WINDOW CHOREOGRAPHY
  // =========================================================================

  // Opening window entrance (0 to 60 frames)
  const windowEntranceOpacity = interpolate(frame, [0, 45], [0.85, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const windowEntranceScale = interpolate(frame, [0, 60], [0.94, 1.0], {
    easing: Easing.bezier(0.22, 1, 0.36, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Camera subtle push / pan toward right when chat appears (120 to 180 frames)
  const cameraPanX = interpolate(
    frame,
    [120, 180, 390, 440],
    [0, -90, -90, 0],
    {
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  const cameraScale = interpolate(
    frame,
    [120, 180, 390, 440],
    [1.0, 1.05, 1.05, 1.0],
    {
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  // Overall window scale combining entrance + camera
  const totalWindowScale = windowEntranceScale * cameraScale;

  // =========================================================================
  // 2. BEAT 2: WHATSAPP NOTIFICATION & CONVERSATION (Frames 120 - 320)
  // =========================================================================

  // WhatsApp Toast Notification (Frames 120 - 180)
  const notifSpring = spring({
    frame: frame - 120,
    fps,
    config: { damping: 16, stiffness: 120, mass: 0.8 },
  });

  const notifOpacity = interpolate(
    frame,
    [120, 140, 175, 190],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  const notifY = interpolate(notifSpring, [0, 1], [-40, 0]);

  // WhatsApp Chat Modal (Frames 180 - 320)
  const chatSpring = spring({
    frame: frame - 180,
    fps,
    config: { damping: 16, stiffness: 110, mass: 0.8 },
  });

  const chatOpacity = interpolate(
    frame,
    [180, 195, 315, 325],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  const chatScale = interpolate(chatSpring, [0, 1], [0.94, 1.0]);

  // Message Stagger within Chat
  const msg1Opacity = interpolate(frame, [190, 205], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const msg2Opacity = interpolate(frame, [215, 230], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const msg3Opacity = interpolate(frame, [238, 248], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const bookingCardOpacity = interpolate(frame, [248, 262], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Cursor and Payment Button Interaction
  const cursorOpacity = interpolate(
    frame,
    [255, 265, 305, 315],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  // Organic Bezier Cursor Movement directly onto the [ PAY WITH YOCO ] button
  const cursorX = interpolate(frame, [260, 284], [1350, 1210], {
    easing: Easing.bezier(0.22, 1, 0.36, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const cursorY = interpolate(frame, [260, 284], [830, 740], {
    easing: Easing.bezier(0.22, 1, 0.36, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const isClicking = frame >= 288 && frame <= 298;
  const isButtonPressed = frame >= 288 && frame <= 300;
  const isButtonLoading = frame > 300 && frame < 325;

  // =========================================================================
  // 3. BEAT 3: PAYMENT CONFIRMATION (Frames 320 - 410)
  // =========================================================================

  const confirmSpring = spring({
    frame: frame - 325,
    fps,
    config: { damping: 14, stiffness: 120, mass: 0.7 },
  });

  const confirmOpacity = interpolate(
    frame,
    [324, 335, 395, 410],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  const confirmScale = interpolate(confirmSpring, [0, 1], [0.92, 1.0]);

  // =========================================================================
  // 4. BEAT 4: CONNECTED ENGINE UPDATES (Frames 410 - 540)
  // =========================================================================

  // Live Metric Rollups
  const revenueRollProgress = interpolate(frame, [420, 470], [0, 1], {
    easing: Easing.bezier(0.22, 1, 0.36, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const currentRevenue = interpolate(revenueRollProgress, [0, 1], [3600, 4500]);

  const paxRollProgress = interpolate(frame, [425, 465], [0, 1], {
    easing: Easing.bezier(0.22, 1, 0.36, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const currentTodayPax = Math.round(
    interpolate(paxRollProgress, [0, 1], [8, 10])
  );

  const isFullNow = frame >= 445;
  const capacityText = isFullNow ? "10 / 10 · FULL" : "8 / 10 · 2 LEFT";
  const capacityPercent = interpolate(
    frame,
    [425, 465],
    [80, 100],
    {
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  // System Pill Labels (Frames 465 - 545)
  const systemLabelsOpacity = interpolate(
    frame,
    [465, 480, 535, 548],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  let activeSystemStep = 0;
  if (frame >= 472) activeSystemStep = 1; // WhatsApp
  if (frame >= 485) activeSystemStep = 2; // Bookings
  if (frame >= 498) activeSystemStep = 3; // Payments
  if (frame >= 512) activeSystemStep = 4; // Operations

  // =========================================================================
  // 5. BEAT 5: CLIMAX STATEMENT & SEAMLESS LOOP (Frames 545 - 660)
  // =========================================================================

  const headlineOpacity = interpolate(
    frame,
    [545, 560, 630, 655],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }
  );

  const headlineLine1 = interpolate(frame, [548, 570], [0, 1], {
    easing: Easing.bezier(0.22, 1, 0.36, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const headlineLine2 = interpolate(frame, [560, 582], [0, 1], {
    easing: Easing.bezier(0.22, 1, 0.36, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const headlineLogo = interpolate(frame, [575, 595], [0, 1], {
    easing: Easing.bezier(0.22, 1, 0.36, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Loop back: gently settle metrics to initial state during last 15 frames for seamless loop
  const loopReset = interpolate(frame, [645, 660], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const finalTodayPax = loopReset < 0.5 ? 8 : currentTodayPax;
  const finalRevenue = loopReset < 0.5 ? 3600 : currentRevenue;
  const finalIsFull = loopReset < 0.5 ? false : isFullNow;
  const finalCapacityText = loopReset < 0.5 ? "8 / 10 · 2 LEFT" : capacityText;
  const finalCapacityPercent = loopReset < 0.5 ? 80 : capacityPercent;
  const finalShowThandi = loopReset < 0.5 ? false : frame >= 435;

  const dashboardState: DashboardState = {
    todayPax: finalTodayPax,
    revenue: finalRevenue,
    capacityText: finalCapacityText,
    isFull: finalIsFull,
    manifestPax: finalTodayPax,
    showThandiInRollCall: finalShowThandi,
    inboxCount: frame >= 120 && frame < 320 ? 1 : 0,
    capacityPercent: finalCapacityPercent,
  };

  return (
    <div
      style={{
        width: 1920,
        height: 1080,
        background: colors.paper,
        position: "relative",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Subtle Warm Canvas Ambient Vignette */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 50% 45%, rgba(244, 241, 232, 0.9) 0%, rgba(231, 226, 212, 0.4) 100%)",
          pointerEvents: "none",
        }}
      />

      {/* Main Application Window Container */}
      <ProductWindow
        scale={totalWindowScale}
        opacity={windowEntranceOpacity}
        translateX={cameraPanX}
      >
        <DashboardView state={dashboardState} />

        {/* WhatsApp Floating Notification */}
        <WhatsAppNotification
          opacity={notifOpacity}
          translateY={notifY}
        />

        {/* WhatsApp Chat & Yoco Booking Card Drawer */}
        <WhatsAppChatModal
          opacity={chatOpacity}
          scale={chatScale}
          msg1Opacity={msg1Opacity}
          msg2Opacity={msg2Opacity}
          msg3Opacity={msg3Opacity}
          bookingCardOpacity={bookingCardOpacity}
          buttonPressed={isButtonPressed}
          buttonLoading={isButtonLoading}
        />

        {/* Payment Received Confirmation Banner */}
        <PaymentConfirmed
          opacity={confirmOpacity}
          scale={confirmScale}
        />

        {/* Interactive Organic Bezier Cursor */}
        <Cursor
          x={cursorX}
          y={cursorY}
          opacity={cursorOpacity}
          clicking={isClicking}
          visible={cursorOpacity > 0}
        />
      </ProductWindow>

      {/* Understated Connected System Labels */}
      <SystemPillLabels
        opacity={systemLabelsOpacity}
        activeStep={activeSystemStep}
      />

      {/* Final Headline Statement & Brand Monogram */}
      <HeadlineReveal
        opacity={headlineOpacity}
        line1Progress={headlineLine1}
        line2Progress={headlineLine2}
        logoProgress={headlineLogo}
      />
    </div>
  );
};
