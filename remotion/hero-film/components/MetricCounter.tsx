import React from "react";
import { typography } from "../theme";

interface MetricCounterProps {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  style?: React.CSSProperties;
  className?: string;
}

export const MetricCounter: React.FC<MetricCounterProps> = ({
  value,
  prefix = "",
  suffix = "",
  decimals = 0,
  style = {},
}) => {
  const formatted = decimals > 0
    ? value.toFixed(decimals)
    : Math.round(value).toLocaleString("en-ZA");

  return (
    <span
      style={{
        fontFamily: typography.display,
        fontVariantNumeric: "tabular-nums",
        letterSpacing: "-0.02em",
        ...style,
      }}
    >
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
};
