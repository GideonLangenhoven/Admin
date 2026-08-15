// Even integer percentage split for single-operator combos. The split has no
// money-movement meaning when every leg belongs to the collector (settlement
// skips collector legs), but it still drives per-child-booking revenue
// attribution, so distribute evenly instead of dumping 100% on leg one.
// Integers only: the API validates sum === 100 and floats don't sum cleanly.
export function evenPercentSplit(n: number): number[] {
  const base = Math.floor(100 / n);
  const remainder = 100 - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}
