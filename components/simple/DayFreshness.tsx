"use client";

export default function DayFreshness({ timeZone, updatedAt, refreshing, reload }: {
  timeZone: string; updatedAt: string | null; refreshing: boolean; reload?: (quiet?: boolean) => Promise<void>;
}) {
  return <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--sv-shell-muted,var(--ck-text-muted))]">
    <p role="status">{timeZone} · {refreshing ? "Refreshing…" : updatedAt
      ? `Updated ${new Intl.DateTimeFormat("en-ZA", {hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false,timeZone}).format(new Date(updatedAt))}` : "Waiting for current data"}</p>
    {reload && <button type="button" className="ui-btn ui-btn-soft min-h-11" disabled={refreshing} onClick={() => reload(true)}>Refresh day</button>}
  </div>;
}
