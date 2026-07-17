// Pure date/day math for platform (BookingTours -> operator) invoice
// pro-ration, deliberately dependency-free (no supabase client import) —
// same discipline as billing-period.ts. Computed entirely in UTC calendar
// terms (Date.UTC()/getUTC*()) so results don't shift with the runtime's
// local timezone, per the timezone bug billing-period.ts itself documents.
//
// `asOfDate` is an explicit parameter rather than an internal `new Date()`
// call so this stays a pure, deterministic function — callers pass today's
// date; tests pass whatever fixed date the scenario needs.

export type PauseEvent = { action_type: "BILLING_PAUSED" | "BILLING_RESUMED"; created_at: string };

export type ActiveDaysResult = {
  activeDays: number;
  totalDays: number;
  pauseWindows: Array<{ start: string; end: string }>;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Shared by the platform-invoices list/generate routes so a "YYYY-MM" query
// param always maps to the same calendar-month bounds.
export function monthBounds(period: string): { periodStart: string; periodEnd: string } {
  const [y, m] = period.split("-").map(Number);
  const periodStart = `${period}-01`;
  const periodEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // day 0 of next month = last day of this one
  return { periodStart, periodEnd };
}

// Email overage for a billed month: emails sent beyond the included quota,
// charged at the per-email rate. Same formula as /api/billing/subscription's
// tenant-facing panel so the invoice always matches what the operator sees.
// Usage-based, so never pro-rated.
export function computeEmailOverage(sent: number, included: number, ratePerEmailZar: number): { overageEmails: number; overageZar: number } {
  const overageEmails = Math.max(0, Math.floor(sent) - Math.floor(included));
  const overageZar = Math.round(overageEmails * ratePerEmailZar * 100) / 100;
  return { overageEmails, overageZar };
}

function toUtcDate(isoLike: string): Date {
  const d = new Date(isoLike);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Walks the FULL chronological pause/resume history for a business (not just
// events inside the billed month) — carrying the "paused since" cursor
// across the month boundary this way means "already paused entering the
// month" falls out of the walk for free, no separate special case needed.
export function computeActiveDays(
  periodStart: string, // billed month's first day, "YYYY-MM-DD"
  periodEnd: string, // billed month's last day, "YYYY-MM-DD"
  subPeriodStart: string, // subscription's own lifetime start
  subPeriodEnd: string | null, // subscription's own lifetime end, null = open-ended
  pauseEvents: PauseEvent[], // full BILLING_PAUSED/BILLING_RESUMED history, any order
  currentStatus: string, // subscriptions.status right now
  asOfDate: string, // "today" from the caller's perspective
): ActiveDaysResult {
  const monthStart = toUtcDate(periodStart);
  const monthEnd = toUtcDate(periodEnd);
  const totalDays = daysBetween(monthStart, monthEnd) + 1;

  const subStart = toUtcDate(subPeriodStart);
  const subEnd = subPeriodEnd ? toUtcDate(subPeriodEnd) : null;

  const clippedStart = subStart > monthStart ? subStart : monthStart;
  const clippedEnd = subEnd && subEnd < monthEnd ? subEnd : monthEnd;

  // Subscription didn't exist at all during this billed month.
  if (clippedStart > clippedEnd) {
    return { activeDays: 0, totalDays, pauseWindows: [] };
  }

  const asOf = toUtcDate(asOfDate);

  const sorted = [...pauseEvents].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const pauseWindows: Array<{ start: Date; end: Date }> = [];
  let pausedSince: Date | null = null;
  for (const ev of sorted) {
    const at = toUtcDate(ev.created_at);
    if (ev.action_type === "BILLING_PAUSED") {
      if (pausedSince === null) pausedSince = at;
    } else if (ev.action_type === "BILLING_RESUMED") {
      if (pausedSince !== null) {
        pauseWindows.push({ start: pausedSince, end: at });
        pausedSince = null;
      }
    }
  }

  // Still paused with no logged resume: only extend the open window when
  // subscriptions.status agrees it's still PAUSED right now — that table is
  // the source of truth for "paused today", the audit log is just history,
  // and trusting a stale/incomplete log over it would invent paused days.
  if (pausedSince !== null && currentStatus === "PAUSED") {
    const openEnd = asOf < clippedEnd ? asOf : clippedEnd;
    // Half-open end (day after openEnd) so a pause still active on the last
    // billed day counts that day as paused, matching the closed windows above.
    pauseWindows.push({ start: pausedSince, end: new Date(openEnd.getTime() + MS_PER_DAY) });
  }

  const windowEndExclusive = new Date(clippedEnd.getTime() + MS_PER_DAY);
  let pausedDaysInWindow = 0;
  for (const w of pauseWindows) {
    const start = w.start > clippedStart ? w.start : clippedStart;
    const end = w.end < windowEndExclusive ? w.end : windowEndExclusive;
    if (end > start) pausedDaysInWindow += daysBetween(start, end);
  }

  const totalDaysInClippedWindow = daysBetween(clippedStart, clippedEnd) + 1;
  const activeDays = Math.max(0, totalDaysInClippedWindow - pausedDaysInWindow);

  return {
    activeDays,
    totalDays,
    pauseWindows: pauseWindows.map((w) => ({ start: isoDate(w.start), end: isoDate(w.end) })),
  };
}
