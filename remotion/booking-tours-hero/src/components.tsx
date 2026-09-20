import type {CSSProperties, ReactNode} from "react";
import {Img, interpolate, staticFile} from "remotion";
import {cardShadow, colors, fonts, tween} from "./design";

const mono: CSSProperties = {
  fontFamily: fonts.mono,
  fontSize: 11,
  fontWeight: 550,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: colors.muted,
};

const Icon = ({name, active = false}: {name: string; active?: boolean}) => {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const paths: Record<string, ReactNode> = {
    Dashboard: <><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="13" y="3" width="6" height="6" rx="1"/><rect x="3" y="13" width="6" height="6" rx="1"/><rect x="13" y="13" width="6" height="6" rx="1"/></>,
    Bookings: <><path d="M6 4h12v16H6z"/><path d="M9 2v4M15 2v4M9 10h6M9 14h6"/></>,
    Slots: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M8 14h3M14 14h3"/></>,
    Inbox: <><path d="M4 5h16v12H4z"/><path d="m4 7 8 6 8-6"/></>,
    Invoices: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></>,
    Reports: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
    Settings: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/></>,
  };
  return <svg viewBox="0 0 24 24" width="17" height="17" {...common} style={{opacity: active ? 1 : 0.84}}>{paths[name]}</svg>;
};

