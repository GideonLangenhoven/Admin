import { createHmac, timingSafeEqual } from "node:crypto";

type FolderGrant = { business_id: string; slot_id: string; folder_id: string; expires_at: number };
const signature = (payload: string, secret: string) => createHmac("sha256", secret).update("trip-photo-folder:" + payload).digest();

export function issuePhotoFolder(grant: Omit<FolderGrant, "expires_at">, secret: string, now = Date.now()): string {
  if (!secret) throw new Error("Photo uploads are not configured");
  const payload = Buffer.from(JSON.stringify({ ...grant, expires_at: now + 60 * 60 * 1000 })).toString("base64url");
  return payload + "." + signature(payload, secret).toString("base64url");
}

export function verifyPhotoFolder(token: unknown, businessId: string, slotId: string, secret: string, now = Date.now()): FolderGrant | null {
  if (!secret || typeof token !== "string" || token.length > 2048) return null;
  try {
    const [payload, proof, extra] = token.split(".");
    if (!payload || !proof || extra !== undefined) return null;
    const received = Buffer.from(proof, "base64url"), expected = signature(payload, secret);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
    const grant = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return grant.business_id === businessId && grant.slot_id === slotId && /^[\w-]+$/.test(grant.folder_id)
      && typeof grant.expires_at === "number" && grant.expires_at > now && grant.expires_at <= now + 60 * 60 * 1000 ? grant : null;
  } catch { return null; }
}
