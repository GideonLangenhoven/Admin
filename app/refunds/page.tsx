"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { notify } from "../lib/app-notify";
import { getAdminTimezone } from "../lib/admin-timezone";
import { processRefundAction, type ActionResult, type RefundOutcome } from "../lib/booking-actions";
import { useBusinessContext } from "../../components/BusinessContext";
import { CaretDown, CaretRight } from "@phosphor-icons/react";

type RefundUiOutcome = RefundOutcome | "unprocessed";
type RefundUiResult = Omit<ActionResult, "outcome"> & { outcome: RefundUiOutcome };

const UNKNOWN_REFUND_RESULT: RefundUiResult = {
  ok: false,
  outcome: "unknown",
  error: "Refund outcome is unknown. Refresh and reconcile this booking before retrying the existing refund reference.",
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: getAdminTimezone() });
}

export default function Refunds() {
  const { businessId } = useBusinessContext();
  const [refunds, setRefunds] = useState<any[]>([]);
  const [processed, setProcessed] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, RefundUiResult>>({});
  const [showProcessed, setShowProcessed] = useState(false);
  const [editedAmounts, setEditedAmounts] = useState<Record<string, string>>({});
  const [confirmState, setConfirmState] = useState<null | {
    title: string;
    message: string;
    confirmLabel: string;
    tone: "danger" | "default";
    onConfirm: () => Promise<void>;
  }>(null);
  const mountedRef = useRef(false);
  const businessIdRef = useRef(businessId);
  const loadRequestRef = useRef(0);
  const refundRunRef = useRef<{ businessId: string; cancelled: boolean } | null>(null);
  businessIdRef.current = businessId;

  const load = useCallback(async (expectedBusinessId = businessId) => {
    const requestId = ++loadRequestRef.current;
    try {
      const { data: pending, error: pendingError } = await supabase.from("bookings")
        .select("id, customer_name, phone, email, qty, total_amount, total_captured, total_refunded, payment_method, refund_status, refund_amount, refund_notes, cancellation_reason, cancelled_at, yoco_checkout_id, slots(start_time), tours(name)")
        .eq("business_id", expectedBusinessId)
        // ACTION_REQUIRED deliberately excluded: those bookings are waiting for
        // the CUSTOMER to choose refund / voucher / reschedule on My Bookings.
        // Money only enters this queue once they pick "refund" (→ REQUESTED).
        .in("refund_status", ["REQUESTED", "REFUND_PENDING", "MANUAL_EFT_REQUIRED", "FAILED"])
        .order("cancelled_at", { ascending: false });
      if (pendingError) throw pendingError;
      if (!mountedRef.current || businessIdRef.current !== expectedBusinessId || requestId !== loadRequestRef.current) return;

      const { data: done, error: doneError } = await supabase.from("bookings")
        .select("id, customer_name, phone, email, qty, total_amount, total_captured, total_refunded, payment_method, refund_status, refund_amount, refund_notes, cancelled_at, slots(start_time), tours(name)")
        .eq("business_id", expectedBusinessId)
        // REFUNDED is the Yoco auto-refund's terminal status; PROCESSED is the
        // manual-EFT one. Both mean "refund made" and must show in this list.
        .in("refund_status", ["PROCESSED", "REFUNDED", "DECLINED"])
        .order("cancelled_at", { ascending: false })
        .limit(20);
      if (doneError) throw doneError;
      if (!mountedRef.current || businessIdRef.current !== expectedBusinessId || requestId !== loadRequestRef.current) return;
      setRefunds(pending || []);
      setProcessed(done || []);
    } catch (error: any) {
      if (mountedRef.current && businessIdRef.current === expectedBusinessId && requestId === loadRequestRef.current) {
        notify({ title: "Refund queue could not be loaded", message: error?.message || "Please refresh and try again.", tone: "error" });
      }
    } finally {
      if (mountedRef.current && businessIdRef.current === expectedBusinessId && requestId === loadRequestRef.current) setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadRequestRef.current += 1;
      if (refundRunRef.current) refundRunRef.current.cancelled = true;
    };
  }, []);

  useEffect(() => {
    const run = refundRunRef.current;
    if (run && run.businessId !== businessId) {
      run.cancelled = true;
      refundRunRef.current = null;
    }
    setProcessing(null);
    setRefunds([]);
    setProcessed([]);
    setResults({});
    setEditedAmounts({});
    setConfirmState(null);
    setLoading(true);
    void load(businessId);
  }, [businessId, load]);

  function getRefundAmount(b: any): number {
    const edited = editedAmounts[b.id];
    if (edited !== undefined) return Math.max(0, parseFloat(edited) || 0);
    return Number(b.refund_amount || 0);
  }

  async function executeAutoRefund(id: string) {
    if (refundRunRef.current) return;
    const booking = refunds.find(b => b.id === id);
    const amount = booking ? getRefundAmount(booking) : 0;
    const run = { businessId, cancelled: false };
    refundRunRef.current = run;
    const isCurrent = () => mountedRef.current && !run.cancelled && businessIdRef.current === run.businessId;
    if (!isCurrent()) {
      refundRunRef.current = null;
      return;
    }
    setProcessing(id);
    try {
      const result = await processRefundAction({
        bookingId: id,
        amount: booking?.refund_status === "REFUND_PENDING" ? undefined : amount,
        resumeRefund: booking?.refund_status === "REFUND_PENDING",
        canSubmit: isCurrent,
      });
      if (!isCurrent()) return;
      setResults(prev => ({ ...prev, [id]: result as RefundUiResult }));
      await load(run.businessId);
    } catch {
      if (isCurrent()) setResults(prev => ({ ...prev, [id]: UNKNOWN_REFUND_RESULT }));
    } finally {
      const current = isCurrent();
      if (refundRunRef.current === run) refundRunRef.current = null;
      if (current) setProcessing(null);
    }
  }

  async function executeManualRefund(id: string) {
    if (refundRunRef.current) return;
    const booking = refunds.find(b => b.id === id);
    const amount = booking ? getRefundAmount(booking) : 0;
    const run = { businessId, cancelled: false };
    refundRunRef.current = run;
    const isCurrent = () => mountedRef.current && !run.cancelled && businessIdRef.current === run.businessId;
    if (!isCurrent()) {
      refundRunRef.current = null;
      return;
    }
    setProcessing(id);
    try {
      const result = await processRefundAction({ bookingId: id, amount, action: "confirm_manual", canSubmit: isCurrent });
      if (!isCurrent()) return;
      setResults(prev => ({ ...prev, [id]: result as RefundUiResult }));
      await load(run.businessId);
    } catch {
      if (isCurrent()) setResults(prev => ({ ...prev, [id]: UNKNOWN_REFUND_RESULT }));
    } finally {
      const current = isCurrent();
      if (refundRunRef.current === run) refundRunRef.current = null;
      if (current) setProcessing(null);
    }
  }

  async function executeRefundAll() {
    if (refundRunRef.current || refunds.length === 0) return;
    const queued = [...refunds];
    const run = { businessId, cancelled: false };
    refundRunRef.current = run;
    const isCurrent = () => mountedRef.current && !run.cancelled && businessIdRef.current === run.businessId;
    if (isCurrent()) {
      setResults(prev => {
        const next = { ...prev };
        for (const refund of queued) next[refund.id] = { ok: false, outcome: "unprocessed", message: "Not submitted yet. Keep this page open." };
        return next;
      });
    }
    try {
      for (let index = 0; index < queued.length; index++) {
        if (!isCurrent()) return;
        const refund = queued[index];
        setProcessing(refund.id);
        let result: RefundUiResult;
        try {
          result = await processRefundAction({ bookingId: refund.id, canSubmit: isCurrent }) as RefundUiResult;
        } catch {
          result = UNKNOWN_REFUND_RESULT;
        }
        if (!isCurrent()) return;
        setResults(prev => ({ ...prev, [refund.id]: result }));
        if (index < queued.length - 1) await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (isCurrent()) await load(run.businessId);
    } finally {
      const current = isCurrent();
      if (refundRunRef.current === run) refundRunRef.current = null;
      if (current) setProcessing(null);
    }
  }

  function autoRefund(id: string) {
    const booking = refunds.find(b => b.id === id);
    const amount = booking ? getRefundAmount(booking) : 0;
    if (booking?.refund_status === "REFUND_PENDING") { void executeAutoRefund(id); return; }
    const isPartial = booking && amount < Number(booking.total_amount || 0);
    setConfirmState({
      title: `Refund R${amount.toFixed(2)}?`,
      message: isPartial
        ? `Partial refund from R${Number(booking?.total_amount || 0).toFixed(2)} paid. Card refunds may stay pending; bank transfers need confirmation.`
        : "Card refunds may stay pending. Bank transfers need confirmation after payment.",
      confirmLabel: "Submit refund",
      tone: "danger",
      onConfirm: async () => {
        setConfirmState(null);
        await executeAutoRefund(id);
      },
    });
  }

  function manualRefund(id: string) {
    const booking = refunds.find(b => b.id === id);
    const amount = booking ? getRefundAmount(booking) : 0;
    const isPartial = booking && amount < Number(booking.total_amount || 0);
    setConfirmState({
      title: "Confirm bank transfer",
      message: isPartial
        ? `Confirm only after transferring R${amount.toFixed(2)} of R${Number(booking?.total_amount || 0).toFixed(2)} paid to the guest.`
        : `Confirm only after transferring R${amount.toFixed(2)} to the guest.`,
      confirmLabel: "Transfer completed",
      tone: "default",
      onConfirm: async () => {
        setConfirmState(null);
        await executeManualRefund(id);
      },
    });
  }

  async function executeDeclineRefund(id: string) {
    const booking = refunds.find(b => b.id === id);
    const declined = await supabase.from("bookings").update({
      refund_status: "DECLINED", refund_notes: "Refund declined by admin",
    }).eq("id", id).eq("business_id", businessId).in("refund_status", ["REQUESTED", "FAILED"]).select("id").maybeSingle();
    if (declined.error || !declined.data) { notify({ title: "Refund could not be declined", message: "It may already be processing. Refresh the queue.", tone: "error" }); await load(); return; }
    if (booking?.email) {
      try {
        await supabase.functions.invoke("send-email", {
          body: {
            type: "BOOKING_UPDATED",
            data: {
              business_id: businessId,
              email: booking.email,
              customer_name: booking.customer_name,
              ref: booking.id.substring(0, 8).toUpperCase(),
              tour_name: booking.tours?.name || "Booking",
              start_time: booking.slots?.start_time || "",
              message: "Your refund request for booking " + booking.id.substring(0, 8).toUpperCase() +
                " has been declined. Please contact us if you have any questions.",
              event: "refund_declined",
            },
          },
        });
      } catch (e) {
        console.error("DECLINE_REFUND_EMAIL_ERR:", e);
      }
    }
    load();
  }

  function declineRefund(id: string) {
    setConfirmState({
      title: "Decline this refund?",
      message: "The guest will be emailed. No refund will be paid.",
      confirmLabel: "Decline refund",
      tone: "danger",
      onConfirm: async () => {
        setConfirmState(null);
        await executeDeclineRefund(id);
      },
    });
  }

  function refundAll() {
    setConfirmState({
      title: `Submit ${refunds.length} refunds?`,
      message: "Keep this page open until submission finishes. Card refunds may stay pending; bank transfers still need confirmation.",
      confirmLabel: "Submit all",
      tone: "danger",
      onConfirm: async () => {
        setConfirmState(null);
        await executeRefundAll();
      },
    });
  }

  if (loading) return <div className="space-y-4 py-2"><div className="ui-skeleton h-8 w-36" /><div className="ui-skeleton h-[320px] !rounded-xl" /></div>;

  const totalRefund = refunds.reduce((sum, b) => sum + Number(b.refund_amount || 0), 0);
  const money = (amount: number) => `R${amount.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="max-w-5xl space-y-5">
      <h2 className="text-2xl font-semibold" style={{ color: "var(--ck-text-strong)" }}>Refunds</h2>

      {refunds.length === 0 ? (
        <div className="rounded-xl border px-4 py-8 text-sm" style={{ background: "var(--ck-surface)", borderColor: "var(--ck-border-subtle)", color: "var(--ck-text-muted)" }}>No refunds waiting.</div>
      ) : (
        <section aria-label="Refund queue" className="overflow-hidden rounded-xl border" style={{ background: "var(--ck-surface)", borderColor: "var(--ck-border-subtle)" }}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--ck-border-subtle)" }}>
            <p className="text-sm" style={{ color: "var(--ck-text)" }}>
              <span className="font-semibold" style={{ color: "var(--ck-text-strong)" }}>{refunds.length} waiting</span>
              <span className="ml-3 tabular-nums">{money(totalRefund)} requested</span>
            </p>
            {refunds.length > 1 && <button data-demo-action="refund.all" disabled={!!processing} onClick={refundAll} className="ui-btn ui-btn-ghost min-h-11 disabled:opacity-40">Submit all</button>}
          </div>
          <div className="divide-y divide-[var(--ck-border-subtle)]">
            {refunds.map((b: any) => {
              const res = results[b.id];
              const isProcessing = processing === b.id;
              const actionInFlight = !!processing;
              const resultLabel = res?.outcome === "completed" ? "Refund completed"
                : res?.outcome === "pending" ? "Refund pending"
                  : res?.outcome === "manual_action" ? "Bank transfer needed"
                    : res?.outcome === "failed" ? "Refund failed"
                      : res?.outcome === "unknown" ? "Refund outcome unknown"
                        : "Not submitted";
              const resultMessage = res?.message || res?.error || (res?.outcome === "unprocessed"
                ? "Not submitted yet. Keep this page open."
                : "Refresh the queue before taking another action.");
              const statusLabel = b.refund_status === "REFUND_PENDING" ? "Card refund pending"
                : b.refund_status === "MANUAL_EFT_REQUIRED" ? "Bank transfer needed"
                  : b.refund_status === "FAILED" ? "Refund failed" : "Requested";

              return (
                <article key={b.id} className="p-4 sm:p-5">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 md:grid-cols-[minmax(0,1fr)_10rem_11rem] md:items-start md:gap-x-6">
                    <div className="min-w-0">
                      <h3 className="break-words text-[15px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>{b.customer_name || "Guest"}</h3>
                      <p className="mt-1 text-sm" style={{ color: "var(--ck-text)" }}>{b.tours?.name || "Booking"}</p>
                      <p className="mt-1 text-xs" style={{ color: "var(--ck-text-muted)" }}>{b.slots?.start_time ? fmtTime(b.slots.start_time) : "No departure date"} · {b.qty} {b.qty === 1 ? "guest" : "guests"}</p>
                      <p className="mt-2 text-xs" style={{ color: "var(--ck-text-muted)" }}>Booking {b.id.substring(0, 8).toUpperCase()}</p>
                      <p className="mt-2 text-xs font-medium" style={{ color: b.refund_status === "FAILED" ? "var(--ck-danger)" : "var(--ck-text)" }}>{statusLabel}</p>
                    </div>
                    <div className="w-32 md:w-auto">
                      <label htmlFor={`refund-${b.id}`} className="mb-1 block text-xs" style={{ color: "var(--ck-text-muted)" }}>Refund amount</label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--ck-text-muted)" }}>R</span>
                        <input
                          id={`refund-${b.id}`}
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min="0"
                          max={Number(b.total_captured || b.total_amount || 0)}
                          disabled={actionInFlight || ["REFUND_PENDING", "MANUAL_EFT_REQUIRED"].includes(b.refund_status)}
                          value={editedAmounts[b.id] !== undefined ? editedAmounts[b.id] : String(b.refund_amount || 0)}
                          onChange={e => setEditedAmounts({ ...editedAmounts, [b.id]: e.target.value })}
                          className="ui-control min-h-11 w-full !pl-7 !pr-2 text-right text-base font-semibold tabular-nums"
                        />
                      </div>
                      {Number(b.total_amount || 0) > 0 && <p className="mt-1 text-right text-xs tabular-nums" style={{ color: "var(--ck-text-muted)" }}>of {money(Number(b.total_amount))}</p>}
                    </div>
                    <div className="col-span-2 flex items-center gap-2 border-t pt-3 md:col-span-1 md:flex-col md:items-stretch md:border-0 md:pt-0" style={{ borderColor: "var(--ck-border-subtle)" }}>
                      {b.refund_status !== "MANUAL_EFT_REQUIRED" && <button data-demo-action={b.refund_status === "REFUND_PENDING" ? "refund.check" : "refund.process"} onClick={() => autoRefund(b.id)} disabled={actionInFlight} className="ui-btn ui-btn-primary min-h-11 flex-1 whitespace-nowrap disabled:opacity-40">
                        {isProcessing ? "Submitting…" : b.refund_status === "REFUND_PENDING" ? "Check status" : "Submit refund"}
                      </button>}
                      {b.refund_status === "MANUAL_EFT_REQUIRED" && <button data-demo-action="refund.manual" onClick={() => manualRefund(b.id)} disabled={actionInFlight} className="ui-btn ui-btn-primary min-h-11 flex-1 whitespace-nowrap disabled:opacity-40">Confirm transfer</button>}
                      {["REQUESTED", "FAILED"].includes(b.refund_status) && <button data-demo-action="refund.decline" onClick={() => declineRefund(b.id)} disabled={actionInFlight} className="ui-btn ui-btn-ghost min-h-11 whitespace-nowrap disabled:opacity-40">Decline</button>}
                    </div>
                  </div>
                  {(b.cancellation_reason || b.refund_notes) && <details className="mt-3 text-xs" style={{ color: "var(--ck-text-muted)" }}>
                    <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 font-medium"><CaretDown size={12} aria-hidden="true" />Details</summary>
                    <div className="max-w-prose space-y-1 pb-1">
                      {b.cancellation_reason && <p>{b.cancellation_reason}</p>}
                      {b.refund_notes && <p>{b.refund_notes}</p>}
                    </div>
                  </details>}
                  {res && <div role={res.outcome === "failed" || res.outcome === "unknown" ? "alert" : "status"} className="mt-3 text-sm" style={{ color: res.outcome === "failed" || res.outcome === "unknown" ? "var(--ck-danger)" : "var(--ck-text)" }}>
                    <span className="font-medium">{resultLabel}.</span> {resultMessage}
                  </div>}
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <button type="button" onClick={() => setShowProcessed(!showProcessed)} aria-expanded={showProcessed} aria-controls="refund-history" className="flex min-h-11 items-center gap-2 text-sm font-medium" style={{ color: "var(--ck-text)" }}>
          {showProcessed ? <CaretDown size={14} aria-hidden="true" /> : <CaretRight size={14} aria-hidden="true" />} Recent activity <span style={{ color: "var(--ck-text-muted)" }}>{processed.length}</span>
        </button>
        {showProcessed && <div id="refund-history" className="mt-2 divide-y divide-[var(--ck-border-subtle)] rounded-xl border px-4" style={{ background: "var(--ck-surface)", borderColor: "var(--ck-border-subtle)" }}>
          {processed.length === 0 && <p className="py-4 text-sm" style={{ color: "var(--ck-text-muted)" }}>No recent refunds.</p>}
          {processed.map((b: any) => <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium" style={{ color: "var(--ck-text-strong)" }}>{b.customer_name || "Guest"}</p>
              <p className="mt-1 text-xs" style={{ color: "var(--ck-text-muted)" }}>{b.tours?.name} · {b.slots?.start_time ? fmtTime(b.slots.start_time) : "No departure date"}</p>
              <p className="mt-1 text-xs" style={{ color: "var(--ck-text-muted)" }}>Booking {b.id.substring(0, 8).toUpperCase()}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{money(Number(b.refund_amount || 0))}</p>
              <p className="mt-1 text-xs" style={{ color: "var(--ck-text-muted)" }}>{b.refund_status === "PROCESSED" || b.refund_status === "REFUNDED" ? "Refunded" : b.refund_status === "DECLINED" ? "Declined" : "Failed"}</p>
            </div>
          </div>)}
        </div>}
      </section>

      {confirmState && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={event => { if (event.target === event.currentTarget) setConfirmState(null); }}>
        <div role="dialog" aria-modal="true" aria-labelledby="refund-confirm-title" className="ui-card max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto p-5" onKeyDown={event => {
          if (event.key === "Escape") setConfirmState(null);
          if (event.key === "Tab") {
            const buttons = event.currentTarget.querySelectorAll("button");
            const first = buttons[0], last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}>
          <h3 id="refund-confirm-title" className="text-lg font-semibold" style={{ color: "var(--ck-text-strong)" }}>{confirmState.title}</h3>
          <p className="mt-2 text-sm" style={{ color: "var(--ck-text)" }}>{confirmState.message}</p>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button type="button" autoFocus onClick={() => setConfirmState(null)} className="ui-btn ui-btn-ghost min-h-11">Cancel</button>
            <button type="button" onClick={() => { if (confirmState) void confirmState.onConfirm(); }} className={`ui-btn min-h-11 ${confirmState.tone === "danger" ? "ui-btn-danger" : "ui-btn-primary"}`}>{confirmState.confirmLabel}</button>
          </div>
        </div>
      </div>}
    </div>
  );
}
