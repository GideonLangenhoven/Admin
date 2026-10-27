import { EnvelopeSimple, Phone, WhatsappLogo } from "@phosphor-icons/react";
import { contactPhoneNumber } from "../app/lib/contact-links";
import { isEmail } from "../app/lib/sanitize";
import BookingWaiverEmail, { type WaiverEmailBooking } from "./booking/BookingWaiverEmail";

export default function DashboardContact({ booking, requestWaiver = false }: { booking: WaiverEmailBooking & { phone: string | null; email?: string | null }; requestWaiver?: boolean }) {
  const phone = contactPhoneNumber(booking.phone);
  const email = booking.email?.trim() || "";
  const customer = booking.customer_name || "guest";
  const validEmail = isEmail(email);
  if (!phone && !validEmail) return null;
  return <div className="inline-flex shrink-0 items-center gap-0.5" data-contact-icons>
    {phone ? <>
      <a className="ui-btn ui-btn-soft !h-11 !w-11 !min-w-11 !rounded-full !p-0" href={`https://wa.me/${phone}`} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${customer}`} title={`WhatsApp ${customer}`}><WhatsappLogo size={18} aria-hidden="true" /></a>
      <a className="ui-btn ui-btn-soft !h-11 !w-11 !min-w-11 !rounded-full !p-0" href={`tel:+${phone}`} aria-label={`Phone ${customer}`} title={`Phone ${customer}`}><Phone size={18} aria-hidden="true" /></a>
    </> : null}
    {validEmail ? requestWaiver && booking.waiver_status !== "SIGNED" ? <BookingWaiverEmail booking={booking} /> : <a className="ui-btn ui-btn-soft !h-11 !w-11 !min-w-11 !rounded-full !p-0" href={`mailto:${encodeURIComponent(email).replace("%40", "@")}`} aria-label={`Email ${customer}`} title={`Email ${customer}`}><EnvelopeSimple size={18} aria-hidden="true" /></a> : null}
  </div>;
}
