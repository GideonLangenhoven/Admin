import { amountOutstanding, type MoneyBooking } from "./report-accounting";
import { addDaysToDateKey, businessDateKey, businessDayRange } from "./simple-view";

export function operatorDashboardRange(timeZone: string, instant = new Date()) {
  const date = businessDateKey(timeZone, instant);
  const today = businessDayRange(date, timeZone);
  return {
    p_today_start: today.startIso,
    p_tomorrow_start: today.endIso,
    p_day_after: businessDayRange(addDaysToDateKey(date, 1), timeZone).endIso,
    p_week_ago: new Date(instant.getTime() - 7 * 86_400_000).toISOString(),
    p_month_start: businessDayRange(date.slice(0, 8) + "01", timeZone).startIso,
    p_now: instant.toISOString(),
  };
}

export type ArrivalBooking = MoneyBooking & {
  qty: number; arrived_count: number; waiver_status?: string | null;
  unpaid_arrival_approved?: boolean;
};

export function arrivalReadiness(booking: ArrivalBooking, { requirePaid = false } = {}) {
  const due = amountOutstanding(booking);
  const active = ["PAID", "CONFIRMED", "COMPLETED"].includes(booking.status || "");
  const approved = !requirePaid && booking.unpaid_arrival_approved === true;
  const paymentReady = active && (due <= 0.005 || approved);
  const waiverReady = booking.waiver_status === "SIGNED";
  const resolutionSection: "summary" | "payment" | "waiver" = !active ? "summary" : !paymentReady ? "payment" : !waiverReady ? "waiver" : "summary";
  const resolutionLabel = !active ? "Review booking status" : !paymentReady ? "Review payment" : !waiverReady ? "Resolve waiver" : "Review booking";
  return {
    due, approved, paymentReady, waiverReady, resolutionSection, resolutionLabel,
    canIncrease: booking.qty > 0 && paymentReady && waiverReady,
    reason: !active ? "Confirm booking" : !paymentReady
      ? requirePaid ? "Payment must be received in full before recording arrivals." : "Record the balance received, or ask an admin to approve account/reseller arrival."
      : !waiverReady ? "Resolve waiver" : "",
  };
}

export function groupDepartureBookings<T extends { id: string; slot_id: string; slots: { start_time?: string } | null }>(bookings: T[]) {
  const groups = new Map<string, T[]>();
  for (const booking of bookings) {
    // A time is not an identity: different activities can depart simultaneously.
    const key = booking.slot_id || booking.id;
    const group = groups.get(key) || [];
    group.push(booking);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => (a[0].slots?.start_time || "").localeCompare(b[0].slots?.start_time || "") || a[0].slot_id.localeCompare(b[0].slot_id));
}

export function nextManifestDepartures<T extends { timeRaw: string }>(departures: T[], now: number) {
  // Keep the current departure during the existing four-minute check-in grace period.
  const upcoming = departures.filter(slot => Date.parse(slot.timeRaw) + 4 * 60_000 >= now);
  const nextTime = Math.min(...upcoming.map(slot => Date.parse(slot.timeRaw)));
  return upcoming.filter(slot => Date.parse(slot.timeRaw) === nextTime);
}
