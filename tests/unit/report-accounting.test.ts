import { describe, it, expect } from "vitest";
import { amountReceived, amountRefunded, netReceived, amountOutstanding, derivePaymentMethod, financialTotals } from "../../app/lib/report-accounting";

describe("amountReceived", () => {
  it("prefers total_captured when set", () => {
    expect(amountReceived({ status: "PAID", total_amount: 500, total_captured: 300 })).toBe(300);
  });
  it("falls back to total_amount for paid-class legacy rows with zero captured", () => {
    expect(amountReceived({ status: "COMPLETED", total_amount: 500, total_captured: 0 })).toBe(500);
    expect(amountReceived({ status: "PAID", total_amount: 500 })).toBe(500);
  });
  it("does not credit unpaid or cancelled bookings", () => {
    expect(amountReceived({ status: "CONFIRMED", total_amount: 500, total_captured: 0 })).toBe(0);
    expect(amountReceived({ status: "PENDING", total_amount: 500 })).toBe(0);
    expect(amountReceived({ status: "CANCELLED", total_amount: 500 })).toBe(0);
  });
  it("credits a cancelled booking that DID capture money (refund shows separately)", () => {
    expect(amountReceived({ status: "CANCELLED", total_amount: 500, total_captured: 500 })).toBe(500);
  });
});

describe("amountRefunded", () => {
  it("uses total_refunded when set", () => {
    expect(amountRefunded({ total_refunded: 250 })).toBe(250);
  });
  it("only counts refund_amount once processed", () => {
    expect(amountRefunded({ refund_amount: 250 })).toBe(0);
    expect(amountRefunded({ refund_amount: 250, refund_processed_at: "2026-07-01T00:00:00Z" })).toBe(250);
  });
});

describe("netReceived / amountOutstanding", () => {
  it("nets refunds off receipts", () => {
    expect(netReceived({ status: "CANCELLED", total_amount: 500, total_captured: 500, total_refunded: 400 })).toBe(100);
  });
  it("outstanding is due minus received for live bookings only", () => {
    expect(amountOutstanding({ status: "CONFIRMED", total_amount: 500, total_captured: 200 })).toBe(300);
    expect(amountOutstanding({ status: "CANCELLED", total_amount: 500 })).toBe(0);
    expect(amountOutstanding({ status: "EXPIRED", total_amount: 500 })).toBe(0);
    expect(amountOutstanding({ status: "PAID", total_amount: 500, total_captured: 500 })).toBe(0);
  });
});

describe("derivePaymentMethod", () => {
  it("labels OTA, card, PayFast, voucher and mixed payments", () => {
    expect(derivePaymentMethod({ ota_channel: "viator", status: "PAID", total_amount: 100 })).toBe("OTA (VIATOR)");
    expect(derivePaymentMethod({ yoco_payment_id: "p_1", status: "PAID", total_amount: 100 })).toBe("Yoco (card)");
    expect(derivePaymentMethod({ payfast_m_payment_id: "m_1", status: "PAID", total_amount: 100 })).toBe("PayFast");
    expect(derivePaymentMethod({ status: "PAID", total_amount: 100, total_captured: 100, voucher_amount_paid: 100 })).toBe("Voucher");
    expect(derivePaymentMethod({ status: "PAID", total_amount: 100, total_captured: 100, voucher_amount_paid: 40, yoco_payment_id: "p_2" })).toBe("Card + Voucher");
  });
  it("keeps explicit manual method labels", () => {
    expect(derivePaymentMethod({ status: "PAID", total_amount: 100, payment_method: "Admin (Manual)" })).toBe("Admin (Manual)");
  });
  it("flags received money with no reference as Unrecorded, and unpaid as empty", () => {
    expect(derivePaymentMethod({ status: "PAID", total_amount: 100 })).toBe("Unrecorded");
    expect(derivePaymentMethod({ status: "PENDING", total_amount: 100 })).toBe("");
  });
});

describe("financialTotals", () => {
  const rows = [
    // Paid card booking, discounted from 600 to 500
    { status: "PAID", total_amount: 500, original_total: 600, total_captured: 500, yoco_payment_id: "p_1" },
    // Confirmed, unpaid (outstanding 400)
    { status: "CONFIRMED", total_amount: 400, total_captured: 0 },
    // Cancelled after paying, refunded 300 of 500
    { status: "CANCELLED", total_amount: 500, total_captured: 500, total_refunded: 300, yoco_payment_id: "p_2" },
    // Expired hold: no money anywhere
    { status: "EXPIRED", total_amount: 250 },
    // Paid with no gateway ref at all
    { status: "PAID", total_amount: 200, total_captured: 200 },
  ];
  const t = financialTotals(rows);
  it("computes gross for live bookings only", () => {
    expect(t.grossBooked).toBe(500 + 400 + 200);
  });
  it("computes discounts, received, refunded, net, outstanding", () => {
    expect(t.discounts).toBe(100);
    expect(t.received).toBe(500 + 500 + 200);
    expect(t.refunded).toBe(300);
    expect(t.net).toBe(900);
    expect(t.outstanding).toBe(400);
  });
  it("counts received-money rows with no payment reference", () => {
    expect(t.missingGatewayRef).toBe(1);
  });
});
