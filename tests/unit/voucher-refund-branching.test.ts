import { describe, expect, it } from "vitest";
import { sourceFunction } from "../helpers/source-handler";
import { getPaidPortions } from "../../supabase/functions/_shared/vouchers";

// A voucher+cash booking cancelled via the web was refunded the FULL ticket
// value as cash (voucher portion included, voucher never restored) because the
// split-tender branch keyed off payment_method values ("SPLIT" etc.) that no
// code ever writes. The branch helpers must detect voucher funding from
// voucher_amount_paid, which IS reliably written.
const extractFn = (name: string) => sourceFunction("supabase/functions/rebook-booking/index.ts", name, { getPaidPortions });

const isVoucherPayment = extractFn("isVoucherPayment");
const isSplitTenderPayment = extractFn("isSplitTenderPayment");
const getSplitTenderAmounts = extractFn("getSplitTenderAmounts");

describe("cancel-refund branch detection uses voucher_amount_paid, not payment_method", () => {
  // Legacy inclusive total, identified by original_total. New rows store cash
  // AFTER vouchers and are covered in payment-accounting-runtime.test.ts.
  const jerry = { total_amount: 800, original_total: 800, voucher_amount_paid: 500, payment_method: null, total_captured: 800 };

  it("mixed voucher+cash booking routes to the split-tender branch", () => {
    expect(isSplitTenderPayment(jerry)).toBe(true);
    expect(isVoucherPayment(jerry)).toBe(false);
  });

  it("split amounts: voucher restored in full, only the cash portion is cash-refundable", () => {
    expect(getSplitTenderAmounts(jerry)).toEqual({ voucherPortion: 500, cashPortion: 300 });
  });

  it("fully voucher-funded booking routes to the voucher branch (no cash out)", () => {
    expect(isVoucherPayment({ total_amount: 0, voucher_amount_paid: 500 })).toBe(true);
    expect(isSplitTenderPayment({ total_amount: 0, voucher_amount_paid: 500 })).toBe(false);
    // confirm_voucher_booking RPC only stamps yoco_payment_id, never payment_method
    expect(isVoucherPayment({ total_amount: 500, voucher_amount_paid: 0, yoco_payment_id: "VOUCHER_WEB" })).toBe(true);
  });

  it("pure cash booking still takes the plain Yoco refund branch", () => {
    const cash = { total_amount: 800, voucher_amount_paid: 0, payment_method: "Yoco" };
    expect(isVoucherPayment(cash)).toBe(false);
    expect(isSplitTenderPayment(cash)).toBe(false);
  });
});
