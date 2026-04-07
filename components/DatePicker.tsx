import React, { useState, useRef, useEffect } from "react";
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
}

export function DatePicker({ value, onChange, className = "", placeholder = "Pick a date", alignRight = false, position = "bottom", disabled }: DatePickerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const parsedDate = value ? parse(value, "yyyy-MM-dd", new Date()) : undefined;
    const validDate = isValid(parsedDate) ? parsedDate : undefined;

    return (
        <div className="relative text-left flex shrink-0" ref={ref}>
            <button
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
                <div className={`absolute z-[9999] ${position === "top" ? "bottom-full mb-1" : "top-full mt-1"} ${alignRight ? "right-0" : "left-0"} bg-[var(--ck-surface)] border border-[var(--ck-border-subtle)] rounded-xl shadow-xl p-3`}>
                    <style>{`
            .rdp { --rdp-cell-size: 38px; --rdp-accent-color: var(--ck-accent); --rdp-background-color: var(--ck-border-subtle); --rdp-accent-color-dark: var(--ck-accent); --rdp-background-color-dark: var(--ck-border-subtle); --rdp-outline: 2px solid var(--rdp-accent-color); --rdp-outline-selected: 2px solid var(--rdp-accent-color); margin: 0; }
            .rdp-day_selected, .rdp-day_selected:focus-visible, .rdp-day_selected:hover { background-color: var(--rdp-accent-color); color: white; font-weight: bold; border-radius: 8px;}
            .rdp-day { border-radius: 8px; font-weight: 500; color: var(--ck-text);}
            .rdp-months { font-family: inherit;}
            .rdp-caption_label { font-weight: 700; color: var(--ck-text-strong); }
            .rdp-head_cell { font-weight: 600; color: var(--ck-text-muted); font-size: 0.75rem; text-transform: uppercase;}
            .rdp-button:hover:not([disabled]):not(.rdp-day_selected) { background-color: var(--rdp-background-color); color: var(--ck-text-strong);}
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
        </div>
    );
}
