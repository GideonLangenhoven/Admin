import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin } from "@/app/lib/api-auth";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { booking_id, slot_id, client_event_id, notes } = body;
  if (!booking_id) return NextResponse.json({ error: "booking_id required" }, { status: 400 });

  const db = adminClient();

  const { data: bk } = await db.from("bookings")
    .select("id, business_id, slot_id, checked_in, checked_in_at")
    .eq("id", booking_id)
    .maybeSingle();

  if (!bk || bk.business_id !== caller.business_id) {
    return NextResponse.json({ error: "Booking not found" }, { status: 403 });
  }
  if (slot_id && slot_id !== bk.slot_id) {
    return NextResponse.json({ error: "slot_id does not match booking" }, { status: 400 });
  }

  const checkedInAt = new Date().toISOString();
  const { error: insertErr } = await db.from("slot_check_ins").insert({
    booking_id,
    slot_id: slot_id || bk.slot_id,
    business_id: bk.business_id,
    actor_admin_id: caller.id,
    client_event_id: client_event_id || null,
    notes: notes || null,
    checked_in_at: checkedInAt,
  });

  const replay = !!(insertErr && insertErr.code === "23505" && client_event_id);
  if (insertErr && !replay) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  if (bk.checked_in && bk.checked_in_at) {
    return NextResponse.json({ ok: true, ...(replay ? { replay: true } : { already_checked_in: true }) });
  }

  let eventCheckedInAt = checkedInAt;
  if (replay) {
    const { data: existingEvent, error: eventError } = await db.from("slot_check_ins")
      .select("checked_in_at")
      .eq("booking_id", booking_id)
      .eq("business_id", caller.business_id)
      .eq("client_event_id", client_event_id)
      .maybeSingle();
    if (eventError || !existingEvent?.checked_in_at) {
      return NextResponse.json({ error: "Existing check-in event could not be verified" }, { status: 500 });
    }
    eventCheckedInAt = existingEvent.checked_in_at;
  }

  const { error: updateErr } = await db.from("bookings").update({
    checked_in: true,
    checked_in_at: eventCheckedInAt,
  }).eq("id", booking_id).eq("business_id", caller.business_id);

  if (updateErr) {
    return NextResponse.json({ error: "Check-in state is pending retry" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...(replay ? { replay: true } : {}) });
}
