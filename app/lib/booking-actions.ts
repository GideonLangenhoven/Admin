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

export type ManualPaymentMethod = "Cash" | "EFT" | "Card (terminal)" | "Other";

export async function markPaidAction(
  bookingId: string,
  opts: { paymentMethod?: ManualPaymentMethod; paymentNote?: string } = {},
): Promise<ActionResult> {
  try {
    const res = await supabase.functions.invoke("manual-mark-paid", {
      body: {
        action: "mark_paid",
        booking_id: bookingId,
        payment_method: opts.paymentMethod || "EFT",
        payment_note: opts.paymentNote?.trim() || undefined,
      },
    });
    if (res.error) return { ok: false, error: res.error.message };
    if (res.data?.error) return { ok: false, error: res.data.error };
    return { ok: true, data: res.data };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Network error" };
  }
}

export async function setArrivedCountAction(params: {
  bookingId: string;
  businessId: string;
  arrivedCount: number | null;
  expectedArrivedCount?: number | null;
  slotId?: string | null;
  source?: "simple-view" | "dashboard" | "bookings";
  notes?: string;
}): Promise<ActionResult> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return { ok: false, error: "Session expired" };
    const source = params.source || "simple-view";
    const res = await fetch("/api/check-ins?source=" + encodeURIComponent(source), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + session.access_token,
        "x-admin-business-id": params.businessId,
      },
      body: JSON.stringify({
        booking_id: params.bookingId,
        slot_id: params.slotId || null,
        arrived_count: params.arrivedCount,
        expected_arrived_count: params.expectedArrivedCount ?? null,
        client_event_id: crypto.randomUUID(),
        notes: params.notes || null,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok !== true) return { ok: false, error: data?.error || "Could not save check-in", data };
    return { ok: true, data };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Network error" };
  }
}

export async function checkInAction(
  bookingId: string,
  businessId = "",
  opts: { expectedArrivedCount?: number | null; slotId?: string | null } = {},
): Promise<ActionResult> {
  const resolvedBusinessId = businessId || (typeof window !== "undefined" ? localStorage.getItem("ck_admin_business_id") || "" : "");
  if (!resolvedBusinessId) return { ok: false, error: "Business context is unavailable" };
  return setArrivedCountAction({
    bookingId,
    businessId: resolvedBusinessId,
    arrivedCount: null,
    expectedArrivedCount: opts.expectedArrivedCount,
    slotId: opts.slotId,
    source: "bookings",
  });
}
