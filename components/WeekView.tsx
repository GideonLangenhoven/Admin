
import React from "react";
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

export default function WeekView({ slots, currentDate, onSlotClick, selectedCancelDates, onToggleCancelDate }: WeekViewProps) {
    const startOfWeek = new Date(currentDate);
    const dayOfWeek = startOfWeek.getDay();
    // Adjust to start on Monday (0 = Mon, 6 = Sun)
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    startOfWeek.setDate(startOfWeek.getDate() + diff);
    startOfWeek.setHours(0, 0, 0, 0);

    const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(startOfWeek);
        d.setDate(d.getDate() + i);
        return d;
    });

    const getSlotsForDay = (date: Date) => {
        return slots.filter((slot) => {
            const slotDate = new Date(slot.start_time);
            return (
                slotDate.getDate() === date.getDate() &&
                slotDate.getMonth() === date.getMonth() &&
                slotDate.getFullYear() === date.getFullYear()
            );
        }).sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    };

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

                    return (
                        <div key={dateStr} className="flex min-w-0 flex-col">
                            <div
                                onClick={() => {
                                    if (!isPast) {
                                        onToggleCancelDate?.(dateStr);
                                    }
                                }}
                                className={`border-b border-gray-200 p-2 text-center transition-colors md:p-3 ${isPast ? "opacity-50 cursor-not-allowed bg-gray-100" :
                                        isSelected ? "bg-red-100 border-red-200 hover:bg-red-200 cursor-pointer" :
                                            isToday ? "bg-blue-50 hover:bg-blue-100 cursor-pointer" :
                                                "bg-gray-50 hover:bg-gray-100 cursor-pointer"
                                    }`}>
                                <div className={`text-xs font-medium uppercase ${isSelected && !isPast ? "text-red-700" : "text-gray-500"}`}>
                                    {day.toLocaleDateString("en-US", { weekday: "short" })}
                                </div>
                                <div className={`mx-auto mt-1 flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${isPast ? "text-gray-400" :
                                        isSelected ? "bg-red-600 text-white" :
                                            isToday ? "bg-blue-600 text-white" : "text-gray-900"
                                    }`}>
                                    {day.getDate()}
                                </div>
                            </div>

                            <div className="min-h-[280px] flex-1 space-y-2 bg-white p-2">
                                {isToday && (
                                    <div className="rounded-lg border border-blue-100 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700">
                                        Now {nowLabel}
                                    </div>
                                )}
                                {getSlotsForDay(day).map((slot) => {
                                    const { directAvailability, effectiveAvailability } = getVisibleAvailability(slot);
                                    const isClosed = slot.status !== "OPEN";
                                    const isResourceLimited = effectiveAvailability < directAvailability;
                                    return (
                                        <div
                                            key={slot.id}
                                            onClick={() => onSlotClick(slot)}
                                            className={`p-2 rounded-lg border text-xs cursor-pointer transition-colors ${isClosed
                                                ? "bg-red-50 border-red-100 opacity-70"
                                                : effectiveAvailability <= 0
                                                    ? "bg-gray-100 border-gray-200"
                                                    : "bg-blue-50 border-blue-100 hover:border-blue-300"
                                                }`}
                                        >
                                            <div className="flex justify-between items-start mb-1">
                                                <span className="font-bold text-gray-900">{fmtTime(slot.start_time)}</span>
                                                {isClosed && <span className="text-[10px] bg-red-100 text-red-600 px-1 rounded">Closed</span>}
                                            </div>
                                            <div className="mb-1 truncate font-medium" title={slot.tours?.name}>{slot.tours?.name}</div>
                                            {isResourceLimited && !isClosed && (
                                                <div className="mb-1 rounded bg-amber-50 px-1.5 py-1 text-[10px] font-medium text-amber-700">
                                                    Shared resource cap active
                                                </div>
                                            )}
                                            <div className="flex justify-between gap-2 text-gray-500">
                                                <span>{slot.booked}/{slot.capacity_total}</span>
                                                <span className={effectiveAvailability > 0 ? "text-green-600 font-bold" : "text-gray-400"}>
                                                    {effectiveAvailability} left
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                                {getSlotsForDay(day).length === 0 && (
                                    <div className="text-center text-xs text-gray-400 mt-4 italic">No slots</div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
