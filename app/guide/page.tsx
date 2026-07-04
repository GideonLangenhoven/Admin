"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/app/lib/supabase";
import { useBusinessContext } from "@/components/BusinessContext";

type Slot = {
  id: string;
  start_time: string;
  capacity_total: number;
  booked: number;
  held: number;
  tour_name: string;
  booking_count: number;
  pax_total: number;
};

export default function GuideHomePage() {
  const { businessId, role } = useBusinessContext();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    (async () => {
      setLoading(true);
      const start = day + "T00:00:00.000Z";
      const end = day + "T23:59:59.999Z";
      const { data: slotRows } = await supabase
        .from("slots")
        .select("id, start_time, capacity_total, booked, held, status, tour_id, tours(name)")
        .eq("business_id", businessId)
        .gte("start_time", start)
        .lte("start_time", end)
        .eq("status", "OPEN")
        .order("start_time", { ascending: true });

      const rows: Slot[] = [];
      for (const s of (slotRows || []) as any[]) {
        const { count, data: bkData } = await supabase
          .from("bookings")
          .select("qty", { count: "exact" })
          .eq("slot_id", s.id)
          .in("status", ["PAID", "CONFIRMED", "COMPLETED"]);
        const pax = (bkData || []).reduce((sum: number, b: any) => sum + (b.qty || 0), 0);
        rows.push({
          id: s.id,
          start_time: s.start_time,
          capacity_total: s.capacity_total || 0,
          booked: s.booked || 0,
          held: s.held || 0,
          tour_name: (s as any).tours?.name || "Tour",
          booking_count: count || 0,
          pax_total: pax,
        });
      }
      setSlots(rows);
      setLoading(false);
    })();
  }, [day, businessId]);

  if (role && !["OPERATOR", "ADMIN", "MAIN_ADMIN", "SUPER_ADMIN"].includes(role)) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] p-6 text-center">
        <div>
          <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-slate-100 flex items-center justify-center">
            <svg className="w-7 h-7 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
          </div>
          <p className="text-sm text-slate-500">Guide access requires an OPERATOR role or above.</p>
        </div>
      </div>
    );
  }

  const dayLabel = new Date(day + "T12:00:00Z").toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" });
  const totalPax = slots.reduce((sum, s) => sum + s.pax_total, 0);
  const isToday = day === new Date().toISOString().slice(0, 10);

  return (
    <div className="pt-5">
      {/* Day selector + summary */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-[22px] font-extrabold text-slate-900 leading-tight">{isToday ? "Today" : "Schedule"}</h2>
          <p className="text-[13px] text-slate-500 font-medium truncate">{dayLabel}</p>
        </div>
        <label className="relative shrink-0">
          <input type="date" value={day} onChange={e => setDay(e.target.value)}
            className="peer text-[13px] font-semibold pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm outline-none focus:border-cyan-500" />
          <svg className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
        </label>
      </div>

      {!loading && slots.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white border border-slate-100 shadow-sm p-4">
            <p className="text-[26px] font-extrabold text-slate-900 leading-none tabular-nums">{slots.length}</p>
            <p className="text-[12px] font-semibold text-slate-400 mt-1">tour{slots.length !== 1 ? "s" : ""} today</p>
          </div>
          <div className="rounded-2xl border shadow-sm p-4 text-white" style={{ background: "linear-gradient(135deg,#0891b2,#0e7490)" }}>
            <p className="text-[26px] font-extrabold leading-none tabular-nums">{totalPax}</p>
            <p className="text-[12px] font-semibold text-cyan-50/80 mt-1">guest{totalPax !== 1 ? "s" : ""} expected</p>
          </div>
        </div>
      )}

      {loading && (
        <div className="space-y-3 mt-1">
          {[0, 1, 2].map(i => <div key={i} className="h-[92px] rounded-2xl bg-slate-100 animate-pulse" />)}
        </div>
      )}

      {!loading && slots.length === 0 && (
        <div className="mt-14 text-center">
          <div className="text-5xl mb-3">🌊</div>
          <p className="text-[15px] font-bold text-slate-700">No tours scheduled</p>
          <p className="text-[13px] text-slate-400 mt-1">Nothing on the water for {dayLabel}.</p>
        </div>
      )}

      <ul className="space-y-3">
        {slots.map(s => {
          const spotsLeft = s.capacity_total - s.booked - s.held;
          const filledPct = s.capacity_total > 0 ? Math.min(100, Math.round(((s.capacity_total - spotsLeft) / s.capacity_total) * 100)) : 0;
          return (
            <li key={s.id}>
              <Link href={"/guide/slot/" + s.id}
                className="group block rounded-2xl bg-white border border-slate-100 shadow-sm p-4 active:scale-[0.99] hover:shadow-md hover:border-cyan-100 transition-all">
                <div className="flex items-center gap-3.5">
                  <div className="shrink-0 w-14 text-center">
                    <p className="text-[19px] font-extrabold text-slate-900 leading-none tabular-nums">{new Date(s.start_time).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false })}</p>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-600 mt-1">Depart</p>
                  </div>
                  <div className="w-px self-stretch bg-slate-100" />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-slate-800 text-[15px] leading-tight truncate">{s.tour_name}</h3>
                    <div className="flex items-center gap-3 mt-1.5 text-[12px]">
                      <span className="inline-flex items-center gap-1 font-bold text-slate-700">
                        <svg className="w-3.5 h-3.5 text-cyan-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4z" /></svg>
                        {s.pax_total} guest{s.pax_total !== 1 ? "s" : ""}
                      </span>
                      <span className="text-slate-400">{s.booking_count} booking{s.booking_count !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: filledPct + "%", background: "linear-gradient(90deg,#22d3ee,#0891b2)" }} />
                      </div>
                      <span className="text-[11px] font-semibold text-slate-400 shrink-0">{spotsLeft} left</span>
                    </div>
                  </div>
                  <svg className="w-5 h-5 text-slate-300 group-hover:text-cyan-500 shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {!loading && slots.length > 0 && (
        <p className="text-center text-[12px] text-slate-400 mt-6">Tap a tour to see passengers and check them in.</p>
      )}
    </div>
  );
}
