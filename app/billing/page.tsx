"use client";
import { useEffect, useState } from "react";
import { getAuthHeaders } from "../lib/admin-auth";
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
  plans: Plan | null;
};

type EmailUsage = {
  overage_emails: number;
  overage_rate_zar: number;
  overage_charge_zar: number;
};

export default function BillingPage() {
  const { businessId } = useBusinessContext();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [usedSeats, setUsedSeats] = useState(0);
  const [monthly, setMonthly] = useState(0);
  const [emailUsage, setEmailUsage] = useState<EmailUsage | null>(null);
  const [plansAvailable, setPlansAvailable] = useState<Array<{ id: string; name: string; monthly_price_zar: number; extra_seat_price_zar: number; included_seats: number; current: boolean }>>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const headers = await getAuthHeaders(businessId);

    const subRes = await fetch("/api/billing/subscription", { headers });

    if (subRes.ok) {
      const data = await subRes.json();
      setSub(data.subscription);
      setUsedSeats(data.used_seats);
      setMonthly(data.monthly_total_zar);
      setEmailUsage(data.email_usage ?? null);
      setPlansAvailable(data.plans_available ?? []);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [businessId]);

  async function authHeaders() {
    return getAuthHeaders(businessId);
  }

  async function changeSeats(delta: number) {
    if (!sub) return;
    setError(null);

    const seatPrice = sub.plans?.extra_seat_price_zar ?? 500;
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

  async function changePlan(planId: string, planName: string, planPrice: number) {
    if (!sub) return;
    setError(null);
    const upgrading = planPrice > (sub.plans?.monthly_price_zar ?? 0);
    const confirmed = await confirmAction({
      title: `Switch to ${planName}`,
      message: `Change your plan to ${planName} (R${planPrice.toLocaleString()}/month base)? The ${upgrading ? "extra" : "difference"} is prorated for the rest of this billing period. Included seats adjust automatically.`,
      tone: "info",
      confirmLabel: `Switch to ${planName}`,
    });
    if (!confirmed) return;

    setActionLoading(true);
    const r = await fetch("/api/billing/plan", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ plan_id: planId }),
    });
    const data = await r.json();
    setActionLoading(false);
    if (!r.ok) { setError(data.error); return; }
    notify({ title: "Plan changed", message: `You're now on ${planName}. Proration: R${data.proration_zar ?? 0}`, tone: "success" });
    load();
  }

  async function pauseSubscription() {
    setError(null);
    const confirmed = await confirmAction({
      title: "Pause subscription",
      message: "Pause billing? Your team can view data, but new bookings, marketing and broadcasts stop. Resume any time.",
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
    notify({ title: "Subscription resumed", message: "Subscription resumed. Billing restarts this cycle.", tone: "success" });
    load();
  }

  if (loading) {
    return (
      <div className="max-w-3xl space-y-6">
        <div className="space-y-2.5">
          <div className="ui-skeleton h-3 w-24" />
          <div className="ui-skeleton h-8 w-40" />
        </div>
        <div className="ui-skeleton h-[230px] !rounded-2xl" />
        <div className="ui-skeleton h-[150px] !rounded-2xl" />
        <div className="ui-skeleton h-[120px] !rounded-2xl" />
      </div>
    );
  }

  if (!sub) {
    return (
      <div className="max-w-3xl space-y-4">
        <div>
          <h2 className="font-display text-[28px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Billing</h2>
        </div>
        <div className="ui-card p-5">
          <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>No subscription configured. Contact support.</p>
        </div>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    ACTIVE: "ui-pill-success",
    PAUSED: "ui-pill-warning",
    CANCELLED: "ui-pill-danger",
    SUSPENDED: "ui-pill-danger",
    TRIAL: "ui-pill-accent",
  };
  const alternativePlans = [...new Map(plansAvailable.filter(p => !p.current && !(
    p.name.trim().toLowerCase() === sub.plans?.name.trim().toLowerCase()
    && p.monthly_price_zar === sub.plans?.monthly_price_zar && p.included_seats === sub.plans?.included_seats
    && p.extra_seat_price_zar === sub.plans?.extra_seat_price_zar
  )).map(p => [`${p.name.trim().toLowerCase()}:${p.monthly_price_zar}:${p.included_seats}:${p.extra_seat_price_zar}`, p])).values()];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="font-display text-[28px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Billing</h2>
      </div>

      {/* Current Plan */}
      <section className="ui-card p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="ui-mono-label">Current plan</h2>
          <span className={`ui-status ${statusColors[sub.status] || "ui-pill-neutral"}`}>
            {sub.status}
          </span>
        </div>
        <p className="mt-2 font-display text-[32px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}>{sub.plans?.name ?? "Custom"}</p>
        <p className="text-sm mt-1.5" style={{ color: "var(--ck-text-muted)" }}>
          R{sub.plans?.monthly_price_zar ?? 2000}/month base · R{sub.plans?.extra_seat_price_zar ?? 500}/additional seat
        </p>

        {(sub.status === "ACTIVE" || sub.status === "TRIAL") && alternativePlans.length > 0 && (
          <div className="mt-4">
            <div className="ui-mono-label mb-2">Change plan</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {alternativePlans.map((p) => (
                <button data-demo-action="billing.plan"
                  key={p.id}
                  onClick={() => changePlan(p.id, p.name, p.monthly_price_zar)}
                  disabled={actionLoading}
                  className="p-3 rounded-[10px] border text-left transition-colors disabled:cursor-default hover:border-[var(--ck-accent)]"
                  style={{
                    background: "var(--ck-surface-sunken)",
                    borderColor: "var(--ck-border-subtle)",
                  }}
                >
                  <div className="font-semibold text-sm" style={{ color: "var(--ck-text-strong)" }}>{p.name}</div>
                  <div className="text-xs mt-0.5 tabular-nums" style={{ color: "var(--ck-text-muted)" }}>R{p.monthly_price_zar.toLocaleString()}/mo · {p.included_seats} seat{p.included_seats !== 1 ? "s" : ""}</div>
                  <div className="ui-mono-label mt-1.5" style={{ color: "var(--ck-text-muted)" }}>Switch</div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="p-3 rounded-[10px] border" style={{ background: "var(--ck-surface-sunken)", borderColor: "var(--ck-border-subtle)" }}>
            <div className="ui-mono-label">Seats purchased</div>
            <div className="font-display text-[28px] font-semibold mt-1 leading-none tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{sub.seats_purchased}</div>
            <div className="text-xs mt-1.5" style={{ color: "var(--ck-text-muted)" }}>{usedSeats} active admin{usedSeats !== 1 ? "s" : ""}</div>
          </div>
          <div className="p-3 rounded-[10px] border" style={{ background: "var(--ck-surface-sunken)", borderColor: "var(--ck-border-subtle)" }}>
            <div className="ui-mono-label">This month</div>
            <div className="font-display text-[28px] font-semibold mt-1 leading-none tabular-nums" style={{ color: "var(--ck-text-strong)" }}>R{monthly.toLocaleString()}</div>
            <div className="text-xs mt-1.5 tabular-nums break-words" style={{ color: "var(--ck-text-muted)" }}>{sub.billing_cycle_start} → {sub.billing_cycle_end}</div>
          </div>
        </div>

        {sub.status === "ACTIVE" && (
          <div className="mt-4 flex gap-2 flex-wrap">
            <button data-demo-action="billing.add"
              onClick={() => changeSeats(+1)}
              disabled={actionLoading}
              className="ui-btn ui-btn-primary disabled:opacity-50"
            >
              + Add seat (R{sub.plans?.extra_seat_price_zar ?? 500})
            </button>
            <button data-demo-action="billing.remove"
              onClick={() => changeSeats(-1)}
              disabled={actionLoading || sub.seats_purchased <= 1 || usedSeats >= sub.seats_purchased}
              className="ui-btn ui-btn-ghost disabled:opacity-50"
            >
              – Remove seat
            </button>
            <button data-demo-action="billing.pause"
              onClick={pauseSubscription}
              disabled={actionLoading}
              className="ui-btn ui-btn-ghost sm:ml-auto disabled:opacity-50"
            >
              Pause for off-season
            </button>
          </div>
        )}

        {sub.status === "PAUSED" && (
          <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <span className="text-sm" style={{ color: "var(--ck-text-muted)" }}>
              Subscription paused{sub.paused_at ? ` since ${new Date(sub.paused_at).toLocaleDateString("en-ZA")}` : ""}.
              No billing while paused.
            </span>
            <button data-demo-action="billing.resume"
              onClick={resumeSubscription}
              disabled={actionLoading}
              className="ui-btn ui-btn-primary sm:ml-auto disabled:opacity-50"
            >
              Resume now
            </button>
          </div>
        )}

        {error && <p className="mt-3 text-sm font-medium" style={{ color: "var(--ck-danger)" }}>{error}</p>}
      </section>

      {/* Marketing Email Usage (AB1) — was previously only in super-admin */}
      {emailUsage && (
        <section className="p-5 rounded-xl border" style={{ background: "var(--ck-surface)", borderColor: "var(--ck-border-subtle)" }}>
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-bold" style={{ color: "var(--ck-text-strong)" }}>Marketing email usage</h2>
            <span className="text-xs" style={{ color: "var(--ck-text-muted)" }}>this billing period</span>
          </div>
          <div className="mt-4 text-sm">
            <div className="p-3 rounded-lg" style={{ background: "var(--ck-bg)" }}>
              <div className="text-xs font-medium" style={{ color: "var(--ck-text-muted)" }}>Overage</div>
              <div className="text-2xl font-bold mt-0.5" style={{ color: emailUsage.overage_charge_zar > 0 ? "#b45309" : "var(--ck-text-strong)" }}>
                {emailUsage.overage_emails > 0
                  ? "R" + emailUsage.overage_charge_zar.toLocaleString()
                  : "R0"}
              </div>
              <div className="text-xs" style={{ color: "var(--ck-text-muted)" }}>
                {emailUsage.overage_emails > 0
                  ? emailUsage.overage_emails.toLocaleString() + " over @ R" + emailUsage.overage_rate_zar.toFixed(2) + "/email"
                  : "Under quota: no overage charge"}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
