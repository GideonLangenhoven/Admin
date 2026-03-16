import React, { useState, useRef, useEffect } from "react";
import { format, parse, isValid } from "date-fns";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";

interface MonthPickerProps {
    value: string; // YYYY-MM
    onChange: (value: string) => void;
    className?: string;
}

export function MonthPicker({ value, onChange, className = "" }: MonthPickerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    const parsedDate = value ? parse(value, "yyyy-MM", new Date()) : new Date();
    const validDate = isValid(parsedDate) ? parsedDate : new Date();
    const [viewYear, setViewYear] = useState(validDate.getFullYear());

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];

    return (
        <div className="relative inline-flex text-left shrink-0" ref={ref}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center justify-between px-3 py-1.5 text-sm bg-[var(--ck-surface)] border border-[var(--ck-border-subtle)] rounded-lg shadow-sm hover:bg-[var(--ck-border-subtle)] outline-none w-full min-w-[150px] ${className}`}
            >
                <span className={value ? "text-[var(--ck-text-strong)] font-medium" : "text-[var(--ck-text-muted)]"}>
                    {value ? format(validDate, "MMMM yyyy") : "Select month"}
                </span>
                <CalendarIcon className="w-4 h-4 ml-2 text-[var(--ck-text-muted)]" />
            </button>

            {isOpen && (
                <div className="absolute z-[9999] top-full mt-1 right-0 sm:left-auto bg-[var(--ck-surface)] border border-[var(--ck-border-subtle)] rounded-xl shadow-xl w-64 p-3 origin-top-right">
                    <div className="flex items-center justify-between mb-4 px-1">
                        <button type="button" onClick={() => setViewYear(y => y - 1)} className="p-1.5 rounded-md hover:bg-[var(--ck-border-subtle)] text-[var(--ck-text-muted)] transition-colors">
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="font-bold text-[var(--ck-text-strong)] text-sm">{viewYear}</span>
                        <button type="button" onClick={() => setViewYear(y => y + 1)} className="p-1.5 rounded-md hover:bg-[var(--ck-border-subtle)] text-[var(--ck-text-muted)] transition-colors">
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                        {months.map((m, i) => {
                            const isSelected = value && viewYear === validDate.getFullYear() && i === validDate.getMonth();
                            const monthVal = `${viewYear}-${String(i + 1).padStart(2, "0")}`;
                            return (
                                <button
                                    key={m}
                                    type="button"
                                    onClick={() => {
                                        onChange(monthVal);
                                        setIsOpen(false);
                                    }}
                                    className={`py-2 text-sm font-medium rounded-lg transition-colors ${isSelected
                                        ? "bg-[var(--ck-accent)] text-white shadow-sm"
                                        : "text-[var(--ck-text)] hover:bg-[var(--ck-border-subtle)]"
                                        }`}
                                >
                                    {m}
                                </button>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
