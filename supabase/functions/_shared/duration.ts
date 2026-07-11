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
