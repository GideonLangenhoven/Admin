"use client";
import { useEffect, useState, useRef, useMemo } from "react";
import { supabase } from "./lib/supabase";
import { confirmAction, notify } from "./lib/app-notify";
import { groupDepartureBookings, nextManifestDepartures, operatorDashboardRange, arrivalReadiness, type ArrivalBooking } from "./lib/operator-day";
import { bookingResolutionUrl, businessDateKey } from "./lib/simple-view";
import { getAdminTimezone } from "./lib/admin-timezone";
import { useBusinessContext } from "../components/BusinessContext";
import { setArrivedCountAction } from "./lib/booking-actions";
import { bookingRealtimeFilter } from "./lib/bookings-realtime";
import Link from "next/link";
import dynamic from "next/dynamic";
import styles from "./dashboard.module.css";
import DashboardComposition from "../components/DashboardComposition";
import DashboardContact from "../components/DashboardContact";
import PaymentRecoveryPanel from "../components/PaymentRecoveryPanel";
import ArrivalCountLink from "../components/booking/ArrivalCountLink";
import {
    CaretLeft, CaretRight, Check,
    X, Trash, MapPin, ArrowsClockwise, Minus, ArrowUDownLeft, ChatText,
} from "@phosphor-icons/react";

/* ── helpers ── */
function fmtTime(iso: string) {
    return new Date(iso).toLocaleString("en-ZA", {
        hour: "2-digit", minute: "2-digit", hour12: false,
        timeZone: getAdminTimezone(),
    });
}

type WeatherLocation = { id: string; name: string; lat: number; lon: number; wgSpot?: number; isDefault?: boolean; province?: string; };

// Group locations by province for the picker, preserving list order of both
// provinces and their locations. Tenant-added locations without a province
// land under "Custom".
function groupByProvince(locs: WeatherLocation[]): Array<[string, WeatherLocation[]]> {
    const groups = new Map<string, WeatherLocation[]>();
    for (const l of locs) {
        const key = l.province || "Custom";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(l);
    }
    return [...groups.entries()];
}

