import type {CSSProperties} from "react";
import {AbsoluteFill, Img, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import {BookingCard, Cursor, Headline, Metric, Notification, PaymentStatus, ProductWindow, WhatsAppMessage} from "./components";
import {cardShadow, colors, fadeThrough, fonts, tween} from "./design";

const mono: CSSProperties = {
  fontFamily: fonts.mono,
  fontSize: 10,
  fontWeight: 550,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: colors.muted,
};

const Card = ({children, style}: {children: React.ReactNode; style?: CSSProperties}) => (
  <div style={{border: `1px solid ${colors.border}`, borderRadius: 14, background: `linear-gradient(180deg,${colors.surface} 0%,${colors.surfaceWarm} 100%)`, boxShadow: cardShadow, ...style}}>{children}</div>
);

const Dashboard = ({progress, day = "Today"}: {progress: number; day?: "Today" | "Tomorrow"}) => {
  const guests = Math.round(interpolate(progress, [0, 1], [8, 10]));
  const revenue = Math.round(interpolate(progress, [0, 1], [3600, 4500]));
  const bar = interpolate(progress, [0, 1], [80, 100]);
  const full = tween(progress, 0.62, 0.86);
  return (
    <div style={{height: "100%", padding: "30px 34px 28px", boxSizing: "border-box"}}>
      <div style={{display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 24}}>
        <div>
          <div style={{...mono, marginBottom: 8}}>Monday, 14 September</div>
          <div style={{fontFamily: fonts.display, fontSize: 29, fontWeight: 650, letterSpacing: "-0.03em", color: colors.ink}}>Dashboard</div>
        </div>
        <div style={{height: 36, borderRadius: 10, padding: "0 16px", display: "grid", placeItems: "center", background: "linear-gradient(180deg,#176B4B 0%,#125E40 55%,#0F5137 100%)", color: colors.cream, fontFamily: fonts.sans, fontSize: 12, fontWeight: 650, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.16),0 8px 20px -9px rgba(18,94,64,0.52)"}}>Add Booking</div>
      </div>

      <div style={{display: "grid", gridTemplateColumns: "1.65fr 0.85fr 0.85fr", gap: 18, height: 294}}>
        <Card style={{position: "relative", overflow: "hidden", padding: 26}}>
          <div style={{position: "absolute", inset: 0, background: "radial-gradient(80% 100% at 100% 0%,rgba(18,94,64,0.09),transparent 64%)"}} />
          <div style={{position: "relative", height: "100%", display: "flex", flexDirection: "column"}}>
            <div style={{display: "flex", alignItems: "center", justifyContent: "space-between"}}>
              <div style={{...mono, color: colors.pine}}>{day}</div>
              <div style={{...mono, fontSize: 8.5, letterSpacing: "0.08em", color: colors.ocean}}>Cape Town</div>
            </div>
            <div style={{display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 31}}>
              <div>
                <div style={{fontFamily: fonts.display, fontSize: 35, lineHeight: 1, fontWeight: 660, letterSpacing: "-0.035em", color: colors.ink}}>Ocean Kayak</div>
                <div style={{fontFamily: fonts.sans, fontSize: 12.5, color: colors.muted, marginTop: 9}}>Three Anchor Bay</div>
              </div>
              <div style={{fontFamily: fonts.display, fontSize: 45, lineHeight: 0.9, fontWeight: 650, letterSpacing: "-0.04em", color: colors.ink, fontVariantNumeric: "tabular-nums"}}>08:00</div>
            </div>
            <div style={{marginTop: "auto"}}>
              <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11}}>
                <div style={{fontFamily: fonts.sans, fontSize: 12, color: colors.text}}><strong style={{fontSize: 15, color: colors.ink, fontVariantNumeric: "tabular-nums"}}>{guests} / 10</strong> booked</div>
                <div style={{position: "relative", height: 22, minWidth: 122, textAlign: "right"}}>
                  <span style={{position: "absolute", right: 0, top: 2, fontFamily: fonts.sans, fontSize: 11.5, color: colors.muted, opacity: 1 - full}}>Two spaces remaining</span>
                  <span style={{position: "absolute", right: 0, top: 0, ...mono, color: colors.success, opacity: full, background: colors.successSoft, borderRadius: 6, padding: "4px 8px", letterSpacing: "0.08em", fontSize: 8.5}}>Full</span>
                </div>
              </div>
              <div style={{height: 7, borderRadius: 99, background: colors.sunken, overflow: "hidden"}}><div style={{height: "100%", width: `${bar}%`, borderRadius: 99, background: "linear-gradient(90deg,#125E40,#1B8A5F)"}} /></div>
            </div>
          </div>
        </Card>
        <Metric label="Revenue" value={`R${revenue.toLocaleString("en-ZA")}`} note={progress > 0.72 ? "+R900 received" : "Today"} />
        <Metric label="Weather" value="Good" note="Light wind · 14 km/h" tone={colors.success} />
      </div>

      <Card style={{marginTop: 18, overflow: "hidden"}}>
        <div style={{height: 54, padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${colors.border}`}}>
          <div>
            <span style={{fontFamily: fonts.sans, fontSize: 13.5, fontWeight: 650, color: colors.ink}}>Manifest</span>
            <span style={{...mono, fontSize: 8.5, marginLeft: 11}}>Pax per slot</span>
          </div>
          <div style={{padding: 3, borderRadius: 9, background: colors.sunken, border: `1px solid ${colors.border}`}}>
            <span style={{fontFamily: fonts.sans, fontSize: 10.5, fontWeight: 650, color: colors.ink, background: colors.surface, borderRadius: 6, padding: "5px 10px", boxShadow: "0 1px 2px rgba(15,43,31,0.08)"}}>{day}</span>
            <span style={{fontFamily: fonts.sans, fontSize: 10.5, color: colors.muted, padding: "5px 10px"}}>{day === "Today" ? "Tomorrow" : "Today"}</span>
          </div>
        </div>
        <div style={{height: 88, display: "grid", gridTemplateColumns: "0.8fr 1.7fr 1fr 0.8fr 1fr", alignItems: "center", padding: "0 20px"}}>
          {[{label: "Time", value: "08:00"}, {label: "Tour", value: "Ocean Kayak"}, {label: "Bookings", value: progress > 0.68 ? "5" : "4"}, {label: "Guests", value: String(guests)}, {label: "Status", value: progress > 0.72 ? "FULL" : "OPEN"}].map((item, index) => (
            <div key={item.label} style={{textAlign: index > 1 ? "right" : "left"}}>
              <div style={{...mono, fontSize: 8.5}}>{item.label}</div>
              <div style={{fontFamily: index === 3 ? fonts.display : fonts.sans, fontSize: index === 3 ? 20 : 12.5, fontWeight: 650, color: item.value === "FULL" ? colors.success : colors.ink, marginTop: 7, fontVariantNumeric: "tabular-nums"}}>{item.value}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

const Conversation = ({frame}: {frame: number}) => {
  const ai = tween(frame, 172, 191);
  const customer = tween(frame, 208, 225);
  const booking = tween(frame, 229, 250);
  const press = fadeThrough(frame, 291, 296, 301, 307);
  return (
    <div style={{height: "100%", padding: 22, boxSizing: "border-box"}}>
      <div style={{fontFamily: fonts.display, fontSize: 25, fontWeight: 650, letterSpacing: "-0.025em", color: colors.ink, margin: "0 0 16px 3px"}}>Inbox</div>
      <div style={{height: 560, display: "grid", gridTemplateColumns: "288px 1fr", gap: 14}}>
        <Card style={{overflow: "hidden"}}>
          <div style={{padding: 14, borderBottom: `1px solid ${colors.border}`}}><div style={{height: 34, border: `1px solid ${colors.borderStrong}`, borderRadius: 9, background: colors.surface, display: "flex", alignItems: "center", padding: "0 11px", fontFamily: fonts.sans, fontSize: 11, color: colors.muted}}>Search conversations</div></div>
          <div style={{padding: 14, background: colors.pineSoft, borderBottom: `1px solid ${colors.border}`}}>
            <div style={{display: "flex", alignItems: "center", gap: 8}}><span style={{width: 7, height: 7, borderRadius: 99, background: colors.pine}}/><span style={{fontFamily: fonts.sans, fontSize: 12.5, fontWeight: 700, color: colors.ink}}>Thandi Mokoena</span><span style={{marginLeft: "auto", ...mono, fontSize: 7.5, background: colors.sunken, borderRadius: 5, padding: "4px 6px"}}>Bot</span></div>
            <div style={{fontFamily: fonts.sans, fontSize: 10.5, color: colors.muted, marginTop: 6}}>Can I book for 2 tomorrow...</div>
          </div>
          {["Sipho Dlamini", "Megan Jacobs", "Ayesha Khan"].map((name, i) => <div key={name} style={{padding: 14, borderBottom: `1px solid ${colors.border}`}}><div style={{fontFamily: fonts.sans, fontSize: 11.5, fontWeight: 620, color: colors.ink}}>{name}</div><div style={{fontFamily: fonts.sans, fontSize: 9.5, color: colors.muted, marginTop: 5}}>{i === 0 ? "Thanks, see you there." : i === 1 ? "Is Saturday available?" : "Payment received, thank you."}</div></div>)}
        </Card>
        <Card style={{overflow: "hidden", display: "flex", flexDirection: "column"}}>
          <div style={{height: 58, padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${colors.border}`}}>
            <div><div style={{fontFamily: fonts.sans, fontSize: 13, fontWeight: 700, color: colors.ink}}>Thandi Mokoena</div><div style={{fontFamily: fonts.mono, fontSize: 8.5, color: colors.muted, marginTop: 3}}>WhatsApp · AI active</div></div>
            <span style={{...mono, fontSize: 8, color: colors.success, background: colors.successSoft, padding: "5px 8px", borderRadius: 6}}>Booking</span>
          </div>
          <div style={{flex: 1, padding: "18px 22px", background: colors.surfaceWarm, display: "flex", flexDirection: "column", gap: 11}}>
            <WhatsAppMessage side="in" meta="09:41 · Customer">Can I book for 2 tomorrow morning?</WhatsAppMessage>
            <WhatsAppMessage side="out" progress={ai} meta="09:41 · AI">Absolutely. The 08:00 Ocean Kayak has 2 spaces available.</WhatsAppMessage>
            <WhatsAppMessage side="in" progress={customer} meta="09:42 · Customer">Perfect.</WhatsAppMessage>
            <BookingCard progress={booking} pressed={press} />
          </div>
        </Card>
      </div>
    </div>
  );
};

