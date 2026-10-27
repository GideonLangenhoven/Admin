"use client";
import { pluralize } from "../../app/lib/automation-copy";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { supabase } from "@/app/lib/supabase";
import { addDaysToDateKey, businessDateKey, isDateKey } from "@/app/lib/simple-view";
import { useBusinessContext } from "@/components/BusinessContext";

type Departure = { id: string; start_time: string; tour_name: string; pax_expected: number; booking_count: number; photo_count: number };
export default function GuideDay({ photos = false }: { photos?: boolean }) {
  const { timezone, businessId } = useBusinessContext();
  const params = useSearchParams(), router = useRouter();
  const requested = params.get("date"), today = businessDateKey(timezone);
  const date = isDateKey(requested) ? requested : today;
  const [refresh, setRefresh] = useState(0);
  const requestKey = `${businessId}:${date}:${refresh}`;
  const [result, setResult] = useState<{ key: string; rows: Departure[] | null; error: string } | null>(null);
  const rows = result?.key === requestKey ? result.rows : null;
  const error = result?.key === requestKey ? result.error : "";
  useEffect(() => {
    let active = true;
    async function load() {
      const { data, error } = await supabase.rpc("guide_day", { p_date: date });
      if (!active) return;
      if (error || !Array.isArray(data)) setResult({ key: requestKey, rows: null, error: "Guest counts unavailable. Refresh or ask your operator to check access." });
      else setResult({ key: requestKey, rows: data, error: "" });
    }
    void load(); const timer = setInterval(load, 60_000);
    return () => { active = false; clearInterval(timer); };
  }, [date, businessId, requestKey]);
  const dayLabel = new Intl.DateTimeFormat("en-ZA", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(date + "T12:00Z"));
  function selectDate(value: string) {
    if (isDateKey(value)) router.replace(`${photos ? "/simple/photos" : "/simple"}?date=${value}`, { scroll: false });
  }
  return <div className="sv-page">
    <header className="sv-intro"><p className="sv-eyebrow">{dayLabel}</p><h1 className="sv-title">{photos ? "Trip photos" : "Expected passengers"}</h1>
      {rows && !error && <div className="sv-day-summary mt-4" aria-label="Expected passenger summary"><span><strong>{rows.reduce((sum, row) => sum + row.pax_expected, 0)}</strong> passengers expected</span><span><strong>{rows.length}</strong> departures</span></div>}
    </header>
    <section className="sv-filters flex flex-wrap items-center justify-between gap-3" aria-label="Choose day"><div className="sv-date-filter">
      <button className="sv-day-picker-button" onClick={() => selectDate(addDaysToDateKey(date, -1))} aria-label="Previous day"><CaretLeft size={20} /></button>
      <label><span className="sr-only">Selected date</span><input type="date" className="ui-control h-11 px-3" value={date} onChange={e => selectDate(e.target.value)} /></label>
      <button className="sv-day-picker-button" onClick={() => selectDate(addDaysToDateKey(date, 1))} aria-label="Next day"><CaretRight size={20} /></button>
    </div><button className="ui-btn ui-btn-soft min-h-11" onClick={() => setRefresh(value => value + 1)}>Refresh</button></section>
    {error ? <p role="alert" className="ui-card p-4">{error}</p> : rows === null ? <p role="status" className="ui-card p-4">Loading departures…</p> : rows.length === 0 ? <p className="ui-card p-6">No bookings or trip photos today.</p> :
      <div className="space-y-4">{rows.map(row => <section key={row.id} className="ui-card p-5" aria-label={row.tour_name}>
        <p className="text-sm font-semibold">{new Intl.DateTimeFormat("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone }).format(new Date(row.start_time))}</p>
        <h2 className="mt-1 text-lg font-semibold">{row.tour_name}</h2>
        <p className="mt-3"><strong>{row.pax_expected}</strong> {row.pax_expected === 1 ? "passenger" : "passengers"} expected · {pluralize(row.booking_count, "booking")}</p>
        <Link className="ui-btn ui-btn-soft mt-4 min-h-11" href={`/simpleguide/photos/${row.id}?date=${date}`}>Trip photos{row.photo_count ? ` (${row.photo_count})` : ""}</Link>
      </section>)}</div>}
  </div>;
}
