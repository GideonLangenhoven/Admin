import { EnvelopeSimple, Phone, WhatsappLogo } from "@phosphor-icons/react";
import { contactPhoneNumber } from "@/app/lib/contact-links";
import { isEmail } from "@/app/lib/sanitize";
import BookingWaiverEmail, { type WaiverEmailBooking } from "@/components/booking/BookingWaiverEmail";

export default function BookingContact({ booking, requestWaiver = false }: { booking: WaiverEmailBooking & { phone: string | null; email: string | null }; requestWaiver?: boolean }) {
  const email = booking.email?.trim() || "";
  const phoneNumber = contactPhoneNumber(booking.phone);
  const validEmail = isEmail(email);
  const customer = booking.customer_name || "guest";

  if (!phoneNumber && !validEmail) return null;

  return (
    <div className="sv-booking-contact" data-contact-icons>
      {phoneNumber && (
        <>
          <a href={`https://wa.me/${phoneNumber}`} target="_blank" rel="noopener noreferrer" className="ui-btn ui-btn-soft !h-11 !w-11 !min-w-11 !rounded-full !p-0" aria-label={`WhatsApp ${customer}`} title={`WhatsApp ${customer}`}>
            <WhatsappLogo size={18} aria-hidden="true" />
          </a>
          <a href={`tel:+${phoneNumber}`} target="_blank" rel="noopener noreferrer" className="ui-btn ui-btn-soft !h-11 !w-11 !min-w-11 !rounded-full !p-0" aria-label={`Call ${customer}`} title={`Call ${customer}`}>
            <Phone size={18} aria-hidden="true" />
          </a>
        </>
      )}
      {validEmail && (requestWaiver && booking.waiver_status !== "SIGNED" ? <BookingWaiverEmail booking={booking} /> :
        <a href={`mailto:${encodeURIComponent(email).replace("%40", "@")}`} className="ui-btn ui-btn-soft !h-11 !w-11 !min-w-11 !rounded-full !p-0" aria-label={`Email ${customer}`} title={`Email ${customer}`}>
          <EnvelopeSimple size={18} aria-hidden="true" />
        </a>
      )}
    </div>
  );
}
