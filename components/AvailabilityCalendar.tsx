"use client";
import React, { useEffect, useState, createContext, useContext, useCallback, useMemo } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { addMonths } from "date-fns/addMonths";
import { endOfMonth } from "date-fns/endOfMonth";
import { format } from "date-fns/format";
import { isValid } from "date-fns/isValid";
import { parse } from "date-fns/parse";
import { startOfMonth } from "date-fns/startOfMonth";
import { listAvailableSlots } from "../app/lib/slot-availability";
import { getAdminTimezone } from "../app/lib/admin-timezone";

/* ── timezone offset helper ── */
function getTimezoneOffsetMs() {
    const now = new Date();
    const tzLocal = new Date(now.toLocaleString("en-US", { timeZone: getAdminTimezone() }));
    const tzUtc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
    return tzLocal.getTime() - tzUtc.getTime();
}

/* ── types ── */
interface SlotInfo {
    available: number;
    time: string; // HH:MM SAST
}
type DaySlotMap = Record<string, SlotInfo[]>; // key = YYYY-MM-DD

interface AvailabilityCalendarProps {
    value: string;          // YYYY-MM-DD
    onChange: (v: string) => void;
    tourId: string;
    businessId: string;
    minQty?: number;        // hide slots with fewer available seats than this
}

/* ── context to pass slot data + minQty into Day component ── */
const SlotDataCtx = createContext<DaySlotMap>({});
const MinQtyCtx = createContext<number>(0);

/* ── Custom Day component ──
   One seat count per day, not one per slot. The old layout pinned a number to
   each edge of a 40px cell, so an operator with two 10-seat departures saw
   "10 17 10" crammed into one box and four departures put digits on all four
   sides. The per-slot breakdown lives in the tooltip and in the timeslot
   matrix below the calendar, which have room for it. */
const CustomDay = React.memo(function CustomDay(props: any) {
    const { day, modifiers, children, ...tdProps } = props;
    const date: Date = day.date ?? day;
    const daySlots = useContext(SlotDataCtx);
    const minQty = useContext(MinQtyCtx);
    const key = format(date, "yyyy-MM-dd");
    const allSlots = daySlots[key] || [];
    const isOutside = modifiers?.outside;
    const isDisabled = modifiers?.disabled;

    // Filter out slots that don't have enough capacity for the party size
    const slots = minQty > 0 ? allSlots.filter(s => s.available >= minQty) : allSlots;
    const openSlots = slots.filter(s => s.available > 0);
    const totalOpen = openSlots.reduce((sum, s) => sum + s.available, 0);

    const showState = !isOutside && !isDisabled && slots.length > 0;
    const avail = showState ? (openSlots.length > 0 ? "open" : "full") : undefined;

    return (
        <td
            {...tdProps}
            data-avail={avail}
            title={showState
                ? slots.map(s => `${s.time} · ${s.available > 0 ? `${s.available} open` : "full"}`).join("\n")
                : undefined}
            style={{ ...(tdProps.style || {}), padding: 0, position: "relative" }}
        >
            {children}
            {avail === "open" && <span className="avail-cal-count">{totalOpen}</span>}
            {avail === "full" && <span className="avail-cal-count">full</span>}
        </td>
    );
});

