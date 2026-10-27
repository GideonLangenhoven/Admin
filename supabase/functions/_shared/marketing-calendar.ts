export function marketingCalendarDate(at: Date, timezone: string, daysOffset = 0): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const value = (type: string) => Number(parts.find(p => p.type === type)?.value);
  // Calendar arithmetic on the local date, not 24 elapsed hours across DST.
  const shifted = new Date(Date.UTC(value("year"), value("month")-1, value("day") + daysOffset));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth()+1, day: shifted.getUTCDate() };
}
