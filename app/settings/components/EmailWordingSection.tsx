"use client";
import { useState } from "react";
import { supabase } from "../../lib/supabase";

export type EmailOverride = { subject?: string; heading?: string; message?: string };
export type EmailOverrides = Record<string, EmailOverride>;

// Keep in sync with CUSTOMISABLE_EMAILS in supabase/functions/send-email/index.ts.
// `message: false` = the email has no main paragraph to replace.
const EMAIL_WORDING: { key: string; label: string; message?: false }[] = [
  { key: "BOOKING_CONFIRM", label: "Booking confirmation" },
  { key: "TRIP_PHOTOS", label: "Thank you / trip photos" },
  { key: "PAYMENT_LINK", label: "Payment link" },
  { key: "PAYMENT_REMINDER", label: "Payment reminder" },
  { key: "PAYMENT_EXPIRING", label: "Payment link expiring" },
  { key: "PAYMENT_FAILED", label: "Payment unsuccessful" },
  { key: "BOOKING_UPDATED", label: "Booking updated" },
  { key: "RESCHEDULE_PAYMENT_LINK", label: "Reschedule payment" },
  { key: "CANCELLATION", label: "Cancellation" },
  { key: "REMINDER", label: "Trip reminder" },
  { key: "FIRST_BOOKING_TRIP", label: "Upcoming trip (first booking)" },
  { key: "INDEMNITY", label: "Trip details & waiver" },
  { key: "WAIVER_REQUEST", label: "Waiver request" },
  { key: "INVOICE", label: "Invoice", message: false },
  { key: "VOUCHER", label: "Voucher code" },
  { key: "VOUCHER_BALANCE", label: "Voucher balance" },
  { key: "VOUCHER_PAYMENT_LINK", label: "Gift voucher payment link" },
  { key: "GIFT_VOUCHER", label: "Gift voucher (to buyer)" },
  { key: "GIFT_VOUCHER_RECIPIENT", label: "Gift voucher (to recipient)" },
];

export default function EmailWordingSection({ businessId, value, onChange }: { businessId: string; value: EmailOverrides; onChange: (next: EmailOverrides) => void }) {
  const [key, setKey] = useState(EMAIL_WORDING[0].key);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const item = EMAIL_WORDING.find((e) => e.key === key)!;
  const current = value[key] || {};
  const set = (field: keyof EmailOverride, text: string) => onChange({ ...value, [key]: { ...current, [field]: text } });

  async function showPreview(forKey = key) {
    setLoading(true);
    setError("");
    const { data, error: err } = await supabase.functions.invoke("send-email", {
      body: { type: forKey, preview: true, data: { business_id: businessId }, overrides: value },
    });
    setLoading(false);
    if (err || !data?.html) { setError("Preview unavailable right now. Try again."); setPreview(null); return; }
    setPreview({ subject: String(data.subject || ""), html: String(data.html) });
  }

  const field = "ui-control w-full px-3 py-2 text-sm rounded-lg outline-none";
  return (
    <div className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5 space-y-4">
      <div>
        <span className="text-sm font-semibold text-[var(--ck-text-strong)]">Email wording</span>
        <p className="text-xs text-[var(--ck-text-muted)] mt-0.5">
          Reword any email customers receive. Leave a box blank to keep the standard wording. You can use {"{customer_name}"}, {"{tour_name}"}, {"{ref}"} and {"{business_name}"}. Booking details, buttons and links are always included.
        </p>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-[var(--ck-text-muted)]">Email</span>
        <select value={key} onChange={(e) => { setKey(e.target.value); if (preview) showPreview(e.target.value); }} className={field + " mt-1"}>
          {EMAIL_WORDING.map((e) => (
            <option key={e.key} value={e.key}>{e.label}{value[e.key] && Object.values(value[e.key]).some((v) => v?.trim()) ? " (customised)" : ""}</option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-xs font-medium text-[var(--ck-text-muted)]">Subject line</span>
          <input type="text" maxLength={200} value={current.subject || ""} onChange={(e) => set("subject", e.target.value)} className={field + " mt-1"} placeholder="Standard subject" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-[var(--ck-text-muted)]">Heading</span>
          <input type="text" maxLength={120} value={current.heading || ""} onChange={(e) => set("heading", e.target.value)} className={field + " mt-1"} placeholder="Standard heading" />
        </label>
      </div>
      {item.message !== false && (
        <label className="block">
          <span className="text-xs font-medium text-[var(--ck-text-muted)]">Main message</span>
          <textarea rows={4} maxLength={2000} value={current.message || ""} onChange={(e) => set("message", e.target.value)} className={field + " mt-1"}
            placeholder="Standard message. Your text replaces the main paragraph under the greeting." />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => showPreview()} disabled={loading || !businessId}
          className="px-3 py-2 text-sm rounded-lg border border-[var(--ck-border-subtle)] text-[var(--ck-text-strong)] hover:border-[var(--ck-accent)] disabled:opacity-50">
          {loading ? "Loading preview…" : preview ? "Refresh preview" : "Preview email"}
        </button>
        {Object.values(current).some((v) => v?.trim()) && (
          <button type="button" onClick={() => onChange({ ...value, [key]: {} })}
            className="px-3 py-2 text-sm rounded-lg border border-[var(--ck-border-subtle)] text-[var(--ck-text-muted)] hover:text-[var(--ck-danger)] hover:border-[var(--ck-danger)]">
            Reset to standard wording
          </button>
        )}
      </div>
      {error && <p className="text-xs text-[var(--ck-danger)]">{error}</p>}
      {preview && (
        <div className="rounded-xl border border-[var(--ck-border-subtle)] overflow-hidden">
          <p className="px-3 py-2 text-xs border-b border-[var(--ck-border-subtle)] text-[var(--ck-text-muted)]">
            Subject: <span className="text-[var(--ck-text-strong)]">{preview.subject}</span> · Sample booking, unsaved changes included. Nothing is sent.
          </p>
          <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="w-full h-[640px] bg-white" />
        </div>
      )}
    </div>
  );
}