const Sidebar = ({active}: {active: string}) => {
  const groups = [
    {label: null, items: ["Dashboard"]},
    {label: "Operations", items: ["Bookings", "Slots"]},
    {label: "Customers", items: ["Inbox"]},
    {label: "Revenue", items: ["Invoices", "Reports"]},
    {label: "Admin", items: ["Settings"]},
  ];
  return (
    <aside style={{
      width: 218,
      height: "100%",
      flexShrink: 0,
      color: "#B7C9BD",
      background: "radial-gradient(140% 50% at 50% -8%, rgba(79,224,166,0.08), transparent 60%), radial-gradient(120% 45% at 50% 112%, rgba(217,130,47,0.07), transparent 60%), linear-gradient(180deg,#113022 0%,#0C2117 100%)",
      display: "flex",
      flexDirection: "column",
    }}>
      <div style={{height: 78, padding: "22px 22px 14px", display: "flex", alignItems: "center", gap: 10}}>
        <div style={{width: 28, height: 28, borderRadius: 7, background: "rgba(246,243,234,0.09)", display: "grid", placeItems: "center"}}>
          <Img src={staticFile("brand/bt-mark-ivory.png")} style={{width: 38, height: 38, objectFit: "contain"}} />
        </div>
        <span style={{fontFamily: fonts.sans, color: colors.cream, fontSize: 15, fontWeight: 650, letterSpacing: "-0.02em"}}>Cape Kayak</span>
      </div>
      <div style={{padding: "0 12px", flex: 1}}>
        {groups.map((group, groupIndex) => (
          <div key={group.label ?? "top"} style={{marginTop: groupIndex === 0 ? 4 : 16}}>
            {group.label && <div style={{...mono, color: "#85998C", fontSize: 9, padding: "0 10px", marginBottom: 6}}>{group.label}</div>}
            {group.items.map((item) => {
              const selected = item === active;
              return (
                <div key={item} style={{
                  position: "relative",
                  height: 34,
                  padding: "0 10px",
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: selected ? "rgba(244,241,232,0.09)" : "transparent",
                  color: selected ? colors.cream : "#B7C9BD",
                  fontFamily: fonts.sans,
                  fontSize: 12.5,
                  fontWeight: selected ? 650 : 520,
                }}>
                  {selected && <span style={{position: "absolute", left: 0, top: 8, bottom: 8, width: 3, borderRadius: 4, background: colors.amber, boxShadow: "0 0 9px rgba(217,130,47,0.45)"}} />}
                  <span style={{display: "grid", placeItems: "center", color: selected ? colors.mint : "#8FA79A"}}><Icon name={item} active={selected} /></span>
                  {item}
                  {item === "Inbox" && active !== "Inbox" && <span style={{marginLeft: "auto", width: 6, height: 6, borderRadius: 99, background: colors.amber}} />}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{height: 42, borderTop: "1px solid rgba(244,241,232,0.08)", padding: "0 20px", display: "flex", alignItems: "center", gap: 8, color: "#85998C"}}>
        <Img src={staticFile("brand/bt-mark-ivory.png")} style={{width: 20, height: 20, objectFit: "contain", opacity: 0.7}} />
        <span style={{fontFamily: fonts.mono, fontSize: 7.5, letterSpacing: "0.08em", textTransform: "uppercase"}}>Powered by</span>
        <span style={{fontFamily: fonts.display, fontSize: 10.5, fontWeight: 650}}>BookingTours</span>
      </div>
    </aside>
  );
};

export const ProductWindow = ({active, section, children}: {active: string; section: string; children: ReactNode}) => (
  <div style={{
    width: 1400,
    height: 720,
    overflow: "hidden",
    display: "flex",
    borderRadius: 18,
    border: `1px solid ${colors.borderStrong}`,
    background: colors.bg,
    boxShadow: "0 40px 90px -44px rgba(15,43,31,0.46), 0 10px 28px -18px rgba(15,43,31,0.24)",
  }}>
    <Sidebar active={active} />
    <div style={{flex: 1, minWidth: 0, display: "flex", flexDirection: "column"}}>
      <header style={{height: 52, padding: "0 26px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${colors.border}`, background: "rgba(247,245,240,0.91)"}}>
        <div style={{...mono, fontSize: 9.5, display: "flex", gap: 8, alignItems: "center"}}>
          <span>Cape Kayak</span><span style={{color: colors.borderStrong}}>/</span><span style={{color: colors.ink}}>{section}</span>
        </div>
        <div style={{...mono, fontSize: 9.5, letterSpacing: "0.04em", textTransform: "none", display: "flex", alignItems: "center", gap: 8}}>
          <span style={{width: 5, height: 5, borderRadius: 99, background: colors.pine}} />
          Mon · 14 Sep · 09:42
        </div>
      </header>
      <main style={{position: "relative", flex: 1, overflow: "hidden", background: "radial-gradient(800px 480px at 95% -10%,rgba(18,94,64,0.045),transparent 60%), radial-gradient(650px 440px at -8% 108%,rgba(217,130,47,0.04),transparent 55%), #F7F5F0"}}>
        {children}
      </main>
    </div>
  </div>
);

export const Metric = ({label, value, note, tone = colors.ink}: {label: string; value: string; note: string; tone?: string}) => (
  <div style={{borderRadius: 14, border: `1px solid ${colors.border}`, padding: "20px 22px", background: `linear-gradient(180deg,${colors.surface} 0%,${colors.surfaceWarm} 100%)`, boxShadow: cardShadow}}>
    <div style={{...mono, fontSize: 9.5}}>{label}</div>
    <div style={{fontFamily: fonts.display, fontSize: 31, lineHeight: 1, fontWeight: 650, letterSpacing: "-0.025em", color: tone, marginTop: 15, fontVariantNumeric: "tabular-nums"}}>{value}</div>
    <div style={{fontFamily: fonts.sans, fontSize: 11.5, color: colors.muted, marginTop: 11, display: "flex", alignItems: "center", gap: 7}}>
      <span style={{width: 5, height: 5, borderRadius: 99, background: tone === colors.success ? colors.success : colors.amber}} />{note}
    </div>
  </div>
);

export const WhatsAppMessage = ({side, children, progress = 1, meta}: {side: "in" | "out"; children: ReactNode; progress?: number; meta: string}) => (
  <div style={{display: "flex", justifyContent: side === "out" ? "flex-end" : "flex-start", opacity: progress, transform: `translateY(${(1 - progress) * 9}px)`}}>
    <div style={{
      maxWidth: 470,
      border: `1px solid ${colors.border}`,
      borderRadius: side === "out" ? "16px 16px 5px 16px" : "16px 16px 16px 5px",
      background: side === "out" ? colors.pineSoft : colors.sunken,
      padding: "12px 15px 10px",
      color: side === "out" ? colors.ink : colors.text,
      fontFamily: fonts.sans,
      fontSize: 15,
      lineHeight: 1.45,
      boxShadow: "0 8px 20px -18px rgba(15,43,31,0.5)",
    }}>
      {children}
      <div style={{fontFamily: fonts.mono, fontSize: 8.5, letterSpacing: "0.03em", color: colors.muted, marginTop: 6}}>{meta}</div>
    </div>
  </div>
);

export const BookingCard = ({progress, pressed}: {progress: number; pressed: number}) => (
  <div style={{
    width: 448,
    marginLeft: "auto",
    border: `1px solid ${colors.borderStrong}`,
    borderRadius: 15,
    padding: 17,
    background: colors.surface,
    boxShadow: cardShadow,
    opacity: progress,
    transform: `translateY(${(1 - progress) * 12}px) scale(${0.985 + progress * 0.015})`,
  }}>
    <div style={{display: "flex", justifyContent: "space-between", gap: 20}}>
      <div>
        <div style={{...mono, fontSize: 8.5}}>Booking ready</div>
        <div style={{fontFamily: fonts.display, fontSize: 18, fontWeight: 650, color: colors.ink, marginTop: 7}}>Ocean Kayak</div>
        <div style={{fontFamily: fonts.sans, fontSize: 11.5, color: colors.muted, marginTop: 3}}>Cape Town · Tomorrow</div>
      </div>
      <div style={{fontFamily: fonts.display, fontSize: 23, fontWeight: 670, color: colors.ink, fontVariantNumeric: "tabular-nums"}}>R900</div>
    </div>
    <div style={{display: "flex", gap: 8, margin: "15px 0 13px"}}>
      {["08:00", "2 guests"].map((value) => <span key={value} style={{...mono, fontSize: 8.5, letterSpacing: "0.06em", padding: "6px 8px", borderRadius: 6, background: colors.sunken, color: colors.text}}>{value}</span>)}
    </div>
    <div style={{height: 38, borderRadius: 10, display: "grid", placeItems: "center", background: "linear-gradient(180deg,#176B4B 0%,#125E40 55%,#0F5137 100%)", color: colors.cream, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.16),0 8px 20px -9px rgba(18,94,64,0.52)", transform: `translateY(${pressed * 1.5}px) scale(${1 - pressed * 0.006})`, fontFamily: fonts.sans, fontSize: 11, fontWeight: 700, letterSpacing: "0.05em"}}>
      PAY WITH YOCO
    </div>
  </div>
);

export const Notification = ({frame, opacity}: {frame: number; opacity: number}) => {
  const enter = tween(frame, 78, 98);
  return (
    <div style={{position: "absolute", left: 1586, top: 212, width: 288, zIndex: 12, opacity, transform: `translateY(${(1 - enter) * 14}px) scale(${0.985 + enter * 0.015})`, borderRadius: 15, border: `1px solid ${colors.border}`, background: "rgba(255,255,253,0.97)", boxShadow: "0 24px 60px -30px rgba(15,43,31,0.42),0 4px 14px rgba(15,43,31,0.08)", padding: 15}}>
      <div style={{display: "flex", gap: 11, alignItems: "flex-start"}}>
        <div style={{width: 30, height: 30, borderRadius: 9, background: colors.pine, display: "grid", placeItems: "center", flexShrink: 0}}>
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke={colors.cream} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11.5a7.8 7.8 0 0 1-8 7.5 8.8 8.8 0 0 1-3.8-.9L4 19.5l1.3-3.8A7.2 7.2 0 0 1 4 11.5 7.8 7.8 0 0 1 12 4a7.8 7.8 0 0 1 8 7.5Z"/></svg>
        </div>
        <div style={{minWidth: 0}}>
          <div style={{display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10}}>
            <span style={{fontFamily: fonts.sans, fontSize: 12.5, fontWeight: 700, color: colors.ink}}>Thandi</span>
            <span style={{...mono, fontSize: 7.5, letterSpacing: "0.04em"}}>now</span>
          </div>
          <div style={{fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 1.42, color: colors.text, marginTop: 3}}>Can I book for 2 tomorrow morning?</div>
        </div>
      </div>
    </div>
  );
};

export const Cursor = ({frame, opacity}: {frame: number; opacity: number}) => {
  const travel = tween(frame, 252, 286);
  const x = interpolate(travel, [0, 0.52, 1], [1515, 1450, 1394]);
  const y = interpolate(travel, [0, 0.52, 1], [830, 758, 700]);
  const click = fadeThrough(frame, 291, 296, 301, 307);
  return (
    <div style={{position: "absolute", left: x, top: y, opacity, zIndex: 20, filter: "drop-shadow(0 2px 2px rgba(15,43,31,0.24))"}}>
      <div style={{position: "absolute", left: -12, top: -12, width: 28, height: 28, borderRadius: 99, border: `1.5px solid rgba(18,94,64,${0.45 * click})`, transform: `scale(${0.45 + click * 0.8})`, opacity: click}} />
      <svg width="25" height="31" viewBox="0 0 25 31"><path d="M2 1.5v23.7l6.2-5.2 4.6 9.2 4.2-2.1-4.5-8.8 8-.3L2 1.5Z" fill="#FFFFFD" stroke="#17221C" strokeWidth="1.6" strokeLinejoin="round"/></svg>
    </div>
  );
};

export const PaymentStatus = ({progress}: {progress: number}) => (
  <div style={{position: "absolute", inset: 0, display: "grid", placeItems: "center", opacity: progress, transform: `scale(${0.985 + progress * 0.015})`}}>
    <div style={{width: 520, textAlign: "center", padding: 44, borderRadius: 18, border: `1px solid ${colors.border}`, background: colors.surface, boxShadow: cardShadow}}>
      <div style={{width: 48, height: 48, margin: "0 auto 20px", borderRadius: 99, display: "grid", placeItems: "center", background: colors.successSoft, color: colors.success}}>
        <svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6.5 12.5 3.4 3.4L18 7.8"/></svg>
      </div>
      <div style={{...mono, color: colors.success, fontSize: 10}}>Payment received</div>
      <div style={{fontFamily: fonts.display, fontSize: 62, lineHeight: 1, fontWeight: 660, letterSpacing: "-0.04em", color: colors.ink, margin: "18px 0 20px", fontVariantNumeric: "tabular-nums"}}>R900</div>
      <div style={{width: 180, height: 1, background: colors.border, margin: "0 auto 19px"}} />
      <div style={{fontFamily: fonts.sans, fontSize: 15, fontWeight: 650, color: colors.ink}}>Thandi Mokoena</div>
      <div style={{fontFamily: fonts.sans, fontSize: 12.5, color: colors.muted, marginTop: 5}}>Ocean Kayak · 2 guests</div>
    </div>
  </div>
);

export const Headline = ({children, opacity, y = 0}: {children: ReactNode; opacity: number; y?: number}) => (
  <div style={{opacity, transform: `translateY(${y + (1 - opacity) * 12}px)`, fontFamily: fonts.display, fontSize: 42, lineHeight: 1.05, fontWeight: 660, letterSpacing: "-0.035em", textAlign: "center", color: colors.ink}}>{children}</div>
);

// Local copy avoids importing the film timeline into reusable primitives.
const fadeThrough = (frame: number, enterStart: number, enterEnd: number, exitStart: number, exitEnd: number) =>
  tween(frame, enterStart, enterEnd) * (1 - tween(frame, exitStart, exitEnd));
