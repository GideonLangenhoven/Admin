"use client";

import Link from "next/link";
import { CalendarBlank, Plus } from "@phosphor-icons/react";
import { useBusinessContext } from "@/components/BusinessContext";
import DepartureCard from "@/components/simple/DepartureCard";
import { businessDateKey, walkInUrl } from "@/app/lib/simple-view";
import { useSimpleDay } from "./use-simple-day";

function longDate(date: string) {
  return new Intl.DateTimeFormat("en-ZA", { weekday: "long", day: "numeric", month: "long" }).format(new Date(date + "T12:00:00Z"));
}

export default function SimpleTodayPage() {
  const { businessId, timezone } = useBusinessContext();
  const date = businessDateKey(timezone);
  const { data, loading, error, reload } = useSimpleDay(businessId, date, timezone);
  const booked = data?.departures.reduce((sum, departure) => sum + departure.booked_guests, 0) || 0;
  const arrived = data?.departures.reduce((sum, departure) => sum + departure.arrived_guests, 0) || 0;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="ui-mono-label">{longDate(date)}</p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight" style={{ color: "var(--ck-text-strong)" }}>Today</h1>
          {!loading && !error && (
            <p className="mt-1 text-sm" style={{ color: "var(--ck-text-muted)" }}>
              {data?.departures.length || 0} departure{data?.departures.length === 1 ? "" : "s"} · {booked} booked · {arrived} arrived
            </p>
          )}
        </div>
        <Link href="/simple/calendar" className="ui-btn ui-btn-soft !h-11 !rounded-xl self-start text-sm font-semibold sm:self-auto">
          <CalendarBlank size={18} /> Browse calendar
        </Link>
      </header>

      {loading && (
        <div className="space-y-3" aria-label="Loading today’s departures">
          {[0, 1, 2].map(item => <div key={item} className="ui-skeleton h-36 rounded-2xl" />)}
        </div>
      )}

      {!loading && error && (
        <div className="ui-card p-6 text-center" role="alert">
          <h2 className="font-semibold" style={{ color: "var(--ck-text-strong)" }}>Today is unavailable</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--ck-text-muted)" }}>{error}</p>
          <button type="button" onClick={() => reload()} className="ui-btn ui-btn-primary mt-4 !h-11 !rounded-xl">Try again</button>
        </div>
      )}

      {!loading && !error && data?.departures.length === 0 && (
        <div className="ui-card px-5 py-10 text-center">
          <CalendarBlank size={30} className="mx-auto" style={{ color: "var(--ck-text-muted)" }} />
          <h2 className="mt-3 font-display text-xl font-semibold" style={{ color: "var(--ck-text-strong)" }}>No departures today</h2>
          <p className="mx-auto mt-1 max-w-md text-sm" style={{ color: "var(--ck-text-muted)" }}>Browse another day or add a walk-in once a departure is available.</p>
          <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
            <Link href="/simple/calendar" className="ui-btn ui-btn-soft !h-11 !rounded-xl">Browse calendar</Link>
            <Link href={walkInUrl({ date, returnTo: "/simple" })} className="ui-btn ui-btn-primary !h-11 !rounded-xl"><Plus size={17} /> Add walk-in</Link>
          </div>
        </div>
      )}

      {!loading && !error && data && data.departures.length > 0 && (
        <div className="space-y-3">
          {data.departures.map(departure => (
            <DepartureCard
              key={departure.id}
              departure={departure}
              date={date}
              timeZone={timezone}
              currency={data.currency}
              returnTo="/simple"
            />
          ))}
        </div>
      )}
    </div>
  );
}
