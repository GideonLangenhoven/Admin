"use client";

import Link from "next/link";
import { useBusinessContext } from "../../components/BusinessContext";

// Single pricing model — mirrors the 'standard' row in the plans table.
const plan = { name: "Standard", price: 2000, seats: 1, extraSeat: 500 };

function zar(v: number) {
  return "R" + v.toLocaleString("en-ZA");
}

function MarketingView() {
  return (
    <div className="min-h-screen px-6 py-12 md:px-10">
      <div className="anim-fade-up mx-auto max-w-6xl space-y-10">
        <header className="space-y-4 text-center">
          <p className="inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide" style={{ background: "var(--ck-accent-soft)", color: "var(--ck-accent)" }}>CapeKayak SaaS</p>
          <h1 className="font-display text-4xl font-semibold tracking-tight md:text-5xl" style={{ color: "var(--ck-text-strong)" }}>All features from day one. Scale only when your admin team grows.</h1>
          <p className="mx-auto max-w-3xl text-base md:text-lg" style={{ color: "var(--ck-text-muted)" }}>From inquiry to paid booking to operations in one system for activity operators.</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/case-study/cape-kayak" className="ui-btn ui-btn-primary !px-5">Read the Cape Kayak case study</Link>
            <Link href="/compare/manual-vs-disconnected-tools" className="ui-btn ui-btn-ghost !px-5">See platform comparison</Link>
          </div>
        </header>

        <section className="mx-auto max-w-md">
          <div className="ui-card p-6">
            <h2 className="text-lg font-semibold" style={{ color: "var(--ck-text-strong)" }}>{plan.name}</h2>
            <p className="font-display mt-2 text-[30px] font-semibold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{zar(plan.price)}<span className="text-sm font-medium" style={{ color: "var(--ck-text-muted)" }}>/month</span></p>
            <p className="mt-1 text-xs" style={{ color: "var(--ck-text-muted)" }}>Setup fee: {zar(3500)} once-off</p>
            <ul className="mt-4 space-y-2 text-sm" style={{ color: "var(--ck-text)" }}>
              <li>{plan.seats} admin seat included</li>
              <li>{zar(plan.extraSeat)}/month per additional seat</li>
              <li>Unlimited bookings included</li>
              <li>All core features included</li>
            </ul>
          </div>
        </section>

        <section className="ui-card p-6">
          <h3 className="text-lg font-semibold" style={{ color: "var(--ck-text-strong)" }}>Add-ons</h3>
          <ul className="mt-3 space-y-2 text-sm" style={{ color: "var(--ck-text)" }}>
            <li>Landing page build: {zar(3500)} for the first page</li>
            <li>Additional landing pages: {zar(1500)} per page</li>
            <li>Landing page hosting: {zar(500)}/month per business</li>
          </ul>
        </section>

        <section className="ui-card p-6">
          <h3 className="text-lg font-semibold" style={{ color: "var(--ck-text-strong)" }}>Billing model</h3>
          <p className="mt-2 text-sm" style={{ color: "var(--ck-text-muted)" }}>Each operator pays {zar(plan.price)}/month, which includes one admin seat. Every additional admin seat adds {zar(plan.extraSeat)}/month.</p>
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
    <div className="anim-fade-up max-w-5xl space-y-6">
      <div className="ui-card p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="ui-mono-label" style={{ color: "var(--ck-accent)" }}>Operator Context</p>
            <h1 className="font-display mt-2 text-[26px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}>Switch active operator account</h1>
            <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--ck-text-muted)" }}>
              The dashboard is scoped to one operator at a time. Switching here updates bookings, refunds, pricing, reports, and media views to the selected business only.
            </p>
          </div>
          <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "var(--ck-accent-soft)", border: "1px solid color-mix(in srgb, var(--ck-accent) 22%, transparent)", color: "var(--ck-accent)" }}>
            <p className="font-semibold">Current operator</p>
            <p style={{ color: "var(--ck-text-strong)" }}>{businessName || "Unnamed operator"}</p>
            <p className="ui-mono-label mt-1 !text-[9.5px]" style={{ color: "var(--ck-accent)" }}>{role || "ADMIN"}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="ui-card p-5">
          <h2 className="text-lg font-semibold" style={{ color: "var(--ck-text-strong)" }}>Available operators</h2>
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
                      ? "border-[var(--ck-accent)] bg-[var(--ck-accent-soft)]"
                      : canSwitch
                        ? "border-[var(--ck-border-subtle)] hover:border-[var(--ck-accent)] hover:bg-[var(--ck-accent-soft)]"
                        : "border-[var(--ck-border-subtle)] bg-[var(--ck-surface-sunken)]"
                  }`}
                >
                  <div>
                    <p className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>{operator.name}</p>
                    <p className="mt-1 font-mono text-xs" style={{ color: "var(--ck-text-muted)" }}>{operator.id}</p>
                  </div>
                  {isActive ? (
                    <span className="ui-status ui-pill-accent">Active</span>
                  ) : !canSwitch ? (
                    <span className="ui-status ui-pill-neutral">Locked</span>
                  ) : (
                    <span className="text-xs font-semibold" style={{ color: "var(--ck-accent)" }}>Switch</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div className="ui-card p-5">
            <h2 className="text-lg font-semibold" style={{ color: "var(--ck-text-strong)" }}>Isolation checks</h2>
            <ul className="mt-4 space-y-3 text-sm" style={{ color: "var(--ck-text)" }}>
              <li className="rounded-xl px-3 py-2" style={{ background: "var(--ck-surface-sunken)" }}>Bookings, invoices, refunds, vouchers, reports, and photos all follow the active operator context.</li>
              <li className="rounded-xl px-3 py-2" style={{ background: "var(--ck-surface-sunken)" }}>The current operator name stays visible in the shell so admins can confirm they are working in the correct account.</li>
              <li className="rounded-xl px-3 py-2" style={{ background: "var(--ck-surface-sunken)" }}>Only multi-operator admins can switch. Single-operator admins stay locked to their own business.</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-dashed p-5 text-sm" style={{ borderColor: "var(--ck-border-strong)", background: "var(--ck-surface-sunken)", color: "var(--ck-text-muted)" }}>
            {canSwitch
              ? "Switching operators updates the entire dashboard context immediately."
              : "This account currently has access to one operator context only."}
          </div>
        </div>
      </div>
    </div>
  );
}
