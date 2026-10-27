import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { giftImageUrl, renderGiftVoucherFace } from "../../supabase/functions/_shared/gift-voucher-face";
import { buildAdminVoucherPurchase } from "../../app/vouchers/voucher-purchase";

describe("gift voucher photograph", () => {
  it("keeps all gift details and the multiline personal message on the photograph", () => {
    const html = renderGiftVoucherFace({ imageUrl: "https://example.com/kayak.jpg", businessName: "Ocean Adventures", experienceName: "Sunset paddle", recipientName: "Alex", buyerName: "Sam", message: "Happy birthday!\nSee you on the water.", value: 750, code: "GIFT2345", expiresLabel: "Valid until 18 October 2029", monetary: true });
    for (const detail of ["kayak.jpg", "Ocean Adventures", "Sunset paddle", "Alex", "Sam", "Happy birthday!\nSee you on the water.", "R750", "GIFT2345", "18 October 2029", "Redeem on any experience"]) expect(html).toContain(detail);
    expect(html).toContain("white-space:pre-wrap");
    expect(html).toContain("overflow-wrap:anywhere");
  });

  it("escapes every customer-controlled field and confines image URLs to the background", () => {
    const attack = '<img src=x onerror="alert(1)">&';
    const html = renderGiftVoucherFace({ businessName: attack, experienceName: attack, recipientName: attack, buyerName: attack, message: attack, value: attack, code: attack, expiresLabel: attack, imageUrl: "https://example.com/a');color:red;('x.jpg?x=1&y=2" });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain("&lt;img");
    expect(html).toContain("%27%29");
    expect(html).not.toContain("background-image:url('https://example.com/a');");
    expect(html).toContain("&amp;y=2");
  });

  it.each(["javascript:alert(1)", "data:image/svg+xml,<svg/>", "file:///private/image.jpg", "//example.com/a.jpg", "https://user:pass@example.com/a.jpg", "not a URL"])("rejects unsafe artwork %s", value => {
    expect(giftImageUrl(value)).toBe("");
    expect(renderGiftVoucherFace({ imageUrl: value, value: 500 })).not.toContain("background-image:");
  });

  it("keeps preview and image-free cards readable without inventing a redeemable code", () => {
    const html = renderGiftVoucherFace({ value: 500 });
    expect(html).toContain('bgcolor="#12322e"');
    expect(html).toContain("Preview · Code issued after payment");
    expect(html).not.toContain('background="');
  });

  it("ships identical renderers in the standalone guest and edge deployments", () => {
    expect(readFileSync("booking/lib/gift-voucher-face.ts", "utf8")).toBe(readFileSync("supabase/functions/_shared/gift-voucher-face.ts", "utf8"));
  });

  it("places the operator logo beside the name and BookingTours branding at the bottom right", () => {
    const html = renderGiftVoucherFace({ value: 500, businessName: "Kayak", logoUrl: "https://example.com/logo.png?x=1&y=2" });
    expect(html).toContain('src="https://example.com/logo.png?x=1&amp;y=2"');
    expect(html.indexOf('logo.png')).toBeLessThan(html.indexOf('>Kayak</p>'));
    expect(html).toContain('align="right"');
    expect(html).toContain('Powered by BookingTours');
    expect(html).toContain('/brand/bt-mark-ivory.png');
    expect(html.indexOf('Powered by BookingTours')).toBeGreaterThan(html.indexOf('Preview · Code issued after payment'));
    expect(renderGiftVoucherFace({ value: 500, logoUrl: 'javascript:alert(1)' })).not.toContain('javascript:');
  });

  it("keeps a design selection separate from the purchased voucher's redemption type", () => {
    const { voucherPayload } = buildAdminVoucherPurchase({ businessId: "operator", code: "GIFT1234", recipientName: "Alex", buyerName: "Sam", buyerEmail: "sam@example.com", tourName: "", type: "CREDIT", value: "750", expiresAt: "", giftMessage: "Enjoy!", giftTourId: "experience" });
    expect(voucherPayload).toMatchObject({ gift_tour_id: "experience", type: "CREDIT", tour_name: null, gift_message: "Enjoy!", status: "PENDING", current_balance: 0 });
    expect(voucherPayload).not.toHaveProperty("gift_image_url");
  });
});
