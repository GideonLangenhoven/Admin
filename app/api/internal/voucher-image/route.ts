import { timingSafeEqual } from "node:crypto";
import { renderGiftVoucherPng, loadGiftVoucherPhoto } from "@/app/lib/gift-voucher-image";
import type { GiftVoucherFace } from "@/supabase/functions/_shared/gift-voucher-face";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const expected = Buffer.from(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  const supplied = Buffer.from((req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""));
  if (!expected.length || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const raw = await req.text();
  if (raw.length > 16000) return Response.json({ error: "Voucher data too large" }, { status: 413 });
  let gift: GiftVoucherFace;
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    for (const key of ["businessName", "experienceName", "recipientName", "buyerName", "message", "code", "expiresLabel", "imageUrl", "logoUrl"]) {
      if (data[key] != null && (typeof data[key] !== "string" || data[key].length > (key === "message" ? 4000 : 2000))) throw new Error();
    }
    if (!["string", "number"].includes(typeof data.value) || String(data.value).length > 100 || (data.monetary != null && typeof data.monetary !== "boolean")) throw new Error();
    gift = data;
  } catch { return Response.json({ error: "Invalid voucher data" }, { status: 400 }); }
  try {
    const [photo, logo] = await Promise.all([
      gift.imageUrl ? loadGiftVoucherPhoto(gift.imageUrl, process.env.NEXT_PUBLIC_SUPABASE_URL!) : undefined,
      gift.logoUrl ? loadGiftVoucherPhoto(gift.logoUrl, process.env.NEXT_PUBLIC_SUPABASE_URL!) : undefined,
    ]);
    const png = await renderGiftVoucherPng(gift, photo, logo);
    return new Response(new Uint8Array(png), { headers: {
      "Content-Type": "image/png", "Content-Disposition": 'attachment; filename="gift-voucher.png"',
      "Cache-Control": "private, no-store",
    } });
  } catch (error) {
    console.error("VOUCHER_IMAGE_ERR", error instanceof Error ? error.message : "Image generation failed");
    return Response.json({ error: "Voucher image could not be generated" }, { status: 503 });
  }
}
