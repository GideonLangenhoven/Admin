"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { confirmAction, notify } from "../lib/app-notify";
import { getAdminTimezone } from "../lib/admin-timezone";
import { supabase } from "../lib/supabase";
import { useBusinessContext } from "../../components/BusinessContext";

const SU = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SK = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const DAYS = 7;

type WeatherLocation = { id: string; name: string; lat: number; lon: number; wgSpot?: number; isDefault?: boolean };

const DEFAULT_LOCATIONS: WeatherLocation[] = [
  { id: "1", name: "Three Anchor Bay, Sea Point", lat: -33.908, lon: 18.396, wgSpot: 137629, isDefault: true },
  { id: "2", name: "Simon's Town", lat: -34.19, lon: 18.45, wgSpot: 20 },
  { id: "3", name: "Hout Bay", lat: -34.05, lon: 18.35, wgSpot: 12 },
  { id: "4", name: "Table Bay", lat: -33.9, lon: 18.43, wgSpot: 9 },
];

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-ZA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: getAdminTimezone() });
}

function WindguruWidget({
  spotId,
  refreshKey,
  onStateChange,
}: {
  spotId: number;
  refreshKey: number;
  onStateChange: (state: "loading" | "ready" | "error") => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";
    onStateChange("loading");

    const uid = `wg_fwdg_${spotId}_100`;
    const target = document.createElement("div");
    target.id = uid;
    container.appendChild(target);

    const script = document.createElement("script");
    script.src = `https://www.windguru.cz/js/widget.php?s=${spotId}&uid=${uid}&wj=knots&tj=c&p=WINDSPD,GUST,SMER,WAVES,WVPER,WVDIR,TMPE,CDC,APCP1s,RATING&b=1&hc=%23333&dc=gray&tc=%23333&lng=en&wl=3`;
    script.async = true;
    script.onload = () => window.setTimeout(() => {
      const hasContent = !!target.innerHTML.trim();
      onStateChange(hasContent ? "ready" : "error");
    }, 1800);
    script.onerror = () => onStateChange("error");
    container.appendChild(script);

    const failSafe = window.setTimeout(() => {
      const hasContent = !!target.innerHTML.trim();
      onStateChange(hasContent ? "ready" : "error");
    }, 5000);

    return () => {
      window.clearTimeout(failSafe);
      if (container) container.innerHTML = "";
    };
  }, [spotId, refreshKey, onStateChange]);

  return <div ref={containerRef} className="min-h-[360px] w-full overflow-x-auto rounded-xl bg-white" />;
}