/* ── preset locations ── */
const DEFAULT_LOCATIONS: WeatherLocation[] = [
    { id: "1", name: "Three Anchor Bay, Sea Point", lat: -33.908, lon: 18.396, wgSpot: 137629, isDefault: true, province: "Cape Town & Peninsula" },
    { id: "2", name: "Simon's Town", lat: -34.19, lon: 18.45, wgSpot: 115767, province: "Cape Town & Peninsula" },
    { id: "3", name: "Hout Bay", lat: -34.05, lon: 18.35, wgSpot: 51651, province: "Cape Town & Peninsula" },
    { id: "4", name: "Table Bay", lat: -33.90, lon: 18.43, wgSpot: 32831, province: "Cape Town & Peninsula" },
    { id: "5", name: "False Bay (Muizenberg)", lat: -34.10, lon: 18.47, wgSpot: 131594, province: "Cape Town & Peninsula" },
    { id: "6", name: "Kalk Bay", lat: -34.13, lon: 18.45, wgSpot: 551041, province: "Cape Town & Peninsula" },
    { id: "7", name: "Cape Point", lat: -34.35, lon: 18.50, wgSpot: 128493, province: "Cape Town & Peninsula" },
    { id: "8", name: "Camps Bay", lat: -33.95, lon: 18.38, wgSpot: 635326, province: "Cape Town & Peninsula" },
    { id: "9", name: "Gordon's Bay", lat: -34.16, lon: 18.87, wgSpot: 331265, province: "Cape Town & Peninsula" },
    // Western Cape
    { id: "10", name: "Cape Town", lat: -33.9249, lon: 18.4241, wgSpot: 91, province: "Western Cape" },
    { id: "11", name: "Stellenbosch & Winelands", lat: -33.9321, lon: 18.8602, wgSpot: 1335686, province: "Western Cape" },
    { id: "12", name: "Franschhoek", lat: -33.9107, lon: 19.1229, wgSpot: 1235816, province: "Western Cape" },
    { id: "13", name: "Hermanus", lat: -34.4187, lon: 19.2345, wgSpot: 962669, province: "Western Cape" },
    { id: "14", name: "Gansbaai", lat: -34.5825, lon: 19.3527, wgSpot: 1063835, province: "Western Cape" },
    { id: "15", name: "Mossel Bay", lat: -34.1830, lon: 22.1460, wgSpot: 51683, province: "Western Cape" },
    { id: "16", name: "Wilderness", lat: -33.9967, lon: 22.5827, wgSpot: 146934, province: "Western Cape" },
    { id: "17", name: "Knysna", lat: -34.0363, lon: 23.0471, wgSpot: 51685, province: "Western Cape" },
    { id: "18", name: "Plettenberg Bay", lat: -34.0527, lon: 23.3716, wgSpot: 288275, province: "Western Cape" },
    { id: "19", name: "Oudtshoorn", lat: -33.5906, lon: 22.2014, wgSpot: 240562, province: "Western Cape" },
    { id: "20", name: "Cederberg", lat: -32.4500, lon: 19.0333, wgSpot: 569377, province: "Western Cape" },
    { id: "21", name: "Langebaan & West Coast", lat: -33.0930, lon: 18.0342, wgSpot: 21691, province: "Western Cape" },
    { id: "22", name: "Paternoster", lat: -32.8118, lon: 17.8955, wgSpot: 268656, province: "Western Cape" },
    { id: "23", name: "Swellendam & Overberg", lat: -34.0231, lon: 20.4380, wgSpot: 90737, province: "Western Cape" },
    // Eastern Cape
    { id: "24", name: "Tsitsikamma & Storms River", lat: -33.9667, lon: 23.8833, wgSpot: 269360, province: "Eastern Cape" },
    { id: "25", name: "Jeffreys Bay", lat: -34.0507, lon: 24.9307, wgSpot: 943842, province: "Eastern Cape" },
    { id: "26", name: "Gqeberha (Port Elizabeth)", lat: -33.9608, lon: 25.6022, wgSpot: 51679, province: "Eastern Cape" },
    { id: "27", name: "Addo", lat: -33.4833, lon: 25.7500, wgSpot: 1136214, province: "Eastern Cape" },
    { id: "28", name: "Hogsback", lat: -32.5967, lon: 26.9500, wgSpot: 188928, province: "Eastern Cape" },
    { id: "29", name: "Coffee Bay & Wild Coast", lat: -32.1833, lon: 29.1333, wgSpot: 1011788, province: "Eastern Cape" },
    { id: "30", name: "East London", lat: -33.0153, lon: 27.9116, wgSpot: 402607, province: "Eastern Cape" },
    { id: "31", name: "Graaff-Reinet & Karoo Heartland", lat: -32.2522, lon: 24.5308, wgSpot: 794980, province: "Eastern Cape" },
    // KwaZulu-Natal
    { id: "32", name: "Durban", lat: -29.8587, lon: 31.0218, wgSpot: 208311, province: "KwaZulu-Natal" },
    { id: "33", name: "Umhlanga & Ballito", lat: -29.7248, lon: 31.0873, wgSpot: 1113775, province: "KwaZulu-Natal" },
    { id: "34", name: "Drakensberg", lat: -29.0000, lon: 29.4167, wgSpot: 779873, province: "KwaZulu-Natal" },
    { id: "35", name: "Sani Pass & Southern Berg", lat: -29.5833, lon: 29.2833, wgSpot: 380948, province: "KwaZulu-Natal" },
    { id: "36", name: "Midlands Meander", lat: -29.4833, lon: 30.1500, wgSpot: 541246, province: "KwaZulu-Natal" },
    { id: "37", name: "St Lucia & iSimangaliso", lat: -28.3833, lon: 32.4167, wgSpot: 51053, province: "KwaZulu-Natal" },
    { id: "38", name: "Sodwana Bay", lat: -27.5333, lon: 32.6833, wgSpot: 111152, province: "KwaZulu-Natal" },
    { id: "39", name: "Hluhluwe–iMfolozi", lat: -28.2000, lon: 31.9333, wgSpot: 706381, province: "KwaZulu-Natal" },
    { id: "40", name: "Umkomaas & Aliwal Shoal", lat: -30.2000, lon: 30.7833, wgSpot: 722020, province: "KwaZulu-Natal" },
    { id: "41", name: "Margate & South Coast", lat: -30.8667, lon: 30.3667, wgSpot: 1079383, province: "KwaZulu-Natal" },
    // Gauteng
    { id: "42", name: "Johannesburg", lat: -26.2041, lon: 28.0473, wgSpot: 85097, province: "Gauteng" },
    { id: "43", name: "Soweto", lat: -26.2485, lon: 27.8540, wgSpot: 279047, province: "Gauteng" },
    { id: "44", name: "Pretoria", lat: -25.7479, lon: 28.2293, wgSpot: 353639, province: "Gauteng" },
    { id: "45", name: "Cradle of Humankind", lat: -25.9019, lon: 27.7364, wgSpot: 1144781, province: "Gauteng" },
    { id: "46", name: "Magaliesberg & Hartbeespoort", lat: -25.7469, lon: 27.8674, wgSpot: 736570, province: "Gauteng" },
    { id: "47", name: "Vaal River & Parys", lat: -26.8965, lon: 27.4614, wgSpot: 111339, province: "Gauteng" },
    // Mpumalanga
    { id: "48", name: "Kruger National Park (South)", lat: -24.9945, lon: 31.5892, wgSpot: 394498, province: "Mpumalanga" },
    { id: "49", name: "Hazyview", lat: -25.0448, lon: 31.1315, wgSpot: 146938, province: "Mpumalanga" },
    { id: "50", name: "Sabie & Graskop", lat: -24.9333, lon: 30.8333, wgSpot: 121369, province: "Mpumalanga" },
    { id: "51", name: "Blyde River Canyon", lat: -24.5833, lon: 30.8167, wgSpot: 79015, province: "Mpumalanga" },
    { id: "52", name: "Mbombela (Nelspruit)", lat: -25.4753, lon: 30.9700, wgSpot: 450015, province: "Mpumalanga" },
    { id: "53", name: "Dullstroom", lat: -25.4167, lon: 30.1058, wgSpot: 272288, province: "Mpumalanga" },
    // Limpopo
    { id: "54", name: "Hoedspruit & Kruger (Central)", lat: -24.3547, lon: 30.9581, wgSpot: 815368, province: "Limpopo" },
    { id: "55", name: "Phalaborwa & Kruger (North)", lat: -23.9425, lon: 31.1400, wgSpot: 540529, province: "Limpopo" },
    { id: "56", name: "Waterberg", lat: -24.1517, lon: 28.1170, wgSpot: 127207, province: "Limpopo" },
    { id: "57", name: "Bela-Bela", lat: -24.8833, lon: 28.2833, wgSpot: 400504, province: "Limpopo" },
    { id: "58", name: "Tzaneen & Magoebaskloof", lat: -23.8333, lon: 30.1667, wgSpot: 737300, province: "Limpopo" },
    // North West
    { id: "59", name: "Pilanesberg", lat: -25.2333, lon: 27.1167, wgSpot: 85507, province: "North West" },
    { id: "60", name: "Sun City", lat: -25.3400, lon: 27.0950, wgSpot: 1173168, province: "North West" },
    { id: "61", name: "Madikwe", lat: -24.7833, lon: 26.2667, wgSpot: 307029, province: "North West" },
    { id: "62", name: "Rustenburg & Kgaswane", lat: -25.6672, lon: 27.2424, wgSpot: 122357, province: "North West" },
    // Free State
    { id: "63", name: "Clarens", lat: -28.5167, lon: 28.4167, wgSpot: 214022, province: "Free State" },
    { id: "64", name: "Golden Gate Highlands", lat: -28.5167, lon: 28.6167, wgSpot: 1327626, province: "Free State" },
    { id: "65", name: "Gariep Dam", lat: -30.6167, lon: 25.5000, wgSpot: 283149, province: "Free State" },
    { id: "66", name: "Bloemfontein", lat: -29.0852, lon: 26.1596, wgSpot: 151425, province: "Free State" },
    // Northern Cape
    { id: "67", name: "Augrabies Falls", lat: -28.5883, lon: 20.3486, wgSpot: 985104, province: "Northern Cape" },
    { id: "68", name: "Upington & Orange River", lat: -28.4478, lon: 21.2561, wgSpot: 540496, province: "Northern Cape" },
    { id: "69", name: "Kgalagadi", lat: -26.4833, lon: 20.6167, wgSpot: 183544, province: "Northern Cape" },
    { id: "70", name: "Namaqualand & Springbok", lat: -29.6644, lon: 17.8865, wgSpot: 607288, province: "Northern Cape" },
    { id: "71", name: "Sutherland", lat: -32.3833, lon: 20.6667, wgSpot: 228811, province: "Northern Cape" },
    { id: "72", name: "Kimberley", lat: -28.7282, lon: 24.7499, wgSpot: 454036, province: "Northern Cape" },
];

/* ── Windguru Widget (lazy-loaded to reduce initial bundle) ── */
const WindguruWidget = dynamic(() => import("../components/WindguruWidget"), {
    ssr: false,
    loading: () => <div className="w-full min-h-[350px] flex items-center justify-center text-sm" style={{ color: "var(--ck-text-muted)" }}>Loading weather...</div>,
});

/* ── types ── */
interface ManifestBooking extends ArrivalBooking {
    id: string;
    customer_name: string;
    phone: string;
    email: string | null;
    qty: number;
    slot_id: string;
    arrived_count: number;
    total_amount: number;
    status: string;
    checked_in: boolean;
    custom_fields: Record<string, string> | null;
    tours: { name?: string } | null;
    slots: { start_time?: string } | null;
    add_ons: Array<{ name: string; qty: number }>;
}

interface SlotSummary {
    id: string;
    time: string;
    timeRaw: string;
    tourName: string;
    totalPax: number;
    checkedIn: number;
    bookingCount: number;
    bookings: ManifestBooking[];
}

