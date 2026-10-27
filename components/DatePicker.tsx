import React, { useState, useRef, useEffect, useCallback, useId } from "react";
import { createPortal } from "react-dom";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { format, parse, isValid } from "date-fns";
import { CalendarBlank as CalendarIcon, X } from "@phosphor-icons/react";
import { parseDateInput } from "../app/lib/date-input";

interface DatePickerProps {
    value: string; // YYYY-MM-DD
    onChange: (value: string) => void;
    className?: string;
    placeholder?: string;
    alignRight?: boolean;
    position?: "top" | "bottom";
    disabled?: any; // DayPicker disabled prop
    compact?: boolean; // smaller calendar
    editable?: boolean;
}

export function DatePicker({ value, onChange, className = "", placeholder = "Pick a date", alignRight = false, position = "bottom", disabled, compact = false, editable = false }: DatePickerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [coords, setCoords] = useState({ top: 0, left: 0 });
    const btnRef = useRef<HTMLDivElement>(null);
    const popRef = useRef<HTMLDivElement>(null);
    const [inputText, setInputText] = useState(() => {
        const date = value ? parse(value, "yyyy-MM-dd", new Date()) : undefined;
        return isValid(date) ? format(date!, "dd/MM/yyyy") : "";
    });
    const [inputError, setInputError] = useState(false);
    const inputHintId = useId();

    useEffect(() => {
        const date = value ? parse(value, "yyyy-MM-dd", new Date()) : undefined;
        setInputText(isValid(date) ? format(date!, "dd/MM/yyyy") : "");
        setInputError(false);
    }, [value]);

    function commitInput() {
        if (!inputText.trim()) { onChange(""); setInputError(false); return; }
        const date = parseDateInput(inputText);
        setInputError(!date);
        if (date) { onChange(date); setInputText(format(parse(date, "yyyy-MM-dd", new Date()), "dd/MM/yyyy")); }
    }

    useEffect(() => {
        setMounted(true);
    }, []);

    const cellSize = compact ? 22 : 38;
    const calWidth = cellSize * 7 + (compact ? 36 : 48);

    const updateCoords = useCallback(() => {
        if (!btnRef.current) return;
        const rect = btnRef.current.getBoundingClientRect();
        const calendarWidth = popRef.current?.offsetWidth || calWidth;
        const calendarHeight = popRef.current?.offsetHeight || 0;
        let top = position === "top" ? rect.top - calendarHeight - 4 : rect.bottom + 4;
        if (top + calendarHeight > window.innerHeight - 8) top = rect.top - calendarHeight - 4;
        top = Math.max(8, Math.min(top, window.innerHeight - calendarHeight - 8));
        const left = Math.max(8, Math.min(alignRight ? rect.right - calendarWidth : rect.left, window.innerWidth - calendarWidth - 8));
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
        function handleKey(event: KeyboardEvent) {
            if (event.key === "Escape") {
                btnRef.current?.querySelector<HTMLElement>("input, button")?.focus();
                setIsOpen(false);
            }
        }
        const resizeObserver = new ResizeObserver(updateCoords);
        if (popRef.current) resizeObserver.observe(popRef.current);
        document.addEventListener("mousedown", handleClose);
        document.addEventListener("keydown", handleKey);
        window.addEventListener("scroll", handleScroll, true);
        window.addEventListener("resize", handleScroll);
        return () => {
            resizeObserver.disconnect();
            document.removeEventListener("mousedown", handleClose);
            document.removeEventListener("keydown", handleKey);
            window.removeEventListener("scroll", handleScroll, true);
            window.removeEventListener("resize", handleScroll);
        };
    }, [isOpen, updateCoords]);

    const parsedDate = value ? parse(value, "yyyy-MM-dd", new Date()) : undefined;
    const validDate = isValid(parsedDate) ? parsedDate : undefined;

    return (
        <>
          <div ref={btnRef} className="relative w-full">
            {editable ? (
                <>
                    <div className={`flex min-h-11 items-center rounded-lg border border-[var(--ck-border-subtle)] bg-[var(--ck-surface)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--ck-accent)] ${className}`}>
                        <input
                            type="text"
                            aria-label="Invoice date"
                            aria-describedby={inputHintId}
                            aria-invalid={inputError || undefined}
                            placeholder={placeholder}
                            value={inputText}
                            onFocus={() => setIsOpen(true)}
                            onChange={event => { setInputText(event.target.value); setInputError(false); if (!event.target.value) onChange(""); }}
                            onBlur={commitInput}
                            onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commitInput(); setIsOpen(false); } }}
                            className="min-w-0 flex-1 bg-transparent py-2 pl-3 text-base text-[var(--ck-text-strong)] outline-none placeholder:text-[var(--ck-text-muted)] sm:text-sm"
                        />
                        {(inputText || value) && <button type="button" aria-label="Clear date" onClick={() => { setInputText(""); setInputError(false); onChange(""); setIsOpen(false); }} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center text-[var(--ck-text-muted)]"><X size={14} aria-hidden="true" /></button>}
                        <button type="button" aria-label="Choose date" aria-expanded={isOpen} onClick={() => setIsOpen(!isOpen)} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center text-[var(--ck-text-muted)]"><CalendarIcon size={18} aria-hidden="true" /></button>
                    </div>
                    <p id={inputHintId} className={inputError ? "mt-1 text-xs text-[var(--ck-danger)]" : "sr-only"}>{inputError ? "Enter a valid date, e.g. 21/10/2026." : "Type day/month/year or choose a date from the calendar."}</p>
                </>
            ) : (
            <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center justify-between px-3 py-2 text-sm bg-[var(--ck-surface)] border border-[var(--ck-border-subtle)] rounded-lg shadow-sm hover:bg-[var(--ck-border-subtle)] outline-none w-full min-w-[130px] ${className}`}
            >
                <span className={validDate ? "text-[var(--ck-text-strong)] font-medium" : "text-[var(--ck-text-muted)]"}>
                    {validDate ? format(validDate, "MMM d, yyyy") : placeholder}
                </span>
                <CalendarIcon className="w-4 h-4 ml-2 text-[var(--ck-text-muted)]" />
            </button>
            )}
          </div>

            {isOpen && mounted && createPortal(
                <div
                    ref={popRef}
                    className="fixed z-[9999] bg-[var(--ck-surface)] border border-[var(--ck-border-subtle)] rounded-xl p-0 shadow-xl min-[360px]:p-3"
                    style={{ top: coords.top, left: coords.left, maxHeight: "calc(100vh - 16px)", overflowY: "auto" }}
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
                        defaultMonth={validDate}
                        disabled={disabled}
                        onSelect={(d) => {
                            if (d) {
                                onChange(format(d, "yyyy-MM-dd"));
                                setIsOpen(false);
                            }
                        }}
                    />
                </div>,
                document.body
            )}
        </>
    );
}
