import { zonedToUtc, normalize24HourTime } from "./admin-timezone";

export type TourSlotSchedule = {
  slotDateMode: "range" | "specific";
  slotDates: string[];
  slotStartDate: string;
  slotEndDate: string;
  slotDays: number[];
  slotTimes: string[];
};

function calendarDate(value: string): Date {
  const date = new Date(value + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Please select valid tour dates.");
  }
  return date;
}

export function buildTourSlotStartTimes(schedule: TourSlotSchedule, timezone: string): string[] {
  let dates: string[];
  if (schedule.slotDateMode === "specific") {
    dates = [...new Set(schedule.slotDates.filter(Boolean))].sort();
    if (dates.length === 0) throw new Error("Please select at least one specific date.");
    dates.forEach(calendarDate);
  } else {
    if (!schedule.slotStartDate || !schedule.slotEndDate) throw new Error("Please select a start date and an end date.");
    const cursor = calendarDate(schedule.slotStartDate);
    const end = calendarDate(schedule.slotEndDate);
    if (cursor > end) throw new Error("End date must be on or after start date.");
    if (schedule.slotDays.length === 0) throw new Error("Please select at least one day of the week.");
    dates = [];
    for (; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      if (schedule.slotDays.includes(cursor.getUTCDay())) dates.push(cursor.toISOString().slice(0, 10));
    }
    if (dates.length === 0) throw new Error("No slots to create: there are no matching days in the selected date range.");
  }

  const enteredTimes = schedule.slotTimes.map(time => time.trim()).filter(Boolean);
  if (enteredTimes.length === 0) throw new Error("Please enter at least one start time.");
  const normalizedTimes = enteredTimes.map(normalize24HourTime);
  if (normalizedTimes.some(time => time === null)) throw new Error("Please enter valid start times using the 24-hour clock, for example 18:00 or 1800.");
  const times = [...new Set(normalizedTimes as string[])];

  return dates.flatMap(date => times.map(time => new Date(zonedToUtc(`${date}T${time}:00`, timezone)).toISOString()));
}
