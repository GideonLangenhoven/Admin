import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { renderGiftVoucherPng, loadGiftVoucherPhoto } from "../../app/lib/gift-voucher-image";
import { sourceHandler } from "../helpers/source-handler";

const gift = { businessName: "Kayak", experienceName: "Morning Kayak", recipientName: "Alex", buyerName: "Sam", message: "Happy birthday!\nHere’s to another adventure together.", value: 950, code: "PREVIEW123", monetary: true, expiresLabel: "Valid until 18 October 2029" };
afterEach(() => vi.unstubAllGlobals());

describe("standalone voucher image", () => {
  it("renders a real PNG and grows to keep long messages and voucher details", async () => {
    const photo = readFileSync("public/demo/claires-hiking/assets/kayak-sunset.webp");
    const logo = await sharp({ create: { width: 160, height: 100, channels: 3, background: "#ff0000" } }).png().toBuffer();
    const png = await renderGiftVoucherPng(gift, photo, logo);
    const longer = await renderGiftVoucherPng({ ...gift, message: "A very long message <b>is literal</b> & safe.\n".repeat(30) }, photo, logo);
    const shortSize = await sharp(png).metadata(), longSize = await sharp(longer).metadata();
    expect(shortSize).toMatchObject({ format: "png", width: 1200 });
    expect(longSize.height).toBeGreaterThan(shortSize.height!);
    const logoPixel = await sharp(png).extract({ left: 100, top: 100, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    expect([...logoPixel]).toEqual([255, 0, 0]);
    mkdirSync(".vercel/voucher-email-20261018", { recursive: true });
    writeFileSync(".vercel/voucher-email-20261018/voucher-preview.png", png);
    writeFileSync(".vercel/voucher-email-20261018/voucher-long-preview.png", longer);
    const noPhoto = await renderGiftVoucherPng(gift);
    expect((await sharp(noPhoto).metadata()).format).toBe("png");
  });

  it.each(["http://127.0.0.1/test", "https://169.254.169.254/metadata", "https://other.invalid/image.png", "https://fixture.supabase.co/rest/v1/bookings", "https://user:pass@images.unsplash.com/a.jpg"])("blocks unsafe photo fetches: %s", async url => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(loadGiftVoucherPhoto(url, "https://fixture.supabase.co")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("loads a public stored photo without following redirects", async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([1,2,3]), { headers: { "content-type": "image/webp" } }));
    vi.stubGlobal("fetch", fetch);
    expect(await loadGiftVoucherPhoto("https://fixture.supabase.co/storage/v1/object/public/email-images/photo.webp", "https://fixture.supabase.co")).toEqual(Buffer.from([1,2,3]));
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "error" });
  });

  it("requires service authentication and rejects invalid image requests before rendering", async () => {
    const render = vi.fn();
    const handler = sourceHandler("app/api/internal/voucher-image/route.ts", {
      "node:crypto": { timingSafeEqual: (a: Buffer,b: Buffer) => a.equals(b) },
      "@/app/lib/gift-voucher-image": { renderGiftVoucherPng: render, loadGiftVoucherPhoto: vi.fn() },
    }, { SUPABASE_SERVICE_ROLE_KEY: "fixture-secret" });
    const call = (body: unknown, token = "") => handler(new Request("https://fixture.invalid/api/internal/voucher-image", { method: "POST", headers: { authorization: "Bearer " + token }, body: JSON.stringify(body) }));
    expect((await call(gift)).status).toBe(401);
    expect((await call({ value: {}, message: "test" }, "fixture-secret")).status).toBe(400);
    expect((await call({ ...gift, message: "a".repeat(4001) }, "fixture-secret")).status).toBe(400);
    expect((await call({ ...gift, logoUrl: {} }, "fixture-secret")).status).toBe(400);
    expect(render).not.toHaveBeenCalled();
  });

  it("loads the operator logo separately and embeds it in the PNG response", async () => {
    const photo = new Uint8Array([1]), logo = new Uint8Array([2]);
    const load = vi.fn(async (url: string) => url.endsWith('logo.png') ? logo : photo);
    const render = vi.fn(async () => new Uint8Array([137,80,78,71]));
    const handler = sourceHandler("app/api/internal/voucher-image/route.ts", {
      "node:crypto": { timingSafeEqual: (a: Buffer,b: Buffer) => a.equals(b) },
      "@/app/lib/gift-voucher-image": { renderGiftVoucherPng: render, loadGiftVoucherPhoto: load },
    }, { SUPABASE_SERVICE_ROLE_KEY: "fixture-secret", NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co" });
    const body = { ...gift, imageUrl: "https://fixture.supabase.co/photo.png", logoUrl: "https://fixture.supabase.co/logo.png" };
    const response = await handler(new Request("https://fixture.invalid/api/internal/voucher-image", { method: "POST", headers: { authorization: "Bearer fixture-secret" }, body: JSON.stringify(body) }));
    expect(response.status).toBe(200);
    expect(render).toHaveBeenCalledWith(body, photo, logo);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
