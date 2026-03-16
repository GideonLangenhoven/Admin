"use client";
import React, { useEffect, useState, createContext, useContext, useCallback, useMemo } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { format, parse, isValid, startOfMonth, endOfMonth, addMonths } from "date-fns";
import { listAvailableSlots } from "../app/lib/slot-availability";

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
var SlotDataCtx = createContext<DaySlotMap>({});
var MinQtyCtx = createContext<number>(0);

/* ── colour palette per position ── */
var SLOT_COLORS = ["#10b981", "#a855f7", "#f59e0b", "#3b82f6"]; // brighter: emerald, purple, amber, blue
var FULL_COLOR = "#9ca3af"; // gray-400

/* ── position configs ── */
function getPositions(count: number): { top?: string; bottom?: string; left?: string; right?: string }[] {
    if (count === 1) return [
        { right: "4px", top: "50%", bottom: undefined, left: undefined },
    ];
    if (count === 2) return [
        { left: "4px", top: "50%", bottom: undefined, right: undefined },
        { right: "4px", top: "50%", bottom: undefined, left: undefined },
    ];
    if (count === 3) return [
        { top: "4px", left: "50%", bottom: undefined, right: undefined },
        { left: "4px", top: "50%", bottom: undefined, right: undefined },
        { right: "4px", top: "50%", bottom: undefined, left: undefined },
    ];
    // 4+
    return [
        { top: "4px", left: "50%", bottom: undefined, right: undefined },
        { right: "4px", top: "50%", bottom: undefined, left: undefined },
        { bottom: "4px", left: "50%", right: undefined, top: undefined },
        { left: "4px", top: "50%", bottom: undefined, right: undefined },
    ];
}

/* ── Custom Day component ── */
function CustomDay(props: any) {
    var { day, modifiers, children, ...tdProps } = props;
    var date: Date = day.date ?? day;
    var daySlots = useContext(SlotDataCtx);
    var minQty = useContext(MinQtyCtx);
    var key = format(date, "yyyy-MM-dd");
    var allSlots = daySlots[key] || [];
    var isOutside = modifiers?.outside;
    var isDisabled = modifiers?.disabled;

    // Filter out slots that don't have enough capacity for the party size
    var slots = minQty > 0 ? allSlots.filter(s => s.available >= minQty) : allSlots;

    // Limit to max 4 badge positions
    var displaySlots = slots.slice(0, 4);
    var positions = getPositions(displaySlots.length);

    return (
        <td {...tdProps} style={{ ...(tdProps.style || {}), padding: 0, position: "relative" }}>
            {children}
            {/* availability badges */}
            {!isOutside && !isDisabled && displaySlots.map((s, i) => {
                var pos = positions[i];
                var color = s.available > 0 ? SLOT_COLORS[i] : FULL_COLOR;
                var style: React.CSSProperties = {
                    position: "absolute",
                    fontSize: 10,
                    fontWeight: 800,
                    lineHeight: "1",
                    color: color,
                    pointerEvents: "none",
                    zIndex: 2,
                    whiteSpace: "nowrap",
                };
                // Apply position + transforms for centering
                if (pos.top !== undefined && pos.left === "50%") {
                    style.top = pos.top; style.left = "50%"; style.transform = "translateX(-50%)";
                } else if (pos.bottom !== undefined && pos.left === "50%") {
                    style.bottom = pos.bottom; style.left = "50%"; style.transform = "translateX(-50%)";
                } else if (pos.left !== undefined && pos.top === "50%") {
                    style.left = pos.left; style.top = "50%"; style.transform = "translateY(-50%)";
                } else if (pos.right !== undefined && pos.top === "50%") {
                    style.right = pos.right; style.top = "50%"; style.transform = "translateY(-50%)";
                }
                return <span key={i} style={style}>{s.available}</span>;
            })}
        </td>
    );
}

