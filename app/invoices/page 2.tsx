"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function Invoices() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    const { data } = await supabase.from("invoices")
      .select("*")
      .order("created_at", { ascending: false }).limit(200);
    setInvoices(data || []);
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Tax Invoices</h2>
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? <p className="p-4 text-gray-500">Loading...</p> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 font-medium text-gray-600">Tax Invoice #</th>
                <th className="text-left p-3 font-medium text-gray-600">Customer</th>
                <th className="text-left p-3 font-medium text-gray-600">Tour</th>
                <th className="text-left p-3 font-medium text-gray-600">Date</th>
                <th className="text-left p-3 font-medium text-gray-600">Qty</th>
                <th className="text-left p-3 font-medium text-gray-600">Total</th>
                <th className="text-left p-3 font-medium text-gray-600">Payment</th>
                <th className="text-left p-3 font-medium text-gray-600">Created</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv: any) => (
                <tr key={inv.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="p-3 font-mono font-bold text-blue-600">{inv.invoice_number}</td>
                  <td className="p-3">{inv.customer_name}<br/><span className="text-xs text-gray-400">{inv.customer_email}</span></td>
                  <td className="p-3">{inv.tour_name}</td>
                  <td className="p-3 text-xs">{inv.tour_date ? new Date(inv.tour_date).toLocaleDateString("en-ZA") : "-"}</td>
                  <td className="p-3">{inv.qty}</td>
                  <td className="p-3 font-medium">R{Number(inv.total_amount).toFixed(2)}</td>
                  <td className="p-3 text-xs">{inv.payment_method}</td>
                  <td className="p-3 text-xs">{new Date(inv.created_at).toLocaleDateString("en-ZA")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
