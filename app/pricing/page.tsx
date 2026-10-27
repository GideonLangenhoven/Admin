"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { confirmAction, notify } from "../lib/app-notify";
import { DatePicker } from "../../components/DatePicker";
import { useBusinessContext } from "../../components/BusinessContext";
import { Warning } from "@phosphor-icons/react";

export default function PeakPricingPage() {
  const { businessId } = useBusinessContext();
  const [tours, setTours] = useState<any[]>([]);
  const [peakRanges, setPeakRanges] = useState<any[]>([]);
  const [peakPeriods, setPeakPeriods] = useState<any[]>([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [peakPrices, setPeakPrices] = useState<Record<string, string>>({});
  const [basePrices, setBasePrices] = useState<Record<string, string>>({});
  const [priority, setPriority] = useState("0");
  const [periodLabel, setPeriodLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState("");
  const [resultIsError, setResultIsError] = useState(false);
  // Peak-period prices are separate from each tour's standard peak price, so
  // applying a period no longer rewrites the tour's own pricing.
  const [periodPrices, setPeriodPrices] = useState<Record<string, string>>({});
  const [editingPeriodId, setEditingPeriodId] = useState<string | null>(null);
  const [overlapWarning, setOverlapWarning] = useState("");

  useEffect(() => { load(); }, [businessId]);

  // Check for overlapping peak periods whenever dates change
  useEffect(() => {
    if (!startDate || !endDate || peakPeriods.length === 0) { setOverlapWarning(""); return; }
    const s = new Date(startDate);
    const e = new Date(endDate);
    const overlaps = peakPeriods.filter((p: any) => {
      if (p.id === editingPeriodId) return false;
      const ps = new Date(p.start_date);
      const pe = new Date(p.end_date);
      return s <= pe && e >= ps; // date ranges overlap
    });
    if (overlaps.length > 0) {
      const labels = overlaps.map((o: any) => (o.label || "Unnamed") + " (" + o.start_date + " to " + o.end_date + ", priority " + o.priority + ")").join("; ");
      setOverlapWarning("Overlapping periods: " + labels + ". The highest priority rule will take precedence for overlapping dates.");
    } else {
      setOverlapWarning("");
    }
  }, [startDate, endDate, peakPeriods, editingPeriodId]);

  async function load() {
    const { data: t } = await supabase.from("tours").select("id, name, base_price_per_person, peak_price_per_person").eq("business_id", businessId).eq("active", true).order("sort_order");
    setTours((t || []).filter((x: any) => !x.name.includes("Private")));

    // Load peak periods from new table
    const { data: periods } = await supabase.from("peak_periods")
      .select("id, label, start_date, end_date, priority, created_at, peak_period_prices(tour_id, price_per_person)")
      .eq("business_id", businessId)
      .order("start_date", { ascending: true });
    setPeakPeriods(periods || []);

    // Also get existing peak slots grouped by date range (legacy view)
    const { data: peakSlots } = await supabase.from("slots").select("id, start_time, tour_id, is_peak, price_per_person_override")
      .eq("business_id", businessId).eq("is_peak", true).order("start_time", { ascending: true }).limit(500);

    // Group into date ranges
    const ranges: any[] = [];
    let current: any = null;
    for (const s of (peakSlots || [])) {
      const d = new Date(s.start_time).toISOString().split("T")[0];
      if (!current || d !== current.endDate) {
        if (current && new Date(d).getTime() - new Date(current.endDate).getTime() <= 86400000) {
          current.endDate = d;
          current.count++;
        } else {
          if (current) ranges.push(current);
          current = { startDate: d, endDate: d, price: s.price_per_person_override, count: 1 };
        }
      } else {
        current.count++;
      }
    }
    if (current) ranges.push(current);
    setPeakRanges(ranges);
    setLoading(false);
  }

  function showResult(text: string, isError = false) {
    setResult(text);
    setResultIsError(isError);
  }

  function resetPeakForm() {
    setEditingPeriodId(null);
    setStartDate("");
    setEndDate("");
    setPeriodLabel("");
    setPriority("0");
    setPeriodPrices({});
  }

  function startEditPeakPeriod(period: any) {
    setEditingPeriodId(period.id);
    setStartDate(period.start_date);
    setEndDate(period.end_date);
    setPeriodLabel(period.label || "");
    setPriority(String(period.priority ?? 0));
    setPeriodPrices(Object.fromEntries((period.peak_period_prices || []).map((pp: any) => [pp.tour_id, String(pp.price_per_person)])));
    setResult("");
    document.getElementById("set-peak-period")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Period, per-tour prices and slot prices are saved in one transaction by
  // save_peak_period, so a failure can no longer leave half-applied pricing.
  async function applyPeakPricing() {
    if (!startDate || !endDate) return;
    if (startDate > endDate) { showResult("Choose an end date on or after the start date.", true); return; }
    setSaving(true);
    setResult("");

    const priorityVal = Number(priority) || 0;
    const prices = tours.map((tour) => ({
      tour_id: tour.id,
      price_per_person: Number(periodPrices[tour.id] || tour.peak_price_per_person || tour.base_price_per_person),
    }));
    const { data, error } = await supabase.rpc("save_peak_period", {
      p_business_id: businessId,
      p_period_id: editingPeriodId,
      p_label: periodLabel.trim() || (startDate + " to " + endDate),
      p_start: startDate,
      p_end: endDate,
      p_priority: priorityVal,
      p_prices: prices,
    });
    setSaving(false);

    if (error || !data?.ok) {
      console.error("save_peak_period failed", error || data);
      const message = data?.error || "The peak period could not be saved. Please try again, or contact support if it keeps happening.";
      notify({ title: "Peak period not saved", message, tone: "error", duration: 7000 });
      showResult(message, true);
      return;
    }

    const updated = Number(data.slots_updated) || 0;
    const verb = editingPeriodId ? "updated" : "saved";
    if (updated === 0) {
      notify({
        title: "Peak period " + verb + ", no open slots changed",
        message: "No unbooked slots exist in " + startDate + " to " + endDate + " yet. Slots created later for these dates get the peak price automatically.",
        tone: "warning",
        duration: 7000,
      });
      showResult("Peak period " + verb + ". 0 existing slots updated (applies automatically to slots created in " + startDate + " to " + endDate + ").");
    } else {
      notify({
        title: "Peak pricing applied",
        message: "Updated " + updated + " slot" + (updated === 1 ? "" : "s") + " between " + startDate + " and " + endDate + " (priority " + priorityVal + ").",
        tone: "success",
        duration: 5000,
      });
      showResult("Applied peak pricing to " + updated + " slots (" + startDate + " to " + endDate + ", priority " + priorityVal + ")");
    }
    resetPeakForm();
    load();
  }

  async function saveTourPricing() {
    setSaving(true);
    setResult("");
    for (const tour of tours) {
      const nextBase = basePrices[tour.id] !== undefined ? Number(basePrices[tour.id] || 0) : Number(tour.base_price_per_person || 0);
      const nextPeak = peakPrices[tour.id] !== undefined ? Number(peakPrices[tour.id] || 0) : Number(tour.peak_price_per_person || tour.base_price_per_person || 0);
      await supabase.from("tours").update({
        base_price_per_person: nextBase,
        peak_price_per_person: nextPeak,
      }).eq("id", tour.id);
    }
    showResult("Tour pricing updated.");
    setSaving(false);
    load();
  }

  async function removePeakPeriod(periodId: string, startD: string, endD: string) {
    if (!await confirmAction({
      title: "Remove peak pricing",
      message: "Remove peak pricing for " + startD + " to " + endD + "? Affected slots return to base pricing unless another peak period covers them.",
      tone: "warning",
      confirmLabel: "Remove range",
    })) return;
    const { data, error } = await supabase.rpc("delete_peak_period", { p_period_id: periodId });
    if (error || !data?.ok) {
      console.error("delete_peak_period failed", error || data);
      notify({ title: "Peak pricing not removed", message: data?.error || "The peak period could not be removed. Please try again.", tone: "error" });
      return;
    }
    if (editingPeriodId === periodId) resetPeakForm();
    notify({ title: "Peak pricing removed", message: "The selected seasonal range has been cleared.", tone: "success" });
    load();
  }

  async function removePeakRange(startD: string, endD: string) {
    if (!await confirmAction({
      title: "Remove peak pricing",
      message: "Remove peak pricing for " + startD + " to " + endD + "?",
      tone: "warning",
      confirmLabel: "Remove range",
    })) return;
    const start = new Date(startD);
    const end = new Date(endD);
    end.setDate(end.getDate() + 1);

    const { data: slots } = await supabase.from("slots").select("id, is_manually_overridden")
      .eq("business_id", businessId)
      .eq("is_peak", true)
      .gte("start_time", start.toISOString())
      .lt("start_time", end.toISOString());

    for (const s of (slots || [])) {
      if (s.is_manually_overridden) continue;
      await supabase.from("slots").update({ is_peak: false, price_per_person_override: null, last_minute_at: null }).eq("id", s.id);
    }
    notify({ title: "Peak pricing removed", message: "The selected seasonal range has been cleared.", tone: "success" });
    load();
  }

  if (loading) return <div className="space-y-4 py-2"><div className="ui-skeleton h-8 w-48" /><div className="ui-skeleton h-[140px] !rounded-2xl" /><div className="ui-skeleton h-[320px] !rounded-2xl" /></div>;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="anim-fade-up">
        <p className="ui-mono-label mb-2">Revenue</p>
        <h1 className="font-display text-[28px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}>Pricing Management</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--ck-text-muted)" }}>Set base rates and seasonal prices.</p>
      </div>

      <div className="anim-fade-up anim-d1 ui-card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--ck-text-strong)" }}>Tour rate table</h2>
            <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>Seasonal prices override the base rate for the dates you choose.</p>
          </div>
          <button data-demo-action="pricing.save" onClick={saveTourPricing} disabled={saving} className="ui-btn ui-btn-primary disabled:opacity-50">
            {saving ? "Saving..." : "Save tour prices"}
          </button>
        </div>

        <div className="ui-table-container mt-4 overflow-x-auto rounded-xl border" style={{ borderColor: "var(--ck-border-subtle)" }}>
          <table role="table" className="ui-responsive-table w-full text-sm">
            <thead style={{ background: "var(--ck-surface-sunken)" }}>
              <tr>
                <th scope="col" className="p-3 text-left text-[10.5px] font-medium uppercase tracking-[0.1em]" style={{ color: "var(--ck-text-muted)" }}>Tour</th>
                <th scope="col" className="p-3 text-left text-[10.5px] font-medium uppercase tracking-[0.1em]" style={{ color: "var(--ck-text-muted)" }}>Base price</th>
                <th scope="col" className="p-3 text-left text-[10.5px] font-medium uppercase tracking-[0.1em]" style={{ color: "var(--ck-amber)" }}>Peak price</th>
                <th scope="col" className="p-3 text-left text-[10.5px] font-medium uppercase tracking-[0.1em]" style={{ color: "var(--ck-text-muted)" }}>Current spread</th>
              </tr>
            </thead>
            <tbody>
              {tours.map((tour) => {
                const base = basePrices[tour.id] !== undefined ? basePrices[tour.id] : String(tour.base_price_per_person || "");
                const peak = peakPrices[tour.id] !== undefined ? peakPrices[tour.id] : String(tour.peak_price_per_person || tour.base_price_per_person || "");
                return (
                  <tr key={tour.id} className="border-t" style={{ borderColor: "var(--ck-border-subtle)" }}>
                    <td data-label="Tour" className="p-3 font-medium" style={{ color: "var(--ck-text-strong)" }}>{tour.name}</td>
                    <td data-label="Base price" className="p-3">
                      <input type="number" value={base} onChange={(e) => setBasePrices({ ...basePrices, [tour.id]: e.target.value })} className="ui-control w-32 tabular-nums" />
                    </td>
                    <td data-label="Peak price" className="p-3">
                      <input type="number" value={peak} onChange={(e) => setPeakPrices({ ...peakPrices, [tour.id]: e.target.value })} className="ui-control w-32 tabular-nums" />
                    </td>
                    <td data-label="Current spread" className="p-3" style={{ color: "var(--ck-text-muted)" }}>
                      <span className="font-mono tabular-nums" style={{ color: "var(--ck-amber)" }}>R{Math.max(Number(peak || 0) - Number(base || 0), 0).toFixed(2)}</span> uplift during peak dates
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Set Peak Period */}
      <div id="set-peak-period" className="anim-fade-up anim-d2 ui-card p-5 mb-6">
        <h2 className="text-[15px] font-semibold tracking-tight mb-4" style={{ color: "var(--ck-text-strong)" }}>{editingPeriodId ? "Edit Peak Period" : "Set Peak Period"}</h2>
        <div className="grid gap-4 md:grid-cols-2 mb-4">
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: "var(--ck-text-muted)" }}>Start Date</label>
            <DatePicker value={startDate} onChange={setStartDate} className="py-2.5" />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: "var(--ck-text-muted)" }}>End Date</label>
            <DatePicker alignRight={true} value={endDate} onChange={setEndDate} className="py-2.5" />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 mb-4">
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: "var(--ck-text-muted)" }}>Label (optional)</label>
            <input type="text" value={periodLabel} onChange={e => setPeriodLabel(e.target.value)}
              placeholder="e.g. Christmas Peak, Easter Weekend"
              className="ui-control w-full" />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: "var(--ck-text-muted)" }}>Priority (higher = takes precedence)</label>
            <input type="number" value={priority} onChange={e => setPriority(e.target.value)}
              min="0" step="1"
              className="ui-control w-full tabular-nums" />
            <p className="text-xs mt-1" style={{ color: "var(--ck-text-muted)" }}>Overlapping dates use the highest-priority rule.</p>
          </div>
        </div>

        {overlapWarning && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border p-3" style={{ background: "var(--ck-amber-soft)", borderColor: "color-mix(in srgb, var(--ck-amber) 25%, transparent)" }}>
            <span className="mt-0.5 shrink-0" style={{ color: "var(--ck-amber)" }}><Warning size={16} weight="fill" /></span>
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--ck-amber)" }}>Date range overlap detected</p>
              <p className="text-xs mt-1" style={{ color: "var(--ck-amber)" }}>{overlapWarning}</p>
            </div>
          </div>
        )}

        <div className="space-y-3 mb-4">
          {tours.map(t => (
            <div key={t.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center" style={{ background: "var(--ck-amber-soft)", borderColor: "color-mix(in srgb, var(--ck-amber) 20%, transparent)" }}>
              <div className="flex-1">
                <p className="font-semibold text-sm" style={{ color: "var(--ck-text-strong)" }}>{t.name}</p>
                <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>Normal: R{t.base_price_per_person}</p>
              </div>
              <div className="w-full sm:w-32">
                <label className="text-xs block mb-1 font-medium" style={{ color: "var(--ck-amber)" }}>Peak Price</label>
                <input type="number" value={periodPrices[t.id] ?? String(t.peak_price_per_person ?? "")}
                  onChange={e => setPeriodPrices({ ...periodPrices, [t.id]: e.target.value })}
                  placeholder={"R" + t.base_price_per_person}
                  className="ui-control w-full tabular-nums" />
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button data-demo-action="pricing.apply" onClick={applyPeakPricing} disabled={saving || !startDate || !endDate}
            className="ui-btn ui-btn-primary w-full disabled:opacity-50">
            {saving ? "Applying..." : editingPeriodId ? "Update Peak Pricing" : "Apply Peak Pricing"}
          </button>
          {editingPeriodId && (
            <button onClick={resetPeakForm} disabled={saving} className="ui-btn ui-btn-ghost sm:w-40">Cancel edit</button>
          )}
        </div>
        {result && <p role={resultIsError ? "alert" : "status"} className="mt-3 flex items-center gap-1.5 text-sm" style={{ color: resultIsError ? "var(--ck-danger)" : "var(--ck-success)" }}>{result}</p>}
      </div>

      {/* Active Peak Periods (from peak_periods table) */}
      {peakPeriods.length > 0 && (
        <div className="anim-fade-up anim-d3 ui-card p-5">
          <h2 className="text-[15px] font-semibold tracking-tight mb-4" style={{ color: "var(--ck-text-strong)" }}>Peak Period Rules</h2>
          <div className="space-y-2">
            {peakPeriods.map((p: any) => (
              <div key={p.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between" style={{ background: "var(--ck-amber-soft)", borderColor: "color-mix(in srgb, var(--ck-amber) 22%, transparent)" }}>
                <div>
                  <p className="flex items-center gap-2 font-semibold text-sm" style={{ color: "var(--ck-text-strong)" }}>
                    {p.label || "Peak Period"}
                    <span className="ui-status ui-pill-amber">Priority {p.priority}</span>
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--ck-text-muted)" }}>
                    {new Date(p.start_date + "T00:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "short" })} to {new Date(p.end_date + "T00:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                  {(p.peak_period_prices || []).length > 0 && (
                    <p className="text-xs mt-0.5" style={{ color: "var(--ck-text-muted)" }}>
                      {(p.peak_period_prices || []).map((pp: any) => {
                        const tour = tours.find(t => t.id === pp.tour_id);
                        return tour ? tour.name + ": R" + pp.price_per_person : null;
                      }).filter(Boolean).join(" | ")}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button data-demo-action="pricing.edit" onClick={() => startEditPeakPeriod(p)}
                    className="ui-btn ui-btn-ghost !h-8 !px-3 text-xs">
                    Edit
                  </button>
                  <button data-demo-action="pricing.remove" onClick={() => removePeakPeriod(p.id, p.start_date, p.end_date)}
                    className="ui-btn ui-btn-danger !h-8 !px-3 text-xs gap-1.5">
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Peak Slots (legacy view from slot flags) */}
      <div className="anim-fade-up anim-d3 ui-card p-5">
        <h2 className="text-[15px] font-semibold tracking-tight mb-4" style={{ color: "var(--ck-text-strong)" }}>Active Peak Slots</h2>
        {peakRanges.length === 0 ? (
          <div className="ui-empty">
            <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No peak pricing set</p>
            <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Add seasonal dates above for peak pricing.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {peakRanges.map((r, i) => (
              <div key={i} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between" style={{ background: "var(--ck-amber-soft)", borderColor: "color-mix(in srgb, var(--ck-amber) 22%, transparent)" }}>
                <div>
                  <p className="font-semibold text-sm" style={{ color: "var(--ck-text-strong)" }}>
                    {new Date(r.startDate).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })} to {new Date(r.endDate).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                  <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{r.count} slots {r.price ? "@ R" + r.price : ""}</p>
                </div>
                <button data-demo-action="pricing.remove" onClick={() => removePeakRange(r.startDate, r.endDate)}
                  className="ui-btn ui-btn-danger !h-8 !px-3 text-xs gap-1.5">
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
