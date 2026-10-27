import { addDaysToDateKey, businessDayRange } from "./simple-view";

export type BookingDateView = "day" | "week" | "month";

export function bookingDateRange(date: string, view: BookingDateView, timezone: string) {
  let firstDate = date;
  let lastDate = date;
  if (view === "week") {
    const weekday = new Date(date + "T12:00:00Z").getUTCDay();
    firstDate = addDaysToDateKey(date, -((weekday + 6) % 7));
    lastDate = addDaysToDateKey(firstDate, 6);
  } else if (view === "month") {
    firstDate = date.slice(0, 7) + "-01";
    const nextMonth = new Date(firstDate + "T12:00:00Z");
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    lastDate = addDaysToDateKey(nextMonth.toISOString().slice(0, 10), -1);
  }
  return {
    firstDate,
    lastDate,
    rangeStart: new Date(businessDayRange(firstDate, timezone).startIso),
    // list_operator_bookings uses an inclusive upper bound.
    rangeEnd: new Date(Date.parse(businessDayRange(lastDate, timezone).endIso) - 1),
  };
}
