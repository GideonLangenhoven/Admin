"use client";
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { supabase } from "./lib/supabase";
import { confirmAction, notify } from "./lib/app-notify";
import { getAdminTimezone } from "./lib/admin-timezone";
import { customerNotesTooltip } from "./lib/customer-notes";
import { useBusinessContext } from "../components/BusinessContext";
import { isPrivilegedRole } from "./lib/role-utils";
import { isSectionHidden } from "./lib/operator-sections";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
    Plus, CaretLeft, CaretRight, ArrowUpRight, Check,
    CheckCircle, GearSix, X, Trash, MapPin, ArrowsClockwise,
    CurrencyCircleDollar, ChatText, Camera, CalendarBlank,
} from "@phosphor-icons/react";

/* ── helpers ── */
function fmtTime(iso: string) {
    return new Date(iso).toLocaleString("en-ZA", {
        hour: "2-digit", minute: "2-digit", hour12: false,
        timeZone: getAdminTimezone(),
    });
}

function localDayKey(d: Date) {
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

type WeatherLocation = { id: string; name: string; lat: number; lon: number; wgSpot?: number; isDefault?: boolean; };

/* ── preset locations ── */
const DEFAULT_LOCATIONS: WeatherLocation[] = [
    { id: "1", name: "Three Anchor Bay, Sea Point", lat: -33.908, lon: 18.396, wgSpot: 137629, isDefault: true },
    { id: "2", name: "Simon's Town", lat: -34.19, lon: 18.45, wgSpot: 115767 },
    { id: "3", name: "Hout Bay", lat: -34.05, lon: 18.35, wgSpot: 51651 },
    { id: "4", name: "Table Bay", lat: -33.90, lon: 18.43, wgSpot: 32831 },
    { id: "5", name: "False Bay (Muizenberg)", lat: -34.10, lon: 18.47, wgSpot: 131594 },
    { id: "6", name: "Kalk Bay", lat: -34.13, lon: 18.45, wgSpot: 551041 },
    { id: "7", name: "Cape Point", lat: -34.35, lon: 18.50, wgSpot: 128493 },
    { id: "8", name: "Camps Bay", lat: -33.95, lon: 18.38, wgSpot: 635326 },
    { id: "9", name: "Gordon's Bay", lat: -34.16, lon: 18.87, wgSpot: 331265 },
];

/* ── Windguru Widget (lazy-loaded to reduce initial bundle) ── */
const WindguruWidget = dynamic(() => import("../components/WindguruWidget"), {
    ssr: false,
    loading: () => <div className="w-full min-h-[350px] flex items-center justify-center text-sm" style={{ color: "var(--ck-text-muted)" }}>Loading weather...</div>,
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
    custom_fields: Record<string, string> | null;
    tours: { name?: string } | null;
    slots: { start_time?: string } | null;
    add_ons: Array<{ name: string; qty: number }>;
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

/* ── decorative: topographic contour lines for the hero card ── */
function TopoLines({ className = "" }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 400 200" fill="none" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <g stroke="#F4F1E8" strokeOpacity="0.07" strokeWidth="1">
                <path d="M-20 150 C60 120, 90 170, 170 140 S 320 90, 420 130" />
                <path d="M-20 165 C70 135, 100 185, 180 155 S 330 105, 420 145" />
                <path d="M-20 180 C80 150, 110 200, 190 170 S 340 120, 420 160" />
                <path d="M-20 40 C40 70, 130 10, 200 45 S 340 80, 420 30" />
                <path d="M-20 25 C50 55, 140 -5, 210 30 S 350 65, 420 15" />
                <circle cx="330" cy="52" r="26" strokeOpacity="0.09" />
                <circle cx="330" cy="52" r="14" strokeOpacity="0.11" />
            </g>
        </svg>
    );
}

/* ── decorative: the brand trail (amber start → destination ring) ── */
function TrailMotif({ className = "" }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 64 64" fill="none" aria-hidden="true">
            <path d="M12 50 C30 52, 18 22, 44 18" stroke="#F4F1E8" strokeOpacity="0.35" strokeWidth="2.6" strokeLinecap="round" strokeDasharray="0.1 6.5" />
            <circle cx="12" cy="50" r="3.2" fill="#D9822F" />
            <circle cx="48" cy="16" r="4" stroke="#F4F1E8" strokeOpacity="0.55" strokeWidth="2.2" />
        </svg>
    );
}

/* ── hand-rolled revenue sparkline — no chart dependency ── */
function Sparkline({ data }: { data: number[] }) {
    const series = data.length === 1 ? [0, ...data] : data;
    if (series.length < 2) return null;
    const w = 100, h = 34;
    const max = Math.max(...series, 1);
    const pts = series.map((v, i) => [
        (i / (series.length - 1)) * w,
        h - 3 - (v / max) * (h - 8),
    ] as const);
    const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ");
    const area = `${line} L${w} ${h} L0 ${h} Z`;
    const last = pts[pts.length - 1];
    return (
        <div className="relative w-full">
            <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-14 w-full">
                <defs>
                    <linearGradient id="rev-spark" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" style={{ stopColor: "var(--ck-accent)", stopOpacity: 0.20 }} />
                        <stop offset="100%" style={{ stopColor: "var(--ck-accent)", stopOpacity: 0 }} />
                    </linearGradient>
                </defs>
                <path d={area} fill="url(#rev-spark)" />
                <path d={line} fill="none" style={{ stroke: "var(--ck-accent)" }} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            <span
                className="absolute h-2 w-2 rounded-full translate-x-1/2 -translate-y-1/2"
                style={{ right: 0, top: `${(last[1] / h) * 100}%`, background: "var(--ck-amber-bright)", boxShadow: "0 0 0 3px var(--ck-amber-soft)" }}
                aria-hidden="true"
            />
        </div>
    );
}

/* ── main component ── */
export default function Dashboard() {
    const { businessId, role } = useBusinessContext();
    // Main Admin can hide the revenue panel from operator-level admins.
    const [hideRevenue, setHideRevenue] = useState(false);
    useEffect(() => {
        if (isPrivilegedRole(role)) { setHideRevenue(false); return; }
        try {
            const perms = JSON.parse(localStorage.getItem("ck_admin_settings_perms") || "{}");
            setHideRevenue(isSectionHidden(perms, "dashboard_reports"));
        } catch { setHideRevenue(false); }
    }, [role]);
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
    const [revToday, setRevToday] = useState(0);
    const [revWeek, setRevWeek] = useState(0);
    const [revMonth, setRevMonth] = useState(0);
    const [revSeries, setRevSeries] = useState<number[]>([]);
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
            // Only count real bookings towards pax / Roll Call. EXPIRED holds
            // (slot reservations that never got paid for) and CANCELLED bookings
            // were inflating "Today's Pax" by ~50% on busy days.
            const { data: bks } = await supabase.from("bookings")
                .select("id, customer_name, phone, qty, total_amount, status, checked_in, custom_fields, slots(start_time), tours(name)")
                .eq("business_id", businessId)
                .in("status", ["PAID", "CONFIRMED", "COMPLETED", "PENDING"])
                .in("slot_id", slotIds)
                .order("created_at", { ascending: true });
            const bookingIds = (bks || []).map((b: any) => b.id);
            const addOnsByBooking: Record<string, Array<{ name: string; qty: number }>> = {};
            if (bookingIds.length > 0) {
                const { data: addOnRows } = await supabase.from("booking_add_ons")
                    .select("booking_id, qty, add_ons(name)")
                    .in("booking_id", bookingIds);
                for (const row of (addOnRows || []) as any[]) {
                    const ao = Array.isArray(row.add_ons) ? row.add_ons[0] : row.add_ons;
                    if (!ao?.name) continue;
                    (addOnsByBooking[row.booking_id] ||= []).push({ name: ao.name, qty: row.qty || 1 });
                }
            }
            return (bks || []).map((b: any) => ({
                ...b,
                tours: Array.isArray(b.tours) ? b.tours[0] : b.tours,
                slots: Array.isArray(b.slots) ? b.slots[0] : b.slots,
                add_ons: addOnsByBooking[b.id] || [],
            })).filter((b: any) => b.slots?.start_time);
        }

        // Revenue window: pull all paid/confirmed bookings created since the
        // earlier of month start / 7 days ago, then bucket today / past 7d /
        // this month by payment (booking) date — money received, not trip date.
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        async function fetchMonthRevenueRows() {
            const since = new Date(Math.min(monthStart.getTime(), Date.now() - 7 * 24 * 60 * 60 * 1000));
            const { data: bks } = await supabase.from("bookings")
                .select("total_amount, created_at")
                .eq("business_id", businessId)
                .in("status", ["PAID", "CONFIRMED", "COMPLETED"])
                .gte("created_at", since.toISOString());
            return (bks || []).map((b: any) => ({
                total_amount: Number(b.total_amount || 0),
                created_at: b.created_at as string,
            }));
        }

        // Run ALL independent queries in parallel
        const [todayManifest, tomorrowData, refundsData, inboxData, photosData, revRows] = await Promise.all([
            fetchManifest(today, tomorrow),
            fetchManifest(tomorrow, dayAfter),
            // ACTION_REQUIRED excluded — those await the customer's remediation choice, not operator action
            supabase.from("bookings").select("id, refund_amount").eq("business_id", businessId).eq("refund_status", "REQUESTED"),
            supabase.from("conversations").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("status", "HUMAN"),
            Promise.all([
                supabase.from("slots").select("id, start_time, booked").eq("business_id", businessId).lt("start_time", nowISO).gt("start_time", weekAgo).gt("booked", 0),
                supabase.from("trip_photos").select("slot_id").eq("business_id", businessId).gt("uploaded_at", weekAgo),
            ]),
            fetchMonthRevenueRows(),
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

        // Revenue buckets — by payment (booking) date.
        const todayMs = today.getTime();
        const weekAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const monthStartMs = monthStart.getTime();
        let revT = 0, revW = 0, revM = 0;
        const daily = new Map<string, number>();
        for (const row of revRows) {
            const t = new Date(row.created_at).getTime();
            if (!Number.isFinite(t)) continue;
            if (t >= todayMs) revT += row.total_amount;
            if (t >= weekAgoMs) revW += row.total_amount;
            if (t >= monthStartMs) {
                revM += row.total_amount;
                const key = localDayKey(new Date(row.created_at));
                daily.set(key, (daily.get(key) || 0) + row.total_amount);
            }
        }
        setRevToday(revT);
        setRevWeek(revW);
        setRevMonth(revM);

        // Sparkline series: month start → today, one bucket per local day
        const series: number[] = [];
        const cursor = new Date(monthStart);
        while (cursor <= today && series.length < 62) {
            series.push(daily.get(localDayKey(cursor)) || 0);
            cursor.setDate(cursor.getDate() + 1);
        }
        setRevSeries(series);

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

    /* ── skeleton — mirrors the real layout, no spinners ── */
    if (loading) return (
        <div className="space-y-6 max-w-[1400px] mx-auto pb-10">
            <div className="flex items-end justify-between gap-4 pt-2 mb-8">
                <div className="space-y-2.5">
                    <div className="ui-skeleton h-3 w-44" />
                    <div className="ui-skeleton h-8 w-48" />
                </div>
                <div className="ui-skeleton h-9 w-36 !rounded-[10px]" />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <div className="ui-skeleton h-[190px] lg:col-span-2 !rounded-2xl" />
                <div className="ui-skeleton h-[190px] lg:col-span-3 !rounded-2xl" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div className="ui-skeleton h-[132px] !rounded-2xl" />
                <div className="ui-skeleton h-[132px] !rounded-2xl" />
                <div className="ui-skeleton h-[132px] !rounded-2xl" />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="ui-skeleton h-[320px] !rounded-2xl" />
                <div className="ui-skeleton h-[320px] !rounded-2xl" />
            </div>
        </div>
    );

    return (
        <div className="space-y-6 max-w-[1400px] mx-auto pb-10">
            {/* Dashboard Header */}
            <div className="anim-fade-up flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8 pt-2">
                <div>
                    <p className="ui-mono-label mb-2">
                        {new Date(now).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", timeZone: getAdminTimezone() })}
                    </p>
                    <h2 className="font-display text-[28px] md:text-[32px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}>Dashboard</h2>
                </div>
                <div className="flex items-center gap-3">
                    <Link href="/new-booking" className="ui-btn ui-btn-primary">
                        <Plus size={15} weight="bold" /> Add Booking
                    </Link>
                </div>
            </div>

            {/* ── Hero band: north-star pax + revenue with sparkline ── */}
            <div className="anim-fade-up anim-d1 grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* Today's Pax — the north-star number on the night surface */}
                <Link href="/bookings" className="bg-bt-dark ui-card-hover group relative block overflow-hidden rounded-2xl p-6 lg:col-span-2 text-white" style={{ border: "1px solid rgba(244, 241, 232, 0.09)", boxShadow: "var(--ck-shadow-hero)" }}>
                    <TopoLines className="absolute inset-0 h-full w-full" />
                    <TrailMotif className="absolute right-5 top-5 h-14 w-14" />
                    <div className="relative">
                        <span className="ui-mono-label !text-white/60">Today&apos;s Pax</span>
                        <div className="font-display mt-6 mb-4 text-[56px] font-semibold leading-none tabular-nums text-white">
                            {todayPax}
                        </div>
                        <div className="flex items-center gap-2 text-[12.5px] text-white/55">
                            <span className="h-[5px] w-[5px] rounded-full bg-[#D9822F]" aria-hidden="true" />
                            <span className="font-mono text-[12px] font-medium text-white/90">{todayBookings}</span>
                            trips · {tomorrowPax} pax tomorrow
                            <ArrowUpRight size={14} className="ml-auto text-white/35 transition-all group-hover:text-white/80 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                        </div>
                    </div>
                </Link>

                {/* Revenue at a glance — today, last 7 days, this month + month sparkline */}
                {!hideRevenue && (
                <Link href="/reports" className="ui-card ui-card-hover group block p-6 lg:col-span-3">
                    <div className="flex items-center justify-between mb-5">
                        <h3 className="ui-mono-label">Revenue</h3>
                        <span className="ui-mono-label !tracking-[0.06em] flex items-center gap-1.5 transition-colors group-hover:!text-[var(--ck-text-strong)]">
                            View reports <ArrowUpRight size={12} />
                        </span>
                    </div>
                    <div className="grid grid-cols-3 divide-x" style={{ borderColor: "var(--ck-border-subtle)" }}>
                        <div className="pr-4">
                            <p className="ui-mono-label !text-[10px]">Today</p>
                            <p className="font-display mt-1.5 text-[28px] font-semibold leading-tight tabular-nums" style={{ color: "var(--ck-text-strong)" }}>R{revToday.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}</p>
                        </div>
                        <div className="px-4">
                            <p className="ui-mono-label !text-[10px]">Last 7 days</p>
                            <p className="font-display mt-1.5 text-[28px] font-semibold leading-tight tabular-nums" style={{ color: "var(--ck-text-strong)" }}>R{revWeek.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}</p>
                        </div>
                        <div className="pl-4">
                            <p className="ui-mono-label !text-[10px]">This month</p>
                            <p className="font-display mt-1.5 text-[28px] font-semibold leading-tight tabular-nums" style={{ color: "var(--ck-text-strong)" }}>R{revMonth.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}</p>
                        </div>
                    </div>
                    {revSeries.length > 0 && (
                        <div className="mt-5 pt-4 border-t" style={{ borderColor: "var(--ck-border-subtle)" }}>
                            <Sparkline data={revSeries} />
                            <p className="ui-mono-label mt-1.5 !text-[9.5px]">This month, daily</p>
                        </div>
                    )}
                </Link>
                )}
            </div>

            {/* ── KPI row ── */}
            <div className="anim-fade-up anim-d2 grid grid-cols-1 gap-6 sm:grid-cols-3">
                {/* Refunds */}
                <Link href="/refunds" className="ui-card ui-card-hover group block p-5">
                    <div className="flex items-start justify-between mb-5">
                        <div className="flex items-center gap-3">
                            <span className="ui-icon-chip" style={{ background: "var(--ck-amber-soft)", color: "var(--ck-amber)" }}>
                                <CurrencyCircleDollar size={19} weight="fill" />
                            </span>
                            <span className="ui-mono-label">Pending Refunds</span>
                        </div>
                        <ArrowUpRight size={15} className="transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5" style={{ color: "var(--ck-text-muted)" }} />
                    </div>
                    <div className="font-display mb-3 text-[34px] font-semibold leading-none tabular-nums" style={{ color: "var(--ck-text-strong)" }}>
                        {refundCount > 0 ? `R${refundTotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : "0"}
                    </div>
                    <div className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>
                        <span className="h-[5px] w-[5px] rounded-full" style={{ background: refundCount > 0 ? "var(--ck-warning)" : "var(--ck-success)" }} aria-hidden="true" />
                        <span className="font-mono text-[12px] font-medium" style={{ color: "var(--ck-text-strong)" }}>{refundCount}</span>
                        awaiting approval
                    </div>
                </Link>

                {/* Inbox */}
                <Link href="/inbox" className="ui-card ui-card-hover group block p-5">
                    <div className="flex items-start justify-between mb-5">
                        <div className="flex items-center gap-3">
                            <span className="ui-icon-chip" style={{ background: "var(--ck-ocean-soft)", color: "var(--ck-ocean)" }}>
                                <ChatText size={19} weight="fill" />
                            </span>
                            <span className="ui-mono-label">Inbox Action</span>
                        </div>
                        <ArrowUpRight size={15} className="transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5" style={{ color: "var(--ck-text-muted)" }} />
                    </div>
                    <div className="font-display mb-3 flex items-baseline gap-1.5 text-[34px] font-semibold leading-none tabular-nums" style={{ color: "var(--ck-text-strong)" }}>
                        {inboxCount} <span className="text-[15px] font-medium tracking-normal" style={{ color: "var(--ck-text-muted)" }}>msgs</span>
                    </div>
                    <div className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>
                        <span className="h-[5px] w-[5px] rounded-full" style={{ background: inboxCount > 0 ? "var(--ck-warning)" : "var(--ck-success)" }} aria-hidden="true" />
                        <span className="font-mono text-[12px] font-medium" style={{ color: "var(--ck-text-strong)" }}>{inboxCount > 0 ? "waiting" : "clear"}</span>
                        conversations
                    </div>
                </Link>

                {/* Photos */}
                <Link href="/photos" className="ui-card ui-card-hover group block p-5">
                    <div className="flex items-start justify-between mb-5">
                        <div className="flex items-center gap-3">
                            <span className="ui-icon-chip" style={{ background: "rgba(62, 124, 166, 0.12)", color: "var(--ck-fjord)" }}>
                                <Camera size={19} weight="fill" />
                            </span>
                            <span className="ui-mono-label">Photos Out</span>
                        </div>
                        <ArrowUpRight size={15} className="transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5" style={{ color: "var(--ck-text-muted)" }} />
                    </div>
                    <div className="font-display mb-3 flex items-baseline gap-1.5 text-[34px] font-semibold leading-none tabular-nums" style={{ color: "var(--ck-text-strong)" }}>
                        {photosOutstanding} <span className="text-[15px] font-medium tracking-normal" style={{ color: "var(--ck-text-muted)" }}>trips</span>
                    </div>
                    <div className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>
                        <span className="h-[5px] w-[5px] rounded-full" style={{ background: photosOutstanding > 0 ? "var(--ck-warning)" : "var(--ck-success)" }} aria-hidden="true" />
                        <span className="font-mono text-[12px] font-medium" style={{ color: "var(--ck-text-strong)" }}>{photosOutstanding > 0 ? "missing" : "clear"}</span>
                        photo uploads
                    </div>
                </Link>
            </div>

            <div className="anim-fade-up anim-d3 grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* ── Today's Manifest (pax per slot) ── */}
                <div className="ui-card flex flex-col overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--ck-border-subtle)' }}>
                        <div>
                            <div className="flex items-center gap-3">
                                <h3 className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--ck-text-strong)" }}>
                                    Manifest
                                </h3>
                                <div className="ui-seg">
                                    <button
                                        type="button"
                                        className="ui-seg-item"
                                        data-active={manifestDate === "TODAY"}
                                        onClick={() => { setManifestDate("TODAY"); setActiveSlotIdx(0); }}
                                    >
                                        Today
                                    </button>
                                    <button
                                        type="button"
                                        className="ui-seg-item"
                                        data-active={manifestDate === "TOMORROW"}
                                        onClick={() => { setManifestDate("TOMORROW"); setActiveSlotIdx(0); }}
                                    >
                                        Tomorrow
                                    </button>
                                </div>
                            </div>
                            <p className="ui-mono-label !text-[10px] mt-1">Pax per slot</p>
                        </div>
                        <Link href="/new-booking" className="ui-btn ui-btn-primary !h-8 !px-3 !text-[12.5px] hidden sm:inline-flex">
                            <Plus size={13} weight="bold" /> Add Booking
                        </Link>
                    </div>

                    <div className="flex-1 overflow-x-auto">
                        {slotGroups.length === 0 ? (
                            <div className="ui-empty">
                                <span className="ui-icon-chip"><CalendarBlank size={19} /></span>
                                <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>
                                    {manifestDate === "TODAY" ? "No bookings today" : "No bookings tomorrow"}
                                </p>
                                <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>New bookings will appear here as they come in.</p>
                            </div>
                        ) : (
                            <table className="w-full text-sm">
                                <thead>
                                    <tr>
                                        <th className="px-5 py-3.5 text-left text-[10.5px] font-medium uppercase tracking-[0.1em] border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Time</th>
                                        <th className="px-5 py-3.5 text-left text-[10.5px] font-medium uppercase tracking-[0.1em] border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Tour</th>
                                        <th className="px-5 py-3.5 text-right text-[10.5px] font-medium uppercase tracking-[0.1em] border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Bookings</th>
                                        <th className="px-5 py-3.5 text-right text-[10.5px] font-medium uppercase tracking-[0.1em] border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Pax</th>
                                        <th className="px-5 py-3.5 text-right text-[10.5px] font-medium uppercase tracking-[0.1em] border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Checked In</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y" style={{ "--tw-divide-color": "var(--ck-border-subtle)" } as React.CSSProperties}>
                                    {slotGroups.map((slot, i) => {
                                        const isPast = manifestDate === "TODAY" && (new Date(slot.timeRaw).getTime() + 4 * 60 * 1000 < now);
                                        const complete = slot.checkedIn === slot.totalPax && slot.totalPax > 0;
                                        const pct = slot.totalPax > 0 ? Math.round((slot.checkedIn / slot.totalPax) * 100) : 0;
                                        return (
                                            <tr
                                                key={slot.timeRaw}
                                                className="transition-colors cursor-pointer hover:bg-[var(--ck-surface-sunken)]"
                                                style={{ opacity: isPast ? 0.5 : 1 }}
                                                onClick={() => { setActiveSlotIdx(i); setManualSlotNav(true); }}
                                            >
                                                <td className="px-5 py-4">
                                                    <div className="font-semibold text-[14px] tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{slot.time}</div>
                                                </td>
                                                <td className="px-5 py-4">
                                                    <div className="text-[13px] font-medium max-w-[120px] truncate" style={{ color: "var(--ck-text-muted)" }} title={slot.tourName}>{slot.tourName}</div>
                                                </td>
                                                <td className="px-5 py-4 text-right">
                                                    <div className="text-[13px] font-medium tabular-nums" style={{ color: "var(--ck-text)" }}>{slot.bookingCount}</div>
                                                </td>
                                                <td className="px-5 py-4 text-right">
                                                    <div className="font-bold text-[16px] tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{slot.totalPax}</div>
                                                </td>
                                                <td className="px-5 py-4">
                                                    <div className="flex items-center justify-end gap-2.5">
                                                        <div className="ui-progress w-14 hidden sm:block"><div className="ui-progress-fill" style={{ width: `${pct}%` }} /></div>
                                                        <span className={`ui-status ${complete ? "ui-pill-success" : "ui-pill-amber"}`}>
                                                            {slot.checkedIn}/{slot.totalPax}
                                                        </span>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot>
                                    <tr className="border-t-2" style={{ borderColor: "var(--ck-border-strong)" }}>
                                        <td colSpan={3} className="px-5 py-3 text-[12px] font-semibold uppercase tracking-wider" style={{ color: "var(--ck-text-muted)" }}>Totals</td>
                                        <td className="px-5 py-3 text-right font-bold text-[16px] tabular-nums" style={{ color: "var(--ck-text-strong)" }}>
                                            {manifestDate === "TODAY" ? todayPax : tomorrowPax}
                                        </td>
                                        <td className="px-5 py-3">
                                            <div className="flex items-center justify-end">
                                                <span className="ui-status ui-pill-neutral">
                                                    {activeManifest.filter(b => b.checked_in).reduce((s, b) => s + b.qty, 0)}/{manifestDate === "TODAY" ? todayPax : tomorrowPax}
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        )}
                    </div>
                </div>

                {/* ── Roll Call ── */}
                <div className="ui-card flex flex-col overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--ck-border-subtle)' }}>
                        <div>
                            <h3 className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--ck-text-strong)" }}>Roll Call</h3>
                            <p className="text-[12px] font-medium mt-0.5" style={{ color: "var(--ck-text-muted)" }}>
                                {activeSlot ? `${activeSlot.time} — ${activeSlot.tourName}` : "No slots today"}
                            </p>
                        </div>
                        {slotGroups.length > 1 && (
                            <div className="flex items-center gap-1.5">
                                <button
                                    onClick={() => { setActiveSlotIdx(Math.max(0, activeSlotIdx - 1)); setManualSlotNav(true); }}
                                    disabled={activeSlotIdx === 0}
                                    className="p-1.5 rounded-lg border transition-colors disabled:opacity-30 hover:bg-[var(--ck-surface-sunken)]"
                                    style={{ borderColor: "var(--ck-border-strong)", color: "var(--ck-text)" }}
                                >
                                    <CaretLeft size={16} />
                                </button>
                                <span className="font-mono text-[11.5px] font-semibold px-1.5 tabular-nums" style={{ color: "var(--ck-text-muted)" }}>
                                    {activeSlotIdx + 1} / {slotGroups.length}
                                </span>
                                <button
                                    onClick={() => { setActiveSlotIdx(Math.min(slotGroups.length - 1, activeSlotIdx + 1)); setManualSlotNav(true); }}
                                    disabled={activeSlotIdx >= slotGroups.length - 1}
                                    className="p-1.5 rounded-lg border transition-colors disabled:opacity-30 hover:bg-[var(--ck-surface-sunken)]"
                                    style={{ borderColor: "var(--ck-border-strong)", color: "var(--ck-text)" }}
                                >
                                    <CaretRight size={16} />
                                </button>
                                {manualSlotNav && (
                                    <button
                                        onClick={() => setManualSlotNav(false)}
                                        className="ui-btn ui-btn-soft ml-1 !h-7 !px-2.5 !text-[11px] font-mono uppercase tracking-[0.08em]"
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
                            <div className="ui-empty">
                                <span className="ui-icon-chip"><CalendarBlank size={19} /></span>
                                <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No bookings today</p>
                                <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Roll call opens when the first booking lands.</p>
                            </div>
                        ) : (
                            <>
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr>
                                            <th className="w-12 px-3 py-3.5 text-center text-[10.5px] font-medium uppercase tracking-[0.1em] border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}></th>
                                            <th className="px-4 py-3.5 text-left text-[10.5px] font-medium uppercase tracking-[0.1em] border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Customer</th>
                                            <th className="px-4 py-3.5 text-left text-[10.5px] font-medium uppercase tracking-[0.1em] border-b hidden sm:table-cell" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Phone</th>
                                            <th className="px-4 py-3.5 text-right text-[10.5px] font-medium uppercase tracking-[0.1em] border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Pax</th>
                                            <th className="px-4 py-3.5 text-right text-[10.5px] font-medium uppercase tracking-[0.1em] border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y" style={{ "--tw-divide-color": "var(--ck-border-subtle)" } as React.CSSProperties}>
                                        {activeSlot.bookings.map((b) => (
                                            <tr
                                                key={b.id}
                                                className="transition-colors hover:bg-[var(--ck-surface-sunken)]"
                                                style={{ background: b.checked_in ? "var(--ck-success-soft)" : "" }}
                                            >
                                                <td className="px-3 py-3.5 text-center">
                                                    <button
                                                        type="button"
                                                        role="checkbox"
                                                        aria-checked={b.checked_in}
                                                        aria-label={b.checked_in ? `Mark ${b.customer_name} as not present` : `Mark ${b.customer_name} as present`}
                                                        onClick={() => toggleCheckIn(b.id, b.checked_in)}
                                                        className="mx-auto flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 transition-all"
                                                        style={b.checked_in
                                                            ? { background: "var(--ck-success)", borderColor: "var(--ck-success)" }
                                                            : { background: "var(--ck-surface)", borderColor: "var(--ck-border-strong)" }}
                                                    >
                                                        {b.checked_in && <Check size={13} weight="bold" color="#ffffff" />}
                                                    </button>
                                                </td>
                                                <td className="px-4 py-3.5">
                                                    <div className={`font-semibold text-[14px] ${b.checked_in ? "line-through opacity-70" : ""}`} style={{ color: "var(--ck-text-strong)" }}>
                                                        <span
                                                            title={customerNotesTooltip(b.custom_fields)}
                                                            className={customerNotesTooltip(b.custom_fields) ? "cursor-help underline decoration-dotted decoration-slate-300 underline-offset-2" : undefined}
                                                        >{b.customer_name}</span>
                                                        {customerNotesTooltip(b.custom_fields) && (
                                                            <span title={customerNotesTooltip(b.custom_fields)} className="ml-1 text-[12px] cursor-help" aria-label="Customer added notes">📝</span>
                                                        )}
                                                    </div>
                                                    {b.add_ons && b.add_ons.length > 0 && (
                                                        <div className="mt-1 flex flex-wrap gap-1">
                                                            {b.add_ons.map((ao, idx) => (
                                                                <span key={idx} className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "var(--ck-amber-soft)", color: "var(--ck-amber)" }}>
                                                                    {ao.qty > 1 ? `${ao.qty}× ` : "+ "}{ao.name}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3.5 hidden sm:table-cell">
                                                    <div className="text-[13px] font-medium tabular-nums" style={{ color: "var(--ck-text-muted)" }}>{b.phone || "—"}</div>
                                                </td>
                                                <td className="px-4 py-3.5 text-right">
                                                    <div className="font-bold text-[14px] tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{b.qty}</div>
                                                </td>
                                                <td className="px-4 py-3.5 text-right">
                                                    <span className={`ui-status ${
                                                        b.checked_in ? "ui-pill-success"
                                                        : b.status === "PAID" || b.status === "CONFIRMED" ? "ui-pill-accent"
                                                        : "ui-pill-amber"
                                                    }`}>
                                                        {b.checked_in ? "Present" : b.status}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <div className="px-5 py-3.5 border-t" style={{ borderColor: "var(--ck-border-subtle)" }}>
                                    <div className="flex items-center justify-between gap-4">
                                        <span className="text-[13px] font-medium shrink-0" style={{ color: "var(--ck-text-muted)" }}>
                                            {activeSlot.checkedIn} of {activeSlot.totalPax} pax checked in
                                        </span>
                                        {activeSlot.checkedIn === activeSlot.totalPax && activeSlot.totalPax > 0 ? (
                                            <span className="flex items-center gap-1.5 text-[12px] font-bold shrink-0" style={{ color: "var(--ck-success)" }}>
                                                <CheckCircle size={15} weight="fill" /> All present
                                            </span>
                                        ) : (
                                            <div className="ui-progress w-28">
                                                <div className="ui-progress-fill" style={{ width: `${activeSlot.totalPax > 0 ? Math.round((activeSlot.checkedIn / activeSlot.totalPax) * 100) : 0}%` }} />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6">
                {/* ── Weather Block ── */}
                <div className="ui-card flex flex-col overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--ck-border-subtle)' }}>
                        <div>
                            <h3 className="text-[15px] font-semibold tracking-tight" style={{ color: "var(--ck-text-strong)" }}>Weather</h3>
                            <p className="ui-mono-label !text-[10px] mt-0.5">Wind &amp; sea conditions</p>
                        </div>
                        <button onClick={() => setEditingLocs(!editingLocs)} className="ui-btn ui-btn-ghost !h-8 !px-3 !text-[12.5px]">
                            Manage Locations <GearSix size={13} weight="bold" />
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
                                className="ui-control w-full appearance-none !px-4 !py-2 text-[14px] font-medium"
                                style={{ backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%2366736B%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 1rem top 50%", backgroundSize: "0.65rem auto" }}
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
                            <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--ck-border-subtle)", background: "var(--ck-surface-warm)" }}>
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
                            <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--ck-border-subtle)", background: "var(--ck-surface-warm)" }}>
                                <span className="text-[13px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Windy{location ? ` — ${location.name}` : ""}</span>
                                <div className="flex items-center gap-3">
                                    <button onClick={() => setWindyRefreshKey(k => k + 1)} className="p-1 rounded-md transition-colors hover:opacity-70" title="Refresh Windy" style={{ color: "var(--ck-text-muted)" }}><ArrowsClockwise size={14} /></button>
                                    {location && <a href={`https://www.windy.com/${location.lat}/${location.lon}`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold hover:underline" style={{ color: "var(--ck-accent)" }}>Open ↗</a>}
                                </div>
                            </div>
                            {location ? (
                                <iframe
                                    key={`windy-${location.lat}-${location.lon}-${windyRefreshKey}`}
                                    src={`https://embed.windy.com/embed2.html?lat=${location.lat}&lon=${location.lon}&detailLat=${location.lat}&detailLon=${location.lon}&width=650&height=350&zoom=11&level=surface&overlay=wind&product=ecmwf&menu=&message=true&marker=true&calendar=&pressure=&type=map&location=coordinates&detail=&metricWind=km%2Fh&metricTemp=%C2%B0C&radarRange=-1`}
                                    width="100%"
                                    height="350"
                                    frameBorder="0"
                                    className="w-full block"
                                    title="Windy.com forecast"
                                />
                            ) : (
                                <div className="flex items-center justify-center p-6 text-center h-[350px]">
                                    <p className="text-[13px] font-medium" style={{ color: "var(--ck-text-muted)" }}>No location selected</p>
                                </div>
                            )}
                        </div>

                        {editingLocs && (
                            <div className="absolute inset-0 z-20 backdrop-blur-sm p-5 flex flex-col rounded-b-2xl" style={{ background: "color-mix(in srgb, var(--ck-surface) 95%, transparent)" }}>
                                <div className="flex justify-between items-center mb-4">
                                    <h4 className="text-[14px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Manage Locations</h4>
                                    <button onClick={() => setEditingLocs(false)} className="p-1.5 rounded-md transition-colors hover:bg-[var(--ck-surface-sunken)]" style={{ color: "var(--ck-text-muted)" }}><X size={18} /></button>
                                </div>
                                <div className="flex-1 overflow-y-auto pr-1 mb-4">
                                    <div className="space-y-2">
                                        {locations.map(l => (
                                            <div key={l.id} className="flex items-center justify-between rounded-lg border p-3 text-sm" style={{ borderColor: "var(--ck-border-subtle)", background: "var(--ck-surface)", boxShadow: "var(--ck-shadow-sm)" }}>
                                                <div>
                                                    <span className="font-semibold text-[13px]" style={{ color: "var(--ck-text-strong)" }}>{l.name}</span>
                                                    <div className="text-[11px] font-medium mt-0.5 font-mono" style={{ color: "var(--ck-text-muted)" }}>{l.lat}, {l.lon} <span className="ml-2">WG: {l.wgSpot || "None"}</span></div>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    {l.isDefault && <span className="ui-status ui-pill-success">Default</span>}
                                                    <button onClick={() => removeLocation(l.id)} className="transition-colors hover:!text-[var(--ck-danger)]" style={{ color: "var(--ck-text-muted)" }}><Trash size={16} /></button>
                                                </div>
                                            </div>
                                        ))}
                                        {locations.length === 0 && <p className="text-[13px]" style={{ color: "var(--ck-text-muted)" }}>No locations added.</p>}
                                    </div>
                                </div>

                                <form onSubmit={handleAddLocation} className="border-t pt-4" style={{ borderColor: "var(--ck-border-subtle)" }}>
                                    <input required value={newLocName} onChange={e => setNewLocName(e.target.value)} onBlur={() => { if (newLocName.trim() && !newLocLat && !newLocLon) handleGeocode(); }} className="ui-control w-full text-[13px] font-medium mb-2" placeholder="Name (e.g. Cape Town)" />
                                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-2">
                                        <input required type="number" step="any" value={newLocLat} onChange={e => setNewLocLat(e.target.value)} className="ui-control w-full text-[13px] font-medium" placeholder="Lat (-33.9)" />
                                        <input required type="number" step="any" value={newLocLon} onChange={e => setNewLocLon(e.target.value)} className="ui-control w-full text-[13px] font-medium" placeholder="Lon (18.4)" />
                                        <input type="number" step="any" value={newLocWg} onChange={e => setNewLocWg(e.target.value)} className="ui-control w-full lg:col-span-2 text-[13px] font-medium" placeholder="Windguru Spot ID (optional)" />
                                    </div>
                                    <div className="flex gap-2">
                                        <button type="button" onClick={handleGeocode} disabled={geocoding || !newLocName} className="ui-btn ui-btn-ghost !px-4" title="Look up coordinates">
                                            <MapPin size={16} />
                                        </button>
                                        <button type="submit" disabled={savingLocations} className="ui-btn ui-btn-primary flex-1">
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
