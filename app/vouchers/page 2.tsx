"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700", REDEEMED: "bg-blue-100 text-blue-700",
  PENDING: "bg-yellow-100 text-yellow-700", EXPIRED: "bg-gray-100 text-gray-600",
};

export default function Vouchers() {
  const [vouchers, setVouchers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    const { data } = await supabase.from("vouchers")
      .select("*")
      .order("created_at", { ascending: false }).limit(200);
    setVouchers(data || []);
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Vouchers</h2>
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? <p className="p-4 text-gray-500">Loading...</p> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 font-medium text-gray-600">Code</th>
                <th className="text-left p-3 font-medium text-gray-600">Status</th>
                <th className="text-left p-3 font-medium text-gray-600">Type</th>
                <th className="text-left p-3 font-medium text-gray-600">Tour</th>
                <th className="text-left p-3 font-medium text-gray-600">Value</th>
                <th className="text-left p-3 font-medium text-gray-600">Recipient</th>
                <th className="text-left p-3 font-medium text-gray-600">Buyer</th>
                <th className="text-left p-3 font-medium text-gray-600">Expires</th>
              </tr>
            </thead>
            <tbody>
              {vouchers.map((v: any) => (
                <tr key={v.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="p-3 font-mono font-bold text-blue-600">{v.code}</td>
                  <td className="p-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[v.status] || "bg-gray-100"}`}>{v.status}</span></td>
                  <td className="p-3 text-xs">{v.type}</td>
                  <td className="p-3">{v.tour_name || "-"}</td>
                  <td className="p-3">{v.value ? "R" + v.value : "-"}</td>
                  <td className="p-3">{v.recipient_name || "-"}</td>
                  <td className="p-3 text-xs">{v.buyer_name || "-"}<br/>{v.buyer_email || ""}</td>
                  <td className="p-3 text-xs">{v.expires_at ? new Date(v.expires_at).toLocaleDateString("en-ZA") : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
