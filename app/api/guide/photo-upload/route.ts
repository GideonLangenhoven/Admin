import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin } from "@/app/lib/api-auth";
import { createClient } from "@supabase/supabase-js";
import sharp, { type SharpOptions } from "sharp";
import { createHash } from "node:crypto";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = 4_500_000;
const MAX_IMAGE_PIXELS = 40_000_000;
const READ_TIMEOUT_MS = 15_000;
const PROVIDER_TIMEOUT_MS = 10_000;

export const runtime = "nodejs";

type SafeImage = { declaredTypes: string[] };

const SAFE_IMAGES: Record<string, SafeImage> = {
  jpeg: { declaredTypes: ["image/jpeg", "image/jpg"] },
  png: { declaredTypes: ["image/png"] },
  webp: { declaredTypes: ["image/webp"] },
  gif: { declaredTypes: ["image/gif"] },
  avif: { declaredTypes: ["image/avif"] },
};

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

async function decodeImage(bytes: Uint8Array, declaredType: string): Promise<Uint8Array | null> {
  try {
    const options: SharpOptions = {
      failOn: "warning",
      limitInputPixels: MAX_IMAGE_PIXELS,
      sequentialRead: true,
    };
    const image = sharp(bytes, options).timeout({ seconds: 10 });
    const metadata = await image.metadata();
    const format = metadata.format === "heif" && metadata.compression === "av1" ? "avif" : metadata.format;
    const safe = format ? SAFE_IMAGES[format] : null;
    if (!safe || !metadata.width || !metadata.height || (metadata.pages || 1) > 1) return null;
    const normalized = declaredType.trim().toLowerCase();
    if (normalized && normalized !== "application/octet-stream" && !safe.declaredTypes.includes(normalized)) return null;

    // Full decode and JPEG encoding reject truncated input and strip source metadata.
    const encoded = await sharp(bytes, options).rotate().flatten({ background: "#ffffff" })
      .jpeg({ quality: 85 }).timeout({ seconds: 10 }).toBuffer();
    return encoded.length <= MAX_PHOTO_BYTES ? encoded : null;
  } catch {
    return null;
  }
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value = await response.json();
    return value && typeof value === "object" ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" ? code : "";
}

function isDefiniteDatabaseRejection(error: unknown): boolean {
  const code = errorCode(error);
  // Only semantic input/auth/constraint failures prove the INSERT was rejected.
  // Connection, shutdown, and transport classes remain outcome-unknown.
  return /^(22|23|28|42)[0-9A-Z]{3}$/.test(code);
}

function logUploadError(code: string, fields: Record<string, string>) {
  console.error(JSON.stringify({ level: "error", code, ...fields }));
}

function unknownUploadResponse(operationId: string) {
  return NextResponse.json({
    error: "Upload outcome could not be confirmed. Check the gallery or ask an admin before uploading again.",
    code: "UPLOAD_STATE_UNKNOWN",
    operation_id: operationId,
    retryable: false,
  }, { status: 503 });
}

function newOperationResponse() {
  return NextResponse.json({
    error: "The previous upload ended without a gallery photo. Select the photo again to start a new upload.",
    retryable: true,
    new_operation_safe: true,
  }, { status: 409 });
}

type UploadRecord = {
  operation_id: string;
  business_id: string;
  slot_id: string;
  actor_admin_id: string;
  content_sha256: string;
  state: string;
  drive_file_id: string | null;
};

async function existingPhotoResponse(
  db: ReturnType<typeof adminClient>, prior: UploadRecord, requestedOperationId: string,
): Promise<Response | null> {
  if (prior.state === "rejected" || prior.state === "released") return newOperationResponse();
  if (!prior.drive_file_id) return unknownUploadResponse(prior.operation_id);

  let photo: { gdrive_file_id: string } | null;
  try {
    const result = await db.from("trip_photos").select("gdrive_file_id")
      .eq("id", prior.operation_id).eq("business_id", prior.business_id)
      .eq("slot_id", prior.slot_id).maybeSingle();
    if (result.error) return unknownUploadResponse(prior.operation_id);
    photo = result.data;
  } catch {
    return unknownUploadResponse(prior.operation_id);
  }
  if (photo?.gdrive_file_id === prior.drive_file_id) {
    return NextResponse.json({
      ok: true, url: viewUrl(prior.drive_file_id),
      thumbnail: thumbnailUrl(prior.drive_file_id), recovered: true,
    });
  }
  if (photo || prior.state !== "completed") return unknownUploadResponse(prior.operation_id);

  // Only a confirmed completed gallery photo that has since been removed may
  // release the content claim. Pending provider/DB outcomes remain blocked.
  try {
    const released = await db.from("guide_photo_uploads").update({ state: "released" })
      .eq("operation_id", prior.operation_id).eq("state", "completed")
      .select("operation_id").maybeSingle();
    if (released.error || !released.data) return unknownUploadResponse(prior.operation_id);
  } catch {
    return unknownUploadResponse(prior.operation_id);
  }
  return requestedOperationId === prior.operation_id ? newOperationResponse() : null;
}

