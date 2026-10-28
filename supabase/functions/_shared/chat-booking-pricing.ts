export type ChatBookingPricingInput = {
  qty: number;
  unitPrice: number;
  voucherDeduction?: number;
  groupDiscountMinQty?: number;
  groupDiscountPercent?: number;
  // A promo code replaces the automatic discount, as prepare_booking_checkout prices it.
  promo?: ChatPromo | null;
};

export type ChatPromo = { code: string; discountType: string; discountValue: number };

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

// "R800" for whole rands, "R1852.50" with cents (never "R1852.5").
export function rands(value: number | string) {
  const n = Number(value);
  return "R" + (Number.isInteger(n) ? String(n) : n.toFixed(2));
}

export function calculateChatBookingPricing(input: ChatBookingPricingInput): ChatBookingPricing {
  const qty = Number(input.qty);
  const unitPrice = Number(input.unitPrice);

  if (!Number.isSafeInteger(qty) || qty < 1) {
    throw new Error("INVALID_QTY");
  }

  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    throw new Error("INVALID_PRICE");
  }

  const groupMin = Number(input.groupDiscountMinQty ?? 6);
  const groupPercent = Number(input.groupDiscountPercent ?? 5);
  const baseTotal = money(qty * unitPrice);
  const promo = input.promo;
  const discount = promo
    ? money(Math.min(baseTotal, promo.discountType === "PERCENT" ? baseTotal * promo.discountValue / 100 : promo.discountValue))
    : qty >= groupMin && groupPercent > 0
    ? money(baseTotal * (groupPercent / 100))
    : 0;
  const subtotal = money(baseTotal - discount);
  const voucherValue = Number(input.voucherDeduction ?? 0);
  if (!Number.isFinite(voucherValue)) throw new Error("INVALID_PRICE");
  const requestedVoucherDeduction = Math.max(0, voucherValue);
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

// The storefront's own check (validate_promo_code). Checkout re-prices the code on the server.
export async function checkChatPromo(db: any, businessId: string, code: string, orderAmount: number, email?: string | null): Promise<{ promo?: ChatPromo; error?: string }> {
  const { data, error } = await db.rpc("validate_promo_code", {
    p_business_id: businessId, p_code: code, p_order_amount: orderAmount, p_customer_email: email || null,
  });
  if (error || !data) return { error: "I couldn't check that code just now. Please try again in a minute." };
  if (!data.valid) return { error: String(data.error || "Invalid promo code") };
  return { promo: { code: String(data.code), discountType: String(data.discount_type), discountValue: Number(data.discount_value) } };
}
