"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { confirmAction, notify } from "../lib/app-notify";
import { DatePicker } from "../../components/DatePicker";
import { useBusinessContext } from "../../components/BusinessContext";

export default function PeakPricingPage() {
  var { businessId } = useBusinessContext();
  var [tours, setTours] = useState<any[]>([]);
  var [peakRanges, setPeakRanges] = useState<any[]>([]);
  var [startDate, setStartDate] = useState("");
  var [endDate, setEndDate] = useState("");
  var [peakPrices, setPeakPrices] = useState<Record<string, string>>({});
  var [basePrices, setBasePrices] = useState<Record<string, string>>({});
  var [saving, setSaving] = useState(false);
  var [loading, setLoading] = useState(true);
  var [result, setResult] = useState("");

  useEffect(() => { load(); }, [businessId]);

  async function load() {
    var { data: t } = await supabase.from("tours").select("id, name, base_price_per_person, peak_price_per_person").eq("business_id", businessId).eq("active", true).order("sort_order");
    setTours((t || []).filter((x: any) => !x.name.includes("Private")));

    // Get existing peak slots grouped by date range
    var { data: peakSlots } = await supabase.from("slots").select("id, start_time, tour_id, is_peak, price_per_person_override")
      .eq("business_id", businessId).eq("is_peak", true).order("start_time", { ascending: true }).limit(500);

    // Group into date ranges
    var ranges: any[] = [];
    var current: any = null;
    for (var s of (peakSlots || [])) {
      var d = new Date(s.start_time).toISOString().split("T")[0];
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
    setSaving(true);
    setResult("");

    var start = new Date(startDate);
    var end = new Date(endDate);
    end.setDate(end.getDate() + 1); // inclusive

    // Update all slots in range
    var updated = 0;
    for (var tour of tours) {
      var price = peakPrices[tour.id] ? Number(peakPrices[tour.id]) : (tour.peak_price_per_person || tour.base_price_per_person);

      // Also save peak price on tour
      await supabase.from("tours").update({ peak_price_per_person: price }).eq("id", tour.id);

      var { data: slots } = await supabase.from("slots").select("id, start_time")
        .eq("business_id", businessId)
        .eq("tour_id", tour.id)
        .gte("start_time", start.toISOString())
        .lt("start_time", end.toISOString());

      for (var s of (slots || [])) {
        await supabase.from("slots").update({ is_peak: true, price_per_person_override: price }).eq("id", s.id);
        updated++;
      }
    }

    setResult("✅ Applied peak pricing to " + updated + " slots (" + startDate + " to " + endDate + ")");
    setSaving(false);
    load();
  }

  async function saveTourPricing() {
    setSaving(true);
    setResult("");
    for (var tour of tours) {
      var nextBase = basePrices[tour.id] !== undefined ? Number(basePrices[tour.id] || 0) : Number(tour.base_price_per_person || 0);
      var nextPeak = peakPrices[tour.id] !== undefined ? Number(peakPrices[tour.id] || 0) : Number(tour.peak_price_per_person || tour.base_price_per_person || 0);
      await supabase.from("tours").update({
        base_price_per_person: nextBase,
        peak_price_per_person: nextPeak,
      }).eq("id", tour.id);
    }
    setResult("✅ Tour pricing updated.");
    setSaving(false);
    load();
  }

  async function removePeakRange(startD: string, endD: string) {
    if (!await confirmAction({
      title: "Remove peak pricing",
      message: "Remove peak pricing for " + startD + " to " + endD + "?",
      tone: "warning",
      confirmLabel: "Remove range",
    })) return;
    var start = new Date(startD);
    var end = new Date(endD);
    end.setDate(end.getDate() + 1);

    var { data: slots } = await supabase.from("slots").select("id")
      .eq("business_id", businessId)
      .eq("is_peak", true)
      .gte("start_time", start.toISOString())
      .lt("start_time", end.toISOString());

    for (var s of (slots || [])) {
      await supabase.from("slots").update({ is_peak: false, price_per_person_override: null }).eq("id", s.id);
    }
    notify({ title: "Peak pricing removed", message: "The selected seasonal range has been cleared.", tone: "success" });
    load();
  }

  if (loading) return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" /></div>;

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">💲 Pricing Management</h1>
        <p className="text-sm text-gray-500">Manage base rates per activity and apply date-range seasonal overrides for peak periods.</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-lg text-gray-900">Tour rate table</h2>
            <p className="text-sm text-gray-500">Base pricing is your always-on rate. Peak pricing is used when you apply a seasonal range below.</p>
          </div>
          <button onClick={saveTourPricing} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
            {saving ? "Saving..." : "Save tour prices"}
          </button>
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-3 text-left font-medium text-gray-600">Tour</th>
                <th className="p-3 text-left font-medium text-gray-600">Base price</th>
                <th className="p-3 text-left font-medium text-gray-600">Peak price</th>
                <th className="p-3 text-left font-medium text-gray-600">Current spread</th>
              </tr>
            </thead>
            <tbody>
              {tours.map((tour) => {
                var base = basePrices[tour.id] !== undefined ? basePrices[tour.id] : String(tour.base_price_per_person || "");
                var peak = peakPrices[tour.id] !== undefined ? peakPrices[tour.id] : String(tour.peak_price_per_person || tour.base_price_per_person || "");
                return (
                  <tr key={tour.id} className="border-t border-gray-100">
                    <td className="p-3 font-medium text-gray-900">{tour.name}</td>
                    <td className="p-3">
                      <input type="number" value={base} onChange={(e) => setBasePrices({ ...basePrices, [tour.id]: e.target.value })} className="w-32 rounded-lg border border-gray-300 px-3 py-2" />
                    </td>
                    <td className="p-3">
                      <input type="number" value={peak} onChange={(e) => setPeakPrices({ ...peakPrices, [tour.id]: e.target.value })} className="w-32 rounded-lg border border-gray-300 px-3 py-2" />
                    </td>
                    <td className="p-3 text-gray-500">
                      R{Math.max(Number(peak || 0) - Number(base || 0), 0).toFixed(2)} uplift during peak dates
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Set Peak Period */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <h2 className="font-semibold text-lg mb-4">Set Peak Period</h2>
        <div className="grid gap-4 md:grid-cols-2 mb-4">
          <div>
            <label className="text-xs text-gray-500 font-medium block mb-1">Start Date</label>
            <DatePicker value={startDate} onChange={setStartDate} className="py-2.5" />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-medium block mb-1">End Date</label>
            <DatePicker alignRight={true} value={endDate} onChange={setEndDate} className="py-2.5" />
          </div>
        </div>

        <div className="space-y-3 mb-4">
          {tours.map(t => (
            <div key={t.id} className="flex flex-col gap-3 rounded-lg border border-gray-100 p-3 sm:flex-row sm:items-center">
              <div className="flex-1">
                <p className="font-semibold text-sm">{t.name}</p>
                <p className="text-xs text-gray-400">Normal: R{t.base_price_per_person}</p>
              </div>
              <div className="w-full sm:w-32">
                <label className="text-xs text-gray-500 block mb-1">Peak Price</label>
                <input type="number" value={peakPrices[t.id] || t.peak_price_per_person || ""}
                  onChange={e => setPeakPrices({ ...peakPrices, [t.id]: e.target.value })}
                  placeholder={"R" + t.base_price_per_person}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
              </div>
            </div>
          ))}
        </div>

        <button onClick={applyPeakPricing} disabled={saving || !startDate || !endDate}
          className="w-full bg-gray-900 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-gray-800 disabled:opacity-50">
          {saving ? "Applying..." : "💲 Apply Peak Pricing"}
        </button>
        {result && <p className="text-sm text-emerald-600 mt-3">{result}</p>}
      </div>

      {/* Active Peak Periods */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="font-semibold text-lg mb-4">Active Peak Periods</h2>
        {peakRanges.length === 0 ? (
          <p className="text-sm text-gray-400">No peak pricing set.</p>
        ) : (
          <div className="space-y-2">
            {peakRanges.map((r, i) => (
              <div key={i} className="flex flex-col gap-3 rounded-lg border border-gray-100 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold text-sm">
                    {new Date(r.startDate).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })} — {new Date(r.endDate).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                  <p className="text-xs text-gray-400">{r.count} slots {r.price ? "@ R" + r.price : ""}</p>
                </div>
                <button onClick={() => removePeakRange(r.startDate, r.endDate)}
                  className="text-xs text-red-600 hover:text-red-800 font-medium px-3 py-1 border border-red-200 rounded-lg hover:bg-red-50">
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
