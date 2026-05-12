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
  const { businessId, businessName, role } = useBusinessContext();
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
      <div className="flex items-center justify-center min-h-screen p-6">
        <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>Guide access requires OPERATOR role or above.</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-4 pb-20" style={{ color: "var(--ck-text)" }}>
      <header className="flex items-center justify-between mb-1">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ck-text-strong)" }}>Today&apos;s Tours</h1>
          <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{businessName}</p>
        </div>
        <input type="date" value={day} onChange={e => setDay(e.target.value)}
          className="text-xs p-1.5 rounded-lg border"
          style={{ borderColor: "var(--ck-border-subtle)", background: "var(--ck-surface)", color: "var(--ck-text)" }} />
      </header>

      {loading && <p className="mt-8 text-center text-sm" style={{ color: "var(--ck-text-muted)" }}>Loading...</p>}

      {!loading && slots.length === 0 && (
        <div className="mt-12 text-center">
          <p className="text-4xl mb-2">🏖️</p>
          <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>No tours scheduled for {new Date(day + "T12:00:00Z").toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" })}.</p>
        </div>
      )}

      <ul className="mt-4 space-y-3">
        {slots.map(s => (
          <li key={s.id}>
            <Link href={"/guide/slot/" + s.id} className="block p-4 rounded-xl border transition-colors"
              style={{ background: "var(--ck-surface)", borderColor: "var(--ck-border-subtle)" }}>
              <div className="flex items-baseline justify-between">
                <h2 className="font-bold text-lg" style={{ color: "var(--ck-text-strong)" }}>{new Date(s.start_time).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}</h2>
                <span className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{s.tour_name}</span>
              </div>
              <div className="flex items-center gap-4 mt-1 text-sm">
                <span style={{ color: "var(--ck-text-strong)" }}><strong>{s.pax_total}</strong> guest{s.pax_total !== 1 ? "s" : ""}</span>
                <span style={{ color: "var(--ck-text-muted)" }}>{s.booking_count} booking{s.booking_count !== 1 ? "s" : ""}</span>
                <span className="ml-auto text-xs" style={{ color: "var(--ck-text-muted)" }}>{s.capacity_total - s.booked - s.held} spots left</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      <p className="text-center text-xs mt-8" style={{ color: "var(--ck-text-muted)" }}>Tap a tour to see passengers and check them in.</p>
    </div>
  );
}
