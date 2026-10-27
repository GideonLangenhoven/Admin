"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUpRight, CalendarBlank, CaretLeft, CaretRight, Plus } from "@phosphor-icons/react";
import { useBusinessContext } from "@/components/BusinessContext";
import PaymentRecoveryPanel from "@/components/PaymentRecoveryPanel";
import DepartureCard from "@/components/simple/DepartureCard";
import { addDaysToDateKey, businessDateKey, isDateKey, walkInUrl } from "@/app/lib/simple-view";
import { nextManifestDepartures } from "@/app/lib/operator-day";
import { useSimpleDay } from "./use-simple-day";

function longDate(date: string) {
  return new Intl.DateTimeFormat("en-ZA", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(date + "T12:00:00Z"));
}

function SimpleDayContent() {
  const { businessId, timezone, role } = useBusinessContext();
  const guide = role === "GUIDE";
  const base = guide ? "/simpleguide" : "/simple";
  const router = useRouter();
  const searchParams = useSearchParams();
  const [now, setNow] = useState(() => Date.now());
  const [selectedDepartureId, setSelectedDepartureId] = useState<string | null>(null);
  useEffect(() => {
    if (guide) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [guide]);
  const today = businessDateKey(timezone);
  const requestedDate = searchParams.get("date");
  const date = isDateKey(requestedDate) ? requestedDate : today;
  const { data, loading, error, reload, refreshing } = useSimpleDay(businessId, date, timezone, guide);
  const departures = guide ? data?.departures || [] : nextManifestDepartures(
    (data?.departures || []).map(departure => ({ ...departure, timeRaw: departure.start_time })), now,
  );
  const activeDeparture = departures.find(departure => departure.id === selectedDepartureId) || departures[0];
  const activeDepartureIndex = departures.findIndex(departure => departure.id === activeDeparture?.id);
  const visibleDepartures = guide ? departures : activeDeparture ? [activeDeparture] : [];
  const booked = data?.departures.reduce((sum, departure) => sum + departure.booked_guests, 0) || 0;
  const arrived = data?.departures.reduce((sum, departure) => sum + departure.arrived_guests, 0) || 0;
  const returnTo = date === today ? base : `${base}?date=${encodeURIComponent(date)}`;

  function selectDate(next: string) {
    if (!isDateKey(next)) return;
    router.replace(next === today ? base : `${base}?date=${encodeURIComponent(next)}`, { scroll: false });
  }

  return (
    <div className="sv-page">
      <header className="sv-intro sv-intro--roll-call">
        <Link href={`${guide ? "/simpleguide/check-ins" : "/simple/calendar"}?date=${encodeURIComponent(date)}`} className="sv-eyebrow sv-text-link" aria-label={`${guide ? "Open check-ins" : "Browse calendar"} for ${longDate(date)}`}>
          <CalendarBlank size={16} className="shrink-0" />
          <span>{date === today ? "Today" : "Selected day"} · {longDate(date)}</span>
          <ArrowUpRight size={16} className="shrink-0" />
        </Link>
        <h1 className="sv-title">Roll call</h1>
        <div className="sv-intro-footer">
          {!loading && !error && (
            <div className="sv-day-summary" aria-label={`Overview for ${longDate(date)}`}>
              <span><strong>{data?.departures.length || 0}</strong> booked session{data?.departures.length === 1 ? "" : "s"}</span>
              <span><strong>{booked}</strong> booked</span>
              <span><strong>{arrived}</strong> arrived</span>
            </div>
          )}
        </div>
      </header>

      {!guide && <PaymentRecoveryPanel dashboard />}

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

      <div className="sv-section-heading">
        <h2>{guide ? "Booked sessions" : "Next departures"}</h2>
        {guide ? <span>In time order</span> : !loading && !error && departures.length > 1 && (
          <nav aria-label="Departures" className="flex flex-wrap items-center gap-1.5">
            <button type="button" className="sv-day-picker-button text-[var(--sv-ink)] disabled:opacity-30" aria-label="Previous departure" disabled={activeDepartureIndex === 0} onClick={() => setSelectedDepartureId(departures[activeDepartureIndex - 1].id)}><CaretLeft size={20} /></button>
            <span className="text-sm tabular-nums">Departure {activeDepartureIndex + 1} of {departures.length}</span>
            <button type="button" className="sv-day-picker-button text-[var(--sv-ink)] disabled:opacity-30" aria-label="Next departure" disabled={activeDepartureIndex === departures.length - 1} onClick={() => setSelectedDepartureId(departures[activeDepartureIndex + 1].id)}><CaretRight size={20} /></button>
          </nav>
        )}
      </div>

      {loading && (
        <div className="space-y-3" aria-label="Loading roll call">
          {[0, 1, 2].map(item => <div key={item} className="ui-skeleton h-36 rounded-2xl" />)}
        </div>
      )}

      {!loading && error && (
        <div className="ui-card p-6 text-center" role="alert">
          <h2 className="font-semibold" style={{ color: "var(--ck-text-strong)" }}>{date === today ? "Today is unavailable" : "Roll call unavailable"}</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--ck-text-muted)" }}>{error}</p>
          <button type="button" onClick={() => reload()} className="ui-btn ui-btn-primary mt-4 !h-11 !rounded-xl">Try again</button>
        </div>
      )}

      {!loading && !error && data && departures.length === 0 && (
        <div className="ui-card px-5 py-10 text-center">
          <CalendarBlank size={30} className="mx-auto" style={{ color: "var(--ck-text-muted)" }} />
          <h2 className="mt-3 font-display text-xl font-semibold" style={{ color: "var(--ck-text-strong)" }}>{data.departures.length > 0 ? date === today ? "No more booked departures today" : "No more booked departures on this day" : date === today ? "No bookings today" : "No bookings on this day"}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm" style={{ color: "var(--ck-text-muted)" }}>{guide ? "Choose another day for booked sessions." : "Choose another day or add a walk-in."}</p>
          {!guide && <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
            <Link href={`/simple/calendar?date=${encodeURIComponent(date)}`} className="ui-btn ui-btn-soft !h-11 !rounded-xl">Browse calendar</Link>
            <Link href={walkInUrl({ date, returnTo })} className="ui-btn ui-btn-primary !h-11 !rounded-xl"><Plus size={17} /> Add walk-in</Link>
          </div>}
        </div>
      )}

      {!loading && !error && visibleDepartures.length > 0 && (
        <div className="sv-departure-list">
          {visibleDepartures.map(departure => (
            <DepartureCard
              key={departure.id}
              departure={departure}
              date={date}
              timeZone={timezone}
              returnTo={returnTo}
              reload={reload}
              refreshing={refreshing}
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
