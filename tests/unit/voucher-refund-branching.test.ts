import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A voucher+cash booking cancelled via the web was refunded the FULL ticket
// value as cash (voucher portion included, voucher never restored) because the
// split-tender branch keyed off payment_method values ("SPLIT" etc.) that no
// code ever writes. The branch helpers must detect voucher funding from
// voucher_amount_paid, which IS reliably written.
const rebook = readFileSync("supabase/functions/rebook-booking/index.ts", "utf8");

// Extract a top-level function from the edge-function source and make it
// runnable (strip the few TS annotations these helpers use).
function extractFn(name: string) {
  const m = rebook.match(new RegExp(`function ${name}\\(booking: any\\)[^\\n]*\\{[\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`function ${name} not found in rebook-booking`);
  // Replace the typed signature line with a plain-JS one; bodies are annotation-free.
  const js = m[0].replace(/^function \w+\([^\n]*\{/, `function ${name}(booking) {`);
  return new Function(`return (${js})`)() as (b: any) => any;
}

const isVoucherPayment = extractFn("isVoucherPayment");
const isSplitTenderPayment = extractFn("isSplitTenderPayment");
const getSplitTenderAmounts = extractFn("getSplitTenderAmounts");

describe("cancel-refund branch detection uses voucher_amount_paid, not payment_method", () => {
  const jerry = { total_amount: 800, voucher_amount_paid: 500, payment_method: null, total_captured: 800 };

  it("mixed voucher+cash booking routes to the split-tender branch", () => {
    expect(isSplitTenderPayment(jerry)).toBe(true);
    expect(isVoucherPayment(jerry)).toBe(false);
  });

  it("split amounts: voucher restored in full, only the cash portion is cash-refundable", () => {
    // cash_amount_paid is never written; must derive cash = total - voucher
    expect(getSplitTenderAmounts(jerry)).toEqual({ voucherPortion: 500, cashPortion: 300 });
  });

  it("fully voucher-funded booking routes to the voucher branch (no cash out)", () => {
    expect(isVoucherPayment({ total_amount: 500, voucher_amount_paid: 500 })).toBe(true);
    expect(isSplitTenderPayment({ total_amount: 500, voucher_amount_paid: 500 })).toBe(false);
    // confirm_voucher_booking RPC only stamps yoco_payment_id, never payment_method
    expect(isVoucherPayment({ total_amount: 500, voucher_amount_paid: 0, yoco_payment_id: "VOUCHER_WEB" })).toBe(true);
  });

  it("pure cash booking still takes the plain Yoco refund branch", () => {
    const cash = { total_amount: 800, voucher_amount_paid: 0, payment_method: "Yoco" };
    expect(isVoucherPayment(cash)).toBe(false);
    expect(isSplitTenderPayment(cash)).toBe(false);
  });
});

describe("cash-refund ceilings exclude the voucher-funded portion", () => {
  it("yoco-webhook records total_captured as cash actually charged (total - voucher)", () => {
    const yoco = readFileSync("supabase/functions/yoco-webhook/index.ts", "utf8");
    expect(yoco).toContain("total_amount || 0) - Number(booking.voucher_amount_paid || 0)");
    expect(yoco).not.toContain("total_captured: booking.total_amount");
  });

  it("process-refund caps cash payouts below the voucher-funded portion", () => {
    const pr = readFileSync("supabase/functions/process-refund/index.ts", "utf8");
    expect(pr).toContain("maxCashRefund");
    expect(pr).toContain("totalAmount - voucherPaid");
  });
});
