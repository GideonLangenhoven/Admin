import sharp, { type OverlayOptions } from "sharp";
import { join } from "node:path";
import type { GiftVoucherFace } from "@/supabase/functions/_shared/gift-voucher-face";

const escapeText = (value: unknown) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Use the font already bundled with Next, so server images don't depend on system fonts.
const fontfile = join(process.cwd(), "node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf");
process.env.FONTCONFIG_FILE ||= join(process.cwd(), "app/lib/voucher-fonts.conf");

export async function renderGiftVoucherPng(gift: GiftVoucherFace, photo?: Uint8Array, operatorLogo?: Uint8Array) {
  const width = 1200, padding = 72, textWidth = width - padding * 2;
  const rows: Array<{ text: string; size: number; gap: number; bold?: boolean }> = [
    { text: "Gift voucher", size: 30, gap: 48 },
    ...(gift.experienceName ? [{ text: gift.experienceName, size: 52, gap: 12, bold: true }] : []),
    { text: "R" + gift.value, size: 80, gap: 24, bold: true },
    ...(gift.monetary ? [{ text: "Gift credit · Redeem on any experience", size: 26, gap: 12 }] : []),
    { text: "For " + (gift.recipientName || "someone special"), size: 36, gap: 48, bold: true },
    ...(gift.message ? [{ text: gift.message, size: 34, gap: 24 }] : []),
    ...(gift.buyerName ? [{ text: "From " + gift.buyerName, size: 30, gap: 24 }] : []),
    { text: "Voucher code", size: 26, gap: 48 },
    { text: gift.code || "Preview — not redeemable", size: 46, gap: 12, bold: true },
    ...(gift.expiresLabel ? [{ text: gift.expiresLabel, size: 26, gap: 20 }] : []),
  ];
  const renderText = (text: string, size: number, availableWidth: number, bold = false) => sharp({ text: {
    text: `<span foreground="white">${bold ? "<b>" + escapeText(text) + "</b>" : escapeText(text)}</span>`,
    font: "Geist " + size, fontfile, width: availableWidth, rgba: true,
    wrap: "word-char" as const, spacing: Math.round(size * 0.3),
  } }).png().toBuffer({ resolveWithObject: true });
  const layers: OverlayOptions[] = [];
  const logo = operatorLogo ? await sharp(operatorLogo, { limitInputPixels: 25_000_000 }).rotate()
    .resize(144, 96, { fit: "contain", background: "white" }).flatten({ background: "white" }).png().toBuffer() : undefined;
  const nameLeft = padding + (logo ? 168 : 0);
  const name = await renderText(gift.businessName || "A gift for you", 28, width - padding - nameLeft);
  const headerHeight = Math.max(logo ? 96 : 0, name.info.height);
  if (logo) layers.push({ input: logo, left: padding, top: padding + Math.floor((headerHeight - 96) / 2) });
  layers.push({ input: name.data, left: nameLeft, top: padding + Math.floor((headerHeight - name.info.height) / 2) });
  let y = padding + headerHeight;
  for (const row of rows) {
    const rendered = await renderText(row.text, row.size, textWidth, row.bold);
    y += row.gap;
    layers.push({ input: rendered.data, left: padding, top: y });
    y += rendered.info.height;
  }
  const credit = await renderText("Powered by BookingTours", 12, textWidth);
  const mark = await sharp(join(process.cwd(), "public/brand/bt-mark-ivory.png")).resize({ height: 22 }).png().toBuffer({ resolveWithObject: true });
  const footerHeight = Math.max(credit.info.height, mark.info.height);
  const height = Math.max(900, y + 48 + footerHeight + padding);
  const footerTop = height - padding - footerHeight;
  const markLeft = width - padding - mark.info.width;
  layers.push({ input: credit.data, left: markLeft - 8 - credit.info.width, top: footerTop + Math.floor((footerHeight - credit.info.height) / 2) });
  layers.push({ input: mark.data, left: markLeft, top: footerTop });
  const background = photo
    ? await sharp(photo, { limitInputPixels: 25_000_000 }).rotate().resize(width, height, { fit: "cover" }).png().toBuffer()
    : await sharp({ create: { width, height, channels: 4, background: "#12322e" } }).png().toBuffer();
  const shade = Buffer.from(`<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="#091e1b" fill-opacity="0.68"/></svg>`);
  return sharp(background).composite([{ input: shade, left: 0, top: 0 }, ...layers]).png().toBuffer();
}

export async function loadGiftVoucherPhoto(imageUrl: string, storageUrl: string) {
  const url = new URL(imageUrl);
  const storage = new URL(storageUrl);
  const allowed = url.origin === storage.origin && url.pathname.startsWith("/storage/v1/object/public/")
    || ["images.unsplash.com", "images.pexels.com"].includes(url.hostname);
  if (url.protocol !== "https:" || url.username || url.password || !allowed) throw new Error("Unsupported voucher image URL");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(8000) });
  if (!response.ok || !/^image\/(png|jpeg|webp|avif)(;|$)/i.test(response.headers.get("content-type") || "")) throw new Error("Voucher photograph unavailable");
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 5 * 1024 * 1024) { await reader.cancel(); throw new Error("Voucher photograph too large"); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
