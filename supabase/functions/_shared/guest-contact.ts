// An unpaid admin booking without a payment link has had no message from us:
// the operator chose "Hold places, no immediate message" or left guest
// messages off. A "Booking Updated" would be the first the guest hears of it.
// The hold and payment-deadline reminders use the same payment_url gate.
export function guestNeverContacted(b: { source?: string | null; status?: string | null; payment_url?: string | null }) {
  return b.source === "ADMIN" && ["PENDING", "PENDING PAYMENT", "HELD"].includes(String(b.status)) && !b.payment_url;
}

// Reserved domains (RFC 2606 / 6761 / 6762) and POPIA-anonymised addresses never
// take mail: a send there only bounces and costs the sending domain reputation.
// Both demo fixtures use them (Kayak's kayak-demo-NN@anonymized.local, Claire's
// guest-N@example.com). Every Resend sender checks this.
export function undeliverableEmail(email: string) {
  const domain = (email.trim().toLowerCase().split("@").pop() || "").replace(/\.$/, "");
  return /(^|\.)(local|localhost|invalid|test|example)$/.test(domain)
    || /(^|\.)example\.(com|net|org)$/.test(domain)
    || /(^|\.)anonymi[sz]ed\./.test(domain);
}
