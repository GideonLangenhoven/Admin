"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { addMonths } from "date-fns/addMonths";
import { endOfMonth } from "date-fns/endOfMonth";
import { format } from "date-fns/format";
import { startOfMonth } from "date-fns/startOfMonth";
import { supabase } from "../app/lib/supabase";
import { getAdminTimezone, zonedToUtc } from "../app/lib/admin-timezone";

/* Month quick-view of confirmed bookings per tour, opened from the slot
   calendar. Every day shows one colour-coded marker per tour that has
   confirmed bookings (the legend maps tour -> colour), same idea as the
   AvailabilityCalendar in New Booking but counting bookings, not seats.
   Expand shows the same month full-screen with per-tour guest pills. */

const CONFIRMED_STATUSES = ["PAID", "CONFIRMED"];

/* Tour colour by position in the tours list (name-ordered, so stable between
   visits). Brand chart ramp first, then fixed distinct fallbacks. */
const TOUR_COLORS = [
  "var(--ck-chart-1)", "var(--ck-chart-2)", "var(--ck-chart-3)", "var(--ck-chart-4)",
  "#d64545", "#7c5cff", "#0ea5a4", "#e879a0",
];
export function tourColor(index: number) {
  return TOUR_COLORS[index % TOUR_COLORS.length];
}

type TourRef = { id: string; name: string };
type DayTourCount = { guests: number; bookings: number };
type DayMap = Record<string, Record<string, DayTourCount>>; // dateKey -> tourId -> counts

type Props = {
  businessId: string;
  tours: TourRef[];
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  onClose: () => void;
  // Fired on user month navigation (never on mount) — the bookings page uses
  // it to keep its month filter in step with the calendar.
  onMonthChange?: (m: Date) => void;
};

function dateKeyInTz(utcIso: string, tz: string) {
  // en-CA renders as YYYY-MM-DD.
  return new Date(utcIso).toLocaleDateString("en-CA", { timeZone: tz });
}

