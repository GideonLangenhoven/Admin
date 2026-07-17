"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/app/lib/supabase";
import { useBusinessContext } from "@/components/BusinessContext";
import { notify } from "@/app/lib/app-notify";
import { Check } from "@phosphor-icons/react";

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
      notify({ tone: "error", message: "Session expired. Please sign in again to check in guests." });
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
          notify({ tone: "error", message: r.status === 401 || r.status === 403 ? "Not authorized to check in. Please sign in again." : "Check-in was rejected. Please refresh and try again." });
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
      {/* Trip summary — night surface hero, amber check-in trail */}
      {slotInfo && (
        <div className="bg-bt-dark rounded-2xl p-4 mb-4 text-white" style={{ boxShadow: "var(--ck-shadow-md)" }}>
          <div className="flex items-end justify-between">
            <div className="min-w-0">
              <p className="text-[12px] font-semibold truncate" style={{ color: "rgba(246,243,234,0.75)" }}>{slotInfo.tour_name}</p>
              <p className="font-display text-[28px] font-semibold leading-none tabular-nums mt-0.5">{new Date(slotInfo.start_time).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false })}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="font-display text-[24px] font-semibold leading-none tabular-nums">{checkedCount}<span className="text-[16px]" style={{ color: "rgba(246,243,234,0.55)" }}>/{bookings.length}</span></p>
              <p className="ui-mono-label mt-1" style={{ color: "rgba(246,243,234,0.75)" }}>checked in</p>
            </div>
          </div>
          <div className="mt-3 h-2 rounded-full bg-white/15 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: pct + "%", background: "var(--ck-amber-bright)" }} />
          </div>
          <div className="flex items-center justify-between mt-2.5 text-[12px]">
            <span className="font-medium" style={{ color: "rgba(246,243,234,0.75)" }}>{totalPax} guest{totalPax !== 1 ? "s" : ""} aboard</span>
            <Link href={"/guide/photos/" + slotId} className="font-semibold text-white inline-flex items-center gap-1">Trip photos</Link>
          </div>
        </div>
      )}

      {loading && (
        <div className="space-y-2.5">{[0, 1, 2, 3].map(i => <div key={i} className="ui-skeleton h-[72px] rounded-2xl" />)}</div>
      )}

      {!loading && bookings.length === 0 && (
        <div className="ui-empty mt-6">
          <p className="text-[14px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No passengers on this trip yet.</p>
        </div>
      )}

      <ul className="space-y-2.5">
        {bookings.map(b => (
          <li key={b.id} className={"rounded-2xl border p-3.5 transition-all " + (b.checked_in ? "" : "ui-card")}
            style={b.checked_in ? { background: "var(--ck-success-soft)", borderColor: "color-mix(in srgb, var(--ck-success) 30%, transparent)" } : undefined}>
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-[15px] truncate" style={{ color: "var(--ck-text-strong)" }}>{b.customer_name}</p>
                  {b.waiver_status === "SIGNED"
                    ? <span className="ui-status ui-pill-success">✓ Waiver</span>
                    : b.waiver_status
                      ? <span className="ui-status ui-pill-danger">Waiver: {b.waiver_status}</span>
                      : null}
                </div>
                <div className="flex items-center gap-3 text-[12px] mt-1">
                  <span className="font-semibold ui-text-muted">{b.qty} guest{b.qty !== 1 ? "s" : ""}</span>
                  {b.phone && (
                    <>
                      <a href={"tel:" + b.phone} className="inline-flex items-center gap-1 font-semibold" style={{ color: "var(--ck-ocean)" }}>
                        Call
                      </a>
                      <a href={"https://wa.me/" + b.phone.replace(/\D/g, "").replace(/^0/, "27")} target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 font-semibold" style={{ color: "var(--ck-success)" }}>
                        WhatsApp
                      </a>
                    </>
                  )}
                </div>
                {(b.add_ons.length > 0 || b.dietary) && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {b.add_ons.map((ao, idx) => (
                      <span key={idx} className="ui-pill ui-pill-amber text-[11px]">
                        {ao.qty > 1 ? `${ao.qty}× ` : "+ "}{ao.name}
                      </span>
                    ))}
                    {b.dietary && <span className="ui-pill ui-pill-danger text-[11px]">🍽 {b.dietary}</span>}
                  </div>
                )}
              </div>
              {b.checked_in ? (
                <div className="shrink-0 w-11 h-11 rounded-full text-white flex items-center justify-center" style={{ background: "var(--ck-success)", boxShadow: "var(--ck-shadow-sm)" }}>
                  <Check size={22} weight="bold" />
                </div>
              ) : (
                <button onClick={() => checkIn(b.id)} className="ui-btn ui-btn-primary shrink-0">
                  Check in
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {!loading && bookings.length > 0 && (
        <Link href={"/guide/photos/" + slotId}
          className="ui-card ui-card-hover flex items-center justify-center gap-2 mt-6 p-4 font-semibold text-[14px] active:scale-[0.99]"
          style={{ color: "var(--ck-text-strong)" }}>
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
