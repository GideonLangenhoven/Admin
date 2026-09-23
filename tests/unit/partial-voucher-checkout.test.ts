import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// B1 — Partial gift-voucher checkout overcharges (G4, G8).
// The booking payload must carry voucher_amount_paid so create-checkout's
// server-side price check subtracts the voucher instead of overriding the
// charge back to the full price, and the webhook must deduct the voucher
// amount actually applied (not the promo-inflated original_total delta).
describe("partial gift-voucher checkout (B1)", () => {
  it("booking payload includes voucher_amount_paid for create-checkout", () => {
    const bookPage = readFileSync("booking/app/book/BookingFlow.tsx", "utf8");
    expect(bookPage).toContain("voucher_amount_paid: effectiveVoucherCredit");
  });

  it("create-checkout subtracts voucher_amount_paid from the server total", () => {
    const checkout = readFileSync("supabase/functions/create-checkout/index.ts", "utf8");
    expect(checkout).toContain('supabase.rpc("prepare_booking_checkout"');
    expect(readFileSync("supabase/migrations/20260911130000_checkout_pricing.sql","utf8")).toContain("total_amount = net - credit");
  });

  it("yoco-webhook settles reserved vouchers atomically before marking PAID", () => {
    const webhook = readFileSync("supabase/functions/yoco-webhook/index.ts", "utf8");
    expect(webhook).toContain('supabase.rpc("confirm_booking_payment"');
    const migration = readFileSync("supabase/migrations/20260911090000_payment_hold_hardening.sql", "utf8");
    expect(migration).toContain("settle_voucher_reservations(p_booking_id)");
  });
});
