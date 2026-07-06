/* BookingTours brand mark — dotted trail from an amber start-point to a destination ring.
   Inline SVG so it stays crisp at any size and needs no network fetch.
   variant="pine" (default) for light surfaces; variant="ivory" for pine/dark rails. */

export function BrandMark({
  size = 28,
  className = "",
  variant = "pine",
}: {
  size?: number;
  className?: string;
  variant?: "pine" | "ivory";
}) {
  const badge = variant === "ivory" ? "#F4F1E8" : "#0F2B1F";
  const trail = variant === "ivory" ? "#0F2B1F" : "#F4F1E8";
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} fill="none" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="14.5" fill={badge} />
      <path d="M19 44.5 C31 46, 21.5 23.5, 39.5 21" stroke={trail} strokeWidth="3.8" strokeLinecap="round" strokeDasharray="0.1 7" />
      <circle cx="18.5" cy="44.5" r="4.4" fill="#D9822F" />
      <circle cx="45" cy="20" r="5" stroke={trail} strokeWidth="3.2" />
    </svg>
  );
}

export function BrandWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display font-semibold tracking-tight ${className}`}>
      BookingTours
    </span>
  );
}
