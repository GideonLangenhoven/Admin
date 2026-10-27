// An unpaid admin booking without a payment link has had no message from us:
// the operator chose "Hold places, no immediate message" or left guest
// messages off. A "Booking Updated" would be the first the guest hears of it.
// The hold and payment-deadline reminders use the same payment_url gate.
export function guestNeverContacted(b: { source?: string | null; status?: string | null; payment_url?: string | null }) {
  return b.source === "ADMIN" && ["PENDING", "PENDING PAYMENT", "HELD"].includes(String(b.status)) && !b.payment_url;
}