const SystemLabels = ({opacity}: {opacity: number}) => (
  <div style={{position: "absolute", left: 0, right: 0, top: 910, display: "flex", justifyContent: "center", gap: 56, opacity, transform: `translateY(${(1 - opacity) * 9}px)`}}>
    {["WhatsApp", "Bookings", "Payments", "Operations"].map((label, index) => (
      <div key={label} style={{display: "flex", alignItems: "center", gap: 12, fontFamily: fonts.mono, fontSize: 12, fontWeight: 560, letterSpacing: "0.13em", textTransform: "uppercase", color: colors.text}}>
        <span style={{width: 5, height: 5, borderRadius: 99, background: index === 0 ? colors.ocean : index === 2 ? colors.success : colors.amber}} />{label}
      </div>
    ))}
  </div>
);

export const BookingToursHero = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const intro = tween(frame, 0, Math.round(0.85 * fps));
  const notificationOpacity = fadeThrough(frame, 78, 98, 140, 160);
  const dashboardOpening = 1 - tween(frame, 145, 170);
  const chatOpacity = fadeThrough(frame, 150, 174, 304, 328);
  const paymentOpacity = fadeThrough(frame, 304, 328, 360, 385);
  const resultBase = tween(frame, 365, 392);
  const reset = tween(frame, 680, 716);
  const resultOpacity = resultBase * (1 - reset);
  const update = tween(frame, 405, 493);
  const labelsOpacity = fadeThrough(frame, 520, 545, 585, 610);
  const headlineOpacity = fadeThrough(frame, 594, 616, 668, 698);
  const cursorOpacity = fadeThrough(frame, 245, 258, 303, 311);
  const attention = fadeThrough(frame, 75, 102, 143, 170);
  const pullBack = tween(frame, 500, 560);
  const loopScale = tween(frame, 682, 719);
  const cameraScale = interpolate(intro, [0, 1], [0.96, 1]) + attention * 0.009 - pullBack * 0.055 + loopScale * 0.015;
  const cameraX = -attention * 86;
  const cameraY = -pullBack * 27 + loopScale * 27;
  const cameraOpacity = interpolate(intro, [0, 1], [0.78, 1]) - loopScale * 0.22;

  return (
    <AbsoluteFill style={{background: colors.bg, overflow: "hidden", fontFamily: fonts.sans}}>
      <style>{`
        @font-face{font-family:'Plus Jakarta Sans';src:url('${staticFile("fonts/plus-jakarta-latin.woff2")}') format('woff2');font-weight:200 800;font-style:normal;font-display:swap}
        @font-face{font-family:'Geist Mono';src:url('${staticFile("fonts/geist-mono-latin.woff2")}') format('woff2');font-weight:100 900;font-style:normal;font-display:swap}
        @font-face{font-family:'Satoshi';src:url('${staticFile("fonts/Satoshi-Variable.woff2")}') format('woff2');font-weight:300 900;font-style:normal;font-display:swap}
      `}</style>
      <div style={{position: "absolute", inset: 0, background: "radial-gradient(1100px 700px at 90% -10%,rgba(18,94,64,0.055),transparent 60%),radial-gradient(900px 650px at -8% 108%,rgba(217,130,47,0.05),transparent 55%)"}} />
      <svg style={{position: "absolute", left: -120, bottom: -120, width: 720, height: 440, opacity: 0.06}} viewBox="0 0 720 440" fill="none" stroke={colors.pine} strokeWidth="1">
        {[0, 1, 2, 3, 4].map((n) => <path key={n} d={`M-20 ${330 - n * 32} C120 ${210 - n * 7}, 210 ${410 - n * 38}, 350 ${275 - n * 15} S570 ${175 + n * 10}, 750 ${245 - n * 9}`} />)}
      </svg>

      <div style={{position: "absolute", left: 260, top: 112, width: 1400, height: 720, opacity: cameraOpacity, transformOrigin: "50% 52%", transform: `translate(${cameraX}px,${cameraY}px) scale(${cameraScale})`}}>
        <Sequence layout="none">
          <div style={{position: "absolute", inset: 0, opacity: dashboardOpening}}><ProductWindow active="Dashboard" section="Dashboard"><Dashboard progress={0} day="Today" /></ProductWindow></div>
        </Sequence>
        <Sequence from={145} layout="none">
          <div style={{position: "absolute", inset: 0, opacity: chatOpacity}}><ProductWindow active="Inbox" section="Inbox"><Conversation frame={frame} /></ProductWindow></div>
        </Sequence>
        <Sequence from={300} layout="none">
          <div style={{position: "absolute", inset: 0, opacity: paymentOpacity}}><ProductWindow active="Inbox" section="Payment"><PaymentStatus progress={tween(frame, 304, 330)} /></ProductWindow></div>
        </Sequence>
        <Sequence from={360} layout="none">
          <div style={{position: "absolute", inset: 0, opacity: resultOpacity}}><ProductWindow active="Dashboard" section="Dashboard"><Dashboard progress={update} day="Tomorrow" /></ProductWindow></div>
        </Sequence>
        <Sequence from={675} layout="none">
          <div style={{position: "absolute", inset: 0, opacity: reset}}><ProductWindow active="Dashboard" section="Dashboard"><Dashboard progress={0} day="Today" /></ProductWindow></div>
        </Sequence>
      </div>

      <Notification frame={frame} opacity={notificationOpacity} />
      <Cursor frame={frame} opacity={cursorOpacity} />
      <SystemLabels opacity={labelsOpacity} />

      <div style={{position: "absolute", left: 0, right: 0, top: 888, display: "flex", flexDirection: "column", alignItems: "center", pointerEvents: "none"}}>
        <Headline opacity={headlineOpacity}>ONE BOOKING.<br/>EVERYTHING UPDATED.</Headline>
        <div style={{display: "flex", alignItems: "center", gap: 9, marginTop: 17, opacity: headlineOpacity * 0.72, transform: `translateY(${(1 - headlineOpacity) * 8}px)`}}>
          <Img src={staticFile("brand/bt-mark.png")} style={{width: 25, height: 25, objectFit: "contain"}} />
          <span style={{fontFamily: fonts.display, fontSize: 15, fontWeight: 650, letterSpacing: "-0.02em", color: colors.pine}}>BookingTours</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
