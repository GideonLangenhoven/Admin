import { zonedToUtc } from "./admin-timezone";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SIMPLE_RETURN_PATHS = new Set(["/simple", "/simple/calendar", "/simple/check-ins", "/simple/bookings", "/simple/help", "/simpleguide", "/simpleguide/check-ins"]);

export function isDateKey(value: string | null | undefined): value is string {
  if (!value || !DATE_RE.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function businessDateKey(timeZone: string, instant: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(instant);
}

export function businessDayRange(date: string, timeZone: string) {
  if (!isDateKey(date)) throw new Error("Invalid date");
  const next = addDaysToDateKey(date, 1);
  return {
    startIso: new Date(zonedToUtc(date + "T00:00:00", timeZone)).toISOString(),
    endIso: new Date(zonedToUtc(next + "T00:00:00", timeZone)).toISOString(),
  };
}

export function addDaysToDateKey(date: string, days: number) {
  if (!isDateKey(date)) throw new Error("Invalid date");
  const parsed = new Date(date + "T12:00:00Z");
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function safeSimpleReturn(value: string | null | undefined, fallback = "/simple") {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  try {
    const parsed = new URL(value, "https://simple.local");
    if (parsed.origin !== "https://simple.local" || !SIMPLE_RETURN_PATHS.has(parsed.pathname)) return fallback;
    const clean = new URLSearchParams();
    const date = parsed.searchParams.get("date");
    const slot = parsed.searchParams.get("slot");
    if (isDateKey(date)) clean.set("date", date);
    if (slot && /^[0-9a-f-]{36}$/i.test(slot)) clean.set("slot", slot);
    const query = clean.toString();
    return parsed.pathname + (query ? "?" + query : "");
  } catch {
    return fallback;
  }
}

export function walkInUrl(params: { date?: string; tourId?: string; slotId?: string; returnTo?: string }) {
  const query = new URLSearchParams();
  if (isDateKey(params.date)) query.set("date", params.date);
  if (params.tourId) query.set("tour", params.tourId);
  if (params.slotId) query.set("slot", params.slotId);
  query.set("returnTo", safeSimpleReturn(params.returnTo));
  return "/simple/new-booking?" + query.toString();
}

export function checkInsUrl(date: string, slotId?: string, guide = false) {
  const query = new URLSearchParams();
  if (isDateKey(date)) query.set("date", date);
  if (slotId) query.set("slot", slotId);
  return (guide ? "/simpleguide/check-ins?" : "/simple/check-ins?") + query.toString();
}

export function bookingResolutionUrl(bookingId: string, returnTo: string, section: "waiver" | "payment" | "summary" = "summary") {
  const query = new URLSearchParams({ returnTo: safeSimpleReturn(returnTo, returnTo === "/" ? "/" : "/simple") });
  return `/bookings/${encodeURIComponent(bookingId)}?${query}#${section}`;
}

export function rememberReturnPosition(businessId: string, returnTo: string) {
  try { sessionStorage.setItem(`operator-return:${businessId}:${returnTo}`, String(window.scrollY)); } catch { /* Navigation remains available when storage is disabled. */ }
}

export function restoreReturnPosition(businessId: string, returnTo: string) {
  try {
    const key=`operator-return:${businessId}:${returnTo}`;
    const stored=sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    const position=Number(stored);
    if(stored!==null && Number.isFinite(position) && position>=0) requestAnimationFrame(()=>window.scrollTo(0,position));
  } catch { /* No offline or durable restoration is promised. */ }
}
