import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function authenticatedClient(authorization: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

function statusForCode(code: string | undefined) {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "SUBSCRIPTION_REQUIRED") return 403;
  if (code === "NOT_FOUND") return 404;
  if (code === "STALE" || code === "STALE_SLOT") return 409;
  if (code === "PAYMENT_REQUIRED" || code === "WAIVER_REQUIRED") return 422;
  return 400;
}

export async function handleBookingArrivalRequest(req: Request, source: "simple-view" | "guide-pwa" | "dashboard" | "bookings") {
  const authorization = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const businessId = req.headers.get("x-admin-business-id")?.trim() || "";
  if (!UUID_RE.test(businessId)) {
    return NextResponse.json({ error: "A valid business context is required" }, { status: 400 });
  }

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

  const { data, error } = await authenticatedClient(authorization).rpc("record_authenticated_booking_arrival", {
    p_booking_id: bookingId,
    p_business_id: businessId,
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
      business_id: businessId,
      booking_id: bookingId,
      detail: error.message,
    }));
    const unauthorized = ["42501", "PGRST301", "PGRST302"].includes(error.code || "");
    return NextResponse.json(
      { error: unauthorized ? "Unauthorized" : "Could not save the arrival count" },
      { status: unauthorized ? 401 : 500 },
    );
  }

  const result = (data || {}) as Record<string, unknown>;
  if (result.ok !== true) {
    return NextResponse.json(result, { status: statusForCode(String(result.code || "")) });
  }
  return NextResponse.json(result);
}
