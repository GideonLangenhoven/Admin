"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { getAdminTimezone } from "../lib/admin-timezone";
import { useBusinessContext } from "../../components/BusinessContext";

const SU = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SK = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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
      .in("refund_status", ["REQUESTED", "ACTION_REQUIRED"])
      .order("cancelled_at", { ascending: false });
    setRefunds(pending || []);

    const { data: done } = await supabase.from("bookings")
      .select("id, customer_name, phone, email, qty, total_amount, refund_status, refund_amount, refund_notes, cancelled_at, slots(start_time), tours(name)")
      .eq("business_id", businessId)
      .in("refund_status", ["PROCESSED", "FAILED"])
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
      const r = await fetch(SU + "/functions/v1/process-refund", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + SK },
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
    for (const r of refunds) {
      setProcessing(r.id);
      try {
        const res = await fetch(SU + "/functions/v1/process-refund", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + SK },
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

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" /></div>;

  const totalRefund = refunds.reduce((sum, b) => sum + Number(b.refund_amount || 0), 0);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Refund Queue</h2>
          <p className="text-sm text-gray-500 mt-1">{refunds.length} pending · R{totalRefund.toLocaleString()}</p>
        </div>
        {refunds.length > 1 && (
          <button onClick={refundAll}
            className="w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 sm:w-auto">
            Refund All ({refunds.length})
          </button>
        )}
      </div>

      {refunds.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">No pending refunds</div>
      ) : (
        <div className="space-y-3">
          {refunds.map((b: any) => {
            const res = results[b.id];
            const isProcessing = processing === b.id;
            const hasCheckout = !!b.yoco_checkout_id;
            return (
              <div key={b.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="flex-1">
                    <p className="font-semibold">{b.customer_name} <span className="text-gray-400 font-mono text-xs">({b.id.substring(0, 8).toUpperCase()})</span></p>
                    <p className="text-sm text-gray-500">{b.tours?.name} · {b.slots?.start_time ? fmtTime(b.slots.start_time) : "-"} · {b.qty} pax</p>
                    <p className="text-sm text-gray-500">{b.phone} · {b.email}</p>
                    {b.cancellation_reason && <p className="text-xs text-gray-400 mt-1">Reason: {b.cancellation_reason}</p>}
                    {!hasCheckout && <p className="text-xs text-amber-600 mt-1">No Yoco checkout ID — manual refund only</p>}
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="sm:text-right">
                      <div className="flex items-center gap-1 sm:justify-end">
                        <span className="text-lg font-bold text-red-600">R</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max={Number(b.total_amount || 0)}
                          value={editedAmounts[b.id] !== undefined ? editedAmounts[b.id] : String(b.refund_amount || 0)}
                          onChange={e => setEditedAmounts({ ...editedAmounts, [b.id]: e.target.value })}
                          className="w-28 text-right text-2xl font-bold text-red-600 border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 bg-red-50/50"
                        />
                      </div>
                      {Number(b.total_amount || 0) > 0 && (
                        <p className="text-[11px] text-gray-400 mt-1">
                          of R{Number(b.total_amount).toFixed(2)} paid
                          {editedAmounts[b.id] !== undefined && parseFloat(editedAmounts[b.id]) < Number(b.total_amount) && (
                            <span className="ml-1 text-amber-600 font-medium">(partial)</span>
                          )}
                        </p>
                      )}
                      <p className="text-xs text-gray-400">{b.refund_notes}</p>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-col">
                      {hasCheckout && (
                        <button onClick={() => autoRefund(b.id)} disabled={isProcessing}
                          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 whitespace-nowrap">
                          {isProcessing ? "Processing..." : "Auto Refund"}
                        </button>
                      )}
                      <button onClick={() => manualRefund(b.id)}
                        className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 whitespace-nowrap">
                        Manual
                      </button>
                    </div>
                  </div>
                </div>
                {res && (
                  <div className={"text-sm p-3 rounded-lg mt-3 " + (res.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700")}>
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
          className="text-sm text-gray-500 hover:text-gray-800 font-medium">
          {showProcessed ? "▼" : "▶"} Processed Refunds ({processed.length})
        </button>
        {showProcessed && (
          <div className="space-y-2 mt-3">
            {processed.map((b: any) => (
              <div key={b.id} className="flex flex-col gap-2 rounded-xl border border-gray-100 bg-gray-50 p-3 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <p className="font-medium text-sm">{b.customer_name} <span className="text-gray-400 font-mono text-xs">({b.id.substring(0, 8).toUpperCase()})</span></p>
                  <p className="text-xs text-gray-400">{b.tours?.name} · {b.slots?.start_time ? fmtTime(b.slots.start_time) : "-"}</p>
                </div>
                <span className={"text-xs font-medium px-2 py-1 rounded-full " + (b.refund_status === "PROCESSED" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
                  {b.refund_status === "PROCESSED" ? "Refunded" : "Failed"}
                </span>
                <p className="text-sm font-semibold text-gray-600">R{b.refund_amount}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900">{confirmState.title}</h3>
            <p className="mt-2 text-sm text-gray-600">{confirmState.message}</p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmState(null)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { if (confirmState) void confirmState.onConfirm(); }}
                className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
                  confirmState?.tone === "danger" ? "bg-red-600 hover:bg-red-700" : "bg-gray-900 hover:bg-gray-800"
                }`}
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
