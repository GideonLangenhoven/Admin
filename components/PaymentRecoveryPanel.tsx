"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatZar } from "../app/lib/money";
import Link from "next/link";
import { EnvelopeSimple, WhatsappLogo } from "@phosphor-icons/react";
import { useBusinessContext } from "./BusinessContext";
import { supabase } from "../app/lib/supabase";
import { bookingRealtimeFilter } from "../app/lib/bookings-realtime";
import { notify } from "../app/lib/app-notify";
import { contactPhoneNumber } from "../app/lib/contact-links";
import { businessDateKey } from "../app/lib/simple-view";
import BookingContact from "./simple/BookingContact";
import DashboardContact from "./DashboardContact";
import { loadPaymentRecovery, RECOVERY_PAGE_SIZE as PAGE_SIZE, type RecoveryDay } from "../app/lib/payment-recovery";

type RecoveryBooking = {
  id: string; customer_name: string; email: string | null; phone: string | null; status: string;
  total_amount: number; total_captured: number | null; amount_due: number; payment_url: string | null; payment_status: string | null;
  created_at: string; payment_failed_at: string | null; payment_failure_reason: string | null;
  payment_recovery_emailed_at: string | null;
  slot_id: string | null; departure_at: string | null; tour_name: string | null; departure_passed: boolean | null;
};

