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

  const { data: bookings } = await db.from("bookings")
    .select("id, email, customer_name")
    .eq("slot_id", slot_id)
    .eq("business_id", caller.business_id)
    .in("status", ["PAID", "CONFIRMED", "COMPLETED"]);

  if (!bookings?.length) return NextResponse.json({ error: "No customers on this slot" }, { status: 400 });

  const { data: photos } = await db.from("trip_photos")
    .select("photo_url, gdrive_view_url")
    .eq("slot_id", slot_id)
    .eq("business_id", caller.business_id);

  const photoUrls = (photos || []).map((p: any) => p.gdrive_view_url || p.photo_url).filter(Boolean);
  let photoUrl = photoUrls[0] || "";

  const { data: biz } = await db.from("businesses")
    .select("gdrive_photos_folder_url, google_drive_folder_id")
    .eq("id", caller.business_id)
    .maybeSingle();

  const folderUrl = biz?.gdrive_photos_folder_url ||
    (biz?.google_drive_folder_id ? "https://drive.google.com/drive/folders/" + biz.google_drive_folder_id : "");
  if (folderUrl) photoUrl = folderUrl;

  if (!photoUrl) return NextResponse.json({ error: "No photos uploaded for this slot" }, { status: 400 });

  const results: { booking_id: string; ok: boolean; error?: string }[] = [];
  for (const b of bookings) {
    if (!b.email) continue;
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
            photo_url: photoUrl,
          },
        }),
      });
      results.push({ booking_id: b.id, ok: r.ok });
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
    ok: true,
    recipient_count: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok),
  });
}
