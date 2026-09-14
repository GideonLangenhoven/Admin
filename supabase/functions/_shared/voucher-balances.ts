// A voucher can fund several bookings. Its current balance and last-redemption
// pointer cannot tell us how much this particular booking consumed.
export async function bookingVoucherBalances(supabase: any, bookingId: string, businessId: string) {
  const { data, error } = await supabase.from("voucher_reservations")
    .select("amount, vouchers(code, value, current_balance, business_id)")
    .eq("booking_id", bookingId).eq("business_id", businessId).eq("status", "settled");
  if (error) throw error;
  return (data || []).flatMap((row: any) => {
    const voucher = Array.isArray(row.vouchers) ? row.vouchers[0] : row.vouchers;
    return voucher?.business_id === businessId && Number(voucher.current_balance) > 0
      ? [{ ...voucher, amount_used: Number(row.amount) }]
      : [];
  });
}
