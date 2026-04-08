"use client";

import Link from "next/link";
import { useBusinessContext } from "../../components/BusinessContext";

const plans = [
  { name: "Starter", price: 1500, seats: 1 },
  { name: "Growth", price: 3000, seats: 2 },
  { name: "Pro", price: 6500, seats: 3 },
];

function zar(v: number) {
  return "R" + v.toLocaleString("en-ZA");
}

function MarketingView() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white px-6 py-12 md:px-10">
      <div className="mx-auto max-w-6xl space-y-10">
        <header className="space-y-4 text-center">
          <p className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">CapeKayak SaaS</p>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 md:text-5xl">All features from day one. Scale only when your admin team grows.</h1>
          <p className="mx-auto max-w-3xl text-base text-slate-600 md:text-lg">From inquiry to paid booking to operations in one system for activity operators.</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/case-study/cape-kayak" className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">Read the Cape Kayak case study</Link>
            <Link href="/compare/manual-vs-disconnected-tools" className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">See platform comparison</Link>
          </div>
        </header>

        <section className="grid gap-5 md:grid-cols-3">
          {plans.map((p) => (
            <div key={p.name} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">{p.name}</h2>
              <p className="mt-2 text-3xl font-bold text-slate-900">{zar(p.price)}<span className="text-sm font-medium text-slate-500">/month</span></p>
              <p className="mt-1 text-xs text-slate-500">Setup fee: {zar(3500)} once-off</p>
              <ul className="mt-4 space-y-2 text-sm text-slate-700">
                <li>{p.seats} admin {p.seats === 1 ? "seat" : "seats"}</li>
                <li>Unlimited bookings included</li>
                <li>All core features included</li>
              </ul>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h3 className="text-lg font-semibold text-slate-900">Add-ons</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            <li>Landing page build: {zar(3500)} for the first page</li>
            <li>Additional landing pages: {zar(1500)} per page</li>
            <li>Landing page hosting: {zar(500)}/month per business</li>
          </ul>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h3 className="text-lg font-semibold text-slate-900">Billing model</h3>
          <p className="mt-2 text-sm text-slate-600">Each operator is billed monthly for the selected plan. The plan difference is simply the number of admin seats included: 1, 2, or 3.</p>
        </section>
      </div>
    </div>
  );
}

export default function OperatorsPage() {
  const { businessId, businessName, role, operators = [], switchOperator } = useBusinessContext();

  if (!businessId) {
    return <MarketingView />;
  }

  const canSwitch = typeof switchOperator === "function" && operators.length > 1;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Operator Context</p>
            <h1 className="mt-2 text-2xl font-bold text-gray-900">Switch active operator account</h1>
            <p className="mt-2 max-w-2xl text-sm text-gray-500">
              The dashboard is scoped to one operator at a time. Switching here updates bookings, refunds, pricing, reports, and media views to the selected business only.
            </p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <p className="font-semibold">Current operator</p>
            <p>{businessName || "Unnamed operator"}</p>
            <p className="mt-1 text-xs uppercase tracking-wide text-emerald-700">{role || "ADMIN"}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-gray-900">Available operators</h2>
          <div className="mt-4 space-y-3">
            {(operators.length > 0 ? operators : [{ id: businessId, name: businessName || "Current operator", logoUrl: "" }]).map((operator) => {
              const isActive = operator.id === businessId;
              return (
                <button
                  key={operator.id}
                  type="button"
                  onClick={() => switchOperator?.(operator.id)}
                  disabled={!canSwitch || isActive}
                  className={`flex w-full items-center justify-between rounded-2xl border px-4 py-4 text-left transition-colors ${
                    isActive
                      ? "border-emerald-300 bg-emerald-50"
                      : canSwitch
                        ? "border-gray-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/40"
                        : "border-gray-200 bg-gray-50"
                  }`}
                >
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{operator.name}</p>
                    <p className="mt-1 text-xs text-gray-500">{operator.id}</p>
                  </div>
                  {isActive ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white">
                      Active
                    </span>
                  ) : !canSwitch ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600">
                      Locked
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-emerald-700">Switch</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <h2 className="text-lg font-semibold text-gray-900">Isolation checks</h2>
            <ul className="mt-4 space-y-3 text-sm text-gray-600">
              <li className="rounded-xl bg-gray-50 px-3 py-2">Bookings, invoices, refunds, vouchers, reports, and photos all follow the active operator context.</li>
              <li className="rounded-xl bg-gray-50 px-3 py-2">The current operator name stays visible in the shell so admins can confirm they are working in the correct account.</li>
              <li className="rounded-xl bg-gray-50 px-3 py-2">Only multi-operator admins can switch. Single-operator admins stay locked to their own business.</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-5 text-sm text-gray-500">
            {canSwitch
              ? "Switching operators updates the entire dashboard context immediately."
              : "This account currently has access to one operator context only."}
          </div>
        </div>
      </div>
    </div>
  );
}
