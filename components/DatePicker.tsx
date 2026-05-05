import React, { useState, useRef, useEffect, useCallback } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { format, parse, isValid } from "date-fns";
import { CalendarBlank as CalendarIcon } from "@phosphor-icons/react";

interface DatePickerProps {
    value: string; // YYYY-MM-DD
    onChange: (value: string) => void;
    className?: string;
    placeholder?: string;
    alignRight?: boolean;
    position?: "top" | "bottom";
    disabled?: any; // DayPicker disabled prop
    compact?: boolean; // smaller calendar
}

export function DatePicker({ value, onChange, className = "", placeholder = "Pick a date", alignRight = false, position = "bottom", disabled, compact = false }: DatePickerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [coords, setCoords] = useState({ top: 0, left: 0 });
    const btnRef = useRef<HTMLButtonElement>(null);
    const popRef = useRef<HTMLDivElement>(null);

    const cellSize = compact ? 22 : 38;
    const calWidth = cellSize * 7 + (compact ? 36 : 48);

    const updateCoords = useCallback(() => {
        if (!btnRef.current) return;
        const rect = btnRef.current.getBoundingClientRect();
        const top = position === "top" ? rect.top - 4 : rect.bottom + 4;
        let left = alignRight ? rect.right - calWidth : rect.left;
        // Clamp to viewport
        if (left < 8) left = 8;
        if (left + calWidth > window.innerWidth - 8) left = window.innerWidth - calWidth - 8;
        setCoords({ top, left });
    }, [alignRight, position, calWidth]);

    useEffect(() => {
        if (!isOpen) return;
        updateCoords();
        function handleClose(e: MouseEvent) {
            if (btnRef.current?.contains(e.target as Node)) return;
            if (popRef.current?.contains(e.target as Node)) return;
            setIsOpen(false);
        }
        function handleScroll() { updateCoords(); }
        document.addEventListener("mousedown", handleClose);
        window.addEventListener("scroll", handleScroll, true);
        window.addEventListener("resize", handleScroll);
        return () => {
            document.removeEventListener("mousedown", handleClose);
            window.removeEventListener("scroll", handleScroll, true);
            window.removeEventListener("resize", handleScroll);
        };
    }, [isOpen, updateCoords]);

    const parsedDate = value ? parse(value, "yyyy-MM-dd", new Date()) : undefined;
    const validDate = isValid(parsedDate) ? parsedDate : undefined;

    return (
        <>
            <button
                ref={btnRef}
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center justify-between px-3 py-2 text-sm bg-[var(--ck-surface)] border border-[var(--ck-border-subtle)] rounded-lg shadow-sm hover:bg-[var(--ck-border-subtle)] outline-none w-full min-w-[130px] ${className}`}
            >
                <span className={validDate ? "text-[var(--ck-text-strong)] font-medium" : "text-[var(--ck-text-muted)]"}>
                    {validDate ? format(validDate, "MMM d, yyyy") : placeholder}
                </span>
                <CalendarIcon className="w-4 h-4 ml-2 text-[var(--ck-text-muted)]" />
            </button>

            {isOpen && (
                <div
                    ref={popRef}
                    className="fixed z-[9999] bg-[var(--ck-surface)] border border-[var(--ck-border-subtle)] rounded-xl shadow-xl"
                    style={{ top: coords.top, left: coords.left, padding: compact ? 6 : 12 }}
                >
                    <style>{`
            .rdp { --rdp-cell-size: ${cellSize}px; --rdp-accent-color: var(--ck-accent); --rdp-background-color: var(--ck-border-subtle); --rdp-accent-color-dark: var(--ck-accent); --rdp-background-color-dark: var(--ck-border-subtle); --rdp-outline: 2px solid var(--rdp-accent-color); --rdp-outline-selected: 2px solid var(--rdp-accent-color); margin: 0; ${compact ? "font-size: 0.7rem;" : ""} }
            .rdp-day_selected, .rdp-day_selected:focus-visible, .rdp-day_selected:hover { background-color: var(--rdp-accent-color); color: white; font-weight: bold; border-radius: 6px;}
            .rdp-day { border-radius: 6px; font-weight: 500; color: var(--ck-text);}
            .rdp-months { font-family: inherit;}
            .rdp-caption_label { font-weight: 700; color: var(--ck-text-strong); ${compact ? "font-size: 0.75rem;" : ""} }
            .rdp-head_cell { font-weight: 600; color: var(--ck-text-muted); font-size: ${compact ? "0.6rem" : "0.75rem"}; text-transform: uppercase;}
            .rdp-button:hover:not([disabled]):not(.rdp-day_selected) { background-color: var(--rdp-background-color); color: var(--ck-text-strong);}
            .rdp-nav_button { ${compact ? "width: 20px; height: 20px;" : ""} }
          `}</style>
                    <DayPicker
                        mode="single"
                        selected={validDate}
                        disabled={disabled}
                        onSelect={(d) => {
                            if (d) {
                                onChange(format(d, "yyyy-MM-dd"));
                                setIsOpen(false);
                            }
                        }}
                    />
                </div>
            )}
        </>
    );
}
