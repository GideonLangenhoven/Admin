/* BookingTours brand mark — the "B" monogram, solid pine with a wave-textured
   mint counter.

   variant="pine" (default) for light surfaces; variant="ivory" for the dark
   pine sidebar. The variant is NOT cosmetic: the pine body is 61% of the mark
   and scores 1.95:1 against the --ck-sidebar rail (#0F2B1F), so on dark the
   solid half all but disappears and only the mint counter reads. The ivory
   asset recolours that body and keeps the mint. */

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
      src={variant === "ivory" ? "/brand/bt-mark-ivory.png" : "/brand/bt-mark.png"}
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
