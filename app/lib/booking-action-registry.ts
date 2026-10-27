import { amountReceived } from "./report-accounting";
import { contactPhoneNumber } from "./contact-links";

// M3: the one list of Guest actions. The bookings list and the booking page
// both build their actions here, so a booking offers the same actions, worded
// the same and available under the same rules, wherever it is opened.
export type GuestActionKey =
  | "view" | "edit" | "whatsapp" | "whatsapp-device" | "rebook" | "mark-paid" | "payment-link"
  | "payment-reminder" | "allow-unpaid" | "reschedule-link" | "refund" | "resend-invoice" | "cancel";

export type GuestActionBooking = {
  status: string;
  total_amount: number | null;
  total_captured?: number | null;
  voucher_amount_paid?: number | null;
  phone?: string | null;
  payment_url?: string | null;
  allow_unpaid?: boolean | null;
  pending_reschedule?: unknown;
};

export type GuestAction = {
  key: GuestActionKey;
  label: string;
  mobileLabel?: string;
  description: string;
  disabled?: boolean;
  title?: string;
  demoAction?: string;
  tone?: "gray" | "blue" | "green" | "red" | "amber";
};

// These open a dialog or ask before changing anything, so a link may open
// them directly. Any other action asks first when it is opened from a link.
export const DIALOG_FIRST_ACTIONS: ReadonlySet<GuestActionKey> = new Set<GuestActionKey>(["edit", "whatsapp", "rebook", "mark-paid", "refund", "cancel"]);

export function isPaid(b: Pick<GuestActionBooking, "status" | "total_amount" | "total_captured">) {
  return ["PAID", "CONFIRMED", "COMPLETED"].includes(b.status)
    && amountReceived(b) + 0.005 >= Number(b.total_amount || 0);
}

export function bookingPaidAmount(b: GuestActionBooking) {
  return Math.min(Number(b.total_amount || 0), amountReceived(b)) + Number(b.voucher_amount_paid || 0);
}

// busy: another action is running on this booking; link, invoice and
// reschedule are the actions that show their own progress label.
export function guestActions(b: GuestActionBooking, busy: { action?: boolean; link?: boolean; invoice?: boolean; reschedule?: boolean } = {}): GuestAction[] {
  const paid = isPaid(b);
  const cancelled = b.status === "CANCELLED";
  const confirmed = ["PAID", "CONFIRMED", "COMPLETED"].includes(b.status);
  const devicePhone = contactPhoneNumber(b.phone);
  return [
    { key: "view", label: "View", mobileLabel: "View booking", description: "Open the complete booking record.", tone: "blue" },
    { key: "edit", label: "Edit", mobileLabel: "Edit booking", description: "Correct guest and reservation details.", disabled: busy.action },
    { key: "whatsapp", label: "WhatsApp", description: "Start a message in the guest conversation.", disabled: !b.phone, tone: "green" },
    { key: "whatsapp-device", label: "WhatsApp on device", description: "Open this number in WhatsApp.", disabled: !devicePhone, title: !devicePhone ? "Add a valid phone number first." : undefined, tone: "green" },
    { key: "rebook", label: "Rebook", description: "Move this party to another available departure.", disabled: busy.action },
    { key: "mark-paid", label: "Mark Paid", description: "Record money received outside online checkout.", disabled: busy.action || paid, tone: "green" },
    { key: "payment-link", label: busy.link ? "Generating…" : "Payment Link", demoAction: "booking.payment", description: "Send a link for the balance due.", disabled: busy.link || paid || cancelled, tone: "blue" },
    { key: "payment-reminder", label: "Payment Reminder", description: "Resend the booking’s existing checkout link.", disabled: busy.action || paid || cancelled || !b.payment_url, title: !b.payment_url ? "Send a payment link first." : undefined, tone: "amber" },
    { key: "allow-unpaid", label: b.allow_unpaid ? "Require Payment" : "Allow Without Payment", description: b.allow_unpaid ? "Restore reminders and the payment deadline." : "Keep places for pay on arrival.", disabled: busy.action || paid || cancelled },
    ...(b.pending_reschedule ? [{ key: "reschedule-link" as const, label: "Reschedule Payment Link", demoAction: "booking.reschedule-link", description: "Request the reschedule balance.", disabled: busy.reschedule, tone: "blue" as const }] : []),
    { key: "refund", label: "Refund", demoAction: "booking.refund", description: "Review the eligible refund before submitting it.", disabled: busy.action || bookingPaidAmount(b) <= 0 || cancelled, title: bookingPaidAmount(b) <= 0 ? "Nothing to refund: no payment received." : undefined, tone: "amber" },
    { key: "resend-invoice", label: busy.invoice ? "Resending…" : "Resend Invoice", demoAction: "booking.invoice", description: "Send the latest booking invoice again.", disabled: busy.invoice || !confirmed, title: !confirmed ? "Confirm the booking before resending its invoice." : undefined, tone: "blue" },
    { key: "cancel", label: "Cancel", description: "Cancel this booking and release places.", disabled: busy.action || cancelled, tone: "red" },
  ];
}
