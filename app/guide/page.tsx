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
  var { businessId, businessName, role } = useBusinessContext();
  var [slots, setSlots] = useState<Slot[]>([]);
  var [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  var [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    (async () => {
      setLoading(true);
      var start = day + "T00:00:00.000Z";
      var end = day + "T23:59:59.999Z";
      var { data: slotRows } = await supabase
        .from("slots")
        .select("id, start_time, capacity_total, booked, held, status, tour_id, tours(name)")
        .eq("business_id", businessId)
        .gte("start_time", start)
        .lte("start_time", end)
        .eq("status", "OPEN")
        .order("start_time", { ascending: true });

      var rows: Slot[] = [];
      for (var s of (slotRows || []) as any[]) {
        var { count, data: bkData } = await supabase
          .from("bookings")
          .select("qty", { count: "exact" })
          .eq("slot_id", s.id)
          .in("status", ["PAID", "CONFIRMED", "COMPLETED"]);
        var pax = (bkData || []).reduce((sum: number, b: any) => sum + (b.qty || 0), 0);
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
      <div className="flex items-center justify-center min-h-screen p-6">
        <p className="text-sm text-[color:var(--textMuted)]">Guide access requires OPERATOR role or above.</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-4 pb-20">
      <header className="flex items-center justify-between mb-1">
        <div>
          <h1 className="text-xl font-bold text-[color:var(--text)]">Today&apos;s Tours</h1>
          <p className="text-xs text-[color:var(--textMuted)]">{businessName}</p>
        </div>
        <input type="date" value={day} onChange={e => setDay(e.target.value)}
          className="text-xs p-1.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text)]" />
      </header>

      {loading && <p className="mt-8 text-center text-sm text-[color:var(--textMuted)]">Loading...</p>}

      {!loading && slots.length === 0 && (
        <div className="mt-12 text-center">
          <p className="text-4xl mb-2">🏖️</p>
          <p className="text-sm text-[color:var(--textMuted)]">No tours scheduled for {new Date(day + "T12:00:00Z").toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" })}.</p>
        </div>
      )}

      <ul className="mt-4 space-y-3">
        {slots.map(s => (
          <li key={s.id}>
            <Link href={"/guide/slot/" + s.id} className="block p-4 rounded-xl bg-[color:var(--surface)] border border-[color:var(--border)] active:bg-[color:var(--surface2)] transition-colors">
              <div className="flex items-baseline justify-between">
                <h2 className="font-bold text-lg text-[color:var(--text)]">{new Date(s.start_time).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}</h2>
                <span className="text-xs text-[color:var(--textMuted)]">{s.tour_name}</span>
              </div>
              <div className="flex items-center gap-4 mt-1 text-sm">
                <span className="text-[color:var(--text)]"><strong>{s.pax_total}</strong> guest{s.pax_total !== 1 ? "s" : ""}</span>
                <span className="text-[color:var(--textMuted)]">{s.booking_count} booking{s.booking_count !== 1 ? "s" : ""}</span>
                <span className="ml-auto text-xs text-[color:var(--textMuted)]">{s.capacity_total - s.booked - s.held} spots left</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      <p className="text-center text-xs text-[color:var(--textMuted)] mt-8">Tap a tour to see passengers and check them in.</p>
    </div>
  );
}
