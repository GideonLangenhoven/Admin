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

  const form = await req.formData();
  const slotId = String(form.get("slot_id") || "");
  const file = form.get("file") as File | null;
  if (!slotId || !file) return NextResponse.json({ error: "slot_id and file required" }, { status: 400 });

  const db = adminClient();

  const { data: slot } = await db.from("slots")
    .select("id, business_id")
    .eq("id", slotId)
    .maybeSingle();

  if (!slot || slot.business_id !== caller.business_id) {
    return NextResponse.json({ error: "Slot not found" }, { status: 403 });
  }

  const tokenRes = await fetch(supabaseUrl + "/functions/v1/google-drive", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + serviceKey,
    },
    body: JSON.stringify({ action: "token", business_id: caller.business_id }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    return NextResponse.json({
      error: "Google Drive not connected. Ask your admin to connect Google Drive in Settings.",
    }, { status: 400 });
  }

  const { access_token, folder_id } = tokenData;

  const ext = file.name.split(".").pop() || "jpg";
  const fileName = slotId.slice(0, 8) + "_" + crypto.randomUUID().slice(0, 8) + "." + ext;
  const buf = await file.arrayBuffer();
  const metadata = JSON.stringify({ name: fileName, parents: [folder_id] });
  const boundary = "----GuidePWA" + crypto.randomUUID().replace(/-/g, "");

  const parts = [
    "--" + boundary + "\r\n",
    "Content-Type: application/json; charset=UTF-8\r\n\r\n",
    metadata + "\r\n",
    "--" + boundary + "\r\n",
    "Content-Type: " + (file.type || "image/jpeg") + "\r\n\r\n",
  ];

  const enc = new TextEncoder();
  const prefix = enc.encode(parts.join(""));
  const suffix = enc.encode("\r\n--" + boundary + "--");
  const fileBuf = new Uint8Array(buf);
  const body = new Uint8Array(prefix.length + fileBuf.length + suffix.length);
  body.set(prefix, 0);
  body.set(fileBuf, prefix.length);
  body.set(suffix, prefix.length + fileBuf.length);

  const uploadRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + access_token,
        "Content-Type": "multipart/related; boundary=" + boundary,
      },
      body: body,
    },
  );

  const driveFile = await uploadRes.json();
  if (!uploadRes.ok || !driveFile.id) {
    return NextResponse.json({
      error: "Google Drive upload failed: " + (driveFile.error?.message || "unknown"),
    }, { status: 500 });
  }

  const viewUrl = "https://drive.google.com/file/d/" + driveFile.id + "/view";
  const thumbnailUrl = "https://drive.google.com/thumbnail?id=" + driveFile.id + "&sz=w400";

  const { error: insertErr } = await db.from("trip_photos").insert({
    business_id: caller.business_id,
    slot_id: slotId,
    photo_url: thumbnailUrl,
    gdrive_file_id: driveFile.id,
    gdrive_view_url: viewUrl,
    uploaded_by_admin_id: caller.id,
    uploaded_at: new Date().toISOString(),
  });

  if (insertErr) {
    return NextResponse.json({ error: "DB insert failed: " + insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, url: viewUrl, thumbnail: thumbnailUrl });
}
