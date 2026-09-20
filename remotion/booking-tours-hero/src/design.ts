import {Easing, interpolate} from "remotion";

export const colors = {
  bg: "#F7F5F0",
  surface: "#FFFFFD",
  surfaceWarm: "#FCFBF7",
  sunken: "#F1EDE5",
  border: "rgba(16,44,32,0.09)",
  borderStrong: "rgba(16,44,32,0.17)",
  ink: "#17221C",
  text: "#46534B",
  muted: "#66736B",
  pine: "#125E40",
  pineDark: "#0F2B1F",
  pineDeeper: "#0C2117",
  mint: "#4FE0A6",
  amber: "#D9822F",
  ocean: "#0F6773",
  success: "#128A5C",
  successSoft: "rgba(18,138,92,0.10)",
  amberSoft: "rgba(217,130,47,0.13)",
  pineSoft: "rgba(18,94,64,0.08)",
  cream: "#F6F3EA",
};

export const fonts = {
  sans: "'Plus Jakarta Sans', Arial, sans-serif",
  display: "'Satoshi', 'Plus Jakarta Sans', Arial, sans-serif",
  mono: "'Geist Mono', Menlo, monospace",
};

export const ease = Easing.bezier(0.22, 1, 0.36, 1);

export const tween = (frame: number, start: number, end: number) =>
  interpolate(frame, [start, end], [0, 1], {
    easing: ease,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

export const fadeThrough = (
  frame: number,
  enterStart: number,
  enterEnd: number,
  exitStart: number,
  exitEnd: number,
) => tween(frame, enterStart, enterEnd) * (1 - tween(frame, exitStart, exitEnd));

export const cardShadow =
  "inset 0 1px 0 rgba(255,255,255,0.72), 0 2px 4px rgba(15,43,31,0.05), 0 18px 40px -22px rgba(15,43,31,0.22)";
