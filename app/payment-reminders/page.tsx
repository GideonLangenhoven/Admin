"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useBusinessContext } from "../../components/BusinessContext";

type Booking = {
  id: string;
  customer_name: string | null;
  email: string | null;
  phone: string | null;
  qty: number | null;
  total_amount: number | null;
  status: string;
  payment_url: string | null;
  allow_unpaid: boolean;
  tours: { name: string } | null;
  slots: { start_time: string } | null;
};

const UNPAID_STATUSES = ["PENDING", "CONFIRMED", "HELD"];

export default function PaymentReminders() {
  const { businessId } = useBusinessContext();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [cancelHours, setCancelHours] = useState(12);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const [{ data: biz }, { data: bk }] = await Promise.all([
      supabase.from("businesses").select("automation_config").eq("id", businessId).maybeSingle(),
      supabase
        .from("bookings")
        .select("id, customer_name, email, phone, qty, total_amount, status, payment_url, allow_unpaid, tours(name), slots!inner(start_time)")
        .eq("business_id", businessId)
        .in("status", UNPAID_STATUSES)
        .not("payment_url", "is", null)
        .gt("slots.start_time", new Date().toISOString())
        .order("start_time", { foreignTable: "slots", ascending: true })
        .limit(200),
    ]);
    const ac = (biz?.automation_config as Record<string, unknown>) || {};
    setEnabled(ac.payment_reminder_enabled === true); // opt-in (default off)
    setCancelHours(Number(ac.payment_reminder_cancel_hours ?? 12));
    setBookings((bk as unknown as Booking[]) || []);
    setLoading(false);
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  async function saveSettings() {
    if (!businessId) return;
    setSavingSettings(true);
    const { data: biz } = await supabase.from("businesses").select("automation_config").eq("id", businessId).maybeSingle();
    const ac = { ...((biz?.automation_config as Record<string, unknown>) || {}) };
    ac.payment_reminder_enabled = enabled;
    ac.payment_reminder_cancel_hours = Math.max(1, Number(cancelHours) || 12);
    await supabase.from("businesses").update({ automation_config: ac }).eq("id", businessId);
    setSavingSettings(false);
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 2000);
  }

  async function toggleOverride(b: Booking) {
    if (!businessId) return;
    setBusyId(b.id);
    const next = !b.allow_unpaid;
    await supabase.from("bookings").update({ allow_unpaid: next }).eq("id", b.id).eq("business_id", businessId);
    setBookings((prev) => prev.map((x) => (x.id === b.id ? { ...x, allow_unpaid: next } : x)));
    setBusyId(null);
  }

  const fmt = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleString("en-ZA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  // Frozen at mount: render must stay pure (react-hooks lint), and a
  // minutes-stale "cancels within Nh" warning is harmless.
  const [now] = useState(() => Date.now());
  const hoursUntil = (iso?: string | null) => (iso ? (new Date(iso).getTime() - now) / 3600000 : Infinity);

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--ck-text)]">Payment Reminders</h1>
        <p className="text-sm text-[var(--ck-text-muted)] mt-1">
          Guests with an upcoming trip who still owe payment get a friendly reminder with their payment link. If they still
          don&apos;t pay, the booking is automatically cancelled shortly before the trip so the spot is freed up — unless you
          allow it to go ahead unpaid.
        </p>
      </div>

      {/* Settings */}
      <div className="rounded-2xl border border-[var(--ck-border)] bg-[var(--ck-surface)] p-5 space-y-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 accent-[var(--ck-accent,#0F2B1F)]" />
          <span className="text-sm font-medium text-[var(--ck-text)]">Send payment reminders &amp; auto-cancel unpaid bookings</span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-[var(--ck-text-muted)]">Auto-cancel unpaid bookings</span>
          <input
            type="number" min={1} max={168} value={cancelHours}
            onChange={(e) => setCancelHours(Number(e.target.value))}
            disabled={!enabled}
            className="w-20 rounded-lg border border-[var(--ck-border)] px-3 py-1.5 text-sm bg-[var(--ck-bg)] text-[var(--ck-text)] disabled:opacity-50"
          />
          <span className="text-sm text-[var(--ck-text-muted)]">hours before the trip</span>
          <button
            onClick={saveSettings} disabled={savingSettings}
            className="ml-auto rounded-lg bg-[var(--ck-accent,#0F2B1F)] text-white px-4 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {savingSettings ? "Saving…" : savedTick ? "Saved ✓" : "Save"}
          </button>
        </div>
      </div>

      {/* Unpaid upcoming bookings */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--ck-text)] mb-2">Upcoming unpaid bookings ({bookings.length})</h2>
        {loading ? (
          <p className="text-sm text-[var(--ck-text-muted)] py-8 text-center">Loading…</p>
        ) : bookings.length === 0 ? (
          <p className="text-sm text-[var(--ck-text-muted)] py-8 text-center">No upcoming bookings with payment outstanding. 🎉</p>
        ) : (
          <div className="space-y-2">
            {bookings.map((b) => {
              const h = hoursUntil(b.slots?.start_time);
              const willCancelSoon = enabled && !b.allow_unpaid && h <= cancelHours;
              return (
                <div key={b.id} className="rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface)] p-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-[180px] flex-1">
                    <div className="text-sm font-medium text-[var(--ck-text)]">{b.customer_name || "Guest"}</div>
                    <div className="text-xs text-[var(--ck-text-muted)]">
                      {b.tours?.name || "Booking"} · {fmt(b.slots?.start_time)} · {b.qty} guest{Number(b.qty) === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="text-sm text-[var(--ck-text)] tabular-nums">
                    {b.total_amount != null ? "R" + Number(b.total_amount).toLocaleString("en-ZA") : ""}
                  </div>
                  {b.payment_url && (
                    <a href={b.payment_url} target="_blank" rel="noreferrer" className="text-xs font-medium text-[var(--ck-accent,#0F2B1F)] underline">
                      Payment link
                    </a>
                  )}
                  {b.allow_unpaid ? (
                    <span className="text-xs font-medium text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">Allowed unpaid</span>
                  ) : willCancelSoon ? (
                    <span className="text-xs font-medium text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">Cancels within {cancelHours}h</span>
                  ) : null}
                  <button
                    onClick={() => toggleOverride(b)} disabled={busyId === b.id}
                    className={`text-xs font-medium rounded-lg px-3 py-1.5 border disabled:opacity-50 ${
                      b.allow_unpaid
                        ? "border-[var(--ck-border)] text-[var(--ck-text-muted)]"
                        : "border-emerald-300 text-emerald-700 bg-emerald-50"
                    }`}
                  >
                    {busyId === b.id ? "…" : b.allow_unpaid ? "Require payment" : "Allow without payment"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
