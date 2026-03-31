"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" });
}

const STATUS_COLORS: Record<string, string> = {
  PAID: "bg-green-100 text-green-700", CONFIRMED: "bg-green-100 text-green-700",
  HELD: "bg-yellow-100 text-yellow-700", PENDING: "bg-gray-100 text-gray-700",
  CANCELLED: "bg-red-100 text-red-700", COMPLETED: "bg-blue-100 text-blue-700",
};

export default function Bookings() {
  const [bookings, setBookings] = useState<any[]>([]);
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [filter]);

  async function load() {
    setLoading(true);
    let q = supabase.from("bookings")
      .select("id, customer_name, phone, email, qty, total_amount, status, discount_type, refund_status, created_at, slots(start_time), tours(name)")
      .order("created_at", { ascending: false }).limit(200);
    if (filter !== "ALL") q = q.eq("status", filter);
    const { data } = await q;
    setBookings(data || []);
    setLoading(false);
  }

  const filtered = bookings.filter((b) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return b.customer_name?.toLowerCase().includes(s) || b.phone?.includes(s) || b.email?.toLowerCase().includes(s) || b.id.includes(s);
  });

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Bookings</h2>
      <div className="flex flex-col md:flex-row gap-3">
        <input type="text" placeholder="Search name, phone, email, ref..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <div className="flex gap-1 flex-wrap">
          {["ALL", "PAID", "HELD", "PENDING", "CANCELLED", "COMPLETED"].map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === s ? "bg-blue-600 text-white" : "bg-white border border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? <p className="p-4 text-gray-500">Loading...</p> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 font-medium text-gray-600">Ref</th>
                <th className="text-left p-3 font-medium text-gray-600">Customer</th>
                <th className="text-left p-3 font-medium text-gray-600">Phone</th>
                <th className="text-left p-3 font-medium text-gray-600">Tour</th>
                <th className="text-left p-3 font-medium text-gray-600">Date</th>
                <th className="text-left p-3 font-medium text-gray-600">Pax</th>
                <th className="text-left p-3 font-medium text-gray-600">Total</th>
                <th className="text-left p-3 font-medium text-gray-600">Status</th>
                <th className="text-left p-3 font-medium text-gray-600">Refund</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b: any) => (
                <tr key={b.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="p-3 font-mono text-xs">{b.id.substring(0, 8).toUpperCase()}</td>
                  <td className="p-3">{b.customer_name}</td>
                  <td className="p-3 text-gray-500 text-xs">{b.phone}</td>
                  <td className="p-3">{b.tours?.name}</td>
                  <td className="p-3 text-xs">{b.slots?.start_time ? fmtTime(b.slots.start_time) : "-"}</td>
                  <td className="p-3">{b.qty}</td>
                  <td className="p-3 font-medium">R{b.total_amount}</td>
                  <td className="p-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[b.status] || "bg-gray-100"}`}>{b.status}</span></td>
                  <td className="p-3 text-xs">{b.refund_status || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
