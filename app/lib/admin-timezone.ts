"use client";

const TZ_FMT_OPTS: Intl.DateTimeFormatOptions = {
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hour12: false, hourCycle: "h23",
};

export function getAdminTimezone() {
  if (typeof window === "undefined") return "UTC";
  return localStorage.getItem("ck_admin_timezone") || "UTC";
}

export function setAdminTimezone(tz: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem("ck_admin_timezone", tz);
}

export function tzParts(d: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-US", { ...TZ_FMT_OPTS, timeZone: tz }).formatToParts(d);
  const g = (t: string) => Number(p.find(x => x.type === t)?.value ?? 0);
  return { year: g("year"), month: g("month"), day: g("day"), hours: g("hour"), mins: g("minute"), secs: g("second") };
}

export function zonedToUtc(localIso: string, tz: string): number {
  const wall = new Date(localIso + "Z");
  const wallMs = wall.getTime();
  const local = tzParts(wall, tz);
  const localMs = Date.UTC(local.year, local.month - 1, local.day, local.hours, local.mins, local.secs);
  return wallMs - (localMs - wallMs);
}

export function utcToLocalParts(utcIso: string, tz: string) {
  const d = new Date(utcIso);
  const { year, month, day, hours, mins } = tzParts(d, tz);
  return { year, month, day, hours, mins };
}

export function changeLocalTime(utcIso: string, tz: string, hours: number, mins: number): string {
  const l = utcToLocalParts(utcIso, tz);
  const iso = `${l.year}-${String(l.month).padStart(2, "0")}-${String(l.day).padStart(2, "0")}T${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00`;
  return new Date(zonedToUtc(iso, tz)).toISOString();
}

export const COMMON_TIMEZONES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "Africa/Johannesburg", label: "Africa/Johannesburg (SAST, UTC+2)" },
  { value: "Africa/Cairo", label: "Africa/Cairo (EET, UTC+2)" },
  { value: "Africa/Lagos", label: "Africa/Lagos (WAT, UTC+1)" },
  { value: "Africa/Nairobi", label: "Africa/Nairobi (EAT, UTC+3)" },
  { value: "Europe/London", label: "Europe/London (GMT/BST)" },
  { value: "Europe/Paris", label: "Europe/Paris (CET/CEST)" },
  { value: "Europe/Berlin", label: "Europe/Berlin (CET/CEST)" },
  { value: "Europe/Madrid", label: "Europe/Madrid (CET/CEST)" },
  { value: "Europe/Amsterdam", label: "Europe/Amsterdam (CET/CEST)" },
  { value: "Europe/Athens", label: "Europe/Athens (EET/EEST)" },
  { value: "America/New_York", label: "America/New York (EST/EDT)" },
  { value: "America/Chicago", label: "America/Chicago (CST/CDT)" },
  { value: "America/Denver", label: "America/Denver (MST/MDT)" },
  { value: "America/Los_Angeles", label: "America/Los Angeles (PST/PDT)" },
  { value: "America/Sao_Paulo", label: "America/Sao Paulo (BRT)" },
  { value: "America/Toronto", label: "America/Toronto (EST/EDT)" },
  { value: "Asia/Dubai", label: "Asia/Dubai (GST, UTC+4)" },
  { value: "Asia/Singapore", label: "Asia/Singapore (SGT, UTC+8)" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (JST, UTC+9)" },
  { value: "Asia/Hong_Kong", label: "Asia/Hong Kong (HKT, UTC+8)" },
  { value: "Asia/Bangkok", label: "Asia/Bangkok (ICT, UTC+7)" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata (IST, UTC+5:30)" },
  { value: "Australia/Sydney", label: "Australia/Sydney (AEST/AEDT)" },
  { value: "Australia/Perth", label: "Australia/Perth (AWST, UTC+8)" },
  { value: "Pacific/Auckland", label: "Pacific/Auckland (NZST/NZDT)" },
  { value: "UTC", label: "UTC" },
];
