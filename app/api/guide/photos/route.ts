import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCallerGuide } from "@/app/lib/guide-api-auth";

export async function GET(req: Request) {
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const caller = await getCallerGuide(req);
  if (!caller) return reply({ error: "Guide access required" }, 401);
  const params = new URL(req.url).searchParams, kind = params.get("kind"), slotId = params.get("slot_id");
  if (slotId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slotId)) return reply({ error: "Invalid trip" }, 400);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!, base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const db = createClient(base, key, { auth: { persistSession: false } });
  try {
    if (kind === "drive") {
      const response = await fetch(base + "/functions/v1/google-drive", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify({ action: "status", business_id: caller.business_id }), signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok || typeof data.connected !== "boolean") return reply({ error: "Google Drive status could not be checked" }, 503);
      return reply({ connected: data.connected, email: typeof data.email === "string" ? data.email : "" });
    }
    let selected;
    if (slotId) {
      const result = await db.from("slots").select("id, start_time, booked, tours(name)").eq("business_id", caller.business_id).eq("id", slotId).maybeSingle();
      if (result.error) return reply({ error: "Trip could not be loaded" }, 503);
      if (!result.data) return reply({ error: "Trip not found" }, 404);
      selected = result.data;
    }
    if (kind === "slots") {
      const { data, error } = await db.from("slots").select("id, start_time, booked, tours(name)").eq("business_id", caller.business_id)
        .gt("booked", 0).lt("start_time", new Date().toISOString()).gt("start_time", new Date(Date.now() - 7 * 86400000).toISOString()).order("start_time", { ascending: false });
      if (error) return reply({ error: "Trips could not be loaded" }, 503);
      return reply({ slots: selected && !data?.some(slot => slot.id === slotId) ? [selected, ...(data || [])] : data || [] });
    }
    if (kind === "history") {
      const history = await db.from("trip_photos").select("id, photo_url, gdrive_view_url, uploaded_at, slots(start_time, tours(name))").eq("business_id", caller.business_id).order("uploaded_at", { ascending: false }).limit(20);
      if (history.error) return reply({ error: "Photo history could not be loaded" }, 503);
      const selectedPhotos = slotId ? await db.from("trip_photos").select("photo_url, gdrive_view_url").eq("business_id", caller.business_id).eq("slot_id", slotId) : { data: [], error: null };
      if (selectedPhotos.error) return reply({ error: "Trip photos could not be loaded" }, 503);
      return reply({ photos: history.data || [], selected_photos: selectedPhotos.data || [] });
    }
    return reply({ error: "Unknown photo request" }, 400);
  } catch { return reply({ error: "Trip photos could not be loaded" }, 503); }
}
