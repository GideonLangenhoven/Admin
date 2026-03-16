"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { getAdminTimezone } from "../lib/admin-timezone";
import { DatePicker } from "../../components/DatePicker";
import { useBusinessContext } from "../../components/BusinessContext";

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  REDEEMED: "bg-blue-100 text-blue-700",
  PENDING: "bg-yellow-100 text-yellow-700",
  EXPIRED: "bg-gray-100 text-gray-600",
};

interface Voucher {
  id: string;
  code: string | null;
  status: string | null;
  type: string | null;
  tour_name: string | null;
  value: number | null;
  recipient_name: string | null;
  buyer_name: string | null;
  buyer_email: string | null;
  expires_at: string | null;
  created_at: string | null;
}

interface VoucherDayGroup {
  dayKey: string;
  dayLabel: string;
  items: Voucher[];
}

function dayKey(raw: string | null) {
  if (!raw) return "unknown";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "unknown";
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: getAdminTimezone(),
  }).format(d);
}

function dayLabel(raw: string | null) {
  if (!raw) return "Unknown Date";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "Unknown Date";
  return d.toLocaleDateString("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: getAdminTimezone(),
  });
}

function text(v: unknown) {
  if (v === null || v === undefined) return "";
  return String(v).toLowerCase();
}

function generateVoucherCode() {
  return "CK-" + Math.random().toString(36).slice(2, 6).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
}