interface DashboardSnapshot {
    business_id: string;
    weather_widget_locations: unknown;
    today_manifest: ManifestBooking[];
    tomorrow_manifest: ManifestBooking[];
    refund_count: number;
    refund_total: number;
    inbox_count: number;
    photos_outstanding: number;
    revenue: { today: number; week: number; month: number; series: number[] };
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

/* ── main component ── */
export default function Dashboard() {
    const { businessId, timezone, readOnly } = useBusinessContext();
    const activeBusinessRef = useRef(businessId);
    activeBusinessRef.current = businessId;
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
    const [loadError, setLoadError] = useState("");
    const loadSequence = useRef(0);
    const arrivalBusy = useRef(new Set<string>());
    const realtimeRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Roll call state
    const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
    const [now, setNow] = useState(() => Date.now());

    // Weather location
    const [locations, setLocations] = useState<WeatherLocation[]>([]);
    const [location, setLocation] = useState<WeatherLocation | null>(null);

    // Weather management
    const [editingLocs, setEditingLocs] = useState(false);
    const [weatherProvider, setWeatherProvider] = useState<"windguru" | "windy">("windguru");
    const [wgRefreshKey, setWgRefreshKey] = useState(0);
    const [windyRefreshKey, setWindyRefreshKey] = useState(0);
    const [savingLocations, setSavingLocations] = useState(false);
    const locationSaveBusy = useRef(false);
    const [newLocName, setNewLocName] = useState("");
    const [newLocLat, setNewLocLat] = useState("");
    const [newLocLon, setNewLocLon] = useState("");
    const [newLocWg, setNewLocWg] = useState("");
    const [geocoding, setGeocoding] = useState(false);

    useEffect(() => {
        const iv = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(iv);
    }, []);

    const saveLocations = async (locs: WeatherLocation[]) => {
        if (readOnly || locationSaveBusy.current) throw new Error("Weather settings cannot be saved right now.");
        locationSaveBusy.current = true;
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
            locationSaveBusy.current = false;
            setSavingLocations(false);
        }
    };

    const setDefaultLocation = async () => {
        if (!location) return;
        try {
            await saveLocations(locations.map(l => ({ ...l, isDefault: l.id === location.id })));
            notify({ title: "Default location saved", message: `${location.name} is now the default weather location.`, tone: "success" });
        } catch { /* saveLocations already notified */ }
    };

