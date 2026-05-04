import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin } from "@/app/lib/api-auth";
import { createClient } from "@supabase/supabase-js";

var url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
var key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: NextRequest) {
  var caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  var form = await req.formData();
  var slotId = String(form.get("slot_id") || "");
  var file = form.get("file") as File | null;
  if (!slotId || !file) return NextResponse.json({ error: "slot_id and file required" }, { status: 400 });

  var db = adminClient();

  var { data: slot } = await db.from("slots")
    .select("id, business_id")
    .eq("id", slotId)
    .maybeSingle();

  if (!slot || slot.business_id !== caller.business_id) {
    return NextResponse.json({ error: "Slot not found" }, { status: 403 });
  }

  var ext = file.name.split(".").pop() || "jpg";
  var storagePath = caller.business_id + "/" + slotId + "/" + crypto.randomUUID() + "." + ext;

  var buf = await file.arrayBuffer();
  var { error: uploadErr } = await db.storage
    .from("trip-photos")
    .upload(storagePath, buf, { contentType: file.type || "image/jpeg", upsert: false });

  if (uploadErr) {
    return NextResponse.json({ error: "Upload failed: " + uploadErr.message }, { status: 500 });
  }

  var { data: urlData } = db.storage.from("trip-photos").getPublicUrl(storagePath);
  var publicUrl = urlData?.publicUrl || "";

  var { error: insertErr } = await db.from("trip_photos").insert({
    business_id: caller.business_id,
    slot_id: slotId,
    photo_url: publicUrl,
    uploaded_by_admin_id: caller.id,
    uploaded_at: new Date().toISOString(),
  });

  if (insertErr) {
    return NextResponse.json({ error: "DB insert failed: " + insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, url: publicUrl });
}
