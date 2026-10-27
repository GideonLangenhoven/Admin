"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useBusinessContext } from "../BusinessContext";
import { supabase } from "../../app/lib/supabase";
import { notify } from "../../app/lib/app-notify";
import { legacyBookingDiscountRules, validateBookingDiscountRules, type BookingDiscountRule } from "../../app/lib/booking-discounts";

export default function BookingDiscountSettings() {
  const { businessId, readOnly } = useBusinessContext();
  const [rules, setRules] = useState<BookingDiscountRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    if (!businessId) return;
    void supabase.from("policies").select("booking_discount_rules, loyalty_bookings_threshold, loyalty_period_days, loyalty_discount_percent, group_discount_min_qty, group_discount_percent")
      .eq("business_id", businessId).maybeSingle().then(({ data, error }) => {
        if (!active) return;
        setLoading(false);
        setError(error ? "Could not load automatic discounts. Refresh to try again." : "");
        if (!error) setRules(data?.booking_discount_rules ?? legacyBookingDiscountRules(data || {}));
      });
    return () => { active = false; };
  }, [businessId]);

  function update(index: number, patch: Partial<BookingDiscountRule>) {
    setRules(previous => previous.map((rule, i) => i === index ? { ...rule, ...patch } : rule));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (readOnly || saving || loading) return;
    const issue = validateBookingDiscountRules(rules);
    if (issue) { setError(issue); return; }
    setSaving(true);
    const result = await supabase.from("policies").upsert({ business_id: businessId, booking_discount_rules: rules }, { onConflict: "business_id" });
    setSaving(false);
    if (result.error) { setError("Discounts were not saved. " + result.error.message); return; }
    setError("");
    notify({ title: "Automatic discounts saved", message: "WhatsApp and web chat check these rules at quote and checkout.", tone: "success" });
  }

  return <section className="ui-card p-4 sm:p-5" aria-label="Automatic booking discounts">
    <h2 className="text-lg font-semibold" style={{ color: "var(--ck-text-strong)" }}>Automatic chat discounts</h2>
    <p className="mt-2 text-sm ui-text-muted">For WhatsApp and web chat. Uses the largest matching discount; returning guests match by phone number.</p>
    <p className="mt-2 text-sm"><Link href="/marketing/automations" className="underline underline-offset-4">Welcome-back emails</Link></p>
    {loading ? <div className="ui-skeleton mt-4 h-28" aria-label="Loading discounts" /> : <form onSubmit={save} className="mt-5 space-y-5">
      {error && <p role="alert" className="text-sm" style={{ color: "var(--ck-danger)" }}>{error}</p>}
      <fieldset disabled={readOnly || saving || Boolean(error.startsWith("Could not load"))} className="space-y-5">
        {rules.length === 0 && <p className="text-sm">No automatic discounts.</p>}
        {rules.map((rule, index) => <div key={index} className="border-t pt-4" style={{ borderColor: "var(--ck-border-subtle)" }}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={rule.enabled} onChange={event => update(index, { enabled: event.target.checked })} /> Rule {index + 1} enabled</label>
            <button type="button" className="ui-btn ui-btn-ghost min-h-11" onClick={() => setRules(previous => previous.filter((_, i) => i !== index))}>Remove rule {index + 1}</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm">Offer name<input className="ui-control mt-1 w-full" value={rule.name} maxLength={80} required onChange={event => update(index, { name: event.target.value })} /></label>
            <label className="text-sm">Qualify by<select className="ui-control mt-1 w-full" value={rule.kind} onChange={event => update(index, { kind: event.target.value as BookingDiscountRule["kind"], min_bookings: rule.min_bookings ?? 2, window_days: rule.window_days ?? 30, min_days: rule.min_days ?? 90, max_days: rule.max_days ?? null })}>
              <option value="frequency">Bookings within a period</option><option value="recency">Time since last booking</option><option value="group">Group size</option>
            </select></label>
            <label className="text-sm">Discount (%)<input className="ui-control mt-1 w-full" type="number" min={0} max={100} step="1" required value={rule.percent} onChange={event => update(index, { percent: Number(event.target.value) })} /></label>
            {rule.kind === "frequency" && <>
              <label className="text-sm">Previous bookings required<input className="ui-control mt-1 w-full" type="number" min={1} max={10000} required value={rule.min_bookings ?? 2} onChange={event => update(index, { min_bookings: Number(event.target.value) })} /></label>
              <label className="text-sm">Within the last (days)<input className="ui-control mt-1 w-full" type="number" min={1} max={3650} required value={rule.window_days ?? 30} onChange={event => update(index, { window_days: Number(event.target.value) })} /></label>
            </>}
            {rule.kind === "recency" && <>
              <label className="text-sm">At least (days since last booking)<input className="ui-control mt-1 w-full" type="number" min={0} max={36500} required value={rule.min_days ?? 90} onChange={event => update(index, { min_days: Number(event.target.value) })} /></label>
              <label className="text-sm">At most (days, optional)<input className="ui-control mt-1 w-full" type="number" min={rule.min_days ?? 0} max={36500} placeholder="No maximum" value={rule.max_days ?? ""} onChange={event => update(index, { max_days: event.target.value === "" ? null : Number(event.target.value) })} /></label>
            </>}
            <label className="text-sm">Minimum guests<input className="ui-control mt-1 w-full" type="number" min={1} max={50} required value={rule.min_guests} onChange={event => update(index, { min_guests: Number(event.target.value) })} /></label>
            <label className="text-sm">Maximum guests (optional)<input className="ui-control mt-1 w-full" type="number" min={rule.min_guests} max={50} placeholder="No maximum" value={rule.max_guests ?? ""} onChange={event => update(index, { max_guests: event.target.value === "" ? null : Number(event.target.value) })} /></label>
          </div>
        </div>)}
        <div className="flex flex-wrap gap-3">
          <button type="button" className="ui-btn ui-btn-soft min-h-11" disabled={rules.length >= 20} onClick={() => setRules(previous => [...previous, { name: "Welcome-back offer", kind: "recency", enabled: false, percent: 10, min_guests: 1, max_guests: null, min_days: 90, max_days: null }])}>Add discount rule</button>
          <button type="submit" className="ui-btn ui-btn-primary min-h-11">{saving ? "Saving…" : "Save automatic discounts"}</button>
        </div>
      </fieldset>
    </form>}
  </section>;
}
