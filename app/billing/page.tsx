"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useBusinessContext } from "../../components/BusinessContext";
import {
  fetchActiveSubscription,
  fetchPlans,
  fetchUsageSnapshot,
  formatZar,
  type PlanRow,
  type SubscriptionRow,
  type UsageSnapshot,
} from "../lib/billing";

type LandingPageOrder = {
  id: string;
  base_page_count: number;
  extra_page_count: number;
  build_total_zar: number;
  hosting_active: boolean;
  hosting_fee_zar: number;
  status: string;
  created_at: string;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export default function BillingPage() {
  const { businessId } = useBusinessContext();
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [activeSub, setActiveSub] = useState<SubscriptionRow | null>(null);
  const [landingOrders, setLandingOrders] = useState<LandingPageOrder[]>([]);

  const [targetPlan, setTargetPlan] = useState("");
  const [pagesRequested, setPagesRequested] = useState("1");
  const [hostingActive, setHostingActive] = useState(true);

  const pageCount = Math.max(1, Number(pagesRequested) || 1);
  const extraPages = Math.max(0, pageCount - 1);
  const buildTotal = 3500 + (extraPages * 1500);

  const activePlan = useMemo(
    () => plans.find((p) => p.id === (activeSub?.plan_id || usage?.plan_id || "")) || null,
    [plans, activeSub?.plan_id, usage?.plan_id],
  );

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError("");
    try {
      const [planRows, snapshot, sub, lpRows] = await Promise.all([
        fetchPlans(),
        fetchUsageSnapshot(businessId),
        fetchActiveSubscription(businessId),
        supabase
          .from("landing_page_orders")
          .select("id, base_page_count, extra_page_count, build_total_zar, hosting_active, hosting_fee_zar, status, created_at")
          .eq("business_id", businessId)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      if (lpRows.error) throw lpRows.error;

      setPlans(planRows);
      setUsage(snapshot);
      setActiveSub(sub);
      setLandingOrders((lpRows.data || []) as LandingPageOrder[]);
      setTargetPlan(sub?.plan_id || snapshot?.plan_id || planRows[0]?.id || "");
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function switchPlan() {
    if (!targetPlan || !businessId) return;
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const targetPlanRow = plans.find((p) => p.id === targetPlan);
      if (!targetPlanRow) throw new Error("Selected plan was not found.");

      const adminCountRes = await supabase
        .from("admin_users")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId);

      if (adminCountRes.error) throw adminCountRes.error;

      const adminCount = adminCountRes.count || 0;
      if (adminCount > targetPlanRow.seat_limit) {
        // Suspend the most recently added admins that exceed the new plan limit
        const excessCount = adminCount - targetPlanRow.seat_limit;
        const { data: excessAdmins, error: excessErr } = await supabase
          .from("admin_users")
          .select("id, email, name")
          .eq("business_id", businessId)
          .neq("role", "MAIN_ADMIN")
          .order("created_at", { ascending: false })
          .limit(excessCount);

        if (excessErr) throw excessErr;

        if (!excessAdmins || excessAdmins.length < excessCount) {
          throw new Error(
            `This business has ${adminCount} admins (including the main admin). ${targetPlanRow.name} allows ${targetPlanRow.seat_limit}. Cannot suspend enough non-main admins to fit the new plan.`
          );
        }

        const suspendIds = excessAdmins.map((a) => a.id);
        const { error: suspendErr } = await supabase
          .from("admin_users")
          .update({ suspended: true })
          .in("id", suspendIds);

        if (suspendErr) throw suspendErr;

        const suspendedNames = excessAdmins.map((a) => a.name || a.email).join(", ");
        setMessage(
          `Plan downgraded. The following admin(s) were suspended to fit the new seat limit: ${suspendedNames}. They can be re-activated if you upgrade.`
        );
      }

      const today = new Date().toISOString().slice(0, 10);

      const { error: closeErr } = await supabase
        .from("subscriptions")
        .update({ status: "INACTIVE", period_end: today })
        .eq("business_id", businessId)
        .eq("status", "ACTIVE");
      if (closeErr) throw closeErr;

      const { error: insertErr } = await supabase.from("subscriptions").insert({
        business_id: businessId,
        plan_id: targetPlan,
        status: "ACTIVE",
        period_start: today,
      });
      if (insertErr) throw insertErr;

      setMessage("Plan updated successfully.");
      await load();
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    }
    setWorking(false);
  }

  async function createLandingPageOrder() {
    if (!businessId) return;
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const { error: lpErr } = await supabase.from("landing_page_orders").insert({
        business_id: businessId,
        base_page_count: 1,
        extra_page_count: extraPages,
        build_total_zar: buildTotal,
        hosting_active: hostingActive,
        hosting_fee_zar: 500,
        status: "ACTIVE",
        metadata: { requested_pages: pageCount },
      });
      if (lpErr) throw lpErr;
      setMessage("Landing page order created.");
      await load();
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    }
    setWorking(false);
  }

  async function toggleHosting(order: LandingPageOrder) {
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const { error: updErr } = await supabase
        .from("landing_page_orders")
        .update({ hosting_active: !order.hosting_active })
        .eq("id", order.id);
      if (updErr) throw updErr;
      setMessage(`Hosting ${order.hosting_active ? "disabled" : "enabled"} for landing page order.`);
      await load();
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    }
    setWorking(false);
  }

  if (loading) return <div className="p-8 text-sm text-gray-500">Loading billing...</div>;

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">💼 Plans &amp; Billing</h1>
        <p className="text-sm text-gray-500">All features are included on every plan. Plans differ by included admin seats and are billed monthly to each operator.</p>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((plan) => {
          const isActive = activePlan?.id === plan.id;
          return (
            <div key={plan.id} className={`rounded-xl border bg-white p-5 ${isActive ? "border-emerald-400 shadow-sm" : "border-gray-200"}`}>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-900">{plan.name}</h2>
                {isActive && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Active</span>}
              </div>
              <p className="text-2xl font-bold text-gray-900">{formatZar(plan.monthly_price_zar)}<span className="text-sm font-medium text-gray-500">/mo</span></p>
              <p className="mt-1 text-xs text-gray-500">Setup fee: {formatZar(plan.setup_fee_zar)} once-off</p>
              <div className="mt-4 space-y-1 text-sm text-gray-700">
                <p>{plan.seat_limit} admin {plan.seat_limit === 1 ? "seat" : "seats"}</p>
                <p>Unlimited bookings included</p>
                <p>All core features included</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-5 lg:col-span-2">
          <h3 className="mb-3 text-base font-semibold text-gray-900">Current Subscription</h3>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500">Plan</p>
              <p className="font-semibold text-gray-900">{activePlan?.name || usage?.plan_id || "-"}</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500">Admins Added</p>
              <p className="font-semibold text-gray-900">{usage?.admin_count ?? 0}</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500">Included Seats</p>
              <p className="font-semibold text-gray-900">{usage?.seat_limit ?? 0}</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500">Remaining Seats</p>
              <p className="font-semibold text-gray-900">{usage?.remaining_admin_seats ?? 0}</p>
            </div>
          </div>

          <p className="mt-3 text-xs text-gray-500">
            Each business is billed monthly for its active plan. Bookings are no longer capped by plan volume.
          </p>

          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="text-sm text-gray-700 sm:min-w-[220px]">
              Switch plan
              <select value={targetPlan} onChange={(e) => setTargetPlan(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({formatZar(p.monthly_price_zar)}/mo)</option>
                ))}
              </select>
            </label>
            <button onClick={switchPlan} disabled={working || !targetPlan} className="w-full rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50 sm:w-auto">
              {working ? "Updating..." : "Update Plan"}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="mb-3 text-base font-semibold text-gray-900">How billing works</h3>
          <div className="space-y-3 text-sm text-gray-600">
            <p>Each business stays on one monthly plan and receives an invoice for that subscription.</p>
            <p>The only plan difference is how many admin accounts are included: 1, 2, or 3.</p>
            <p>If you need more admin access, switch to the next plan before inviting another admin.</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-5 lg:col-span-2">
          <h3 className="mb-3 text-base font-semibold text-gray-900">Landing Page Add-on</h3>
          <p className="text-sm text-gray-600">First page build: {formatZar(3500)} once-off. Each additional page: {formatZar(1500)} once-off. Hosting: {formatZar(500)}/month per business.</p>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <label className="text-sm text-gray-700">
              Total pages requested
              <input type="number" min={1} step={1} value={pagesRequested} onChange={(e) => setPagesRequested(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 md:items-end">
              <input type="checkbox" checked={hostingActive} onChange={(e) => setHostingActive(e.target.checked)} />
              Include monthly hosting ({formatZar(500)}/mo)
            </label>
            <div className="rounded-lg bg-gray-50 p-3 text-sm">
              <p className="text-xs text-gray-500">Build quote</p>
              <p className="text-lg font-bold text-gray-900">{formatZar(buildTotal)}</p>
              <p className="text-xs text-gray-500">1 base page + {extraPages} additional</p>
            </div>
          </div>

          <button onClick={createLandingPageOrder} disabled={working} className="mt-4 w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 sm:w-auto">
            {working ? "Submitting..." : "Create Landing Page Order"}
          </button>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="mb-3 text-base font-semibold text-gray-900">Admin seat policy</h3>
          <div className="space-y-2 text-sm text-gray-600">
            <p>Starter includes 1 admin.</p>
            <p>Growth includes 2 admins.</p>
            <p>Pro includes 3 admins.</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="mb-3 text-base font-semibold text-gray-900">Landing Page Orders</h3>
        <div className="space-y-2">
          {landingOrders.length === 0 && <p className="text-sm text-gray-500">No landing page orders yet.</p>}
          {landingOrders.map((o) => (
            <div key={o.id} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
              <p className="font-semibold text-gray-900">{o.base_page_count + o.extra_page_count} pages · Build {formatZar(o.build_total_zar)}</p>
              <p className="text-xs text-gray-500">Hosting: {o.hosting_active ? `${formatZar(o.hosting_fee_zar)}/mo` : "Off"} · {o.status} · {new Date(o.created_at).toLocaleString("en-ZA")}</p>
              <button
                onClick={() => toggleHosting(o)}
                disabled={working}
                className="mt-2 rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {o.hosting_active ? "Disable Hosting" : "Enable Hosting"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
