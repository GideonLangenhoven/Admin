import Link from "next/link";
import { PencilSimple } from "@phosphor-icons/react";
import { checkInsUrl } from "@/app/lib/simple-view";

export default function ArrivalCountLink({ booking, date, slotId, guide = false }: {
  booking: { id: string; customer_name: string | null; qty: number; arrived_count: number };
  date: string;
  slotId: string;
  guide?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span>{booking.qty} {booking.qty === 1 ? "guest" : "guests"}</span>
      <Link href={`${checkInsUrl(date, slotId, guide)}#arrived-${encodeURIComponent(booking.id)}`}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg no-underline hover:bg-[var(--ck-surface-sunken)]"
        aria-label={`Edit arrivals for ${booking.customer_name || "Guest"}: ${booking.arrived_count} of ${booking.qty} arrived`}
        title="Edit number of guests arrived">
        <PencilSimple size={18} aria-hidden="true" />
      </Link>
    </span>
  );
}
