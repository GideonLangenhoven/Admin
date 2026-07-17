// Human duration for tours: "90 min", "2 hours", "3 days".
export function formatDuration(minutes: number | null | undefined): string {
  const m = Number(minutes || 0);
  if (m >= 1440) {
    const d = m / 1440;
    const n = Number.isInteger(d) ? d : Math.round(d * 10) / 10;
    return n + (n === 1 ? " day" : " days");
  }
  if (m >= 60 && m % 60 === 0) {
    const h = m / 60;
    return h + (h === 1 ? " hour" : " hours");
  }
  return m + " min";
}

// Last calendar day of a tour. Whole-day durations end ON the last day
// (a 3-day tour departing Mon ends Wed), not the morning after.
// Mirrors app/lib/duration.ts tourEndDate.
export function tourEndDate(startIso: string, minutes: number | null | undefined): Date | null {
  if (!startIso) return null;
  const start = new Date(startIso);
  if (isNaN(start.getTime())) return null;
  const m = Number(minutes || 0);
  if (m < 1440) return start;
  const days = Math.ceil(m / 1440);
  return new Date(start.getTime() + (days - 1) * 86400000);
}
