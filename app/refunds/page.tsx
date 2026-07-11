"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { notify } from "../lib/app-notify";
import { getAdminTimezone } from "../lib/admin-timezone";
import { useBusinessContext } from "../../components/BusinessContext";
import { Receipt, CurrencyCircleDollar, ArrowCounterClockwise, CaretDown, CaretRight } from "@phosphor-icons/react";

const SU = process.env.NEXT_PUBLIC_SUPABASE_URL!;

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: getAdminTimezone() });
}

export default function Refunds() {
  const { businessId } = useBusinessContext();
  const [refunds, setRefunds] = useState<any[]>([]);
  const [processed, setProcessed] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, any>>({});
  const [showProcessed, setShowProcessed] = useState(false);
  const [editedAmounts, setEditedAmounts] = useState<Record<string, string>>({});
  const [confirmState, setConfirmState] = useState<null | {
    title: string;
    message: string;
    tone: "danger" | "default";
    onConfirm: () => Promise<void>;
  }>(null);

  useEffect(() => { load(); }, [businessId]);

  async function load() {
    const { data: pending } = await supabase.from("bookings")
      .select("id, customer_name, phone, email, qty, total_amount, refund_status, refund_amount, refund_notes, cancellation_reason, cancelled_at, yoco_checkout_id, slots(start_time), tours(name)")
      .eq("business_id", businessId)
      // ACTION_REQUIRED deliberately excluded: those bookings are waiting for
      // the CUSTOMER to choose refund / voucher / reschedule on My Bookings.
      // Money only enters this queue once they pick "refund" (→ REQUESTED).
      .eq("refund_status", "REQUESTED")
      .order("cancelled_at", { ascending: false });
    setRefunds(pending || []);

    const { data: done } = await supabase.from("bookings")
      .select("id, customer_name, phone, email, qty, total_amount, refund_status, refund_amount, refund_notes, cancelled_at, slots(start_time), tours(name)")
      .eq("business_id", businessId)
      .in("refund_status", ["PROCESSED", "FAILED", "DECLINED"])
      .order("cancelled_at", { ascending: false })
      .limit(20);
    setProcessed(done || []);
    setLoading(false);
  }

  function getRefundAmount(b: any): number {
    const edited = editedAmounts[b.id];
    if (edited !== undefined) return Math.max(0, parseFloat(edited) || 0);
    return Number(b.refund_amount || 0);
  }

  async function saveRefundAmount(id: string, amount: number) {
    await supabase.from("bookings").update({ refund_amount: amount }).eq("id", id);
  }

  async function executeAutoRefund(id: string) {
    const booking = refunds.find(b => b.id === id);
    const amount = booking ? getRefundAmount(booking) : 0;
    setProcessing(id);
    try {
      await saveRefundAmount(id, amount);
      // process-refund authorizes the caller — send the admin's session JWT.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setResults(prev => ({ ...prev, [id]: { error: "Session expired — please sign in again." } }));
        setProcessing(null);
        return;
      }
      const r = await fetch(SU + "/functions/v1/process-refund", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
        body: JSON.stringify({ booking_id: id, amount }),
      });
      const d = await r.json();
      setResults(prev => ({ ...prev, [id]: d }));
      load();
    } catch (e) {
      setResults(prev => ({ ...prev, [id]: { error: String(e) } }));
    }
    setProcessing(null);
  }

  async function executeManualRefund(id: string) {
    const booking = refunds.find(b => b.id === id);
    const amount = booking ? getRefundAmount(booking) : 0;
    const isPartial = booking && amount < Number(booking.total_amount || 0);
    await saveRefundAmount(id, amount);
    await supabase.from("bookings").update({
      refund_status: "PROCESSED",
      refund_notes: isPartial ? `Partial manual refund — R${amount.toFixed(2)} of R${Number(booking.total_amount).toFixed(2)}` : "Manual refund",
    }).eq("id", id);
    load();
  }

  async function executeRefundAll() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      notify({ title: "Session expired", message: "Please sign in again and try again.", tone: "error" });
      return;
    }
    for (const r of refunds) {
      setProcessing(r.id);
      try {
        const res = await fetch(SU + "/functions/v1/process-refund", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
          body: JSON.stringify({ booking_id: r.id }),
        });
        const d = await res.json();
        setResults(prev => ({ ...prev, [r.id]: d }));
      } catch (e) {
        setResults(prev => ({ ...prev, [r.id]: { error: String(e) } }));
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    setProcessing(null);
    load();
  }

  function autoRefund(id: string) {
    const booking = refunds.find(b => b.id === id);
    const amount = booking ? getRefundAmount(booking) : 0;
    const isPartial = booking && amount < Number(booking.total_amount || 0);
    setConfirmState({
      title: isPartial ? "Confirm partial automatic refund" : "Confirm automatic refund",
      message: isPartial
        ? `Process a Yoco refund of R${amount.toFixed(2)} out of R${Number(booking?.total_amount || 0).toFixed(2)} paid? The customer will be notified.`
        : "Process the automatic Yoco refund now? The customer will be notified via WhatsApp and email.",
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
        ? `Mark a manual refund of R${amount.toFixed(2)} out of R${Number(booking?.total_amount || 0).toFixed(2)} paid as completed?`
        : "Mark this refund as manually processed?",
      tone: "default",
      onConfirm: async () => {
        setConfirmState(null);
        await executeManualRefund(id);
      },
    });
  }

  async function executeDeclineRefund(id: string) {
    const booking = refunds.find(b => b.id === id);
    await supabase.from("bookings").update({
      refund_status: "DECLINED",
      refund_notes: "Refund declined by admin",
    }).eq("id", id);
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
      title: "Process all refunds",
      message: `Process all ${refunds.length} pending refunds through Yoco? Customers will be notified as each refund completes.`,
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
          <p className="mt-2 text-[13px]" style={{ color: "var(--ck-text-muted)" }}>Approve, adjust, or decline pending refund requests.</p>
        </div>
        {refunds.length > 1 && (
          <button onClick={refundAll} className="ui-btn ui-btn-danger w-full sm:w-auto">
            <ArrowCounterClockwise size={15} weight="bold" /> Refund All ({refunds.length})
          </button>
        )}
      </div>

      {refunds.length > 0 && (
        <div className="anim-fade-up anim-d1 grid grid-cols-2 gap-3 sm:max-w-md">
          <div className="ui-card p-4">
            <div className="mb-2 flex items-center gap-2.5">
              <span className="ui-icon-chip" style={{ background: "var(--ck-amber-soft)", color: "var(--ck-amber)" }}>
                <Receipt size={18} weight="fill" />
              </span>
              <span className="ui-mono-label !text-[10px]">Pending</span>
            </div>
            <p className="font-display text-[28px] font-semibold leading-none tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{refunds.length}</p>
          </div>
          <div className="ui-card p-4">
            <div className="mb-2 flex items-center gap-2.5">
              <span className="ui-icon-chip" style={{ background: "var(--ck-danger-soft)", color: "var(--ck-danger)" }}>
                <CurrencyCircleDollar size={18} weight="fill" />
              </span>
              <span className="ui-mono-label !text-[10px]">To Refund</span>
            </div>
            <p className="font-display text-[28px] font-semibold leading-none tabular-nums" style={{ color: "var(--ck-text-strong)" }}>R{totalRefund.toLocaleString()}</p>
          </div>
        </div>
      )}

      {refunds.length === 0 ? (
        <div className="ui-card">
          <div className="ui-empty">
            <span className="ui-icon-chip"><Receipt size={19} /></span>
            <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No pending refunds</p>
            <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Refund requests awaiting action will appear here.</p>
          </div>
        </div>
      ) : (
        <div className="anim-fade-up anim-d2 space-y-3">
          {refunds.map((b: any) => {
            const res = results[b.id];
            const isProcessing = processing === b.id;
            const hasCheckout = !!b.yoco_checkout_id;
            return (
              <div key={b.id} className="ui-card p-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="flex-1">
                    <p className="font-semibold" style={{ color: "var(--ck-text-strong)" }}>{b.customer_name} <span className="font-mono text-xs" style={{ color: "var(--ck-text-muted)" }}>({b.id.substring(0, 8).toUpperCase()})</span></p>
                    <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>{b.tours?.name} · {b.slots?.start_time ? fmtTime(b.slots.start_time) : "-"} · {b.qty} pax</p>
                    <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>{b.phone} · {b.email}</p>
                    {b.cancellation_reason && <p className="mt-1 text-xs" style={{ color: "var(--ck-text-muted)" }}>Reason: {b.cancellation_reason}</p>}
                    {!hasCheckout && <p className="mt-1 text-xs" style={{ color: "var(--ck-warning)" }}>No Yoco checkout ID — manual refund only</p>}
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="sm:text-right">
                      <div className="flex items-center gap-1 sm:justify-end">
                        <span className="text-lg font-bold" style={{ color: "var(--ck-danger)" }}>R</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max={Number(b.total_amount || 0)}
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
                      {hasCheckout && (
                        <button onClick={() => autoRefund(b.id)} disabled={isProcessing}
                          className="ui-btn ui-btn-danger whitespace-nowrap disabled:opacity-40">
                          {isProcessing ? "Processing..." : "Auto Refund"}
                        </button>
                      )}
                      <button onClick={() => manualRefund(b.id)}
                        className="ui-btn ui-btn-ghost whitespace-nowrap">
                        Manual
                      </button>
                      <button onClick={() => declineRefund(b.id)} disabled={isProcessing}
                        className="ui-btn ui-btn-ghost whitespace-nowrap disabled:opacity-40" style={{ color: "var(--ck-text-muted)" }}>
                        Decline
                      </button>
                    </div>
                  </div>
                </div>
                {res && (
                  <div className="mt-3 rounded-lg p-3 text-sm" style={res.ok ? { background: "var(--ck-success-soft)", color: "var(--ck-success)" } : { background: "var(--ck-danger-soft)", color: "var(--ck-danger)" }}>
                    {res.ok ? "Refund processed — customer notified via WhatsApp & email" : (res.error || res.message || "Failed")}
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
                <span className={"ui-status " + (b.refund_status === "PROCESSED" ? "ui-pill-success" : b.refund_status === "DECLINED" ? "ui-pill-neutral" : "ui-pill-danger")}>
                  {b.refund_status === "PROCESSED" ? "Refunded" : b.refund_status === "DECLINED" ? "Declined" : "Failed"}
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
