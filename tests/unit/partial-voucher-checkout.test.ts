import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// B1 — Partial gift-voucher checkout overcharges (G4, G8).
// The booking payload must carry voucher_amount_paid so create-checkout's
// server-side price check subtracts the voucher instead of overriding the
// charge back to the full price, and the webhook must deduct the voucher
// amount actually applied (not the promo-inflated original_total delta).
describe("partial gift-voucher checkout (B1)", () => {
  it("booking payload includes voucher_amount_paid for create-checkout", () => {
    const bookPage = readFileSync("booking/app/book/page.tsx", "utf8");
    expect(bookPage).toContain("voucher_amount_paid: effectiveVoucherCredit");
  });

  it("create-checkout subtracts voucher_amount_paid from the server total", () => {
    const checkout = readFileSync("supabase/functions/create-checkout/index.ts", "utf8");
    expect(checkout).toContain("Number(bk.voucher_amount_paid || 0)");
    expect(checkout).toContain("serverTotal - voucherApplied");
  });

  it("yoco-webhook deducts the voucher via voucher_amount_paid", () => {
    const webhook = readFileSync("supabase/functions/yoco-webhook/index.ts", "utf8");
    expect(webhook).toContain("booking.voucher_amount_paid");
  });
});
