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
    <li className="sv-booking-row">
      <div className="min-w-0 flex-1">
        <p className="sv-customer-name">{booking.customer_name || "Guest"}</p>
        <p className="mt-0.5 text-xs" style={{ color: "var(--ck-text-muted)" }}>
          {booking.qty} guest{booking.qty === 1 ? "" : "s"}
          <span aria-hidden="true"> · </span>
          <span className={settled ? "text-[var(--ck-success)]" : "text-[var(--ck-warning)]"}>
            {settled ? "Paid" : due > 0 ? `${money(due, currency)} due` : booking.status.replaceAll("_", " ")}
          </span>
        </p>
      </div>
      <span className={`ui-status shrink-0 sv-arrival-pill ${booking.checked_in ? "sv-arrival-pill--full" : booking.arrived_count === 0 ? "sv-arrival-pill--empty" : ""}`}>
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
    <article className="sv-departure">
      <div className="sv-departure-main">
        <div className="sv-departure-identity">
          <div className="sv-departure-time">
            <time dateTime={departure.start_time}>{timeLabel(departure.start_time, timeZone)}</time>
            <small>Departure</small>
          </div>
          <div className="min-w-0">
            <h2 className="sv-departure-name">{departure.tour_name}</h2>
            <div className="sv-departure-meta">
              <span className="inline-flex items-center gap-1"><UsersThree size={15} /> {departure.booked_guests} booked</span>
              <span className="inline-flex items-center gap-1"><CheckCircle size={15} /> {departure.arrived_guests} arrived</span>
              <span className={`ui-status ${statusClass}`}>{availability.label}</span>
            </div>
          </div>
        </div>

        <div className="sv-departure-actions">
          {departure.bookings.length > 0 && (
            <Link href={checkInsUrl(date, departure.id)} className="ui-btn ui-btn-soft">
              Check-ins
            </Link>
          )}
          {departure.can_book && (
            <Link
              href={walkInUrl({ date, tourId: departure.tour_id, slotId: departure.id, returnTo })}
              className="ui-btn ui-btn-primary"
            >
              <Plus size={17} weight="bold" /> Book
            </Link>
          )}
        </div>
      </div>

      {departure.bookings.length > 0 ? (
        <details className="sv-booking-details" open={defaultOpen}>
          <summary>
            <span>{departure.bookings.length} booking{departure.bookings.length === 1 ? "" : "s"}</span>
            <CaretDown size={17} aria-hidden="true" />
          </summary>
          <ul>
            {departure.bookings.map(booking => <BookingRow key={booking.id} booking={booking} currency={currency} />)}
          </ul>
        </details>
      ) : (
        <div className="sv-empty-departure">
          No bookings on this departure yet.
        </div>
      )}
    </article>
  );
}