export default function BookingsMonthCalendar({ businessId, tours, selectedDate, onSelectDate, onClose, onMonthChange }: Props) {
  const [displayMonth, setDisplayMonth] = useState(() => startOfMonth(selectedDate));
  const [dayMap, setDayMap] = useState<DayMap>({});
  const [loading, setLoading] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  const changeMonth = useCallback((m: Date) => {
    const start = startOfMonth(m);
    setDisplayMonth(start);
    onMonthChange?.(start);
  }, [onMonthChange]);

  const colorByTour = useMemo(() => {
    const m = new Map<string, string>();
    tours.forEach((t, i) => m.set(t.id, tourColor(i)));
    return m;
  }, [tours]);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const tz = getAdminTimezone();
    const mStart = format(startOfMonth(displayMonth), "yyyy-MM-dd");
    const mEnd = format(endOfMonth(displayMonth), "yyyy-MM-dd");
    // Month bounds in the operator's timezone, queried in UTC.
    const startIso = new Date(zonedToUtc(mStart + "T00:00:00", tz)).toISOString();
    const endIso = new Date(zonedToUtc(mEnd + "T23:59:59", tz)).toISOString();

    // Same embed direction the slot list already uses (slots -> nested rows),
    // scoped to this business only; nested bookings are filtered to confirmed
    // statuses client-side.
    const { data, error } = await supabase.from("slots")
      .select("start_time, tour_id, bookings(qty, status)")
      .eq("business_id", businessId)
      .gte("start_time", startIso)
      .lte("start_time", endIso);

    const map: DayMap = {};
    if (!error) {
      for (const s of (data || []) as Array<{ start_time: string; tour_id: string; bookings: Array<{ qty: number | null; status: string }> | null }>) {
        const confirmed = (s.bookings || []).filter((b) => CONFIRMED_STATUSES.includes(b.status));
        if (confirmed.length === 0) continue;
        const key = dateKeyInTz(s.start_time, tz);
        const perTour = (map[key] ||= {});
        const cur = (perTour[s.tour_id] ||= { guests: 0, bookings: 0 });
        for (const b of confirmed) {
          cur.guests += Number(b.qty || 0);
          cur.bookings += 1;
        }
      }
    }
    setDayMap(map);
    setLoading(false);
  }, [businessId, displayMonth]);

  useEffect(() => { load(); }, [load]);

  // Month totals per tour drive the legend, so an operator sees at a glance
  // which tours actually have bookings this month.
  const monthTotals = useMemo(() => {
    const totals = new Map<string, DayTourCount>();
    for (const perTour of Object.values(dayMap)) {
      for (const [tourId, c] of Object.entries(perTour)) {
        const cur = totals.get(tourId) || { guests: 0, bookings: 0 };
        cur.guests += c.guests;
        cur.bookings += c.bookings;
        totals.set(tourId, cur);
      }
    }
    return totals;
  }, [dayMap]);

  const dayTitle = useCallback((key: string) => {
    const perTour = dayMap[key];
    if (!perTour) return "";
    return tours
      .filter((t) => perTour[t.id])
      .map((t) => `${t.name}: ${perTour[t.id].guests} guest${perTour[t.id].guests === 1 ? "" : "s"} (${perTour[t.id].bookings} booking${perTour[t.id].bookings === 1 ? "" : "s"})`)
      .join("\n");
  }, [dayMap, tours]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (fullscreen) setFullscreen(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, onClose]);

  /* Compact day cell: coloured dot per tour with confirmed bookings. */
  const CompactDay = useCallback(function CompactDay(props: any) {
    const { day, modifiers, children, ...tdProps } = props;
    const date: Date = day.date ?? day;
    const key = format(date, "yyyy-MM-dd");
    const perTour = modifiers?.outside ? undefined : dayMap[key];
    const marked = perTour ? tours.filter((t) => perTour[t.id]) : [];
    return (
      <td {...tdProps} style={{ ...(tdProps.style || {}), padding: 0, position: "relative" }} title={dayTitle(key) || undefined}>
        {children}
        {marked.length > 0 && (
          <span style={{ position: "absolute", bottom: 3, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 2, pointerEvents: "none", zIndex: 2 }}>
            {marked.slice(0, 4).map((t) => (
              <span key={t.id} style={{ width: 5, height: 5, borderRadius: 9999, background: colorByTour.get(t.id) }} />
            ))}
            {marked.length > 4 && <span style={{ fontSize: 7, fontWeight: 800, lineHeight: "5px", color: "var(--ck-text-muted)" }}>+{marked.length - 4}</span>}
          </span>
        )}
      </td>
    );
  }, [dayMap, tours, colorByTour, dayTitle]);

  const legend = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {tours.map((t, i) => {
        const total = monthTotals.get(t.id);
        return (
          <span key={t.id} className="inline-flex items-center gap-1.5 text-xs" style={{ color: total ? "var(--ck-text-strong)" : "var(--ck-text-muted)" }}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: tourColor(i), opacity: total ? 1 : 0.45 }} />
            {t.name}
            {total && <span className="font-semibold tabular-nums">{total.guests}</span>}
          </span>
        );
      })}
      {tours.length === 0 && <span className="text-xs" style={{ color: "var(--ck-text-muted)" }}>No tours yet</span>}
    </div>
  );

  /* Full-screen month grid, Monday-start like the week view. */
  const fullscreenView = (() => {
    if (!fullscreen) return null;
    const mStart = startOfMonth(displayMonth);
    const gridStart = new Date(mStart);
    gridStart.setDate(gridStart.getDate() - ((gridStart.getDay() + 6) % 7)); // back to Monday
    const weeks: Date[][] = [];
    const cursor = new Date(gridStart);
    const mEnd = endOfMonth(displayMonth);
    while (cursor <= mEnd || weeks.length === 0 || (weeks[weeks.length - 1].length % 7) !== 0) {
      if (weeks.length === 0 || weeks[weeks.length - 1].length === 7) weeks.push([]);
      weeks[weeks.length - 1].push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
      if (weeks.length > 6) break;
    }
    const todayKey = format(new Date(), "yyyy-MM-dd");
    // Sits inside the backdrop element, so clicks must not bubble to its
    // close handler.
    return (
      <div className="fixed inset-0 z-[60] flex flex-col" style={{ background: "var(--ck-surface, #fff)" }} role="dialog" aria-modal="true" aria-label="Bookings month view" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6" style={{ borderColor: "var(--ck-border-subtle)" }}>
          <div className="flex items-center gap-2">
            <button onClick={() => changeMonth(addMonths(displayMonth, -1))} className="ui-btn ui-btn-ghost !h-8 !px-2.5" aria-label="Previous month">‹</button>
            <span className="min-w-[150px] text-center font-display text-lg font-semibold" style={{ color: "var(--ck-text-strong)" }}>{format(displayMonth, "MMMM yyyy")}</span>
            <button onClick={() => changeMonth(addMonths(displayMonth, 1))} className="ui-btn ui-btn-ghost !h-8 !px-2.5" aria-label="Next month">›</button>
            <button onClick={() => changeMonth(new Date())} className="ui-btn ui-btn-ghost !h-8 !px-3 !text-xs">Today</button>
          </div>
          <div className="hidden md:block">{legend}</div>
          <button onClick={() => setFullscreen(false)} className="ui-btn ui-btn-ghost !h-8 !px-3 !text-xs">Close ✕</button>
        </div>
        <div className="border-b px-4 py-2 md:hidden" style={{ borderColor: "var(--ck-border-subtle)" }}>{legend}</div>
        <div className="flex-1 overflow-auto p-3 sm:p-4">
          <div className="grid grid-cols-7 gap-1.5" style={{ minWidth: 700 }}>
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ck-text-muted)" }}>{d}</div>
            ))}
            {weeks.flat().map((d) => {
              const key = format(d, "yyyy-MM-dd");
              const outside = d.getMonth() !== displayMonth.getMonth();
              const perTour = outside ? undefined : dayMap[key];
              const marked = perTour ? tours.filter((t) => perTour[t.id]) : [];
              return (
                <button
                  key={key}
                  onClick={() => { onSelectDate(d); setFullscreen(false); onClose(); }}
                  className="flex min-h-[92px] flex-col items-stretch gap-1 rounded-xl border p-1.5 text-left transition-colors sm:min-h-[104px]"
                  style={{
                    borderColor: key === todayKey ? "var(--ck-accent)" : "var(--ck-border-subtle)",
                    background: outside ? "transparent" : "var(--ck-surface-sunken)",
                    opacity: outside ? 0.4 : 1,
                  }}
                >
                  <span className="text-[12px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>{d.getDate()}</span>
                  <span className="flex flex-col gap-1 overflow-hidden">
                    {marked.map((t) => {
                      const c = perTour![t.id];
                      return (
                        <span key={t.id} className="truncate rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold leading-tight text-white" style={{ background: colorByTour.get(t.id) }} title={`${t.name}: ${c.guests} guests (${c.bookings} bookings)`}>
                          {t.name} · {c.guests}
                        </span>
                      );
                    })}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  })();

  return (
    /* Overlay, not in-flow: an inline card gets clipped or pushed below the
       fold by the page around it. Same modal recipe as the slot editor —
       bottom sheet on mobile, centred card on desktop; backdrop click and
       Esc close it. Kept OUTSIDE any anim-fade-up wrapper: that animation
       transforms an ancestor, which would hijack position:fixed. */
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      style={{ background: "rgba(10,18,13,0.55)", backdropFilter: "blur(2px)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Confirmed bookings month view"
    >
      <div
        className="ui-card w-full max-h-[90vh] overflow-auto p-4 !rounded-t-2xl sm:w-auto sm:max-w-[92vw] sm:!rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="ui-mono-label !text-[10px]">Confirmed bookings · {format(displayMonth, "MMMM yyyy")}{loading ? " · loading…" : ""}</span>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setFullscreen(true)} className="ui-btn ui-btn-ghost !h-7 !px-2.5 !text-xs">Full screen</button>
          <button onClick={onClose} className="ui-btn ui-btn-ghost !h-7 !px-2.5 !text-xs" aria-label="Close month view">✕</button>
        </div>
      </div>
      <style>{`
        .booked-cal { --rdp-cell-size: 40px; --rdp-accent-color: var(--ck-accent); --rdp-background-color: var(--ck-border-subtle); margin: 0; }
        .booked-cal .rdp-months { font-family: inherit; }
        .booked-cal .rdp-caption_label { font-weight: 700; color: var(--ck-text-strong); }
        .booked-cal .rdp-head_cell { font-weight: 600; color: var(--ck-text-muted); font-size: 0.75rem; text-transform: uppercase; }
        .booked-cal td { padding: 0 !important; }
        .booked-cal td button {
          display: flex; align-items: center; justify-content: center;
          width: 40px; height: 40px; border-radius: 8px; border: none;
          cursor: pointer; font-weight: 500; font-size: 14px;
          background: transparent; color: var(--ck-text);
        }
        .booked-cal td button:hover { background: var(--ck-border-subtle); }
        .booked-cal td[data-selected] button { background: var(--ck-accent) !important; color: #fff !important; font-weight: 700; }
        .booked-cal td[data-today] button { font-weight: 700; color: var(--ck-text-strong); }
        .booked-cal td[data-outside] button { opacity: 0.4; }
      `}</style>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
        <DayPicker
          className="booked-cal"
          mode="single"
          selected={selectedDate}
          month={displayMonth}
          onMonthChange={changeMonth}
          onSelect={(d) => { if (d) { onSelectDate(d); onClose(); } }}
          components={{ Day: CompactDay as any }}
        />
        <div className="sm:pt-8">{legend}</div>
      </div>
      </div>
      {fullscreenView}
    </div>
  );
}
