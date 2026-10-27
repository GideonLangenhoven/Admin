// Pure date math, deliberately dependency-free (no supabase client import) so
// it stays testable in isolation and safe to import from any runtime.
// Shared by app/api/billing/subscription and app/api/billing/seats so the two
// routes can never drift on how a billing period's start/end is derived.
// subscriptions.period_end is often null while a subscription is open-ended;
// falls back to the current calendar month so callers always get real dates.
//
// Deliberately computed in UTC calendar terms throughout: constructing the
// fallback end date via the LOCAL-timezone Date constructor and then calling
// .toISOString() silently shifts the result back a calendar day for any
// timezone ahead of UTC (e.g. SAST, UTC+2) — local midnight on day D
// serializes to UTC as 22:00 on day D-1. Reading/writing everything via the
// UTC getters/Date.UTC() makes this correct regardless of the runtime's
// local timezone.
//
// period_start is the signup date and never advances, so for an open-ended
// subscription it only bounds the first month; after that the period is the
// current calendar month.
export function periodBounds(rawStart: string | null, rawEnd: string | null) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const signup = rawStart ? new Date(rawStart) : monthStart;
  const hasEnd = !!rawEnd && !Number.isNaN(new Date(rawEnd).getTime());
  const start = hasEnd || signup > monthStart ? signup : monthStart;
  const end = hasEnd
    ? new Date(rawEnd!)
    : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  return {
    billing_cycle_start: start.toISOString().slice(0, 10),
    billing_cycle_end: end.toISOString().slice(0, 10),
  };
}
