"use client";
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { supabase } from "./lib/supabase";
import { confirmAction, notify } from "./lib/app-notify";
import { getAdminTimezone } from "./lib/admin-timezone";
import { useBusinessContext } from "../components/BusinessContext";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
    Plus, CaretLeft, CaretRight,
    CheckCircle, GearSix, X, Trash, MapPin, ArrowsClockwise
} from "@phosphor-icons/react";

/* ── helpers ── */
function fmtTime(iso: string) {
    return new Date(iso).toLocaleString("en-ZA", {
        hour: "2-digit", minute: "2-digit", hour12: false,
        timeZone: getAdminTimezone(),
    });
}

type WeatherLocation = { id: string; name: string; lat: number; lon: number; wgSpot?: number; isDefault?: boolean; };

/* ── preset locations ── */
const DEFAULT_LOCATIONS: WeatherLocation[] = [
    { id: "1", name: "Three Anchor Bay, Sea Point", lat: -33.908, lon: 18.396, wgSpot: 137629, isDefault: true },
    { id: "2", name: "Simon's Town", lat: -34.19, lon: 18.45, wgSpot: 20 },
    { id: "3", name: "Hout Bay", lat: -34.05, lon: 18.35, wgSpot: 12 },
    { id: "4", name: "Table Bay", lat: -33.90, lon: 18.43, wgSpot: 9 },
    { id: "5", name: "False Bay (Muizenberg)", lat: -34.10, lon: 18.47, wgSpot: 11 },
    { id: "6", name: "Kalk Bay", lat: -34.13, lon: 18.45, wgSpot: 20 },
    { id: "7", name: "Cape Point", lat: -34.35, lon: 18.50, wgSpot: 10 },
    { id: "8", name: "Camps Bay", lat: -33.95, lon: 18.38, wgSpot: 7 },
    { id: "9", name: "Gordon's Bay", lat: -34.16, lon: 18.87, wgSpot: 18 },
];

/* ── Windguru Widget (lazy-loaded to reduce initial bundle) ── */
const WindguruWidget = dynamic(() => import("../components/WindguruWidget"), {
    ssr: false,
    loading: () => <div className="w-full min-h-[350px] flex items-center justify-center text-sm text-gray-400">Loading weather...</div>,
});

/* ── types ── */
interface ManifestBooking {
    id: string;
    customer_name: string;
    phone: string;
    qty: number;
    total_amount: number;
    status: string;
    checked_in: boolean;
    tours: { name?: string } | null;
    slots: { start_time?: string } | null;
}

interface SlotSummary {
    time: string;
    timeRaw: string;
    tourName: string;
    totalPax: number;
    checkedIn: number;
    bookingCount: number;
    bookings: ManifestBooking[];
}

