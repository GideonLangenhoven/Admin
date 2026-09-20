import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getCallerAdmin } from "@/app/lib/api-auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function statusForCode(code: string | undefined) {
  if (code === "NOT_FOUND") return 404;
  if (code === "STALE" || code === "STALE_SLOT") return 409;
  if (code === "PAYMENT_REQUIRED" || code === "WAIVER_REQUIRED") return 422;
  return 400;
}

export async function handleBookingArrivalRequest(req: Request, source: "simple-view" | "guide-pwa" | "dashboard" | "bookings") {
  const caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const bookingId = typeof body.booking_id === "string" ? body.booking_id : "";
  const slotId = typeof body.slot_id === "string" && body.slot_id ? body.slot_id : null;
  const eventId = typeof body.client_event_id === "string" ? body.client_event_id.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  const arrivedCount = body.arrived_count == null ? null : Number(body.arrived_count);
  const expectedCount = body.expected_arrived_count == null ? null : Number(body.expected_arrived_count);

  if (!UUID_RE.test(bookingId)) {
    return NextResponse.json({ error: "A valid booking_id is required" }, { status: 400 });
  }
  if (slotId && !UUID_RE.test(slotId)) {
    return NextResponse.json({ error: "slot_id must be a valid UUID" }, { status: 400 });
  }
  if (arrivedCount != null && (!Number.isInteger(arrivedCount) || arrivedCount < 0)) {
    return NextResponse.json({ error: "arrived_count must be a non-negative whole number" }, { status: 400 });
  }
  if (expectedCount != null && (!Number.isInteger(expectedCount) || expectedCount < 0)) {
    return NextResponse.json({ error: "expected_arrived_count must be a non-negative whole number" }, { status: 400 });
  }
  if (!eventId || eventId.length > 160) {
    return NextResponse.json({ error: "client_event_id is required and must be 160 characters or fewer" }, { status: 400 });
  }

  const { data, error } = await serviceClient().rpc("record_booking_arrival", {
    p_booking_id: bookingId,
    p_business_id: caller.business_id,
    p_actor_admin_id: caller.id,
    p_arrived_count: arrivedCount,
    p_expected_arrived_count: expectedCount,
    p_client_event_id: eventId,
    p_source: source,
    p_notes: notes || null,
    p_slot_id: slotId,
  });

  if (error) {
    console.error(JSON.stringify({
      level: "error",
      code: "BOOKING_ARRIVAL_RPC_FAILED",
      business_id: caller.business_id,
      booking_id: bookingId,
      detail: error.message,
    }));
    return NextResponse.json({ error: "Could not save the arrival count" }, { status: 500 });
  }

  const result = (data || {}) as Record<string, unknown>;
  if (result.ok !== true) {
    return NextResponse.json(result, { status: statusForCode(String(result.code || "")) });
  }
  return NextResponse.json(result);
}
