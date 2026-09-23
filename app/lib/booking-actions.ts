import { supabase } from "./supabase";

const SU = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

export type RefundOutcome = "completed" | "pending" | "manual_action" | "failed" | "unknown" | "unprocessed";
export type ActionResult = { ok: boolean; outcome?: RefundOutcome; error?: string; message?: string; data?: any };

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

const UNKNOWN_REFUND_MESSAGE = "Refund outcome is unknown. Refresh and reconcile this booking before retrying the existing refund reference.";
const UNSUBMITTED_REFUND: ActionResult = { ok: false, outcome: "unprocessed", message: "Refund was not submitted because the active account or page changed." };

export async function processRefundAction(input: {
  bookingId: string;
  amount?: number;
  action?: "confirm_manual";
  resumeRefund?: boolean;
  canSubmit?: () => boolean;
  expectedActorId?: string;
}): Promise<ActionResult> {
  if (input.canSubmit && !input.canSubmit()) return UNSUBMITTED_REFUND;
  let accessToken: string;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (input.canSubmit && !input.canSubmit()) return UNSUBMITTED_REFUND;
    if (!session?.access_token) return { ok: false, outcome: input.expectedActorId ? "unprocessed" : "failed", error: "Session expired. Please sign in again." };
    if (input.expectedActorId && session.user?.id !== input.expectedActorId) return UNSUBMITTED_REFUND;
    accessToken = session.access_token;
  } catch {
    return { ok: false, outcome: input.expectedActorId ? "unprocessed" : "failed", error: "Your session could not be verified. Please sign in again." };
  }

  const body = {
    booking_id: input.bookingId,
    ...(input.amount !== undefined ? { amount: input.amount } : {}),
    ...(input.action ? { action: input.action } : {}),
    ...(input.resumeRefund ? { resume_refund: true } : {}),
  };
  if (input.canSubmit && !input.canSubmit()) return UNSUBMITTED_REFUND;
  let response: Response;
  try {
    response = await fetch(SU + "/functions/v1/process-refund", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + accessToken },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, outcome: "unknown", error: UNKNOWN_REFUND_MESSAGE };
  }

  let data: any;
  try {
    data = await response.json();
  } catch {
    if (!response.ok && response.status < 500) return { ok: false, outcome: "failed", error: "Refund request failed" };
    return { ok: false, outcome: "unknown", error: UNKNOWN_REFUND_MESSAGE };
  }
  if (data?.refund_status === "MANUAL_EFT_REQUIRED") {
    return { ok: false, outcome: "manual_action", message: "Bank transfer required. Money has not been returned by this action.", data };
  }
  if (response.status === 202 || data?.pending === true || data?.refund_status === "REFUND_PENDING") {
    const explanation = typeof data?.error === "string" ? data.error : typeof data?.message === "string" ? data.message : "Refund remains pending.";
    return { ok: false, outcome: "pending", message: explanation + " Refresh and reconcile this booking before retrying; the server will reuse the existing refund reference.", data };
  }
  if (response.ok && data?.ok === true && (data.refund_status === "REFUNDED" || data.channel === "voucher" || data.already_refunded === true)) {
    return { ok: true, outcome: "completed", message: "Refund completed.", data };
  }
  if (data?.refund_status === "FAILED" || (response.status < 500 && (!response.ok || data?.ok === false || data?.error))) {
    return { ok: false, outcome: "failed", error: data?.error || "Refund request failed", data };
  }
  return { ok: false, outcome: "unknown", error: UNKNOWN_REFUND_MESSAGE, data };
}

export async function refundBookingAction(bookingId: string, options: { canSubmit?: () => boolean; expectedActorId?: string } = {}): Promise<ActionResult> {
  return processRefundAction({ bookingId, canSubmit: options.canSubmit, expectedActorId: options.expectedActorId });
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