export default function PaymentRecoveryPanel({ contactButtonsOnly = false, dashboard = false }: { contactButtonsOnly?: boolean; dashboard?: boolean }) {
  const { businessId, timezone, readOnly } = useBusinessContext();
  const [rows, setRows] = useState<RecoveryBooking[]>([]);
  const [page, setPage] = useState(0);
  const [day, setDay] = useState<RecoveryDay>("today");
  const [expanded, setExpanded] = useState(!dashboard);
  const [counts, setCounts] = useState<{ today: number | null; tomorrow: number | null }>({ today: null, tomorrow: null });
  const [total, setTotal] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sending, setSending] = useState<string | null>(null);
  const request = useRef(0);
  const activeBusiness = useRef(businessId);
  activeBusiness.current = businessId;

  const load = useCallback(async () => {
    if (!businessId) return;
    const sequence = ++request.current;
    setLoading(true);
    setError("");
    const { result, today, tomorrow } = await loadPaymentRecovery(supabase, { businessId, timezone, day, page, dashboard });
    if (sequence !== request.current || activeBusiness.current !== businessId) return;
    setLoading(false);
    setError(result.error ? "Payment recovery could not be loaded. Please try again." : "");
    if (dashboard) setCounts({ today: today?.error ? null : today?.count ?? null, tomorrow: tomorrow?.error ? null : tomorrow?.count ?? null });
    if (!result.error) {
      if (dashboard && result.count !== null && page > 0 && page * PAGE_SIZE >= result.count) {
        setPage(Math.max(0, Math.ceil(result.count / PAGE_SIZE) - 1));
        setLoading(true);
        return;
      }
      setTotal(result.count);
      setRows((result.data || []).slice(0, PAGE_SIZE));
      setHasMore((result.data || []).length > PAGE_SIZE);
    }
  }, [businessId, page, dashboard, day, timezone]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const invalidate = () => { request.current++; };
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => void load(), 300); };
    void load();
    const channel = supabase.channel(`payment-recovery-${businessId}-${page}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: bookingRealtimeFilter(businessId) }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "slots", filter: bookingRealtimeFilter(businessId) }, refresh)
      .subscribe();
    // Polling also catches payments when a realtime connection is interrupted.
    const poll = setInterval(() => void load(), 30_000);
    return () => { invalidate(); clearTimeout(timer); clearInterval(poll); void supabase.removeChannel(channel); };
  }, [businessId, load, page]);

  function date(value: string) {
    return new Date(value).toLocaleString("en-ZA", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" });
  }

  const days = new Map<string, { label: string; trips: Map<string, RecoveryBooking[]> }>();
  for (const booking of rows) {
    const dayKey = booking.departure_at ? businessDateKey(timezone, new Date(booking.departure_at)) : "unscheduled";
    const key = `${booking.departure_passed ? "past:" : ""}${dayKey}`;
    if (!days.has(key)) days.set(key, {
      label: booking.departure_at ? `${new Date(booking.departure_at).toLocaleDateString("en-ZA", { timeZone: timezone, weekday: "short", day: "numeric", month: "short", year: "numeric" })}${booking.departure_passed ? " · Past trips" : ""}` : "Departure not set",
      trips: new Map(),
    });
    const trips = days.get(key)!.trips;
    const tripKey = booking.slot_id || booking.id;
    if (!trips.has(tripKey)) trips.set(tripKey, []);
    trips.get(tripKey)!.push(booking);
  }

  async function sendEmail(booking: RecoveryBooking) {
    if (sending || readOnly) return;
    setSending(booking.id);
    try {
      const result = await supabase.functions.invoke("auto-messages", {
        body: { action: "payment_recovery_email", business_id: businessId, booking_id: booking.id },
      });
      if (activeBusiness.current !== businessId) return;
      let detail = result.data;
      if (result.error?.context instanceof Response) detail = await result.error.context.json().catch(() => detail);
      if (result.error || detail?.ok !== true) {
        notify({ title: "Email not sent", message: detail?.error || "Could not send the payment email. Please try again.", tone: "error" });
      } else {
        notify({ title: "Payment email sent", message: detail.warning || (contactButtonsOnly ? "Payment link emailed to the booking contact." : `The Yoco payment link was emailed to ${booking.email}.`), tone: detail.warning ? "warning" : "success" });
        await load();
      }
    } catch {
      notify({ title: "Email outcome unknown", message: "Connection lost. Refresh and check the sent time before retrying.", tone: "warning" });
    } finally { setSending(null); }
  }

  return (
    <section className="ui-card min-w-0 p-4 sm:p-5" aria-label="Payment recovery" aria-busy={loading}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: "var(--ck-text-strong)" }}>Payment recovery</h2>
        </div>
        <button type="button" className="ui-btn ui-btn-soft min-h-11" onClick={() => void load()} disabled={loading}>Refresh</button>
      </div>
      {dashboard && <>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {(["today", "tomorrow"] as const).map(value => <button key={value} type="button" aria-pressed={expanded && day === value} className="ui-btn ui-btn-soft !h-auto min-h-20 min-w-0 flex-col !items-start !gap-1 !px-3 !py-3 !whitespace-normal text-left [overflow-wrap:anywhere]" onClick={() => { setDay(value); setPage(0); setExpanded(true); }}>
            <span>{value === "today" ? "Today" : "Tomorrow"}</span><strong className="text-xl tabular-nums">{loading ? "Loading…" : counts[value] === null ? "Unavailable" : `${counts[value]} ${counts[value] === 1 ? "booking" : "bookings"}`}</strong>
          </button>)}
        </div>
        <button type="button" className="ui-btn ui-btn-ghost mt-2 min-h-11" aria-pressed={expanded && day === "all"} onClick={() => { setDay("all"); setPage(0); setExpanded(true); }}>All departure days</button>
        {expanded && <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p role="status" className="text-sm">{loading ? "Loading bookings…" : error ? "List unavailable" : `${day === "all" ? "All departure days" : day === "today" ? "Today" : "Tomorrow"} · ${total ?? "Unknown number of"} eligible bookings`}</p><button type="button" className="ui-btn ui-btn-ghost min-h-11" onClick={() => setExpanded(false)}>Close list</button></div>}
        {!loading && (counts.today === null || counts.tomorrow === null) && <p role="alert" className="mt-2 text-sm">Some recovery counts are unavailable. Refresh to try again.</p>}
      </>}
      {expanded && (error ? <p role="alert" className="text-sm">{error}</p> : loading ? <div className="ui-skeleton h-24" aria-label="Loading payment recovery" /> : rows.length === 0 ? (
        <p className="py-4 text-sm" style={{ color: "var(--ck-text-muted)" }}>{dashboard && day !== "all" ? "No eligible outstanding bookings for this departure day." : "No payments need follow-up."}</p>
      ) : <div className="mt-4 space-y-2" aria-busy={loading}>
        {[...days].map(([key, day], dayIndex) => <details key={`${businessId}:${page}:${key}`} open={dashboard || dayIndex === 0} className="border-t" style={{ borderColor: "var(--ck-border-subtle)" }}>
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">{day.label}</summary>
          <div className="pl-2 sm:pl-4">
            {[...day.trips].map(([tripKey, bookings], tripIndex) => <details key={tripKey} open={dashboard || tripIndex === 0}>
              <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium [overflow-wrap:anywhere]">
                {bookings[0].departure_at ? new Date(bookings[0].departure_at).toLocaleTimeString("en-ZA", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }) : "Time not set"} · {bookings[0].tour_name || "Trip"}
              </summary>
              <ul className="divide-y" style={{ borderColor: "var(--ck-border-subtle)" }}>
        {bookings.map(booking => {
          const awaiting = Number(booking.amount_due) > 0;
          const paid = !awaiting && (["PAID", "COMPLETED"].includes(booking.status) || (booking.status === "CONFIRMED" && Number(booking.total_amount) > 0));
          const partial = awaiting && Number(booking.total_captured) > 0;
          const review = booking.payment_status === "MISMATCH_QUARANTINE";
          const phoneNumber = contactPhoneNumber(booking.phone);
          return <li key={booking.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm">
              <Link className="font-semibold underline underline-offset-4" href={`/bookings/${booking.id}`}>{booking.customer_name || "Guest"} · {booking.id.slice(0, 8).toUpperCase()}</Link>
              {!contactButtonsOnly && <p className="mt-1 break-words">{booking.email || "No email on booking"}</p>}
              <p className="mt-1" style={{ color: "var(--ck-text-muted)" }}>{booking.payment_failed_at ? `Failed ${date(booking.payment_failed_at)} · ${booking.payment_failure_reason || "Payment was not completed"}` : `Booked ${date(booking.created_at)}`}</p>
              {booking.payment_recovery_emailed_at && <p className="mt-1" style={{ color: "var(--ck-text-muted)" }}>Recovery email sent {date(booking.payment_recovery_emailed_at)}</p>}
              {awaiting && !booking.email && <p className="mt-1">Add an email in the booking to send a payment link.</p>}
              {partial && <p className="mt-1">Part-paid. Check the booking balance before sending a payment link.</p>}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-3 sm:max-w-[50%] sm:justify-end">
              <span className="text-sm font-semibold">{formatZar(Number(awaiting ? booking.amount_due : booking.total_amount))}{review ? " · Payment needs review" : paid ? " · Paid" : awaiting ? "" : ` · ${booking.status.replaceAll("_", " ").toLowerCase()}`}</span>
              {contactButtonsOnly ? <BookingContact booking={booking} /> : dashboard ? <DashboardContact booking={booking} /> : phoneNumber && <a href={`https://wa.me/${phoneNumber}`} target="_blank" rel="noopener noreferrer" className="ui-btn ui-btn-soft min-h-11 min-w-11 !px-3" aria-label={`WhatsApp ${booking.customer_name || "guest"}`} title={`WhatsApp ${booking.customer_name || "guest"}`}>
                <WhatsappLogo size={18} aria-hidden="true" />
              </a>}
              {awaiting && <button type="button" className="ui-btn ui-btn-primary min-h-11 min-w-11 !px-3" aria-label={sending === booking.id ? "Sending payment email" : booking.payment_recovery_emailed_at ? "Resend payment email" : "Email payment link"} title={booking.payment_recovery_emailed_at ? "Resend payment email" : "Email payment link"} aria-busy={sending === booking.id} disabled={Boolean(sending) || !booking.email || !booking.payment_url || readOnly || review || partial || loading} onClick={() => void sendEmail(booking)}><EnvelopeSimple size={18} aria-hidden="true" /></button>}
            </div>
          </li>;
        })}
              </ul>
            </details>)}
          </div>
        </details>)}
      </div>)}
      {expanded && (page > 0 || hasMore) && <div className="mt-3 flex items-center justify-between gap-3">
        <button type="button" className="ui-btn ui-btn-soft min-h-11" disabled={page === 0 || loading} onClick={() => setPage(value => value - 1)}>Previous</button>
        <span className="text-sm" aria-live="polite">Page {page + 1}</span>
        <button type="button" className="ui-btn ui-btn-soft min-h-11" disabled={!hasMore || loading} onClick={() => setPage(value => value + 1)}>Next</button>
      </div>}
    </section>
  );
}
