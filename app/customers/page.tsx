"use client";

import { useEffect, useState } from "react";
import { useBusinessContext } from "@/components/BusinessContext";
import { supabase } from "@/app/lib/supabase";
import { MagnifyingGlass, Check } from "@phosphor-icons/react";

type Customer = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  total_bookings: number;
  total_spent: number;
  last_booking_at: string | null;
  first_booking_at: string | null;
  marketing_consent: boolean;
};

export default function CustomersPage() {
  const { businessId } = useBusinessContext();
  const [rows, setRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!businessId) return;
    // Page past the 1000-row cap so header stats (count, consent) reflect the
    // tenant's full customer base rather than the first 500. Ceiling bounds
    // browser memory for very large tenants.
    (async () => {
      const PAGE = 1000;
      const CEILING = 10000;
      const all: Customer[] = [];
      for (let from = 0; from < CEILING; from += PAGE) {
        const { data, error } = await supabase
          .from("customers")
          .select("id, email, name, phone, total_bookings, total_spent, last_booking_at, first_booking_at, marketing_consent")
          .eq("business_id", businessId)
          .order("total_bookings", { ascending: false })
          .range(from, from + PAGE - 1);
        if (error) break;
        const page = (data ?? []) as Customer[];
        all.push(...page);
        if (page.length < PAGE) break;
      }
      setRows(all);
      setLoading(false);
    })();
  }, [businessId]);

  const filtered = search
    ? rows.filter(function (r) {
        const q = search.toLowerCase();
        return (r.name || "").toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || (r.phone || "").includes(q);
      })
    : rows;

  return (
    <div>
      <div className="anim-fade-up mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="ui-mono-label mb-2">Customers · Directory</p>
          <h1 className="font-display text-[28px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}>Customers</h1>
          <p className="mt-2 text-[13px]" style={{ color: "var(--ck-text-muted)" }}>Everyone who has booked with you, ranked by lifetime trips.</p>
        </div>
        <div className="relative w-full sm:w-72">
          <MagnifyingGlass size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--ck-text-muted)" }} />
          <input
            type="text"
            placeholder="Search by name, email, or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ui-control w-full pl-9"
          />
        </div>
      </div>

      {!loading && rows.length > 0 && (
        <div className="anim-fade-up anim-d1 mb-5 grid grid-cols-2 gap-3 sm:max-w-md">
          <div className="ui-card p-4">
            <div className="mb-2 flex items-center gap-2.5">              <span className="ui-mono-label !text-[10px]">Total</span>
            </div>
            <p className="font-display text-[28px] font-semibold leading-none tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{rows.length}</p>
          </div>
          <div className="ui-card p-4">
            <div className="mb-2 flex items-center gap-2.5">              <span className="ui-mono-label !text-[10px]">Opted In</span>
            </div>
            <p className="font-display text-[28px] font-semibold leading-none tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{rows.filter((r) => r.marketing_consent).length}</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="ui-card space-y-2.5 p-4">
          <div className="ui-skeleton h-9 w-full" />
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="ui-skeleton h-11 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="ui-card">
          <div className="ui-empty">            <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>{search ? "No matching customers" : "No customers yet"}</p>
            <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>{search ? "Try a different name, email, or phone." : "Customers appear here after their first booking."}</p>
          </div>
        </div>
      ) : (
        <div className="ui-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="ui-mono-label !text-[10px] border-b px-4 py-3 text-left" style={{ borderColor: "var(--ck-border-subtle)" }}>Name</th>
                <th className="ui-mono-label !text-[10px] border-b px-4 py-3 text-left" style={{ borderColor: "var(--ck-border-subtle)" }}>Email</th>
                <th className="ui-mono-label !text-[10px] border-b px-4 py-3 text-left" style={{ borderColor: "var(--ck-border-subtle)" }}>Phone</th>
                <th className="ui-mono-label !text-[10px] border-b px-4 py-3 text-right" style={{ borderColor: "var(--ck-border-subtle)" }}>Trips</th>
                <th className="ui-mono-label !text-[10px] border-b px-4 py-3 text-right" style={{ borderColor: "var(--ck-border-subtle)" }}>Spent</th>
                <th className="ui-mono-label !text-[10px] border-b px-4 py-3 text-left" style={{ borderColor: "var(--ck-border-subtle)" }}>Last Trip</th>
                <th className="ui-mono-label !text-[10px] border-b px-4 py-3 text-center" style={{ borderColor: "var(--ck-border-subtle)" }}>Marketing</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ "--tw-divide-color": "var(--ck-border-subtle)" } as React.CSSProperties}>
              {filtered.map(function (r) {
                return (
                  <tr key={r.id} className="transition-colors hover:bg-[var(--ck-surface-sunken)]">
                    <td className="px-4 py-3 font-medium" style={{ color: "var(--ck-text-strong)" }}>{r.name || "\u2014"}</td>
                    <td className="px-4 py-3" style={{ color: "var(--ck-text)" }}>{r.email}</td>
                    <td className="px-4 py-3" style={{ color: "var(--ck-text)" }}>{r.phone || "\u2014"}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{r.total_bookings}</td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: "var(--ck-text)" }}>R{Number(r.total_spent).toFixed(0)}</td>
                    <td className="px-4 py-3" style={{ color: "var(--ck-text-muted)" }}>
                      {r.last_booking_at ? new Date(r.last_booking_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "\u2014"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.marketing_consent ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full" style={{ background: "var(--ck-success-soft)", color: "var(--ck-success)" }}><Check size={12} weight="bold" /></span>
                      ) : (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full text-xs" style={{ background: "var(--ck-surface-sunken)", color: "var(--ck-text-muted)" }}>&ndash;</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
