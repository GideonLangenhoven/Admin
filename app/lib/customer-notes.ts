// Build a hover tooltip from any details the customer added (special requests,
// dietary notes, booking-question answers, etc.) stored on
// bookings.custom_fields. Returns undefined when there's nothing to show, so
// the name renders plainly.
export function customerNotesTooltip(cf: Record<string, string> | null | undefined): string | undefined {
  if (!cf) return undefined;
  const parts = Object.entries(cf)
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => k.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase()) + ": " + String(v).trim());
  return parts.length ? parts.join("\n") : undefined;
}
