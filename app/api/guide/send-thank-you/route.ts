import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin } from "@/app/lib/api-auth";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const { slot_id } = body;
  if (!slot_id) return NextResponse.json({ error: "slot_id required" }, { status: 400 });

  const db = adminClient();

  const { data: slot } = await db.from("slots")
    .select("id, business_id, tours(name)")
    .eq("id", slot_id)
    .maybeSingle();

  if (!slot || (slot as any).business_id !== caller.business_id) {
    return NextResponse.json({ error: "Slot not found" }, { status: 403 });
  }

  const tourName = (slot as any).tours?.name || "your adventure";

  const { data: bookings, error: bookingError } = await db.from("bookings")
    .select("id, email, customer_name")
    .eq("slot_id", slot_id)
    .eq("business_id", caller.business_id)
    .in("status", ["PAID", "CONFIRMED", "COMPLETED"]);

  if (bookingError) return NextResponse.json({ error: "Could not load the trip's customers" }, { status: 500 });
  if (!bookings?.length) return NextResponse.json({ error: "No customers on this slot" }, { status: 400 });

  const { data: photos, error: photoError } = await db.from("trip_photos")
    .select("photo_url, gdrive_view_url")
    .eq("slot_id", slot_id)
    .eq("business_id", caller.business_id);

  if (photoError) return NextResponse.json({ error: "Could not load the trip's photos" }, { status: 500 });
  const photoUrls = [...new Set((photos || []).map((p: any) => p.gdrive_view_url || p.photo_url).filter(Boolean))];
  if (!photoUrls.length) return NextResponse.json({ error: "No photos uploaded for this slot" }, { status: 400 });

  const results: { booking_id: string; ok: boolean; error?: string }[] = [];
  for (const b of bookings) {
    if (!b.email) {
      results.push({ booking_id: b.id, ok: false, error: "No email address" });
      continue;
    }
    try {
      const r = await fetch(supabaseUrl + "/functions/v1/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + serviceKey },
        body: JSON.stringify({
          type: "TRIP_PHOTOS",
          data: {
            business_id: caller.business_id,
            email: b.email,
            customer_name: b.customer_name || "Guest",
            tour_name: tourName,
            photo_url: photoUrls[0],
            photo_urls: photoUrls,
          },
        }),
      });
      const outcome = await r.json();
      const ok = r.ok && outcome.ok === true;
      results.push({ booking_id: b.id, ok, ...(!ok ? { error: String(outcome.error || "Email was not sent") } : {}) });
    } catch (e: any) {
      results.push({ booking_id: b.id, ok: false, error: e?.message });
    }
  }

  await db.from("audit_logs").insert({
    actor_id: caller.id,
    business_id: caller.business_id,
    action_type: "TRIP_PHOTOS_SENT",
    target_entity: "slots",
    target_id: slot_id,
    after_state: { recipient_count: results.filter(r => r.ok).length, photo_count: photoUrls.length, source: "guide-pwa" },
  });

  return NextResponse.json({
    ok: results.every(r => r.ok),
    recipient_count: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok),
  });
}