/* ── main component ── */
export default function Dashboard() {
    const { businessId } = useBusinessContext();
    const [refundCount, setRefundCount] = useState(0);
    const [refundTotal, setRefundTotal] = useState(0);
    const [inboxCount, setInboxCount] = useState(0);
    const [photosOutstanding, setPhotosOutstanding] = useState(0);
    const [todayBookings, setTodayBookings] = useState(0);
    const [todayPax, setTodayPax] = useState(0);
    const [manifest, setManifest] = useState<ManifestBooking[]>([]);
    const [tomorrowManifest, setTomorrowManifest] = useState<ManifestBooking[]>([]);
    const [manifestDate, setManifestDate] = useState<"TODAY" | "TOMORROW">("TODAY");
    const [tomorrowPax, setTomorrowPax] = useState(0);
    const [loading, setLoading] = useState(true);

    // Roll call state
    const [activeSlotIdx, setActiveSlotIdx] = useState(0);
    const [manualSlotNav, setManualSlotNav] = useState(false);
    const [now, setNow] = useState(() => Date.now());

    // Weather location
    const [locations, setLocations] = useState<WeatherLocation[]>([]);
    const [location, setLocation] = useState<WeatherLocation | null>(null);

    // Weather management
    const [editingLocs, setEditingLocs] = useState(false);
    const [wgRefreshKey, setWgRefreshKey] = useState(0);
    const [windyRefreshKey, setWindyRefreshKey] = useState(0);
    const [savingLocations, setSavingLocations] = useState(false);
    const [newLocName, setNewLocName] = useState("");
    const [newLocLat, setNewLocLat] = useState("");
    const [newLocLon, setNewLocLon] = useState("");
    const [newLocWg, setNewLocWg] = useState("");
    const [geocoding, setGeocoding] = useState(false);

    useEffect(() => {
        if (!businessId) return;
        loadWeatherLocations();
    }, [businessId]);

    useEffect(() => {
        const iv = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(iv);
    }, []);

    async function loadWeatherLocations() {
        try {
            const { data, error } = await supabase
                .from("businesses")
                .select("weather_widget_locations")
                .eq("id", businessId)
                .maybeSingle();
            if (error) throw error;

            const stored = Array.isArray(data?.weather_widget_locations) && data.weather_widget_locations.length > 0
                ? data.weather_widget_locations as WeatherLocation[]
                : DEFAULT_LOCATIONS;

            setLocations(stored);
            setLocation((current) => stored.find((loc) => loc.id === current?.id) || stored.find((loc) => loc.isDefault) || stored[0] || null);
        } catch (e) {
            console.error("Failed to load weather locations:", e);
            setLocations(DEFAULT_LOCATIONS);
            setLocation(DEFAULT_LOCATIONS.find(l => l.isDefault) || DEFAULT_LOCATIONS[0] || null);
            notify({ title: "Weather locations unavailable", message: "Falling back to the default location list for this dashboard.", tone: "warning" });
        }
    }

    const saveLocations = async (locs: WeatherLocation[]) => {
        setSavingLocations(true);
        try {
            const normalized = locs.map((loc, index) => ({ ...loc, isDefault: loc.isDefault || (index === 0 && !locs.some((item) => item.isDefault)) }));
            const { error } = await supabase
                .from("businesses")
                .update({ weather_widget_locations: normalized })
                .eq("id", businessId);
            if (error) throw error;
            setLocations(normalized);
            setLocation((current) => normalized.find((loc) => loc.id === current?.id) || normalized.find((loc) => loc.isDefault) || normalized[0] || null);
        } catch (e) {
            console.error("Failed to save weather locations:", e);
            notify({ title: "Save failed", message: "Could not save weather locations for this business.", tone: "error" });
            throw e;
        } finally {
            setSavingLocations(false);
        }
    };

    const removeLocation = async (id: string) => {
        if (!await confirmAction({ title: "Remove weather location", message: "Remove this location?", tone: "warning", confirmLabel: "Remove" })) return;
        const next = locations.filter(l => l.id !== id);
        if (next.length > 0 && !next.find(l => l.isDefault)) next[0].isDefault = true;
        await saveLocations(next);
        notify({ title: "Location removed", message: "The weather location was removed from this business dashboard.", tone: "success" });
    };

    const handleGeocode = async () => {
        if (!newLocName.trim()) return;
        setGeocoding(true);
        try {
            // Step 1: geocode via Nominatim → lat/lon
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(newLocName)}`);
            const data = await res.json();
            if (data && data.length > 0) {
                const lat = parseFloat(data[0].lat);
                const lon = parseFloat(data[0].lon);
                setNewLocLat(String(lat));
                setNewLocLon(String(lon));

                // Step 2: search Windguru for closest spot (only if not already set)
                if (!newLocWg) {
                    try {
                        const wgRes = await fetch(
                            `https://www.windguru.cz/int/iapi.php?q=search_spots&search=${encodeURIComponent(newLocName)}`,
                            { headers: { Accept: "application/json", Referer: "https://www.windguru.cz/" } }
                        );
                        const wgData = await wgRes.json();
                        if (Array.isArray(wgData) && wgData.length > 0) {
                            // Pick closest by distance if coordinates are present, otherwise first result
                            let best = wgData[0];
                            if (wgData[0].lat != null && wgData[0].lon != null) {
                                let minDist = Infinity;
                                for (const spot of wgData) {
                                    if (spot.lat == null || spot.lon == null) continue;
                                    const d = (spot.lat - lat) ** 2 + (spot.lon - lon) ** 2;
                                    if (d < minDist) { minDist = d; best = spot; }
                                }
                            }
                            if (best?.id_spot) setNewLocWg(String(best.id_spot));
                        }
                    } catch {
                        // Windguru search failed (CORS or network) — silently skip, user can enter manually
                    }
                }
            } else {
                notify({ title: "Coordinates not found", message: "Could not find location coordinates automatically. Please enter them manually.", tone: "warning" });
            }
        } catch (e) {
            notify({ title: "Location lookup failed", message: "Error finding location.", tone: "error" });
        }
        setGeocoding(false);
    };

    const handleAddLocation = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newLocName || !newLocLat || !newLocLon) return;
        const next = [...locations, {
            id: Date.now().toString(),
            name: newLocName,
            lat: parseFloat(newLocLat),
            lon: parseFloat(newLocLon),
            wgSpot: newLocWg ? parseInt(newLocWg) : undefined,
            isDefault: locations.length === 0
        }];
        await saveLocations(next);
        setNewLocName(""); setNewLocLat(""); setNewLocLon(""); setNewLocWg("");
        notify({ title: "Location saved", message: "Weather location saved for this business.", tone: "success" });
    };

    // Group manifest into slots
    const activeManifest = manifestDate === "TODAY" ? manifest : tomorrowManifest;
    const slotGroups: SlotSummary[] = useMemo(() => {
        const groups = new Map<string, ManifestBooking[]>();
        for (const b of activeManifest) {
            const key = b.slots?.start_time || "unknown";
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(b);
        }
        const result: SlotSummary[] = [];
        for (const [timeRaw, bookings] of groups) {
            const totalPax = bookings.reduce((s, b) => s + b.qty, 0);
            const checkedIn = bookings.filter(b => b.checked_in).reduce((s, b) => s + b.qty, 0);
            result.push({
                time: timeRaw !== "unknown" ? fmtTime(timeRaw) : "—",
                timeRaw,
                tourName: bookings[0]?.tours?.name || "Tour",
                totalPax,
                checkedIn,
                bookingCount: bookings.length,
                bookings,
            });
        }
        result.sort((a, b) => a.timeRaw.localeCompare(b.timeRaw));
        return result;
    }, [manifest, tomorrowManifest, manifestDate]);

    // Auto-advance roll call: show next slot 4 min after its time
    useEffect(() => {
        if (manualSlotNav || slotGroups.length === 0) return;
        function findCurrentSlot() {
            const now = new Date();
            const buffer = 4 * 60 * 1000; // 4 minutes
            let idx = 0;
            for (let i = 0; i < slotGroups.length; i++) {
                const slotTime = new Date(slotGroups[i].timeRaw);
                if (now.getTime() >= slotTime.getTime() + buffer && i + 1 < slotGroups.length) {
                    idx = i + 1;
                }
            }
            setActiveSlotIdx(idx);
        }
        findCurrentSlot();
        const timer = setInterval(findCurrentSlot, 30000);
        return () => clearInterval(timer);
    }, [slotGroups, manualSlotNav]);

    useEffect(() => { if (businessId) load(); }, [businessId]);

    // Realtime: refresh dashboard when bookings change (refund processed, new booking, etc.)
    useEffect(() => {
        if (!businessId) return;
        const ch = supabase.channel("dash-bookings-" + businessId)
            .on("postgres_changes" as any, { event: "*", schema: "public", table: "bookings" }, () => load())
            .subscribe();
        return () => { supabase.removeChannel(ch); };
    }, [businessId]);

    async function load() {
        setLoading(true);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
        const dayAfter = new Date(tomorrow); dayAfter.setDate(dayAfter.getDate() + 1);
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const nowISO = new Date().toISOString();

        // Helper to fetch bookings for a date range's slots (two-step: slots → bookings)
        async function fetchManifest(from: Date, to: Date): Promise<ManifestBooking[]> {
            const { data: slots } = await supabase.from("slots").select("id")
                .eq("business_id", businessId).gte("start_time", from.toISOString()).lt("start_time", to.toISOString());
            const slotIds = (slots || []).map((s: any) => s.id);
            if (slotIds.length === 0) return [];
            const { data: bks } = await supabase.from("bookings")
                .select("id, customer_name, phone, qty, total_amount, status, checked_in, slots(start_time), tours(name)")
                .eq("business_id", businessId).neq("status", "CANCELLED").in("slot_id", slotIds)
                .order("created_at", { ascending: true });
            return (bks || []).map((b: any) => ({
                ...b,
                tours: Array.isArray(b.tours) ? b.tours[0] : b.tours,
                slots: Array.isArray(b.slots) ? b.slots[0] : b.slots,
            })).filter((b: any) => b.slots?.start_time);
        }

        // Run ALL independent queries in parallel
        const [todayManifest, tomorrowData, refundsData, inboxData, photosData] = await Promise.all([
            fetchManifest(today, tomorrow),
            fetchManifest(tomorrow, dayAfter),
            supabase.from("bookings").select("id, refund_amount").eq("business_id", businessId).in("refund_status", ["REQUESTED", "ACTION_REQUIRED"]),
            supabase.from("conversations").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("status", "HUMAN"),
            Promise.all([
                supabase.from("slots").select("id, start_time, booked").eq("business_id", businessId).lt("start_time", nowISO).gt("start_time", weekAgo).gt("booked", 0),
                supabase.from("trip_photos").select("slot_id").eq("business_id", businessId).gt("uploaded_at", weekAgo),
            ]),
        ]);

        // Today
        setManifest(todayManifest);
        setTodayBookings(todayManifest.length);
        setTodayPax(todayManifest.reduce((s, b) => s + b.qty, 0));

        // Tomorrow
        setTomorrowManifest(tomorrowData);
        setTomorrowPax(tomorrowData.reduce((s, b) => s + b.qty, 0));

        // Refunds
        const refunds = refundsData.data || [];
        setRefundCount(refunds.length);
        setRefundTotal(refunds.reduce((s: number, b: any) => s + Number(b.refund_amount || 0), 0));

        // Inbox
        setInboxCount(inboxData.count || 0);

        // Photos outstanding
        const [completedSlotsRes, sentPhotosRes] = photosData;
        const sentSlotIds = new Set((sentPhotosRes.data || []).map((p: any) => p.slot_id));
        const outstanding = (completedSlotsRes.data || []).filter((s: any) => !sentSlotIds.has(s.id));
        setPhotosOutstanding(outstanding.length);

        setLoading(false);
    }

    async function toggleCheckIn(bookingId: string, currentValue: boolean) {
        const newValue = !currentValue;
        // Optimistic update
        setManifest(prev => prev.map(b =>
            b.id === bookingId
                ? { ...b, checked_in: newValue }
                : b
        ));
        setTomorrowManifest(prev => prev.map(b =>
            b.id === bookingId
                ? { ...b, checked_in: newValue }
                : b
        ));
        const { error } = await supabase
            .from("bookings")
            .update({
                checked_in: newValue,
                checked_in_at: newValue ? new Date().toISOString() : null,
            })
            .eq("id", bookingId);
        if (error) {
            // Revert on error
            setManifest(prev => prev.map(b =>
                b.id === bookingId
                    ? { ...b, checked_in: currentValue }
                    : b
            ));
            setTomorrowManifest(prev => prev.map(b =>
                b.id === bookingId
                    ? { ...b, checked_in: currentValue }
                    : b
            ));
        }
    }

    const activeSlot = slotGroups[activeSlotIdx] || null;

    if (loading) return (
        <div className="flex h-64 items-center justify-center">
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-t-[var(--ck-accent)]" style={{ borderColor: "var(--ck-border-subtle)", borderTopColor: "var(--ck-accent)" }}></div>
        </div>
    );

    return (
        <div className="space-y-6 max-w-[1400px] mx-auto pb-10">
            {/* Dashboard Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 pt-2">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-gray-900">Dashboard</h2>
                </div>
                <div className="flex items-center gap-3">
                    <Link href="/new-booking" className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white transition-all hover:opacity-90 bg-donezo-gradient shadow-sm">
                        <Plus size={16} weight="bold" /> Add Booking
                    </Link>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                {/* Today Pax */}
                <Link href="/bookings" className="block p-6 transition-all hover:-translate-y-1 relative group rounded-[24px] shadow-sm bg-donezo-gradient text-white">
                    <div className="flex justify-between items-start mb-6">
                        <span className="text-[16px] font-medium text-white/90">Today's Pax</span>
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 transition-transform group-hover:scale-110">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M196,64V168a12,12,0,0,1-24,0V93L76.49,188.49a12,12,0,0,1-17-17L155,76H88a12,12,0,0,1,0-24H184A12,12,0,0,1,196,64Z"></path></svg>
                        </div>
                    </div>
                    <div>
                        <div className="text-[46px] font-bold tracking-tight text-white mb-4 leading-none">
                            {todayPax}
                        </div>
                        <div className="flex items-center gap-2 text-[13px] text-white/90 font-medium">
                            <span className="flex items-center gap-1 border border-white/30 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white bg-white/10">
                                {todayBookings} trips
                            </span>
                            <span>booked vs {tomorrowPax} tmrw</span>
                        </div>
                    </div>
                </Link>

                {/* Refunds */}
                <Link href="/refunds" className="block bg-white p-6 transition-all hover:-translate-y-1 group rounded-[24px] shadow-sm border border-gray-100">
                    <div className="flex justify-between items-start mb-6">
                        <span className="text-[16px] font-medium text-gray-900">Pending Refunds</span>
                        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-400 group-hover:text-gray-600 group-hover:border-gray-300 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M196,64V168a12,12,0,0,1-24,0V93L76.49,188.49a12,12,0,0,1-17-17L155,76H88a12,12,0,0,1,0-24H184A12,12,0,0,1,196,64Z"></path></svg>
                        </div>
                    </div>
                    <div>
                        <div className="text-[46px] font-bold tracking-tight mb-4 leading-none text-gray-900">
                            {refundCount > 0 ? `R${refundTotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "0"}
                        </div>
                        <div className="flex items-center gap-2 text-[13px] font-medium text-gray-500">
                            <span className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-emerald-700 bg-emerald-50">
                                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="currentColor" viewBox="0 0 256 256"><path d="M213.66,165.66a8,8,0,0,1-11.32,0L128,91.31,53.66,165.66a8,8,0,0,1-11.32-11.32l80-80a8,8,0,0,1,11.32,0l80,80A8,8,0,0,1,213.66,165.66Z"></path></svg>
                                {refundCount}
                            </span>
                            <span>awaiting approval</span>
                        </div>
                    </div>
                </Link>

                {/* Inbox */}
                <Link href="/inbox" className="block bg-white p-6 transition-all hover:-translate-y-1 group rounded-[24px] shadow-sm border border-gray-100">
                    <div className="flex justify-between items-start mb-6">
                        <span className="text-[16px] font-medium text-gray-900">Inbox Action</span>
                        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-400 group-hover:text-gray-600 group-hover:border-gray-300 transition-colors">
                             <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M196,64V168a12,12,0,0,1-24,0V93L76.49,188.49a12,12,0,0,1-17-17L155,76H88a12,12,0,0,1,0-24H184A12,12,0,0,1,196,64Z"></path></svg>
                        </div>
                    </div>
                    <div>
                        <div className="text-[46px] font-bold tracking-tight mb-4 leading-none text-gray-900 flex items-baseline gap-1">
                            {inboxCount} <span className="text-[20px] text-gray-400 font-medium">msgs</span>
                        </div>
                        <div className="flex items-center gap-2 text-[13px] font-medium text-gray-500">
                            <span className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-emerald-700 bg-emerald-50">
                                {inboxCount > 0 ? "Waiting" : "Clear"}
                            </span>
                            <span>conversations</span>
                        </div>
                    </div>
                </Link>

                {/* Photos */}
                <Link href="/photos" className="block bg-white p-6 transition-all hover:-translate-y-1 group rounded-[24px] shadow-sm border border-gray-100">
                    <div className="flex justify-between items-start mb-6">
                        <span className="text-[16px] font-medium text-gray-900">Photos Out</span>
                        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-gray-400 group-hover:text-gray-600 group-hover:border-gray-300 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256"><path d="M196,64V168a12,12,0,0,1-24,0V93L76.49,188.49a12,12,0,0,1-17-17L155,76H88a12,12,0,0,1,0-24H184A12,12,0,0,1,196,64Z"></path></svg>
                        </div>
                    </div>
                    <div>
                        <div className="text-[46px] font-bold tracking-tight mb-4 leading-none text-gray-900 flex items-baseline gap-1">
                            {photosOutstanding} <span className="text-[20px] text-gray-400 font-medium">trips</span>
                        </div>
                        <div className="flex items-center gap-2 text-[13px] font-medium text-gray-500">
                            <span className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold text-emerald-700 bg-emerald-50">
                                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="currentColor" viewBox="0 0 256 256"><path d="M213.66,165.66a8,8,0,0,1-11.32,0L128,91.31,53.66,165.66a8,8,0,0,1-11.32-11.32l80-80a8,8,0,0,1,11.32,0l80,80A8,8,0,0,1,213.66,165.66Z"></path></svg>
                                {photosOutstanding > 0 ? "Missing" : "Clear"}
                            </span>
                            <span>photo uploads</span>
                        </div>
                    </div>
                </Link>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* ── Today's Manifest (pax per slot) ── */}
                <div className="bg-white rounded-[24px] shadow-sm border border-gray-100 flex flex-col overflow-hidden">
                    <div className="flex items-center justify-between p-6 border-b" style={{ borderColor: 'var(--ck-border-subtle)' }}>
                        <div className="flex items-center gap-3">
                            <div>
                                <div className="flex items-center gap-2">
                                    <h3 className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--ck-text-strong)" }}>
                                        {manifestDate === "TODAY" ? "Today's Manifest" : "Tomorrow's Manifest"}
                                    </h3>
                                    <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                                        <button 
                                            onClick={() => { setManifestDate("TODAY"); setActiveSlotIdx(0); }}
                                            className={`p-1 rounded transition-colors ${manifestDate === "TODAY" ? "bg-white dark:bg-gray-700 shadow-sm text-blue-600" : "text-gray-400 hover:text-gray-600"}`}
                                        >
                                            <CaretLeft size={16} />
                                        </button>
                                        <button 
                                            onClick={() => { setManifestDate("TOMORROW"); setActiveSlotIdx(0); }}
                                            className={`p-1 rounded transition-colors ${manifestDate === "TOMORROW" ? "bg-white dark:bg-gray-700 shadow-sm text-blue-600" : "text-gray-400 hover:text-gray-600"}`}
                                        >
                                            <CaretRight size={16} />
                                        </button>
                                    </div>
                                </div>
                                <p className="text-[12px] font-medium" style={{ color: "var(--ck-text-muted)" }}>Pax breakdown per slot</p>
                            </div>
                        </div>
                        <Link href="/new-booking" className="hidden sm:flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[13px] font-medium transition-colors shadow-sm hover:-translate-y-0.5" style={{ background: "var(--ck-accent)", color: "#fff" }}>
                            <Plus size={14} /> Add Booking
                        </Link>
                    </div>

                    <div className="flex-1 overflow-x-auto">
                        {slotGroups.length === 0 ? (
                            <div className="p-8 flex flex-col items-center justify-center text-center">
                                <p className="text-[13px] font-medium" style={{ color: "var(--ck-text-muted)" }}>
                                    {manifestDate === "TODAY" ? "No bookings today." : "No bookings tomorrow."}
                                </p>
                            </div>
                        ) : (
                            <table className="w-full text-sm">
                                <thead>
                                    <tr>
                                        <th className="px-5 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Time</th>
                                        <th className="px-5 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Tour</th>
                                        <th className="px-5 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Bookings</th>
                                        <th className="px-5 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Total Pax</th>
                                        <th className="px-5 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Checked In</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y" style={{ "--tw-divide-color": "var(--ck-border-subtle)" } as React.CSSProperties}>
                                    {slotGroups.map((slot, i) => {
                                        const isPast = manifestDate === "TODAY" && (new Date(slot.timeRaw).getTime() + 4 * 60 * 1000 < now);
                                        return (
                                            <tr
                                                key={slot.timeRaw}
                                                className="transition-colors cursor-pointer"
                                                style={{ opacity: isPast ? 0.5 : 1 }}
                                                onClick={() => { setActiveSlotIdx(i); setManualSlotNav(true); }}
                                                onMouseEnter={(e) => e.currentTarget.style.background = "var(--ck-surface-elevated)"}
                                                onMouseLeave={(e) => e.currentTarget.style.background = ""}
                                            >
                                                <td className="px-5 py-4">
                                                    <div className="font-semibold text-[14px]" style={{ color: "var(--ck-text-strong)" }}>{slot.time}</div>
                                                </td>
                                                <td className="px-5 py-4">
                                                    <div className="text-[13px] font-medium max-w-[120px] truncate" style={{ color: "var(--ck-text-muted)" }} title={slot.tourName}>{slot.tourName}</div>
                                                </td>
                                                <td className="px-5 py-4 text-right">
                                                    <div className="text-[13px] font-medium" style={{ color: "var(--ck-text)" }}>{slot.bookingCount}</div>
                                                </td>
                                                <td className="px-5 py-4 text-right">
                                                    <div className="font-bold text-[16px]" style={{ color: "var(--ck-text-strong)" }}>{slot.totalPax}</div>
                                                </td>
                                                <td className="px-5 py-4 text-right">
                                                    <span className={`inline-block rounded-full px-2.5 py-1 text-[12px] font-bold ${slot.checkedIn === slot.totalPax && slot.totalPax > 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                                                        {slot.checkedIn}/{slot.totalPax}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot>
                                    <tr className="border-t-2" style={{ borderColor: "var(--ck-border-strong)" }}>
                                        <td colSpan={3} className="px-5 py-3 text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--ck-text-muted)" }}>Totals</td>
                                        <td className="px-5 py-3 text-right font-bold text-[16px]" style={{ color: "var(--ck-text-strong)" }}>
                                            {manifestDate === "TODAY" ? todayPax : tomorrowPax}
                                        </td>
                                        <td className="px-5 py-3 text-right">
                                            <span className="inline-block rounded-full px-2.5 py-1 text-[12px] font-bold" style={{ background: "var(--ck-surface-elevated)", color: "var(--ck-text-muted)" }}>
                                                {activeManifest.filter(b => b.checked_in).reduce((s, b) => s + b.qty, 0)}/{manifestDate === "TODAY" ? todayPax : tomorrowPax}
                                            </span>
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        )}
                    </div>
                </div>

                {/* ── Roll Call ── */}
                <div className="bg-white rounded-[24px] shadow-sm border border-gray-100 flex flex-col overflow-hidden">
                    <div className="flex items-center justify-between p-6 border-b" style={{ borderColor: 'var(--ck-border-subtle)' }}>
                        <div className="flex items-center gap-3">
                            <div>
                                <h3 className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--ck-text-strong)" }}>Roll Call</h3>
                                <p className="text-[12px] font-medium" style={{ color: "var(--ck-text-muted)" }}>
                                    {activeSlot ? `${activeSlot.time} — ${activeSlot.tourName}` : "No slots today"}
                                </p>
                            </div>
                        </div>
                        {slotGroups.length > 1 && (
                            <div className="flex items-center gap-1.5">
                                <button
                                    onClick={() => { setActiveSlotIdx(Math.max(0, activeSlotIdx - 1)); setManualSlotNav(true); }}
                                    disabled={activeSlotIdx === 0}
                                    className="p-1.5 rounded-lg border transition-colors disabled:opacity-30"
                                    style={{ borderColor: "var(--ck-border-strong)", color: "var(--ck-text)" }}
                                >
                                    <CaretLeft size={16} />
                                </button>
                                <span className="text-[12px] font-semibold px-2" style={{ color: "var(--ck-text-muted)" }}>
                                    {activeSlotIdx + 1} / {slotGroups.length}
                                </span>
                                <button
                                    onClick={() => { setActiveSlotIdx(Math.min(slotGroups.length - 1, activeSlotIdx + 1)); setManualSlotNav(true); }}
                                    disabled={activeSlotIdx >= slotGroups.length - 1}
                                    className="p-1.5 rounded-lg border transition-colors disabled:opacity-30"
                                    style={{ borderColor: "var(--ck-border-strong)", color: "var(--ck-text)" }}
                                >
                                    <CaretRight size={16} />
                                </button>
                                {manualSlotNav && (
                                    <button
                                        onClick={() => setManualSlotNav(false)}
                                        className="ml-1 px-3 py-1.5 rounded-full text-[11px] font-bold text-white transition-all hover:opacity-90 shadow-sm bg-donezo-gradient"
                                        title="Resume auto-advance"
                                    >
                                        Auto
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex-1 overflow-x-auto">
                        {!activeSlot ? (
                            <div className="p-8 flex flex-col items-center justify-center text-center">
                                <p className="text-[13px] font-medium" style={{ color: "var(--ck-text-muted)" }}>No bookings today.</p>
                            </div>
                        ) : (
                            <>
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr>
                                            <th className="w-10 px-3 py-3.5 text-center text-[11px] font-semibold uppercase tracking-wider border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}></th>
                                            <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Customer</th>
                                            <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider border-b hidden sm:table-cell" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Phone</th>
                                            <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Pax</th>
                                            <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-wider border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y" style={{ "--tw-divide-color": "var(--ck-border-subtle)" } as React.CSSProperties}>
                                        {activeSlot.bookings.map((b) => (
                                            <tr
                                                key={b.id}
                                                className="transition-colors"
                                                style={{ background: b.checked_in ? "var(--ck-success-soft)" : "" }}
                                                onMouseEnter={(e) => { if (!b.checked_in) e.currentTarget.style.background = "var(--ck-surface-elevated)"; }}
                                                onMouseLeave={(e) => { if (!b.checked_in) e.currentTarget.style.background = ""; }}
                                            >
                                                <td className="px-3 py-3.5 text-center">
                                                    <input
                                                        type="checkbox"
                                                        checked={b.checked_in}
                                                        onChange={() => toggleCheckIn(b.id, b.checked_in)}
                                                        className="h-5 w-5 rounded border-2 cursor-pointer accent-emerald-600"
                                                        style={{ borderColor: "var(--ck-border-strong)" }}
                                                    />
                                                </td>
                                                <td className="px-4 py-3.5">
                                                    <div className={`font-semibold text-[14px] ${b.checked_in ? "line-through" : ""}`} style={{ color: "var(--ck-text-strong)" }}>{b.customer_name}</div>
                                                </td>
                                                <td className="px-4 py-3.5 hidden sm:table-cell">
                                                    <div className="text-[13px] font-medium" style={{ color: "var(--ck-text-muted)" }}>{b.phone || "—"}</div>
                                                </td>
                                                <td className="px-4 py-3.5 text-right">
                                                    <div className="font-bold text-[14px]" style={{ color: "var(--ck-text-strong)" }}>{b.qty}</div>
                                                </td>
                                                <td className="px-4 py-3.5 text-right">
                                                    <span className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-bold ${
                                                        b.checked_in ? "bg-emerald-50 text-emerald-700"
                                                        : b.status === "PAID" || b.status === "CONFIRMED" ? "bg-blue-50 text-blue-700"
                                                        : "bg-amber-50 text-amber-700"
                                                    }`}>
                                                        {b.checked_in ? "Present" : b.status}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <div className="px-5 py-3 border-t flex items-center justify-between" style={{ borderColor: "var(--ck-border-subtle)" }}>
                                    <span className="text-[13px] font-medium" style={{ color: "var(--ck-text-muted)" }}>
                                        {activeSlot.checkedIn} of {activeSlot.totalPax} pax checked in
                                    </span>
                                    {activeSlot.checkedIn === activeSlot.totalPax && activeSlot.totalPax > 0 && (
                                        <span className="flex items-center gap-1.5 text-[12px] font-bold" style={{ color: "var(--ck-success)" }}>
                                            <CheckCircle size={14} /> All present
                                        </span>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6">
                {/* ── Weather Block ── */}
                <div className="bg-white rounded-[24px] shadow-sm border border-gray-100 flex flex-col overflow-hidden">
                    <div className="flex items-center justify-between p-6 border-b" style={{ borderColor: 'var(--ck-border-subtle)' }}>
                        <div className="flex items-center gap-3">
                            <h3 className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--ck-text-strong)" }}>Weather</h3>
                        </div>
                        <button onClick={() => setEditingLocs(!editingLocs)} className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-bold rounded-full transition-all text-white shadow-sm hover:opacity-90 bg-donezo-gradient">
                            Manage Locations <GearSix size={14} weight="bold" />
                        </button>
                    </div>

                    <div className="p-5 flex-1 flex flex-col min-h-0 relative">
                        <div className="mb-4">
                            <select
                                value={location?.id || ""}
                                onChange={(e) => {
                                    const loc = locations.find(l => l.id === e.target.value);
                                    if (loc) setLocation(loc);
                                }}
                                className="w-full px-4 py-2 text-[14px] font-medium border rounded-xl focus:outline-none transition-all appearance-none"
                                style={{ color: "var(--ck-text-strong)", background: "var(--ck-surface)", borderColor: "var(--ck-border-strong)", backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%239CA3AF%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 1rem top 50%", backgroundSize: "0.65rem auto" }}
                                disabled={locations.length === 0}
                            >
                                {locations.length === 0 && <option value="">No locations available</option>}
                                {locations.map(l => (
                                    <option key={l.id} value={l.id}>{l.name} {l.isDefault ? "(Default)" : ""}</option>
                                ))}
                            </select>
                        </div>

                        {/* Windguru */}
                        <div className="rounded-xl overflow-hidden border mb-4" style={{ borderColor: "var(--ck-border-subtle)" }}>
                            <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--ck-border-subtle)" }}>
                                <span className="text-[13px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Windguru{location ? ` — ${location.name}` : ""}</span>
                                <div className="flex items-center gap-3">
                                    <button onClick={() => setWgRefreshKey(k => k + 1)} className="p-1 rounded-md transition-colors hover:opacity-70" title="Refresh Windguru" style={{ color: "var(--ck-text-muted)" }}><ArrowsClockwise size={14} /></button>
                                    {location && <a href={`https://www.windguru.cz/${location.wgSpot}`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold hover:underline" style={{ color: "var(--ck-accent)" }}>Open ↗</a>}
                                </div>
                            </div>
                            <div className="relative min-h-[350px]" style={{ background: "var(--ck-surface)" }}>
                                {location ? (
                                    location.wgSpot ? (
                                        <WindguruWidget spotId={location.wgSpot} refreshKey={wgRefreshKey} />
                                    ) : (
                                        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                                            <p className="text-[13px] font-medium" style={{ color: "var(--ck-text-muted)" }}>This location does not have a Windguru spot ID assigned.</p>
                                        </div>
                                    )
                                ) : (
                                    <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                                        <p className="text-[13px] font-medium" style={{ color: "var(--ck-text-muted)" }}>No location selected</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Windy */}
                        <div className="rounded-xl overflow-hidden border mb-4" style={{ borderColor: "var(--ck-border-subtle)" }}>
                            <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--ck-border-subtle)" }}>
                                <span className="text-[13px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Windy{location ? ` — ${location.name}` : ""}</span>
                                <div className="flex items-center gap-3">
                                    <button onClick={() => setWindyRefreshKey(k => k + 1)} className="p-1 rounded-md transition-colors hover:opacity-70" title="Refresh Windy" style={{ color: "var(--ck-text-muted)" }}><ArrowsClockwise size={14} /></button>
                                    {location && <a href={`https://www.windy.com/${location.lat}/${location.lon}`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold hover:underline" style={{ color: "var(--ck-accent)" }}>Open ↗</a>}
                                </div>
                            </div>
                            {location ? (
                                <iframe
                                    key={`windy-${location.lat}-${location.lon}-${windyRefreshKey}`}
                                    src={`https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=°C&metricWind=km/h&zoom=11&overlay=wind&product=ecmwf&level=surface&lat=${location.lat}&lon=${location.lon}&detailLat=${location.lat}&detailLon=${location.lon}&marker=true&message=true`}
                                    width="100%"
                                    height="350"
                                    frameBorder="0"
                                    className="w-full block"
                                />
                            ) : (
                                <div className="flex items-center justify-center p-6 text-center h-[350px]">
                                    <p className="text-[13px] font-medium" style={{ color: "var(--ck-text-muted)" }}>No location selected</p>
                                </div>
                            )}
                        </div>

                        {editingLocs && (
                            <div className="absolute inset-0 z-20 backdrop-blur-sm p-5 flex flex-col rounded-b-xl" style={{ background: "color-mix(in srgb, var(--ck-surface) 95%, transparent)" }}>
                                <div className="flex justify-between items-center mb-4">
                                    <h4 className="text-[14px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Manage Locations</h4>
                                    <button onClick={() => setEditingLocs(false)} className="p-1.5 rounded-md transition-colors" style={{ color: "var(--ck-text-muted)" }}><X size={18} /></button>
                                </div>
                                <div className="flex-1 overflow-y-auto pr-1 mb-4">
                                    <div className="space-y-2">
                                        {locations.map(l => (
                                            <div key={l.id} className="flex items-center justify-between rounded-lg border p-3 shadow-sm text-sm" style={{ borderColor: "var(--ck-border-subtle)", background: "var(--ck-surface)" }}>
                                                <div>
                                                    <span className="font-semibold text-[13px]" style={{ color: "var(--ck-text-strong)" }}>{l.name}</span>
                                                    <div className="text-[11px] font-medium mt-0.5" style={{ color: "var(--ck-text-muted)" }}>{l.lat}, {l.lon} <span className="ml-2" style={{ color: "var(--ck-text-muted)" }}>WG: {l.wgSpot || "None"}</span></div>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    {l.isDefault && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded tracking-wider uppercase" style={{ color: "var(--ck-success)", background: "var(--ck-success-soft)" }}>Default</span>}
                                                    <button onClick={() => removeLocation(l.id)} className="transition-colors" style={{ color: "var(--ck-text-muted)" }}><Trash size={16} /></button>
                                                </div>
                                            </div>
                                        ))}
                                        {locations.length === 0 && <p className="text-[13px]" style={{ color: "var(--ck-text-muted)" }}>No locations added.</p>}
                                    </div>
                                </div>

                                <form onSubmit={handleAddLocation} className="border-t pt-4" style={{ borderColor: "var(--ck-border-subtle)" }}>
                                    <input required value={newLocName} onChange={e => setNewLocName(e.target.value)} onBlur={() => { if (newLocName.trim() && !newLocLat && !newLocLon) handleGeocode(); }} className="w-full border rounded-lg px-3 py-2 text-[13px] font-medium mb-2 focus:outline-none transition-colors" style={{ borderColor: "var(--ck-border-strong)", background: "var(--ck-surface)", color: "var(--ck-text-strong)" }} placeholder="Name (e.g. Cape Town)" />
                                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-2">
                                        <input required type="number" step="any" value={newLocLat} onChange={e => setNewLocLat(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-[13px] font-medium focus:outline-none transition-colors" style={{ borderColor: "var(--ck-border-strong)", background: "var(--ck-surface)", color: "var(--ck-text-strong)" }} placeholder="Lat (-33.9)" />
                                        <input required type="number" step="any" value={newLocLon} onChange={e => setNewLocLon(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-[13px] font-medium focus:outline-none transition-colors" style={{ borderColor: "var(--ck-border-strong)", background: "var(--ck-surface)", color: "var(--ck-text-strong)" }} placeholder="Lon (18.4)" />
                                        <input type="number" step="any" value={newLocWg} onChange={e => setNewLocWg(e.target.value)} className="w-full lg:col-span-2 border rounded-lg px-3 py-2 text-[13px] font-medium focus:outline-none transition-colors" style={{ borderColor: "var(--ck-border-strong)", background: "var(--ck-surface)", color: "var(--ck-text-strong)" }} placeholder="Windguru Spot ID (optional)" />
                                    </div>
                                    <div className="flex gap-2">
                                        <button type="button" onClick={handleGeocode} disabled={geocoding || !newLocName} className="px-4 rounded-lg py-2 text-[13px] font-medium transition-colors disabled:opacity-50 flex items-center justify-center" style={{ background: "var(--ck-surface-elevated)", color: "var(--ck-text)" }}>
                                            <MapPin size={16} />
                                        </button>
                                        <button type="submit" className="flex-1 rounded-lg text-white py-2 text-[13px] font-medium transition-colors shadow-sm" style={{ background: "var(--ck-accent)" }}>
                                            Add Location
                                        </button>
                                    </div>
                                </form>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div >
    );
}
