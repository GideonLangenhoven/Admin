import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Bashka/AA07DF86 regression — reducing guests on a voucher-paid booking must
// credit the voucher-funded excess back, and admin screens must not show
// voucher-paid bookings as R0.00.
describe("voucher-aware guest reduction", () => {
  const fn = readFileSync("supabase/functions/rebook-booking/index.ts", "utf8");
  const page = readFileSync("app/bookings/page.tsx", "utf8");

  it("REMOVE_GUESTS prices the excess from cash + voucher portions", () => {
    expect(fn).toContain("const { cashPaid, voucherPaid, paidValue } = getPaidPortions(booking)");
    expect(fn).toContain("const voucherShare = Math.min(excessAmount, voucherPaid)");
  });

  it("REMOVE_GUESTS decrements the booking's voucher portion", () => {
    expect(fn).toContain("voucher_amount_paid: voucherPaid - voucherShare");
  });

  it("bookings page money columns include the voucher-funded portion", () => {
    expect(page).toContain("function bookingValue(");
    expect(page).toContain("total_amount, voucher_amount_paid");
  });

  it("edit modal blocks qty changes on paid bookings", () => {
    expect(page).toContain("Guest count locked on paid bookings");
  });
});

describe("voucher-aware reschedule and WA flows", () => {
  const fn = readFileSync("supabase/functions/rebook-booking/index.ts", "utf8");
  const yoco = readFileSync("supabase/functions/yoco-webhook/index.ts", "utf8");
  const wa = readFileSync("supabase/functions/wa-webhook/index.ts", "utf8");
  const shared = readFileSync("supabase/functions/_shared/vouchers.ts", "utf8");

  it("paid-portions helper lives in _shared and is imported by both consumers", () => {
    expect(shared).toContain("export function getPaidPortions(");
    expect(fn).toContain('import { getPaidPortions } from "../_shared/vouchers.ts"');
    expect(wa).toContain('import { getPaidPortions } from "../_shared/vouchers.ts"');
  });

  it("reschedule credit counts cash + voucher portions", () => {
    expect(fn).toContain("const credit = isCreditClaim && !claimEligible ? 0 : portions.cashPaid + liveVoucherPaid");
  });

  it("reschedule swap keeps total_amount as the cash portion", () => {
    expect(fn).toContain("total_amount: Math.max(0, newTotalAmount - newVoucherPaid)");
  });

  it("yoco-webhook reschedule apply preserves the voucher portion", () => {
    expect(yoco).toContain("Number(pr.new_total_amount || 0) - rVoucherPaid");
  });

  it("yoco-webhook add-guests apply adds the uplift instead of recomputing qty * unit", () => {
    expect(yoco).toContain("Number(agBk.total_amount || 0) + agDelta * agUnitPrice");
  });

  it("WA guest removal routes through rebook-booking", () => {
    expect(wa).toContain('"/functions/v1/rebook-booking"');
    expect(wa).not.toContain("guests_removed_voucher_wa\", { booking_id: sd.booking_id, old_qty: sd.qty, new_qty: sd.new_qty, voucher: gvCode");
  });
});