/* ── main component ── */
export default function AvailabilityCalendar({ value, onChange, tourId, businessId, minQty = 0 }: AvailabilityCalendarProps) {
    var parsedDate = value ? parse(value, "yyyy-MM-dd", new Date()) : new Date();
    var validDate = isValid(parsedDate) ? parsedDate : new Date();

    var [displayMonth, setDisplayMonth] = useState(() => startOfMonth(validDate));
    var [daySlots, setDaySlots] = useState<DaySlotMap>({});

    var availabilitySummary = useMemo(() => {
        var days = Object.entries(daySlots).map(([day, slots]) => {
            var openSlots = slots.filter((slot) => slot.available >= Math.max(minQty, 1)).length;
            return { day, openSlots, totalSlots: slots.length };
        });
        var openDays = days.filter((entry) => entry.openSlots > 0).length;
        var fullDays = days.filter((entry) => entry.totalSlots > 0 && entry.openSlots === 0).length;
        return { openDays, fullDays };
    }, [daySlots, minQty]);

    var fetchMonthSlots = useCallback(async () => {
        if (!tourId || !businessId) { setDaySlots({}); return; }

        // Month range in SAST → convert to UTC
        var mStart = startOfMonth(displayMonth);
        var mEnd = endOfMonth(displayMonth);
        // SAST = UTC+2 so subtract 2h to get UTC
        var utcStart = new Date(mStart.getFullYear(), mStart.getMonth(), mStart.getDate(), 0, 0, 0);
        utcStart.setHours(utcStart.getHours() - 2);
        var utcEnd = new Date(mEnd.getFullYear(), mEnd.getMonth(), mEnd.getDate(), 23, 59, 59);
        utcEnd.setHours(utcEnd.getHours() - 2);

        var data = await listAvailableSlots({
            businessId,
            tourId,
            startIso: utcStart.toISOString(),
            endIso: new Date(utcEnd.getTime() + 1000).toISOString(),
        });

        var map: DaySlotMap = {};
        for (var slot of (data || [])) {
            // Convert UTC start_time to SAST date key
            var dt = new Date(slot.start_time);
            var sastDate = new Date(dt.getTime() + 2 * 60 * 60 * 1000);
            var key = format(sastDate, "yyyy-MM-dd");
            var time = format(sastDate, "HH:mm");
            var available = Math.max(0, Number(slot.available_capacity || 0));
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
                .avail-cal { --rdp-cell-size: 40px; --rdp-accent-color: var(--ck-accent); --rdp-background-color: var(--ck-border-subtle); margin: 0; width: 100%; }
                .avail-cal .rdp-months { font-family: inherit; }
                .avail-cal .rdp-month { width: 100%; }
                .avail-cal .rdp-table { width: 100%; max-width: 100%; }
                .avail-cal .rdp-caption_label { font-weight: 700; color: var(--ck-text-strong); }
                .avail-cal .rdp-head_cell { font-weight: 600; color: var(--ck-text-muted); font-size: 0.75rem; text-transform: uppercase; }
                .avail-cal td { padding: 0 !important; border: 1px solid var(--ck-border-subtle); border-radius: 8px; }
                .avail-cal td button {
                    display: flex; align-items: center; justify-content: center;
                    width: 40px; height: 40px; border-radius: 7px; border: none;
                    cursor: pointer; font-weight: 500; font-size: 14px;
                    background: transparent; color: var(--ck-text);
                    transition: background 0.15s;
                }
                .avail-cal td button:hover { background: var(--ck-border-subtle); }
                .avail-cal td button:focus-visible { outline: 2px solid var(--ck-accent); outline-offset: -2px; border-radius: 7px; }
                .avail-cal td[data-selected] { border-color: var(--ck-accent); }
                .avail-cal td[data-selected] button { background: var(--ck-accent) !important; color: #fff !important; font-weight: 700; }
                .avail-cal td[data-today] { border-color: var(--ck-text-muted); }
                .avail-cal td[data-today] button { font-weight: 600; color: var(--ck-text-strong); }
                .avail-cal td[data-outside] { border-color: transparent; }
                .avail-cal td[data-outside] button { opacity: 0.4; cursor: default; color: var(--ck-text-muted); }
                .avail-cal td[data-outside] button:hover { background: transparent; }
                .avail-cal table { border-collapse: separate; border-spacing: 2px; }
                @media (min-width: 640px) {
                    .avail-cal { --rdp-cell-size: 44px; }
                    .avail-cal td button { width: 44px; height: 44px; }
                }
            `}</style>
                <div className="space-y-3">
                    <DayPicker
                        className="avail-cal"
                        mode="single"
                        selected={validDate}
                        month={displayMonth}
                        onMonthChange={setDisplayMonth}
                        onSelect={(d) => {
                            if (d) onChange(format(d, "yyyy-MM-dd"));
                        }}
                        components={{ Day: CustomDay }}
                        disabled={{ before: new Date(new Date().setHours(0, 0, 0, 0)) }}
                    />

                    <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 text-xs text-gray-600">
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Open seats</span>
                            <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-gray-400" />Fully booked</span>
                            <span className="inline-flex items-center gap-2"><span className="font-semibold text-gray-800">{availabilitySummary.openDays}</span> days with bookable capacity</span>
                            {availabilitySummary.fullDays > 0 && (
                                <span className="inline-flex items-center gap-2"><span className="font-semibold text-red-600">{availabilitySummary.fullDays}</span> days full for this party size</span>
                            )}
                        </div>
                    </div>
                </div>
            </MinQtyCtx.Provider>
        </SlotDataCtx.Provider>
    );
}
