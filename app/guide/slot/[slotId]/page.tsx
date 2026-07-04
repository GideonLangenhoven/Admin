"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/app/lib/supabase";
import { useBusinessContext } from "@/components/BusinessContext";
import { notify } from "@/app/lib/app-notify";

type Booking = {
  id: string;
  customer_name: string;
  phone: string;
  qty: number;
  checked_in: boolean;
  checked_in_at: string | null;
  waiver_status: string | null;
  dietary: string | null;
  add_ons: Array<{ name: string; qty: number }>;
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

    const bookingIds = (data || []).map((b: any) => b.id);
    const addOnsByBooking: Record<string, Array<{ name: string; qty: number }>> = {};
    if (bookingIds.length > 0) {
      const { data: addOnRows } = await supabase
        .from("booking_add_ons")
        .select("booking_id, qty, add_ons(name)")
        .in("booking_id", bookingIds);
      for (const row of (addOnRows || []) as any[]) {
        const ao = Array.isArray(row.add_ons) ? row.add_ons[0] : row.add_ons;
        if (!ao?.name) continue;
        (addOnsByBooking[row.booking_id] ||= []).push({ name: ao.name, qty: row.qty || 1 });
      }
    }

    setBookings((data || []).map((b: any) => ({
      id: b.id,
      customer_name: b.customer_name || "Guest",
      phone: b.phone || "",
      qty: b.qty || 1,
      checked_in: !!b.checked_in,
      checked_in_at: b.checked_in_at || null,
      waiver_status: b.waiver_status || null,
      dietary: b.custom_fields?.dietary || null,
      add_ons: addOnsByBooking[b.id] || [],
    })));
    setLoading(false);
  }

  async function checkIn(bookingId: string) {
    const clientEventId = crypto.randomUUID();
    const payload = { booking_id: bookingId, slot_id: slotId, client_event_id: clientEventId };

    setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, checked_in: true, checked_in_at: new Date().toISOString() } : b));

    const revert = () => setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, checked_in: false, checked_in_at: null } : b));

    if (!navigator.onLine) {
      const { data: { session } } = await supabase.auth.getSession();
      await queueLocally({ id: clientEventId, payload, queuedAt: new Date().getTime(), token: session?.access_token || null });
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.ready;
        try { await (reg as any).sync?.register("sync-check-ins"); } catch (_) {}
      }
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || null;
    if (!token) {
      revert();
      notify({ tone: "error", message: "Session expired — please sign in again to check in guests." });
      return;
    }

    try {
      const r = await fetch("/api/guide/check-in", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        // Auth/validation failures are not retryable — revert and surface, never queue.
        if (r.status >= 400 && r.status < 500) {
          revert();
          notify({ tone: "error", message: r.status === 401 || r.status === 403 ? "Not authorized to check in — please sign in again." : "Check-in was rejected. Please refresh and try again." });
          return;
        }
        throw new Error("server_error");
      }
    } catch (_) {
      // True network/offline or server (5xx) failure — queue for background sync.
      await queueLocally({ id: clientEventId, payload, queuedAt: new Date().getTime(), token });
    }
  }

  const checkedCount = bookings.filter(b => b.checked_in).length;
  const totalPax = bookings.reduce((s, b) => s + b.qty, 0);
  const pct = bookings.length ? Math.round((checkedCount / bookings.length) * 100) : 0;

  return (
    <div className="pt-5">
      {/* Trip summary */}
      {slotInfo && (
        <div className="rounded-2xl p-4 mb-4 text-white shadow-sm" style={{ background: "linear-gradient(135deg,#0891b2,#0e7490)" }}>
          <div className="flex items-end justify-between">
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-cyan-50/80 truncate">{slotInfo.tour_name}</p>
              <p className="text-[28px] font-extrabold leading-none tabular-nums mt-0.5">{new Date(slotInfo.start_time).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false })}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[24px] font-extrabold leading-none tabular-nums">{checkedCount}<span className="text-cyan-100/60 text-[16px]">/{bookings.length}</span></p>
              <p className="text-[11px] font-semibold text-cyan-50/80 mt-0.5">checked in</p>
            </div>
          </div>
          <div className="mt-3 h-2 rounded-full bg-white/20 overflow-hidden">
            <div className="h-full rounded-full bg-white transition-all duration-500" style={{ width: pct + "%" }} />
          </div>
          <div className="flex items-center justify-between mt-2.5 text-[12px]">
            <span className="text-cyan-50/80 font-medium">{totalPax} guest{totalPax !== 1 ? "s" : ""} aboard</span>
            <Link href={"/guide/photos/" + slotId} className="font-bold text-white inline-flex items-center gap-1">Trip photos
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
            </Link>
          </div>
        </div>
      )}

      {loading && (
        <div className="space-y-2.5">{[0, 1, 2, 3].map(i => <div key={i} className="h-[72px] rounded-2xl bg-slate-100 animate-pulse" />)}</div>
      )}

      {!loading && bookings.length === 0 && (
        <div className="mt-12 text-center">
          <div className="text-4xl mb-2">🛶</div>
          <p className="text-[14px] font-bold text-slate-700">No passengers on this trip yet.</p>
        </div>
      )}

      <ul className="space-y-2.5">
        {bookings.map(b => (
          <li key={b.id} className={"rounded-2xl border p-3.5 transition-all " + (b.checked_in ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-100 shadow-sm")}>
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-bold text-[15px] text-slate-800 truncate">{b.customer_name}</p>
                  {b.waiver_status === "SIGNED"
                    ? <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">✓ Waiver</span>
                    : b.waiver_status
                      ? <span className="text-[10px] font-bold text-rose-600 bg-rose-100 px-1.5 py-0.5 rounded-full">Waiver: {b.waiver_status}</span>
                      : null}
                </div>
                <div className="flex items-center gap-3 text-[12px] mt-1">
                  <span className="font-semibold text-slate-500">{b.qty} guest{b.qty !== 1 ? "s" : ""}</span>
                  {b.phone && (
                    <a href={"tel:" + b.phone} className="inline-flex items-center gap-1 text-cyan-600 font-semibold">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11 11 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                      Call
                    </a>
                  )}
                </div>
                {(b.add_ons.length > 0 || b.dietary) && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {b.add_ons.map((ao, idx) => (
                      <span key={idx} className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold bg-amber-100 text-amber-700">
                        {ao.qty > 1 ? `${ao.qty}× ` : "+ "}{ao.name}
                      </span>
                    ))}
                    {b.dietary && <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold bg-rose-100 text-rose-700">🍽 {b.dietary}</span>}
                  </div>
                )}
              </div>
              {b.checked_in ? (
                <div className="shrink-0 w-11 h-11 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-sm">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                </div>
              ) : (
                <button onClick={() => checkIn(b.id)}
                  className="shrink-0 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-[13px] font-bold active:scale-95 hover:bg-slate-800 transition">
                  Check in
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {!loading && bookings.length > 0 && (
        <Link href={"/guide/photos/" + slotId}
          className="flex items-center justify-center gap-2 mt-6 p-4 rounded-2xl bg-white border border-slate-200 text-slate-700 font-bold text-[14px] shadow-sm active:scale-[0.99] hover:border-cyan-200 transition">
          <svg className="w-5 h-5 text-cyan-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          Upload trip photos &amp; send thank-you
        </Link>
      )}
    </div>
  );
}

async function queueLocally(item: { id: string; payload: any; queuedAt: number; token?: string | null }) {
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
