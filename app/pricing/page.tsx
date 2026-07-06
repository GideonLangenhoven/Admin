"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { confirmAction, notify } from "../lib/app-notify";
import { DatePicker } from "../../components/DatePicker";
import { useBusinessContext } from "../../components/BusinessContext";
import { FloppyDisk, TrendUp, Trash, Warning, Tag, CheckCircle } from "@phosphor-icons/react";

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
  const [overlapWarning, setOverlapWarning] = useState("");

  useEffect(() => { load(); }, [businessId]);

  // Check for overlapping peak periods whenever dates change
  useEffect(() => {
    if (!startDate || !endDate || peakPeriods.length === 0) { setOverlapWarning(""); return; }
    const s = new Date(startDate);
    const e = new Date(endDate);
    const overlaps = peakPeriods.filter((p: any) => {
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
  }, [startDate, endDate, peakPeriods]);

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

  async function applyPeakPricing() {
    if (!startDate || !endDate) return;
    if (new Date(startDate) > new Date(endDate)) { setResult("Start date must be before end date."); return; }
    setSaving(true);
    setResult("");

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setDate(end.getDate() + 1); // inclusive

    const priorityVal = Number(priority) || 0;

    // Save peak period record
    const { data: period, error: periodErr } = await supabase.from("peak_periods").insert({
      business_id: businessId,
      label: periodLabel.trim() || (startDate + " to " + endDate),
      start_date: startDate,
      end_date: endDate,
      priority: priorityVal,
    }).select().single();

    if (periodErr) {
      setResult("Failed to save peak period: " + periodErr.message);
      setSaving(false);
      return;
    }

    // Save per-tour prices for this period
    const periodPriceRows: any[] = [];
    for (const tour of tours) {
      const price = peakPrices[tour.id] ? Number(peakPrices[tour.id]) : (tour.peak_price_per_person || tour.base_price_per_person);
      periodPriceRows.push({ peak_period_id: period.id, tour_id: tour.id, price_per_person: price });
    }
    if (periodPriceRows.length > 0) {
      await supabase.from("peak_period_prices").insert(periodPriceRows);
    }

    // For each slot in range, determine the winning peak period (highest priority)
    // and apply its price
    let updated = 0;
    for (const tour of tours) {
      const price = peakPrices[tour.id] ? Number(peakPrices[tour.id]) : (tour.peak_price_per_person || tour.base_price_per_person);

      // Also save peak price on tour
      await supabase.from("tours").update({ peak_price_per_person: price }).eq("id", tour.id);

      const { data: slots } = await supabase.from("slots").select("id, start_time, is_manually_overridden")
        .eq("business_id", businessId)
        .eq("tour_id", tour.id)
        .gte("start_time", start.toISOString())
        .lt("start_time", end.toISOString());

      for (const s of (slots || [])) {
        // Skip manually overridden slots
        if (s.is_manually_overridden) continue;

        // Skip slots that have CONFIRMED or PAID bookings (grandfathering)
        const { count } = await supabase.from("bookings")
          .select("id", { count: "exact", head: true })
          .eq("slot_id", s.id)
          .in("status", ["CONFIRMED", "PAID"]);
        if ((count || 0) > 0) continue;

        // Determine which peak period has the highest priority for this slot's date
        const slotDate = new Date(s.start_time).toISOString().split("T")[0];
        let winningPrice = price; // default to current period's price

        // Check all peak periods that cover this date
        const applicablePeriods = peakPeriods.filter((p: any) => slotDate >= p.start_date && slotDate <= p.end_date);
        // Include the period we just created
        applicablePeriods.push({ ...period, peak_period_prices: periodPriceRows.map(r => ({ tour_id: r.tour_id, price_per_person: r.price_per_person })) });

        // Sort by priority descending — highest wins
        applicablePeriods.sort((a: any, b: any) => (b.priority || 0) - (a.priority || 0));

        if (applicablePeriods.length > 0) {
          const winner = applicablePeriods[0];
          const tourPrice = (winner.peak_period_prices || []).find((pp: any) => pp.tour_id === tour.id);
          if (tourPrice) {
            winningPrice = Number(tourPrice.price_per_person);
          }
        }

        await supabase.from("slots").update({ is_peak: true, price_per_person_override: winningPrice }).eq("id", s.id);
        updated++;
      }
    }

    if (updated === 0) {
      notify({
        title: "Peak period saved — but 0 slots existed",
        message: "No slots existed in " + startDate + " to " + endDate + " yet. The pricing rule is stored and will apply automatically when slots are created for these dates.",
        tone: "warning",
        duration: 7000,
      });
      setResult("Peak period saved. 0 existing slots updated (will apply on slot creation in " + startDate + " to " + endDate + ").");
    } else {
      notify({
        title: "Peak pricing applied",
        message: "Updated " + updated + " slot" + (updated === 1 ? "" : "s") + " between " + startDate + " and " + endDate + " (priority " + priorityVal + ").",
        tone: "success",
        duration: 5000,
      });
      setResult("Applied peak pricing to " + updated + " slots (" + startDate + " to " + endDate + ", priority " + priorityVal + ")");
    }
    setPeriodLabel("");
    setPriority("0");
    // T-4: Reset per-tour peak prices so the next submission starts from the
    // configured tour defaults rather than the last-applied values.
    const resetPeak: Record<string, string> = {};
    for (const tour of tours) {
      resetPeak[tour.id] = String(tour.peak_price_per_person ?? tour.base_price_per_person ?? "");
    }
    setPeakPrices(resetPeak);
    setSaving(false);
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
    setResult("Tour pricing updated.");
    setSaving(false);
    load();
  }

  async function removePeakPeriod(periodId: string, startD: string, endD: string) {
    if (!await confirmAction({
      title: "Remove peak pricing",
      message: "Remove peak pricing for " + startD + " to " + endD + "? This will revert affected slots to base pricing.",
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
      // Skip manually overridden slots
      if (s.is_manually_overridden) continue;
      await supabase.from("slots").update({ is_peak: false, price_per_person_override: null }).eq("id", s.id);
    }

    // Delete the peak period record
    await supabase.from("peak_periods").delete().eq("id", periodId);

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
      await supabase.from("slots").update({ is_peak: false, price_per_person_override: null }).eq("id", s.id);
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
        <p className="mt-1 text-sm" style={{ color: "var(--ck-text-muted)" }}>Manage base rates per activity and apply date-range seasonal overrides for peak periods.</p>
      </div>

      <div className="anim-fade-up anim-d1 ui-card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--ck-text-strong)" }}>Tour rate table</h2>
            <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>Base pricing is your always-on rate. Peak pricing is used when you apply a seasonal range below.</p>
          </div>
          <button onClick={saveTourPricing} disabled={saving} className="ui-btn ui-btn-primary disabled:opacity-50">
            <FloppyDisk size={15} /> {saving ? "Saving..." : "Save tour prices"}
          </button>
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border" style={{ borderColor: "var(--ck-border-subtle)" }}>
          <table className="w-full text-sm">
            <thead style={{ background: "var(--ck-surface-sunken)" }}>
              <tr>
                <th className="p-3 text-left text-[10.5px] font-medium uppercase tracking-[0.1em]" style={{ color: "var(--ck-text-muted)" }}>Tour</th>
                <th className="p-3 text-left text-[10.5px] font-medium uppercase tracking-[0.1em]" style={{ color: "var(--ck-text-muted)" }}>Base price</th>
                <th className="p-3 text-left text-[10.5px] font-medium uppercase tracking-[0.1em]" style={{ color: "var(--ck-amber)" }}>Peak price</th>
                <th className="p-3 text-left text-[10.5px] font-medium uppercase tracking-[0.1em]" style={{ color: "var(--ck-text-muted)" }}>Current spread</th>
              </tr>
            </thead>
            <tbody>
              {tours.map((tour) => {
                const base = basePrices[tour.id] !== undefined ? basePrices[tour.id] : String(tour.base_price_per_person || "");
                const peak = peakPrices[tour.id] !== undefined ? peakPrices[tour.id] : String(tour.peak_price_per_person || tour.base_price_per_person || "");
                return (
                  <tr key={tour.id} className="border-t" style={{ borderColor: "var(--ck-border-subtle)" }}>
                    <td className="p-3 font-medium" style={{ color: "var(--ck-text-strong)" }}>{tour.name}</td>
                    <td className="p-3">
                      <input type="number" value={base} onChange={(e) => setBasePrices({ ...basePrices, [tour.id]: e.target.value })} className="ui-control w-32 tabular-nums" />
                    </td>
                    <td className="p-3">
                      <input type="number" value={peak} onChange={(e) => setPeakPrices({ ...peakPrices, [tour.id]: e.target.value })} className="ui-control w-32 tabular-nums" />
                    </td>
                    <td className="p-3" style={{ color: "var(--ck-text-muted)" }}>
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
      <div className="anim-fade-up anim-d2 ui-card p-5 mb-6">
        <h2 className="text-[15px] font-semibold tracking-tight mb-4" style={{ color: "var(--ck-text-strong)" }}>Set Peak Period</h2>
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
            <p className="text-xs mt-1" style={{ color: "var(--ck-text-muted)" }}>If date ranges overlap, the rule with the highest priority wins.</p>
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
                <input type="number" value={peakPrices[t.id] || t.peak_price_per_person || ""}
                  onChange={e => setPeakPrices({ ...peakPrices, [t.id]: e.target.value })}
                  placeholder={"R" + t.base_price_per_person}
                  className="ui-control w-full tabular-nums" />
              </div>
            </div>
          ))}
        </div>

        <button onClick={applyPeakPricing} disabled={saving || !startDate || !endDate}
          className="ui-btn ui-btn-primary w-full disabled:opacity-50">
          <TrendUp size={15} /> {saving ? "Applying..." : "Apply Peak Pricing"}
        </button>
        {result && <p className="mt-3 flex items-center gap-1.5 text-sm" style={{ color: "var(--ck-success)" }}><CheckCircle size={15} weight="fill" /> {result}</p>}
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
                    {new Date(p.start_date + "T00:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "short" })} — {new Date(p.end_date + "T00:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
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
                <button onClick={() => removePeakPeriod(p.id, p.start_date, p.end_date)}
                  className="ui-btn ui-btn-danger !h-8 !px-3 text-xs gap-1.5">
                  <Trash size={14} /> Remove
                </button>
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
            <span className="ui-icon-chip"><Tag size={19} /></span>
            <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No peak pricing set</p>
            <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Apply a seasonal range above to mark slots as peak.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {peakRanges.map((r, i) => (
              <div key={i} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between" style={{ background: "var(--ck-amber-soft)", borderColor: "color-mix(in srgb, var(--ck-amber) 22%, transparent)" }}>
                <div>
                  <p className="font-semibold text-sm" style={{ color: "var(--ck-text-strong)" }}>
                    {new Date(r.startDate).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })} — {new Date(r.endDate).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                  <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{r.count} slots {r.price ? "@ R" + r.price : ""}</p>
                </div>
                <button onClick={() => removePeakRange(r.startDate, r.endDate)}
                  className="ui-btn ui-btn-danger !h-8 !px-3 text-xs gap-1.5">
                  <Trash size={14} /> Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
