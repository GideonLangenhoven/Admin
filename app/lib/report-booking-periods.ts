import { weekStartISO } from "./combo-settlements";

export type ReportPeriod = "week" | "month";
export type BookingReportPeriod = "day" | ReportPeriod;

type ReportBooking = {
  created_at?: string | null;
  slots?: { start_time?: string | null } | null;
  qty?: number | null;
};

export function groupReportRows<T>(rows: T[], period: BookingReportPeriod, timezone: string, dateOf: (row: T) => string | null | undefined) {
  const groups = new Map<string, { key: string; label: string; rows: T[] }>();
  const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  for (const row of rows) {
    const iso = dateOf(row);
    const date = iso ? new Date(iso) : null;
    const day = date && Number.isFinite(date.getTime()) ? dayFormatter.format(date) : "";
    const key = !day ? "undated" : period === "week" ? weekStartISO(day + "T12:00:00Z") : period === "month" ? day.slice(0, 7) + "-01" : day;
    if (!groups.has(key)) {
      const label = key === "undated" ? "Date unavailable" : new Date(key + "T12:00:00Z").toLocaleDateString("en-ZA", {
        timeZone: "UTC", year: "numeric", month: period === "month" ? "long" : "short", ...(period !== "month" ? {day:"numeric"} : {}),
      });
      groups.set(key, { key, label: period === "week" && day ? `Week of ${label}` : label, rows: [] });
    }
    const group = groups.get(key)!;
    group.rows.push(row);
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function groupBookingPeriods(bookings: ReportBooking[], period: BookingReportPeriod, filterBy: "slot" | "created", timezone: string) {
  return groupReportRows(bookings, period, timezone, booking => filterBy === "slot" ? booking.slots?.start_time : booking.created_at)
    .map(group => ({ key: group.key, label: group.label, bookings: group.rows.length, guests: group.rows.reduce((sum, booking) => sum + Number(booking.qty || 0), 0) }));
}
