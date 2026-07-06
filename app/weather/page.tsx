"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowsClockwise, CalendarBlank } from "@phosphor-icons/react";
import { confirmAction, notify } from "../lib/app-notify";
import { getAdminTimezone } from "../lib/admin-timezone";
import { supabase } from "../lib/supabase";
import { useBusinessContext } from "../../components/BusinessContext";

const DAYS = 7;

type WeatherLocation = { id: string; name: string; lat: number; lon: number; wgSpot?: number; isDefault?: boolean };

const DEFAULT_LOCATIONS: WeatherLocation[] = [
  { id: "1", name: "Three Anchor Bay, Sea Point", lat: -33.908, lon: 18.396, wgSpot: 137629, isDefault: true },
  { id: "2", name: "Simon's Town", lat: -34.19, lon: 18.45, wgSpot: 115767 },
  { id: "3", name: "Hout Bay", lat: -34.05, lon: 18.35, wgSpot: 51651 },
  { id: "4", name: "Table Bay", lat: -33.9, lon: 18.43, wgSpot: 32831 },
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

    // Windguru renders its forecast into an <iframe> it injects as a sibling of
    // the target div (not into the target itself), so the widget is "ready" once
    // that iframe appears. Watching the whole container for the iframe fixes the
    // false error banner that showed next to a fully-rendered forecast grid.
    const hasWidget = () => !!container.querySelector("iframe");
    let failSafe = 0;
    const observer = new MutationObserver(() => {
      if (hasWidget()) {
        onStateChange("ready");
        observer.disconnect();
        window.clearTimeout(failSafe);
      }
    });
    observer.observe(container, { childList: true, subtree: true });

    const script = document.createElement("script");
    script.src = `https://www.windguru.cz/js/widget.php?s=${spotId}&uid=${uid}&wj=knots&tj=c&p=WINDSPD,GUST,SMER,WAVES,WVPER,WVDIR,TMPE,CDC,APCP1s,RATING&b=1&hc=%23333&dc=gray&tc=%23333&lng=en&wl=3`;
    script.async = true;
    script.onerror = () => {
      observer.disconnect();
      window.clearTimeout(failSafe);
      onStateChange("error");
    };
    container.appendChild(script);

    failSafe = window.setTimeout(() => {
      observer.disconnect();
      onStateChange(hasWidget() ? "ready" : "error");
    }, 10000);

    return () => {
      observer.disconnect();
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

  // Locations are managed on the dashboard and stored per business in
  // businesses.weather_widget_locations — read the same source here.
  useEffect(() => {
    if (!businessId) return;
    (async () => {
      const { data } = await supabase
        .from("businesses")
        .select("weather_widget_locations")
        .eq("id", businessId)
        .maybeSingle();
      const stored = data?.weather_widget_locations;
      if (Array.isArray(stored) && stored.length > 0) {
        const parsed = stored as WeatherLocation[];
        setLocations(parsed);
        setSelectedLocationId((parsed.find((location) => location.isDefault) || parsed[0]).id);
      }
    })();
  }, [businessId]);

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
      message: "This will cancel all bookings on this slot, notify all customers with a self-service link, and process refunds server-side. Continue?",
      tone: "warning",
      confirmLabel: "Cancel slot",
    })) return;
    setCancelling(slotId);
    try {
      const { data, error } = await supabase.functions.invoke("weather-cancel", {
        body: { slot_ids: [slotId], business_id: businessId, reason },
      });
      if (error || (data as any)?.error) {
        notify({ title: "Weather cancellation failed", message: error?.message || (data as any)?.error || "Unknown error", tone: "error" });
      } else {
        const refundMsg = (data as any)?.refunds_queued > 0
          ? ` ${(data as any).refunds_queued} refund(s) processed server-side.`
          : "";
        notify({ title: "Weather cancellation completed", message: `${(data as any)?.bookings_cancelled || 0} booking(s) cancelled and notified.${refundMsg}`, tone: "success" });
      }
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
      message: `This will cancel all ${slots.length} slot(s) in the next ${DAYS} days, notify customers with self-service links, and process refunds server-side. Continue?`,
      tone: "warning",
      confirmLabel: "Cancel all slots",
    })) return;
    setCancellingAll(true);
    try {
      const allSlotIds = slots.map((s: any) => s.id);
      const { data, error } = await supabase.functions.invoke("weather-cancel", {
        body: { slot_ids: allSlotIds, business_id: businessId, reason },
      });
      if (error || (data as any)?.error) {
        notify({ title: "Weather cancellation failed", message: error?.message || (data as any)?.error || "Unknown error", tone: "error" });
      } else {
        const refundMsg = (data as any)?.refunds_queued > 0
          ? ` ${(data as any).refunds_queued} refund(s) processed server-side.`
          : "";
        notify({ title: "All slots cancelled", message: `${(data as any)?.slots_closed || 0} slot(s) closed, ${(data as any)?.bookings_cancelled || 0} booking(s) cancelled.${refundMsg}`, tone: "success" });
      }
    } catch (err: any) {
      notify({ title: "Weather cancellation failed", message: "Error: " + err.message, tone: "error" });
    }
    setCancellingAll(false);
    void load();
  }

  return (
    <div className="space-y-6">
      <div className="anim-fade-up">
        <p className="ui-mono-label mb-2">Operations</p>
        <h2 className="font-display text-[28px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}>Weather operations</h2>
        <p className="mt-2 max-w-2xl text-sm" style={{ color: "var(--ck-text-muted)" }}>Review live wind and swell context before deciding whether trips should run, then action weather cancellations from the same screen.</p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="ui-card p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--ck-text-strong)" }}>Windguru forecast</h3>
              <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>Forecast remains dynamic and updates when the selected location changes.</p>
            </div>
            <div className="flex items-center gap-2">
              <select value={selectedLocationId} onChange={(e) => setSelectedLocationId(e.target.value)} className="ui-control">
                {locations.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </select>
              <button type="button" onClick={() => setWgRefreshKey((key) => key + 1)} className="ui-btn ui-btn-ghost !h-9 !px-3 !text-[12.5px]">
                <ArrowsClockwise size={14} />
                Refresh
              </button>
            </div>
          </div>

          <div className="mt-4">
            {location?.wgSpot ? (
              <>
                <WindguruWidget spotId={location.wgSpot} refreshKey={wgRefreshKey} onStateChange={setWgState} />
                {wgState === "loading" && (
                  <div className="mt-3 rounded-xl border px-4 py-3 text-sm" style={{ background: "var(--ck-ocean-soft)", borderColor: "color-mix(in srgb, var(--ck-ocean) 25%, transparent)", color: "var(--ck-ocean)" }}>
                    Loading Windguru forecast for {location.name}...
                  </div>
                )}
                {wgState === "error" && (
                  <div className="mt-3 rounded-xl border px-4 py-3 text-sm" style={{ background: "var(--ck-danger-soft)", borderColor: "color-mix(in srgb, var(--ck-danger) 25%, transparent)", color: "var(--ck-danger)" }}>
                    <p>Windguru could not be loaded for this location right now.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => setWgRefreshKey((k) => k + 1)}
                        className="ui-btn ui-btn-danger !h-8 !px-3 !text-[12px]"
                      >
                        <ArrowsClockwise size={14} />
                        Retry widget
                      </button>
                      <a
                        href={`https://www.windguru.cz/${location.wgSpot}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ui-btn ui-btn-danger !h-8 !px-3 !text-[12px]"
                      >
                        Open forecast on Windguru &#8599;
                      </a>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="ui-empty">
                <span className="ui-icon-chip"><CalendarBlank size={19} /></span>
                <p className="text-[13px] font-medium" style={{ color: "var(--ck-text-muted)" }}>This location does not have a Windguru spot configured yet.</p>
              </div>
            )}
          </div>
        </div>

        <div className="ui-card p-5">
          <div>
            <div>
              <h3 className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--ck-text-strong)" }}>Upcoming slots at risk</h3>
              <p className="mt-1 text-sm" style={{ color: "var(--ck-text-muted)" }}>{slots.length} upcoming booked slot(s) in the next {DAYS} days can be cancelled from this page if conditions turn unsafe.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="ui-card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--ck-text-strong)" }}>Weather cancellation queue</h3>
            <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>Cancel trips due to weather. Customers are notified and full refunds are queued automatically.</p>
          </div>
          {slots.length > 1 && (
            <button
              onClick={cancelAllSlots}
              disabled={cancellingAll || !!cancelling}
              className="ui-btn ui-btn-danger disabled:opacity-50"
            >
              {cancellingAll ? "Cancelling all..." : `Cancel all ${slots.length} slots`}
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="text-sm" style={{ color: "var(--ck-text-muted)" }}>Reason</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="ui-control w-full sm:max-w-md"
          />
        </div>

        <div className="mt-5">
          {loading ? (
            <div className="space-y-3">
              <div className="ui-skeleton h-[76px] w-full !rounded-xl" />
              <div className="ui-skeleton h-[76px] w-full !rounded-xl" />
            </div>
          ) : slots.length === 0 ? (
            <div className="ui-empty">
              <span className="ui-icon-chip"><CalendarBlank size={19} /></span>
              <p className="text-[13px] font-medium" style={{ color: "var(--ck-text-muted)" }}>No upcoming slots with bookings in the next {DAYS} days.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {slots.map((slot: any) => (
                <div key={slot.id} className="flex flex-col gap-3 rounded-xl border p-4 md:flex-row md:items-center md:justify-between" style={{ borderColor: "var(--ck-border-subtle)", background: "var(--ck-surface-warm)" }}>
                  <div>
                    <p className="font-semibold" style={{ color: "var(--ck-text-strong)" }}>{slot.tours?.name}</p>
                    <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>{fmtTime(slot.start_time)}</p>
                    <p className="text-sm tabular-nums" style={{ color: "var(--ck-text-muted)" }}>{slot.booked} booked · {slot.capacity_total} capacity</p>
                  </div>
                  <button
                    onClick={() => cancelSlot(slot.id)}
                    disabled={cancelling === slot.id || cancellingAll}
                    className="ui-btn ui-btn-danger disabled:opacity-50"
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
