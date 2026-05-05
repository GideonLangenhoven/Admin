"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/app/lib/supabase";
import { useBusinessContext } from "@/components/BusinessContext";

type Booking = {
  id: string;
  customer_name: string;
  phone: string;
  qty: number;
  checked_in: boolean;
  checked_in_at: string | null;
  waiver_status: string | null;
  dietary: string | null;
};

export default function GuideSlotPage({ params }: { params: Promise<{ slotId: string }> }) {
  const { slotId } = use(params);
  const { businessId } = useBusinessContext();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [slotInfo, setSlotInfo] = useState<{ tour_name: string; start_time: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { reload(); }, [slotId, businessId]);

  async function reload() {
    if (!businessId) return;
    setLoading(true);

    const { data: slot } = await supabase
      .from("slots")
      .select("start_time, tours(name)")
      .eq("id", slotId)
      .maybeSingle();

    if (slot) setSlotInfo({ tour_name: (slot as any).tours?.name || "Tour", start_time: slot.start_time });

    const { data } = await supabase
      .from("bookings")
      .select("id, customer_name, phone, qty, custom_fields, checked_in, checked_in_at, waiver_status")
      .eq("slot_id", slotId)
      .eq("business_id", businessId)
      .in("status", ["PAID", "CONFIRMED", "COMPLETED"])
      .order("customer_name", { ascending: true });

    setBookings((data || []).map((b: any) => ({
      id: b.id,
      customer_name: b.customer_name || "Guest",
      phone: b.phone || "",
      qty: b.qty || 1,
      checked_in: !!b.checked_in,
      checked_in_at: b.checked_in_at || null,
      waiver_status: b.waiver_status || null,
      dietary: b.custom_fields?.dietary || null,
    })));
    setLoading(false);
  }

  async function checkIn(bookingId: string) {
    const clientEventId = crypto.randomUUID();
    const payload = { booking_id: bookingId, slot_id: slotId, client_event_id: clientEventId };

    setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, checked_in: true, checked_in_at: new Date().toISOString() } : b));

    if (!navigator.onLine) {
      await queueLocally({ id: clientEventId, payload, queuedAt: Date.now() });
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.ready;
        try { await (reg as any).sync?.register("sync-check-ins"); } catch (_) {}
      }
      return;
    }

    try {
      const r = await fetch("/api/guide/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error("failed");
    } catch (_) {
      await queueLocally({ id: clientEventId, payload, queuedAt: Date.now() });
    }
  }

  const checkedCount = bookings.filter(b => b.checked_in).length;
  const totalPax = bookings.reduce((s, b) => s + b.qty, 0);

  return (
    <div className="max-w-md mx-auto p-4 pb-20">
      <header className="flex items-center justify-between mb-4">
        <Link href="/guide" className="text-sm text-[color:var(--accent)] font-medium">&larr; Back</Link>
        {slotInfo && (
          <div className="text-right">
            <p className="text-sm font-bold text-[color:var(--text)]">{new Date(slotInfo.start_time).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}</p>
            <p className="text-xs text-[color:var(--textMuted)]">{slotInfo.tour_name}</p>
          </div>
        )}
      </header>

      <div className="flex items-center gap-4 mb-4 px-1">
        <span className="text-sm text-[color:var(--text)]"><strong>{totalPax}</strong> guest{totalPax !== 1 ? "s" : ""}</span>
        <span className="text-sm text-emerald-600"><strong>{checkedCount}</strong>/{bookings.length} checked in</span>
        <Link href={"/guide/photos/" + slotId} className="ml-auto text-sm text-[color:var(--accent)] font-medium">Photos &rarr;</Link>
      </div>

      {loading && <p className="text-sm text-[color:var(--textMuted)]">Loading...</p>}

      <ul className="space-y-2">
        {bookings.map(b => (
          <li key={b.id} className={"p-3 rounded-xl border transition-colors " + (b.checked_in ? "bg-emerald-50 border-emerald-200" : "bg-[color:var(--surface)] border-[color:var(--border)]")}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[color:var(--text)] truncate">{b.customer_name}</p>
                <div className="flex items-center gap-2 text-xs text-[color:var(--textMuted)] mt-0.5">
                  <span>{b.qty} guest{b.qty !== 1 ? "s" : ""}</span>
                  {b.phone && <a href={"tel:" + b.phone} className="underline">{b.phone}</a>}
                </div>
                {b.dietary && <p className="text-xs text-amber-700 mt-1 font-medium">Dietary: {b.dietary}</p>}
                {b.waiver_status && b.waiver_status !== "SIGNED" && (
                  <p className="text-xs text-red-600 mt-0.5 font-medium">Waiver: {b.waiver_status}</p>
                )}
                {b.waiver_status === "SIGNED" && (
                  <p className="text-xs text-emerald-600 mt-0.5">Waiver signed</p>
                )}
              </div>
              {b.checked_in ? (
                <span className="shrink-0 text-emerald-700 text-sm font-semibold px-3 py-1.5">&#10003;</span>
              ) : (
                <button onClick={() => checkIn(b.id)}
                  className="shrink-0 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold active:bg-emerald-700 transition-colors">
                  Check in
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {!loading && bookings.length > 0 && (
        <Link href={"/guide/photos/" + slotId}
          className="block mt-6 p-4 rounded-xl bg-amber-100 text-amber-900 font-medium text-center border border-amber-200 active:bg-amber-200 transition-colors">
          After the trip &rarr; upload photos &amp; send thank-you
        </Link>
      )}
    </div>
  );
}

async function queueLocally(item: { id: string; payload: any; queuedAt: number }) {
  return new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("guide-queue", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("check-ins", { keyPath: "id" });
    req.onsuccess = () => {
      const tx = req.result.transaction("check-ins", "readwrite");
      tx.objectStore("check-ins").put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e);
    };
    req.onerror = (e) => reject(e);
  });
}
