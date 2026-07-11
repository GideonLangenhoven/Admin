"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/app/lib/supabase";
import { useBusinessContext } from "@/components/BusinessContext";
import { CalendarBlank, CaretRight, LockSimple, UsersThree, Waves } from "@phosphor-icons/react";

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
      <div className="ui-empty min-h-[60vh]">
        <div className="ui-icon-chip">
          <LockSimple size={20} />
        </div>
        <p className="text-sm ui-text-muted">Guide access requires an OPERATOR role or above.</p>
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
          <h2 className="font-display text-[24px] font-semibold leading-tight" style={{ color: "var(--ck-text-strong)" }}>{isToday ? "Today" : "Schedule"}</h2>
          <p className="text-[13px] font-medium truncate ui-text-muted">{dayLabel}</p>
        </div>
        <label className="relative shrink-0">
          <input type="date" value={day} onChange={e => setDay(e.target.value)}
            className="ui-control text-[13px] font-semibold pl-9 pr-3 py-2.5 rounded-xl outline-none" />
          <CalendarBlank size={16} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--ck-text-muted)" }} />
        </label>
      </div>

      {!loading && slots.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-3">
          <div className="ui-card p-4">
            <p className="font-display ui-stat text-[26px] leading-none">{slots.length}</p>
            <p className="ui-mono-label mt-1.5">tour{slots.length !== 1 ? "s" : ""} today</p>
          </div>
          <div className="bg-bt-dark rounded-2xl p-4 text-white" style={{ boxShadow: "var(--ck-shadow-md)" }}>
            <p className="font-display text-[26px] font-semibold leading-none tabular-nums">{totalPax}</p>
            <p className="ui-mono-label mt-1.5" style={{ color: "var(--ck-amber-bright)" }}>guest{totalPax !== 1 ? "s" : ""} expected</p>
          </div>
        </div>
      )}

      {loading && (
        <div className="space-y-3 mt-1">
          {[0, 1, 2].map(i => <div key={i} className="ui-skeleton h-[92px] rounded-2xl" />)}
        </div>
      )}

      {!loading && slots.length === 0 && (
        <div className="ui-empty mt-8">
          <div className="ui-icon-chip">
            <Waves size={20} />
          </div>
          <p className="text-[15px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No tours scheduled</p>
          <p className="text-[13px] ui-text-muted">Nothing on the water for {dayLabel}.</p>
        </div>
      )}

      <ul className="space-y-3">
        {slots.map(s => {
          const spotsLeft = s.capacity_total - s.booked - s.held;
          const filledPct = s.capacity_total > 0 ? Math.min(100, Math.round(((s.capacity_total - spotsLeft) / s.capacity_total) * 100)) : 0;
          return (
            <li key={s.id}>
              <Link href={"/guide/slot/" + s.id}
                className="group block ui-card ui-card-hover p-4 active:scale-[0.99] transition-transform">
                <div className="flex items-center gap-3.5">
                  <div className="shrink-0 w-14 text-center">
                    <p className="font-display ui-stat text-[19px] leading-none">{new Date(s.start_time).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false })}</p>
                    <p className="ui-mono-label mt-1" style={{ color: "var(--ck-amber)", fontSize: "9px" }}>Depart</p>
                  </div>
                  <div className="w-px self-stretch" style={{ background: "var(--ck-border-subtle)" }} />
                  <div className="flex-1 min-w-0">
                    <h3 className="ui-title-md text-[15px] leading-tight truncate">{s.tour_name}</h3>
                    <div className="flex items-center gap-3 mt-1.5 text-[12px]">
                      <span className="inline-flex items-center gap-1 font-semibold" style={{ color: "var(--ck-text)" }}>
                        <UsersThree size={14} style={{ color: "var(--ck-accent)" }} />
                        {s.pax_total} guest{s.pax_total !== 1 ? "s" : ""}
                      </span>
                      <span className="ui-text-muted">{s.booking_count} booking{s.booking_count !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="ui-progress flex-1">
                        <div className="ui-progress-fill" style={{ width: filledPct + "%" }} />
                      </div>
                      <span className="text-[11px] font-semibold shrink-0 ui-text-muted">{spotsLeft} left</span>
                    </div>
                  </div>
                  <CaretRight size={18} weight="bold" className="shrink-0 transition-colors" style={{ color: "var(--ck-text-muted)" }} />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {!loading && slots.length > 0 && (
        <p className="text-center text-[12px] ui-text-muted mt-6">Tap a tour to see passengers and check them in.</p>
      )}
    </div>
  );
}