export default function Weather() {
  const { businessId } = useBusinessContext();
  const [slots, setSlots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancellingAll, setCancellingAll] = useState(false);
  const [reason, setReason] = useState("weather conditions");
  const [locations, setLocations] = useState<WeatherLocation[]>(DEFAULT_LOCATIONS);
  const [selectedLocationId, setSelectedLocationId] = useState(DEFAULT_LOCATIONS[0].id);
  const [wgState, setWgState] = useState<"loading" | "ready" | "error">("loading");
  const [wgRefreshKey, setWgRefreshKey] = useState(0);

  useEffect(() => {
    const saved = localStorage.getItem("ck_weather_locations");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as WeatherLocation[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setLocations(parsed);
          setSelectedLocationId((parsed.find((location) => location.isDefault) || parsed[0]).id);
        }
      } catch { }
    }
  }, []);

  useEffect(() => {
    if (businessId) void load();
  }, [businessId]);

  async function load() {
    if (!businessId) return;
    setLoading(true);
    const now = new Date();
    const inN = new Date(now.getTime() + DAYS * 24 * 60 * 60 * 1000);
    const { data } = await supabase.from("slots")
      .select("id, start_time, capacity_total, booked, held, status, tours(name)")
      .eq("business_id", businessId)
      .gt("start_time", now.toISOString())
      .lt("start_time", inN.toISOString())
      .gt("booked", 0)
      .eq("status", "OPEN")
      .order("start_time", { ascending: true });
    setSlots(data || []);
    setLoading(false);
  }

  const location = useMemo(() => locations.find((entry) => entry.id === selectedLocationId) || locations[0] || null, [locations, selectedLocationId]);

  async function cancelSlot(slotId: string) {
    if (!await confirmAction({
      title: "Cancel weather-affected slot",
      message: "This will cancel all bookings on this slot, notify all customers, and queue full refunds. Continue?",
      tone: "warning",
      confirmLabel: "Cancel slot",
    })) return;
    setCancelling(slotId);
    try {
      await supabase.from("slots").update({ status: "CLOSED" }).eq("id", slotId);
      const { data: bookings } = await supabase
        .from("bookings")
        .select("id, customer_name, phone, email, qty, total_amount, status, tours(name), slots(start_time)")
        .eq("business_id", businessId)
        .eq("slot_id", slotId)
        .in("status", ["PAID", "CONFIRMED", "HELD", "PENDING"]);

      const affected = bookings || [];
      for (const booking of affected) {
        const isPaid = ["PAID", "CONFIRMED"].includes(booking.status);
        const refundAmount = isPaid ? Number(booking.total_amount || 0) : 0;
        await supabase.from("bookings").update({
          status: "CANCELLED",
          cancellation_reason: "Weather cancellation: " + reason,
          cancelled_at: new Date().toISOString(),
          ...(isPaid && refundAmount > 0 ? {
            refund_status: "REQUESTED",
            refund_amount: refundAmount,
            refund_notes: "100% refund — weather cancellation",
          } : {}),
        }).eq("id", booking.id);

        const slotData = await supabase.from("slots").select("booked, held").eq("id", slotId).single();
        if (slotData.data) {
          await supabase.from("slots").update({
            booked: Math.max(0, slotData.data.booked - booking.qty),
            held: Math.max(0, (slotData.data.held || 0) - (booking.status === "HELD" ? booking.qty : 0)),
          }).eq("id", slotId);
        }

        await supabase.from("holds").update({ status: "CANCELLED" }).eq("booking_id", booking.id).eq("status", "ACTIVE");
        const ref = booking.id.substring(0, 8).toUpperCase();
        const tourName = (booking as any).tours?.name || "Tour";
        const startTime = (booking as any).slots?.start_time ? fmtTime((booking as any).slots.start_time) : "";

        if (booking.phone) {
          try {
            await fetch(SU + "/functions/v1/send-whatsapp-text", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: "Bearer " + SK },
              body: JSON.stringify({
                business_id: businessId,
                to: booking.phone,
                message: "Trip Cancelled — Weather\n\n" +
                  "Hi " + (booking.customer_name?.split(" ")[0] || "there") + ", unfortunately your " + tourName + " on " + startTime +
                  " has been cancelled due to " + reason + ".\n\n" +
                  "Ref: " + ref + "\n" +
                  (isPaid && refundAmount > 0 ? "A full refund of R" + refundAmount + " has been submitted.\n\n" : "") +
                  "You’re welcome to rebook anytime.",
              }),
            });
          } catch { }
        }

        if (booking.email) {
          try {
            await supabase.functions.invoke("send-email", {
              body: {
                type: "CANCELLATION",
                data: {
                  business_id: businessId,
                  email: booking.email,
                  customer_name: booking.customer_name || "Guest",
                  ref,
                  tour_name: tourName,
                  start_time: startTime,
                  reason,
                  total_amount: isPaid && refundAmount > 0 ? refundAmount : null,
                },
              },
            });
          } catch { }
        }
      }
      notify({ title: "Weather cancellation completed", message: "Refunds were queued where needed.", tone: "success" });
    } catch (err: any) {
      notify({ title: "Weather cancellation failed", message: "Error: " + err.message, tone: "error" });
    }
    setCancelling(null);
    void load();
  }

  async function cancelAllSlots() {
    if (slots.length === 0) return;
    if (!await confirmAction({
      title: "Cancel all weather slots",
      message: `This will cancel all ${slots.length} slot(s) in the next ${DAYS} days and notify customers. Continue?`,
      tone: "warning",
      confirmLabel: "Cancel all slots",
    })) return;
    setCancellingAll(true);
    for (const slot of slots) {
      await cancelSlot(slot.id);
    }
    setCancellingAll(false);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Weather operations</h2>
            <p className="mt-2 max-w-2xl text-sm text-gray-500">Review live wind and swell context before deciding whether trips should run, then action weather cancellations from the same screen.</p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center text-sm">
            <div className="rounded-xl bg-emerald-50 px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Low risk</p>
              <p className="mt-1 font-semibold text-emerald-900">Wind under 12kt</p>
            </div>
            <div className="rounded-xl bg-amber-50 px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Review</p>
              <p className="mt-1 font-semibold text-amber-900">12kt to 18kt</p>
            </div>
            <div className="rounded-xl bg-red-50 px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-700">High risk</p>
              <p className="mt-1 font-semibold text-red-900">18kt+ or large swell</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Windguru forecast</h3>
              <p className="text-sm text-gray-500">Forecast remains dynamic and updates when the selected location changes.</p>
            </div>
            <div className="flex items-center gap-2">
              <select value={selectedLocationId} onChange={(e) => setSelectedLocationId(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
                {locations.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </select>
              <button type="button" onClick={() => setWgRefreshKey((key) => key + 1)} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                <RefreshCw size={14} />
                Refresh
              </button>
            </div>
          </div>

          <div className="mt-4">
            {location?.wgSpot ? (
              <>
                <WindguruWidget spotId={location.wgSpot} refreshKey={wgRefreshKey} onStateChange={setWgState} />
                {wgState === "loading" && (
                  <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                    Loading Windguru forecast for {location.name}...
                  </div>
                )}
                {wgState === "error" && (
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    Windguru could not be loaded for this location right now. Retry the widget or open the source forecast directly.
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">
                This location does not have a Windguru spot configured yet.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <h3 className="text-lg font-semibold text-gray-900">Decision notes</h3>
            <div className="mt-4 space-y-3 text-sm text-gray-600">
              <div className="rounded-xl bg-gray-50 px-3 py-3">Check wind speed, gust spread, and wave height together. Strong gust variance usually matters more than a single average wind number.</div>
              <div className="rounded-xl bg-gray-50 px-3 py-3">Use swell period and direction for exposed routes. Long-period swell with onshore wind should be treated as operationally higher risk.</div>
              <div className="rounded-xl bg-gray-50 px-3 py-3">If the widget fails, the screen stays usable and the cancellation queue remains available below.</div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 text-amber-500" size={18} />
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Upcoming slots at risk</h3>
                <p className="mt-1 text-sm text-gray-500">{slots.length} upcoming booked slot(s) in the next {DAYS} days can be cancelled from this page if conditions turn unsafe.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Weather cancellation queue</h3>
            <p className="text-sm text-gray-500">Cancel trips due to weather. Customers are notified and full refunds are queued automatically.</p>
          </div>
          {slots.length > 1 && (
            <button
              onClick={cancelAllSlots}
              disabled={cancellingAll || !!cancelling}
              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
            >
              {cancellingAll ? "Cancelling all..." : `Cancel all ${slots.length} slots`}
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="text-sm text-gray-600">Reason</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:max-w-md"
          />
        </div>

        <div className="mt-5">
          {loading ? (
            <p className="text-sm text-gray-500">Loading weather-sensitive slots...</p>
          ) : slots.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-gray-500">
              No upcoming slots with bookings in the next {DAYS} days.
            </div>
          ) : (
            <div className="space-y-3">
              {slots.map((slot: any) => (
                <div key={slot.id} className="flex flex-col gap-3 rounded-xl border border-gray-200 p-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-semibold text-gray-900">{slot.tours?.name}</p>
                    <p className="text-sm text-gray-500">{fmtTime(slot.start_time)}</p>
                    <p className="text-sm text-gray-500">{slot.booked} booked · {slot.capacity_total} capacity</p>
                  </div>
                  <button
                    onClick={() => cancelSlot(slot.id)}
                    disabled={cancelling === slot.id || cancellingAll}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {cancelling === slot.id ? "Cancelling..." : "Cancel and notify all"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
