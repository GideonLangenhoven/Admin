import { bookingCustomFieldEntries } from "../../supabase/functions/_shared/booking-custom-fields";

// Build a hover tooltip from any details the customer added (special requests,
// dietary notes, booking-question answers, etc.) stored on
// bookings.custom_fields. Returns undefined when there's nothing to show, so
// the name renders plainly.
export function customerNotesTooltip(cf: Record<string, unknown> | null | undefined): string | undefined {
  if (!cf) return undefined;
  const parts = bookingCustomFieldEntries(cf).map(field => field.label + ": " + field.value);
  return parts.length ? parts.join("\n") : undefined;
}
