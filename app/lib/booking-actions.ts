import { supabase } from "./supabase";

const SU = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

export type ActionResult = { ok: boolean; error?: string; data?: any };

export async function cancelBookingAction(bookingId: string, opts: { reason?: string; weather?: boolean } = {}): Promise<ActionResult> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return { ok: false, error: "Session expired" };

    const res = await fetch(SU + "/functions/v1/cancel-booking", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
      body: JSON.stringify({ booking_id: bookingId, reason: (opts.weather ? "Weather cancellation: " : "") + (opts.reason || "Cancelled by admin"), allow_late_choice: opts.weather === true }),
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
    const response = await supabase.functions.invoke("process-refund", { body: { booking_id: bookingId } });
    if (response.error || !response.data?.ok) return { ok: false, error: response.data?.error || response.error?.message || "Refund request failed" };
    return { ok: true, data: response.data };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Network error" };
  }
}

export async function markPaidAction(bookingId: string): Promise<ActionResult> {
  try {
    const res = await supabase.functions.invoke("manual-mark-paid", {
      body: { action: "mark_paid", booking_id: bookingId, payment_method: "EFT" },
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
    const { data, error } = await supabase.from("bookings").update({ checked_in: true, checked_in_at: new Date().toISOString() })
      .eq("id", bookingId).in("status", ["PAID", "CONFIRMED"]).eq("waiver_status", "SIGNED").select("id").maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "Check-in requires a confirmed booking and signed waiver" };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Network error" };
  }
}
