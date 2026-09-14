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
    expect(fn).toContain('supabase.rpc("apply_booking_change"');
  });

  it("REMOVE_GUESTS decrements the booking's voucher portion", () => {
    expect(readFileSync("supabase/migrations/20260911180000_immediate_booking_changes.sql", "utf8")).toContain("voucher_amount_paid = credit - voucher_share");
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
    expect(readFileSync("supabase/migrations/20260911180000_immediate_booking_changes.sql", "utf8")).toContain("total_amount = p_new_total - (credit - voucher_share)");
  });

  it("yoco-webhook reschedule delegates paid portions to the atomic settlement", () => {
    expect(yoco).toContain('supabase.rpc("confirm_booking_uplift"');
    expect(yoco).toContain("p_pending_reschedule_id: pr.id");
  });

  it("yoco-webhook add-guests settles the hold and actual capture together", () => {
    expect(yoco).toContain("p_hold_id: agHoldId, p_pending_reschedule_id: null, p_new_qty: agNewQty");
    expect(yoco).toContain("p_captured_cents: capturedCents");
  });

  it("WA guest removal routes through rebook-booking", () => {
    expect(wa).toContain('"/functions/v1/rebook-booking"');
    expect(wa).not.toContain("guests_removed_voucher_wa\", { booking_id: sd.booking_id, old_qty: sd.qty, new_qty: sd.new_qty, voucher: gvCode");
  });
});