async function recordedUploadResponse(
  db: ReturnType<typeof adminClient>, operationId: string, businessId: string,
  slotId: string, actorId: string, contentSha256: string,
): Promise<Response | null> {
  let prior: UploadRecord | null;
  try {
    const result = await db.from("guide_photo_uploads")
      .select("operation_id,business_id,slot_id,actor_admin_id,content_sha256,state,drive_file_id")
      .eq("operation_id", operationId).maybeSingle();
    if (result.error) return unknownUploadResponse(operationId);
    prior = result.data;
  } catch {
    return unknownUploadResponse(operationId);
  }
  if (!prior) return null;
  if (prior.business_id !== businessId || prior.slot_id !== slotId ||
      prior.actor_admin_id !== actorId || prior.content_sha256 !== contentSha256) {
    return NextResponse.json({ error: "Upload operation belongs to a different request", code: "UPLOAD_OPERATION_MISMATCH", retryable: false }, { status: 409 });
  }
  return existingPhotoResponse(db, prior, operationId);
}

async function matchingContentResponse(
  db: ReturnType<typeof adminClient>, operationId: string, businessId: string,
  slotId: string, actorId: string, contentSha256: string,
): Promise<Response | null> {
  try {
    const result = await db.from("guide_photo_uploads")
      .select("operation_id,business_id,slot_id,actor_admin_id,content_sha256,state,drive_file_id")
      .eq("business_id", businessId).eq("slot_id", slotId)
      .eq("actor_admin_id", actorId).eq("content_sha256", contentSha256)
      .in("state", ["uploading", "uploaded", "completed"]).maybeSingle();
    if (result.error) return unknownUploadResponse(operationId);
    return result.data ? existingPhotoResponse(db, result.data, operationId) : null;
  } catch {
    return unknownUploadResponse(operationId);
  }
}

async function readBoundedFormData(req: NextRequest): Promise<
  { form: FormData; response?: never } | { form?: never; response: Response }
> {
  const declaredLength = req.headers.get("content-length");
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (!/^\d+$/.test(declaredLength) || !Number.isSafeInteger(parsedLength)) {
      return { response: NextResponse.json({ error: "Invalid Content-Length" }, { status: 400 }) };
    }
    if (parsedLength > MAX_REQUEST_BYTES) {
      return { response: NextResponse.json({ error: "Upload request is too large" }, { status: 413 }) };
    }
  }

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    return { response: NextResponse.json({ error: "multipart/form-data required" }, { status: 400 }) };
  }
  if (!req.body) return { response: NextResponse.json({ error: "Upload body required" }, { status: 400 }) };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      void reader.cancel().catch(() => {});
      reject(new Error("read deadline"));
    }, READ_TIMEOUT_MS);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        void reader.cancel().catch(() => {});
        return { response: NextResponse.json({ error: "Upload request is too large" }, { status: 413 }) };
      }
      chunks.push(value);
    }
  } catch {
    return { response: NextResponse.json({ error: "Upload body could not be read in time" }, { status: 408 }) };
  } finally {
    clearTimeout(timeout);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const bounded = new Request(req.url, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: bytes,
    });
    return { form: await bounded.formData() };
  } catch {
    return { response: NextResponse.json({ error: "Invalid multipart upload" }, { status: 400 }) };
  }
}

