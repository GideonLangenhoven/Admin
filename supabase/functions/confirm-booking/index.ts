import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createServiceClient,
  formatTenantDateTime,
  getBusinessDisplayName,
  getTenantByBusinessId,
  resolveManageBookingsUrl,
  sendWhatsappTextForTenant,
} from "../_shared/tenant.ts";
import { getWaiverContext } from "../_shared/waiver.ts";

var SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
var SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

// Idempotent: sends BOOKING_CONFIRM email + WhatsApp if not already sent.
// Called by the booking success page as a fallback in case the Yoco webhook missed it.
Deno.serve(async (req: any) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });

  try {
    var supabase = createServiceClient();
    var body = await req.json();
    var bookingId = String(body.booking_id || "");

    if (!bookingId) {
      return new Response(JSON.stringify({ error: "booking_id required" }), { status: 400, headers: cors() });
    }

    var br = await supabase
      .from("bookings")
      .select("*, slots(start_time), tours(name)")
      .eq("id", bookingId)
      .maybeSingle();

    if (!br.data) {
      return new Response(JSON.stringify({ error: "Booking not found" }), { status: 404, headers: cors() });
    }

    var booking = br.data;
    if (booking.status !== "PAID" && booking.status !== "COMPLETED") {
      return new Response(JSON.stringify({ ok: false, reason: "Booking not paid yet" }), { status: 200, headers: cors() });
    }

    // Idempotency: check if confirmation was already sent for this booking.
    var { data: existingClaim } = await supabase
      .from("logs")
      .select("id")
      .eq("booking_id", bookingId)
      .eq("event", "booking_confirmation_notifications_sent")
      .maybeSingle();

    if (existingClaim) {
      return new Response(JSON.stringify({ ok: true, already_sent: true }), { status: 200, headers: cors() });
    }

    // Claim the send by inserting the log entry first
    var { data: claimData } = await supabase
      .from("logs")
      .insert({ booking_id: bookingId, business_id: booking.business_id, event: "booking_confirmation_notifications_sent", payload: { claimed_at: new Date().toISOString() } })
      .select("id")
      .single();

    if (!claimData) {
      return new Response(JSON.stringify({ ok: true, already_sent: true }), { status: 200, headers: cors() });
    }

    var tenant = await getTenantByBusinessId(supabase, booking.business_id);
    var ref = booking.id.substring(0, 8).toUpperCase();
    var slotTime = booking.slots?.start_time
      ? formatTenantDateTime(tenant.business, booking.slots.start_time)
      : "See email";
    var tourName = booking.tours?.name || "Booking";
    var brandName = getBusinessDisplayName(tenant.business);
    var waiver = await getWaiverContext(supabase, { bookingId: booking.id, businessId: booking.business_id });
    var currency = tenant.business.currency || "ZAR";

    // Last-minute booking: if trip is within 24 hours, always include waiver link
    var isLastMinute = false;
    if (booking.slots?.start_time) {
      var hoursUntilTrip = (new Date(booking.slots.start_time).getTime() - Date.now()) / (1000 * 60 * 60);
      isLastMinute = hoursUntilTrip < 24 && hoursUntilTrip > 0;
    }

    var invR = await supabase
      .from("invoices")
      .select("invoice_number, payment_reference")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    var invoice = invR.data;

    var waSent = false;
    var emailSent = false;
    var waError = "";
    var emailError = "";

    if (booking.phone) {
      try {
        var myBookingsUrl = resolveManageBookingsUrl(tenant.business);
        await sendWhatsappTextForTenant(
          tenant,
          booking.phone,
          "Booking Confirmed \u2705\n\n" +
          "Ref: " + ref + "\n" +
          tourName + "\n" +
          slotTime + "\n" +
          booking.qty + " guest" + (booking.qty === 1 ? "" : "s") + "\n" +
          currency + " " + booking.total_amount + " paid\n\n" +
          (waiver.waiverStatus !== "SIGNED" && waiver.waiverLink
            ? (isLastMinute ? "\u26A0\uFE0F Please sign your waiver before the trip:\n" : "\u{1F4DD} Waiver: ") + waiver.waiverLink + "\n\n"
            : "") +
          "Manage your booking anytime:\n" + myBookingsUrl + "\n\n" +
          "Thanks for booking with " + brandName + " \u2014 see you on the water!",
          {
            name: "booking_confirmed",
            params: [ref, tourName, slotTime, String(booking.qty), currency + " " + booking.total_amount, myBookingsUrl],
          },
        );
        waSent = true;
      } catch (e) {
        waError = e instanceof Error ? e.message : String(e);
        console.error("CONFIRM_BOOKING_WA_ERR:", e);
      }
    }

    if (booking.email) {
      try {
        var { data: emailData, error: emailInvokeErr } = await supabase.functions.invoke("send-email", {
          body: {
            type: "BOOKING_CONFIRM",
            data: {
              email: booking.email,
              booking_id: booking.id,
              business_id: booking.business_id,
              waiver_status: waiver.waiverStatus,
              waiver_url: waiver.waiverLink,
              is_last_minute: isLastMinute,
              customer_name: booking.customer_name,
              customer_email: booking.email,
              ref: ref,
              payment_reference: invoice?.payment_reference || booking.yoco_payment_id || "",
              tour_name: tourName,
              tour_date: slotTime,
              start_time: slotTime,
              qty: booking.qty,
              total_amount: booking.total_amount,
              invoice_number: invoice?.invoice_number || "",
            },
          },
        });
        if (emailInvokeErr || emailData?.error) {
          emailError = String(emailInvokeErr?.message || emailData?.error || "Email send failed");
          console.error("CONFIRM_BOOKING_EMAIL_ERR:", emailError);
        } else {
          emailSent = true;
        }
      } catch (e) {
        emailError = e instanceof Error ? e.message : String(e);
        console.error("CONFIRM_BOOKING_EMAIL_ERR:", e);
      }
    }

    await supabase.from("logs").update({
      payload: {
        source: "confirm-booking-fallback",
        wa_sent: waSent,
        email_sent: emailSent,
        wa_error: waError || null,
        email_error: emailError || null,
      },
    }).eq("id", claimData.id);

    return new Response(
      JSON.stringify({ ok: true, email_sent: emailSent, wa_sent: waSent }),
      { status: 200, headers: cors() },
    );
  } catch (err: any) {
    console.error("CONFIRM_BOOKING_ERR:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: cors() });
  }
});
