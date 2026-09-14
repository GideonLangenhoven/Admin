import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient } from "../_shared/tenant.ts";
import { verifyBookingSuccessToken } from "../_shared/booking-success.ts";

const supabase = createServiceClient();

Deno.serve(async (req: Request) => {
  const headers = {
    "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-tenant-business-id",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "private, no-store",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
  const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return respond(405, { error: "Method not allowed" });

  try {
    const body = await req.json();
    const bookingId = typeof body?.booking_id === "string" ? body.booking_id : "";
    const businessId = req.headers.get("x-tenant-business-id") || "";
    const token = typeof body?.token === "string" ? body.token : "";
    if (!await verifyBookingSuccessToken(token, bookingId, businessId)) {
      return respond(403, { error: "Use your confirmation link or sign in to My Bookings." });
    }
    // Service-role query: BOTH booking and operator are bound to the signature.
    const { data, error } = await supabase.from("bookings")
      .select("id, business_id, customer_name, email, qty, total_amount, voucher_amount_paid, original_total, unit_price, status, payment_status, last_amendment_id, created_at, waiver_status, waiver_token, tours(id, business_id, name, duration_minutes), slots(business_id, start_time)")
      .eq("id", bookingId).eq("business_id", businessId).maybeSingle();
    if (error) return respond(503, { error: "Booking details are temporarily unavailable. Please retry." });
    if (!data || data.id !== bookingId || data.business_id !== businessId) return respond(404, { error: "Booking unavailable" });
    const tour = Array.isArray(data.tours) ? data.tours[0] : data.tours;
    const slot = Array.isArray(data.slots) ? data.slots[0] : data.slots;
    if ((tour && tour.business_id !== businessId) || (slot && slot.business_id !== businessId)) {
      return respond(404, { error: "Booking unavailable" });
    }
    return respond(200, {
      booking: { ...data, tours: tour, slots: slot },
      payment_confirmed: ["PAID", "COMPLETED"].includes(data.status) || data.payment_status === "CAPTURED",
      amendment_confirmed: body.amendment_id ? data.last_amendment_id === body.amendment_id : true,
    });
  } catch {
    // Never log the request or capability, including on malformed requests.
    return respond(503, { error: "Booking details are temporarily unavailable. Please retry." });
  }
});
