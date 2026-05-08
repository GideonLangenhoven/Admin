export interface AdminVoucherPurchaseInput {
  businessId: string;
  code: string;
  recipientName: string;
  buyerName: string;
  buyerEmail: string;
  tourName: string;
  type: string;
  value: string;
  expiresAt: string;
  giftMessage: string;
}

export function buildAdminVoucherPurchase(input: AdminVoucherPurchaseInput) {
  const value = Number(input.value || 0);
  const expiresAt = new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString();
  const code = input.code.trim().toUpperCase();

  return {
    voucherPayload: {
      business_id: input.businessId,
      code,
      status: "PENDING",
      type: input.type,
      recipient_name: input.recipientName.trim() || null,
      buyer_name: input.buyerName.trim() || null,
      buyer_email: input.buyerEmail.trim().toLowerCase() || null,
      tour_name: input.tourName.trim() || null,
      value,
      purchase_amount: value,
      current_balance: 0,
      expires_at: expiresAt,
      gift_message: input.giftMessage.trim() || null,
    },
    checkoutBody: {
      voucher_code: code,
      amount: value,
      type: "GIFT_VOUCHER",
    },
  };
}
