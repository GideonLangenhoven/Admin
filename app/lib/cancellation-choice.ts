import { confirmAction } from "./app-notify";

export async function confirmCancellation(title: string, message: string): Promise<{ offerChoice: boolean } | null> {
  const choice = await confirmAction({
    title,
    message: message + "\n\nOffer options: paid customers choose a new date, voucher or refund in My Bookings. Notify only: sends a notice; you handle follow-up. Paid value stays available, with no refund or voucher issued.",
    tone: "warning",
    confirmLabel: "Cancel & offer options",
    altLabel: "Cancel & notify only",
    cancelLabel: "Keep bookings",
  });
  return choice ? { offerChoice: choice !== "alt" } : null;
}