export async function POST(req: NextRequest) {
  const caller = await getCallerAdmin(req);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = await readBoundedFormData(req);
  if (parsed.response) return parsed.response;

  if ([...parsed.form.keys()].some(key => !["slot_id", "file", "operation_id"].includes(key))) {
    return NextResponse.json({ error: "Unexpected upload field" }, { status: 400 });
  }
  const slotValues = parsed.form.getAll("slot_id");
  const fileValues = parsed.form.getAll("file");
  const operationValues = parsed.form.getAll("operation_id");
  const slotId = slotValues.length === 1 ? String(slotValues[0] || "") : "";
  const operationId = operationValues.length === 1 ? String(operationValues[0] || "") : "";
  const file = fileValues.length === 1 ? fileValues[0] : null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(slotId) || !uuid.test(operationId) || !(file instanceof File)) {
    return NextResponse.json({ error: "Exactly one valid slot_id, operation_id and file are required" }, { status: 400 });
  }
  if (file.size === 0) return NextResponse.json({ error: "Photo is empty" }, { status: 400 });
  if (file.size > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: "Photo is too large (maximum 4 MB)" }, { status: 413 });
  }

  const db = adminClient();
  const { data: slot } = await db.from("slots")
    .select("id, business_id")
    .eq("id", slotId)
    .maybeSingle();

  if (!slot || slot.business_id !== caller.business_id) {
    return NextResponse.json({ error: "Slot not found" }, { status: 403 });
  }

  const fileBuf = new Uint8Array(await file.arrayBuffer());
  if (fileBuf.byteLength !== file.size || fileBuf.byteLength > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: "Photo size could not be verified" }, { status: 400 });
  }
  const encoded = await decodeImage(fileBuf, file.type || "");
  if (!encoded) {
    return NextResponse.json({ error: "Unsupported or invalid image content" }, { status: 415 });
  }
  const contentSha256 = createHash("sha256").update(fileBuf).digest("hex");
  const recorded = await recordedUploadResponse(db, operationId, caller.business_id, slotId, caller.id, contentSha256);
  if (recorded) return recorded;
  const matching = await matchingContentResponse(db, operationId, caller.business_id, slotId, caller.id, contentSha256);
  if (matching) return matching;

  let tokenRes: Response;
  try {
    tokenRes = await fetch(supabaseUrl + "/functions/v1/google-drive", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + serviceKey,
      },
      body: JSON.stringify({ action: "token", business_id: caller.business_id }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch {
    return NextResponse.json({ error: "Google Drive connection could not be checked", retryable: true }, { status: 502 });
  }

  const tokenData = await readJson(tokenRes);
  const accessToken = typeof tokenData?.access_token === "string" ? tokenData.access_token : "";
  const folderId = typeof tokenData?.folder_id === "string" ? tokenData.folder_id : "";
  if (!tokenRes.ok || !accessToken || !folderId) {
    return NextResponse.json({
      error: "Google Drive not connected. Ask your admin to connect Google Drive in Settings.",
      retryable: true,
    }, { status: 400 });
  }

  let reservationError: unknown = null;
  try {
    const result = await db.from("guide_photo_uploads").insert({
      operation_id: operationId,
      business_id: caller.business_id,
      slot_id: slotId,
      actor_admin_id: caller.id,
      content_sha256: contentSha256,
      state: "uploading",
    });
    reservationError = result.error;
  } catch {
    reservationError = { code: "" };
  }
  if (reservationError) {
    if (errorCode(reservationError) !== "23505") return unknownUploadResponse(operationId);
    return await recordedUploadResponse(db, operationId, caller.business_id, slotId, caller.id, contentSha256)
      ?? await matchingContentResponse(db, operationId, caller.business_id, slotId, caller.id, contentSha256)
      ?? unknownUploadResponse(operationId);
  }

  const fileName = slot.id.slice(0, 8) + "_" + operationId + ".jpg";
  const metadata = JSON.stringify({ name: fileName, parents: [folderId], appProperties: { guide_photo_operation: operationId } });
  const boundary = "----GuidePWA" + crypto.randomUUID().replace(/-/g, "");
  const enc = new TextEncoder();
  const prefix = enc.encode([
    "--" + boundary + "\r\n",
    "Content-Type: application/json; charset=UTF-8\r\n\r\n",
    metadata + "\r\n",
    "--" + boundary + "\r\n",
    "Content-Type: image/jpeg\r\n\r\n",
  ].join(""));
  const suffix = enc.encode("\r\n--" + boundary + "--");
  const body = new Uint8Array(prefix.length + encoded.length + suffix.length);
  body.set(prefix, 0);
  body.set(encoded, prefix.length);
  body.set(suffix, prefix.length + encoded.length);

  let uploadRes: Response;
  try {
    uploadRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + accessToken,
          "Content-Type": "multipart/related; boundary=" + boundary,
        },
        body,
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      },
    );
  } catch {
    logUploadError("GUIDE_PHOTO_PROVIDER_OUTCOME_UNKNOWN", {
      business_id: caller.business_id,
      slot_id: slotId,
      operation_id: operationId,
      drive_file_name: fileName,
    });
    return unknownUploadResponse(operationId);
  }

  const driveFile = await readJson(uploadRes);
  const driveFileId = typeof driveFile?.id === "string" ? driveFile.id : "";
  if (!uploadRes.ok) {
    if (uploadRes.status >= 500 || [408, 425, 429].includes(uploadRes.status)) {
      logUploadError("GUIDE_PHOTO_PROVIDER_OUTCOME_UNKNOWN", {
        business_id: caller.business_id,
        slot_id: slotId,
        operation_id: operationId,
        drive_file_name: fileName,
        provider_status: String(uploadRes.status),
      });
      return unknownUploadResponse(operationId);
    }
    try {
      const marked = await db.from("guide_photo_uploads").update({ state: "rejected" })
        .eq("operation_id", operationId).eq("business_id", caller.business_id);
      if (marked.error) return unknownUploadResponse(operationId);
    } catch { return unknownUploadResponse(operationId); }
    return NextResponse.json({ error: "Google Drive rejected the upload", retryable: true, new_operation_safe: true }, { status: 502 });
  }
  if (!driveFileId) {
    logUploadError("GUIDE_PHOTO_PROVIDER_RESPONSE_UNKNOWN", {
      business_id: caller.business_id,
      slot_id: slotId,
      operation_id: operationId,
      drive_file_name: fileName,
      provider_status: String(uploadRes.status),
    });
    return unknownUploadResponse(operationId);
  }

  const view = viewUrl(driveFileId);
  const thumbnail = thumbnailUrl(driveFileId);

  try {
    const { error } = await db.from("guide_photo_uploads").update({ state: "uploaded", drive_file_id: driveFileId })
      .eq("operation_id", operationId).eq("business_id", caller.business_id);
    if (error) {
      logUploadError("GUIDE_PHOTO_LEDGER_UPDATE_UNKNOWN", { business_id: caller.business_id, operation_id: operationId, drive_file_id: driveFileId });
      return unknownUploadResponse(operationId);
    }
  } catch {
    logUploadError("GUIDE_PHOTO_LEDGER_UPDATE_UNKNOWN", { business_id: caller.business_id, operation_id: operationId, drive_file_id: driveFileId });
    return unknownUploadResponse(operationId);
  }

  let insertError: unknown = null;
  try {
    const result = await db.from("trip_photos").insert({
      id: operationId,
      business_id: caller.business_id,
      slot_id: slotId,
      photo_url: thumbnail,
      gdrive_file_id: driveFileId,
      gdrive_view_url: view,
      uploaded_by_admin_id: caller.id,
      uploaded_at: new Date().toISOString(),
    });
    insertError = result.error;
  } catch {
    insertError = { code: "" };
  }

  if (insertError) {
    let existing: unknown = null;
    let lookupError: unknown = null;
    try {
      const lookup = await db.from("trip_photos")
        .select("id,gdrive_file_id")
        .eq("business_id", caller.business_id)
        .eq("slot_id", slotId)
        .eq("id", operationId)
        .maybeSingle();
      existing = lookup.data;
      lookupError = lookup.error;
    } catch {
      lookupError = { code: "" };
    }

    if (existing && !lookupError && (existing as { gdrive_file_id?: string }).gdrive_file_id === driveFileId) {
      return NextResponse.json({ ok: true, url: view, thumbnail, recovered: true });
    }

    if (!isDefiniteDatabaseRejection(insertError) || lookupError) {
      logUploadError("GUIDE_PHOTO_PERSISTENCE_UNKNOWN", {
        business_id: caller.business_id,
        slot_id: slotId,
        operation_id: operationId,
        drive_file_id: driveFileId,
        insert_error_code: errorCode(insertError) || "transport",
        lookup_error_code: errorCode(lookupError) || (lookupError ? "transport" : "none"),
      });
      return unknownUploadResponse(operationId);
    }

    let cleanupOk = false;
    try {
      const cleanup = await fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(driveFileId), {
        method: "DELETE",
        headers: { Authorization: "Bearer " + accessToken },
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      cleanupOk = cleanup.ok;
    } catch {
      cleanupOk = false;
    }
    if (!cleanupOk) {
      logUploadError("GUIDE_PHOTO_COMPENSATION_FAILED", {
        business_id: caller.business_id,
        slot_id: slotId,
        operation_id: operationId,
        drive_file_id: driveFileId,
        insert_error_code: errorCode(insertError),
      });
      return NextResponse.json({
        error: "Photo record could not be saved and cleanup was not confirmed. Ask an admin before retrying.",
        code: "UPLOAD_CLEANUP_UNKNOWN",
        operation_id: operationId,
        retryable: false,
      }, { status: 503 });
    }
    try {
      const marked = await db.from("guide_photo_uploads").update({ state: "rejected" })
        .eq("operation_id", operationId).eq("business_id", caller.business_id);
      if (marked.error) return unknownUploadResponse(operationId);
    } catch { return unknownUploadResponse(operationId); }
    return NextResponse.json({ error: "Photo record could not be saved", retryable: true, new_operation_safe: true }, { status: 500 });
  }

  try {
    await db.from("guide_photo_uploads").update({ state: "completed" })
      .eq("operation_id", operationId).eq("business_id", caller.business_id);
  } catch { /* A retry checks the deterministic trip_photos ID. */ }
  return NextResponse.json({ ok: true, url: view, thumbnail });
}

function viewUrl(id: string) { return "https://drive.google.com/file/d/" + encodeURIComponent(id) + "/view"; }
function thumbnailUrl(id: string) { return "https://drive.google.com/thumbnail?id=" + encodeURIComponent(id) + "&sz=w400"; }
