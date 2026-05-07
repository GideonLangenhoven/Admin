import { describe, expect, it } from "vitest";
import { buildAdminVoucherPurchase } from "../../app/vouchers/voucher-purchase";

describe("admin voucher purchase", () => {
  it("creates a pending, unpaid voucher payload for buyer payment", () => {
    const purchase = buildAdminVoucherPurchase({
      businessId: "biz_123",
      code: " gift1234 ",
      recipientName: "  Sam Recipient ",
      buyerName: "  Alex Buyer ",
      buyerEmail: " ALEX@example.COM ",
      tourName: "Sea Kayak",
      type: "GIFT",
      value: "750",
      expiresAt: "2026-08-01",
      giftMessage: " Enjoy it ",
    });

    expect(purchase.voucherPayload).toMatchObject({
      business_id: "biz_123",
      code: "GIFT1234",
      status: "PENDING",
      current_balance: 0,
      recipient_name: "Sam Recipient",
      buyer_name: "Alex Buyer",
      buyer_email: "alex@example.com",
      tour_name: "Sea Kayak",
      type: "GIFT",
      value: 750,
      purchase_amount: 750,
      gift_message: "Enjoy it",
    });
    expect(purchase.checkoutBody).toEqual({
      voucher_code: "GIFT1234",
      amount: 750,
      type: "GIFT_VOUCHER",
    });
  });
});