    const removeLocation = async (id: string) => {
        if (!await confirmAction({ title: "Remove weather location", message: "Remove this location?", tone: "warning", confirmLabel: "Remove" })) return;
        const next = locations.filter(l => l.id !== id);
        if (next.length > 0 && !next.find(l => l.isDefault)) next[0].isDefault = true;
        await saveLocations(next);
        notify({ title: "Location removed", message: "Weather location removed.", tone: "success" });
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
                        // The API returns {count, spots:[...]} without coordinates
                        // (the old bare-array + lat/lon parsing never matched, so
                        // auto-fill silently did nothing). Fetch details for the
                        // first few results and pick the closest to the geocode.
                        const spots: Array<{ id_spot?: string }> = Array.isArray(wgData?.spots) ? wgData.spots : [];
                        let best: string | null = null;
                        let minDist = Infinity;
                        for (const spot of spots.slice(0, 5)) {
                            if (!spot.id_spot) continue;
                            try {
                                const detRes = await fetch(`https://www.windguru.cz/int/iapi.php?q=spot&id_spot=${spot.id_spot}`, { headers: { Accept: "application/json", Referer: "https://www.windguru.cz/" } });
                                const det = await detRes.json();
                                if (det?.lat == null || det?.lon == null) continue;
                                const d = (det.lat - lat) ** 2 + (det.lon - lon) ** 2;
                                if (d < minDist) { minDist = d; best = String(spot.id_spot); }
                            } catch { /* skip unfetchable spot */ }
                        }
                        if (best) setNewLocWg(best);
                    } catch {
                        // Windguru search failed (CORS or network) — silently skip, user can enter manually
                    }
                }
            } else {
                notify({ title: "Coordinates not found", message: "Location not found. Enter coordinates manually.", tone: "warning" });
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
        const result: SlotSummary[] = [];
        for (const bookings of groupDepartureBookings(activeManifest)) {
            const timeRaw = bookings[0].slots?.start_time || "unknown";
            const totalPax = bookings.reduce((s, b) => s + b.qty, 0);
            const checkedIn = bookings.reduce((s, b) => s + b.arrived_count, 0);
            result.push({
                id: bookings[0].slot_id,
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
        return nextManifestDepartures(result, now);
    }, [activeManifest, timezone, now]);

    const nextDeparture = manifest
        .filter((booking) => new Date(booking.slots?.start_time || "").getTime() >= now)
        .sort((a, b) => (a.slots?.start_time || "").localeCompare(b.slots?.start_time || ""))[0];

    useEffect(() => { if (businessId) void load(); return () => { loadSequence.current++; }; }, [businessId, timezone]);

    // Realtime: refresh dashboard when bookings change (refund processed, new booking, etc.)
    useEffect(() => {
        if (!businessId) return;
        const ch = supabase.channel("dash-bookings-" + businessId)
            .on("postgres_changes" as any, { event: "*", schema: "public", table: "bookings", filter: bookingRealtimeFilter(businessId) }, () => {
                if (realtimeRefreshRef.current) clearTimeout(realtimeRefreshRef.current);
                realtimeRefreshRef.current = setTimeout(() => {
                    realtimeRefreshRef.current = null;
                    void load();
                }, 250);
            })
            .subscribe();
        return () => {
            if (realtimeRefreshRef.current) clearTimeout(realtimeRefreshRef.current);
            realtimeRefreshRef.current = null;
            supabase.removeChannel(ch);
        };
    }, [businessId]);

    useEffect(() => {
        if (!businessId) return;
        const refresh=()=>void load();
        const offline=()=>setLoadError("Connection lost. Refresh after reconnecting before changing arrivals.");
        window.addEventListener("online",refresh);window.addEventListener("offline",offline);
        const timer=setInterval(refresh,60_000);
        return()=>{clearInterval(timer);window.removeEventListener("online",refresh);window.removeEventListener("offline",offline);};
    },[businessId,timezone]);

    async function load() {
        setLoading(true);
        const request = ++loadSequence.current;
        setLoadError("");
        const { data, error } = await supabase.rpc("get_operator_dashboard", {
            p_business_id: businessId, ...operatorDashboardRange(timezone),
        }).then(result => result, () => ({ data: null, error: { message: "Connection unavailable" } }));
        if (request !== loadSequence.current) return;
        if (activeBusinessRef.current !== businessId) return;
        if (error || !data || data.business_id !== businessId) {
            setLoadError("Dashboard unavailable. Refresh to load counts and actions.");
            setLoading(false);
            return;
        }
        const snapshot = data as DashboardSnapshot;
        const todayManifest = snapshot.today_manifest || [];
        const tomorrowData = snapshot.tomorrow_manifest || [];

        // Today
        setManifest(todayManifest);
        setTodayBookings(todayManifest.length);
        setTodayPax(todayManifest.reduce((s, b) => s + b.qty, 0));

        // Tomorrow
        setTomorrowManifest(tomorrowData);
        setTomorrowPax(tomorrowData.reduce((s, b) => s + b.qty, 0));

        // Refunds
        setRefundCount(Number(snapshot.refund_count || 0));
        setRefundTotal(Number(snapshot.refund_total || 0));

        // Inbox
        setInboxCount(Number(snapshot.inbox_count || 0));

        // Photos outstanding
        setPhotosOutstanding(Number(snapshot.photos_outstanding || 0));

        const stored = Array.isArray(snapshot.weather_widget_locations) && snapshot.weather_widget_locations.length > 0
            ? snapshot.weather_widget_locations as WeatherLocation[]
            : DEFAULT_LOCATIONS;
        setLocations(stored);
        setLocation((current) => stored.find((loc) => loc.id === current?.id) || stored.find((loc) => loc.isDefault) || stored[0] || null);

        setLoading(false);
    }

    async function toggleCheckIn(booking: ManifestBooking) {
        if (readOnly || arrivalBusy.current.has(booking.id) || (!booking.checked_in && !arrivalReadiness(booking).canIncrease)) return;
        arrivalBusy.current.add(booking.id);
        const targetCount = booking.checked_in ? 0 : booking.qty;
        const newValue = targetCount === booking.qty;
        // Optimistic update
        setManifest(prev => prev.map(b =>
            b.id === booking.id
                ? { ...b, arrived_count: targetCount, checked_in: newValue }
                : b
        ));
        setTomorrowManifest(prev => prev.map(b =>
            b.id === booking.id
                ? { ...b, arrived_count: targetCount, checked_in: newValue }
                : b
        ));
        const result = await setArrivedCountAction({
            bookingId: booking.id,
            businessId,
            arrivedCount: targetCount,
            expectedArrivedCount: booking.arrived_count,
            slotId: booking.slot_id,
            source: "dashboard",
        });
        if (!result.ok) {
            // Revert on error
            setManifest(prev => prev.map(b =>
                b.id === booking.id
                    ? { ...b, arrived_count: booking.arrived_count, checked_in: booking.checked_in }
                    : b
            ));
            setTomorrowManifest(prev => prev.map(b =>
                b.id === booking.id
                    ? { ...b, arrived_count: booking.arrived_count, checked_in: booking.checked_in }
                    : b
            ));
            notify({ title: "Check-in not saved", message: result.error || "Refresh and try again.", tone: "error" });
            if (result.data?.code === "STALE" || result.data?.code === "STALE_SLOT") load();
        }
        arrivalBusy.current.delete(booking.id);
    }

    const activeSlot = slotGroups.find(slot => slot.id === selectedSlotId) || slotGroups[0] || null;
    const activeSlotIdx = slotGroups.findIndex(slot => slot.id === activeSlot?.id);

    if (loadError && !loading) return <div className={`${styles.workspace} ui-card p-6`} role="alert">
        <h2 className="text-xl font-semibold">Daily dashboard unavailable</h2><p className="mt-2">{loadError}</p>
        <button className="ui-btn ui-btn-primary mt-4" onClick={() => load()}>Try again</button>
        <Link className="ui-btn ui-btn-soft mt-4 ml-2" href="/simple">Simple View</Link>
    </div>;

    /* ── skeleton — mirrors the real layout, no spinners ── */
    if (loading) return (
        <div className={`${styles.workspace} flex max-w-[1400px] flex-col gap-4 pb-10 lg:mx-auto lg:gap-6`}>
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
        <div className={`${styles.workspace} flex max-w-[1400px] flex-col gap-4 pb-10 lg:mx-auto lg:gap-6`}>
            {/* Dashboard Header */}
            <div className="anim-fade-up flex flex-wrap items-end justify-between gap-4 pt-1 lg:pt-2">
                <div className="min-w-0">
                    <p className="ui-mono-label mb-2">
                        {new Date(now).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", timeZone: getAdminTimezone() })}
                    </p>
                    <h2 className="font-display text-[1.75rem] md:text-[2rem] font-semibold leading-tight text-balance" style={{ color: "var(--ck-text-strong)" }}>Dashboard</h2>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <Link href="/new-booking" className="ui-btn ui-btn-primary">
                        Add Booking
                    </Link>
                </div>
            </div>

            <DashboardComposition tiles={{
                next_departure: (<section aria-label="Next departure" className="ui-card flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <h3 className="ui-mono-label">Next departure</h3>
                {nextDeparture ? (
                    <p className="min-w-0 text-base font-semibold [overflow-wrap:anywhere]" style={{ color: "var(--ck-text-strong)" }}>
                        <span className="tabular-nums">{fmtTime(nextDeparture.slots!.start_time!)}</span> · {nextDeparture.tours?.name || "Tour"}
                    </p>
                ) : (
                    <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>No more booked departures today</p>
                )}
            </section>),
                guests: (<Link href="/bookings" className={`${styles.paxSummary} bg-bt-dark ui-card-hover anim-fade-up anim-d1 group relative block min-w-0 overflow-hidden rounded-2xl p-4 text-white lg:p-5`} style={{ border: "1px solid rgba(244, 241, 232, 0.09)", boxShadow: "var(--ck-shadow-hero)" }}>
                    <TopoLines className="absolute inset-0 hidden h-full w-full lg:block" />
                    <TrailMotif className="absolute right-5 top-5 hidden h-14 w-14 lg:block" />
                    <div className="relative">
                        <span className="ui-mono-label !text-white/60">Today&apos;s guests</span>
                        <div className="font-display my-2 text-[38px] font-semibold leading-none tabular-nums text-white">
                            {todayPax}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-sm text-white/55">
                            <span className="h-[5px] w-[5px] rounded-full bg-[#D9822F]" aria-hidden="true" />
                            <span className="font-mono text-[12px] font-medium text-white/90">{todayBookings}</span>
                            {todayBookings === 1 ? "booking" : "bookings"} · {tomorrowPax} {tomorrowPax === 1 ? "guest" : "guests"} tomorrow
                        </div>
                    </div>
                </Link>),
                manifest: (<section aria-label="Manifest" className={`${styles.card} ui-card flex flex-col`}>
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 py-4 border-b" style={{ borderColor: 'var(--ck-border-subtle)' }}>
                        <div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                                <h3 className={styles.sectionTitle} style={{ color: "var(--ck-text-strong)" }}>
                                    Manifest
                                </h3>
                                <div className="ui-seg">
                                    <button
                                        type="button"
                                        className="ui-seg-item"
                                        data-active={manifestDate === "TODAY"}
                                        aria-pressed={manifestDate === "TODAY"}
                                        onClick={() => { setManifestDate("TODAY"); setSelectedSlotId(null); }}
                                    >
                                        Today
                                    </button>
                                    <button
                                        type="button"
                                        className="ui-seg-item"
                                        data-active={manifestDate === "TOMORROW"}
                                        aria-pressed={manifestDate === "TOMORROW"}
                                        onClick={() => { setManifestDate("TOMORROW"); setSelectedSlotId(null); }}
                                    >
                                        Tomorrow
                                    </button>
                                </div>
                            </div>
                            <p className="mt-1 text-sm" style={{ color: "var(--ck-text-muted)" }}>Next departure</p>
                        </div>
                    </div>

                    <div className="min-w-0 flex-1">
                        {slotGroups.length === 0 ? (
                            <div className="ui-empty">
                                <p className="text-base font-semibold" style={{ color: "var(--ck-text-strong)" }}>
                                    {manifestDate === "TODAY" ? "No more booked departures today" : "No bookings tomorrow"}
                                </p>
                                <Link href="/bookings" className="text-sm underline">View bookings</Link>
                            </div>
                        ) : (
                            <>
                            <div className={`${styles.mobileRows} divide-y`} style={{ "--tw-divide-color": "var(--ck-border-subtle)" } as React.CSSProperties}>
                                {slotGroups.map((slot, i) => {
                                    const complete = slot.checkedIn === slot.totalPax && slot.totalPax > 0;
                                    return (
                                        <button
                                            key={slot.id}
                                            data-slot-id={slot.id}
                                            data-selected={i === activeSlotIdx}
                                            aria-pressed={i === activeSlotIdx}
                                            type="button"
                                            onClick={() => { setSelectedSlotId(slot.id); }}
                                            className="flex min-h-[76px] w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--ck-surface-sunken)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ck-accent)]"
                                            aria-label={`${slot.time}, ${slot.tourName}, ${slot.totalPax} guests, ${slot.checkedIn} checked in`}
                                        >
                                            <span className="min-w-0 flex-1 basis-36 [overflow-wrap:anywhere]">
                                                <span className="block text-base font-semibold tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{slot.time}</span>
                                                <span className="mt-1 block text-sm font-medium leading-snug" style={{ color: "var(--ck-text)" }}>{slot.tourName}</span>
                                                <span className="mt-1 block text-sm" style={{ color: "var(--ck-text-muted)" }}>{slot.bookingCount} {slot.bookingCount === 1 ? "booking" : "bookings"}</span>
                                            </span>
                                            <span className="shrink-0 text-right">
                                                <span className="block text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>{slot.totalPax} guests</span>
                                                <span className={`ui-status mt-1 ${complete ? "ui-pill-success" : "ui-pill-amber"}`}>
                                                    {slot.checkedIn}/{slot.totalPax} present
                                                </span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                            <table aria-label="Manifest departures" className={`${styles.table} text-sm`}>
                                <colgroup><col style={{ width: "14%" }} /><col style={{ width: "26%" }} /><col style={{ width: "18%" }} /><col style={{ width: "14%" }} /><col style={{ width: "28%" }} /></colgroup>
                                <thead>
                                    <tr>
                                        <th className="px-5 py-3.5 text-left text-xs font-medium uppercase tracking-[0.1em] border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Time</th>
                                        <th className="px-5 py-3.5 text-left text-xs font-medium uppercase tracking-[0.1em] border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Tour</th>
                                        <th className="px-5 py-3.5 text-right text-xs font-medium uppercase tracking-[0.1em] border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Bookings</th>
                                        <th className="px-5 py-3.5 text-right text-xs font-medium uppercase tracking-[0.1em] border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Guests</th>
                                        <th className="px-5 py-3.5 text-right text-xs font-medium uppercase tracking-[0.1em] border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Checked In</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y" style={{ "--tw-divide-color": "var(--ck-border-subtle)" } as React.CSSProperties}>
                                    {slotGroups.map((slot, i) => {
                                        const complete = slot.checkedIn === slot.totalPax && slot.totalPax > 0;
                                        const pct = slot.totalPax > 0 ? Math.round((slot.checkedIn / slot.totalPax) * 100) : 0;
                                        return (
                                            <tr
                                                key={slot.id}
                                                data-slot-id={slot.id}
                                                data-selected={i === activeSlotIdx}
                                                className="transition-colors cursor-pointer hover:bg-[var(--ck-surface-sunken)]"
                                                onClick={() => { setSelectedSlotId(slot.id); }}
                                            >
                                                <td className="px-5 py-4">
                                                    <button type="button" aria-label={`Select ${slot.time}, ${slot.tourName}`} aria-pressed={i === activeSlotIdx} className="min-h-11 font-semibold text-sm tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{slot.time}</button>
                                                </td>
                                                <td className="px-5 py-4">
                                                    <div className="text-sm font-medium" style={{ color: "var(--ck-text)" }}>{slot.tourName}</div>
                                                </td>
                                                <td className="px-5 py-4 text-right">
                                                    <div className="text-sm font-medium tabular-nums" style={{ color: "var(--ck-text)" }}>{slot.bookingCount}</div>
                                                </td>
                                                <td className="px-5 py-4 text-right">
                                                    <div className="font-bold text-[16px] tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{slot.totalPax}</div>
                                                </td>
                                                <td className="px-5 py-4">
                                                    <div className="flex flex-wrap items-center justify-end gap-2.5">
                                                        <div className={`${styles.attendanceTrack} ui-progress w-14`}><div className="ui-progress-fill" style={{ width: `${pct}%` }} /></div>
                                                        <span className={`ui-status ${complete ? "ui-pill-success" : "ui-pill-amber"}`}>
                                                            {slot.checkedIn}/{slot.totalPax}
                                                        </span>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            </>
                        )}
                    </div>
                </section>),
                roll_call: (<section aria-label="Roll Call" className={`${styles.card} ui-card flex flex-col`}>
                    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b" style={{ borderColor: 'var(--ck-border-subtle)' }}>
                        <div className="min-w-0 flex-1 basis-44">
                            <h3 className={styles.sectionTitle} style={{ color: "var(--ck-text-strong)" }}>Roll Call</h3>
                            <p className="text-sm font-medium mt-0.5 [overflow-wrap:anywhere]" style={{ color: "var(--ck-text-muted)" }}>
                                {activeSlot ? `${activeSlot.time} · ${activeSlot.tourName}` : manifestDate === "TODAY" ? "No more departures today" : "No departures tomorrow"}
                            </p>
                        </div>
                        {slotGroups.length > 1 && (
                            <nav aria-label="Departures" className="flex flex-wrap items-center gap-1.5">
                                <button
                                    type="button"
                                    aria-label="Previous departure"
                                    onClick={() => { setSelectedSlotId(slotGroups[Math.max(0, activeSlotIdx - 1)].id); }}
                                    disabled={activeSlotIdx === 0}
                                    className="flex h-11 w-11 items-center justify-center rounded-lg border transition-colors disabled:opacity-30 hover:bg-[var(--ck-surface-sunken)]"
                                    style={{ borderColor: "var(--ck-border-strong)", color: "var(--ck-text)" }}
                                >
                                    <CaretLeft size={16} />
                                </button>
                                <span className="font-mono text-xs font-semibold px-1.5 tabular-nums" style={{ color: "var(--ck-text-muted)" }}>
                                    Departure {activeSlotIdx + 1} of {slotGroups.length}
                                </span>
                                <button
                                    type="button"
                                    aria-label="Next departure"
                                    onClick={() => { setSelectedSlotId(slotGroups[Math.min(slotGroups.length - 1, activeSlotIdx + 1)].id); }}
                                    disabled={activeSlotIdx >= slotGroups.length - 1}
                                    className="flex h-11 w-11 items-center justify-center rounded-lg border transition-colors disabled:opacity-30 hover:bg-[var(--ck-surface-sunken)]"
                                    style={{ borderColor: "var(--ck-border-strong)", color: "var(--ck-text)" }}
                                >
                                    <CaretRight size={16} />
                                </button>
                            </nav>
                        )}
                    </div>

                    <div className="min-w-0 flex-1">
                        {!activeSlot ? (
                            <div className="ui-empty">
                                <p className="text-base font-semibold" style={{ color: "var(--ck-text-strong)" }}>{manifestDate === "TODAY" ? "No more booked departures today" : "No bookings tomorrow"}</p>
                                <Link href="/bookings" className="text-sm underline">View bookings</Link>
                            </div>
                        ) : (
                            <>
                                <div className={`${styles.mobileRows} ${styles.rollCallRows}`}>
                                    {activeSlot.bookings.map((b) => (
                                        <div key={b.id} className={styles.rollCallGuest} style={{ background: b.checked_in ? "var(--ck-success-soft)" : undefined }}>
                                            <div className={styles.guestIdentity}>
                                                <Link className={`${styles.guestName} no-underline ${b.checked_in ? "line-through opacity-70" : ""}`} href={`/bookings/${b.id}`}>{b.customer_name}</Link>
                                                <DashboardContact booking={b} requestWaiver />
                                            </div>
                                            <div className={styles.rollCallAttendance}>
                                                <button data-demo-action={b.checked_in ? "dashboard.uncheck" : "dashboard.checkin"}
                                                    type="button"
                                                    role="checkbox"
                                                    aria-checked={b.checked_in ? true : b.arrived_count > 0 ? "mixed" : false}
                                                    aria-label={b.checked_in ? `Mark ${b.customer_name} as not present` : `Mark all of ${b.customer_name}'s group as present`}
                                                    onClick={() => toggleCheckIn(b)}
                                                    disabled={readOnly || (!b.checked_in && !arrivalReadiness(b).canIncrease)}
                                                    title={!b.checked_in ? arrivalReadiness(b).resolutionLabel : undefined}
                                                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ck-accent)]"
                                                    style={b.checked_in
                                                        ? { background: "var(--ck-success)", borderColor: "var(--ck-success)" }
                                                        : { background: "var(--ck-surface)", borderColor: "var(--ck-border-strong)" }}
                                                >
                                                    {b.checked_in ? <Check size={18} weight="bold" color="#ffffff" /> : b.arrived_count > 0 ? <Minus size={18} weight="bold" /> : null}
                                                </button>
                                                <ArrivalCountLink booking={b} date={businessDateKey(timezone, new Date(activeSlot.timeRaw))} slotId={b.slot_id} />
                                                <span className={`ui-status shrink-0 ${b.checked_in ? "ui-pill-success" : b.status === "PAID" || b.status === "CONFIRMED" ? "ui-pill-accent" : "ui-pill-amber"}`}>
                                                    {b.checked_in ? "Present" : b.arrived_count > 0 ? `${b.arrived_count}/${b.qty} arrived` : b.status}
                                                </span>
                                            </div>
                                            {!b.checked_in && !arrivalReadiness(b).canIncrease && <p id={`arrival-${b.id}`} className={`${styles.prose} mt-2`}><Link className="no-underline" href={bookingResolutionUrl(b.id, "/", arrivalReadiness(b).resolutionSection)}>{arrivalReadiness(b).resolutionLabel}</Link></p>}
                                            {b.add_ons?.map((ao, idx) => <span key={idx} className="mr-2 text-sm">{ao.qty > 1 ? `${ao.qty}× ` : "+ "}{ao.name}</span>)}
                                        </div>
                                    ))}
                                </div>
                                <table aria-label="Roll Call guests" className={`${styles.table} text-sm`}>
                                    <colgroup><col style={{ width: "4rem" }} /><col /><col style={{ width: "22%" }} /><col style={{ width: "20%" }} /></colgroup>
                                    <thead>
                                        <tr>
                                            <th className="w-12 px-3 py-3.5 text-center text-xs font-medium uppercase tracking-[0.1em] border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}><span className="sr-only">Check in</span></th>
                                            <th className="px-4 py-3.5 text-left text-xs font-medium uppercase tracking-[0.1em] border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Customer</th>
                                            <th className="px-4 py-3.5 text-right text-xs font-medium uppercase tracking-[0.1em] border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Guests</th>
                                            <th className="px-4 py-3.5 text-right text-xs font-medium uppercase tracking-[0.1em] border-b" style={{ color: "var(--ck-text-muted)", borderColor: "var(--ck-border-subtle)" }}>Status</th>
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
                                                    <button data-demo-action={b.checked_in ? "dashboard.uncheck" : "dashboard.checkin"}
                                                        type="button"
                                                        role="checkbox"
                                                        aria-checked={b.checked_in ? true : b.arrived_count > 0 ? "mixed" : false}
                                                        aria-label={b.checked_in ? `Mark ${b.customer_name} as not present` : `Mark all of ${b.customer_name}'s group as present`}
                                                        onClick={() => toggleCheckIn(b)}
                                                disabled={readOnly || (!b.checked_in && !arrivalReadiness(b).canIncrease)}
                                                title={!b.checked_in ? arrivalReadiness(b).resolutionLabel : undefined}
                                                        className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ck-accent)]"
                                                        style={b.checked_in
                                                            ? { background: "var(--ck-success)", borderColor: "var(--ck-success)" }
                                                            : { background: "var(--ck-surface)", borderColor: "var(--ck-border-strong)" }}
                                                    >
                                                        {b.checked_in ? <Check size={13} weight="bold" color="#ffffff" /> : b.arrived_count > 0 ? <Minus size={18} weight="bold" /> : null}
                                                    </button>
                                                </td>
                                                <td className="px-4 py-3.5">
                                                    <div className={styles.guestIdentity}>
                                                        <Link className={`${styles.guestName} no-underline ${b.checked_in ? "line-through opacity-70" : ""}`} href={`/bookings/${b.id}`}>{b.customer_name}</Link>
                                                        <DashboardContact booking={b} requestWaiver />
                                                    </div>
                                                    {!b.checked_in && !arrivalReadiness(b).canIncrease && <p className={`${styles.prose} mt-1`}><Link className="no-underline" href={bookingResolutionUrl(b.id, "/", arrivalReadiness(b).resolutionSection)}>{arrivalReadiness(b).resolutionLabel}</Link></p>}
                                                    {b.add_ons && b.add_ons.length > 0 && (
                                                        <div className="mt-1 flex flex-wrap gap-1">
                                                            {b.add_ons.map((ao, idx) => (
                                                                <span key={idx} className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: "var(--ck-amber-soft)", color: "var(--ck-amber)" }}>
                                                                    {ao.qty > 1 ? `${ao.qty}× ` : "+ "}{ao.name}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3.5 text-right">
                                                    <div className="flex justify-end font-bold text-sm tabular-nums" style={{ color: "var(--ck-text-strong)" }}><ArrivalCountLink booking={b} date={businessDateKey(timezone, new Date(activeSlot.timeRaw))} slotId={b.slot_id} /></div>
                                                </td>
                                                <td className="px-4 py-3.5 text-right">
                                                    <span className={`ui-status ${
                                                        b.checked_in ? "ui-pill-success"
                                                        : b.status === "PAID" || b.status === "CONFIRMED" ? "ui-pill-accent"
                                                        : "ui-pill-amber"
                                                    }`}>
                                                        {b.checked_in ? "Present" : b.arrived_count > 0 ? `${b.arrived_count}/${b.qty} arrived` : b.status}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <div className="px-5 py-3.5 border-t" style={{ borderColor: "var(--ck-border-subtle)" }}>
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <span className="text-sm font-medium" style={{ color: "var(--ck-text-muted)" }}>
                                            {activeSlot.checkedIn} of {activeSlot.totalPax} guests arrived
                                        </span>
                                        {activeSlot.checkedIn === activeSlot.totalPax && activeSlot.totalPax > 0 ? (
                                            <span className="flex items-center gap-1.5 text-[12px] font-bold shrink-0" style={{ color: "var(--ck-success)" }}>
                                                All present
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
                </section>),
                refunds: (<section className="ui-card p-5" aria-label="Attention">
                    <h3 className={styles.sectionTitle}>Attention</h3>
                    <div className="mt-3 divide-y">
                        <Link href="/refunds" className={styles.attentionRow}>
                            <ArrowUDownLeft size={22} aria-hidden="true" />
                            <span className="min-w-0 flex-1">Refunds needing action <span className="block text-sm" style={{ color: "var(--ck-text-muted)" }}>Requested, pending, manual transfer or failed</span></span>
                            <span className="text-right"><strong className="block tabular-nums">{refundCount}</strong><span className="text-sm tabular-nums">R{refundTotal.toLocaleString("en-ZA", { maximumFractionDigits: 2 })}</span></span>
                        </Link>
                        <Link href="/inbox" className={styles.attentionRow}>
                            <ChatText size={22} aria-hidden="true" /><span className="min-w-0 flex-1">Inbox <span className="block text-sm" style={{ color: "var(--ck-text-muted)" }}>Conversations handled by a human</span></span><strong className="tabular-nums">{inboxCount}</strong>
                        </Link>
                    </div>
                </section>),
                photos: (<Link href="/photos" className="ui-card ui-card-hover group block p-5">
                    <div className="flex items-start justify-between mb-5">
                        <div className="flex items-center gap-3">
                            <span className="ui-mono-label">Photo upload backlog</span>
                        </div>
                    </div>
                    <div className="font-display mb-3 flex items-baseline gap-1.5 text-[34px] font-semibold leading-none tabular-nums" style={{ color: "var(--ck-text-strong)" }}>
                        {photosOutstanding} <span className="text-[15px] font-medium tracking-normal" style={{ color: "var(--ck-text-muted)" }}>trips</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm" style={{ color: "var(--ck-text-muted)" }}>
                        <span className="h-[5px] w-[5px] rounded-full" style={{ background: photosOutstanding > 0 ? "var(--ck-warning)" : "var(--ck-success)" }} aria-hidden="true" />
                        <span>{photosOutstanding > 0 ? "Without photos · last 7 days" : "All booked trips have photos · last 7 days"}</span>
                    </div>
                </Link>),
                payment_recovery: (<PaymentRecoveryPanel dashboard />),
                weather: (<div className="ui-card flex flex-col overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b" style={{ borderColor: 'var(--ck-border-subtle)' }}>
                        <div>
                            <h3 className={styles.sectionTitle} style={{ color: "var(--ck-text-strong)" }}>Weather &amp; Trail Conditions</h3>
                            <p className="ui-mono-label mt-0.5">Wind &amp; sea forecasts</p>
                        </div>
                        <button onClick={() => setEditingLocs(!editingLocs)} className="ui-btn ui-btn-ghost !h-8 !px-3 !text-sm">
                            Manage Locations
                        </button>
                    </div>

                    <div className="p-5 flex-1 flex flex-col min-h-0 relative">
                        <div className="mb-4 flex flex-wrap items-center gap-2">
                            <select
                                aria-label="Weather place"
                                value={location?.id || ""}
                                onChange={(e) => {
                                    const loc = locations.find(l => l.id === e.target.value);
                                    if (loc) setLocation(loc);
                                }}
                                className="ui-control flex-1 min-w-0 appearance-none !px-4 !py-2 text-sm font-medium"
                                style={{ backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%2366736B%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 1rem top 50%", backgroundSize: "0.65rem auto" }}
                                disabled={locations.length === 0}
                            >
                                {locations.length === 0 && <option value="">No locations available</option>}
                                {groupByProvince(locations).map(([province, locs]) => (
                                    <optgroup key={province} label={province}>
                                        {locs.map(l => (
                                            <option key={l.id} value={l.id}>{l.name} {l.isDefault ? "(Default)" : ""}</option>
                                        ))}
                                    </optgroup>
                                ))}
                            </select>
                            {location && !location.isDefault && (
                                <button data-demo-action="weather.default" onClick={setDefaultLocation} disabled={savingLocations || readOnly} className="ui-btn ui-btn-ghost !h-9 !px-3 !text-sm whitespace-nowrap">
                                    {savingLocations ? "Saving..." : "Save as default"}
                                </button>
                            )}
                        </div>

                        <div role="tablist" aria-label="Weather provider" className="ui-seg mb-4 w-fit" onKeyDown={event => {
                            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                            event.preventDefault();
                            const next = event.key === "Home" ? "windguru" : event.key === "End" ? "windy" : weatherProvider === "windguru" ? "windy" : "windguru";
                            setWeatherProvider(next); document.getElementById(`weather-tab-${next}`)?.focus();
                        }}>
                            {(["windguru", "windy"] as const).map(provider => <button key={provider} id={`weather-tab-${provider}`} type="button" role="tab" aria-selected={weatherProvider === provider} aria-controls={`weather-${provider}`} tabIndex={weatherProvider === provider ? 0 : -1} data-active={weatherProvider === provider} className="ui-seg-item min-h-11" onClick={() => setWeatherProvider(provider)}>{provider === "windguru" ? "Windguru" : "Windy"}</button>)}
                        </div>
                        <p className="mb-3 text-sm" style={{ color: "var(--ck-text-muted)" }}>Forecast source and model times are shown by each provider. Business timezone: {timezone}. Refresh reloads the selected provider; it does not confirm forecast freshness.</p>
                        {/* Windguru */}
                        <div id="weather-windguru" role="tabpanel" aria-labelledby="weather-tab-windguru" hidden={weatherProvider !== "windguru"} className="rounded-xl overflow-hidden border mb-4" style={{ borderColor: "var(--ck-border-subtle)" }}>
                            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--ck-border-subtle)", background: "var(--ck-surface-warm)" }}>
                                <span className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>Windguru{location ? ` · ${location.name}` : ""}</span>
                                <div className="flex flex-wrap items-center gap-3">
                                    <button onClick={() => setWgRefreshKey(k => k + 1)} className="ui-btn ui-btn-ghost min-h-11 min-w-11 !px-3" aria-label="Refresh Windguru" title="Refresh Windguru" style={{ color: "var(--ck-text-muted)" }}><ArrowsClockwise size={18} aria-hidden="true" /> Refresh</button>
                                    {location?.wgSpot && <a href={`https://www.windguru.cz/${location.wgSpot}`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold hover:underline" style={{ color: "var(--ck-accent)" }}>Open Windguru ↗</a>}
                                </div>
                            </div>
                            <div className="relative min-h-[350px]" style={{ background: "var(--ck-surface)" }}>
                                {location ? (
                                    location.wgSpot ? (
                                        <WindguruWidget key={location.wgSpot} spotId={location.wgSpot} refreshKey={wgRefreshKey} />
                                    ) : (
                                        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                                            <p className="text-sm font-medium" style={{ color: "var(--ck-text-muted)" }}>This location does not have a Windguru spot ID assigned.</p>
                                        </div>
                                    )
                                ) : (
                                    <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                                        <p className="text-sm font-medium" style={{ color: "var(--ck-text-muted)" }}>No location selected</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Windy */}
                        <div id="weather-windy" role="tabpanel" aria-labelledby="weather-tab-windy" hidden={weatherProvider !== "windy"} className="rounded-xl overflow-hidden border mb-4" style={{ borderColor: "var(--ck-border-subtle)" }}>
                            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--ck-border-subtle)", background: "var(--ck-surface-warm)" }}>
                                <span className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>Windy{location ? ` · ${location.name}` : ""}</span>
                                <div className="flex flex-wrap items-center gap-3">
                                    <button onClick={() => setWindyRefreshKey(k => k + 1)} className="ui-btn ui-btn-ghost min-h-11 min-w-11 !px-3" aria-label="Refresh Windy" title="Refresh Windy" style={{ color: "var(--ck-text-muted)" }}><ArrowsClockwise size={18} aria-hidden="true" /> Refresh</button>
                                    {location && <a href={`https://www.windy.com/${location.lat}/${location.lon}`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold hover:underline" style={{ color: "var(--ck-accent)" }}>Open Windy ↗</a>}
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
                                    <p className="text-sm font-medium" style={{ color: "var(--ck-text-muted)" }}>No location selected</p>
                                </div>
                            )}
                        </div>

                        {editingLocs && (
                            <div className="mt-4 border-t p-4 flex flex-col" style={{ background: "color-mix(in srgb, var(--ck-surface) 95%, transparent)" }}>
                                <div className="flex justify-between items-center mb-4">
                                    <h4 className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>Manage Locations</h4>
                                    <button onClick={() => setEditingLocs(false)} aria-label="Close location manager" className="min-h-11 min-w-11 p-1.5 rounded-md transition-colors hover:bg-[var(--ck-surface-sunken)]" style={{ color: "var(--ck-text-muted)" }}><X size={18} /></button>
                                </div>
                                <div className="flex-1 overflow-y-auto pr-1 mb-4">
                                    <div className="space-y-2">
                                        {groupByProvince(locations).map(([province, locs]) => (
                                            <div key={province}>
                                                <p className="text-[11px] font-semibold uppercase tracking-wider mt-3 mb-1.5 first:mt-0" style={{ color: "var(--ck-text-muted)" }}>{province}</p>
                                                <div className="space-y-2">
                                                    {locs.map(l => (
                                                        <div key={l.id} className="flex items-center justify-between rounded-lg border p-3 text-sm" style={{ borderColor: "var(--ck-border-subtle)", background: "var(--ck-surface)", boxShadow: "var(--ck-shadow-sm)" }}>
                                                            <div>
                                                                <span className="font-semibold text-sm" style={{ color: "var(--ck-text-strong)" }}>{l.name}</span>
                                                                <div className="text-[11px] font-medium mt-0.5 font-mono" style={{ color: "var(--ck-text-muted)" }}>{l.lat}, {l.lon} <span className="ml-2">WG: {l.wgSpot || "None"}</span></div>
                                                            </div>
                                                            <div className="flex items-center gap-3">
                                                                {l.isDefault && <span className="ui-status ui-pill-success">Default</span>}
                                                                <button data-demo-action="weather.remove" onClick={() => void removeLocation(l.id).catch(() => {})} disabled={savingLocations || readOnly} aria-label={`Remove ${l.name}`} className="min-h-11 min-w-11 transition-colors hover:!text-[var(--ck-danger)]" style={{ color: "var(--ck-text-muted)" }}><Trash size={16} /></button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                        {locations.length === 0 && <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>No locations added.</p>}
                                    </div>
                                </div>

                                <form data-demo-submit="weather.add" onSubmit={event => void handleAddLocation(event).catch(() => {})} className="border-t pt-4" style={{ borderColor: "var(--ck-border-subtle)" }}>
                                    <input aria-label="Location name" required value={newLocName} onChange={e => setNewLocName(e.target.value)} onBlur={() => { if (newLocName.trim() && !newLocLat && !newLocLon) handleGeocode(); }} className="ui-control w-full text-sm font-medium mb-2" placeholder="Name (e.g. Cape Town)" />
                                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-2">
                                        <input aria-label="Latitude" required type="number" step="any" value={newLocLat} onChange={e => setNewLocLat(e.target.value)} className="ui-control w-full text-sm font-medium" placeholder="Lat (-33.9)" />
                                        <input aria-label="Longitude" required type="number" step="any" value={newLocLon} onChange={e => setNewLocLon(e.target.value)} className="ui-control w-full text-sm font-medium" placeholder="Lon (18.4)" />
                                        <input aria-label="Windguru spot ID" type="number" step="any" value={newLocWg} onChange={e => setNewLocWg(e.target.value)} className="ui-control w-full lg:col-span-2 text-sm font-medium" placeholder="Windguru Spot ID (optional)" />
                                    </div>
                                    <div className="flex gap-2">
                                        <button type="button" onClick={handleGeocode} disabled={geocoding || !newLocName} className="ui-btn ui-btn-ghost !px-4" aria-label="Look up coordinates" title="Look up coordinates">
                                            <MapPin size={16} />
                                        </button>
                                        <button type="submit" disabled={savingLocations || readOnly} className="ui-btn ui-btn-primary flex-1">
                                            Add Location
                                        </button>
                                    </div>
                                </form>
                            </div>
                        )}
                    </div>
                </div>),
            }} />
        </div >
    );
}
