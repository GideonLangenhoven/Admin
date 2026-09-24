"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { notify } from "../lib/app-notify";
import { getAdminTimezone } from "../lib/admin-timezone";
import { processRefundAction, type ActionResult, type RefundOutcome } from "../lib/booking-actions";
import { useBusinessContext } from "../../components/BusinessContext";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { readRefundJournal, saveRefundJournal, unresolvedRefundJournal, reconcileRefundJournal, uncertainRefundJournal, type RefundJournal } from "../lib/refund-bulk-journal";

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
  const [bulkHistory, setBulkHistory] = useState<RefundJournal["items"]>([]);
  const [authVersion, setAuthVersion] = useState(0);
  const [showProcessed, setShowProcessed] = useState(false);
  const [editedAmounts, setEditedAmounts] = useState<Record<string, string>>({});
  const [confirmState, setConfirmState] = useState<null | {
    title: string;
    message: string;
    tone: "danger" | "default";
    onConfirm: () => Promise<void>;
  }>(null);
  const mountedRef = useRef(false);
  const businessIdRef = useRef(businessId);
  const activeActorRef = useRef<string | null>(null);
  const loadRequestRef = useRef(0);
  const refundRunRef = useRef<{ businessId: string; cancelled: boolean } | null>(null);
  businessIdRef.current = businessId;

  async function lookupRefundStatuses(ids: string[], targetBusinessId: string) {
    const { data, error } = await supabase.from("bookings")
      .select("id,refund_status,refund_request_id").eq("business_id", targetBusinessId).in("id", ids);
    return { data, error };
  }

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
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      const actorId = session?.user?.id || null;
      if (activeActorRef.current === actorId) return;
      activeActorRef.current = actorId;
      if (refundRunRef.current) refundRunRef.current.cancelled = true;
      setAuthVersion(value => value + 1);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const run = refundRunRef.current;
    if (run && (run.cancelled || run.businessId !== businessId)) {
      run.cancelled = true;
      refundRunRef.current = null;
    }
    setProcessing(null);
    setRefunds([]);
    setProcessed([]);
    setResults({});
    setBulkHistory([]);
    setEditedAmounts({});
    setConfirmState(null);
    setLoading(true);
    void load(businessId);
    if (!businessId) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error || !user || cancelled || !mountedRef.current || businessIdRef.current !== businessId) return;
        activeActorRef.current = user.id;
        const saved = readRefundJournal("refunds", businessId, user.id);
        if (!saved) return;
        let recovered: RefundJournal;
        try {
          recovered = await reconcileRefundJournal(saved, lookupRefundStatuses);
          saveRefundJournal(recovered);
        } catch {
          recovered = uncertainRefundJournal(saved);
          notify({ title: "Refund status unavailable", message: "Reconcile unknown items before retrying them.", tone: "warning" });
        }
        if (cancelled || !mountedRef.current || businessIdRef.current !== businessId) return;
        setBulkHistory(recovered.items);
        setResults(Object.fromEntries(recovered.items.map(item => [item.id, {
          ok: item.status === "completed",
          outcome: item.status === "submitting" ? "unknown" : item.status,
          message: item.status === "submitting" ? "Submission may have started. Reconcile before retrying." : undefined,
        }])));
      } catch {
        if (!cancelled) notify({ title: "Saved refund progress unavailable", message: "Reconcile the prior batch before submitting another.", tone: "error" });
      }
    })();
    return () => { cancelled = true; };
  }, [businessId, load, authVersion]);

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

  async function executeRefundAll(resume = false) {
    if (refundRunRef.current || (!resume && refunds.length === 0)) return;
    const run = { businessId, cancelled: false };
    refundRunRef.current = run;
    const isCurrent = () => mountedRef.current && !run.cancelled && businessIdRef.current === run.businessId;
    try {
      let journal: RefundJournal;
      try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error || !user || !isCurrent()) return;
        const stored = readRefundJournal("refunds", run.businessId, user.id);
        const previous = stored ? await reconcileRefundJournal(stored, lookupRefundStatuses) : null;
        if (previous) saveRefundJournal(previous);
        if (!isCurrent()) return;
        if (resume) {
          if (!previous?.items.some(item => item.status === "unprocessed")) return;
          journal = previous;
        } else if (previous && unresolvedRefundJournal(previous)) {
          setBulkHistory(previous.items);
          notify({ title: "Earlier refund batch needs review", message: "Submit only its remaining items or reconcile unknown outcomes first.", tone: "warning" });
          return;
        } else {
          journal = { actorId: user.id, businessId: run.businessId, surface: "refunds",
            items: refunds.map(refund => ({ id: refund.id, status: "unprocessed" })) };
        }
        saveRefundJournal(journal);
      } catch {
        if (isCurrent()) notify({ title: "Refund progress unavailable", message: "Saved progress and server refund status must be available before submitting another batch.", tone: "error" });
        return;
      }
      if (!isCurrent()) return;
      setBulkHistory([...journal.items]);
      setResults(prev => ({ ...prev, ...Object.fromEntries(journal.items.map(item => [item.id, {
        ok: item.status === "completed", outcome: item.status === "submitting" ? "unknown" : item.status,
        message: item.status === "unprocessed" ? "Not submitted yet. Keep this page open." : undefined,
      }])) }));
      for (let index = 0; index < journal.items.length; index++) {
        if (!isCurrent()) return;
        const item = journal.items[index];
        if (item.status !== "unprocessed") continue;
        try {
          const { data: { user }, error } = await supabase.auth.getUser();
          if (error || user?.id !== journal.actorId || !isCurrent()) return;
          item.status = "submitting";
          saveRefundJournal(journal);
          setBulkHistory([...journal.items]);
        } catch {
          if (isCurrent()) notify({ title: "Refund progress unavailable", message: "Remaining items were not submitted.", tone: "error" });
          return;
        }
        setProcessing(item.id);
        let result: RefundUiResult;
        try {
          result = await processRefundAction({ bookingId: item.id, canSubmit: isCurrent, expectedActorId: journal.actorId }) as RefundUiResult;
        } catch {
          result = UNKNOWN_REFUND_RESULT;
        }
        try {
          item.status = result.outcome;
          saveRefundJournal(journal);
        } catch {
          if (isCurrent()) notify({ title: "Refund outcome needs reconciliation", message: "Remaining items were not submitted.", tone: "error" });
          return;
        }
        if (!isCurrent()) return;
        setBulkHistory([...journal.items]);
        setResults(prev => ({ ...prev, [item.id]: result }));
        if (result.outcome === "unprocessed") return;
        if (index < journal.items.length - 1) await new Promise(resolve => setTimeout(resolve, 500));
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
      title: isPartial ? "Confirm partial automatic refund" : "Confirm automatic refund",
      message: isPartial
        ? `Submit a Yoco refund of R${amount.toFixed(2)} out of R${Number(booking?.total_amount || 0).toFixed(2)} paid? It may remain pending while the provider confirms it.`
        : "Submit this refund? Card refunds may remain pending, and bank transfers remain in the queue until you confirm the transfer.",
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
      title: isPartial ? "Confirm partial manual refund" : "Mark refund as processed",
      message: isPartial
        ? `Only continue after transferring R${amount.toFixed(2)} out of R${Number(booking?.total_amount || 0).toFixed(2)} paid. Mark that bank transfer as completed?`
        : "Only continue after the bank transfer has been made. Mark this refund as manually completed?",
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
      title: "Decline refund request",
      message: "Decline this refund request? The customer will be notified by email and no refund will be paid.",
      tone: "danger",
      onConfirm: async () => {
        setConfirmState(null);
        await executeDeclineRefund(id);
      },
    });
  }

  function refundAll() {
    setConfirmState({
      title: "Submit all refunds",
      message: `Submit all ${refunds.length} queued refunds one at a time? Card refunds may remain pending and bank transfers still require confirmation. Keep this page open until every item has been submitted.`,
      tone: "danger",
      onConfirm: async () => {
        setConfirmState(null);
        await executeRefundAll();
      },
    });
  }

  if (loading) return <div className="space-y-4 py-2"><div className="ui-skeleton h-8 w-48" /><div className="ui-skeleton h-[140px] !rounded-2xl" /><div className="ui-skeleton h-[320px] !rounded-2xl" /></div>;

  const totalRefund = refunds.reduce((sum, b) => sum + Number(b.refund_amount || 0), 0);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="anim-fade-up flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="ui-mono-label mb-2">Customers · Refunds</p>
          <h2 className="font-display text-[28px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}>Refund Queue</h2>
          <p className="mt-2 text-[13px]" style={{ color: "var(--ck-text-muted)" }}>Review refund requests and follow payments through to completion.</p>
        </div>
        {refunds.length > 1 && (
          <button data-demo-action="refund.all" disabled={!!processing} onClick={refundAll} className="ui-btn ui-btn-danger w-full sm:w-auto">
            Submit All ({refunds.length})
          </button>
        )}
      </div>

      {bulkHistory.length > 0 && (
        <div className="ui-card p-4" role="status">
          <p className="text-sm font-semibold">Saved foreground refund progress</p>
          <p className="mt-1 text-xs" style={{ color: "var(--ck-text-muted)" }}>
            These items were selected for a previous run. Only items marked not submitted can be continued; reconcile unknown outcomes against the refund queue first.
          </p>
          <div className="mt-3 space-y-1 text-xs">
            {bulkHistory.map(item => (
              <div key={item.id} className="flex justify-between gap-3">
                <span className="font-mono">{item.id.slice(0, 8)}</span>
                <span>{item.status === "submitting" ? "Outcome unknown" : item.status === "unprocessed" ? "Not submitted" : item.status.replaceAll("_", " ")}</span>
              </div>
            ))}
          </div>
          {bulkHistory.some(item => item.status === "unprocessed") && (
            <button className="ui-btn ui-btn-danger mt-3" disabled={!!processing} onClick={() => setConfirmState({
              title: "Submit remaining refunds",
              message: "Only items recorded as not submitted will be sent. Pending and uncertain items need separate reconciliation.",
              tone: "danger",
              onConfirm: async () => { setConfirmState(null); await executeRefundAll(true); },
            })}>
              Submit remaining items
            </button>
          )}
        </div>
      )}

      {refunds.length > 0 && (
        <div className="anim-fade-up anim-d1 grid grid-cols-2 gap-3 sm:max-w-md">
          <div className="ui-card p-4">
            <div className="mb-2 flex items-center gap-2.5">
              <span className="ui-mono-label !text-[10px]">Pending</span>
            </div>
            <p className="font-display text-[28px] font-semibold leading-none tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{refunds.length}</p>
          </div>
          <div className="ui-card p-4">
            <div className="mb-2 flex items-center gap-2.5">
              <span className="ui-mono-label !text-[10px]">To Refund</span>
            </div>
            <p className="font-display text-[28px] font-semibold leading-none tabular-nums" style={{ color: "var(--ck-text-strong)" }}>R{totalRefund.toLocaleString()}</p>
          </div>
        </div>
      )}

      {refunds.length === 0 ? (
        <div className="ui-card">
          <div className="ui-empty">
            <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No pending refunds</p>
            <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Refund requests awaiting action will appear here.</p>
          </div>
        </div>
      ) : (
        <div className="anim-fade-up anim-d2 space-y-3">
          {refunds.map((b: any) => {
            const res = results[b.id];
            const isProcessing = processing === b.id;
            const actionInFlight = !!processing;
            const resultLabel = res?.outcome === "completed" ? "Refund completed"
              : res?.outcome === "pending" ? "Refund pending"
                : res?.outcome === "manual_action" ? "Manual action required"
                  : res?.outcome === "failed" ? "Refund failed"
                    : res?.outcome === "unknown" ? "Refund outcome unknown"
                      : "Not submitted";
            const resultMessage = res?.message || res?.error || (res?.outcome === "unprocessed"
              ? "This item has not been submitted. Keep this browser open while the queue runs."
              : "Refresh the refund queue before taking another action.");
            const resultStyle = res?.outcome === "completed"
              ? { background: "var(--ck-success-soft)", color: "var(--ck-success)" }
              : res?.outcome === "failed"
                ? { background: "var(--ck-danger-soft)", color: "var(--ck-danger)" }
                : { background: "var(--ck-warning-soft)", color: "var(--ck-warning)" };

            return (
              <div key={b.id} className="ui-card p-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="flex-1">
                    <p className="font-semibold" style={{ color: "var(--ck-text-strong)" }}>{b.customer_name} <span className="font-mono text-xs" style={{ color: "var(--ck-text-muted)" }}>({b.id.substring(0, 8).toUpperCase()})</span></p>
                    <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>{b.tours?.name} · {b.slots?.start_time ? fmtTime(b.slots.start_time) : "-"} · {b.qty} pax</p>
                    <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>{b.phone} · {b.email}</p>
                    {b.cancellation_reason && <p className="mt-1 text-xs" style={{ color: "var(--ck-text-muted)" }}>Reason: {b.cancellation_reason}</p>}
                    {b.refund_status === "MANUAL_EFT_REQUIRED" && <p className="mt-1 text-xs" style={{ color: "var(--ck-warning)" }}>Awaiting bank transfer confirmation</p>}
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="sm:text-right">
                      <div className="flex items-center gap-1 sm:justify-end">
                        <span className="text-lg font-bold" style={{ color: "var(--ck-danger)" }}>R</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max={Number(b.total_captured || b.total_amount || 0)}
                          disabled={actionInFlight || ["REFUND_PENDING", "MANUAL_EFT_REQUIRED"].includes(b.refund_status)}
                          aria-label="Refund amount"
                          value={editedAmounts[b.id] !== undefined ? editedAmounts[b.id] : String(b.refund_amount || 0)}
                          onChange={e => setEditedAmounts({ ...editedAmounts, [b.id]: e.target.value })}
                          className="ui-control w-28 px-2 py-1 text-right text-2xl font-bold tabular-nums"
                          style={{ color: "var(--ck-danger)", background: "var(--ck-danger-soft)" }}
                        />
                      </div>
                      {Number(b.total_amount || 0) > 0 && (
                        <p className="mt-1 text-[11px]" style={{ color: "var(--ck-text-muted)" }}>
                          of R{Number(b.total_amount).toFixed(2)} paid
                          {editedAmounts[b.id] !== undefined && parseFloat(editedAmounts[b.id]) < Number(b.total_amount) && (
                            <span className="ml-1 font-medium" style={{ color: "var(--ck-warning)" }}>(partial)</span>
                          )}
                        </p>
                      )}
                      <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{b.refund_notes}</p>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-col">
                      {b.refund_status !== "MANUAL_EFT_REQUIRED" && (
                        <button data-demo-action={b.refund_status === "REFUND_PENDING" ? "refund.check" : "refund.process"} onClick={() => autoRefund(b.id)} disabled={actionInFlight}
                          className="ui-btn ui-btn-danger whitespace-nowrap disabled:opacity-40">
                          {isProcessing ? "Submitting..." : b.refund_status === "REFUND_PENDING" ? "Check status" : "Submit refund"}
                        </button>
                      )}
                      {b.refund_status === "MANUAL_EFT_REQUIRED" && <button data-demo-action="refund.manual" onClick={() => manualRefund(b.id)} disabled={actionInFlight}
                        className="ui-btn ui-btn-ghost whitespace-nowrap disabled:opacity-40">
                        Confirm bank transfer
                      </button>}
                      <button data-demo-action="refund.decline" onClick={() => declineRefund(b.id)} disabled={actionInFlight || !["REQUESTED", "FAILED"].includes(b.refund_status)}
                        className="ui-btn ui-btn-ghost whitespace-nowrap disabled:opacity-40" style={{ color: "var(--ck-text-muted)" }}>
                        Decline
                      </button>
                    </div>
                  </div>
                </div>
                {res && (
                  <div role={res.outcome === "failed" || res.outcome === "unknown" ? "alert" : "status"} className="mt-3 rounded-lg p-3 text-sm" style={resultStyle}>
                    <span className="font-semibold">{resultLabel}.</span> {resultMessage}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Processed refunds */}
      <div className="pt-4">
        <button onClick={() => setShowProcessed(!showProcessed)}
          className="flex items-center gap-1.5 text-sm font-medium transition-colors" style={{ color: "var(--ck-text-muted)" }}>
          {showProcessed ? <CaretDown size={13} weight="bold" /> : <CaretRight size={13} weight="bold" />} Processed Refunds ({processed.length})
        </button>
        {showProcessed && (
          <div className="mt-3 space-y-2">
            {processed.map((b: any) => (
              <div key={b.id} className="flex flex-col gap-2 rounded-xl p-3 sm:flex-row sm:items-center" style={{ background: "var(--ck-surface-sunken)" }}>
                <div className="flex-1">
                  <p className="text-sm font-medium" style={{ color: "var(--ck-text-strong)" }}>{b.customer_name} <span className="font-mono text-xs" style={{ color: "var(--ck-text-muted)" }}>({b.id.substring(0, 8).toUpperCase()})</span></p>
                  <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{b.tours?.name} · {b.slots?.start_time ? fmtTime(b.slots.start_time) : "-"}</p>
                </div>
                <span className={"ui-status " + (b.refund_status === "PROCESSED" || b.refund_status === "REFUNDED" ? "ui-pill-success" : b.refund_status === "DECLINED" ? "ui-pill-neutral" : "ui-pill-danger")}>
                  {b.refund_status === "PROCESSED" || b.refund_status === "REFUNDED" ? "Refunded" : b.refund_status === "DECLINED" ? "Declined" : "Failed"}
                </span>
                <p className="text-sm font-semibold tabular-nums" style={{ color: "var(--ck-text)" }}>R{b.refund_amount}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="ui-card w-full max-w-md p-6" style={{ boxShadow: "var(--ck-shadow-lg)" }}>
            <h3 className="text-[17px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>{confirmState.title}</h3>
            <p className="mt-2 text-sm" style={{ color: "var(--ck-text)" }}>{confirmState.message}</p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmState(null)}
                className="ui-btn ui-btn-ghost"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { if (confirmState) void confirmState.onConfirm(); }}
                className={`ui-btn ${confirmState?.tone === "danger" ? "ui-btn-danger" : "ui-btn-primary"}`}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