export default function Vouchers() {
  const { businessId } = useBusinessContext();
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [creating, setCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState("");
  const [form, setForm] = useState({
    code: generateVoucherCode(),
    recipient_name: "",
    buyer_name: "",
    buyer_email: "",
    tour_name: "",
    type: "FREE_TRIP",
    value: "0",
    expires_at: "",
    gift_message: "",
  });

  async function loadVouchers() {
    const { data } = await supabase
      .from("vouchers")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(500);
    setVouchers((data || []) as Voucher[]);
    setLoading(false);
  }

  useEffect(() => {
    const t = setTimeout(() => {
      loadVouchers();
    }, 0);
    return () => clearTimeout(t);
  }, [businessId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vouchers.filter((v) => {
      if (selectedDate && dayKey(v.created_at) !== selectedDate) return false;
      if (statusFilter !== "ALL" && (v.status || "") !== statusFilter) return false;
      if (!q) return true;
      const haystack = [
        v.code,
        v.status,
        v.type,
        v.tour_name,
        v.value,
        v.recipient_name,
        v.buyer_name,
        v.buyer_email,
        v.expires_at,
        v.created_at,
      ]
        .map(text)
        .join(" ");
      return haystack.includes(q);
    });
  }, [vouchers, selectedDate, search, statusFilter]);

  const groups = useMemo<VoucherDayGroup[]>(() => {
    const map = new Map<string, Voucher[]>();
    for (const v of filtered) {
      const key = dayKey(v.created_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(v);
    }
    const out: VoucherDayGroup[] = [];
    for (const [k, items] of map) {
      out.push({
        dayKey: k,
        dayLabel: dayLabel(items[0]?.created_at || null),
        items,
      });
    }
    out.sort((a, b) => b.dayKey.localeCompare(a.dayKey));
    return out;
  }, [filtered]);

  const statusCounts = useMemo(() => {
    return vouchers.reduce<Record<string, number>>((acc, voucher) => {
      const key = voucher.status || "UNKNOWN";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }, [vouchers]);

  async function createVoucher(e: React.FormEvent) {
    e.preventDefault();
    if (!businessId) return;
    setCreating(true);
    setCreateMessage("");
    const expiresAt = form.expires_at ? new Date(`${form.expires_at}T23:59:59+02:00`).toISOString() : null;
    const payload = {
      business_id: businessId,
      code: form.code.trim().toUpperCase(),
      status: "ACTIVE",
      type: form.type,
      recipient_name: form.recipient_name.trim() || null,
      buyer_name: form.buyer_name.trim() || null,
      buyer_email: form.buyer_email.trim().toLowerCase() || null,
      tour_name: form.tour_name.trim() || null,
      value: Number(form.value || 0),
      purchase_amount: Number(form.value || 0),
      expires_at: expiresAt,
      gift_message: form.gift_message.trim() || null,
    };
    const { error } = await supabase.from("vouchers").insert(payload);
    if (error) {
      setCreateMessage(error.message);
    } else {
      setCreateMessage(`Voucher ${payload.code} created.`);
      setForm({
        code: generateVoucherCode(),
        recipient_name: "",
        buyer_name: "",
        buyer_email: "",
        tour_name: "",
        type: "FREE_TRIP",
        value: "0",
        expires_at: "",
        gift_message: "",
      });
      await loadVouchers();
    }
    setCreating(false);
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Vouchers</h2>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <form onSubmit={createVoucher} className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Create voucher</h3>
              <p className="text-sm text-gray-500">Generate an active code with recipient details and an expiry date.</p>
            </div>
            <button type="button" onClick={() => setForm((current) => ({ ...current, code: generateVoucherCode() }))} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
              Regenerate code
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-sm text-gray-600">
              Voucher code
              <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono" />
            </label>
            <label className="text-sm text-gray-600">
              Expiry date
              <input type="date" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm text-gray-600">
              Recipient
              <input value={form.recipient_name} onChange={(e) => setForm({ ...form, recipient_name: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm text-gray-600">
              Buyer name
              <input value={form.buyer_name} onChange={(e) => setForm({ ...form, buyer_name: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm text-gray-600">
              Buyer email
              <input type="email" value={form.buyer_email} onChange={(e) => setForm({ ...form, buyer_email: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm text-gray-600">
              Tour / activity
              <input value={form.tour_name} onChange={(e) => setForm({ ...form, tour_name: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm text-gray-600">
              Voucher type
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                <option value="FREE_TRIP">Free Trip</option>
                <option value="CREDIT">Credit</option>
                <option value="GIFT">Gift Voucher</option>
              </select>
            </label>
            <label className="text-sm text-gray-600">
              Value (ZAR)
              <input type="number" min="0" step="0.01" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
          </div>

          <label className="mt-3 block text-sm text-gray-600">
            Gift message
            <textarea value={form.gift_message} onChange={(e) => setForm({ ...form, gift_message: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </label>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className={`text-sm ${createMessage.includes("created") ? "text-emerald-700" : "text-red-600"}`}>{createMessage}</p>
            <button type="submit" disabled={creating || !form.code.trim()} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50">
              {creating ? "Creating..." : "Create voucher"}
            </button>
          </div>
        </form>

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-lg font-semibold text-gray-900">Status overview</h3>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {["ACTIVE", "REDEEMED", "PENDING", "EXPIRED"].map((status) => (
              <div key={status} className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{status}</p>
                <p className="mt-2 text-2xl font-bold text-gray-900">{statusCounts[status] || 0}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-gray-500">Use status filters below to confirm which codes are still redeemable and which have already been used.</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 sm:flex-row sm:flex-wrap sm:items-center">
        <label className="flex flex-col gap-2 text-sm text-gray-600 sm:flex-row sm:items-center">
          Filter by created date
          <DatePicker value={selectedDate} onChange={setSelectedDate} />
        </label>
        {selectedDate && (
          <button
            type="button"
            onClick={() => setSelectedDate("")}
            className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium hover:bg-gray-50"
          >
            Clear Date
          </button>
        )}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search vouchers..."
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm sm:py-1.5"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm sm:py-1.5">
          <option value="ALL">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="REDEEMED">Redeemed</option>
          <option value="PENDING">Pending</option>
          <option value="EXPIRED">Expired</option>
        </select>
      </div>

      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-gray-500">Loading...</div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">No vouchers found for this filter.</div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.dayKey}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xl font-semibold text-gray-800">{g.dayLabel}</h3>
                <span className="text-xs text-gray-500">{g.items.length} vouchers</span>
              </div>
              <div className="space-y-3 md:hidden">
                {g.items.map((v) => (
                  <div key={v.id} className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-bold text-blue-600">{v.code || "-"}</p>
                        <p className="mt-1 text-sm font-semibold text-gray-800">{v.recipient_name || "-"}</p>
                        <p className="text-xs text-gray-500">{v.tour_name || "-"}</p>
                      </div>
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[v.status || ""] || "bg-gray-100 text-gray-700"}`}>
                        {v.status || "-"}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-lg bg-gray-50 p-2">
                        <p className="text-[11px] text-gray-500">Value</p>
                        <p className="font-semibold">{v.value !== null && v.value !== undefined ? "R" + Number(v.value).toFixed(2) : "-"}</p>
                      </div>
                      <div className="rounded-lg bg-gray-50 p-2">
                        <p className="text-[11px] text-gray-500">Buyer</p>
                        <p className="text-xs font-semibold">{v.buyer_name || "-"}</p>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-gray-400">Expires {v.expires_at ? new Date(v.expires_at).toLocaleDateString("en-ZA") : "-"}</p>
                  </div>
                ))}
              </div>
              <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white md:block">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="p-3 text-left font-medium text-gray-600">Code</th>
                      <th className="p-3 text-left font-medium text-gray-600">Status</th>
                      <th className="hidden p-3 text-left font-medium text-gray-600 md:table-cell">Type</th>
                      <th className="hidden p-3 text-left font-medium text-gray-600 lg:table-cell">Tour</th>
                      <th className="p-3 text-left font-medium text-gray-600">Value</th>
                      <th className="p-3 text-left font-medium text-gray-600">Recipient</th>
                      <th className="hidden p-3 text-left font-medium text-gray-600 md:table-cell">Buyer</th>
                      <th className="hidden p-3 text-left font-medium text-gray-600 lg:table-cell">Expires</th>
                      <th className="hidden p-3 text-left font-medium text-gray-600 lg:table-cell">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((v) => (
                      <tr key={v.id} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="p-3 font-mono font-bold text-blue-600">{v.code || "-"}</td>
                        <td className="p-3">
                          <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[v.status || ""] || "bg-gray-100 text-gray-700"}`}>
                            {v.status || "-"}
                          </span>
                        </td>
                        <td className="hidden p-3 text-xs md:table-cell">{v.type || "-"}</td>
                        <td className="hidden p-3 lg:table-cell">{v.tour_name || "-"}</td>
                        <td className="p-3">{v.value !== null && v.value !== undefined ? "R" + Number(v.value).toFixed(2) : "-"}</td>
                        <td className="p-3">{v.recipient_name || "-"}</td>
                        <td className="hidden p-3 text-xs md:table-cell">
                          {v.buyer_name || "-"}
                          <br />
                          {v.buyer_email || ""}
                        </td>
                        <td className="hidden p-3 text-xs lg:table-cell">{v.expires_at ? new Date(v.expires_at).toLocaleDateString("en-ZA") : "-"}</td>
                        <td className="hidden p-3 text-xs lg:table-cell">{v.created_at ? new Date(v.created_at).toLocaleDateString("en-ZA") : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
