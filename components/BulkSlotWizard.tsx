"use client";
import { useState, useMemo } from "react";
import { generateSlotsForTour, GenSpec, GenResult } from "@/app/lib/slot-generation";
import { useBusinessContext } from "./BusinessContext";

type Tour = { id: string; name: string; default_capacity?: number };

export default function BulkSlotWizard({ tours, onClose }: { tours: Tour[]; onClose: () => void }) {
  const { businessId } = useBusinessContext();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const today = new Date();
  const ninety = new Date(); ninety.setDate(ninety.getDate() + 90);
  // Multiple ranges so seasonal availability (e.g. 1–3 Mar AND 20–23 Mar) is
  // one generation run instead of several.
  const [ranges, setRanges] = useState<Array<{ start: string; end: string }>>([
    { start: today.toISOString().slice(0, 10), end: ninety.toISOString().slice(0, 10) },
  ]);
  const [times, setTimes] = useState<string[]>(["06:00", "08:30"]);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [defaultCapacity, setDefaultCapacity] = useState<number>(10);

  const [overrides, setOverrides] = useState<Record<string, Partial<GenSpec>>>({});
  const [progress, setProgress] = useState<GenResult[] | null>(null);
  const [running, setRunning] = useState(false);

  const previewTotal = useMemo(() => {
    if (selected.size === 0) return 0;
    let total = 0;
    const seen = new Set<string>(); // overlapping ranges shouldn't double-count
    for (const range of ranges) {
      if (!range.start || !range.end) continue;
      const s = new Date(range.start + "T00:00:00");
      const e = new Date(range.end + "T00:00:00");
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        if (!days.includes(d.getDay())) continue;
        const key = d.toISOString().slice(0, 10);
        if (seen.has(key)) continue;
        seen.add(key);
        total += times.length * selected.size;
      }
    }
    return total;
  }, [selected, ranges, times, days]);

  async function runGenerate() {
    if (!businessId) return;
    const validRanges = ranges.filter(r => r.start && r.end);
    const tourIds = Array.from(selected);

    setRunning(true);
    setStep(4);
    setProgress(tourIds.map(id => ({ tour_id: id, slots_created: 0, slots_skipped: 0, errors: [] })));

    for (let i = 0; i < tourIds.length; i++) {
      const tourId = tourIds[i];
      const ov = overrides[tourId] ?? {};
      const tour = tours.find(t => t.id === tourId)!;
      // One generation per range; the upsert dedupes, so overlapping ranges
      // are harmless (they just show up as skipped).
      const agg: GenResult = { tour_id: tourId, slots_created: 0, slots_skipped: 0, errors: [] };
      for (const range of validRanges) {
        const spec: GenSpec = {
          tour_id: tourId,
          business_id: businessId,
          start_date: range.start,
          end_date: range.end,
          times: ov.times ?? times,
          days_of_week: ov.days_of_week ?? days,
          capacity: ov.capacity ?? tour.default_capacity ?? defaultCapacity,
        };
        const result = await generateSlotsForTour(spec);
        agg.slots_created += result.slots_created;
        agg.slots_skipped += result.slots_skipped;
        agg.errors.push(...result.errors);
      }
      setProgress(prev => prev?.map((p, j) => j === i ? agg : p) ?? null);
      if (i < tourIds.length - 1) await new Promise(r => setTimeout(r, 100));
    }
    setRunning(false);
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-[color:var(--ck-bg)] border border-[color:var(--ck-border-subtle)] rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto">
        <header className="p-4 border-b border-[color:var(--ck-border-subtle)] flex items-center justify-between">
          <h2 className="font-bold text-[color:var(--ck-text)]">Bulk generate: Step {step}/4</h2>
          <button onClick={onClose} className="text-[color:var(--ck-text-muted)] hover:text-[color:var(--ck-text)]" aria-label="Close">&times;</button>
        </header>

        <div className="p-4">
          {step === 1 && (
            <section>
              <h3 className="font-semibold text-sm mb-2 text-[color:var(--ck-text)]">Pick tours</h3>
              <ul className="space-y-1">
                {tours.map(t => (
                  <li key={t.id}>
                    <label className="flex items-center gap-2 p-2 hover:bg-[color:var(--ck-surface-sunken)] rounded cursor-pointer">
                      <input type="checkbox" checked={selected.has(t.id)}
                        onChange={() => setSelected(prev => {
                          const next = new Set(prev);
                          next.has(t.id) ? next.delete(t.id) : next.add(t.id);
                          return next;
                        })} />
                      <span className="text-sm text-[color:var(--ck-text)]">{t.name}</span>
                      <span className="text-xs text-[color:var(--ck-text-muted)] ml-auto">cap {t.default_capacity ?? defaultCapacity}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-3 text-xs text-[color:var(--ck-accent)]">
                <button onClick={() => setSelected(new Set(tours.map(t => t.id)))}>Select all</button>
                <button onClick={() => setSelected(new Set())}>Clear</button>
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="space-y-3">
              <h3 className="font-semibold text-sm text-[color:var(--ck-text)]">Shared schedule</h3>
              <div className="space-y-2">
                {ranges.map((range, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_1fr_24px] gap-2 items-end">
                    <label>
                      <span className="block text-xs text-[color:var(--ck-text-muted)]">{idx === 0 ? "Start date" : `Range ${idx + 1} start`}</span>
                      <input type="date" value={range.start} onChange={e => setRanges(prev => prev.map((r, i) => i === idx ? { ...r, start: e.target.value } : r))}
                        className="w-full p-2 border border-[color:var(--ck-border-subtle)] rounded bg-[color:var(--ck-bg)] text-[color:var(--ck-text)]" />
                    </label>
                    <label>
                      <span className="block text-xs text-[color:var(--ck-text-muted)]">{idx === 0 ? "End date" : `Range ${idx + 1} end`}</span>
                      <input type="date" value={range.end} onChange={e => setRanges(prev => prev.map((r, i) => i === idx ? { ...r, end: e.target.value } : r))}
                        className="w-full p-2 border border-[color:var(--ck-border-subtle)] rounded bg-[color:var(--ck-bg)] text-[color:var(--ck-text)]" />
                    </label>
                    {idx > 0 ? (
                      <button onClick={() => setRanges(prev => prev.filter((_, i) => i !== idx))}
                        className="pb-2 text-[15px] text-[var(--ck-danger)]" title="Remove this date range" aria-label={`Remove date range ${idx + 1}`}>
                        &times;
                      </button>
                    ) : <span />}
                  </div>
                ))}
                <button onClick={() => setRanges(prev => [...prev, { start: "", end: "" }])}
                  className="text-xs text-[color:var(--ck-accent)]">
                  + Add another date range
                </button>
              </div>
              <div>
                <span className="block text-xs text-[color:var(--ck-text-muted)]">Times (comma-separated)</span>
                <input type="text" value={times.join(", ")}
                  onChange={e => setTimes(e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                  placeholder="06:00, 08:30"
                  className="w-full p-2 border border-[color:var(--ck-border-subtle)] rounded bg-[color:var(--ck-bg)] text-[color:var(--ck-text)]" />
              </div>
              <div>
                <span className="block text-xs text-[color:var(--ck-text-muted)] mb-1">Days of week</span>
                <div className="flex gap-1">
                  {["Su","Mo","Tu","We","Th","Fr","Sa"].map((label, idx) => (
                    <label key={idx} className="cursor-pointer">
                      <input type="checkbox" className="hidden peer"
                        checked={days.includes(idx)}
                        onChange={() => setDays(prev => prev.includes(idx) ? prev.filter(x => x !== idx) : [...prev, idx])} />
                      <span className="px-2.5 py-1.5 rounded text-xs font-medium peer-checked:bg-[var(--ck-accent)] peer-checked:text-white bg-[color:var(--ck-surface-sunken)] text-[color:var(--ck-text)]">{label}</span>
                    </label>
                  ))}
                </div>
                <div className="text-xs mt-1 space-x-2 text-[color:var(--ck-accent)]">
                  <button onClick={() => setDays([1,2,3,4,5])}>Weekdays</button>
                  <button onClick={() => setDays([0,6])}>Weekends</button>
                  <button onClick={() => setDays([0,1,2,3,4,5,6])}>Every day</button>
                </div>
              </div>
              <label>
                <span className="block text-xs text-[color:var(--ck-text-muted)]">Default capacity</span>
                <input type="number" value={defaultCapacity} onChange={e => setDefaultCapacity(Number(e.target.value))}
                  className="w-full p-2 border border-[color:var(--ck-border-subtle)] rounded bg-[color:var(--ck-bg)] text-[color:var(--ck-text)]" min={1} />
              </label>
            </section>
          )}

          {step === 3 && (
            <section className="space-y-3">
              <h3 className="font-semibold text-sm text-[color:var(--ck-text)]">Per-tour overrides (optional)</h3>
              <p className="text-xs text-[color:var(--ck-text-muted)]">Leave blank to use the shared config above.</p>
              {Array.from(selected).map(tourId => {
                const tour = tours.find(t => t.id === tourId)!;
                const ov = overrides[tourId] ?? {};
                return (
                  <details key={tourId} className="border border-[color:var(--ck-border-subtle)] rounded p-2">
                    <summary className="cursor-pointer text-sm text-[color:var(--ck-text)]">{tour.name}</summary>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                      <label>
                        <span className="block text-xs text-[color:var(--ck-text-muted)]">Capacity</span>
                        <input type="number" value={ov.capacity ?? tour.default_capacity ?? defaultCapacity}
                          onChange={e => setOverrides(prev => ({ ...prev, [tourId]: { ...prev[tourId], capacity: Number(e.target.value) } }))}
                          className="w-full p-1 border border-[color:var(--ck-border-subtle)] rounded bg-[color:var(--ck-bg)] text-[color:var(--ck-text)]" />
                      </label>
                      <label>
                        <span className="block text-xs text-[color:var(--ck-text-muted)]">Times</span>
                        <input type="text" value={(ov.times ?? times).join(", ")}
                          onChange={e => setOverrides(prev => ({ ...prev, [tourId]: { ...prev[tourId], times: e.target.value.split(",").map(s => s.trim()).filter(Boolean) } }))}
                          placeholder="06:00, 08:30"
                          className="w-full p-1 border border-[color:var(--ck-border-subtle)] rounded bg-[color:var(--ck-bg)] text-[color:var(--ck-text)]" />
                      </label>
                    </div>
                  </details>
                );
              })}
            </section>
          )}

          {step === 4 && (
            <section className="space-y-3">
              <h3 className="font-semibold text-sm text-[color:var(--ck-text)]">{running ? "Generating..." : "Result"}</h3>
              {progress && (
                <ul className="text-sm space-y-1">
                  {progress.map(r => {
                    const tour = tours.find(t => t.id === r.tour_id);
                    const done = r.slots_created > 0 || r.slots_skipped > 0 || r.errors.length > 0;
                    return (
                      <li key={r.tour_id} className="flex items-center gap-2 text-[color:var(--ck-text)]">
                        <span className={done ? "font-medium" : "text-[color:var(--ck-text-muted)]"}>{tour?.name ?? r.tour_id}</span>
                        {done ? (
                          <>
                            <span className="font-bold text-[var(--ck-success)]">{r.slots_created} created</span>
                            {r.slots_skipped > 0 && <span className="text-[color:var(--ck-text-muted)]">({r.slots_skipped} skipped)</span>}
                            {r.errors.length > 0 && <span className="text-[var(--ck-danger)]">{r.errors[0].message}</span>}
                          </>
                        ) : (
                          <span className="text-xs text-[color:var(--ck-text-muted)]">pending...</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </div>

        <footer className="p-4 border-t border-[color:var(--ck-border-subtle)] flex items-center justify-between">
          <div className="text-sm text-[color:var(--ck-text-muted)]">
            {step <= 3 && selected.size > 0 && (
              <>{previewTotal} slot(s) across {selected.size} tour(s)</>
            )}
          </div>
          <div className="flex gap-2">
            {step > 1 && step < 4 && <button onClick={() => setStep((s) => (s - 1) as any)} className="px-3 py-1.5 rounded bg-[color:var(--ck-surface-sunken)] text-[color:var(--ck-text)] text-sm">Back</button>}
            {step < 3 && <button disabled={step === 1 && selected.size === 0} onClick={() => setStep((s) => (s + 1) as any)} className="px-3 py-1.5 rounded bg-[var(--ck-accent)] text-white text-sm disabled:opacity-50">Next</button>}
            {step === 3 && <button onClick={runGenerate} disabled={running || !ranges.some(r => r.start && r.end)} className="px-3 py-1.5 rounded bg-[var(--ck-accent-hover)] text-white text-sm disabled:opacity-50">Generate</button>}
            {step === 4 && !running && <button onClick={onClose} className="px-3 py-1.5 rounded bg-[color:var(--ck-surface-sunken)] text-[color:var(--ck-text)] text-sm">Close</button>}
          </div>
        </footer>
      </div>
    </div>
  );
}
