import { describe, expect, it } from "vitest";
import {
  calculateChatBookingPricing,
  verifyChatBookingPricing,
} from "../../supabase/functions/_shared/chat-booking-pricing";

describe("chat booking pricing", () => {
  it("keeps a five-person R600 booking payable", () => {
    const pricing = calculateChatBookingPricing({
      qty: 5,
      unitPrice: 600,
      voucherDeduction: 0,
    });

    expect(pricing).toMatchObject({
      baseTotal: 3000,
      discount: 0,
      voucherDeduction: 0,
      total: 3000,
    });
  });

  it("does not turn missing tour pricing into a free booking", () => {
    const result = verifyChatBookingPricing({
      quotedTotal: 3000,
      qty: 5,
      unitPrice: 0,
      voucherDeduction: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("INVALID_PRICE");
  });

  it("only returns free when a valid voucher deduction covers the server total", () => {
    const result = verifyChatBookingPricing({
      quotedTotal: 0,
      qty: 5,
      unitPrice: 600,
      voucherDeduction: 3000,
    });

    expect(result.ok).toBe(true);
    expect(result.pricing?.total).toBe(0);
    expect(result.pricing?.voucherDeduction).toBe(3000);
  });
});
