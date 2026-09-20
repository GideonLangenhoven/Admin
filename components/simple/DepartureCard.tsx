"use client";

import Link from "next/link";
import { CaretDown, CheckCircle, Plus, UsersThree } from "@phosphor-icons/react";
import { amountOutstanding } from "@/app/lib/report-accounting";
import { checkInsUrl, walkInUrl } from "@/app/lib/simple-view";
import type { SimpleBooking, SimpleDeparture } from "@/app/simple/simple-data";

function timeLabel(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(iso));
}

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-ZA", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return currency + " " + value.toFixed(2);
  }
}

function departureAvailability(departure: SimpleDeparture) {
  if (departure.status === "CANCELLED") return { label: "Cancelled", tone: "danger" };
  if (departure.status === "CLOSED") return { label: "Closed", tone: "gray" };
  if (new Date(departure.start_time).getTime() <= Date.now()) return { label: "Departed", tone: "gray" };
  if (departure.available_capacity === 0) return { label: "Full", tone: "danger" };
  if (departure.available_capacity == null) return { label: "Unavailable", tone: "gray" };
  return { label: `${departure.available_capacity} spot${departure.available_capacity === 1 ? "" : "s"} open`, tone: "success" };
}

function BookingRow({ booking, currency }: { booking: SimpleBooking; currency: string }) {
  const due = amountOutstanding(booking);
  const settled = due <= 0 && ["PAID", "CONFIRMED", "COMPLETED"].includes(booking.status);
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>{booking.customer_name || "Guest"}</p>
        <p className="mt-0.5 text-xs" style={{ color: "var(--ck-text-muted)" }}>
          {booking.qty} guest{booking.qty === 1 ? "" : "s"}
          <span aria-hidden="true"> · </span>
          <span className={settled ? "text-[var(--ck-success)]" : "text-[var(--ck-warning)]"}>
            {settled ? "Paid" : due > 0 ? `${money(due, currency)} due` : booking.status.replaceAll("_", " ")}
          </span>
        </p>
      </div>
      <span className={`ui-status shrink-0 ${booking.checked_in ? "ui-pill-success" : booking.arrived_count > 0 ? "ui-pill-amber" : "ui-pill-neutral"}`}>
        {booking.arrived_count} of {booking.qty} arrived
      </span>
    </li>
  );
}

export default function DepartureCard({
  departure,
  date,
  timeZone,
  currency,
  returnTo,
  defaultOpen = false,
}: {
  departure: SimpleDeparture;
  date: string;
  timeZone: string;
  currency: string;
  returnTo: string;
  defaultOpen?: boolean;
}) {
  const availability = departureAvailability(departure);
  const statusClass = availability.tone === "success" ? "ui-pill-success" : availability.tone === "danger" ? "ui-pill-danger" : "ui-pill-neutral";

  return (
    <article className="ui-card overflow-hidden">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
          <div className="flex h-14 w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-[var(--ck-surface-sunken)]">
            <span className="font-display text-lg font-semibold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{timeLabel(departure.start_time, timeZone)}</span>
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold leading-tight" style={{ color: "var(--ck-text-strong)" }}>{departure.tour_name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--ck-text-muted)" }}>
              <span className="inline-flex items-center gap-1"><UsersThree size={15} /> {departure.booked_guests} booked</span>
              <span className="inline-flex items-center gap-1"><CheckCircle size={15} /> {departure.arrived_guests} arrived</span>
              <span className={`ui-status ${statusClass}`}>{availability.label}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
          {departure.bookings.length > 0 && (
            <Link href={checkInsUrl(date, departure.id)} className="ui-btn ui-btn-soft !h-11 !rounded-xl !px-3 text-sm font-semibold">
              Check-ins
            </Link>
          )}
          {departure.can_book && (
            <Link
              href={walkInUrl({ date, tourId: departure.tour_id, slotId: departure.id, returnTo })}
              className="ui-btn ui-btn-primary !h-11 !rounded-xl !px-3 text-sm font-semibold"
            >
              <Plus size={17} weight="bold" /> Book
            </Link>
          )}
        </div>
      </div>

      {departure.bookings.length > 0 ? (
        <details className="group border-t" style={{ borderColor: "var(--ck-border-subtle)" }} open={defaultOpen}>
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold marker:content-none hover:bg-[var(--ck-surface-sunken)] sm:px-5">
            <span>{departure.bookings.length} booking{departure.bookings.length === 1 ? "" : "s"}</span>
            <CaretDown size={17} className="transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <ul className="divide-y border-t" style={{ borderColor: "var(--ck-border-subtle)", "--tw-divide-color": "var(--ck-border-subtle)" } as React.CSSProperties}>
            {departure.bookings.map(booking => <BookingRow key={booking.id} booking={booking} currency={currency} />)}
          </ul>
        </details>
      ) : (
        <div className="border-t px-4 py-3 text-sm" style={{ borderColor: "var(--ck-border-subtle)", color: "var(--ck-text-muted)" }}>
          No bookings on this departure yet.
        </div>
      )}
    </article>
  );
}
