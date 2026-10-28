import { confirmAction } from "./app-notify";

// What an operator can offer guests after a weather cancellation.
export const CANCEL_OPTIONS = [
  { id: "REFUND", label: "Refund", phrase: "a refund" },
  { id: "VOUCHER", label: "Voucher", phrase: "a voucher" },
  { id: "RESCHEDULE", label: "Reschedule", phrase: "a new date" },
];

// ["REFUND", "RESCHEDULE"] -> "a refund or a new date"
export function describeOptions(ids: string[]): string {
  const phrases = CANCEL_OPTIONS.filter((option) => ids.includes(option.id)).map((option) => option.phrase);
  return phrases.length > 1 ? phrases.slice(0, -1).join(", ") + " or " + phrases[phrases.length - 1] : phrases[0] || "";
}

// pickOptions (weather cancellations): the operator also picks which options guests get.
export async function confirmCancellation(title: string, message: string, pickOptions = false): Promise<{ offerChoice: boolean; options?: string[] } | null> {
  let options: string[] | undefined;
  const choice = await confirmAction({
    title,
    message: message + `\n\nOffer options: paid customers choose ${pickOptions ? "from the options selected below" : "a new date, voucher or refund"} in My Bookings. Notify only: sends a notice; you handle follow-up. Paid value stays available, with no refund or voucher issued.`,
    tone: "warning",
    confirmLabel: "Cancel & offer options",
    altLabel: "Cancel & notify only",
    cancelLabel: "Keep bookings",
    ...(pickOptions ? { picks: CANCEL_OPTIONS, onPicks: (ids: string[]) => { options = ids; } } : {}),
  });
  return choice ? { offerChoice: choice !== "alt", options } : null;
}
