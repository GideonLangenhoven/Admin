"use client";

import { useEffect, useState } from "react";

// Counts down to a booking's payment deadline. Shared by the bookings list
// and the booking page so both say the same thing.
export default function PaymentExpiryBadge({ deadline, className = "" }: { deadline: string; className?: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(iv);
  }, []);

  const deadlineMs = new Date(deadline).getTime();
  const diffMs = deadlineMs - now;

  if (diffMs <= 0) {
    return (
      <span className={`ui-status ui-pill-danger ${className}`}>
        Expired
      </span>
    );
  }

  const totalMin = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor(totalMin / 60) % 24;
  const mins = totalMin % 60;
  const label = days > 0 ? `Expires in ${days}d ${hours}h` : hours > 0 ? `Expires in ${hours}h ${mins}m` : `Expires in ${mins}m`;

  // Red if within 2 hours, amber if within 6 hours, otherwise gray
  const urgency =
    diffMs <= 2 * 60 * 60_000
      ? "ui-pill-danger"
      : diffMs <= 6 * 60 * 60_000
        ? "ui-pill-warning"
        : "ui-pill-neutral";

  return (
    <span className={`ui-status ${urgency} ${className}`}>
      {label}
    </span>
  );
}
