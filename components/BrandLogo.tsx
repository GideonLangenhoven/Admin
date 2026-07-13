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
  const scaledSize = Math.round(size * 1.8);
  return (
    <img
      src="/brand/bt-mark.png"
      alt="BookingTours logo"
      width={scaledSize}
      height={scaledSize}
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}

export function BrandWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display font-semibold tracking-tight ${className}`}>
      BookingTours
    </span>
  );
}
