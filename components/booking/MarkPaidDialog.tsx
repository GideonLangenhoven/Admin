"use client";

import { useState } from "react";
import { supabase } from "../../app/lib/supabase";
import { notify } from "../../app/lib/app-notify";
import { functionError } from "../../app/lib/function-error";

// M2: one Mark Paid step for the bookings list and the booking page. The
// operator confirms the amount actually received (a deposit is fine), how it
// was paid and an optional reference; the server records it and tells the
// guest once: their confirmation if the booking was still pending, otherwise
// a receipt.
export type MarkPaidBooking = {
  id: string;
  customer_name?: string | null;
  email?: string | null;
  status: string;
  total_amount: number | null;
  total_captured?: number | null;
};

const METHODS = [
  { value: "Cash", label: "Cash" },
  { value: "EFT", label: "EFT (bank transfer)" },
  { value: "Card (terminal)", label: "Card machine" },
  { value: "Other", label: "Other" },
];

const NOTIFIED: Record<string, string> = {
  confirmation: "Booking confirmation email queued.",
  receipt: "Receipt email queued.",
  whatsapp: "Guest notified on WhatsApp.",
  whatsapp_failed: "The WhatsApp message to the guest failed.",
};

function rand(n: number) {
  return "R" + n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function MarkPaidDialog({ booking, onClose, onRecorded }: {
  booking: MarkPaidBooking;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const received = Number(booking.total_captured || 0);
  const due = Math.max(0, Math.round((Number(booking.total_amount || 0) - received) * 100) / 100);
  const [amount, setAmount] = useState(due.toFixed(2));
  const [method, setMethod] = useState("Cash");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = Number(amount.trim().replace(/\s/g, "").replace(",", "."));
  // Nothing due (a voucher covers it): confirm without an amount.
  const nothingDue = due <= 0;
  const amountError = nothingDue ? null : !amount.trim() ? "Enter the amount received."
    : !Number.isFinite(value) || value <= 0 || Math.abs(Math.round(value * 100) - value * 100) > 1e-6 ? "Enter the amount in rand and cents, for example 500.00."
      : value > due + 0.005 ? "That is more than the " + rand(due) + " still due."
        : null;
  const part = !nothingDue && !amountError && value < due - 0.005;
  const methodLabel = METHODS.find(m => m.value === method)?.label || method;
  const guestNotice = !booking.email ? "No email on file: the guest gets a WhatsApp message if WhatsApp is connected."
    : ["PENDING", "PENDING PAYMENT", "HELD"].includes(booking.status) ? "The guest is emailed their booking confirmation."
      : "The guest is emailed a receipt.";

  async function record() {
    if (amountError || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await supabase.functions.invoke("manual-mark-paid", {
        body: nothingDue ? { action: "mark_paid", booking_id: booking.id, expected_captured: received } : {
          action: "mark_paid", booking_id: booking.id, amount: Math.round(value * 100) / 100, payment_method: method,
          payment_reference: reference.trim() || undefined, expected_captured: received,
        },
      });
      const problem = await functionError(res, "The payment could not be recorded. Please try again.");
      if (problem) {
        setError(problem);
        notify({ title: "Payment not recorded", message: problem, tone: "error" });
        return;
      }
      const out = (res.data || {}) as { already_paid?: boolean; amount?: number; balance_due?: number; paid_in_full?: boolean; notified?: string; warning?: string };
      if (out.already_paid) {
        notify({ title: "Already paid", message: "This booking was already marked paid.", tone: "info" });
      } else {
        const message = [
          nothingDue ? "" : rand(Number(out.amount || 0)) + " by " + methodLabel + ".",
          out.paid_in_full ? "The booking is paid in full." : rand(Number(out.balance_due || 0)) + " still due.",
          out.warning || NOTIFIED[out.notified || ""] || "",
        ].filter(Boolean).join(" ");
        notify({ title: "Payment recorded", message, tone: out.warning || out.notified === "whatsapp_failed" ? "warning" : "success" });
      }
      onRecorded();
      onClose();
    } catch {
      const message = "The payment could not be recorded. Check your connection and try again.";
      setError(message);
      notify({ title: "Payment not recorded", message, tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="mark-paid-title" className="ui-card w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain p-6">
        <h3 id="mark-paid-title" className="ui-title-md mb-1">Record a payment</h3>
        <p className="mb-4 text-xs" style={{ color: "var(--ck-text-muted)" }}>
          {booking.customer_name || "Guest"} · {booking.id.substring(0, 8).toUpperCase()} · {rand(due)} due{received > 0 ? " (" + rand(received) + " already received)" : ""}
        </p>
        <div className="space-y-3">
          {nothingDue ? (
            <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>Nothing is due. The booking will be marked paid.</p>
          ) : (
            <>
              <label className="block text-xs font-medium" style={{ color: "var(--ck-text)" }}>
                Amount received (R)
                <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} disabled={saving}
                  aria-invalid={!!amountError} aria-describedby="mark-paid-amount-help" className="ui-control mt-1 w-full" />
              </label>
              <p id="mark-paid-amount-help" role={amountError ? "alert" : undefined} className="text-xs" style={{ color: amountError ? "var(--ck-danger)" : "var(--ck-text-muted)" }}>
                {amountError || (part ? rand(due - value) + " will still be due. The booking stays confirmed." : "The booking will be marked paid.")}
              </p>
              <label className="block text-xs font-medium" style={{ color: "var(--ck-text)" }}>
                Payment method
                <select value={method} onChange={e => setMethod(e.target.value)} disabled={saving} className="ui-control mt-1 w-full">
                  {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </label>
              <label className="block text-xs font-medium" style={{ color: "var(--ck-text)" }}>
                Reference (optional)
                <input value={reference} onChange={e => setReference(e.target.value)} maxLength={80} disabled={saving}
                  placeholder="Bank reference or receipt number" className="ui-control mt-1 w-full" />
              </label>
            </>
          )}
          <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{guestNotice}</p>
          {error && <p role="alert" className="text-xs font-medium" style={{ color: "var(--ck-danger)" }}>{error}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="ui-btn ui-btn-ghost disabled:opacity-50">Cancel</button>
          <button type="button" onClick={record} disabled={saving || !!amountError} className="ui-btn ui-btn-primary disabled:opacity-50">
            {saving ? "Recording…" : nothingDue ? "Mark paid" : amountError ? "Record payment" : "Record " + rand(value)}
          </button>
        </div>
      </div>
    </div>
  );
}
