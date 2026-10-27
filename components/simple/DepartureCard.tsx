"use client";

import Link from "next/link";
import { useState } from "react";
import { CaretDown, Check, CheckCircle, Minus, UsersThree } from "@phosphor-icons/react";
import { useBusinessContext } from "@/components/BusinessContext";
import { arrivalReadiness } from "@/app/lib/operator-day";
import { setArrivedCountAction } from "@/app/lib/booking-actions";
import { bookingResolutionUrl, rememberReturnPosition } from "@/app/lib/simple-view";
import type { SimpleBooking, SimpleDeparture } from "@/app/simple/simple-data";
import BookingContact from "./BookingContact";
import ArrivalCountLink from "@/components/booking/ArrivalCountLink";

function timeLabel(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(iso));
}

function departureAvailability(departure: SimpleDeparture) {
  if (departure.status === "CANCELLED") return { label: "Cancelled", tone: "danger" };
  if (departure.status === "CLOSED") return { label: "Closed", tone: "gray" };
  if (new Date(departure.start_time).getTime() <= Date.now()) return { label: "Departed", tone: "gray" };
  if (departure.available_capacity === 0) return { label: "Full", tone: "danger" };
  if (departure.available_capacity == null) return { label: "Unavailable", tone: "gray" };
  return { label: `${departure.available_capacity} spot${departure.available_capacity === 1 ? "" : "s"} open`, tone: "success" };
}

function BookingRow({ booking, reload, returnTo, refreshing, date }: { booking: SimpleBooking; returnTo: string; refreshing: boolean; date: string; reload: (quiet?: boolean) => Promise<void> }) {
  const { businessId, readOnly, role } = useBusinessContext();
  const guide = role === "GUIDE";
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const { canIncrease, resolutionSection, resolutionLabel } = arrivalReadiness(booking, { requirePaid: true });
  const fullyArrived = booking.qty > 0 && booking.arrived_count === booking.qty;
  const canCheckIn = canIncrease;

  async function toggleArrival() {
    if (busy || refreshing || readOnly || booking.qty <= 0 || (!fullyArrived && !canCheckIn)) return;
    setBusy(true);
    setMessage(null);
    const arrivedCount = fullyArrived ? 0 : booking.qty;
    const result = await setArrivedCountAction({
      bookingId: booking.id,
      businessId,
      arrivedCount,
      expectedArrivedCount: booking.arrived_count,
      slotId: booking.slot_id,
      source: "simple-view",
      guide,
      notes: fullyArrived ? "Arrival count corrected by operator" : undefined,
    });
    setMessage(result.ok
      ? { tone: "success", text: `${arrivedCount} of ${booking.qty} guests recorded as arrived.` }
      : { tone: "error", text: result.error || "Arrival count was not saved." });
    await reload(true);
    setBusy(false);
  }

  return (
    <li className="sv-booking-row" data-booking-id={booking.id} data-arrived={fullyArrived}>
      <div className="sv-booking-name-row">
        {guide ? <span className="sv-customer-name">{booking.customer_name || "Guest"}</span> : <Link className="sv-customer-name no-underline" onClick={() => rememberReturnPosition(businessId, returnTo)} href={bookingResolutionUrl(booking.id, returnTo)}>{booking.customer_name || "Guest"}</Link>}
        <BookingContact booking={booking} requestWaiver />
      </div>
      <div className="sv-roll-call-guest">
        <button
          type="button"
          role="checkbox"
          aria-checked={fullyArrived ? true : booking.arrived_count > 0 ? "mixed" : false}
          aria-label={fullyArrived ? `Mark ${booking.customer_name || "Guest"} as not present` : `Mark all of ${booking.customer_name || "Guest"}'s group as present`}
          aria-describedby={!fullyArrived && !canCheckIn ? `arrival-blocked-${booking.id}` : undefined}
          data-demo-action={fullyArrived ? "dashboard.uncheck" : "dashboard.checkin"}
          onClick={toggleArrival}
          disabled={busy || refreshing || booking.qty <= 0 || (!fullyArrived && !canCheckIn)}
          className="sv-roll-call-check"
        >
          {fullyArrived ? <Check size={22} weight="bold" aria-hidden="true" /> : booking.arrived_count > 0 ? <Minus size={22} aria-hidden="true" /> : null}
        </button>
        <ArrivalCountLink booking={booking} date={date} slotId={booking.slot_id} guide={guide} />
        <span className={`ui-status sv-arrival-pill ${fullyArrived ? "sv-arrival-pill--full" : booking.arrived_count === 0 ? "sv-arrival-pill--empty" : ""}`} aria-label={`${booking.arrived_count} of ${booking.qty} arrived`}>
          {booking.arrived_count}/{booking.qty}
        </span>
      </div>
      {!fullyArrived && !canCheckIn && <p id={`arrival-blocked-${booking.id}`} className="sv-arrival-guidance" style={{ color: "var(--ck-text-muted)" }}>{guide ? resolutionLabel : <Link className="no-underline" onClick={() => rememberReturnPosition(businessId, returnTo)} href={bookingResolutionUrl(booking.id, returnTo, resolutionSection)}>{resolutionLabel}</Link>}</p>}
      {message && <p className="sv-roll-call-message text-sm font-medium" role="status" style={{ color: message.tone === "success" ? "var(--ck-success)" : "var(--ck-danger)" }}>{message.text}</p>}
    </li>
  );
}

export default function DepartureCard({
  departure,
  date,
  timeZone,
  returnTo,
  reload,
  refreshing = false,
}: {
  departure: SimpleDeparture;
  date: string;
  timeZone: string;
  returnTo: string;
  reload: (quiet?: boolean) => Promise<void>;
  refreshing?: boolean;
}) {
  const { role } = useBusinessContext();
  const guide = role === "GUIDE";
  const availability = departureAvailability(departure);
  const statusClass = availability.tone === "success" ? "ui-pill-success" : availability.tone === "danger" ? "ui-pill-danger" : "ui-pill-neutral";

  return (
    <article className="sv-departure" data-slot-id={departure.id}>
      <details open>
        <summary className="sv-departure-main" aria-label={`${departure.tour_name} at ${timeLabel(departure.start_time, timeZone)}`}>
          <div className="sv-departure-identity">
            <div className="sv-departure-time">
              <time dateTime={departure.start_time}>{timeLabel(departure.start_time, timeZone)}</time>
              <small>Session</small>
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

          <CaretDown size={20} aria-hidden="true" className="sv-departure-chevron shrink-0" />
        </summary>

        {guide && <div className="sv-departure-actions">
          <Link href={`/simpleguide/photos/${departure.id}?date=${date}`} className="ui-btn ui-btn-soft">Trip photos</Link>
        </div>}

        <div id={`roll-call-${departure.id}`}>
        <div className="sv-roll-call-heading">
          <h3>Roll call</h3>
          <span>{departure.bookings.length} booking{departure.bookings.length === 1 ? "" : "s"}</span>
        </div>
        <ul aria-label={`Roll call for ${departure.tour_name} at ${timeLabel(departure.start_time, timeZone)}`}>
          {departure.bookings.map(booking => <BookingRow key={booking.id} booking={booking} reload={reload} returnTo={returnTo} refreshing={refreshing} date={date} />)}
        </ul>
        </div>
      </details>
    </article>
  );
}