/* ── main component ── */
export default function AvailabilityCalendar({ value, onChange, tourId, businessId, minQty = 0 }: AvailabilityCalendarProps) {
    const parsedDate = value ? parse(value, "yyyy-MM-dd", new Date()) : new Date();
    const validDate = isValid(parsedDate) ? parsedDate : new Date();

    const [displayMonth, setDisplayMonth] = useState(() => startOfMonth(validDate));
    const [daySlots, setDaySlots] = useState<DaySlotMap>({});

    const availabilitySummary = useMemo(() => {
        const days = Object.entries(daySlots).map(([day, slots]) => {
            const openSlots = slots.filter((slot) => slot.available >= Math.max(minQty, 1)).length;
            return { day, openSlots, totalSlots: slots.length };
        });
        const openDays = days.filter((entry) => entry.openSlots > 0).length;
        const fullDays = days.filter((entry) => entry.totalSlots > 0 && entry.openSlots === 0).length;
        return { openDays, fullDays };
    }, [daySlots, minQty]);

    const fetchMonthSlots = useCallback(async () => {
        if (!tourId || !businessId) { setDaySlots({}); return; }

        // Month range in admin timezone → convert to UTC
        const mStart = startOfMonth(displayMonth);
        const mEnd = endOfMonth(displayMonth);
        const offsetMs = getTimezoneOffsetMs();
        const utcStart = new Date(new Date(mStart.getFullYear(), mStart.getMonth(), mStart.getDate(), 0, 0, 0).getTime() - offsetMs);
        const utcEnd = new Date(new Date(mEnd.getFullYear(), mEnd.getMonth(), mEnd.getDate(), 23, 59, 59).getTime() - offsetMs);

        const data = await listAvailableSlots({
            businessId,
            tourId,
            startIso: utcStart.toISOString(),
            endIso: new Date(utcEnd.getTime() + 1000).toISOString(),
        });

        const map: DaySlotMap = {};
        for (const slot of (data || [])) {
            // Convert UTC start_time to admin timezone date key
            const dt = new Date(slot.start_time);
            const sastDate = new Date(dt.getTime() + getTimezoneOffsetMs());
            const key = format(sastDate, "yyyy-MM-dd");
            const time = format(sastDate, "HH:mm");
            const available = Math.max(0, Number(slot.available_capacity || 0));
            if (!map[key]) map[key] = [];
            map[key].push({ available, time });
        }
        setDaySlots(map);
    }, [tourId, businessId, displayMonth]);

    useEffect(() => { fetchMonthSlots(); }, [fetchMonthSlots]);

    // Sync displayMonth when the value prop changes to a different month
    useEffect(() => {
        if (validDate && startOfMonth(validDate).getTime() !== displayMonth.getTime()) {
            setDisplayMonth(startOfMonth(validDate));
        }
    }, [value]);

    return (
        <SlotDataCtx.Provider value={daySlots}>
            <MinQtyCtx.Provider value={minQty}>
                <style>{`
                /* Bookable days are solid dark blocks with white dates, so the
                   date and the seat count both read at a glance. Both themes
                   use a dark block on a light-to-mid page, so the meaning of
                   "filled in = you can sell this day" stays the same. */
                /* Declared on the wrapper so the swatches in the legend below
                   the grid pick up the same values the day cells use. */
                .avail-cal-wrap { --cal-day-bg: #24312A; --cal-day-fg: #FFFFFF; --cal-day-sub: #9FD6BB; }
                html.dark .avail-cal-wrap { --cal-day-bg: #223029; --cal-day-fg: #F1F3EE; --cal-day-sub: #8FCBAA; }
                .avail-cal {
                    --rdp-cell-size: 46px; --rdp-accent-color: var(--ck-accent);
                    --rdp-background-color: var(--ck-border-subtle);
                    margin: 0; width: 100%;
                }
                .avail-cal .rdp-months { font-family: inherit; }
                .avail-cal .rdp-month { width: 100%; }
                /* table-layout:fixed + a percentage width per cell lets the grid
                   grow to whatever column it is given, instead of staying at
                   seven fixed-width boxes with dead space beside them. */
                .avail-cal .rdp-table { width: 100%; max-width: 100%; table-layout: fixed; }
                .avail-cal td { width: 14.2857%; }
                .avail-cal .rdp-caption_label { font-weight: 700; color: var(--ck-text-strong); }
                .avail-cal .rdp-head_cell { font-weight: 600; color: var(--ck-text-muted); font-size: 0.75rem; text-transform: uppercase; }
                .avail-cal td { padding: 0 !important; border: 1px solid var(--ck-border-subtle); border-radius: 8px; }
                .avail-cal td button {
                    display: flex; align-items: flex-start; justify-content: center;
                    width: 100%; height: 46px; padding-top: 7px; border-radius: 7px; border: none;
                    cursor: pointer; font-weight: 500; font-size: 14px;
                    background: transparent; color: var(--ck-text);
                    transition: background 0.15s;
                }
                .avail-cal td button:hover { background: var(--ck-border-subtle); }
                .avail-cal td button:focus-visible { outline: 2px solid var(--ck-accent); outline-offset: -2px; border-radius: 7px; }

                /* Days with seats for this party size */
                .avail-cal td[data-avail="open"] { border-color: transparent; }
                .avail-cal td[data-avail="open"] button {
                    background: var(--cal-day-bg); color: var(--cal-day-fg); font-weight: 700;
                }
                .avail-cal td[data-avail="open"] button:hover { background: var(--ck-accent); }
                /* Departures exist but nothing left to sell. Uses --ck-text
                   rather than --ck-text-muted: muted on sunken measures 4.1:1,
                   under the 4.5:1 needed at this size. */
                .avail-cal td[data-avail="full"] button { background: var(--ck-surface-sunken); color: var(--ck-text); }

                /* Anchored to both edges rather than centre-translated, so a
                   wide value is clipped inside its own cell instead of spilling
                   over the neighbouring days. */
                .avail-cal-count {
                    position: absolute; bottom: 4px; left: 0; right: 0;
                    text-align: center; padding: 0 2px;
                    font-size: 10px; font-weight: 700; line-height: 1; letter-spacing: 0.01em;
                    color: var(--cal-day-sub); pointer-events: none; z-index: 2;
                    white-space: nowrap; overflow: hidden;
                    font-variant-numeric: tabular-nums;
                }
                .avail-cal td[data-avail="full"] .avail-cal-count { color: var(--ck-text); font-weight: 600; }

                .avail-cal td[data-selected] { border-color: var(--ck-accent); }
                .avail-cal td[data-selected] button { background: var(--ck-accent) !important; color: #fff !important; font-weight: 700; }
                .avail-cal td[data-selected] .avail-cal-count { color: rgba(255, 255, 255, 0.92); }
                .avail-cal td[data-today] { border-color: var(--ck-text-muted); }
                .avail-cal td[data-today] button { font-weight: 700; }
                .avail-cal td[data-outside] { border-color: transparent; }
                .avail-cal td[data-outside] button { opacity: 0.4; cursor: default; color: var(--ck-text-muted); }
                .avail-cal td[data-outside] button:hover { background: transparent; }
                .avail-cal table { border-collapse: separate; border-spacing: 2px; }
                @media (min-width: 640px) {
                    .avail-cal { --rdp-cell-size: 56px; }
                    .avail-cal td button { height: 56px; padding-top: 9px; font-size: 15px; }
                    .avail-cal-count { font-size: 11px; bottom: 6px; }
                }
            `}</style>
                <div className="avail-cal-wrap space-y-3">
                    <DayPicker
                        className="avail-cal"
                        mode="single"
                        selected={validDate}
                        month={displayMonth}
                        onMonthChange={setDisplayMonth}
                        onSelect={(d) => {
                            if (d) onChange(format(d, "yyyy-MM-dd"));
                        }}
                        components={{ Day: CustomDay as any }}
                        disabled={{ before: new Date(new Date().setHours(0, 0, 0, 0)) }}
                    />

                    <div className="rounded-xl px-3 py-3 text-xs" style={{ background: "var(--ck-surface-sunken)", border: "1px solid var(--ck-border-subtle)", color: "var(--ck-text)" }}>
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-[4px]" style={{ background: "var(--cal-day-bg, #24312A)" }} />Seats open</span>
                            <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-[4px]" style={{ background: "var(--ck-surface-sunken)", border: "1px solid var(--ck-border-subtle)" }} />Fully booked</span>
                            <span className="inline-flex items-center gap-2"><span className="font-semibold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{availabilitySummary.openDays}</span> days with bookable capacity</span>
                            {availabilitySummary.fullDays > 0 && (
                                <span className="inline-flex items-center gap-2"><span className="font-semibold tabular-nums" style={{ color: "var(--ck-danger)" }}>{availabilitySummary.fullDays}</span> days full for this party size</span>
                            )}
                        </div>
                    </div>
                </div>
            </MinQtyCtx.Provider>
        </SlotDataCtx.Provider>
    );
}
