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
  const [startDate, setStartDate] = useState(today.toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(ninety.toISOString().slice(0, 10));
  const [times, setTimes] = useState<string[]>(["06:00", "08:30"]);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [defaultCapacity, setDefaultCapacity] = useState<number>(10);

  const [overrides, setOverrides] = useState<Record<string, Partial<GenSpec>>>({});
  const [progress, setProgress] = useState<GenResult[] | null>(null);
  const [running, setRunning] = useState(false);

  const previewTotal = useMemo(() => {
    if (selected.size === 0) return 0;
    let total = 0;
    const s = new Date(startDate + "T00:00:00");
    const e = new Date(endDate + "T00:00:00");
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      if (!days.includes(d.getDay())) continue;
      total += times.length * selected.size;
    }
    return total;
  }, [selected, startDate, endDate, times, days]);

  async function runGenerate() {
    if (!businessId) return;
    const specs: GenSpec[] = Array.from(selected).map(tourId => {
      const ov = overrides[tourId] ?? {};
      const tour = tours.find(t => t.id === tourId)!;
      return {
        tour_id: tourId,
        business_id: businessId,
        start_date: ov.start_date ?? startDate,
        end_date: ov.end_date ?? endDate,
        times: ov.times ?? times,
        days_of_week: ov.days_of_week ?? days,
        capacity: ov.capacity ?? tour.default_capacity ?? defaultCapacity,
      };
    });

    setRunning(true);
    setStep(4);
    setProgress(specs.map(s => ({ tour_id: s.tour_id, slots_created: 0, slots_skipped: 0, errors: [] })));

    for (let i = 0; i < specs.length; i++) {
      const result = await generateSlotsForTour(specs[i]);
      setProgress(prev => prev?.map((p, j) => j === i ? result : p) ?? null);
      if (i < specs.length - 1) await new Promise(r => setTimeout(r, 100));
    }
    setRunning(false);
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-[color:var(--ck-bg)] border border-[color:var(--ck-border)] rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto">
        <header className="p-4 border-b border-[color:var(--ck-border)] flex items-center justify-between">
          <h2 className="font-bold text-[color:var(--ck-text)]">Bulk generate — Step {step}/4</h2>
          <button onClick={onClose} className="text-[color:var(--ck-text-muted)] hover:text-[color:var(--ck-text)]" aria-label="Close">&times;</button>
        </header>

        <div className="p-4">
          {step === 1 && (
            <section>
              <h3 className="font-semibold text-sm mb-2 text-[color:var(--ck-text)]">Pick tours</h3>
              <ul className="space-y-1">
                {tours.map(t => (
                  <li key={t.id}>
                    <label className="flex items-center gap-2 p-2 hover:bg-[color:var(--ck-bg-subtle)] rounded cursor-pointer">
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
              <div className="grid grid-cols-2 gap-2">
                <label>
                  <span className="block text-xs text-[color:var(--ck-text-muted)]">Start date</span>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                    className="w-full p-2 border border-[color:var(--ck-border)] rounded bg-[color:var(--ck-bg)] text-[color:var(--ck-text)]" />
                </label>
                <label>
                  <span className="block text-xs text-[color:var(--ck-text-muted)]">End date</span>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                    className="w-full p-2 border border-[color:var(--ck-border)] rounded bg-[color:var(--ck-bg)] text-[color:var(--ck-text)]" />
                </label>
              </div>
              <div>
                <span className="block text-xs text-[color:var(--ck-text-muted)]">Times (comma-separated)</span>
                <input type="text" value={times.join(", ")}
                  onChange={e => setTimes(e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                  placeholder="06:00, 08:30"
                  className="w-full p-2 border border-[color:var(--ck-border)] rounded bg-[color:var(--ck-bg)] text-[color:var(--ck-text)]" />
              </div>
              <div>
                <span className="block text-xs text-[color:var(--ck-text-muted)] mb-1">Days of week</span>
                <div className="flex gap-1">
                  {["Su","Mo","Tu","We","Th","Fr","Sa"].map((label, idx) => (
                    <label key={idx} className="cursor-pointer">
                      <input type="checkbox" className="hidden peer"
                        checked={days.includes(idx)}
                        onChange={() => setDays(prev => prev.includes(idx) ? prev.filter(x => x !== idx) : [...prev, idx])} />
                      <span className="px-2.5 py-1.5 rounded text-xs font-medium peer-checked:bg-emerald-600 peer-checked:text-white bg-[color:var(--ck-bg-subtle)] text-[color:var(--ck-text)]">{label}</span>
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
                  className="w-full p-2 border border-[color:var(--ck-border)] rounded bg-[color:var(--ck-bg)] text-[color:var(--ck-text)]" min={1} />
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
                  <details key={tourId} className="border border-[color:var(--ck-border)] rounded p-2">
                    <summary className="cursor-pointer text-sm text-[color:var(--ck-text)]">{tour.name}</summary>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                      <label>
                        <span className="block text-xs text-[color:var(--ck-text-muted)]">Capacity</span>
                        <input type="number" value={ov.capacity ?? tour.default_capacity ?? defaultCapacity}
                          onChange={e => setOverrides(prev => ({ ...prev, [tourId]: { ...prev[tourId], capacity: Number(e.target.value) } }))}
                          className="w-full p-1 border border-[color:var(--ck-border)] rounded bg-[color:var(--ck-bg)] text-[color:var(--ck-text)]" />
                      </label>
                      <label>
                        <span className="block text-xs text-[color:var(--ck-text-muted)]">Times</span>
                        <input type="text" value={(ov.times ?? times).join(", ")}
                          onChange={e => setOverrides(prev => ({ ...prev, [tourId]: { ...prev[tourId], times: e.target.value.split(",").map(s => s.trim()).filter(Boolean) } }))}
                          placeholder="06:00, 08:30"
                          className="w-full p-1 border border-[color:var(--ck-border)] rounded bg-[color:var(--ck-bg)] text-[color:var(--ck-text)]" />
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
                            <span className="font-bold text-emerald-600">{r.slots_created} created</span>
                            {r.slots_skipped > 0 && <span className="text-[color:var(--ck-text-muted)]">({r.slots_skipped} skipped)</span>}
                            {r.errors.length > 0 && <span className="text-red-500">{r.errors[0].message}</span>}
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

        <footer className="p-4 border-t border-[color:var(--ck-border)] flex items-center justify-between">
          <div className="text-sm text-[color:var(--ck-text-muted)]">
            {step <= 3 && selected.size > 0 && (
              <>{previewTotal} slot(s) across {selected.size} tour(s)</>
            )}
          </div>
          <div className="flex gap-2">
            {step > 1 && step < 4 && <button onClick={() => setStep((s) => (s - 1) as any)} className="px-3 py-1.5 rounded bg-[color:var(--ck-bg-subtle)] text-[color:var(--ck-text)] text-sm">Back</button>}
            {step < 3 && <button disabled={step === 1 && selected.size === 0} onClick={() => setStep((s) => (s + 1) as any)} className="px-3 py-1.5 rounded bg-emerald-600 text-white text-sm disabled:opacity-50">Next</button>}
            {step === 3 && <button onClick={runGenerate} disabled={running} className="px-3 py-1.5 rounded bg-emerald-700 text-white text-sm disabled:opacity-50">Generate</button>}
            {step === 4 && !running && <button onClick={onClose} className="px-3 py-1.5 rounded bg-[color:var(--ck-bg-subtle)] text-[color:var(--ck-text)] text-sm">Close</button>}
          </div>
        </footer>
      </div>
    </div>
  );
}
