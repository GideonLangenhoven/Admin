
import React from "react";
import { getAdminTimezone } from "../app/lib/admin-timezone";

import { Slot } from "./WeekView";

interface DayViewProps {
    slots: Slot[];
    currentDate: Date;
    onSlotClick: (slot: Slot) => void;
    selectedCancelDates?: string[];
    onToggleCancelDate?: (dateStr: string) => void;
}

export default function DayView({ slots, currentDate, onSlotClick, selectedCancelDates, onToggleCancelDate }: DayViewProps) {
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

    const daySlots = getSlotsForDay(currentDate);

    const fmtTime = (iso: string) => {
        return new Date(iso).toLocaleTimeString("en-ZA", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: getAdminTimezone(),
        });
    };

    const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
    const isSelected = selectedCancelDates?.includes(dateStr);

    const todayInTz = new Date(new Date().toLocaleString("en-US", { timeZone: getAdminTimezone() }));
    todayInTz.setHours(0, 0, 0, 0);
    const dayObj = new Date(currentDate);
    dayObj.setHours(0, 0, 0, 0);
    const isPast = dayObj < todayInTz;
    const isToday = dayObj.getTime() === todayInTz.getTime();
    const nowLabel = new Date().toLocaleTimeString("en-ZA", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: getAdminTimezone(),
    });

    const getVisibleAvailability = (slot: Slot) => {
        const directAvailability = slot.capacity_total - slot.booked - (slot.held || 0);
        return {
            directAvailability,
            effectiveAvailability: typeof slot.available_capacity === "number" ? slot.available_capacity : directAvailability,
        };
    };

    return (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div
                onClick={() => {
                    if (!isPast) {
                        onToggleCancelDate?.(dateStr);
                    }
                }}
                className={`p-4 border-b border-gray-200 flex justify-between items-center transition-colors ${isPast ? "opacity-50 cursor-not-allowed bg-gray-100" :
                        isSelected ? "bg-red-100 hover:bg-red-200 cursor-pointer" : "bg-gray-50 hover:bg-gray-100 cursor-pointer"
                    }`}
            >
                <h3 className={`font-semibold ${isSelected && !isPast ? "text-red-700" : isPast ? "text-gray-400" : "text-gray-900"}`}>
                    {currentDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                </h3>
                <span className={`text-sm ${isSelected && !isPast ? "text-red-600" : "text-gray-500"}`}>{daySlots.length} slots</span>
            </div>

            {isToday && (
                <div className="flex items-center justify-between border-b border-blue-100 bg-blue-50 px-4 py-2 text-xs font-medium text-blue-700">
                    <span>Current time marker</span>
                    <span>Now {nowLabel}</span>
                </div>
            )}

            {daySlots.length === 0 ? (
                <div className="p-12 text-center text-gray-500 italic">
                    No slots scheduled for this day.
                </div>
            ) : (
                <>
                    <div className="space-y-3 p-4 md:hidden">
                        {daySlots.map((s) => {
                            const { directAvailability, effectiveAvailability } = getVisibleAvailability(s);
                            const isResourceLimited = effectiveAvailability < directAvailability;
                            return (
                                <button
                                    key={s.id}
                                    onClick={() => onSlotClick(s)}
                                    className="w-full rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-gray-300"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="font-mono text-sm font-semibold text-gray-900">{fmtTime(s.start_time)}</p>
                                            <p className="mt-1 truncate text-sm font-medium text-gray-800">{s.tours?.name}</p>
                                        </div>
                                        <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${s.status === "OPEN" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                                            {s.status}
                                        </span>
                                    </div>
                                    {isResourceLimited && s.status === "OPEN" && (
                                        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                                            Shared resource limit is reducing sellable capacity for this slot.
                                        </div>
                                    )}
                                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-500">
                                        <div>Capacity: <span className="font-semibold text-gray-800">{s.capacity_total}</span></div>
                                        <div>Booked: <span className="font-semibold text-gray-800">{s.booked}</span></div>
                                        <div>Held: <span className="font-semibold text-gray-800">{s.held || 0}</span></div>
                                        <div>Available: <span className={`font-semibold ${effectiveAvailability > 0 ? "text-green-600" : "text-gray-400"}`}>{effectiveAvailability}</span></div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    <div className="hidden overflow-x-auto md:block">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="text-left p-3 font-medium text-gray-600">Time</th>
                                    <th className="text-left p-3 font-medium text-gray-600">Tour</th>
                                    <th className="text-left p-3 font-medium text-gray-600">Capacity</th>
                                    <th className="text-left p-3 font-medium text-gray-600">Booked</th>
                                    <th className="text-left p-3 font-medium text-gray-600">Held</th>
                                    <th className="text-left p-3 font-medium text-gray-600">Available</th>
                                    <th className="text-left p-3 font-medium text-gray-600">Status</th>
                                    <th className="text-left p-3 font-medium text-gray-600">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {daySlots.map((s) => {
                                    const { directAvailability, effectiveAvailability } = getVisibleAvailability(s);
                                    const isResourceLimited = effectiveAvailability < directAvailability;
                                    return (
                                        <tr key={s.id} className="border-t border-gray-100 hover:bg-gray-50">
                                            <td className="p-3 font-mono">{fmtTime(s.start_time)}</td>
                                            <td className="p-3 font-medium">{s.tours?.name}</td>
                                            <td className="p-3">{s.capacity_total}</td>
                                            <td className="p-3">{s.booked}</td>
                                            <td className="p-3">{s.held || 0}</td>
                                            <td className="p-3">
                                                <div className={`font-bold ${effectiveAvailability > 0 ? "text-green-600" : "text-gray-400"}`}>{effectiveAvailability}</div>
                                                {isResourceLimited && (
                                                    <div className="mt-1 text-[10px] font-medium text-amber-700">Shared resource cap</div>
                                                )}
                                            </td>
                                            <td className="p-3">
                                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${s.status === "OPEN" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                                                    {s.status}
                                                </span>
                                            </td>
                                            <td className="p-3">
                                                <button
                                                    onClick={() => onSlotClick(s)}
                                                    className={`px-3 py-1 rounded text-xs font-medium transition-colors ${s.status === "OPEN"
                                                        ? "bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200"
                                                        : "bg-red-50 text-red-600 hover:bg-red-100 border border-red-200"
                                                        }`}
                                                >
                                                    Edit Slot
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}
