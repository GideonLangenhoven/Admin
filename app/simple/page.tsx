"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, CalendarBlank, CaretLeft, CaretRight, Plus } from "@phosphor-icons/react";
import { useBusinessContext } from "@/components/BusinessContext";
import DepartureCard from "@/components/simple/DepartureCard";
import { addDaysToDateKey, businessDateKey, isDateKey, walkInUrl } from "@/app/lib/simple-view";
import { useSimpleDay } from "./use-simple-day";

function longDate(date: string) {
  return new Intl.DateTimeFormat("en-ZA", { weekday: "long", day: "numeric", month: "long" }).format(new Date(date + "T12:00:00Z"));
}

function SimpleDayContent() {
  const { businessId, staffName, timezone } = useBusinessContext();
  const router = useRouter();
  const searchParams = useSearchParams();
  const welcomeName = staffName?.trim();
  const today = businessDateKey(timezone);
  const requestedDate = searchParams.get("date");
  const date = isDateKey(requestedDate) ? requestedDate : today;
  const { data, loading, error, reload } = useSimpleDay(businessId, date, timezone);
  const booked = data?.departures.reduce((sum, departure) => sum + departure.booked_guests, 0) || 0;
  const arrived = data?.departures.reduce((sum, departure) => sum + departure.arrived_guests, 0) || 0;
  const returnTo = date === today ? "/simple" : `/simple?date=${encodeURIComponent(date)}`;

  function selectDate(next: string) {
    if (!isDateKey(next)) return;
    router.replace(next === today ? "/simple" : `/simple?date=${encodeURIComponent(next)}`, { scroll: false });
  }

  return (
    <div className="sv-page">
      <header className="sv-intro">
        <p className="sv-eyebrow"><CalendarBlank size={16} /> {date === today ? "Today" : "Selected day"} · {longDate(date)}</p>
        <h1 className="sv-title sv-welcome">Welcome{welcomeName && <>,<br /><span>{welcomeName}</span></>}</h1>
        <p className="sv-intro-copy">Your departures. Your guests. All in one place.</p>
        <div className="sv-intro-footer">
          {!loading && !error && (
            <div className="sv-day-summary" aria-label={`Overview for ${longDate(date)}`}>
              <span><strong>{data?.departures.length || 0}</strong> departure{data?.departures.length === 1 ? "" : "s"}</span>
              <span><strong>{booked}</strong> booked</span>
              <span><strong>{arrived}</strong> arrived</span>
            </div>
          )}
          <Link href={`/simple/calendar?date=${encodeURIComponent(date)}`} className="sv-text-link">Browse calendar <ArrowUpRight size={18} /></Link>
        </div>
      </header>

      <section className="ui-card sv-filters flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" aria-label="Choose day">
        <div className="sv-date-filter">
          <button type="button" onClick={() => selectDate(addDaysToDateKey(date, -1))} className="sv-day-picker-button" aria-label="Previous day"><CaretLeft size={20} /></button>
          <label>
            <span className="sr-only">Selected date</span>
            <input type="date" value={date} onChange={event => selectDate(event.target.value)} className="ui-control h-11 w-full px-3 font-semibold" />
          </label>
          <button type="button" onClick={() => selectDate(addDaysToDateKey(date, 1))} className="sv-day-picker-button" aria-label="Next day"><CaretRight size={20} /></button>
        </div>
        {date !== today && <button type="button" onClick={() => selectDate(today)} className="ui-btn ui-btn-soft !h-11 !rounded-xl">Today</button>}
      </section>

      <div className="sv-section-heading"><h2>Departures</h2><span>In time order</span></div>

      {loading && (
        <div className="space-y-3" aria-label="Loading departures">
          {[0, 1, 2].map(item => <div key={item} className="ui-skeleton h-36 rounded-2xl" />)}
        </div>
      )}

      {!loading && error && (
        <div className="ui-card p-6 text-center" role="alert">
          <h2 className="font-semibold" style={{ color: "var(--ck-text-strong)" }}>{date === today ? "Today is unavailable" : "Departures unavailable"}</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--ck-text-muted)" }}>{error}</p>
          <button type="button" onClick={() => reload()} className="ui-btn ui-btn-primary mt-4 !h-11 !rounded-xl">Try again</button>
        </div>
      )}

      {!loading && !error && data?.departures.length === 0 && (
        <div className="ui-card px-5 py-10 text-center">
          <CalendarBlank size={30} className="mx-auto" style={{ color: "var(--ck-text-muted)" }} />
          <h2 className="mt-3 font-display text-xl font-semibold" style={{ color: "var(--ck-text-strong)" }}>{date === today ? "No departures today" : "No departures on this day"}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm" style={{ color: "var(--ck-text-muted)" }}>Browse another day or add a walk-in once a departure is available.</p>
          <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
            <Link href={`/simple/calendar?date=${encodeURIComponent(date)}`} className="ui-btn ui-btn-soft !h-11 !rounded-xl">Browse calendar</Link>
            <Link href={walkInUrl({ date, returnTo })} className="ui-btn ui-btn-primary !h-11 !rounded-xl"><Plus size={17} /> Add walk-in</Link>
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
              returnTo={returnTo}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function SimpleTodayPage() {
  return <Suspense fallback={<div className="sv-page"><div className="ui-skeleton h-56 rounded-2xl" /></div>}><SimpleDayContent /></Suspense>;
}
