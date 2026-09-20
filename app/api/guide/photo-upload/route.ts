import { NextRequest, NextResponse } from "next/server";
import { getCallerAdmin } from "@/app/lib/api-auth";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = 4_500_000;
const MAX_IMAGE_PIXELS = 40_000_000;

export const runtime = "nodejs";

type SafeImage = { extension: string; mime: string; declaredTypes: string[] };

const SAFE_IMAGES: Record<string, SafeImage> = {
  jpeg: { extension: "jpg", mime: "image/jpeg", declaredTypes: ["image/jpeg", "image/jpg"] },
  png: { extension: "png", mime: "image/png", declaredTypes: ["image/png"] },
  webp: { extension: "webp", mime: "image/webp", declaredTypes: ["image/webp"] },
  gif: { extension: "gif", mime: "image/gif", declaredTypes: ["image/gif"] },
  avif: { extension: "avif", mime: "image/avif", declaredTypes: ["image/avif"] },
};

function adminClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
}

async function inspectImage(bytes: Uint8Array, declaredType: string): Promise<SafeImage | null> {
  try {
    const options: sharp.SharpOptions = {
      failOn: "warning",
      limitInputPixels: MAX_IMAGE_PIXELS,
      sequentialRead: true,
    };
    const image = sharp(bytes, options);
    const metadata = await image.metadata();
    const format = metadata.format === "heif" && metadata.compression === "av1" ? "avif" : metadata.format;
    const safe = format ? SAFE_IMAGES[format] : null;
    if (!safe || !metadata.width || !metadata.height || (metadata.pages || 1) > 1) return null;
    const normalized = declaredType.trim().toLowerCase();
    if (normalized && normalized !== "application/octet-stream" && !safe.declaredTypes.includes(normalized)) return null;

    // metadata() only reads headers. stats() forces bounded pixel decoding, so
    // header-valid but truncated/corrupt images never reach Drive.
    await image.stats();
    return safe;
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
    error: "Upload outcome could not be confirmed. Check the gallery before retrying.",
    code: "UPLOAD_STATE_UNKNOWN",
    operation_id: operationId,
    retryable: false,
  }, { status: 503 });
}

async function readBoundedFormData(req: NextRequest): Promise<
  { form: FormData; response?: never } | { form?: never; response: Response }
> {
  const declaredLength = req.headers.get("content-length");
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (!Number.isFinite(parsedLength) || parsedLength < 0) {
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
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return { response: NextResponse.json({ error: "Upload request is too large" }, { status: 413 }) };
      }
      chunks.push(value);
    }
  } catch {
    return { response: NextResponse.json({ error: "Upload body could not be read" }, { status: 400 }) };
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

  const slotValues = parsed.form.getAll("slot_id");
  const fileValues = parsed.form.getAll("file");
  const slotId = slotValues.length === 1 ? String(slotValues[0] || "") : "";
  const file = fileValues.length === 1 ? fileValues[0] as File : null;
  if (!slotId || !file || typeof file.arrayBuffer !== "function") {
    return NextResponse.json({ error: "Exactly one slot_id and file are required" }, { status: 400 });
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
  const safeImage = await inspectImage(fileBuf, file.type || "");
  if (!safeImage) {
    return NextResponse.json({ error: "Unsupported or invalid image content" }, { status: 415 });
  }

  let tokenRes: Response;
  try {
    tokenRes = await fetch(supabaseUrl + "/functions/v1/google-drive", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + serviceKey,
      },
      body: JSON.stringify({ action: "token", business_id: caller.business_id }),
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

  const operationId = crypto.randomUUID();
  const fileName = slot.id.slice(0, 8) + "_" + operationId + "." + safeImage.extension;
  const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
  const boundary = "----GuidePWA" + crypto.randomUUID().replace(/-/g, "");
  const enc = new TextEncoder();
  const prefix = enc.encode([
    "--" + boundary + "\r\n",
    "Content-Type: application/json; charset=UTF-8\r\n\r\n",
    metadata + "\r\n",
    "--" + boundary + "\r\n",
    "Content-Type: " + safeImage.mime + "\r\n\r\n",
  ].join(""));
  const suffix = enc.encode("\r\n--" + boundary + "--");
  const body = new Uint8Array(prefix.length + fileBuf.length + suffix.length);
  body.set(prefix, 0);
  body.set(fileBuf, prefix.length);
  body.set(suffix, prefix.length + fileBuf.length);
  // Preserve the customer's original photo bytes after a complete decode.
  // The app never serves these bytes from its own origin: Drive receives the
  // detected image MIME plus a generated extension, and the UI embeds Drive's
  // thumbnail/view surfaces. Re-encoding here would discard original quality.

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
    return NextResponse.json({ error: "Google Drive rejected the upload", retryable: true }, { status: 502 });
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

  const viewUrl = "https://drive.google.com/file/d/" + driveFileId + "/view";
  const thumbnailUrl = "https://drive.google.com/thumbnail?id=" + driveFileId + "&sz=w400";

  let insertError: unknown = null;
  try {
    const result = await db.from("trip_photos").insert({
      business_id: caller.business_id,
      slot_id: slotId,
      photo_url: thumbnailUrl,
      gdrive_file_id: driveFileId,
      gdrive_view_url: viewUrl,
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
        .select("id")
        .eq("business_id", caller.business_id)
        .eq("slot_id", slotId)
        .eq("gdrive_file_id", driveFileId)
        .maybeSingle();
      existing = lookup.data;
      lookupError = lookup.error;
    } catch {
      lookupError = { code: "" };
    }

    if (existing && !lookupError) {
      return NextResponse.json({ ok: true, url: viewUrl, thumbnail: thumbnailUrl, recovered: true });
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
    return NextResponse.json({ error: "Photo record could not be saved", retryable: true }, { status: 500 });
  }

  return NextResponse.json({ ok: true, url: viewUrl, thumbnail: thumbnailUrl });
}
