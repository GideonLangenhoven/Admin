"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CaretLeft, CaretRight, CheckCircle, Minus, Plus, WarningCircle } from "@phosphor-icons/react";
import { useBusinessContext } from "@/components/BusinessContext";
import { addDaysToDateKey, businessDateKey, isDateKey } from "@/app/lib/simple-view";
import { amountOutstanding, derivePaymentMethod } from "@/app/lib/report-accounting";
import { markPaidAction, setArrivedCountAction, type ManualPaymentMethod } from "@/app/lib/booking-actions";
import type { SimpleBooking, SimpleDeparture } from "../simple-data";
import { useSimpleDay } from "../use-simple-day";

const PAYMENT_METHODS: ManualPaymentMethod[] = ["Cash", "EFT", "Card (terminal)", "Other"];
const ARRIVAL_STATUSES = new Set(["PAID", "CONFIRMED", "COMPLETED"]);

function timeLabel(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(iso));
}

function longDate(date: string) {
  return new Intl.DateTimeFormat("en-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(date + "T12:00:00Z"));
}

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-ZA", { style: "currency", currency, minimumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function BookingCheckIn({
  booking,
  departure,
  businessId,
  currency,
  reload,
}: {
  booking: SimpleBooking;
  departure: SimpleDeparture;
  businessId: string;
  currency: string;
  reload: (quiet?: boolean) => Promise<void>;
}) {
  const [draft, setDraft] = useState(booking.arrived_count);
  const [method, setMethod] = useState<ManualPaymentMethod>("Cash");
  const [paymentNote, setPaymentNote] = useState("");
  const [busy, setBusy] = useState<"payment" | "arrival" | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const due = amountOutstanding(booking);
  const settledStatus = ARRIVAL_STATUSES.has(booking.status);
  const paymentNeeded = due > 0.005 || !settledStatus;
  const waiverReady = booking.waiver_status === "SIGNED";
  const canSave = draft !== booking.arrived_count && draft >= 0 && draft <= booking.qty && (draft === 0 || (!paymentNeeded && waiverReady));

  useEffect(() => setDraft(booking.arrived_count), [booking.arrived_count]);

  function changeDraft(next: number) {
    setDraft(Math.max(0, Math.min(booking.qty, Math.trunc(next))));
    setMessage(null);
  }

  async function saveArrival() {
    if (!canSave || busy) return;
    setBusy("arrival");
    setMessage(null);
    const result = await setArrivedCountAction({
      bookingId: booking.id,
      businessId,
      arrivedCount: draft,
      expectedArrivedCount: booking.arrived_count,
      slotId: departure.id,
      source: "simple-view",
      notes: draft < booking.arrived_count ? "Arrival count corrected by operator" : undefined,
    });
    if (result.ok) {
      setMessage({ tone: "success", text: `${draft} of ${booking.qty} guests recorded as arrived.` });
    } else {
      setMessage({ tone: "error", text: result.error || "Arrival count was not saved." });
    }
    await reload(true);
    setBusy(null);
  }

  async function recordPayment() {
    if (busy) return;
    setBusy("payment");
    setMessage(null);
    const result = await markPaidAction(booking.id, { paymentMethod: method, paymentNote });
    if (result.ok) {
      setMessage({ tone: "success", text: "Payment recorded. You can check in the guests once the refreshed booking is eligible." });
      setPaymentNote("");
    } else {
      setMessage({ tone: "error", text: result.error || "Payment could not be confirmed. The booking has been refreshed; check its status before retrying." });
    }
    await reload(true);
    setBusy(null);
  }

  return (
    <li className="ui-card overflow-hidden">
      <div className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold" style={{ color: "var(--ck-text-strong)" }}>{booking.customer_name || "Guest"}</h3>
            <p className="mt-1 text-sm" style={{ color: "var(--ck-text-muted)" }}>
              {booking.qty} guest{booking.qty === 1 ? "" : "s"}
              {booking.phone ? ` · ${booking.phone}` : ""}
            </p>
          </div>
          <span className={`ui-status self-start ${booking.checked_in ? "ui-pill-success" : booking.arrived_count > 0 ? "ui-pill-amber" : "ui-pill-neutral"}`}>
            {booking.arrived_count} of {booking.qty} arrived
          </span>
        </div>

        <div className="mt-4 grid gap-3 rounded-xl border p-3 sm:grid-cols-2" style={{ borderColor: "var(--ck-border-subtle)", background: "var(--ck-surface-sunken)" }}>
          <div>
            <p className="ui-mono-label !text-[9px]">Payment</p>
            <p className="mt-1 text-sm font-semibold" style={{ color: paymentNeeded ? "var(--ck-warning)" : "var(--ck-success)" }}>
              {paymentNeeded ? `${money(due, currency)} due` : `Paid${derivePaymentMethod(booking) ? ` · ${derivePaymentMethod(booking)}` : ""}`}
            </p>
          </div>
          <div>
            <p className="ui-mono-label !text-[9px]">Waiver</p>
            <p className="mt-1 text-sm font-semibold" style={{ color: waiverReady ? "var(--ck-success)" : "var(--ck-danger)" }}>
              {waiverReady ? "Signed" : "Signature required"}
            </p>
          </div>
        </div>

        {paymentNeeded && (
          <div className="mt-4 rounded-xl border p-4" style={{ borderColor: "color-mix(in srgb, var(--ck-warning) 30%, transparent)", background: "var(--ck-warning-soft)" }}>
            <div className="flex items-start gap-2">
              <WarningCircle size={19} className="mt-0.5 shrink-0" style={{ color: "var(--ck-warning)" }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>Confirm payment received</p>
                <p className="mt-0.5 text-xs" style={{ color: "var(--ck-text-muted)" }}>This records the full outstanding balance of {money(due, currency)}. Card (terminal) means it was already taken on the external terminal.</p>
              </div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,12rem)_1fr_auto] sm:items-end">
              <label className="text-xs font-semibold">
                Method
                <select value={method} onChange={event => setMethod(event.target.value as ManualPaymentMethod)} className="ui-control mt-1 h-11 w-full rounded-xl px-3 text-sm" disabled={busy !== null}>
                  {PAYMENT_METHODS.map(value => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold">
                Note <span className="font-normal" style={{ color: "var(--ck-text-muted)" }}>(optional)</span>
                <input value={paymentNote} onChange={event => setPaymentNote(event.target.value)} maxLength={240} className="ui-control mt-1 h-11 w-full rounded-xl px-3 text-sm" placeholder="Receipt or reference" disabled={busy !== null} />
              </label>
              <button type="button" onClick={recordPayment} disabled={busy !== null} className="ui-btn ui-btn-primary !h-11 !rounded-xl whitespace-nowrap disabled:opacity-50">
                {busy === "payment" ? "Confirming…" : `Confirm ${money(due, currency)} received`}
              </button>
            </div>
          </div>
        )}

        {!paymentNeeded && !waiverReady && (
          <p className="mt-4 rounded-xl border px-3 py-2.5 text-sm font-medium" style={{ borderColor: "color-mix(in srgb, var(--ck-danger) 28%, transparent)", background: "var(--ck-danger-soft)", color: "var(--ck-danger)" }}>
            A signed waiver is required before recording arrivals. The full dashboard has the waiver actions.
          </p>
        )}

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <label className="text-sm font-semibold" htmlFor={`arrived-${booking.id}`}>Guests arrived</label>
            <div className="mt-1.5 flex items-center gap-2">
              <button type="button" onClick={() => changeDraft(draft - 1)} disabled={draft <= 0 || busy !== null} className="flex h-11 w-11 items-center justify-center rounded-xl border disabled:opacity-30" style={{ borderColor: "var(--ck-border-strong)" }} aria-label="Decrease arrived guests"><Minus size={18} /></button>
              <input id={`arrived-${booking.id}`} type="number" inputMode="numeric" min={0} max={booking.qty} step={1} value={draft} onChange={event => changeDraft(Number(event.target.value || 0))} disabled={busy !== null} className="ui-control h-11 w-20 rounded-xl px-2 text-center text-base font-bold tabular-nums" />
              <span className="text-sm font-semibold" style={{ color: "var(--ck-text-muted)" }}>of {booking.qty}</span>
              <button type="button" onClick={() => changeDraft(draft + 1)} disabled={draft >= booking.qty || busy !== null} className="flex h-11 w-11 items-center justify-center rounded-xl border disabled:opacity-30" style={{ borderColor: "var(--ck-border-strong)" }} aria-label="Increase arrived guests"><Plus size={18} /></button>
            </div>
          </div>
          <button type="button" onClick={saveArrival} disabled={!canSave || busy !== null} className="ui-btn ui-btn-primary !h-11 !rounded-xl disabled:opacity-40 sm:min-w-32">
            {busy === "arrival" ? "Saving…" : draft < booking.arrived_count ? "Save correction" : "Save arrivals"}
          </button>
        </div>

        {message && <p className="mt-3 text-sm font-medium" role="status" style={{ color: message.tone === "success" ? "var(--ck-success)" : "var(--ck-danger)" }}>{message.text}</p>}
      </div>
    </li>
  );
}

export default function SimpleCheckInsPage() {
  const { businessId, timezone } = useBusinessContext();
  const router = useRouter();
  const today = businessDateKey(timezone);
  const [date, setDate] = useState(today);
  const [slotFilter, setSlotFilter] = useState("");
  const { data, loading, error, reload } = useSimpleDay(businessId, date, timezone);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedDate = params.get("date");
    if (isDateKey(requestedDate)) setDate(requestedDate);
    const requestedSlot = params.get("slot");
    if (requestedSlot && /^[0-9a-f-]{36}$/i.test(requestedSlot)) setSlotFilter(requestedSlot);
  }, []);

  const validSlotFilter = data?.departures.some(departure => departure.id === slotFilter) ? slotFilter : "";
  const departures = useMemo(() => {
    if (!data) return [];
    return validSlotFilter ? data.departures.filter(departure => departure.id === validSlotFilter) : data.departures;
  }, [data, validSlotFilter]);
  const bookingCount = departures.reduce((sum, departure) => sum + departure.bookings.length, 0);

  function updateUrl(nextDate: string, nextSlot: string) {
    const params = new URLSearchParams({ date: nextDate });
    if (nextSlot) params.set("slot", nextSlot);
    router.replace("/simple/check-ins?" + params.toString(), { scroll: false });
  }

  function selectDate(next: string) {
    if (!isDateKey(next)) return;
    setDate(next);
    setSlotFilter("");
    updateUrl(next, "");
  }

  function selectSlot(next: string) {
    setSlotFilter(next);
    updateUrl(date, next);
  }

  return (
    <div className="space-y-5">
      <header>
        <p className="ui-mono-label">Arrivals and desk payments</p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight" style={{ color: "var(--ck-text-strong)" }}>Check-ins</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ck-text-muted)" }}>Record the number of guests who have arrived. Payment must be confirmed and waivers signed first.</p>
      </header>

      <section className="ui-card grid gap-3 p-3 sm:grid-cols-[auto_minmax(12rem,1fr)] sm:items-end" aria-label="Check-in filters">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => selectDate(addDaysToDateKey(date, -1))} className="flex h-11 w-11 items-center justify-center rounded-xl border" style={{ borderColor: "var(--ck-border-strong)" }} aria-label="Previous day"><CaretLeft size={20} /></button>
          <label>
            <span className="sr-only">Selected date</span>
            <input type="date" value={date} onChange={event => selectDate(event.target.value)} className="ui-control h-11 min-w-0 rounded-xl px-3 text-sm font-semibold" />
          </label>
          <button type="button" onClick={() => selectDate(addDaysToDateKey(date, 1))} className="flex h-11 w-11 items-center justify-center rounded-xl border" style={{ borderColor: "var(--ck-border-strong)" }} aria-label="Next day"><CaretRight size={20} /></button>
        </div>
        <label className="text-xs font-semibold">
          Departure
          <select value={validSlotFilter} onChange={event => selectSlot(event.target.value)} className="ui-control mt-1 h-11 w-full rounded-xl px-3 text-sm">
            <option value="">All departures</option>
            {(data?.departures || []).map(departure => <option key={departure.id} value={departure.id}>{timeLabel(departure.start_time, timezone)} · {departure.tour_name}</option>)}
          </select>
        </label>
      </section>

      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="font-display text-xl font-semibold" style={{ color: "var(--ck-text-strong)" }}>{longDate(date)}</h2>
        {!loading && !error && <span className="text-sm" style={{ color: "var(--ck-text-muted)" }}>{bookingCount} booking{bookingCount === 1 ? "" : "s"}</span>}
      </div>

      {loading && <div className="space-y-3">{[0, 1, 2].map(item => <div key={item} className="ui-skeleton h-64 rounded-2xl" />)}</div>}

      {!loading && error && (
        <div className="ui-card p-6 text-center" role="alert">
          <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>{error}</p>
          <button type="button" onClick={() => reload()} className="ui-btn ui-btn-primary mt-4 !h-11 !rounded-xl">Try again</button>
        </div>
      )}

      {!loading && !error && bookingCount === 0 && (
        <div className="ui-card px-5 py-10 text-center">
          <CheckCircle size={32} className="mx-auto" style={{ color: "var(--ck-text-muted)" }} />
          <h2 className="mt-3 font-semibold" style={{ color: "var(--ck-text-strong)" }}>No bookings to check in</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--ck-text-muted)" }}>{departures.length ? "These departures do not have active bookings yet." : "There are no departures on this day."}</p>
        </div>
      )}

      {!loading && !error && bookingCount > 0 && (
        <div className="space-y-6">
          {departures.filter(departure => departure.bookings.length > 0).map(departure => (
            <section key={departure.id} aria-labelledby={`departure-${departure.id}`}>
              <div className="mb-2 flex items-center justify-between gap-3 px-1">
                <h2 id={`departure-${departure.id}`} className="min-w-0 truncate font-display text-lg font-semibold" style={{ color: "var(--ck-text-strong)" }}>
                  <span className="tabular-nums">{timeLabel(departure.start_time, timezone)}</span> · {departure.tour_name}
                </h2>
                <span className="shrink-0 text-xs font-semibold" style={{ color: "var(--ck-text-muted)" }}>{departure.arrived_guests}/{departure.booked_guests} arrived</span>
              </div>
              <ul className="space-y-3">
                {departure.bookings.map(booking => (
                  <BookingCheckIn key={booking.id} booking={booking} departure={departure} businessId={businessId} currency={data?.currency || "ZAR"} reload={reload} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
