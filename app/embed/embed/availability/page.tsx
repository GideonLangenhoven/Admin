"use client";

/**
 * Embeddable availability widget.
 *
 * Usage (iframe):
 *   <iframe
 *     src="https://admin.bookingtours.co.za/embed/availability?bid=BUSINESS_UUID"
 *     width="100%" height="480" frameBorder="0"
 *   ></iframe>
 *
 * Query params:
 *   bid   — (required) business UUID
 *   tour  — (optional) pre-select a tour by UUID
 *   link  — (optional) "Book Now" destination URL
 *   guests — (optional) default guest count (1-20, default 2)
 */

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";

interface Tour {
  id: string;
  name: string;
  base_price_per_person: number;
  duration_minutes: number;
}

interface Slot {
  id: string;
  tour_id: string;
  tour_name: string;
  start_time: string;
  available_capacity: number;
  price: number;
}

interface Business {
  name: string;
  timezone: string;
  logo_url: string | null;
}

function fmtTz(date: Date, tz: string, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-ZA", { ...opts, timeZone: tz }).format(
    date,
  );
}

function AvailabilityWidget() {
  const params = useSearchParams();
  const bid = params.get("bid");
  const preselectedTour = params.get("tour") || "";
  const bookingLink = params.get("link") || "";
  const defaultGuests = Math.min(
    20,
    Math.max(1, Number(params.get("guests")) || 2),
  );

  const [business, setBusiness] = useState<Business | null>(null);
  const [tours, setTours] = useState<Tour[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [tourId, setTourId] = useState(preselectedTour);
  const [guests, setGuests] = useState(defaultGuests);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!bid) return;
    let cancelled = false;
    setLoading(true);
    setError("");

    fetch(`/api/widget-availability?bid=${encodeURIComponent(bid)}`)
      .then((r) =>
        r.ok
          ? r.json()
          : Promise.reject(new Error("Could not load availability")),
      )
      .then((data) => {
        if (cancelled) return;
        setBusiness(data.business);
        setTours(data.tours);
        setSlots(data.slots);
        setTourId((prev) => prev || (data.tours[0]?.id ?? ""));
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Something went wrong");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bid, refreshKey]);

  const tz = business?.timezone || "Africa/Johannesburg";

  const filteredSlots = useMemo(() => {
    if (!tourId) return slots;
    return slots.filter((s) => s.tour_id === tourId);
  }, [slots, tourId]);

  const days = useMemo(() => {
    const result: { label: string; sub: string; key: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      const d = new Date(now.getTime() + i * 86_400_000);
      result.push({
        label: fmtTz(d, tz, { weekday: "short" }).toUpperCase(),
        sub: fmtTz(d, tz, { day: "numeric", month: "short" }),
        key: fmtTz(d, tz, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }),
      });
    }
    return result;
  }, [tz]);

  const { times, grid } = useMemo(() => {
    const timeSet = new Set<string>();
    const map: Record<string, Record<string, Slot>> = {};

    for (const s of filteredSlots) {
      const d = new Date(s.start_time);
      const time = fmtTz(d, tz, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const dateKey = fmtTz(d, tz, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      timeSet.add(time);
      if (!map[time]) map[time] = {};
      if (
        !map[time][dateKey] ||
        s.available_capacity > map[time][dateKey].available_capacity
      ) {
        map[time][dateKey] = s;
      }
    }

    return { times: Array.from(timeSet).sort(), grid: map };
  }, [filteredSlots, tz]);

  if (!bid) {
    return (
      <div className="flex items-center justify-center min-h-[200px] p-6">
        <p className="text-sm text-gray-500">
          Missing business ID parameter (bid)
        </p>
      </div>
    );
  }

  const bookableDays = days.filter((d) =>
    times.some((t) => {
      const slot = grid[t]?.[d.key];
      return slot && slot.available_capacity >= guests;
    }),
  ).length;

  return (
    <div className="w-full max-w-2xl mx-auto p-4">
      {/* Business header */}
      {business && (
        <div className="mb-4 flex items-center gap-2.5">
          {business.logo_url && (
            <img
              src={business.logo_url}
              alt=""
              className="h-8 w-8 rounded-lg object-contain"
            />
          )}
          <div>
            <h2
              className="text-sm font-bold tracking-tight"
              style={{ color: "var(--ck-text-strong, #111827)" }}
            >
              {business.name}
            </h2>
            <p
              className="text-[11px]"
              style={{ color: "var(--ck-text-muted, #6b7280)" }}
            >
              Availability for the next 5 days
            </p>
          </div>
        </div>
      )}

      {/* Search bar */}
      <div
        className="flex items-stretch rounded-full border overflow-hidden"
        style={{
          background: "var(--ck-surface, #ffffff)",
          borderColor: "var(--ck-border-strong, #d1d5db)",
          boxShadow:
            "var(--ck-shadow-md, 0 4px 12px -2px rgba(17,24,39,0.04))",
        }}
      >
        <label
          className="flex-1 min-w-0 px-5 py-3 border-r cursor-pointer"
          style={{ borderColor: "var(--ck-border-subtle, #e2e5e9)" }}
        >
          <span
            className="block text-[10px] font-semibold uppercase"
            style={{
              color: "var(--ck-text-muted, #6b7280)",
              letterSpacing: "0.08em",
            }}
          >
            Tour
          </span>
          <select
            value={tourId}
            onChange={(e) => setTourId(e.target.value)}
            className="w-full bg-transparent text-sm font-medium outline-none truncate appearance-none cursor-pointer"
            style={{ color: "var(--ck-text-strong, #111827)" }}
          >
            {tours.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        <label
          className="px-5 py-3 border-r cursor-pointer"
          style={{ borderColor: "var(--ck-border-subtle, #e2e5e9)" }}
        >
          <span
            className="block text-[10px] font-semibold uppercase"
            style={{
              color: "var(--ck-text-muted, #6b7280)",
              letterSpacing: "0.08em",
            }}
          >
            Guests
          </span>
          <select
            value={guests}
            onChange={(e) => setGuests(Number(e.target.value))}
            className="bg-transparent text-sm font-medium outline-none appearance-none cursor-pointer"
            style={{ color: "var(--ck-text-strong, #111827)" }}
          >
            {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "guest" : "guests"}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center px-3">
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="flex h-10 w-10 items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95"
            style={{ background: "var(--ck-accent, #125e40)", color: "#fff" }}
            title="Refresh availability"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="mt-8 flex flex-col items-center gap-2 py-12">
          <div
            className="h-7 w-7 animate-spin rounded-full border-[3px] border-gray-200"
            style={{ borderTopColor: "var(--ck-accent, #125e40)" }}
          />
          <p
            className="text-xs"
            style={{ color: "var(--ck-text-muted, #6b7280)" }}
          >
            Loading availability...
          </p>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Grid */}
      {!loading && !error && times.length > 0 && (
        <div
          className="mt-4 rounded-xl border overflow-hidden"
          style={{
            borderColor: "var(--ck-border-subtle, #e2e5e9)",
            background: "var(--ck-surface, #ffffff)",
          }}
        >
          <div className="flex items-center justify-end px-4 py-2">
            <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold border-emerald-200 bg-emerald-50 text-emerald-700">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
              {bookableDays} {bookableDays === 1 ? "day" : "days"} with bookable
              capacity
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 500 }}>
              <thead>
                <tr
                  style={{
                    background: "var(--ck-surface-elevated, #f9fafb)",
                  }}
                >
                  <th
                    className="px-4 py-3 text-left"
                    style={{
                      color: "var(--ck-text-muted, #6b7280)",
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    Timeslot
                  </th>
                  {days.map((d) => (
                    <th
                      key={d.key}
                      className="px-2 py-3 text-center"
                      style={{ minWidth: 80 }}
                    >
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          color: "var(--ck-text-muted, #6b7280)",
                        }}
                      >
                        {d.label}
                      </div>
                      <div
                        className="mt-0.5"
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "var(--ck-text-strong, #111827)",
                        }}
                      >
                        {d.sub}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {times.map((time, idx) => (
                  <tr
                    key={time}
                    style={{
                      borderTop:
                        idx > 0
                          ? "1px solid var(--ck-border-subtle, #e2e5e9)"
                          : undefined,
                    }}
                  >
                    <td
                      className="px-4 py-3.5 tabular-nums"
                      style={{
                        fontWeight: 700,
                        fontSize: 13,
                        color: "var(--ck-text-strong, #111827)",
                      }}
                    >
                      {time}
                    </td>
                    {days.map((d) => {
                      const slot = grid[time]?.[d.key];
                      if (!slot) {
                        return (
                          <td
                            key={d.key}
                            className="px-2 py-3.5 text-center text-xs"
                            style={{
                              color: "var(--ck-text-muted, #6b7280)",
                            }}
                          >
                            —
                          </td>
                        );
                      }

                      const cap = slot.available_capacity;
                      const full = cap === 0;
                      const enough = cap >= guests;

                      let bg: string;
                      let fg: string;
                      let label: string;

                      if (full) {
                        bg = "rgba(239,68,68,0.07)";
                        fg = "#ef4444";
                        label = "FULL";
                      } else if (enough) {
                        bg = "rgba(16,185,129,0.07)";
                        fg = "#059669";
                        label = `${cap} OPEN`;
                      } else {
                        bg = "rgba(245,158,11,0.07)";
                        fg = "#d97706";
                        label = `${cap} OPEN`;
                      }

                      return (
                        <td
                          key={d.key}
                          className="px-2 py-3.5 text-center"
                          style={{ background: bg }}
                        >
                          <span
                            className="tabular-nums"
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: fg,
                            }}
                          >
                            {label}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && times.length === 0 && tours.length > 0 && (
        <div
          className="mt-6 rounded-xl border p-8 text-center"
          style={{
            borderColor: "var(--ck-border-subtle, #e2e5e9)",
            background: "var(--ck-surface, #ffffff)",
          }}
        >
          <p
            className="text-sm"
            style={{ color: "var(--ck-text-muted, #6b7280)" }}
          >
            No availability in the next 5 days for this tour
          </p>
        </div>
      )}

      {/* No tours */}
      {!loading && !error && tours.length === 0 && !loading && (
        <div
          className="mt-6 rounded-xl border p-8 text-center"
          style={{
            borderColor: "var(--ck-border-subtle, #e2e5e9)",
            background: "var(--ck-surface, #ffffff)",
          }}
        >
          <p
            className="text-sm"
            style={{ color: "var(--ck-text-muted, #6b7280)" }}
          >
            No tours available at the moment
          </p>
        </div>
      )}

      {/* Book Now */}
      {!loading && !error && times.length > 0 && bookingLink && (
        <div className="mt-5 text-center">
          <a
            href={bookingLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full px-8 py-3 text-sm font-bold transition-all hover:-translate-y-0.5 active:translate-y-0"
            style={{
              background: "var(--ck-accent, #125e40)",
              color: "#fff",
              boxShadow: "0 4px 14px -2px rgba(18,94,64,0.4)",
            }}
          >
            Book Now
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </a>
        </div>
      )}

      {/* Footer */}
      <div className="mt-5 flex items-center justify-center gap-1.5">
        <span className="grid grid-cols-2 gap-[1px] h-2.5 w-2.5 shrink-0 opacity-40">
          <span
            className="rounded-tl-full"
            style={{ background: "var(--ck-accent, #125e40)" }}
          />
          <span
            className="rounded-tr-full"
            style={{ background: "var(--ck-accent, #125e40)" }}
          />
          <span
            className="rounded-bl-full"
            style={{ background: "var(--ck-accent, #125e40)" }}
          />
          <span
            className="rounded-br-full opacity-50"
            style={{ background: "var(--ck-accent, #125e40)" }}
          />
        </span>
        <span
          className="text-[9px] font-medium uppercase opacity-40"
          style={{
            letterSpacing: "0.1em",
            color: "var(--ck-text-muted, #6b7280)",
          }}
        >
          Powered by BookingTours
        </span>
      </div>
    </div>
  );
}

export default function AvailabilityPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[200px] p-6">
          <div
            className="h-7 w-7 animate-spin rounded-full border-[3px] border-gray-200"
            style={{ borderTopColor: "#125e40" }}
          />
        </div>
      }
    >
      <AvailabilityWidget />
    </Suspense>
  );
}
