import React from "react";

interface CursorProps {
  x: number;
  y: number;
  opacity?: number;
  clicking?: boolean;
  visible?: boolean;
}

export const Cursor: React.FC<CursorProps> = ({
  x,
  y,
  opacity = 1,
  clicking = false,
  visible = true,
}) => {
  if (!visible || opacity <= 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        opacity,
        pointerEvents: "none",
        zIndex: 9999,
        transform: `translate(-2px, -2px) scale(${clicking ? 0.88 : 1})`,
        transformOrigin: "top left",
        filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.22))",
        transition: "none",
      }}
    >
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M3 2L10.5 21L13.8 13.8L21 10.5L3 2Z"
          fill="#1E293B"
          stroke="#FFFFFF"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
      {/* Subtle click pulse ripple if clicking */}
      {clicking && (
        <div
          style={{
            position: "absolute",
            top: 2,
            left: 2,
            width: 24,
            height: 24,
            borderRadius: "50%",
            border: "2px solid rgba(0, 217, 139, 0.7)",
            backgroundColor: "rgba(0, 217, 139, 0.2)",
            transform: "translate(-50%, -50%)",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
};
