"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { confirmAction, notify } from "../../lib/app-notify";
import { useBusinessContext } from "../../../components/BusinessContext";
import { Plus, Trash, Copy, ArrowsClockwise, Ticket } from "@phosphor-icons/react";

interface Promotion {
  id: string;
  code: string;
  description: string;
  discount_type: "FLAT" | "PERCENT";
  discount_value: number;
  valid_from: string;
  valid_until: string | null;
  max_uses: number | null;
  used_count: number;
  min_order_amount: number;
  active: boolean;
  created_at: string;
}

export default function PromotionsPage() {
  const { businessId } = useBusinessContext();
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [discountType, setDiscountType] = useState<"FLAT" | "PERCENT">("PERCENT");
  const [discountValue, setDiscountValue] = useState<number>(10);
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState("");
  const [maxUses, setMaxUses] = useState<string>("");
  const [minOrderAmount, setMinOrderAmount] = useState<number>(0);
  const [active, setActive] = useState(true);
  // Ref-based read at save time. Tools like form_input / Playwright / scripted
  // QA harness set .checked via DOM property without dispatching the synthetic
  // React change event, so the controlled `active` state never updates and the
  // DB write looks like a no-op (W-3). Reading the real DOM value at save
  // time is the standard escape hatch for that quirk.
  const activeRef = useRef<HTMLInputElement | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  useEffect(() => {
    if (businessId) loadPromos();
  }, [businessId]);

  async function loadPromos() {
    setLoading(true);
    const { data } = await supabase
      .from("promotions")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });
    setPromos((data as Promotion[]) || []);
    setLoading(false);
  }

  function resetForm() {
    setCode("");
    setDescription("");
    setDiscountType("PERCENT");
    setDiscountValue(10);
    setValidFrom(new Date().toISOString().slice(0, 10));
    setValidUntil("");
    setMaxUses("");
    setMinOrderAmount(0);
    setActive(true);
    setEditId(null);
  }

  function generateCode() {
    // W4: prefix auto-generated codes with PROMO- so operators can scan a list
    // and tell hand-typed campaign codes (SUMMER20, WINTER15) apart from
    // platform-generated ones. Random body stays 6 chars from the
    // unambiguous alphabet, giving 32^6 ≈ 1B candidates per prefix.
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let body = "";
    for (let i = 0; i < 6; i++) body += chars.charAt(Math.floor(Math.random() * chars.length));
    setCode("PROMO-" + body);
  }

  function startEdit(p: Promotion) {
    setEditId(p.id);
    setCode(p.code);
    setDescription(p.description);
    setDiscountType(p.discount_type);
    setDiscountValue(p.discount_value);
    setValidFrom(p.valid_from ? p.valid_from.slice(0, 10) : "");
    setValidUntil(p.valid_until ? p.valid_until.slice(0, 10) : "");
    setMaxUses(p.max_uses != null ? String(p.max_uses) : "");
    setMinOrderAmount(p.min_order_amount || 0);
    setActive(p.active);
    setShowForm(true);
  }

  async function savePromo() {
    if (!code.trim()) { notify({ message: "Code is required.", tone: "error" }); return; }
    if (discountValue <= 0) { notify({ message: "Discount value must be positive.", tone: "error" }); return; }
    if (discountType === "PERCENT" && discountValue > 100) { notify({ message: "Percentage cannot exceed 100.", tone: "error" }); return; }

    // W-1: warn before persisting a permanent promo. Catching this at save
    // time stops a "this promo expires 2 May" mental model from quietly
    // landing as valid_until = NULL in the DB.
    if (!validUntil) {
      const ok = await confirmAction({
        title: "No expiry set",
        message: "This promo has no end date — it will keep applying forever unless you set max_uses or deactivate it. Continue?",
        tone: "warning",
        confirmLabel: "Save without expiry",
        cancelLabel: "Go back",
      });
      if (!ok) return;
    }

    setSaving(true);
    // Authoritative read from the DOM — bypasses React's controlled-input
    // override when callers set .checked programmatically. Falls back to the
    // React state if the ref hasn't mounted yet for any reason.
    const effectiveActive = activeRef.current ? activeRef.current.checked : active;
    if (effectiveActive !== active) setActive(effectiveActive);
    const row = {
      business_id: businessId,
      code: code.toUpperCase().trim(),
      description,
      discount_type: discountType,
      discount_value: discountValue,
      valid_from: validFrom ? new Date(validFrom).toISOString() : new Date().toISOString(),
      valid_until: validUntil ? new Date(validUntil + "T23:59:59").toISOString() : null,
      max_uses: maxUses ? parseInt(maxUses) : null,
      min_order_amount: minOrderAmount,
      active: effectiveActive,
    };

    if (editId) {
      const { error } = await supabase.from("promotions").update(row).eq("id", editId);
      if (error) { notify({ message: error.message, tone: "error" }); setSaving(false); return; }
      notify({ message: "Promo updated.", tone: "success" });
    } else {
      const { error: insertErr } = await supabase.from("promotions").insert(row);
      if (insertErr) {
        if (insertErr.message.includes("duplicate")) notify({ message: "Code already exists.", tone: "error" });
        else notify({ message: insertErr.message, tone: "error" });
        setSaving(false);
        return;
      }
      notify({ message: "Promo created.", tone: "success" });
    }

    setSaving(false);
    setShowForm(false);
    resetForm();
    loadPromos();
  }

  async function toggleActive(p: Promotion) {
    // W-3: make the toggle robust — use a functional setter so concurrent
    // clicks don't clobber each other on a stale `promos` closure, verify
    // the DB write before committing local state, surface notify on
    // outcome so the operator knows it persisted.
    const nextActive = !p.active;
    const { error } = await supabase
      .from("promotions")
      .update({ active: nextActive })
      .eq("id", p.id);
    if (error) {
      notify({ title: "Toggle failed", message: error.message, tone: "error" });
      return;
    }
    setPromos((prev) => prev.map((x) => (x.id === p.id ? { ...x, active: nextActive } : x)));
    notify({ message: "Promo " + p.code + " " + (nextActive ? "activated" : "paused") + ".", tone: "success", duration: 2500 });
  }

  async function deletePromo(p: Promotion) {
    // W-5: replace the bare window.confirm() with the app's amber dialog so
    // accidental trash-icon clicks can't destroy a promo and its history.
    const usesNote = p.used_count > 0 ? " It has " + p.used_count + " recorded use" + (p.used_count === 1 ? "" : "s") + "; that history will be lost." : "";
    if (!await confirmAction({
      title: "Delete promo code",
      message: "Delete \"" + p.code + "\"? This cannot be undone." + usesNote + " If you want to stop new uses but keep history, toggle the status to Paused instead.",
      tone: "warning",
      confirmLabel: "Delete promo",
    })) return;
    const { error } = await supabase.from("promotions").delete().eq("id", p.id);
    if (error) { notify({ title: "Delete failed", message: error.message, tone: "error" }); return; }
    setPromos(promos.filter(x => x.id !== p.id));
    notify({ message: "Promo deleted.", tone: "success" });
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
    notify({ message: "Copied: " + code, tone: "success" });
  }

  if (loading) {
    return (
      <div className="space-y-4 py-2">
        <div className="ui-skeleton h-8 w-48" />
        <div className="ui-skeleton h-[140px] !rounded-2xl" />
        <div className="ui-skeleton h-[320px] !rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="anim-fade-up flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: "var(--ck-text-strong)" }}>Promo Codes</h2>
          <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>Create and manage discount codes for customers</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="ui-btn ui-btn-primary"
        >
          <Plus size={16} /> New Promo
        </button>
      </div>

      {/* Create / Edit form */}
      {showForm && (
        <div className="ui-card anim-fade-up p-5 space-y-4">
          <h3 className="ui-title-md text-sm">
            {editId ? "Edit Promo" : "New Promo Code"}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>Code *</label>
              <div className="flex gap-2">
                <input
                  value={code}
                  onChange={e => setCode(e.target.value.toUpperCase())}
                  placeholder="SUMMER20"
                  className="ui-control flex-1 font-mono uppercase"
                />
                <button
                  onClick={generateCode}
                  className="ui-btn ui-btn-ghost !px-3"
                  title="Generate random code"
                >
                  <ArrowsClockwise size={14} />
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>Description</label>
              <input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Summer sale 20% off"
                className="ui-control w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>Discount Type</label>
              <select
                value={discountType}
                onChange={e => setDiscountType(e.target.value as "FLAT" | "PERCENT")}
                className="ui-control w-full"
              >
                <option value="PERCENT">Percentage (%)</option>
                <option value="FLAT">Fixed Amount (R)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>
                Discount Value {discountType === "PERCENT" ? "(%)" : "(R)"}
              </label>
              <input
                type="number"
                min={1}
                max={discountType === "PERCENT" ? 100 : undefined}
                value={discountValue}
                onChange={e => setDiscountValue(parseFloat(e.target.value) || 0)}
                className="ui-control w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>Valid From</label>
              <input
                type="date"
                value={validFrom}
                onChange={e => setValidFrom(e.target.value)}
                className="ui-control w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>Valid Until (optional)</label>
              <input
                type="date"
                value={validUntil}
                onChange={e => setValidUntil(e.target.value)}
                className="ui-control w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>Max Uses (blank = unlimited)</label>
              <input
                type="number"
                min={1}
                value={maxUses}
                onChange={e => setMaxUses(e.target.value)}
                placeholder="Unlimited"
                className="ui-control w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--ck-text-muted)" }}>Min Order Amount (R)</label>
              <input
                type="number"
                min={0}
                value={minOrderAmount}
                onChange={e => setMinOrderAmount(parseFloat(e.target.value) || 0)}
                className="ui-control w-full"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input ref={activeRef} type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="w-4 h-4 rounded" />
            <span className="text-sm" style={{ color: "var(--ck-text)" }}>Active</span>
          </label>
          <div className="flex gap-2 pt-2">
            <button
              onClick={savePromo}
              disabled={saving}
              className="ui-btn ui-btn-primary disabled:opacity-50"
            >
              {saving ? "Saving..." : editId ? "Update" : "Create"}
            </button>
            <button
              onClick={() => { setShowForm(false); resetForm(); }}
              className="ui-btn ui-btn-ghost"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {promos.length === 0 && !showForm ? (
        <div className="ui-card anim-fade-up anim-d1">
          <div className="ui-empty">
            <span className="ui-icon-chip"><Ticket size={19} /></span>
            <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No promo codes yet</p>
            <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Create your first discount code.</p>
          </div>
        </div>
      ) : promos.length > 0 && (
        <div className="ui-card anim-fade-up anim-d1 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "var(--ck-surface-sunken)" }}>
                  <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Code</th>
                  <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Description</th>
                  <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Discount</th>
                  <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Valid</th>
                  <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Uses</th>
                  <th className="text-left px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Status</th>
                  <th className="text-right px-4 py-3 font-medium" style={{ color: "var(--ck-text-muted)" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {promos.map(p => {
                  const isExpired = p.valid_until && new Date(p.valid_until) < new Date();
                  const isExhausted = p.max_uses != null && p.used_count >= p.max_uses;
                  return (
                    <tr key={p.id} className="border-t transition-colors hover:bg-[var(--ck-surface-sunken)]" style={{ borderColor: "var(--ck-border-subtle)" }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-semibold" style={{ color: "var(--ck-text-strong)" }}>{p.code}</span>
                          <button onClick={() => copyCode(p.code)} className="opacity-40 hover:opacity-100" title="Copy code">
                            <Copy size={12} />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3" style={{ color: "var(--ck-text)" }}>{p.description || "—"}</td>
                      <td className="px-4 py-3">
                        <span className={"ui-status " + (p.discount_type === "PERCENT" ? "ui-pill-ocean" : "ui-pill-success")}>
                          {p.discount_type === "PERCENT" ? p.discount_value + "%" : "R" + p.discount_value}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: "var(--ck-text-muted)" }}>
                        {p.valid_from ? new Date(p.valid_from).toLocaleDateString() : "—"}
                        {p.valid_until ? (
                          " → " + new Date(p.valid_until).toLocaleDateString()
                        ) : (
                          <span className="ui-status ui-pill-amber ml-1" title="This promo has no end date — it will keep applying unless deactivated or capped by max_uses">→ No expiry</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: "var(--ck-text)" }}>
                        {p.used_count}{p.max_uses != null ? " / " + p.max_uses : ""}
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => toggleActive(p)}>
                          <span className={"ui-status cursor-pointer " +
                            (isExpired ? "ui-pill-danger" :
                             isExhausted ? "ui-pill-warning" :
                             p.active ? "ui-pill-success" : "ui-pill-neutral")}>
                            {isExpired ? "Expired" : isExhausted ? "Exhausted" : p.active ? "Active" : "Paused"}
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => startEdit(p)}
                            className="ui-btn ui-btn-ghost !h-8 !px-2.5 !text-xs"
                          >
                            Edit
                          </button>
                          <button onClick={() => deletePromo(p)} className="ui-btn ui-btn-danger !h-8 !w-8 !px-0" title="Delete">
                            <Trash size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
