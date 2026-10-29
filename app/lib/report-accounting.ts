// Pure money-derivation helpers for the Reports page. The bookings table is
// the money truth: total_amount is what was DUE, total_captured what was
// RECEIVED, total_refunded / refund_amount what went BACK. Reports previously
// summed total_amount of paid-ish statuses, which overstates cash for
// partially-paid or refunded bookings and understates nothing visibly, so it
// slipped past. Everything here is a pure function so accounting semantics
// are unit-tested once and shared by tiles, tables, CSV and PDF.

export type MoneyBooking = {
  status?: string | null;
  total_amount?: number | null;
  original_total?: number | null;
  total_captured?: number | null;
  total_refunded?: number | null;
  refund_amount?: number | null;
  refund_processed_at?: string | null;
  refund_status?: string | null;
  voucher_amount_paid?: number | null;
  voucher_code?: string | null;
  payment_method?: string | null;
  yoco_payment_id?: string | null;
  payfast_m_payment_id?: string | null;
  ota_channel?: string | null;
  allow_unpaid?: boolean | null;
};

const PAID_STATUSES = new Set(["PAID", "COMPLETED"]);

/** Cash + voucher value actually received for a booking. */
export function amountReceived(b: MoneyBooking): number {
  const captured = Number(b.total_captured || 0);
  if (captured > 0) return captured;
  // Legacy rows predate total_captured backfill: a PAID/COMPLETED booking with
  // zero captured still received its total (same derivation send-email uses).
  if (PAID_STATUSES.has(String(b.status || ""))) return Number(b.total_amount || 0);
  return 0;
}

/**
 * Money reserved for a refund that has not reached the customer yet:
 * reserve_refund_request adds a refund to total_refunded before the card
 * refund or bank transfer goes out.
 */
export function refundInFlight(b: MoneyBooking): number {
  // ponytail: an earlier completed refund on the same booking also reads as
  // pending until this one lands (none live 2026-10-29); split by
  // refund_operations server-side if that starts to happen.
  return ["REFUND_PENDING", "MANUAL_EFT_REQUIRED"].includes(String(b.refund_status || "")) ? Number(b.total_refunded || 0) : 0;
}

/** Money returned to the customer. */
export function amountRefunded(b: MoneyBooking): number {
  const refunded = Number(b.total_refunded || 0);
  if (refunded > 0) return refunded - refundInFlight(b);
  // refund_amount alone is a REQUESTED figure; only count it once processed.
  if (b.refund_processed_at) return Number(b.refund_amount || 0);
  return 0;
}

/** Received minus refunded. */
export function netReceived(b: MoneyBooking): number {
  return amountReceived(b) - amountRefunded(b);
}

/** Amount still owed on a booking that is expected to pay. */
export function amountOutstanding(b: MoneyBooking): number {
  const status = String(b.status || "");
  if (["CANCELLED", "EXPIRED"].includes(status)) return 0;
  const due = Number(b.total_amount || 0);
  return Math.max(0, due - amountReceived(b));
}

export type InvoiceStatus = "PAID" | "PARTIALLY PAID" | "UNPAID" | "CANCELLED" | "REFUNDED" | "PARTIALLY REFUNDED" | "REFUND PENDING";

/**
 * An invoice's real state, from its booking. The invoice row itself keeps the
 * payment method it was issued with ("Pending"), even after a cancellation.
 */
export function invoiceState(b: MoneyBooking): { status: InvoiceStatus; paid: number; refunded: number; due: number } {
  const paid = amountReceived(b);
  const refunded = amountRefunded(b);
  const due = amountOutstanding(b);
  const status: InvoiceStatus = refundInFlight(b) > 0 ? "REFUND PENDING"
    : refunded > 0 ? (refunded >= paid ? "REFUNDED" : "PARTIALLY REFUNDED")
    : ["CANCELLED", "EXPIRED"].includes(String(b.status || "")) ? "CANCELLED"
    : due <= 0 ? "PAID"
    : paid > 0 ? "PARTIALLY PAID" : "UNPAID";
  return { status, paid, refunded, due };
}

/**
 * Human payment-method label derived from gateway/voucher/OTA fields.
 * bookings.payment_method is only set on a few manual paths, so the gateway
 * references are the reliable signal.
 */
export function derivePaymentMethod(b: MoneyBooking): string {
  const voucherPart = Number(b.voucher_amount_paid || 0);
  const received = amountReceived(b);
  const explicit = String(b.payment_method || "").trim();

  if (b.ota_channel) return "OTA (" + String(b.ota_channel).toUpperCase() + ")";
  if (voucherPart > 0 && received > voucherPart) return "Card + Voucher";
  if (voucherPart > 0 || (b.voucher_code && received > 0 && !b.yoco_payment_id && !b.payfast_m_payment_id)) return "Voucher";
  if (b.yoco_payment_id) return "Yoco (card)";
  if (b.payfast_m_payment_id) return "PayFast";
  if (explicit) return explicit;
  if (received > 0) return "Unrecorded";
  return "";
}

export type FinancialTotals = {
  grossBooked: number;
  cancelled: number;
  discounts: number;
  received: number;
  refunded: number;
  net: number;
  outstanding: number;
  voucherApplied: number;
  missingGatewayRef: number;
};

/** Aggregates for tiles / footers / CSV summary rows. */
export function financialTotals(rows: MoneyBooking[]): FinancialTotals {
  const t: FinancialTotals = { grossBooked: 0, cancelled: 0, discounts: 0, received: 0, refunded: 0, net: 0, outstanding: 0, voucherApplied: 0, missingGatewayRef: 0 };
  for (const b of rows) {
    const status = String(b.status || "");
    // Gross is every booking in the period (the Total Due column's sum):
    // Received keeps money taken on bookings later cancelled, so a gross of
    // live bookings only could fall below it.
    t.grossBooked += Number(b.total_amount || 0);
    if (["CANCELLED", "EXPIRED"].includes(status)) {
      t.cancelled += Number(b.total_amount || 0);
    } else {
      t.discounts += Math.max(0, Number(b.original_total || b.total_amount || 0) - Number(b.total_amount || 0));
    }
    const received = amountReceived(b);
    t.received += received;
    t.refunded += amountRefunded(b);
    t.outstanding += amountOutstanding(b);
    t.voucherApplied += Number(b.voucher_amount_paid || 0);
    // Audit flag: money received with no traceable gateway/method reference.
    if (received > 0 && derivePaymentMethod(b) === "Unrecorded") t.missingGatewayRef++;
  }
  t.net = t.received - t.refunded;
  return t;
}
