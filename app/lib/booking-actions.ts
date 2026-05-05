import { supabase } from "./supabase";

const SU = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SK = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export type ActionResult = { ok: boolean; error?: string; data?: any };

export async function cancelBookingAction(bookingId: string, opts: { reason?: string; weather?: boolean } = {}): Promise<ActionResult> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return { ok: false, error: "Session expired" };

    if (opts.weather) {
      const wRes = await supabase.functions.invoke("weather-cancel", {
        body: { booking_ids: [bookingId], reason: opts.reason || "weather conditions" },
      });
      if (wRes.error) return { ok: false, error: wRes.error.message };
      return { ok: true, data: wRes.data };
    }

    const res = await fetch(SU + "/functions/v1/cancel-booking", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
      body: JSON.stringify({ booking_id: bookingId, reason: opts.reason || "Cancelled by admin" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) return { ok: false, error: data?.error || res.statusText };
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Network error" };
  }
}

export async function refundBookingAction(bookingId: string): Promise<ActionResult> {
  try {
    const { data: booking } = await supabase.from("bookings").select("total_amount, yoco_checkout_id").eq("id", bookingId).single();
    if (!booking) return { ok: false, error: "Booking not found" };

    const amount = Number(booking.total_amount || 0);
    if (amount <= 0) return { ok: false, error: "Nothing to refund" };

    if (booking.yoco_checkout_id) {
      const res = await fetch(SU + "/functions/v1/process-refund", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + SK },
        body: JSON.stringify({ booking_id: bookingId, amount }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) return { ok: false, error: data?.error || res.statusText };
      return { ok: true, data };
    }

    const { error } = await supabase.from("bookings").update({
      status: "CANCELLED",
      refund_status: "PROCESSED",
      refund_amount: amount,
      refund_notes: "Full manual refund via bulk action — R" + amount.toFixed(2),
      cancellation_reason: "Auto-cancelled — refund processed by admin (bulk)",
      cancelled_at: new Date().toISOString(),
    }).eq("id", bookingId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Network error" };
  }
}

export async function markPaidAction(bookingId: string): Promise<ActionResult> {
  try {
    const res = await supabase.functions.invoke("manual-mark-paid", {
      body: { action: "mark_paid", booking_id: bookingId },
    });
    if (res.error) return { ok: false, error: res.error.message };
    if (res.data?.error) return { ok: false, error: res.data.error };
    return { ok: true, data: res.data };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Network error" };
  }
}

export async function checkInAction(bookingId: string): Promise<ActionResult> {
  try {
    const { error } = await supabase.from("bookings").update({ status: "CONFIRMED" }).eq("id", bookingId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Network error" };
  }
}
