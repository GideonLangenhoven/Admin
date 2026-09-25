"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CaretLeft, CaretRight, CalendarBlank } from "@phosphor-icons/react";
import { useBusinessContext } from "@/components/BusinessContext";
import DepartureCard from "@/components/simple/DepartureCard";
import { addDaysToDateKey, businessDateKey, isDateKey } from "@/app/lib/simple-view";
import { useSimpleDay } from "../use-simple-day";

function longDate(date: string) {
  return new Intl.DateTimeFormat("en-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(date + "T12:00:00Z"));
}

export default function SimpleCalendarPage() {
  const { businessId, timezone } = useBusinessContext();
  const router = useRouter();
  const today = businessDateKey(timezone);
  const [date, setDate] = useState(today);
  const { data, loading, error, reload } = useSimpleDay(businessId, date, timezone);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("date");
    if (isDateKey(requested)) setDate(requested);
  }, []);

  function selectDate(next: string) {
    if (!isDateKey(next)) return;
    setDate(next);
    router.replace("/simple/calendar?date=" + encodeURIComponent(next), { scroll: false });
  }

  return (
    <div className="sv-page">
      <header className="sv-intro sv-intro--calendar">
        <p className="sv-eyebrow"><CalendarBlank size={16} /> View and book</p>
        <h1 className="sv-title">Calendar</h1>
        <p className="sv-intro-copy">Find a departure. Make room for the next adventure.</p>
      </header>

      <section className="ui-card sv-filters flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" aria-label="Choose date">
        <div className="sv-date-filter">
          <button type="button" onClick={() => selectDate(addDaysToDateKey(date, -1))} className="sv-day-picker-button" aria-label="Previous day">
            <CaretLeft size={20} />
          </button>
          <label className="relative min-w-0 flex-1 sm:w-52 sm:flex-none">
            <span className="sr-only">Selected date</span>
            <CalendarBlank size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--ck-text-muted)" }} />
            <input type="date" value={date} onChange={event => selectDate(event.target.value)} className="ui-control h-11 w-full rounded-xl pl-10 pr-3 text-sm font-semibold" />
          </label>
          <button type="button" onClick={() => selectDate(addDaysToDateKey(date, 1))} className="sv-day-picker-button" aria-label="Next day">
            <CaretRight size={20} />
          </button>
        </div>
        {date !== today && <button type="button" onClick={() => selectDate(today)} className="ui-btn ui-btn-soft !h-11 !rounded-xl">Today</button>}
      </section>

      <div className="sv-section-heading">
        <h2>{longDate(date)}</h2>
        {!loading && !error && <span>{data?.departures.length || 0} departures</span>}
      </div>

      {loading && <div className="space-y-3">{[0, 1, 2].map(item => <div key={item} className="ui-skeleton h-36 rounded-2xl" />)}</div>}

      {!loading && error && (
        <div className="ui-card p-6 text-center" role="alert">
          <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>{error}</p>
          <button type="button" onClick={() => reload()} className="ui-btn ui-btn-primary mt-4 !h-11 !rounded-xl">Try again</button>
        </div>
      )}

      {!loading && !error && data?.departures.length === 0 && (
        <div className="ui-card px-5 py-10 text-center">
          <CalendarBlank size={30} className="mx-auto" style={{ color: "var(--ck-text-muted)" }} />
          <h2 className="mt-3 font-semibold" style={{ color: "var(--ck-text-strong)" }}>No departures on this day</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--ck-text-muted)" }}>Try the previous or next day.</p>
        </div>
      )}

      {!loading && !error && data && (
        <div className="sv-departure-list">
          {data.departures.map(departure => (
            <DepartureCard
              key={departure.id}
              departure={departure}
              date={date}
              timeZone={timezone}
              currency={data.currency}
              returnTo={`/simple/calendar?date=${encodeURIComponent(date)}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
