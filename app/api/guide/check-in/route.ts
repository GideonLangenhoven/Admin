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
    .select("id, business_id, slot_id")
    .eq("id", booking_id)
    .maybeSingle();

  if (!bk || bk.business_id !== caller.business_id) {
    return NextResponse.json({ error: "Booking not found" }, { status: 403 });
  }

  const { error: insertErr } = await db.from("slot_check_ins").insert({
    booking_id,
    slot_id: slot_id || bk.slot_id,
    business_id: bk.business_id,
    actor_admin_id: caller.id,
    client_event_id: client_event_id || null,
    notes: notes || null,
    checked_in_at: new Date().toISOString(),
  });

  if (insertErr && insertErr.code === "23505") {
    return NextResponse.json({ ok: true, replay: true });
  }
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  await db.from("bookings").update({
    checked_in: true,
    checked_in_at: new Date().toISOString(),
  }).eq("id", booking_id);

  return NextResponse.json({ ok: true });
}
