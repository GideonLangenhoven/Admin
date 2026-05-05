"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useBusinessContext } from "../../components/BusinessContext";
import { confirmAction, notify } from "../lib/app-notify";

type Plan = {
  name: string;
  monthly_price_zar: number;
  extra_seat_price_zar: number;
  included_seats: number;
};

type Subscription = {
  id: string;
  status: "ACTIVE" | "PAUSED" | "CANCELLED" | "SUSPENDED" | "TRIAL";
  seats_purchased: number;
  billing_cycle_start: string;
  billing_cycle_end: string;
  paused_at: string | null;
  resumed_at: string | null;
  payment_method_last4: string | null;
  payment_provider: string | null;
  plans: Plan | null;
};

type LineItem = {
  id: string;
  invoice_period_start: string;
  invoice_period_end: string;
  line_type: string;
  quantity: number;
  unit_amount_zar: number;
  total_amount_zar: number;
  billing_status: string;
  created_at: string;
};

export default function BillingPage() {
  const { businessId } = useBusinessContext();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [usedSeats, setUsedSeats] = useState(0);
  const [monthly, setMonthly] = useState(0);
  const [history, setHistory] = useState<LineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};

    const [subRes, histRes] = await Promise.all([
      fetch("/api/billing/subscription", { headers }),
      fetch("/api/billing/history", { headers }),
    ]);

    if (subRes.ok) {
      const data = await subRes.json();
      setSub(data.subscription);
      setUsedSeats(data.used_seats);
      setMonthly(data.monthly_total_zar);
    }
    if (histRes.ok) {
      const data = await histRes.json();
      setHistory(data.line_items ?? []);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [businessId]);

  async function authHeaders() {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }

  async function changeSeats(delta: number) {
    if (!sub) return;
    setError(null);

    const seatPrice = sub.plans?.extra_seat_price_zar ?? 750;
    const action = delta > 0 ? "add" : "remove";
    const today = new Date();
    const cycleEnd = new Date(sub.billing_cycle_end);
    const daysLeft = Math.max(0, Math.ceil((cycleEnd.getTime() - today.getTime()) / 86_400_000));
    const cycleStart = new Date(sub.billing_cycle_start);
    const totalDays = Math.max(1, Math.ceil((cycleEnd.getTime() - cycleStart.getTime()) / 86_400_000));
    const estProration = Math.round(seatPrice * (daysLeft / totalDays) * Math.abs(delta) * 100) / 100;

    const confirmed = await confirmAction({
      title: `${delta > 0 ? "Add" : "Remove"} ${Math.abs(delta)} seat`,
      message: delta > 0
        ? `Adding ${Math.abs(delta)} seat = R${seatPrice}/mo extra. Prorated charge for the rest of this billing period: ~R${estProration}.`
        : `Removing ${Math.abs(delta)} seat. Prorated credit for the rest of this period: ~R${estProration}.`,
      tone: delta > 0 ? "info" : "warning",
      confirmLabel: delta > 0 ? "Add seat" : "Remove seat",
    });
    if (!confirmed) return;

    setActionLoading(true);
    const r = await fetch("/api/billing/seats", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ delta }),
    });
    const data = await r.json();
    setActionLoading(false);

    if (!r.ok) { setError(data.error); return; }
    notify({ title: "Seats updated", message: `Now at ${data.new_seats} seat(s). Proration: R${data.proration_zar}`, tone: "success" });
    load();
  }

  async function pauseSubscription() {
    setError(null);
    const confirmed = await confirmAction({
      title: "Pause subscription",
      message: "Pause your subscription for off-season? Your team can still sign in and view data, but new bookings, marketing, and broadcasts will be disabled. You won't be billed while paused. Resume any time.",
      tone: "warning",
      confirmLabel: "Pause subscription",
    });
    if (!confirmed) return;

    setActionLoading(true);
    const r = await fetch("/api/billing/pause", { method: "POST", headers: await authHeaders() });
    const data = await r.json();
    setActionLoading(false);

    if (!r.ok) { setError(data.error); return; }
    notify({ title: "Subscription paused", message: "You won't be billed until you resume.", tone: "success" });
    load();
  }

  async function resumeSubscription() {
    setError(null);
    setActionLoading(true);
    const r = await fetch("/api/billing/resume", { method: "POST", headers: await authHeaders() });
    const data = await r.json();
    setActionLoading(false);

    if (!r.ok) { setError(data.error); return; }
    notify({ title: "Subscription resumed", message: "You're back in action. Billing resumes this cycle.", tone: "success" });
    load();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
      </div>
    );
  }

  if (!sub) {
    return (
      <div className="p-6 max-w-3xl">
        <h1 className="text-2xl font-bold" style={{ color: "var(--ck-text-strong)" }}>Billing</h1>
        <p className="mt-4 text-sm" style={{ color: "var(--ck-text-muted)" }}>No subscription configured. Contact support.</p>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    ACTIVE: "bg-emerald-100 text-emerald-800",
    PAUSED: "bg-amber-100 text-amber-800",
    CANCELLED: "bg-red-100 text-red-800",
    SUSPENDED: "bg-red-100 text-red-800",
    TRIAL: "bg-blue-100 text-blue-800",
  };

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold" style={{ color: "var(--ck-text-strong)" }}>Billing</h1>

      {/* Current Plan */}
      <section className="p-5 rounded-xl border" style={{ background: "var(--ck-surface)", borderColor: "var(--ck-border)" }}>
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold" style={{ color: "var(--ck-text-strong)" }}>Current plan</h2>
          <span className={`text-xs px-2 py-1 rounded font-medium ${statusColors[sub.status] || "bg-gray-100 text-gray-800"}`}>
            {sub.status}
          </span>
        </div>
        <p className="mt-1 text-3xl font-bold" style={{ color: "var(--ck-text-strong)" }}>{sub.plans?.name ?? "Custom"}</p>
        <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>
          R{sub.plans?.monthly_price_zar ?? 0}/month base · R{sub.plans?.extra_seat_price_zar ?? 0}/extra seat
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="p-3 rounded-lg" style={{ background: "var(--ck-bg)" }}>
            <div className="text-xs font-medium" style={{ color: "var(--ck-text-muted)" }}>Seats purchased</div>
            <div className="text-2xl font-bold mt-0.5" style={{ color: "var(--ck-text-strong)" }}>{sub.seats_purchased}</div>
            <div className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{usedSeats} active admin{usedSeats !== 1 ? "s" : ""}</div>
          </div>
          <div className="p-3 rounded-lg" style={{ background: "var(--ck-bg)" }}>
            <div className="text-xs font-medium" style={{ color: "var(--ck-text-muted)" }}>This month</div>
            <div className="text-2xl font-bold mt-0.5" style={{ color: "var(--ck-text-strong)" }}>R{monthly.toLocaleString()}</div>
            <div className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{sub.billing_cycle_start} → {sub.billing_cycle_end}</div>
          </div>
        </div>

        {sub.status === "ACTIVE" && (
          <div className="mt-4 flex gap-2 flex-wrap">
            <button
              onClick={() => changeSeats(+1)}
              disabled={actionLoading}
              className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              + Add seat (R{sub.plans?.extra_seat_price_zar ?? 750})
            </button>
            <button
              onClick={() => changeSeats(-1)}
              disabled={actionLoading || sub.seats_purchased <= 1 || usedSeats >= sub.seats_purchased}
              className="px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
              style={{ background: "var(--ck-bg)", color: "var(--ck-text)" }}
            >
              – Remove seat
            </button>
            <button
              onClick={pauseSubscription}
              disabled={actionLoading}
              className="ml-auto px-3 py-2 rounded-lg bg-amber-100 text-amber-900 text-sm font-medium hover:bg-amber-200 disabled:opacity-50 transition-colors"
            >
              Pause for off-season
            </button>
          </div>
        )}

        {sub.status === "PAUSED" && (
          <div className="mt-4 flex items-center gap-3">
            <span className="text-sm" style={{ color: "var(--ck-text-muted)" }}>
              Subscription paused{sub.paused_at ? ` since ${new Date(sub.paused_at).toLocaleDateString("en-ZA")}` : ""}.
              No billing while paused.
            </span>
            <button
              onClick={resumeSubscription}
              disabled={actionLoading}
              className="ml-auto px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              Resume now
            </button>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600 font-medium">{error}</p>}
      </section>

      {/* Payment Method */}
      <section className="p-5 rounded-xl border" style={{ background: "var(--ck-surface)", borderColor: "var(--ck-border)" }}>
        <h2 className="text-lg font-bold" style={{ color: "var(--ck-text-strong)" }}>Payment method</h2>
        <p className="text-sm mt-1" style={{ color: "var(--ck-text-muted)" }}>
          {sub.payment_method_last4
            ? <>Card ending in <strong>{sub.payment_method_last4}</strong> via {sub.payment_provider}</>
            : "No card on file — invoices are sent manually. Contact support to set up automatic payments."}
        </p>
      </section>

      {/* Billing History */}
      <section className="p-5 rounded-xl border" style={{ background: "var(--ck-surface)", borderColor: "var(--ck-border)" }}>
        <h2 className="text-lg font-bold" style={{ color: "var(--ck-text-strong)" }}>Billing history</h2>
        {history.length === 0 ? (
          <p className="text-sm mt-2" style={{ color: "var(--ck-text-muted)" }}>No billing records yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs" style={{ color: "var(--ck-text-muted)" }}>
                  <th className="pb-2 pr-3">Period</th>
                  <th className="pb-2 pr-3">Type</th>
                  <th className="pb-2 pr-3">Qty</th>
                  <th className="pb-2 pr-3">Amount</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t" style={{ borderColor: "var(--ck-border)" }}>
                    <td className="py-2 pr-3" style={{ color: "var(--ck-text)" }}>{h.invoice_period_start || "—"}</td>
                    <td className="py-2 pr-3" style={{ color: "var(--ck-text)" }}>{h.line_type || "—"}</td>
                    <td className="py-2 pr-3" style={{ color: "var(--ck-text)" }}>{h.quantity}</td>
                    <td className="py-2 pr-3 font-medium" style={{ color: "var(--ck-text-strong)" }}>R{h.total_amount_zar}</td>
                    <td className="py-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        h.billing_status === "PAID" ? "bg-emerald-100 text-emerald-700" :
                        h.billing_status === "PENDING" ? "bg-amber-100 text-amber-700" :
                        "bg-gray-100 text-gray-700"
                      }`}>{h.billing_status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
