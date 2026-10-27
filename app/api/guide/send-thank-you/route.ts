import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin } from "@/app/lib/api-auth";
import { getCallerGuide } from "@/app/lib/guide-api-auth";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  const caller = await getCallerAdmin(req) || await getCallerGuide(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const slot_id = body?.slot_id;
  if (typeof slot_id !== "string" || !slot_id) return NextResponse.json({ error: "slot_id required" }, { status: 400 });
  if (body.photo_urls !== undefined && (!Array.isArray(body.photo_urls) || !body.photo_urls.length || body.photo_urls.length > 100 || body.photo_urls.some((url: unknown) => {
    if (typeof url !== "string" || url.length > 4096) return true;
    try { return !["https:", "http:"].includes(new URL(url.trim()).protocol); } catch { return true; }
  }))) return NextResponse.json({ error: "Add valid photo links" }, { status: 400 });

  const db = adminClient();

  const { data: slot } = await db.from("slots")
    .select("id, business_id, tours(name)")
    .eq("id", slot_id)
    .eq("business_id", caller.business_id)
    .maybeSingle();

  if (!slot || (slot as any).business_id !== caller.business_id) {
    return NextResponse.json({ error: "Slot not found" }, { status: 403 });
  }

  const tourName = (slot as any).tours?.name || "your adventure";

  const { data: bookings, error: bookingError } = await db.from("bookings")
    .select("id, email, phone, customer_name")
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
  const existingUrls = (photos || []).map((p: any) => p.gdrive_view_url || p.photo_url).filter(Boolean);
  const photoUrls: string[] = [...new Set<string>(body.photo_urls ? body.photo_urls.map((url: string) => url.trim()) : existingUrls)];
  if (!photoUrls.length) return NextResponse.json({ error: "No photos uploaded for this slot" }, { status: 400 });
  const missing = photoUrls.filter(url => !existingUrls.includes(url));
  if (missing.length) {
    const saved = await db.from("trip_photos").insert(missing.map(photo_url => ({ business_id: caller.business_id, slot_id, photo_url, ...(caller.role === "GUIDE" ? { uploaded_by_guide_id: caller.id } : { uploaded_by_admin_id: caller.id }) })));
    if (saved.error) return NextResponse.json({ error: "Could not save the photo links. No notifications were sent." }, { status: 500 });
  }

  const results: { booking_id: string; ok: boolean; error?: string }[] = [];
  const failures: string[] = [];
  for (const b of bookings) {
    const name = b.customer_name || "Guest";
    let delivered = false;
    const errors: string[] = [];
    async function sendMessage(endpoint: string, payload: unknown, channel: string) {
      try {
        const r = await fetch(supabaseUrl + "/functions/v1/" + endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + serviceKey },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
        });
        const outcome = await r.json();
        if (!r.ok || outcome.ok !== true) throw new Error(outcome.error || "Message was not sent");
        return true;
      } catch (error) {
        failures.push(name + " (" + channel + ")");
        errors.push(error instanceof Error ? error.message : "Message was not sent");
        return false;
      }
    }
    if (b.phone) {
      const message = "Hi " + (b.customer_name?.split(" ")[0] || "there") + "! 📸 Your trip photos from the " + tourName + " are ready!\n\n" + photoUrls.join("\n") + "\n\nShare with your group and enjoy the memories!";
      delivered = await sendMessage("send-whatsapp-text", { business_id: caller.business_id, booking_id: b.id, to: b.phone, message }, "WhatsApp");
    }
    if (b.email) {
      const emailed = await sendMessage("send-email", {
          type: "TRIP_PHOTOS",
          data: {
            business_id: caller.business_id,
            email: b.email,
            customer_name: name,
            tour_name: tourName,
            photo_url: photoUrls[0],
            photo_urls: photoUrls,
          },
      }, "email");
      delivered = delivered || emailed;
    }
    if (!b.phone && !b.email) { failures.push(name + " (no contact details)"); errors.push("No contact details"); }
    results.push({ booking_id: b.id, ok: delivered, ...(errors.length ? { error: errors.join("; ") } : {}) });
  }

  await db.from("audit_logs").insert({
    actor_id: caller.role === "GUIDE" ? null : caller.id,
    business_id: caller.business_id,
    action_type: "TRIP_PHOTOS_SENT",
    target_entity: "slots",
    target_id: slot_id,
    after_state: { recipient_count: results.filter(r => r.ok).length, photo_count: photoUrls.length, source: caller.role === "GUIDE" ? "simple-guide" : "photos", ...(caller.role === "GUIDE" ? { actor_guide_id: caller.id } : {}) },
  });

  return NextResponse.json({
    ok: failures.length === 0,
    sent: results.filter(r => r.ok).length,
    failures,
    recipient_count: results.filter(r => r.ok).length,
    failed: results.filter(r => r.error),
  });
}
