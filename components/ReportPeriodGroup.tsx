"use client";

import type { ReactNode } from "react";
import type { ReportPeriod } from "@/app/lib/report-booking-periods";

export function ReportPeriodPicker({ value, onChange, label }: { value: ReportPeriod; onChange: (period: ReportPeriod) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="ui-seg w-fit max-w-full">
      {([["week", "Weeks"], ["month", "Months"]] as const).map(([period, text]) => (
        <button key={period} type="button" className="ui-seg-item min-h-11" data-active={value === period} aria-pressed={value === period} onClick={() => onChange(period)}>{text}</button>
      ))}
    </div>
  );
}

export default function ReportPeriodGroup({ label, summary, children }: { label: string; summary: ReactNode; children: ReactNode }) {
  return (
    <details className="ui-card min-w-0 overflow-hidden">
      <summary className="min-h-11 cursor-pointer p-4 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ck-accent)]">
        <span className="inline-flex w-[calc(100%_-_1.5rem)] flex-wrap items-center justify-between gap-x-4 gap-y-1 align-middle">
          <span className="font-semibold" style={{ color: "var(--ck-text-strong)" }}>{label}</span>
          <span className="text-sm tabular-nums" style={{ color: "var(--ck-text-muted)" }}>{summary}</span>
        </span>
      </summary>
      {children}
    </details>
  );
}
