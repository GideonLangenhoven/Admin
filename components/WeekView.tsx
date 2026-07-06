
import React, { useMemo } from "react";
import { getAdminTimezone } from "../app/lib/admin-timezone";

export interface Slot {
    id: string;
    start_time: string;
    tour_id?: string;
    tours: { name: string };
    status: string;
    capacity_total: number;
    price_per_person_override?: number | null;
    booked: number;
    held: number;
    available_capacity?: number;
}

interface WeekViewProps {
    slots: Slot[];
    currentDate: Date;
    onSlotClick: (slot: Slot) => void;
    selectedCancelDates?: string[];
    onToggleCancelDate?: (dateStr: string) => void;
}

export default React.memo(function WeekView({ slots, currentDate, onSlotClick, selectedCancelDates, onToggleCancelDate }: WeekViewProps) {
    const days = useMemo(() => {
        const startOfWeek = new Date(currentDate);
        const dayOfWeek = startOfWeek.getDay();
        const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        startOfWeek.setDate(startOfWeek.getDate() + diff);
        startOfWeek.setHours(0, 0, 0, 0);
        return Array.from({ length: 7 }, (_, i) => {
            const d = new Date(startOfWeek);
            d.setDate(d.getDate() + i);
            return d;
        });
    }, [currentDate]);

    const slotsByDay = useMemo(() => {
        const map: Record<string, Slot[]> = {};
        for (const slot of slots) {
            const d = new Date(slot.start_time);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            if (!map[key]) map[key] = [];
            map[key].push(slot);
        }
        for (const key of Object.keys(map)) {
            map[key].sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
        }
        return map;
    }, [slots]);

    const fmtTime = (iso: string) => {
        return new Date(iso).toLocaleTimeString("en-ZA", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: getAdminTimezone(),
        });
    };

    const getVisibleAvailability = (slot: Slot) => {
        const directAvailability = slot.capacity_total - slot.booked - (slot.held || 0);
        return {
            directAvailability,
            effectiveAvailability: typeof slot.available_capacity === "number" ? slot.available_capacity : directAvailability,
        };
    };

    const nowLabel = new Date().toLocaleTimeString("en-ZA", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: getAdminTimezone(),
    });

    return (
        <div className="overflow-x-auto rounded-xl border border-gray-200">
            <div className="grid min-w-[720px] grid-cols-7 divide-x divide-gray-200 bg-white md:min-w-[800px]">
                {days.map((day) => {
                    const dateStr = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
                    const isSelected = selectedCancelDates?.includes(dateStr);
                    const todayInTz = new Date(new Date().toLocaleString("en-US", { timeZone: getAdminTimezone() }));
                    todayInTz.setHours(0, 0, 0, 0);
                    const isToday = day.toDateString() === todayInTz.toDateString();
                    const isPast = day < todayInTz;
                    const daySlots = slotsByDay[dateStr] || [];

                    return (
                        <div key={dateStr} className="flex min-w-0 flex-col">
                            <div
                                onClick={() => {
                                    if (!isPast) {
                                        onToggleCancelDate?.(dateStr);
                                    }
                                }}
                                className={`border-b border-gray-200 p-2 text-center transition-colors md:p-3 ${isPast ? "opacity-50 cursor-not-allowed bg-gray-100" :
                                        isSelected ? "cursor-pointer bg-[var(--ck-danger-soft)] hover:bg-[var(--ck-danger-soft)]" :
                                            isToday ? "cursor-pointer bg-[var(--ck-accent-soft)] hover:bg-[var(--ck-accent-soft)]" :
                                                "bg-gray-50 hover:bg-gray-100 cursor-pointer"
                                    }`}>
                                <div className="text-xs font-medium uppercase" style={{ color: isSelected && !isPast ? "var(--ck-danger)" : "var(--ck-text-muted)" }}>
                                    {day.toLocaleDateString("en-US", { weekday: "short" })}
                                </div>
                                <div className="mx-auto mt-1 flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold tabular-nums" style={isPast ? { color: "var(--ck-text-muted)" } : isSelected ? { background: "var(--ck-danger)", color: "#fff" } : isToday ? { background: "var(--ck-accent)", color: "#fff" } : { color: "var(--ck-text-strong)" }}>
                                    {day.getDate()}
                                </div>
                            </div>

                            <div className="min-h-[280px] flex-1 space-y-2 bg-white p-2">
                                {isToday && (
                                    <div className="rounded-lg px-2 py-1 text-[11px] font-semibold" style={{ background: "var(--ck-accent-soft)", color: "var(--ck-accent)" }}>
                                        Now {nowLabel}
                                    </div>
                                )}
                                {daySlots.map((slot) => {
                                    const { directAvailability, effectiveAvailability } = getVisibleAvailability(slot);
                                    const isClosed = slot.status !== "OPEN";
                                    const isResourceLimited = effectiveAvailability < directAvailability;
                                    return (
                                        <div
                                            key={slot.id}
                                            onClick={() => onSlotClick(slot)}
                                            className="p-2 rounded-lg border text-xs cursor-pointer transition-colors"
                                            style={isClosed
                                                ? { background: "var(--ck-danger-soft)", borderColor: "color-mix(in srgb, var(--ck-danger) 22%, transparent)", opacity: 0.85 }
                                                : effectiveAvailability <= 0
                                                    ? { background: "var(--ck-surface-sunken)", borderColor: "var(--ck-border-subtle)" }
                                                    : { background: "var(--ck-accent-soft)", borderColor: "color-mix(in srgb, var(--ck-accent) 22%, transparent)" }}
                                        >
                                            <div className="flex justify-between items-start mb-1">
                                                <span className="font-bold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{fmtTime(slot.start_time)}</span>
                                                {isClosed && <span className="rounded px-1 text-[10px]" style={{ background: "var(--ck-danger-soft)", color: "var(--ck-danger)" }}>Closed</span>}
                                            </div>
                                            <div className="mb-1 truncate font-medium" title={slot.tours?.name} style={{ color: "var(--ck-text)" }}>{slot.tours?.name}</div>
                                            {isResourceLimited && !isClosed && (
                                                <div className="mb-1 rounded px-1.5 py-1 text-[10px] font-medium" style={{ background: "var(--ck-amber-soft)", color: "var(--ck-amber)" }}>
                                                    Shared resource cap active
                                                </div>
                                            )}
                                            <div className="flex justify-between gap-2" style={{ color: "var(--ck-text-muted)" }}>
                                                <span className="tabular-nums">{slot.booked}/{slot.capacity_total}</span>
                                                <span className="tabular-nums" style={effectiveAvailability > 0 ? { color: "var(--ck-success)", fontWeight: 700 } : { color: "var(--ck-text-muted)" }}>
                                                    {effectiveAvailability} left
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                                {daySlots.length === 0 && (
                                    <div className="mt-4 text-center text-xs italic" style={{ color: "var(--ck-text-muted)" }}>No slots</div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
});
