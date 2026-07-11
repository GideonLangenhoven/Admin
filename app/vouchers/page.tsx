"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { getAdminTimezone } from "../lib/admin-timezone";
import { DatePicker } from "../../components/DatePicker";
import { useBusinessContext } from "../../components/BusinessContext";
import { buildAdminVoucherPurchase } from "./voucher-purchase";
import { Ticket, CheckCircle, Clock, Prohibit, MagnifyingGlass, ArrowsClockwise } from "@phosphor-icons/react";

const STATUS_PILL: Record<string, string> = {
  ACTIVE: "ui-pill-success",
  REDEEMED: "ui-pill-ocean",
  PENDING: "ui-pill-warning",
  EXPIRED: "ui-pill-neutral",
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
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
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
    recipient_email: "",
    buyer_name: "",
    buyer_email: "",
    tour_name: "",
    type: "FREE_TRIP",
    value: "0",
    gift_message: "",
  });

  const loadVouchers = useCallback(async () => {
    const { data } = await supabase
      .from("vouchers")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(500);
    setVouchers((data || []) as Voucher[]);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    const t = setTimeout(() => {
      loadVouchers();
    }, 0);
    return () => clearTimeout(t);
  }, [loadVouchers]);

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
    if (Number(form.value || 0) <= 0) { setCreateMessage("Value must be greater than 0."); return; }
    if (!form.buyer_email.trim()) { setCreateMessage("Buyer email is required so the payment link can be sent."); return; }
    setCreating(true);
    setCreateMessage("");
    const purchase = buildAdminVoucherPurchase({
      businessId,
      code: form.code,
      recipientName: form.recipient_name,
      recipientEmail: form.recipient_email,
      buyerName: form.buyer_name,
      buyerEmail: form.buyer_email,
      tourName: form.tour_name,
      type: form.type,
      value: form.value,
      expiresAt: "",
      giftMessage: form.gift_message,
    });
    const payload = purchase.voucherPayload;
    // Retry on unique constraint violation (code collision)
    let lastError: any = null;
    let createdVoucherId = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) payload.code = generateVoucherCode();
      const { data, error } = await supabase.from("vouchers").insert(payload).select("id").single();
      if (!error && data?.id) { createdVoucherId = data.id; break; }
      if (error?.code === "23505" && attempt < 4) { lastError = error; continue; }
      lastError = error;
      break;
    }
    if (!createdVoucherId) {
      setCreateMessage(lastError?.message || "Voucher could not be created.");
    } else {
      const checkout = await supabase.functions.invoke("create-checkout", {
        body: { ...purchase.checkoutBody, voucher_id: createdVoucherId, voucher_code: payload.code },
      });
      if (checkout.error || !checkout.data?.redirectUrl) {
        setCreateMessage(`Voucher ${payload.code} is pending, but the payment link could not be sent.`);
        setCreating(false);
        await loadVouchers();
        return;
      }
      setCreateMessage(`Payment link sent to ${payload.buyer_email}. Voucher ${payload.code} will activate after payment.`);
      setForm({
        code: generateVoucherCode(),
        recipient_name: "",
        recipient_email: "",
        buyer_name: "",
        buyer_email: "",
        tour_name: "",
        type: "FREE_TRIP",
        value: "0",
        gift_message: "",
      });
      await loadVouchers();
    }
    setCreating(false);
  }

  return (
    <div className="space-y-4">
      <div className="anim-fade-up">
        <p className="ui-mono-label mb-2">Customers · Vouchers</p>
        <h2 className="font-display text-[28px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}>Vouchers</h2>
      </div>

      <div className="anim-fade-up anim-d1 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <form onSubmit={createVoucher} className="ui-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Create voucher</h3>
              <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>Send the buyer a payment link. The code activates only after payment.</p>
            </div>
            <button type="button" onClick={() => setForm((current) => ({ ...current, code: generateVoucherCode() }))} className="ui-btn ui-btn-ghost h-8 shrink-0 px-3 text-xs">
              <ArrowsClockwise size={13} weight="bold" /> Regenerate
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-sm" style={{ color: "var(--ck-text-muted)" }}>
              Voucher code
              <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className="ui-control mt-1 w-full font-mono" />
            </label>
            <div className="text-sm" style={{ color: "var(--ck-text-muted)" }}>
              Expiry
              <p className="mt-1 rounded-lg px-3 py-2 text-sm" style={{ background: "var(--ck-surface-sunken)", color: "var(--ck-text-muted)" }}>Auto — 3 years from purchase</p>
            </div>
            <label className="text-sm" style={{ color: "var(--ck-text-muted)" }}>
              Recipient
              <input value={form.recipient_name} onChange={(e) => setForm({ ...form, recipient_name: e.target.value })} className="ui-control mt-1 w-full" />
            </label>
            <label className="text-sm" style={{ color: "var(--ck-text-muted)" }}>
              Recipient's email (optional — sends the gift straight to them instead of the buyer)
              <input type="email" value={form.recipient_email} onChange={(e) => setForm({ ...form, recipient_email: e.target.value })} className="ui-control mt-1 w-full" />
            </label>
            <label className="text-sm" style={{ color: "var(--ck-text-muted)" }}>
              Buyer name
              <input value={form.buyer_name} onChange={(e) => setForm({ ...form, buyer_name: e.target.value })} className="ui-control mt-1 w-full" />
            </label>
            <label className="text-sm" style={{ color: "var(--ck-text-muted)" }}>
              Buyer email
              <input type="email" value={form.buyer_email} onChange={(e) => setForm({ ...form, buyer_email: e.target.value })} className="ui-control mt-1 w-full" />
            </label>
            <label className="text-sm" style={{ color: "var(--ck-text-muted)" }}>
              Tour / activity
              <input value={form.tour_name} onChange={(e) => setForm({ ...form, tour_name: e.target.value })} className="ui-control mt-1 w-full" />
            </label>
            <label className="text-sm" style={{ color: "var(--ck-text-muted)" }}>
              Voucher type
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="ui-control mt-1 w-full">
                <option value="FREE_TRIP">Free Trip</option>
                <option value="CREDIT">Credit</option>
                <option value="GIFT">Gift Voucher</option>
              </select>
            </label>
            <label className="text-sm" style={{ color: "var(--ck-text-muted)" }}>
              Value (ZAR)
              <input type="number" min="0" step="0.01" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className="ui-control mt-1 w-full" />
            </label>
          </div>

          <label className="mt-3 block text-sm" style={{ color: "var(--ck-text-muted)" }}>
            Gift message
            <textarea value={form.gift_message} onChange={(e) => setForm({ ...form, gift_message: e.target.value })} rows={3} className="ui-control mt-1 w-full" />
          </label>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm" style={{ color: createMessage.includes("sent") ? "var(--ck-success)" : "var(--ck-danger)" }}>{createMessage}</p>
            <button type="submit" disabled={creating || !form.code.trim()} className="ui-btn ui-btn-primary disabled:opacity-50">
              {creating ? "Creating..." : "Send payment link"}
            </button>
          </div>
        </form>

        <div className="ui-card p-4">
          <h3 className="text-[15px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Status overview</h3>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {[
              { key: "ACTIVE", label: "Active", chipBg: "var(--ck-success-soft)", chipColor: "var(--ck-success)", icon: <Ticket size={16} weight="fill" /> },
              { key: "REDEEMED", label: "Redeemed", chipBg: "var(--ck-ocean-soft)", chipColor: "var(--ck-ocean)", icon: <CheckCircle size={16} weight="fill" /> },
              { key: "PENDING", label: "Pending", chipBg: "var(--ck-amber-soft)", chipColor: "var(--ck-amber)", icon: <Clock size={16} weight="fill" /> },
              { key: "EXPIRED", label: "Expired", chipBg: "var(--ck-surface)", chipColor: "var(--ck-text-muted)", icon: <Prohibit size={16} weight="bold" /> },
            ].map((tile) => (
              <div key={tile.key} className="rounded-xl p-3" style={{ background: "var(--ck-surface-sunken)" }}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="ui-icon-chip !h-8 !w-8" style={{ background: tile.chipBg, color: tile.chipColor }}>{tile.icon}</span>
                  <span className="ui-mono-label !text-[9.5px]">{tile.label}</span>
                </div>
                <p className="font-display text-[26px] font-semibold leading-none tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{statusCounts[tile.key] || 0}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm" style={{ color: "var(--ck-text-muted)" }}>Use status filters below to confirm which codes are still redeemable and which have already been used.</p>
        </div>
      </div>

      <div className="anim-fade-up anim-d2 ui-card flex flex-col gap-3 p-3 sm:flex-row sm:flex-wrap sm:items-center">
        <label className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center" style={{ color: "var(--ck-text-muted)" }}>
          Filter by created date
          <DatePicker value={selectedDate} onChange={setSelectedDate} />
        </label>
        {selectedDate && (
          <button
            type="button"
            onClick={() => setSelectedDate("")}
            className="ui-btn ui-btn-ghost h-8 px-3 text-xs"
          >
            Clear Date
          </button>
        )}
        <div className="relative min-w-0 flex-1">
          <MagnifyingGlass size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--ck-text-muted)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vouchers..."
            className="ui-control w-full pl-9"
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="ui-control">
          <option value="ALL">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="REDEEMED">Redeemed</option>
          <option value="PENDING">Pending</option>
          <option value="EXPIRED">Expired</option>
        </select>
      </div>

      {loading ? (
        <div className="ui-card space-y-2.5 p-4">
          <div className="ui-skeleton h-9 w-full" />
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="ui-skeleton h-14 w-full" />)}
        </div>
      ) : groups.length === 0 ? (
        <div className="ui-card">
          <div className="ui-empty">
            <span className="ui-icon-chip"><Ticket size={19} /></span>
            <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No vouchers found</p>
            <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>No vouchers match this filter. Try clearing the date or status.</p>
          </div>
        </div>
      ) : (
        <div className="anim-fade-up anim-d3 space-y-6">
          {groups.map((g) => (
            <div key={g.dayKey}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[15px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>{g.dayLabel}</h3>
                <span className="ui-mono-label !text-[10px]">{g.items.length} vouchers</span>
              </div>
              <div className="space-y-3 md:hidden">
                {g.items.map((v) => (
                  <div key={v.id} className="ui-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-bold" style={{ color: "var(--ck-ocean)" }}>{v.code || "-"}</p>
                        <p className="mt-1 text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>{v.recipient_name || "-"}</p>
                        <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{v.tour_name || "-"}</p>
                      </div>
                      <span className={`ui-status ${STATUS_PILL[v.status || ""] || "ui-pill-neutral"}`}>
                        {v.status || "-"}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-lg p-2" style={{ background: "var(--ck-surface-sunken)" }}>
                        <p className="ui-mono-label !text-[9.5px]">Value</p>
                        <p className="mt-0.5 font-semibold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{v.value !== null && v.value !== undefined ? "R" + Number(v.value).toFixed(2) : "-"}</p>
                      </div>
                      <div className="rounded-lg p-2" style={{ background: "var(--ck-surface-sunken)" }}>
                        <p className="ui-mono-label !text-[9.5px]">Buyer</p>
                        <p className="mt-0.5 text-xs font-semibold" style={{ color: "var(--ck-text-strong)" }}>{v.buyer_name || "-"}</p>
                      </div>
                    </div>
                    <p className="mt-2 text-xs" style={{ color: "var(--ck-text-muted)" }}>Expires {v.expires_at ? new Date(v.expires_at).toLocaleDateString("en-ZA") : "-"}</p>
                  </div>
                ))}
              </div>
              <div className="ui-card hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="ui-mono-label !text-[10px] border-b p-3 text-left" style={{ borderColor: "var(--ck-border-subtle)" }}>Code</th>
                      <th className="ui-mono-label !text-[10px] border-b p-3 text-left" style={{ borderColor: "var(--ck-border-subtle)" }}>Status</th>
                      <th className="ui-mono-label !text-[10px] border-b hidden p-3 text-left md:table-cell" style={{ borderColor: "var(--ck-border-subtle)" }}>Type</th>
                      <th className="ui-mono-label !text-[10px] border-b hidden p-3 text-left lg:table-cell" style={{ borderColor: "var(--ck-border-subtle)" }}>Tour</th>
                      <th className="ui-mono-label !text-[10px] border-b p-3 text-left" style={{ borderColor: "var(--ck-border-subtle)" }}>Value</th>
                      <th className="ui-mono-label !text-[10px] border-b p-3 text-left" style={{ borderColor: "var(--ck-border-subtle)" }}>Recipient</th>
                      <th className="ui-mono-label !text-[10px] border-b hidden p-3 text-left md:table-cell" style={{ borderColor: "var(--ck-border-subtle)" }}>Buyer</th>
                      <th className="ui-mono-label !text-[10px] border-b hidden p-3 text-left lg:table-cell" style={{ borderColor: "var(--ck-border-subtle)" }}>Expires</th>
                      <th className="ui-mono-label !text-[10px] border-b hidden p-3 text-left lg:table-cell" style={{ borderColor: "var(--ck-border-subtle)" }}>Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ "--tw-divide-color": "var(--ck-border-subtle)" } as React.CSSProperties}>
                    {g.items.map((v) => (
                      <tr key={v.id} className="transition-colors hover:bg-[var(--ck-surface-sunken)]">
                        <td className="p-3 font-mono font-bold" style={{ color: "var(--ck-ocean)" }}>{v.code || "-"}</td>
                        <td className="p-3">
                          <span className={`ui-status ${STATUS_PILL[v.status || ""] || "ui-pill-neutral"}`}>
                            {v.status || "-"}
                          </span>
                        </td>
                        <td className="hidden p-3 text-xs md:table-cell" style={{ color: "var(--ck-text-muted)" }}>{v.type || "-"}</td>
                        <td className="hidden p-3 lg:table-cell" style={{ color: "var(--ck-text)" }}>{v.tour_name || "-"}</td>
                        <td className="p-3 tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{v.value !== null && v.value !== undefined ? "R" + Number(v.value).toFixed(2) : "-"}</td>
                        <td className="p-3" style={{ color: "var(--ck-text)" }}>{v.recipient_name || "-"}</td>
                        <td className="hidden p-3 text-xs md:table-cell" style={{ color: "var(--ck-text-muted)" }}>
                          {v.buyer_name || "-"}
                          <br />
                          {v.buyer_email || ""}
                        </td>
                        <td className="hidden p-3 text-xs lg:table-cell" style={{ color: "var(--ck-text-muted)" }}>{v.expires_at ? new Date(v.expires_at).toLocaleDateString("en-ZA") : "-"}</td>
                        <td className="hidden p-3 text-xs lg:table-cell" style={{ color: "var(--ck-text-muted)" }}>{v.created_at ? new Date(v.created_at).toLocaleDateString("en-ZA") : "-"}</td>
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
