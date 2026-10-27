"use client";

import { useRef, useState } from "react";
import { CircleNotch, EnvelopeSimple } from "@phosphor-icons/react";
import { supabase } from "@/app/lib/supabase";
import { notify } from "@/app/lib/app-notify";
import { useBusinessContext } from "@/components/BusinessContext";

export type WaiverEmailBooking = {
  id: string;
  customer_name: string | null;
  status: string;
  waiver_status?: string | null;
};

export default function BookingWaiverEmail({ booking }: { booking: WaiverEmailBooking }) {
  const { businessId, readOnly } = useBusinessContext();
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const unavailable = readOnly || !businessId || booking.waiver_status === "SIGNED" || ["CANCELLED", "EXPIRED"].includes(booking.status);
  const customer = booking.customer_name || "guest";
  const label = sending ? `Sending waiver to ${customer}` : `Email waiver to ${customer}`;

  async function sendWaiver() {
    if (unavailable || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    try {
      const response = await supabase.functions.invoke("send-email", {
        body: { type: "WAIVER_REQUEST", data: { business_id: businessId, booking_id: booking.id } },
      });
      let detail = response.data;
      if (response.error?.context instanceof Response) detail = await response.error.context.json().catch(() => detail);
      if (response.error || detail?.ok !== true) {
        notify({ title: "Waiver email not sent", message: detail?.error || response.error?.message || "Please try again.", tone: "error" });
      } else {
        notify({ title: "Waiver email sent", message: `The waiver was emailed to ${customer}.`, tone: "success" });
      }
    } catch {
      notify({ title: "Email outcome unknown", message: "Connection lost. Check booking history before retrying.", tone: "warning" });
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  return <button type="button" className="ui-btn ui-btn-soft !h-11 !w-11 !min-w-11 !rounded-full !p-0" onClick={sendWaiver} disabled={Boolean(unavailable) || sending} aria-label={label} title={label} aria-busy={sending}>
    {sending ? <CircleNotch size={18} className="motion-safe:animate-spin" aria-hidden="true" /> : <EnvelopeSimple size={18} aria-hidden="true" />}
  </button>;
}
