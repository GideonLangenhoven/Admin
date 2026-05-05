"use client";

import { useEffect, useState } from "react";
import { useBusinessContext } from "@/components/BusinessContext";
import { supabase } from "@/app/lib/supabase";

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
    supabase
      .from("customers")
      .select("id, email, name, phone, total_bookings, total_spent, last_booking_at, first_booking_at, marketing_consent")
      .eq("business_id", businessId)
      .order("total_bookings", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        setRows((data ?? []) as Customer[]);
        setLoading(false);
      });
  }, [businessId]);

  const filtered = search
    ? rows.filter(function (r) {
        const q = search.toLowerCase();
        return (r.name || "").toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || (r.phone || "").includes(q);
      })
    : rows;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--ck-text-strong)" }}>Customers</h1>
          <p className="text-sm mt-1" style={{ color: "var(--ck-text-muted)" }}>{rows.length} total customers</p>
        </div>
        <input
          type="text"
          placeholder="Search by name, email, or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm w-72"
          style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)", color: "var(--ck-text)" }}
        />
      </div>

      {loading ? (
        <div className="text-center py-16" style={{ color: "var(--ck-text-muted)" }}>Loading customers...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16" style={{ color: "var(--ck-text-muted)" }}>{search ? "No matching customers" : "No customers yet"}</div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--ck-border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--ck-surface)" }}>
                <th className="text-left px-4 py-3 font-semibold" style={{ color: "var(--ck-text-muted)" }}>Name</th>
                <th className="text-left px-4 py-3 font-semibold" style={{ color: "var(--ck-text-muted)" }}>Email</th>
                <th className="text-left px-4 py-3 font-semibold" style={{ color: "var(--ck-text-muted)" }}>Phone</th>
                <th className="text-right px-4 py-3 font-semibold" style={{ color: "var(--ck-text-muted)" }}>Trips</th>
                <th className="text-right px-4 py-3 font-semibold" style={{ color: "var(--ck-text-muted)" }}>Spent</th>
                <th className="text-left px-4 py-3 font-semibold" style={{ color: "var(--ck-text-muted)" }}>Last Trip</th>
                <th className="text-center px-4 py-3 font-semibold" style={{ color: "var(--ck-text-muted)" }}>Marketing</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(function (r) {
                return (
                  <tr key={r.id} className="border-t" style={{ borderColor: "var(--ck-border)" }}>
                    <td className="px-4 py-3 font-medium" style={{ color: "var(--ck-text-strong)" }}>{r.name || "\u2014"}</td>
                    <td className="px-4 py-3" style={{ color: "var(--ck-text)" }}>{r.email}</td>
                    <td className="px-4 py-3" style={{ color: "var(--ck-text)" }}>{r.phone || "\u2014"}</td>
                    <td className="px-4 py-3 text-right font-semibold" style={{ color: "var(--ck-text-strong)" }}>{r.total_bookings}</td>
                    <td className="px-4 py-3 text-right" style={{ color: "var(--ck-text)" }}>R{Number(r.total_spent).toFixed(0)}</td>
                    <td className="px-4 py-3" style={{ color: "var(--ck-text-muted)" }}>
                      {r.last_booking_at ? new Date(r.last_booking_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "\u2014"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.marketing_consent ? (
                        <span className="inline-block w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 text-xs leading-5 text-center font-bold">&#x2713;</span>
                      ) : (
                        <span className="inline-block w-5 h-5 rounded-full bg-gray-100 text-gray-400 text-xs leading-5 text-center">&ndash;</span>
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
