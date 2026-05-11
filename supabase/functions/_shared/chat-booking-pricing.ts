export type ChatBookingPricingInput = {
  qty: number;
  unitPrice: number;
  voucherDeduction?: number;
  groupDiscountMinQty?: number;
  groupDiscountPercent?: number;
};

export type ChatBookingPricing = {
  unitPrice: number;
  baseTotal: number;
  discount: number;
  voucherDeduction: number;
  total: number;
};

export type ChatBookingPricingVerification =
  | { ok: true; pricing: ChatBookingPricing; reason?: undefined }
  | { ok: false; reason: "INVALID_QTY" | "INVALID_PRICE" | "PRICE_CHANGED"; pricing?: ChatBookingPricing };

function money(value: number) {
  return Math.round(value * 100) / 100;
}

export function calculateChatBookingPricing(input: ChatBookingPricingInput): ChatBookingPricing {
  const qty = Number(input.qty);
  const unitPrice = Number(input.unitPrice);

  if (!Number.isFinite(qty) || qty < 1) {
    throw new Error("INVALID_QTY");
  }

  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    throw new Error("INVALID_PRICE");
  }

  const groupMin = Number(input.groupDiscountMinQty ?? 6);
  const groupPercent = Number(input.groupDiscountPercent ?? 5);
  const baseTotal = money(qty * unitPrice);
  const discount = qty >= groupMin && groupPercent > 0
    ? money(baseTotal * (groupPercent / 100))
    : 0;
  const subtotal = money(baseTotal - discount);
  const requestedVoucherDeduction = Math.max(0, Number(input.voucherDeduction || 0));
  const voucherDeduction = money(Math.min(requestedVoucherDeduction, subtotal));

  return {
    unitPrice,
    baseTotal,
    discount,
    voucherDeduction,
    total: money(Math.max(0, subtotal - voucherDeduction)),
  };
}

export function verifyChatBookingPricing(
  input: ChatBookingPricingInput & { quotedTotal: number; tolerance?: number },
): ChatBookingPricingVerification {
  let pricing: ChatBookingPricing;

  try {
    pricing = calculateChatBookingPricing(input);
  } catch (error) {
    const reason = error instanceof Error && error.message === "INVALID_QTY"
      ? "INVALID_QTY"
      : "INVALID_PRICE";
    return { ok: false, reason };
  }

  const quotedTotal = Number(input.quotedTotal);
  const tolerance = Number(input.tolerance ?? 1);
  if (!Number.isFinite(quotedTotal) || Math.abs(pricing.total - quotedTotal) > tolerance) {
    return { ok: false, reason: "PRICE_CHANGED", pricing };
  }

  return { ok: true, pricing };
}
