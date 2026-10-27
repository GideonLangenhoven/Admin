import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCallerGuide } from "@/app/lib/guide-api-auth";
import { issuePhotoFolder, verifyPhotoFolder } from "@/app/lib/photo-folder-token";

export async function POST(req: Request) {
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const caller = await getCallerGuide(req);
  if (!caller) return reply({ error: "Guide access required" }, 401);
  let body;
  try { body = await req.json(); } catch { return reply({ error: "Invalid request" }, 400); }
  if (!body || typeof body.slot_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.slot_id)) return reply({ error: "Choose a trip" }, 400);
  if (!["folder", "start", "complete"].includes(body.action)) return reply({ error: "Unknown upload action" }, 400);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!, base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const db = createClient(base, key, { auth: { persistSession: false } });
  try {
    const { data: slot, error } = await db.from("slots").select("id, start_time, tours(name), businesses(timezone)").eq("business_id", caller.business_id).eq("id", body.slot_id).maybeSingle();
    if (error) return reply({ error: "Trip could not be checked" }, 503);
    if (!slot) return reply({ error: "Trip not found" }, 404);
    async function drive(action: string, input: Record<string, unknown> = {}) {
      const response = await fetch(base + "/functions/v1/google-drive", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify({ action, business_id: caller!.business_id, ...input }), signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error("Google Drive is unavailable. Ask your operator to check the connection in Settings.");
      return data;
    }
    if (body.action === "folder") {
      const date = new Date(slot.start_time).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone: (slot.businesses as any)?.timezone || "Africa/Johannesburg" });
      const folder = await drive("create_folder", { folder_name: date + " - " + ((slot.tours as any)?.name || "Trip") });
      if (typeof folder.folder_id !== "string" || !/^[\w-]+$/.test(folder.folder_id)) throw new Error("Google Drive could not create a photo folder.");
      return reply({ folder_url: "https://drive.google.com/drive/folders/" + folder.folder_id, folder_token: issuePhotoFolder({ business_id: caller.business_id, slot_id: body.slot_id, folder_id: folder.folder_id }, key) });
    }
    const grant = verifyPhotoFolder(body.folder_token, caller.business_id, body.slot_id, key);
    if (!grant) return reply({ error: "Upload session expired. Start the upload again." }, 403);
    if (body.action === "start") {
      if (typeof body.file_name !== "string" || !body.file_name.trim() || body.file_name.length > 255 || typeof body.content_type !== "string" || !/^(image|video)\/[a-z0-9.+-]+$/i.test(body.content_type) || !Number.isSafeInteger(body.size) || body.size < 1) return reply({ error: "Choose a photo or video" }, 400);
      const token = await drive("token");
      if (!token.access_token) throw new Error("Google Drive is not connected.");
      const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id", {
        // Google needs the browser's origin at session creation to expose the final upload response.
        method: "POST", redirect: "error", headers: { Authorization: "Bearer " + token.access_token, Origin: new URL(req.url).origin, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": body.content_type, "X-Upload-Content-Length": String(body.size) },
        body: JSON.stringify({ name: body.file_name, parents: [grant.folder_id] }), signal: AbortSignal.timeout(15000),
      });
      const uploadUrl = response.headers.get("Location") || "";
      if (!response.ok || !uploadUrl || new URL(uploadUrl).origin !== "https://www.googleapis.com" || !new URL(uploadUrl).pathname.startsWith("/upload/drive/")) throw new Error("Google Drive could not start the upload.");
      // A single-file upload capability, never the operator's Google access token.
      return reply({ upload_url: uploadUrl });
    }
    const folderUrl = "https://drive.google.com/drive/folders/" + grant.folder_id;
    const existing = await db.from("trip_photos").select("id").eq("business_id", caller.business_id).eq("slot_id", body.slot_id).eq("photo_url", folderUrl).limit(1);
    if (existing.error) throw new Error("Uploaded photo links could not be checked.");
    if (!existing.data?.length) {
      const saved = await db.from("trip_photos").insert({ business_id: caller.business_id, slot_id: body.slot_id, photo_url: folderUrl, uploaded_by_guide_id: caller.id });
      if (saved.error) throw new Error("Files uploaded; link not saved. Choose Send photos to save and share it.");
    }
    return reply({ ok: true });
  } catch (error) { return reply({ error: error instanceof Error ? error.message : "Upload failed" }, 503); }
}
