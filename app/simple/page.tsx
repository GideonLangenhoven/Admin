"use client";

import Link from "next/link";
import { ArrowUpRight, CalendarBlank, Plus } from "@phosphor-icons/react";
import { useBusinessContext } from "@/components/BusinessContext";
import DepartureCard from "@/components/simple/DepartureCard";
import { businessDateKey, walkInUrl } from "@/app/lib/simple-view";
import { useSimpleDay } from "./use-simple-day";

function longDate(date: string) {
  return new Intl.DateTimeFormat("en-ZA", { weekday: "long", day: "numeric", month: "long" }).format(new Date(date + "T12:00:00Z"));
}

export default function SimpleTodayPage() {
  const { businessId, staffName, timezone } = useBusinessContext();
  const welcomeName = staffName?.trim();
  const date = businessDateKey(timezone);
  const { data, loading, error, reload } = useSimpleDay(businessId, date, timezone);
  const booked = data?.departures.reduce((sum, departure) => sum + departure.booked_guests, 0) || 0;
  const arrived = data?.departures.reduce((sum, departure) => sum + departure.arrived_guests, 0) || 0;

  return (
    <div className="sv-page">
      <header className="sv-intro">
        <p className="sv-eyebrow"><CalendarBlank size={16} /> Today · {longDate(date)}</p>
        <h1 className="sv-title sv-welcome">Welcome{welcomeName && <>,<br /><span>{welcomeName}</span></>}</h1>
        <p className="sv-intro-copy">Your departures. Your guests. All in one place.</p>
        <div className="sv-intro-footer">
          {!loading && !error && (
            <div className="sv-day-summary" aria-label="Today's overview">
              <span><strong>{data?.departures.length || 0}</strong> departure{data?.departures.length === 1 ? "" : "s"}</span>
              <span><strong>{booked}</strong> booked</span>
              <span><strong>{arrived}</strong> arrived</span>
            </div>
          )}
          <Link href="/simple/calendar" className="sv-text-link">Browse calendar <ArrowUpRight size={18} /></Link>
        </div>
      </header>

      <div className="sv-section-heading"><h2>Departures</h2><span>In time order</span></div>

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
        <div className="sv-departure-list">
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
