// Voucher reissue on cancellation/refund. The rule (same one rebook-booking's
// cancel handlers implement): the voucher-funded portion of a booking is never
// paid out as cash and never silently lost — it comes back as a CREDIT
// voucher. bookings.converted_to_voucher_id is the idempotency marker: every
// flow that turns a booking's value into a voucher stamps it, so no booking
// can ever be reissued twice.
// ponytail: rebook-booking and wa-webhook still carry their own local copies
// of genVoucherCode/insertVoucherWithRetry — fold them onto this module the
// next time either file is open for surgery.

export function genVoucherCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

// Insert a voucher with retry on unique constraint violation (code collision)
export async function insertVoucherWithRetry(supabase: any, payload: any, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) payload.code = genVoucherCode();
    const { data, error } = await supabase.from("vouchers").insert(payload).select().single();
    if (!error) return { data, error: null };
    if (error.code === "23505" && attempt < maxRetries - 1) continue;
    return { data: null, error };
  }
  return { data: null, error: { message: "Failed to generate unique voucher code after " + maxRetries + " attempts" } };
}

// ───── Split a booking's paid value into cash + voucher portions ─────
// Convention: total_amount = cash due after voucher; voucher_amount_paid = the
// voucher-funded portion; value = sum of both. One legacy write-path stored
// total_amount voucher-inclusive — when cash + voucher exceeds the pre-voucher
// original_total, derive the true cash portion from original_total instead.
export function getPaidPortions(
  booking: { total_amount?: number | string | null; voucher_amount_paid?: number | string | null; original_total?: number | string | null },
): { cashPaid: number; voucherPaid: number; paidValue: number } {
  const voucherPaid = Number(booking.voucher_amount_paid || 0);
  let cashPaid = Number(booking.total_amount || 0);
  const originalTotal = Number(booking.original_total || 0);
  if (originalTotal > 0 && cashPaid + voucherPaid > originalTotal) {
    cashPaid = Math.max(0, originalTotal - voucherPaid);
  }
  return { cashPaid, voucherPaid, paidValue: cashPaid + voucherPaid };
}

/**
 * Reissue a booking's voucher-funded portion (voucher_amount_paid) as a fresh
 * CREDIT voucher, once. Returns { code, amount } when a voucher was created,
 * or null when there is nothing to reissue (no voucher portion, or a voucher
 * was already issued for this booking by any flow — converted_to_voucher_id).
 */
export async function reissueVoucherPortion(
  supabase: any,
  booking: { id: string; business_id: string; voucher_amount_paid?: number | null; converted_to_voucher_id?: string | null },
): Promise<{ code: string; amount: number } | null> {
  const amount = Number(booking.voucher_amount_paid || 0);
  if (amount <= 0 || booking.converted_to_voucher_id) return null;

  const vr = await insertVoucherWithRetry(supabase, {
    business_id: booking.business_id,
    code: genVoucherCode(),
    status: "ACTIVE",
    type: "CREDIT",
    value: amount,
    current_balance: amount,
    source_booking_id: booking.id,
    expires_at: new Date(Date.now() + 3 * 365 * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (vr.error || !vr.data) {
    console.error("VOUCHER_REISSUE_ERR booking=" + booking.id + ": " + (vr.error?.message || "no row"));
    return null;
  }

  // Stamp only if still unstamped — a concurrent flow that beat us wins, and
  // this voucher is voided so the customer can't end up with two.
  const { data: stamped } = await supabase
    .from("bookings")
    .update({ converted_to_voucher_id: vr.data.id })
    .eq("id", booking.id)
    .is("converted_to_voucher_id", null)
    .select("id");
  if (!stamped || stamped.length === 0) {
    await supabase.from("vouchers").update({ status: "VOID" }).eq("id", vr.data.id);
    return null;
  }
  return { code: vr.data.code as string, amount };
}
