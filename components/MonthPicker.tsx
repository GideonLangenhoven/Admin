import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { format, parse, isValid } from "date-fns";
import { CalendarBlank as CalendarIcon, CaretLeft as ChevronLeft, CaretRight as ChevronRight } from "@phosphor-icons/react";

interface MonthPickerProps {
    value: string; // YYYY-MM
    onChange: (value: string) => void;
    className?: string;
}

export function MonthPicker({ value, onChange, className = "" }: MonthPickerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const popRef = useRef<HTMLDivElement>(null);
    const [coords, setCoords] = useState({ top: 0, left: 0 });

    const updateCoords = useCallback(() => {
        if (!ref.current || !popRef.current) return;
        const rect = ref.current.getBoundingClientRect();
        const { offsetWidth: width, offsetHeight: height } = popRef.current;
        const top = rect.bottom + height + 4 <= window.innerHeight - 8 ? rect.bottom + 4 : rect.top - height - 4;
        setCoords({
            top: Math.max(8, Math.min(top, window.innerHeight - height - 8)),
            left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
        });
    }, []);

    useLayoutEffect(() => {
        if (!isOpen) return;
        updateCoords();
        const observer = new ResizeObserver(updateCoords);
        if (popRef.current) observer.observe(popRef.current);
        window.addEventListener("scroll", updateCoords, true);
        window.addEventListener("resize", updateCoords);
        return () => {
            observer.disconnect();
            window.removeEventListener("scroll", updateCoords, true);
            window.removeEventListener("resize", updateCoords);
        };
    }, [isOpen, updateCoords]);

    const parsedDate = value ? parse(value, "yyyy-MM", new Date()) : new Date();
    const validDate = isValid(parsedDate) ? parsedDate : new Date();
    const [viewYear, setViewYear] = useState(validDate.getFullYear());

    useEffect(() => {
        if (!isOpen) return;
        function handleClickOutside(event: MouseEvent) {
            if (!ref.current?.contains(event.target as Node) && !popRef.current?.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                setIsOpen(false);
                ref.current?.querySelector("button")?.focus();
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [isOpen]);

    const months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];

    return (
        <div className="relative inline-flex text-left shrink-0" ref={ref}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
                aria-haspopup="dialog"
                className={`flex items-center justify-between px-3 py-1.5 text-sm bg-[var(--ck-surface)] border border-[var(--ck-border-subtle)] rounded-lg shadow-sm hover:bg-[var(--ck-border-subtle)] outline-none w-full min-w-[150px] ${className}`}
            >
                <span className={value ? "text-[var(--ck-text-strong)] font-medium" : "text-[var(--ck-text-muted)]"}>
                    {value ? format(validDate, "MMMM yyyy") : "Select month"}
                </span>
                <CalendarIcon className="w-4 h-4 ml-2 text-[var(--ck-text-muted)]" />
            </button>

            {isOpen && createPortal(
                <div ref={popRef} role="dialog" aria-label="Choose month"
                    className="fixed z-[9999] bg-[var(--ck-surface)] border border-[var(--ck-border-subtle)] rounded-xl shadow-xl w-64 max-w-[calc(100vw-16px)] p-3"
                    style={{ top: coords.top, left: coords.left, maxHeight: "calc(100dvh - 16px)", overflowY: "auto" }}>
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
                </div>,
                document.body
            )}
        </div>
    );
}
