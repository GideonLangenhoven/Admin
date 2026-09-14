/**
 * Per-person price when an EXISTING booking moves onto a slot.
 *
 * Last-minute deals fill unsold seats on new bookings only; rebook-booking
 * prices a reschedule onto a discounted slot at the tour's base price, so
 * admin previews must quote the same number or they promise a refund that
 * never lands.
 */
export function rescheduleUnitPrice(
  slot: { price_per_person_override?: number | null; base_price_per_person?: number | null; last_minute_at?: string | null } | undefined,
  fallback: number,
): number {
  if (!slot) return fallback;
  const base = slot.base_price_per_person ?? fallback;
  if (slot.price_per_person_override == null) return base;
  const override = Number(slot.price_per_person_override);
  // Only a genuine discount is skipped — a flag that outlived its deal must
  // never lower the price below what the slot actually costs.
  if (slot.last_minute_at && override < Number(base)) return base;
  return override;
}
