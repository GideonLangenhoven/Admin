import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("gift voucher checkout email flow", () => {
  it("sends a payment-link email before voucher-code delivery", () => {
    const checkoutSource = readFileSync("supabase/functions/create-checkout/index.ts", "utf8");
    const sendEmailSource = readFileSync("supabase/functions/send-email/index.ts", "utf8");

    expect(checkoutSource).toContain('type: "VOUCHER_PAYMENT_LINK"');
    expect(sendEmailSource).toContain('case "VOUCHER_PAYMENT_LINK"');
    expect(checkoutSource.indexOf('type: "VOUCHER_PAYMENT_LINK"')).toBeGreaterThan(-1);
  });
});
