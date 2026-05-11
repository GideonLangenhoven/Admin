"use client";
import { useState, useEffect, ReactNode } from "react";
import { confirmAction, notify } from "../lib/app-notify";
import { supabase } from "../lib/supabase";
import { sendAdminSetupLink, getAuthHeaders } from "../lib/admin-auth";
import { getAdminTimezone, setAdminTimezone, zonedToUtc } from "../lib/admin-timezone";
import { useBusinessContext } from "../../components/BusinessContext";
import dynamic from "next/dynamic";
import { ChevronDown } from "lucide-react";
import { DatePicker } from "../../components/DatePicker";
import WhatsAppBotSection from "./components/WhatsAppBotSection";

function CollapsibleSection({ id, title, subtitle, children, defaultOpen = false, openSections, toggle }: {
    id: string; title: string; subtitle?: string; children: ReactNode; defaultOpen?: boolean;
    openSections: Record<string, boolean>; toggle: (id: string) => void;
}) {
    const isOpen = openSections[id] ?? defaultOpen;
    return (
        <div className="border border-[var(--ck-border-subtle)] rounded-xl overflow-hidden">
            <button
                type="button"
                onClick={() => toggle(id)}
                className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-[var(--ck-bg-subtle)] transition-colors"
            >
                <div>
                    <h2 className="text-lg font-semibold text-[var(--ck-text-strong)]">{title}</h2>
                    {subtitle && <p className="text-xs text-[var(--ck-text-muted)] mt-0.5">{subtitle}</p>}
                </div>
                <ChevronDown size={20} className={"text-[var(--ck-text-muted)] transition-transform duration-200 " + (isOpen ? "rotate-180" : "")} />
            </button>
            {isOpen && <div className="px-5 pb-5 pt-2 border-t border-[var(--ck-border-subtle)]">{children}</div>}
        </div>
    );
}
const RichTextEditor = dynamic(() => import("../../components/RichTextEditor"), { ssr: false, loading: () => <div className="h-40 bg-gray-100 rounded animate-pulse" /> });
const ExternalBookingSettings = dynamic(() => import("../../components/ExternalBookingSettings"), { ssr: false });
import { fetchUsageSnapshot, type UsageSnapshot } from "../lib/billing";
import InlineSlotManager from "../../components/InlineSlotManager";

// SUPER_ADMIN has every right that MAIN_ADMIN has, plus cross-tenant access.
function isPrivileged(r: string | null) {
    return r === "MAIN_ADMIN" || r === "SUPER_ADMIN";
}

// Settings sections that MAIN_ADMIN can grant to regular admins
const SETTINGS_SECTIONS = [
    { key: "tours", label: "Tours & Activities" },
    { key: "addons", label: "Booking Add-Ons" },
    { key: "resources", label: "Shared Resources" },
    { key: "external", label: "External Booking" },
    { key: "site", label: "Booking Site Config" },
    { key: "email", label: "Email Customisation" },
    { key: "invoice", label: "Invoice Details" },
    { key: "credentials", label: "Integration Credentials" },
] as const;
type SettingsSectionKey = typeof SETTINGS_SECTIONS[number]["key"];

// Default Booking App URLs (separate from Admin Dashboard: https://admin-tawny-delta-92.vercel.app)
const DEFAULT_BOOKING_URL = "";
const DEFAULT_MANAGE_BOOKINGS_URL = "";
const DEFAULT_GIFT_VOUCHER_URL = "";
const DEFAULT_BOOKING_SUCCESS_URL = "";
const DEFAULT_BOOKING_CANCEL_URL = "";
const DEFAULT_VOUCHER_SUCCESS_URL = "";

const DEFAULT_SITE_SETTINGS = {
    directions: "",
    terms_conditions: "",
    privacy_policy: "Cookies help us deliver our services. By using our services, you agree to our use of cookies. OK Kayaks Adventures Privacy Policy\nThank you for visiting our web site...",
    cookies_policy: "COOKIES\nCookies are small text files which are downloaded to your computer...",
    color_main: "#0f5dd7",
    color_secondary: "#101828",
    color_cta: "#0c8a59",
    color_bg: "#f5f5f5",
    color_nav: "#ffffff",
    color_hover: "#48cfad",
    chatbot_avatar: "https://lottie.host/f88dfbd9-9fbb-43af-9ac4-400d4f0b96ae/tc9tMgAjqf.lottie",
    hero_eyebrow: "",
    hero_title: "",
    hero_subtitle: "",
    business_name: "",
    business_tagline: "",
    logo_url: "",
    booking_site_url: DEFAULT_BOOKING_URL,
    manage_bookings_url: DEFAULT_MANAGE_BOOKINGS_URL,
    gift_voucher_url: DEFAULT_GIFT_VOUCHER_URL,
    booking_success_url: DEFAULT_BOOKING_SUCCESS_URL,
    booking_cancel_url: DEFAULT_BOOKING_CANCEL_URL,
    voucher_success_url: DEFAULT_VOUCHER_SUCCESS_URL,
    waiver_url: "",
    nav_gift_voucher_label: "Gift Voucher",
    nav_my_bookings_label: "My Bookings",
    card_cta_label: "Book Now",
    chat_widget_label: "Book here",
    footer_line_one: "",
    footer_line_two: "",
    timezone: "Africa/Johannesburg",
};

interface Tour {
    id: string;
    name: string;
    description: string | null;
    base_price_per_person: number | null;
    duration_minutes: number | null;
    active: boolean;
    sort_order: number | null;
    image_url: string | null;
    hidden: boolean;
}

interface ResourceRecord {
    id: string;
    name: string;
    resource_type: string;
    capacity_total: number;
    active: boolean;
}

interface TourResourceLink {
    id: string;
    tour_id: string;
    resource_id: string;
    units_per_guest: number;
    active: boolean;
    tours?: { id: string; name: string } | null;
    resources?: ResourceRecord | null;
}

interface AddOn {
    id: string;
    business_id: string;
    name: string;
    description: string | null;
    price: number;
    image_url: string | null;
    active: boolean;
    sort_order: number;
}

export default function SettingsPage() {
    const { businessId } = useBusinessContext();
    const [admins, setAdmins] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [role, setRole] = useState<string | null>(null);

    // Collapsible section state
    const [openSections, setOpenSections] = useState<Record<string, boolean>>({ admins: true });
    function toggleSection(id: string) { setOpenSections((prev) => ({ ...prev, [id]: !(prev[id] ?? false) })); }

    // New Admin Form
    const [newName, setNewName] = useState("");
    const [newEmail, setNewEmail] = useState("");
    const [adding, setAdding] = useState(false);
    const [error, setError] = useState("");
    const [adminMessage, setAdminMessage] = useState("");
    const [resendingAdminId, setResendingAdminId] = useState("");
    const [subscriptionStatus, setSubscriptionStatus] = useState("ACTIVE");
    const [togglingSubscription, setTogglingSubscription] = useState(false);

    // Tours state
    const [tours, setTours] = useState<Tour[]>([]);
    const [editingTour, setEditingTour] = useState<Tour | null>(null);
    const [tourForm, setTourForm] = useState({ name: "", description: "", price: "", duration: "", sort_order: "0", active: true, image_url: "", default_capacity: "10", slotStartDate: "", slotEndDate: "", slotTimes: [""] as string[], slotDays: [0, 1, 2, 3, 4, 5, 6] as number[] });
    const [tourSaving, setTourSaving] = useState(false);
    const [tourError, setTourError] = useState("");
    const [slotMessage, setSlotMessage] = useState("");
    const [slotGenerating, setSlotGenerating] = useState(false);
    const [tourSlotCounts, setTourSlotCounts] = useState<Record<string, number>>({});
    const [resources, setResources] = useState<ResourceRecord[]>([]);
    const [tourResourceLinks, setTourResourceLinks] = useState<TourResourceLink[]>([]);
    const [resourceForm, setResourceForm] = useState({ id: "", name: "", resource_type: "GENERAL", capacity_total: "10", active: true });
    const [assignmentForm, setAssignmentForm] = useState({ id: "", tour_id: "", resource_id: "", units_per_guest: "1", active: true });
    const [resourceSaving, setResourceSaving] = useState(false);
    const [assignmentSaving, setAssignmentSaving] = useState(false);
    const [resourceMessage, setResourceMessage] = useState({ type: "", text: "" });

    // Site Settings State
    const [siteSettings, setSiteSettings] = useState(DEFAULT_SITE_SETTINGS);
    const [bookingCustomFieldsJson, setBookingCustomFieldsJson] = useState("[]");
    const [siteSaving, setSiteSaving] = useState(false);
    const [siteMessage, setSiteMessage] = useState({ type: "", text: "" });
    const [chatbotAvatars, setChatbotAvatars] = useState<Array<{ id: string; lottie_url: string; label: string | null }>>([]);
    const [refundTiers, setRefundTiers] = useState<Array<{ hours_before: number; refund_percent: number }>>([]);
    const [refundPolicyText, setRefundPolicyText] = useState("");
    const [refundSaving, setRefundSaving] = useState(false);
    const [refundMessage, setRefundMessage] = useState({ type: "", text: "" });
    const [usageSnapshot, setUsageSnapshot] = useState<UsageSnapshot | null>(null);

    // Email Header Images State
    const [emailImgs, setEmailImgs] = useState({ payment: "", confirm: "", invoice: "", gift: "", cancel: "", cancel_weather: "", indemnity: "", admin: "", voucher: "", photos: "" });
    const [emailImgsSaving, setEmailImgsSaving] = useState(false);
    const [emailImgsMessage, setEmailImgsMessage] = useState({ type: "", text: "" });
    const [emailImgUploading, setEmailImgUploading] = useState<string | null>(null);
    const [emailColor, setEmailColor] = useState("#1b3b36");
    const [socialLinks, setSocialLinks] = useState({ facebook: "", instagram: "", tiktok: "", youtube: "", twitter: "", linkedin: "", tripadvisor: "", google_reviews: "" });

    // Operations & AI config (trapped data from onboarding)
    const [opsConfig, setOpsConfig] = useState({ what_to_bring: "", what_to_wear: "", arrival_instructions: "", ai_system_prompt: "", faq_json: {} as Record<string, string> });
    const [opsSaving, setOpsSaving] = useState(false);
    const [faqEntries, setFaqEntries] = useState<{ q: string; a: string }[]>([]);

    // Automation tag config
    const [autoTagConfig, setAutoTagConfig] = useState({
        vip_bookings: 3, vip_window_days: 90, vip_valid_days: 365, vip_renewal_bookings: 3,
        lapsed_days: 90, new_booker_enabled: true, completed_tour_enabled: true, voucher_expiry_days: 30,
    });
    const [autoTagSaving, setAutoTagSaving] = useState(false);

    // Credentials State
    const [credStatus, setCredStatus] = useState<{ wa: boolean; yoco: boolean; yoco_test_mode: boolean; yoco_test: boolean } | null>(null);
    const [waForm, setWaForm] = useState({ token: "", phoneId: "" });
    const [yocoForm, setYocoForm] = useState({ secretKey: "", webhookSecret: "" });
    const [yocoTestForm, setYocoTestForm] = useState({ secretKey: "", webhookSecret: "" });
    const [waSaving, setWaSaving] = useState(false);
    const [yocoSaving, setYocoSaving] = useState(false);
    const [yocoTestSaving, setYocoTestSaving] = useState(false);
    const [testModeToggling, setTestModeToggling] = useState(false);
    const [gdriveConnected, setGdriveConnected] = useState(false);
    const [gdriveEmail, setGdriveEmail] = useState("");
    const [gdriveLoading, setGdriveLoading] = useState(false);
    const [googlePlaceId, setGooglePlaceId] = useState("");
    const [googlePlaceSaving, setGooglePlaceSaving] = useState(false);
    const [credMessage, setCredMessage] = useState({ type: "", text: "" });

    // Add-ons state
    const [addOns, setAddOns] = useState<AddOn[]>([]);
    const [editingAddOn, setEditingAddOn] = useState<AddOn | null>(null);
    const [addOnForm, setAddOnForm] = useState({ name: "", description: "", price: "", image_url: "", sort_order: "0", active: true });
    const [addOnSaving, setAddOnSaving] = useState(false);
    const [addOnError, setAddOnError] = useState("");
    const [addOnDragIdx, setAddOnDragIdx] = useState<number | null>(null);

    // Invoice & Banking state
    const [invoiceForm, setInvoiceForm] = useState({ company_name: "", address_line1: "", address_line2: "", address_line3: "", reg_number: "", vat_number: "" });
    const [bankForm, setBankForm] = useState({ account_owner: "", account_number: "", account_type: "", bank_name: "", branch_code: "" });
    const [invoiceSaving, setInvoiceSaving] = useState(false);
    const [invoiceMessage, setInvoiceMessage] = useState({ type: "", text: "" });

    // Marketing test email recipient
    const [marketingTestEmail, setMarketingTestEmail] = useState("");
    const [savingTestEmail, setSavingTestEmail] = useState(false);

    // Per-section permissions for the current admin
    const [myPerms, setMyPerms] = useState<Record<string, boolean>>({});
    const [expandedPermsAdmin, setExpandedPermsAdmin] = useState<string | null>(null);
    const [savingPerms, setSavingPerms] = useState<string | null>(null);

    function canAccess(section: string): boolean {
        if (isPrivileged(role)) return true;
        return myPerms[section] === true;
    }

    useEffect(() => {
        const r = localStorage.getItem("ck_admin_role");
        setRole(r);
        if (isPrivileged(r)) {
            fetchAdmins();
            fetchTours();
            fetchResources();
            fetchSiteSettings();
            fetchPlanUsage();
            fetchCredStatus();
            fetchAddOns();
        } else {
            // Regular admin — load their permissions, then fetch data for granted sections
            loadMyPermissions();
        }

        if (!document.getElementById("dotlottie-script")) {
            const script = document.createElement("script");
            script.id = "dotlottie-script";
            script.src = "https://unpkg.com/@lottiefiles/dotlottie-wc@0.9.3/dist/dotlottie-wc.js";
            script.type = "module";
            document.head.appendChild(script);
        }

        fetchChatbotAvatars();
    }, [businessId]);

    async function fetchChatbotAvatars() {
        const { data, error } = await supabase
            .from("chatbot_avatars")
            .select("id, lottie_url, label")
            .eq("active", true)
            .order("sort_order", { ascending: true });
        if (error) {
            console.error("CHATBOT_AVATARS_ERR", error.message);
            return;
        }
        setChatbotAvatars((data || []) as Array<{ id: string; lottie_url: string; label: string | null }>);
    }

    async function loadMyPermissions() {
        const adminEmail = localStorage.getItem("ck_admin_email");
        if (!adminEmail) { setLoading(false); return; }
        const { data } = await supabase
            .from("admin_users")
            .select("settings_permissions")
            .eq("email", adminEmail)
            .eq("business_id", businessId)
            .maybeSingle();
        const perms = (data?.settings_permissions || {}) as Record<string, boolean>;
        setMyPerms(perms);
        const hasAny = Object.values(perms).some(Boolean);
        if (hasAny) {
            if (perms.tours) fetchTours();
            if (perms.addons) fetchAddOns();
            if (perms.resources) fetchResources();
            if (perms.site || perms.email || perms.invoice) fetchSiteSettings();
            if (perms.credentials) { fetchCredStatus(); checkGdriveStatus(); }
        }
        setLoading(false);
    }

    async function fetchAdmins() {
        setLoading(true);
        const { data, error } = await supabase.from("admin_users").select("id, name, email, role, created_at, password_set_at, must_set_password, invite_sent_at, settings_permissions").eq("business_id", businessId).order("created_at");
        if (data) setAdmins(data);
        setLoading(false);
    }

    async function fetchPlanUsage() {
        try {
            const usage = await fetchUsageSnapshot(businessId);
            setUsageSnapshot(usage);
        } catch (e) {
            console.error("Failed to load plan usage:", e);
            setUsageSnapshot(null);
        }
    }

    async function handleAddAdmin(e: React.FormEvent) {
        e.preventDefault();
        if (!newName.trim() || !newEmail.trim()) return setError("Name and email are required.");
        const seatLimit = usageSnapshot?.seat_limit || 10;
        if (admins.length >= seatLimit) return setError("Admin seat limit reached for your current plan (" + seatLimit + "). Upgrade to add more admins.");

        setAdding(true);
        setError("");
        setAdminMessage("");

        const adminEmail = newEmail.trim().toLowerCase();
        const res = await fetch("/api/admin/add", {
            method: "POST",
            headers: await getAuthHeaders(),
            body: JSON.stringify({ name: newName.trim(), email: adminEmail, business_id: businessId }),
        });
        const resData = await res.json().catch(() => ({}));
        if (!res.ok) {
            setAdding(false);
            setError(resData?.error || "Failed to add admin.");
            return;
        }
        const insertedAdmin = resData.admin;
        if (!insertedAdmin) {
            setAdding(false);
            setError("Admin created, but failed to retrieve details for setup link.");
            return;
        }

        try {
            await sendAdminSetupLink(insertedAdmin, "ADMIN_INVITE", businessId);
            setAdminMessage("Admin added. A secure password setup email has been sent.");
        } catch (emailErr: any) {
            console.error("Welcome email failed:", emailErr);
            const emailErrMsg = String(emailErr?.message || "");
            if (emailErrMsg.includes("onboarding@resend.dev") || emailErrMsg.includes("sandbox") || emailErrMsg.includes("Sandbox")) {
                setError("Admin added, but email couldn't be delivered: " + emailErrMsg + " — set a verified EMAIL_FROM domain in the Supabase send-email function secrets.");
            } else {
                setError("Admin added, but the password setup email failed to send." + (emailErrMsg ? " (" + emailErrMsg + ")" : ""));
            }
        }

        setAdding(false);
        setNewName("");
        setNewEmail("");
        fetchAdmins();
        fetchPlanUsage();
    }

    async function handleResendSetup(admin: { id: string; email: string; name?: string | null }) {
        setResendingAdminId(admin.id);
        setError("");
        setAdminMessage("");
        try {
            await sendAdminSetupLink(admin, "RESET", businessId);
            setAdminMessage("A fresh password setup email has been sent to " + admin.email + ".");
            fetchAdmins();
        } catch (resendError: any) {
            console.error("Failed to resend password setup link:", resendError);
            const resendErrMsg = String(resendError?.message || "");
            if (resendErrMsg.includes("onboarding@resend.dev") || resendErrMsg.includes("sandbox") || resendErrMsg.includes("Sandbox")) {
                setError("Setup link was saved, but the email couldn't be delivered: " + resendErrMsg + " — set a verified EMAIL_FROM domain in the Supabase send-email function secrets.");
            } else {
                setError("Failed to send a password setup email to " + admin.email + "." + (resendErrMsg ? " (" + resendErrMsg + ")" : ""));
            }
        }
        setResendingAdminId("");
    }

    function adminPasswordStatus(admin: any) {
        if (admin.must_set_password || !admin.password_set_at) {
            const sentLabel = admin.invite_sent_at ? "Setup email sent " + new Date(admin.invite_sent_at).toLocaleDateString() : "Setup email not sent yet";
            return { label: "Password setup pending", detail: sentLabel, tone: "text-amber-700" };
        }

        return {
            label: "Password created",
            detail: "Created " + new Date(admin.password_set_at).toLocaleDateString(),
            tone: "text-emerald-700",
        };
    }

    async function fetchTours() {
        const { data } = await supabase.from("tours").select("*").eq("business_id", businessId).order("sort_order", { ascending: true });
        setTours((data || []) as Tour[]);
        if (data && data.length > 0) {
            fetchSlotCounts(data.map((t: any) => t.id));
        }
    }

    async function fetchSlotCounts(tourIds: string[]) {
        const now = new Date().toISOString();
        const counts: Record<string, number> = {};
        for (const tid of tourIds) {
            const { count } = await supabase.from("slots").select("id", { count: "exact", head: true }).eq("tour_id", tid).eq("status", "OPEN").gte("start_time", now);
            counts[tid] = count || 0;
        }
        setTourSlotCounts(counts);
    }

    const [dragIdx, setDragIdx] = useState<number | null>(null);

    function resetTourForm() {
        setEditingTour(null);
        setTourForm({ name: "", description: "", price: "", duration: "", sort_order: "0", active: true, image_url: "", default_capacity: "10", slotStartDate: "", slotEndDate: "", slotTimes: [""], slotDays: [0, 1, 2, 3, 4, 5, 6] });
        setTourError("");
    }

    function startEditTour(t: Tour) {
        setEditingTour(t);
        setTourForm({
            name: t.name,
            description: t.description || "",
            price: String(t.base_price_per_person || ""),
            duration: String(t.duration_minutes || ""),
            sort_order: String(t.sort_order || 0),
            active: t.active,
            image_url: t.image_url || "",
            default_capacity: String((t as any).default_capacity || 10),
            slotStartDate: "",
            slotEndDate: "",
            slotTimes: [""],
            slotDays: [0, 1, 2, 3, 4, 5, 6],
        });
        setTourError("");
    }

    const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    function toggleDay(day: number) {
        setTourForm(prev => {
            const days = prev.slotDays.includes(day) ? prev.slotDays.filter(d => d !== day) : [...prev.slotDays, day];
            return { ...prev, slotDays: days };
        });
    }

    async function generateSlotsForTour(tourId: string): Promise<{ created: number; skipped: number }> {
        const validTimes = tourForm.slotTimes.filter(t => t.trim() !== "");
        if (!tourForm.slotStartDate || !tourForm.slotEndDate || validTimes.length === 0) {
            setTourError("Please fill in start date, end date, and at least one start time.");
            return { created: 0, skipped: 0 };
        }
        if (tourForm.slotDays.length === 0) {
            setTourError("Please select at least one day of the week.");
            return { created: 0, skipped: 0 };
        }

        const slots: any[] = [];
        const tz = getAdminTimezone();
        const [startYear, startMonth, startDay] = tourForm.slotStartDate.split("-").map(Number);
        const [endYear, endMonth, endDay] = tourForm.slotEndDate.split("-").map(Number);
        const capacity = Number(tourForm.default_capacity) || 10;

        const cursor = new Date(startYear, startMonth - 1, startDay);
        const stop = new Date(endYear, endMonth - 1, endDay);

        for (let d = new Date(cursor); d <= stop; d.setDate(d.getDate() + 1)) {
            if (!tourForm.slotDays.includes(d.getDay())) continue;

            const localDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

            for (let ti = 0; ti < validTimes.length; ti++) {
                const localIso = `${localDateStr}T${validTimes[ti]}:00`;
                const utcStart = new Date(zonedToUtc(localIso, tz)).toISOString();

                slots.push({
                    business_id: businessId,
                    tour_id: tourId,
                    start_time: utcStart,
                    capacity_total: capacity,
                    booked: 0,
                    held: 0,
                    status: "OPEN",
                });
            }
        }

        if (slots.length === 0) {
            setTourError("No slots to create — no matching days in the selected date range.");
            return { created: 0, skipped: 0 };
        }

        const { data: inserted, error: slotErr } = await supabase
            .from("slots")
            .upsert(slots, { onConflict: "business_id,tour_id,start_time", ignoreDuplicates: true })
            .select("id");
        if (slotErr) {
            setTourError("Slots failed: " + slotErr.message);
            return { created: 0, skipped: 0 };
        }
        const created = inserted?.length ?? 0;
        return { created, skipped: slots.length - created };
    }

    async function handleGenerateSlots() {
        if (!editingTour) return;
        setSlotGenerating(true);
        setTourError("");
        setSlotMessage("");
        const { created, skipped } = await generateSlotsForTour(editingTour.id);
        if (created > 0 || skipped > 0) {
            const parts: string[] = [];
            if (created > 0) parts.push(`${created} slot${created !== 1 ? "s" : ""} generated`);
            if (skipped > 0) parts.push(`${skipped} already existed and were skipped`);
            setSlotMessage(parts.join(" — ") + " for " + editingTour.name + ".");
            setTimeout(() => setSlotMessage(""), 6000);
            if (created > 0) fetchSlotCounts(tours.map(t => t.id));
        }
        setSlotGenerating(false);
    }

    async function handleSaveTour(e: React.FormEvent) {
        e.preventDefault();
        if (!tourForm.name.trim()) return setTourError("Name is required");
        if (!tourForm.price || Number(tourForm.price) <= 0) return setTourError("Price must be greater than 0");
        if (!tourForm.duration || Number(tourForm.duration) <= 0) return setTourError("Duration is required");

        setTourSaving(true);
        setTourError("");

        const payload = {
            name: tourForm.name.trim(),
            description: tourForm.description.trim() || null,
            base_price_per_person: Number(tourForm.price),
            duration_minutes: Number(tourForm.duration),
            sort_order: Number(tourForm.sort_order) || 0,
            active: tourForm.active,
            image_url: tourForm.image_url.trim() || null,
            default_capacity: Number(tourForm.default_capacity) || 10,
        };

        if (editingTour) {
            const { error: upErr } = await supabase.from("tours").update(payload).eq("id", editingTour.id);
            if (upErr) { setTourError("Failed: " + upErr.message); setTourSaving(false); return; }
        } else {
            const { data: newTour, error: inErr } = await supabase.from("tours").insert({ ...payload, business_id: businessId }).select().single();
            if (inErr) { setTourError("Failed: " + inErr.message); setTourSaving(false); return; }

            // Auto-generate slots if date range and time are provided
            if (newTour && tourForm.slotStartDate && tourForm.slotEndDate && tourForm.slotTimes.some(t => t.trim() !== "")) {
                const { created, skipped } = await generateSlotsForTour(newTour.id);
                if (created > 0 || skipped > 0) {
                    const parts: string[] = [];
                    if (created > 0) parts.push(`${created} slot${created !== 1 ? "s" : ""} generated`);
                    if (skipped > 0) parts.push(`${skipped} already existed`);
                    setSlotMessage("Tour created — " + parts.join(", ") + ".");
                    setTimeout(() => setSlotMessage(""), 6000);
                }
            }
        }

        setTourSaving(false);
        resetTourForm();
        fetchTours();
    }

    async function handleDeleteTour(id: string, name: string) {
        // Check for active unredeemed vouchers linked to this tour
        const { count: activeVoucherCount } = await supabase
            .from("vouchers")
            .select("id", { count: "exact", head: true })
            .eq("business_id", businessId)
            .eq("tour_name", name)
            .eq("status", "ACTIVE");

        if ((activeVoucherCount || 0) > 0) {
            notify({
                title: "Cannot delete tour",
                message: activeVoucherCount + " active voucher(s) are linked to \"" + name + "\". Deactivate the tour instead, or wait until vouchers are redeemed/expired.",
                tone: "warning",
            });
            return;
        }

        if (!await confirmAction({
            title: "Delete tour",
            message: "Delete \"" + name + "\"? This will also remove all associated slots, waitlist entries, and combo offers. This cannot be undone.",
            tone: "warning",
            confirmLabel: "Delete tour",
        })) return;

        const { error: delErr } = await supabase.from("tours").delete().eq("id", id);
        if (delErr) {
            notify({ title: "Delete failed", message: delErr.message, tone: "error" });
            return;
        }
        notify({ title: "Deleted", message: "\"" + name + "\" has been removed.", tone: "success" });
        if (editingTour?.id === id) resetTourForm();
        fetchTours();
    }

    async function handleSaveAdminPerms(adminId: string, perms: Record<string, boolean>) {
        setSavingPerms(adminId);
        const res = await fetch("/api/admin/update", {
            method: "POST",
            headers: await getAuthHeaders(),
            body: JSON.stringify({ action: "update_permissions", admin_id: adminId, permissions: perms }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            notify({ title: "Failed to save permissions", message: data?.error || "Unknown error", tone: "error" });
        } else {
            setAdmins(admins.map(a => a.id === adminId ? { ...a, settings_permissions: perms } : a));
            notify({ title: "Permissions saved", message: "Settings access updated", tone: "success" });
        }
        setSavingPerms(null);
    }

    async function handleSaveMarketingTestEmail(email: string) {
        setSavingTestEmail(true);
        const { error: updateErr } = await supabase
            .from("businesses")
            .update({ marketing_test_email: email || null })
            .eq("id", businessId);
        if (updateErr) {
            notify({ title: "Failed", message: updateErr.message, tone: "error" });
        } else {
            setMarketingTestEmail(email);
            notify({ title: "Saved", message: email ? "Test emails will be sent to " + email : "Marketing test email cleared", tone: "success" });
        }
        setSavingTestEmail(false);
    }

    async function handleToggleTour(t: Tour) {
        await supabase.from("tours").update({ active: !t.active }).eq("id", t.id);
        fetchTours();
    }

    async function handleToggleHidden(t: Tour) {
        await supabase.from("tours").update({ hidden: !t.hidden }).eq("id", t.id);
        fetchTours();
    }

    async function handleDrop(targetIdx: number) {
        if (dragIdx === null || dragIdx === targetIdx) { setDragIdx(null); return; }
        const reordered = [...tours];
        const [moved] = reordered.splice(dragIdx, 1);
        reordered.splice(targetIdx, 0, moved);
        setTours(reordered);
        setDragIdx(null);
        for (let i = 0; i < reordered.length; i++) {
            await supabase.from("tours").update({ sort_order: i }).eq("id", reordered[i].id);
        }
    }

    async function handleDelete(id: string, adminRole: string) {
        if (adminRole === "MAIN_ADMIN" || adminRole === "SUPER_ADMIN") {
            notify({ title: "Action blocked", message: "Cannot delete a Main Admin or Super Admin account.", tone: "warning" });
            return;
        }
        if (!await confirmAction({
            title: "Remove admin",
            message: "Are you sure you want to remove this admin?",
            tone: "warning",
            confirmLabel: "Remove admin",
        })) return;

        const res = await fetch("/api/admin/remove", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
            body: JSON.stringify({ admin_id: id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            notify({ title: "Failed", message: data?.error || "Could not remove admin.", tone: "error" });
            return;
        }
        notify({ title: "Removed", message: "Admin has been removed.", tone: "success" });
        fetchAdmins();
        fetchPlanUsage();
    }

    async function fetchSiteSettings() {
        const { data } = await supabase.from("businesses").select("*").eq("id", businessId).maybeSingle();
        if (data) {
            setSiteSettings({
                directions: data.directions || DEFAULT_SITE_SETTINGS.directions,
                terms_conditions: data.terms_conditions || DEFAULT_SITE_SETTINGS.terms_conditions,
                privacy_policy: data.privacy_policy || DEFAULT_SITE_SETTINGS.privacy_policy,
                cookies_policy: data.cookies_policy || DEFAULT_SITE_SETTINGS.cookies_policy,
                color_main: data.color_main || DEFAULT_SITE_SETTINGS.color_main,
                color_secondary: data.color_secondary || DEFAULT_SITE_SETTINGS.color_secondary,
                color_cta: data.color_cta || DEFAULT_SITE_SETTINGS.color_cta,
                color_bg: data.color_bg || DEFAULT_SITE_SETTINGS.color_bg,
                color_nav: data.color_nav || DEFAULT_SITE_SETTINGS.color_nav,
                color_hover: data.color_hover || DEFAULT_SITE_SETTINGS.color_hover,
                chatbot_avatar: data.chatbot_avatar || DEFAULT_SITE_SETTINGS.chatbot_avatar,
                hero_eyebrow: data.hero_eyebrow || DEFAULT_SITE_SETTINGS.hero_eyebrow,
                hero_title: data.hero_title || DEFAULT_SITE_SETTINGS.hero_title,
                hero_subtitle: data.hero_subtitle || DEFAULT_SITE_SETTINGS.hero_subtitle,
                business_name: data.business_name || DEFAULT_SITE_SETTINGS.business_name,
                business_tagline: data.business_tagline || DEFAULT_SITE_SETTINGS.business_tagline,
                logo_url: data.logo_url || DEFAULT_SITE_SETTINGS.logo_url,
                booking_site_url: data.booking_site_url || DEFAULT_SITE_SETTINGS.booking_site_url,
                manage_bookings_url: data.manage_bookings_url || DEFAULT_SITE_SETTINGS.manage_bookings_url,
                gift_voucher_url: data.gift_voucher_url || DEFAULT_SITE_SETTINGS.gift_voucher_url,
                booking_success_url: data.booking_success_url || DEFAULT_SITE_SETTINGS.booking_success_url,
                booking_cancel_url: data.booking_cancel_url || DEFAULT_SITE_SETTINGS.booking_cancel_url,
                voucher_success_url: data.voucher_success_url || DEFAULT_SITE_SETTINGS.voucher_success_url,
                waiver_url: data.waiver_url || DEFAULT_SITE_SETTINGS.waiver_url,
                nav_gift_voucher_label: data.nav_gift_voucher_label || DEFAULT_SITE_SETTINGS.nav_gift_voucher_label,
                nav_my_bookings_label: data.nav_my_bookings_label || DEFAULT_SITE_SETTINGS.nav_my_bookings_label,
                card_cta_label: data.card_cta_label || DEFAULT_SITE_SETTINGS.card_cta_label,
                chat_widget_label: data.chat_widget_label || DEFAULT_SITE_SETTINGS.chat_widget_label,
                footer_line_one: data.footer_line_one || DEFAULT_SITE_SETTINGS.footer_line_one,
                footer_line_two: data.footer_line_two || DEFAULT_SITE_SETTINGS.footer_line_two,
                timezone: data.timezone || DEFAULT_SITE_SETTINGS.timezone,
            });
            setBookingCustomFieldsJson(JSON.stringify(Array.isArray(data.booking_custom_fields) ? data.booking_custom_fields : [], null, 2));
            setRefundTiers(Array.isArray(data.refund_policy_tiers) ? data.refund_policy_tiers : []);
            setRefundPolicyText(data.refund_policy_text || "");
            setEmailImgs({
                payment: data.email_img_payment || "",
                confirm: data.email_img_confirm || "",
                invoice: data.email_img_invoice || "",
                gift: data.email_img_gift || "",
                cancel: data.email_img_cancel || "",
                cancel_weather: data.email_img_cancel_weather || "",
                indemnity: data.email_img_indemnity || "",
                admin: data.email_img_admin || "",
                voucher: data.email_img_voucher || "",
                photos: data.email_img_photos || "",
            });
            setGooglePlaceId(data.google_place_id || "");
            setEmailColor(data.email_color || "#1b3b36");
            setSocialLinks({
                facebook: data.social_facebook || "",
                instagram: data.social_instagram || "",
                tiktok: data.social_tiktok || "",
                youtube: data.social_youtube || "",
                twitter: data.social_twitter || "",
                linkedin: data.social_linkedin || "",
                tripadvisor: data.social_tripadvisor || "",
                google_reviews: data.social_google_reviews || "",
            });
            setSubscriptionStatus(data.subscription_status || "ACTIVE");
            setMarketingTestEmail(data.marketing_test_email || "");
            setInvoiceForm({
                company_name: data.invoice_company_name || "",
                address_line1: data.invoice_address_line1 || "",
                address_line2: data.invoice_address_line2 || "",
                address_line3: data.invoice_address_line3 || "",
                reg_number: data.invoice_reg_number || "",
                vat_number: data.invoice_vat_number || "",
            });
            // Bank details fetched separately via encrypted edge function
            supabase.functions.invoke("bank-details", {
                body: { action: "get", business_id: businessId },
            }).then(({ data: bankData }) => {
                if (bankData) {
                    setBankForm({
                        account_owner: bankData.account_owner || "",
                        account_number: bankData.account_number || "",
                        account_type: bankData.account_type || "",
                        bank_name: bankData.bank_name || "",
                        branch_code: bankData.branch_code || "",
                    });
                }
            });
            // Load operations & AI config
            setOpsConfig({
                what_to_bring: data.what_to_bring || "",
                what_to_wear: data.what_to_wear || "",
                arrival_instructions: data.arrival_instructions || "",
                ai_system_prompt: data.ai_system_prompt || "",
                faq_json: data.faq_json || {},
            });
            const faqObj = data.faq_json || {};
            setFaqEntries(Object.entries(faqObj).map(([q, a]) => ({ q, a: String(a) })));
            // Load automation config
            const ac = data.automation_config || {};
            setAutoTagConfig({
                vip_bookings: ac.vip_bookings ?? 3,
                vip_window_days: ac.vip_window_days ?? 90,
                vip_valid_days: ac.vip_valid_days ?? 365,
                vip_renewal_bookings: ac.vip_renewal_bookings ?? 3,
                lapsed_days: ac.lapsed_days ?? 90,
                new_booker_enabled: ac.new_booker_enabled ?? true,
                completed_tour_enabled: ac.completed_tour_enabled ?? true,
                voucher_expiry_days: ac.voucher_expiry_days ?? 30,
            });
        }
    }

    async function toggleSubscription() {
        const next = subscriptionStatus === "SUSPENDED" ? "ACTIVE" : "SUSPENDED";
        const action = next === "SUSPENDED" ? "suspend" : "reactivate";
        if (!await confirmAction({
            title: next === "SUSPENDED" ? "Suspend subscription" : "Reactivate subscription",
            message: next === "SUSPENDED"
                ? "This will block all admins from accessing the dashboard. Are you sure?"
                : "This will restore dashboard access for all admins.",
            tone: next === "SUSPENDED" ? "warning" : "info",
            confirmLabel: next === "SUSPENDED" ? "Suspend" : "Reactivate",
        })) return;
        setTogglingSubscription(true);
        const { error: err } = await supabase.from("businesses").update({ subscription_status: next }).eq("id", businessId);
        if (err) {
            notify({ title: "Failed", message: "Could not " + action + " subscription: " + err.message, tone: "error" });
        } else {
            setSubscriptionStatus(next);
            notify({ title: next === "SUSPENDED" ? "Suspended" : "Reactivated", message: "Subscription is now " + next + ".", tone: "success" });
        }
        setTogglingSubscription(false);
    }

    function resetResourceForm() {
        setResourceForm({ id: "", name: "", resource_type: "GENERAL", capacity_total: "10", active: true });
    }

    function resetAssignmentForm() {
        setAssignmentForm({ id: "", tour_id: "", resource_id: "", units_per_guest: "1", active: true });
    }

    async function fetchResources() {
        try {
            const [resourcesRes, linksRes] = await Promise.all([
                supabase.from("resources").select("id, name, resource_type, capacity_total, active").eq("business_id", businessId).order("active", { ascending: false }).order("name"),
                supabase.from("tour_resources").select("id, tour_id, resource_id, units_per_guest, active, tours(id, name), resources(id, name, resource_type, capacity_total, active)").eq("business_id", businessId).order("created_at", { ascending: true }),
            ]);

            if (resourcesRes.error) throw resourcesRes.error;
            if (linksRes.error) throw linksRes.error;

            setResources((resourcesRes.data || []) as ResourceRecord[]);
            setTourResourceLinks(((linksRes.data || []) as any[]).map((row) => ({
                ...row,
                tours: Array.isArray(row.tours) ? row.tours[0] : row.tours,
                resources: Array.isArray(row.resources) ? row.resources[0] : row.resources,
            })));
        } catch (fetchError: any) {
            console.error("Failed to load resources:", fetchError);
            setResourceMessage({ type: "error", text: "Failed to load shared resources: " + String(fetchError?.message || fetchError) });
        }
    }

    async function handleSaveResource(e: React.FormEvent) {
        e.preventDefault();
        if (!resourceForm.name.trim()) {
            setResourceMessage({ type: "error", text: "Resource name is required." });
            return;
        }
        if (!resourceForm.capacity_total || Number(resourceForm.capacity_total) <= 0) {
            setResourceMessage({ type: "error", text: "Resource capacity must be greater than 0." });
            return;
        }

        setResourceSaving(true);
        setResourceMessage({ type: "", text: "" });

        const payload = {
            business_id: businessId,
            name: resourceForm.name.trim(),
            resource_type: resourceForm.resource_type.trim() || "GENERAL",
            capacity_total: Number(resourceForm.capacity_total),
            active: resourceForm.active,
        };

        const query = resourceForm.id
            ? supabase.from("resources").update(payload).eq("id", resourceForm.id)
            : supabase.from("resources").insert(payload);

        const { error: saveError } = await query;
        if (saveError) {
            setResourceMessage({ type: "error", text: "Failed to save resource: " + saveError.message });
        } else {
            setResourceMessage({ type: "success", text: resourceForm.id ? "Resource updated." : "Resource created." });
            resetResourceForm();
            fetchResources();
        }
        setResourceSaving(false);
    }

    async function handleDeleteResource(resource: ResourceRecord) {
        if (!await confirmAction({
            title: "Delete resource",
            message: "Delete \"" + resource.name + "\"? Any tour mappings to this resource will also be removed.",
            tone: "warning",
            confirmLabel: "Delete resource",
        })) return;

        const { error: deleteError } = await supabase.from("resources").delete().eq("id", resource.id);
        if (deleteError) {
            setResourceMessage({ type: "error", text: "Failed to delete resource: " + deleteError.message });
            return;
        }
        if (resourceForm.id === resource.id) resetResourceForm();
        setResourceMessage({ type: "success", text: "Resource deleted." });
        fetchResources();
    }

    async function handleSaveAssignment(e: React.FormEvent) {
        e.preventDefault();
        if (!assignmentForm.tour_id || !assignmentForm.resource_id) {
            setResourceMessage({ type: "error", text: "Choose both a tour and a resource before saving the mapping." });
            return;
        }
        if (!assignmentForm.units_per_guest || Number(assignmentForm.units_per_guest) <= 0) {
            setResourceMessage({ type: "error", text: "Units per guest must be greater than 0." });
            return;
        }

        setAssignmentSaving(true);
        setResourceMessage({ type: "", text: "" });

        const payload = {
            business_id: businessId,
            tour_id: assignmentForm.tour_id,
            resource_id: assignmentForm.resource_id,
            units_per_guest: Number(assignmentForm.units_per_guest),
            active: assignmentForm.active,
        };

        const query = assignmentForm.id
            ? supabase.from("tour_resources").update(payload).eq("id", assignmentForm.id)
            : supabase.from("tour_resources").upsert(payload, { onConflict: "tour_id,resource_id" });

        const { error: saveError } = await query;
        if (saveError) {
            setResourceMessage({ type: "error", text: "Failed to save resource mapping: " + saveError.message });
        } else {
            setResourceMessage({ type: "success", text: assignmentForm.id ? "Tour mapping updated." : "Tour mapping saved." });
            resetAssignmentForm();
            fetchResources();
        }
        setAssignmentSaving(false);
    }

    async function handleDeleteAssignment(link: TourResourceLink) {
        if (!await confirmAction({
            title: "Remove resource mapping",
            message: "Remove the mapping between " + (link.tours?.name || "this tour") + " and " + (link.resources?.name || "this resource") + "?",
            tone: "warning",
            confirmLabel: "Remove mapping",
        })) return;

        const { error: deleteError } = await supabase.from("tour_resources").delete().eq("id", link.id);
        if (deleteError) {
            setResourceMessage({ type: "error", text: "Failed to remove mapping: " + deleteError.message });
            return;
        }
        if (assignmentForm.id === link.id) resetAssignmentForm();
        setResourceMessage({ type: "success", text: "Resource mapping removed." });
        fetchResources();
    }

    async function handleSaveSiteSettings(e: React.FormEvent) {
        e.preventDefault();
        setSiteSaving(true);
        setSiteMessage({ type: "", text: "" });

        let parsedBookingFields: any[] = [];
        try {
            parsedBookingFields = JSON.parse(bookingCustomFieldsJson || "[]");
            if (!Array.isArray(parsedBookingFields)) throw new Error("Custom booking fields must be a JSON array.");
        } catch (parseError: any) {
            setSiteMessage({ type: "error", text: "Custom booking fields JSON is invalid: " + String(parseError?.message || parseError) });
            setSiteSaving(false);
            return;
        }

        // Get the single business row that exists
        const { data: biz } = await supabase.from("businesses").select("id").eq("id", businessId).maybeSingle();
        if (!biz) {
            setSiteMessage({ type: "error", text: "No business record found to update." });
            setSiteSaving(false);
            return;
        }

        const { error } = await supabase.from("businesses").update({
            directions: siteSettings.directions,
            terms_conditions: siteSettings.terms_conditions,
            privacy_policy: siteSettings.privacy_policy,
            cookies_policy: siteSettings.cookies_policy,
            color_main: siteSettings.color_main,
            color_secondary: siteSettings.color_secondary,
            color_cta: siteSettings.color_cta,
            color_bg: siteSettings.color_bg,
            color_nav: siteSettings.color_nav,
            color_hover: siteSettings.color_hover,
            chatbot_avatar: siteSettings.chatbot_avatar,
            hero_eyebrow: siteSettings.hero_eyebrow || null,
            hero_title: siteSettings.hero_title || null,
            hero_subtitle: siteSettings.hero_subtitle || null,
            business_name: siteSettings.business_name || null,
            business_tagline: siteSettings.business_tagline || null,
            logo_url: siteSettings.logo_url || null,
            booking_site_url: siteSettings.booking_site_url || null,
            manage_bookings_url: siteSettings.manage_bookings_url || null,
            gift_voucher_url: siteSettings.gift_voucher_url || null,
            booking_success_url: siteSettings.booking_success_url || null,
            booking_cancel_url: siteSettings.booking_cancel_url || null,
            voucher_success_url: siteSettings.voucher_success_url || null,
            waiver_url: siteSettings.waiver_url || null,
            nav_gift_voucher_label: siteSettings.nav_gift_voucher_label || null,
            nav_my_bookings_label: siteSettings.nav_my_bookings_label || null,
            card_cta_label: siteSettings.card_cta_label || null,
            chat_widget_label: siteSettings.chat_widget_label || null,
            footer_line_one: siteSettings.footer_line_one || null,
            footer_line_two: siteSettings.footer_line_two || null,
            timezone: siteSettings.timezone || DEFAULT_SITE_SETTINGS.timezone,
            booking_custom_fields: parsedBookingFields,
        }).eq("id", biz.id);

        if (error) {
            setSiteMessage({ type: "error", text: "Error saving: " + error.message });
        } else {
            setAdminTimezone(siteSettings.timezone || DEFAULT_SITE_SETTINGS.timezone);
            setSiteMessage({ type: "success", text: "Site settings saved successfully!" });
            setTimeout(() => setSiteMessage({ type: "", text: "" }), 3000);
        }
        setSiteSaving(false);
    }

    async function handleSaveRefundPolicy() {
        setRefundSaving(true);
        setRefundMessage({ type: "", text: "" });
        const sorted = [...refundTiers].sort((a, b) => b.hours_before - a.hours_before);
        const valid = sorted.every(t => t.hours_before >= 0 && t.refund_percent >= 0 && t.refund_percent <= 100);
        if (!valid) {
            setRefundMessage({ type: "error", text: "Hours must be ≥ 0 and percent must be 0–100." });
            setRefundSaving(false);
            return;
        }
        const { error } = await supabase.from("businesses").update({
            refund_policy_tiers: sorted,
            refund_policy_text: refundPolicyText.trim(),
        }).eq("id", businessId);
        if (error) {
            setRefundMessage({ type: "error", text: error.message });
        } else {
            setRefundTiers(sorted);
            setRefundMessage({ type: "success", text: "Cancellation policy saved!" });
            setTimeout(() => setRefundMessage({ type: "", text: "" }), 3000);
        }
        setRefundSaving(false);
    }

    async function handleSaveInvoice(e: React.FormEvent) {
        e.preventDefault();
        setInvoiceSaving(true);
        setInvoiceMessage({ type: "", text: "" });

        const updatePayload: Record<string, string | null> = {
            invoice_company_name: invoiceForm.company_name || null,
            invoice_address_line1: invoiceForm.address_line1 || null,
            invoice_address_line2: invoiceForm.address_line2 || null,
            invoice_address_line3: invoiceForm.address_line3 || null,
            invoice_reg_number: invoiceForm.reg_number || null,
            invoice_vat_number: invoiceForm.vat_number || null,
        };

        const { error: invErr } = await supabase.from("businesses").update(updatePayload).eq("id", businessId);
        if (invErr) {
            setInvoiceMessage({ type: "error", text: "Error saving invoice: " + invErr.message });
            setInvoiceSaving(false);
            return;
        }

        const { data: bankData, error: bankErr } = await supabase.functions.invoke("bank-details", {
            body: {
                action: "set",
                business_id: businessId,
                account_owner: bankForm.account_owner || null,
                account_number: bankForm.account_number || null,
                account_type: bankForm.account_type || null,
                bank_name: bankForm.bank_name || null,
                branch_code: bankForm.branch_code || null,
            },
        });
        if (bankErr || !bankData?.success) {
            setInvoiceMessage({ type: "error", text: "Bank details failed: " + (bankErr?.message || bankData?.error || "Unknown error") });
            setInvoiceSaving(false);
            return;
        }

        setInvoiceMessage({ type: "success", text: "Invoice & banking details saved!" });
        setTimeout(() => setInvoiceMessage({ type: "", text: "" }), 3000);
        setInvoiceSaving(false);
    }


    async function fetchCredStatus() {
        try {
            const headers = await getAuthHeaders();
            const res = await fetch("/api/credentials?business_id=" + businessId, { headers });
            if (res.ok) setCredStatus(await res.json());
        } catch (e) {
            console.error("Failed to load credential status:", e);
        }
    }

    async function handleSaveWa(e: React.FormEvent) {
        e.preventDefault();
        setWaSaving(true);
        setCredMessage({ type: "", text: "" });
        try {
            const res = await fetch("/api/credentials", {
                method: "POST",
                headers: await getAuthHeaders(),
                body: JSON.stringify({ business_id: businessId, section: "wa", wa_token: waForm.token, wa_phone_id: waForm.phoneId }),
            });
            const d = await res.json();
            if (!res.ok || d.error) throw new Error(d.error || "Save failed");
            setCredMessage({ type: "success", text: "WhatsApp credentials saved and encrypted successfully." });
            setWaForm({ token: "", phoneId: "" });
            fetchCredStatus();
        } catch (err: any) {
            setCredMessage({ type: "error", text: String(err?.message || "Failed to save WhatsApp credentials.") });
        }
        setWaSaving(false);
    }

    async function handleSaveYoco(e: React.FormEvent) {
        e.preventDefault();
        setYocoSaving(true);
        setCredMessage({ type: "", text: "" });
        try {
            const res = await fetch("/api/credentials", {
                method: "POST",
                headers: await getAuthHeaders(),
                body: JSON.stringify({ business_id: businessId, section: "yoco", yoco_secret_key: yocoForm.secretKey, yoco_webhook_secret: yocoForm.webhookSecret }),
            });
            const d = await res.json();
            if (!res.ok || d.error) throw new Error(d.error || "Save failed");
            setCredMessage({ type: "success", text: "Yoco credentials saved and encrypted successfully." });
            setYocoForm({ secretKey: "", webhookSecret: "" });
            fetchCredStatus();
        } catch (err: any) {
            setCredMessage({ type: "error", text: String(err?.message || "Failed to save Yoco credentials.") });
        }
        setYocoSaving(false);
    }

    async function handleToggleTestMode() {
        setTestModeToggling(true);
        setCredMessage({ type: "", text: "" });
        const newMode = !(credStatus?.yoco_test_mode);
        try {
            const res = await fetch("/api/credentials", {
                method: "POST",
                headers: await getAuthHeaders(),
                body: JSON.stringify({ business_id: businessId, section: "yoco_test_mode", yoco_test_mode: newMode }),
            });
            const d = await res.json();
            if (!res.ok || d.error) throw new Error(d.error || "Toggle failed");
            setCredMessage({ type: "success", text: newMode ? "Yoco TEST MODE enabled — sandbox keys will be used for payments." : "Yoco TEST MODE disabled — live keys are active." });
            fetchCredStatus();
            window.location.reload();
        } catch (err: any) {
            setCredMessage({ type: "error", text: String(err?.message || "Failed to toggle test mode.") });
        }
        setTestModeToggling(false);
    }

    async function handleSaveYocoTest(e: React.FormEvent) {
        e.preventDefault();
        setYocoTestSaving(true);
        setCredMessage({ type: "", text: "" });
        try {
            const res = await fetch("/api/credentials", {
                method: "POST",
                headers: await getAuthHeaders(),
                body: JSON.stringify({ business_id: businessId, section: "yoco_test", yoco_test_secret_key: yocoTestForm.secretKey, yoco_test_webhook_secret: yocoTestForm.webhookSecret }),
            });
            const d = await res.json();
            if (!res.ok || d.error) throw new Error(d.error || "Save failed");
            setCredMessage({ type: "success", text: "Yoco test credentials saved and encrypted successfully." });
            setYocoTestForm({ secretKey: "", webhookSecret: "" });
            fetchCredStatus();
        } catch (err: any) {
            setCredMessage({ type: "error", text: String(err?.message || "Failed to save Yoco test credentials.") });
        }
        setYocoTestSaving(false);
    }

    async function checkGdriveStatus() {
        try {
            const { data } = await supabase.functions.invoke("google-drive", {
                body: { action: "status", business_id: businessId },
            });
            if (data && !data.error) {
                setGdriveConnected(data.connected);
                setGdriveEmail(data.email || "");
            }
        } catch (_) { /* ignore */ }
    }

    async function handleConnectGdrive() {
        setGdriveLoading(true);
        try {
            const { data, error } = await supabase.functions.invoke("google-drive", {
                body: {
                    action: "auth_url",
                    business_id: businessId,
                    redirect_uri: window.location.origin + "/google-callback",
                    return_to: "/settings",
                },
            });
            if (error || data?.error) {
                notify({ title: "Google Drive", message: data?.error || error?.message || "Failed to start connection.", tone: "error" });
            } else if (data?.url) {
                window.location.href = data.url;
            }
        } catch (err: any) {
            notify({ title: "Google Drive", message: err.message || "Connection failed.", tone: "error" });
        }
        setGdriveLoading(false);
    }

    async function handleDisconnectGdrive() {
        const ok = await confirmAction("Disconnect Google Drive? Photo uploads will stop working until you reconnect.");
        if (!ok) return;
        setGdriveLoading(true);
        try {
            const { data, error } = await supabase.functions.invoke("google-drive", {
                body: { action: "disconnect", business_id: businessId },
            });
            if (error || data?.error) {
                notify({ title: "Google Drive", message: data?.error || error?.message || "Disconnect failed.", tone: "error" });
            } else {
                setGdriveConnected(false);
                setGdriveEmail("");
                notify({ title: "Google Drive", message: "Disconnected successfully. Token revoked at Google.", tone: "success" });
            }
        } catch (err: any) {
            notify({ title: "Google Drive", message: err.message || "Disconnect failed.", tone: "error" });
        }
        setGdriveLoading(false);
    }

    const [uploadingField, setUploadingField] = useState<string | null>(null);

    async function handleImageUpload(file: File, bucket: string, folder: string, onUrl: (url: string) => void) {
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        if (!["jpg", "jpeg", "png", "webp", "gif", "svg"].includes(ext)) {
            notify({ title: "Invalid file", message: "Please upload an image file (jpg, png, webp, gif, svg).", tone: "warning" });
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            notify({ title: "File too large", message: "Image must be under 5 MB.", tone: "warning" });
            return;
        }
        const path = folder + "/" + Date.now() + "." + ext;
        const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
        if (error) { notify({ title: "Upload failed", message: error.message, tone: "error" }); return; }
        const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
        onUrl(urlData.publicUrl);
    }

    // ── Add-Ons CRUD ──
    async function fetchAddOns() {
        const { data } = await supabase.from("add_ons").select("*").eq("business_id", businessId).order("sort_order", { ascending: true });
        setAddOns((data || []) as AddOn[]);
    }

    function resetAddOnForm() {
        setEditingAddOn(null);
        setAddOnForm({ name: "", description: "", price: "", image_url: "", sort_order: "0", active: true });
        setAddOnError("");
    }

    function startEditAddOn(a: AddOn) {
        setEditingAddOn(a);
        setAddOnForm({
            name: a.name,
            description: a.description || "",
            price: String(a.price || ""),
            image_url: a.image_url || "",
            sort_order: String(a.sort_order || 0),
            active: a.active,
        });
        setAddOnError("");
    }

    async function handleSaveAddOn(e: React.FormEvent) {
        e.preventDefault();
        if (!addOnForm.name.trim()) return setAddOnError("Name is required");
        if (!addOnForm.price || Number(addOnForm.price) < 0) return setAddOnError("Price must be 0 or greater");

        setAddOnSaving(true);
        setAddOnError("");

        const payload = {
            name: addOnForm.name.trim(),
            description: addOnForm.description.trim() || null,
            price: Number(addOnForm.price),
            image_url: addOnForm.image_url.trim() || null,
            sort_order: Number(addOnForm.sort_order) || 0,
            active: addOnForm.active,
        };

        if (editingAddOn) {
            const { error: upErr } = await supabase.from("add_ons").update(payload).eq("id", editingAddOn.id);
            if (upErr) { setAddOnError("Failed: " + upErr.message); setAddOnSaving(false); return; }
        } else {
            const { error: inErr } = await supabase.from("add_ons").insert({ ...payload, business_id: businessId });
            if (inErr) { setAddOnError("Failed: " + inErr.message); setAddOnSaving(false); return; }
        }

        setAddOnSaving(false);
        resetAddOnForm();
        fetchAddOns();
    }

    async function handleDeleteAddOn(id: string, name: string) {
        if (!await confirmAction({
            title: "Delete add-on",
            message: "Delete \"" + name + "\"? This cannot be undone.",
            tone: "warning",
            confirmLabel: "Delete add-on",
        })) return;

        const { error: delErr } = await supabase.from("add_ons").delete().eq("id", id);
        if (delErr) {
            notify({ title: "Delete failed", message: delErr.message, tone: "error" });
            return;
        }
        notify({ title: "Deleted", message: "\"" + name + "\" has been removed.", tone: "success" });
        if (editingAddOn?.id === id) resetAddOnForm();
        fetchAddOns();
    }

    async function handleToggleAddOn(a: AddOn) {
        await supabase.from("add_ons").update({ active: !a.active }).eq("id", a.id);
        fetchAddOns();
    }

    async function handleAddOnDrop(targetIdx: number) {
        if (addOnDragIdx === null || addOnDragIdx === targetIdx) { setAddOnDragIdx(null); return; }
        const reordered = [...addOns];
        const [moved] = reordered.splice(addOnDragIdx, 1);
        reordered.splice(targetIdx, 0, moved);
        setAddOns(reordered);
        setAddOnDragIdx(null);
        for (let i = 0; i < reordered.length; i++) {
            await supabase.from("add_ons").update({ sort_order: i }).eq("id", reordered[i].id);
        }
    }

    async function handleUploadEmailImage(key: string, file: File) {
        setEmailImgUploading(key);
        try {
            const ext = file.name.split(".").pop() || "jpg";
            const path = `${businessId}/${key}.${ext}`;
            const { error } = await supabase.storage.from("email-images").upload(path, file, { upsert: true });
            if (error) { notify("Upload failed: " + error.message); return; }
            const { data: urlData } = supabase.storage.from("email-images").getPublicUrl(path);
            setEmailImgs(prev => ({ ...prev, [key]: urlData.publicUrl }));
            notify("Image uploaded — click Save Email Images to persist.");
        } catch (err: any) {
            notify("Upload failed: " + (err?.message || "Unknown error"));
        } finally {
            setEmailImgUploading(null);
        }
    }

    async function handleSaveEmailImages(e: React.FormEvent) {
        e.preventDefault();
        setEmailImgsSaving(true);
        setEmailImgsMessage({ type: "", text: "" });
        const { error } = await supabase.from("businesses").update({
            email_color: emailColor,
            email_img_payment: emailImgs.payment || null,
            email_img_confirm: emailImgs.confirm || null,
            email_img_invoice: emailImgs.invoice || null,
            email_img_gift: emailImgs.gift || null,
            email_img_cancel: emailImgs.cancel || null,
            email_img_cancel_weather: emailImgs.cancel_weather || null,
            email_img_indemnity: emailImgs.indemnity || null,
            email_img_admin: emailImgs.admin || null,
            email_img_voucher: emailImgs.voucher || null,
            email_img_photos: emailImgs.photos || null,
            social_facebook: socialLinks.facebook || null,
            social_instagram: socialLinks.instagram || null,
            social_tiktok: socialLinks.tiktok || null,
            social_youtube: socialLinks.youtube || null,
            social_twitter: socialLinks.twitter || null,
            social_linkedin: socialLinks.linkedin || null,
            social_tripadvisor: socialLinks.tripadvisor || null,
            social_google_reviews: socialLinks.google_reviews || null,
        }).eq("id", businessId);
        if (error) {
            setEmailImgsMessage({ type: "error", text: "Error saving: " + error.message });
        } else {
            setEmailImgsMessage({ type: "success", text: "Email images saved." });
            setTimeout(() => setEmailImgsMessage({ type: "", text: "" }), 3000);
        }
        setEmailImgsSaving(false);
    }

    if (loading) return <div className="p-8 ui-text-muted">Loading settings...</div>;

    const hasAnyPerm = Object.values(myPerms).some(Boolean);
    if (!isPrivileged(role) && !hasAnyPerm) {
        return (
            <div className="max-w-2xl">
                <h1 className="text-2xl font-bold tracking-tight text-[var(--ck-text-strong)] mb-6">Settings</h1>
                <div className="ui-surface rounded-2xl p-6 border border-[var(--ck-border-subtle)] text-center">
                    <p className="ui-text-muted">You do not have permission to view or manage admin settings.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-4xl">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--ck-text-strong)] mb-6">Settings</h1>

            <div className="space-y-4">

            {isPrivileged(role) && <CollapsibleSection id="admins" title="Admin Users" openSections={openSections} toggle={toggleSection} defaultOpen>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                    <div className="flex items-center justify-between mb-4">
                        <span className="text-xs font-medium px-2 py-1 rounded-full bg-[var(--ck-bg-subtle)] text-[var(--ck-text-muted)]">
                            {admins.length} / {usageSnapshot?.seat_limit || 10} seats
                        </span>
                    </div>

                    <div className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] overflow-hidden">
                        <div className="divide-y divide-[var(--ck-border-subtle)]">
                            {admins.map(a => {
                                const status = adminPasswordStatus(a);
                                const perms = (a.settings_permissions || {}) as Record<string, boolean>;
                                const grantedCount = SETTINGS_SECTIONS.filter(s => perms[s.key]).length;
                                const isExpanded = expandedPermsAdmin === a.id;
                                return (
                                    <div key={a.id}>
                                        <div className="p-4 flex items-center justify-between">
                                            <div>
                                                <div className="font-medium text-[var(--ck-text-strong)] text-sm">{a.name || a.email}</div>
                                                <div className="text-xs text-[var(--ck-text-muted)] mt-0.5">{a.email}</div>
                                                <div className="text-xs text-[var(--ck-text-muted)] mt-0.5">
                                                    {a.role === "MAIN_ADMIN" ? "Main Admin" : "Admin"} • Added {new Date(a.created_at).toLocaleDateString()}
                                                </div>
                                                <div className={"text-xs mt-0.5 " + status.tone}>
                                                    {status.label} • {status.detail}
                                                </div>
                                                {a.role !== "MAIN_ADMIN" && a.role !== "SUPER_ADMIN" && (
                                                    <div className="text-xs text-[var(--ck-text-muted)] mt-1">
                                                        Settings: {grantedCount > 0 ? `${grantedCount} section${grantedCount !== 1 ? "s" : ""} granted` : "No access"}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3 shrink-0">
                                                {a.role !== "MAIN_ADMIN" && a.role !== "SUPER_ADMIN" && (
                                                    <button
                                                        onClick={() => setExpandedPermsAdmin(isExpanded ? null : a.id)}
                                                        className="text-[var(--ck-accent)] text-sm font-medium hover:underline whitespace-nowrap"
                                                    >
                                                        {isExpanded ? "Close" : "Permissions"}
                                                    </button>
                                                )}
                                                {a.role !== "MAIN_ADMIN" && (
                                                    <button
                                                        onClick={() => handleResendSetup(a)}
                                                        disabled={resendingAdminId === a.id}
                                                        className="text-[var(--ck-accent)] text-sm font-medium hover:underline disabled:opacity-50 whitespace-nowrap"
                                                    >
                                                        {resendingAdminId === a.id ? "Sending..." : ((a.must_set_password || !a.password_set_at) ? "Resend setup link" : "Email reset link")}
                                                    </button>
                                                )}
                                                {a.role !== "MAIN_ADMIN" && (
                                                    <button onClick={() => handleDelete(a.id, a.role)} className="text-[var(--ck-danger)] text-sm font-medium hover:underline whitespace-nowrap">
                                                        Remove
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        {/* Expandable permissions panel */}
                                        {isExpanded && a.role !== "MAIN_ADMIN" && a.role !== "SUPER_ADMIN" && (
                                            <div className="px-4 pb-4 pt-1 bg-[var(--ck-bg-subtle)] border-t border-[var(--ck-border-subtle)]">
                                                <p className="text-xs font-semibold text-[var(--ck-text-strong)] mb-3">Settings page access for {a.name || a.email}</p>
                                                <div className="grid grid-cols-2 gap-2">
                                                    {SETTINGS_SECTIONS.map(section => (
                                                        <label key={section.key} className="flex items-center gap-2 cursor-pointer select-none rounded-lg px-3 py-2 hover:bg-[var(--ck-surface)] transition-colors">
                                                            <input
                                                                type="checkbox"
                                                                checked={perms[section.key] === true}
                                                                onChange={() => {
                                                                    const newPerms = { ...perms, [section.key]: !perms[section.key] };
                                                                    // Optimistic update
                                                                    setAdmins(admins.map(x => x.id === a.id ? { ...x, settings_permissions: newPerms } : x));
                                                                    handleSaveAdminPerms(a.id, newPerms);
                                                                }}
                                                                disabled={savingPerms === a.id}
                                                                className="h-4 w-4 rounded border-gray-300 accent-[var(--ck-accent)]"
                                                            />
                                                            <span className="text-xs text-[var(--ck-text)]">{section.label}</span>
                                                        </label>
                                                    ))}
                                                </div>
                                                <p className="text-[10px] text-[var(--ck-text-muted)] mt-3 leading-relaxed">
                                                    Banking details and Admin Users management are always restricted to the Main Admin only.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {admins.length === 0 && <div className="p-4 text-center text-sm ui-text-muted">No admins found</div>}
                        </div>
                    </div>
                </div>

                {/* Add Admin Form + Subscription */}
                <div className="space-y-6">
                    <div className="flex items-center justify-between gap-4">
                        <h2 className="text-lg font-semibold text-[var(--ck-text-strong)]">Add New Admin</h2>
                        <button
                            onClick={toggleSubscription}
                            disabled={togglingSubscription}
                            className={"text-xs font-medium px-3 py-1.5 rounded-lg border disabled:opacity-50 whitespace-nowrap " +
                                (subscriptionStatus === "SUSPENDED"
                                    ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                                    : "border-red-300 text-red-700 hover:bg-red-50")}
                        >
                            {togglingSubscription ? "..." : (subscriptionStatus === "SUSPENDED" ? "Reactivate" : "Suspend")}
                        </button>
                    </div>
                    <form onSubmit={handleAddAdmin} className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5 space-y-4">
                        {admins.length >= (usageSnapshot?.seat_limit || 10) ? (
                            <div className="p-3 rounded-xl bg-orange-50 border border-orange-200 text-orange-800 text-sm">
                                You have reached the admin seat limit for your plan ({usageSnapshot?.seat_limit || 10}).
                            </div>
                        ) : (
                            <>
                                <div>
                                    <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Admin Name</label>
                                    <input type="text" required value={newName} onChange={e => setNewName(e.target.value)}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="e.g. Sarah Jacobs" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Email Address</label>
                                    <input type="email" required value={newEmail} onChange={e => setNewEmail(e.target.value)}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="admin@example.com" />
                                </div>
                                <div>
                                    <div className="rounded-xl border border-[var(--ck-border-subtle)] bg-[var(--ck-bg)] p-3 text-xs text-[var(--ck-text-muted)]">
                                        The new admin will receive a confirmation email with a secure link to create their password.
                                    </div>
                                </div>
                                {error && <div className="text-xs text-[var(--ck-danger)] font-medium">{error}</div>}
                                {adminMessage && <div className="text-xs text-[var(--ck-success)] font-medium">{adminMessage}</div>}
                                <button type="submit" disabled={adding} className="w-full rounded-xl bg-[var(--ck-text-strong)] py-2.5 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:opacity-90 disabled:opacity-50">
                                    {adding ? "Adding..." : "Add Admin and Send Setup Link"}
                                </button>
                            </>
                        )}
                    </form>
                </div>
                </div>

                {/* Marketing test email recipient */}
                <div className="mt-6 pt-5 border-t border-[var(--ck-border-subtle)]">
                    <h3 className="text-sm font-semibold text-[var(--ck-text-strong)] mb-1">Marketing Test Email Recipient</h3>
                    <p className="text-xs text-[var(--ck-text-muted)] mb-3">Choose which admin receives test marketing emails when previewing templates.</p>
                    <div className="flex items-end gap-3">
                        <select
                            value={marketingTestEmail}
                            onChange={(e) => handleSaveMarketingTestEmail(e.target.value)}
                            disabled={savingTestEmail}
                            className="flex-1 rounded-lg border border-[var(--ck-border-subtle)] bg-[var(--ck-surface)] px-3 py-2 text-sm text-[var(--ck-text)] disabled:opacity-50"
                        >
                            <option value="">Select an admin...</option>
                            {admins.map(a => (
                                <option key={a.id} value={a.email}>{a.name || a.email} ({a.email})</option>
                            ))}
                        </select>
                        {marketingTestEmail && (
                            <span className="shrink-0 text-xs text-[var(--ck-success)] font-medium px-2 py-2">
                                Active
                            </span>
                        )}
                    </div>
                </div>
            </CollapsibleSection>}

            {canAccess("tours") && <CollapsibleSection id="tours" title="Tours & Activities" openSections={openSections} toggle={toggleSection}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

                    {/* Tour List */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-medium text-[var(--ck-text-muted)]">{tours.length} tour{tours.length !== 1 ? "s" : ""}</span>
                            <button onClick={resetTourForm} className="text-xs font-medium text-[var(--ck-accent)] hover:underline">+ New Tour</button>
                        </div>
                        <div className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] overflow-hidden">
                            <div className="divide-y divide-[var(--ck-border-subtle)]">
                                {tours.map((t, idx) => (
                                    <div key={t.id}
                                        draggable
                                        onDragStart={() => setDragIdx(idx)}
                                        onDragOver={(e) => e.preventDefault()}
                                        onDrop={() => handleDrop(idx)}
                                        className={"p-4 cursor-pointer transition-colors " + (dragIdx === idx ? "opacity-40 " : "") + (editingTour?.id === t.id ? "bg-blue-50" : "hover:bg-[var(--ck-bg)]")}
                                        onClick={() => startEditTour(t)}>
                                        <div className="flex gap-3">
                                            <div className="flex items-center shrink-0 cursor-grab active:cursor-grabbing text-[var(--ck-text-muted)] hover:text-[var(--ck-text-strong)]" title="Drag to reorder">
                                                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="3" r="1.5" /><circle cx="11" cy="3" r="1.5" /><circle cx="5" cy="8" r="1.5" /><circle cx="11" cy="8" r="1.5" /><circle cx="5" cy="13" r="1.5" /><circle cx="11" cy="13" r="1.5" /></svg>
                                            </div>
                                            {t.image_url && (
                                                <img src={t.image_url} alt={t.name} className="w-14 h-14 rounded-lg object-cover shrink-0" />
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="font-medium text-sm text-[var(--ck-text-strong)]">{t.name}</span>
                                                    <div className="flex items-center gap-1.5">
                                                        {t.hidden && (
                                                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Hidden</span>
                                                        )}
                                                        <span className={"text-xs font-medium px-2 py-0.5 rounded-full " + (t.active ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500")}>
                                                            {t.active ? "Active" : "Inactive"}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="text-xs text-[var(--ck-text-muted)]">
                                                    R{t.base_price_per_person || 0}/person · {t.duration_minutes || "—"} min · <span className={tourSlotCounts[t.id] ? "text-emerald-600" : "text-orange-500"}>{tourSlotCounts[t.id] ?? "…"} upcoming slot{tourSlotCounts[t.id] !== 1 ? "s" : ""}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 mt-2">
                                            <button onClick={(e) => { e.stopPropagation(); handleToggleTour(t); }}
                                                className={"text-xs font-medium hover:underline " + (t.active ? "text-orange-600" : "text-emerald-600")}>
                                                {t.active ? "Deactivate" : "Activate"}
                                            </button>
                                            <button onClick={(e) => { e.stopPropagation(); handleToggleHidden(t); }}
                                                className={"text-xs font-medium hover:underline " + (t.hidden ? "text-[var(--ck-accent)]" : "text-amber-600")}>
                                                {t.hidden ? "Show" : "Hide"}
                                            </button>
                                            <button onClick={(e) => { e.stopPropagation(); handleDeleteTour(t.id, t.name); }}
                                                className="text-xs font-medium text-[var(--ck-danger)] hover:underline">Delete</button>
                                            <a href={siteSettings.booking_site_url || DEFAULT_BOOKING_URL} target="_blank" rel="noopener noreferrer"
                                                onClick={(e) => e.stopPropagation()}
                                                className="text-xs font-medium text-[var(--ck-accent)] hover:underline ml-auto">Book Page &rarr;</a>
                                        </div>
                                    </div>
                                ))}
                                {tours.length === 0 && <div className="p-4 text-center text-sm ui-text-muted">No tours yet. Add your first activity.</div>}
                            </div>
                        </div>
                    </div>

                    {/* Add / Edit Tour Form */}
                    <div>
                        <h3 className="text-sm font-semibold text-[var(--ck-text-strong)] mb-3">
                            {editingTour ? "Edit Tour" : "Add New Tour"}
                        </h3>
                        <form onSubmit={handleSaveTour} className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5 space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Tour Name</label>
                                <input type="text" required value={tourForm.name} onChange={e => setTourForm({ ...tourForm, name: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="e.g. Sunset Paddle" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Description</label>
                                <textarea required value={tourForm.description} onChange={e => setTourForm({ ...tourForm, description: e.target.value })}
                                    rows={3} className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none resize-none"
                                    placeholder="Describe this activity..." />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-strong)] mb-1">Tour Image</label>
                                <div className="flex items-center gap-3">
                                    {tourForm.image_url && (
                                        <img src={tourForm.image_url} alt="Preview" className="w-16 h-16 object-cover rounded-lg border border-[var(--ck-border-subtle)] shrink-0" />
                                    )}
                                    <div className="flex-1">
                                        <label className={"inline-flex items-center gap-2 cursor-pointer rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-xs font-medium text-[var(--ck-text-strong)] hover:bg-[var(--ck-bg-subtle)] transition-colors" + (uploadingField === "tour_image" ? " opacity-50 pointer-events-none" : "")}>
                                            {uploadingField === "tour_image" ? "Uploading..." : (tourForm.image_url ? "Change image" : "Upload image")}
                                            <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;
                                                setUploadingField("tour_image");
                                                await handleImageUpload(file, "email-images", businessId + "/tours", (url) => setTourForm(prev => ({ ...prev, image_url: url })));
                                                setUploadingField(null);
                                                e.target.value = "";
                                            }} />
                                        </label>
                                        {tourForm.image_url && (
                                            <button type="button" onClick={() => setTourForm({ ...tourForm, image_url: "" })} className="ml-2 text-xs text-[var(--ck-danger)] hover:underline">Remove</button>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Price per Person (R)</label>
                                    <input type="number" required min="1" step="1" value={tourForm.price}
                                        onChange={e => setTourForm({ ...tourForm, price: e.target.value })}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="600" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Duration (minutes)</label>
                                    <input type="number" required min="1" step="1" value={tourForm.duration}
                                        onChange={e => setTourForm({ ...tourForm, duration: e.target.value })}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="90" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Default Capacity</label>
                                    <input type="number" min="1" step="1" value={tourForm.default_capacity}
                                        onChange={e => setTourForm({ ...tourForm, default_capacity: e.target.value })}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="10" />
                                    <p className="text-xs text-[var(--ck-text-muted)] mt-1">Max people per slot</p>
                                </div>
                                <div className="flex items-end pb-1">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input type="checkbox" checked={tourForm.active} onChange={e => setTourForm({ ...tourForm, active: e.target.checked })}
                                            className="w-4 h-4 rounded border-gray-300 text-[var(--ck-accent)] focus:ring-[var(--ck-accent)]" />
                                        <span className="text-sm text-[var(--ck-text-strong)]">Active</span>
                                    </label>
                                </div>
                            </div>

                            {/* Slot Generation */}
                            <div className="border-t border-[var(--ck-border-subtle)] pt-4">
                                <label className="block text-xs font-semibold text-[var(--ck-text-strong)] mb-1">
                                    {editingTour ? "Generate Slots" : "Auto-generate Slots (optional)"}
                                </label>
                                <p className="text-xs text-[var(--ck-text-muted)] mb-3">Creates one slot per selected day in the date range.</p>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Start Date</label>
                                        <DatePicker
                                            value={tourForm.slotStartDate}
                                            onChange={(v) => setTourForm({ ...tourForm, slotStartDate: v })}
                                            placeholder="Select start"
                                            disabled={{ before: new Date() }}
                                            compact
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">End Date</label>
                                        <DatePicker
                                            value={tourForm.slotEndDate}
                                            onChange={(v) => setTourForm({ ...tourForm, slotEndDate: v })}
                                            placeholder="Select end"
                                            disabled={tourForm.slotStartDate ? { before: new Date(tourForm.slotStartDate + "T00:00:00") } : { before: new Date() }}
                                            compact
                                            alignRight
                                        />
                                    </div>
                                </div>
                                <div className="mt-3">
                                    <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Start Time{tourForm.slotTimes.length > 1 ? "s" : ""} (SAST)</label>
                                    <div className="space-y-2">
                                        {tourForm.slotTimes.map((t, idx) => (
                                            <div key={idx} className="flex gap-2 items-center">
                                                <input type="time" value={t} onChange={e => { const times = [...tourForm.slotTimes]; times[idx] = e.target.value; setTourForm({ ...tourForm, slotTimes: times }); }}
                                                    className="ui-control flex-1 px-3 py-2 text-sm rounded-lg outline-none" />
                                                {tourForm.slotTimes.length > 1 && (
                                                    <button type="button" onClick={() => { const times = tourForm.slotTimes.filter((_, i) => i !== idx); setTourForm({ ...tourForm, slotTimes: times }); }}
                                                        className="text-[var(--ck-danger)] hover:bg-red-50 rounded-lg p-1.5" title="Remove time">
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    <button type="button" onClick={() => setTourForm({ ...tourForm, slotTimes: [...tourForm.slotTimes, ""] })}
                                        className="mt-1.5 text-xs font-medium text-[var(--ck-accent)] hover:underline">+ Add another time slot</button>
                                </div>
                                <div className="mt-3">
                                    <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Days of the Week</label>
                                    <div className="flex flex-wrap gap-1.5 mt-1">
                                        {DAY_LABELS.map((label, idx) => (
                                            <button key={idx} type="button" onClick={() => toggleDay(idx)}
                                                className={"px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors " + (tourForm.slotDays.includes(idx) ? "bg-[var(--ck-text-strong)] text-[var(--ck-surface)] border-[var(--ck-text-strong)]" : "bg-white text-[var(--ck-text-muted)] border-[var(--ck-border-subtle)] hover:border-[var(--ck-text-muted)]")}>
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="flex gap-2 mt-1.5">
                                        <button type="button" onClick={() => setTourForm(prev => ({ ...prev, slotDays: [0, 1, 2, 3, 4, 5, 6] }))} className="text-[10px] text-[var(--ck-accent)] hover:underline">All</button>
                                        <button type="button" onClick={() => setTourForm(prev => ({ ...prev, slotDays: [1, 2, 3, 4, 5] }))} className="text-[10px] text-[var(--ck-accent)] hover:underline">Weekdays</button>
                                        <button type="button" onClick={() => setTourForm(prev => ({ ...prev, slotDays: [0, 6] }))} className="text-[10px] text-[var(--ck-accent)] hover:underline">Weekends</button>
                                        <button type="button" onClick={() => setTourForm(prev => ({ ...prev, slotDays: [] }))} className="text-[10px] text-[var(--ck-text-muted)] hover:underline">None</button>
                                    </div>
                                </div>
                                {editingTour && (
                                    <button type="button" onClick={handleGenerateSlots} disabled={slotGenerating || !tourForm.slotStartDate || !tourForm.slotEndDate || !tourForm.slotTimes.some(t => t.trim() !== "") || tourForm.slotDays.length === 0}
                                        className="mt-3 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                                        {slotGenerating ? "Generating..." : "Generate Slots for " + editingTour.name}
                                    </button>
                                )}
                            </div>

                            {tourError && <div className="text-xs text-[var(--ck-danger)] font-medium">{tourError}</div>}
                            {slotMessage && <div className="text-xs text-[var(--ck-success)] font-medium">{slotMessage}</div>}

                            <div className="flex gap-3">
                                <button type="submit" disabled={tourSaving}
                                    className="flex-1 rounded-xl bg-[var(--ck-text-strong)] py-2.5 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:opacity-90 disabled:opacity-50">
                                    {tourSaving ? "Saving..." : editingTour ? "Update Tour" : "Add Tour"}
                                </button>
                                {editingTour && (
                                    <button type="button" onClick={resetTourForm}
                                        className="px-4 rounded-xl border border-[var(--ck-border-subtle)] text-sm font-medium text-[var(--ck-text-muted)] hover:bg-[var(--ck-bg)]">
                                        Cancel
                                    </button>
                                )}
                            </div>
                        </form>
                        
                        {editingTour && (
                            <InlineSlotManager tourId={editingTour.id} businessId={businessId} />
                        )}
                    </div>

                </div>
            </CollapsibleSection>}

            {canAccess("addons") && <CollapsibleSection id="addons" title="Booking Add-Ons" subtitle="Optional extras customers can add when booking (e.g. photos, equipment rental)" openSections={openSections} toggle={toggleSection}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

                    {/* Add-On List */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-medium text-[var(--ck-text-muted)]">{addOns.length} add-on{addOns.length !== 1 ? "s" : ""}</span>
                            <button onClick={resetAddOnForm} className="text-xs font-medium text-[var(--ck-accent)] hover:underline">+ New Add-On</button>
                        </div>
                        <div className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] overflow-hidden">
                            <div className="divide-y divide-[var(--ck-border-subtle)]">
                                {addOns.map((a, idx) => (
                                    <div key={a.id}
                                        draggable
                                        onDragStart={() => setAddOnDragIdx(idx)}
                                        onDragOver={(e) => e.preventDefault()}
                                        onDrop={() => handleAddOnDrop(idx)}
                                        className={"p-4 cursor-pointer transition-colors " + (addOnDragIdx === idx ? "opacity-40 " : "") + (editingAddOn?.id === a.id ? "bg-blue-50" : "hover:bg-[var(--ck-bg)]")}
                                        onClick={() => startEditAddOn(a)}>
                                        <div className="flex gap-3">
                                            <div className="flex items-center shrink-0 cursor-grab active:cursor-grabbing text-[var(--ck-text-muted)] hover:text-[var(--ck-text-strong)]" title="Drag to reorder">
                                                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="3" r="1.5" /><circle cx="11" cy="3" r="1.5" /><circle cx="5" cy="8" r="1.5" /><circle cx="11" cy="8" r="1.5" /><circle cx="5" cy="13" r="1.5" /><circle cx="11" cy="13" r="1.5" /></svg>
                                            </div>
                                            {a.image_url && (
                                                <img src={a.image_url} alt={a.name} className="w-14 h-14 rounded-lg object-cover shrink-0" />
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="font-medium text-sm text-[var(--ck-text-strong)]">{a.name}</span>
                                                    <span className={"text-xs font-medium px-2 py-0.5 rounded-full " + (a.active ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500")}>
                                                        {a.active ? "Active" : "Inactive"}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-[var(--ck-text-muted)]">
                                                    R{a.price}/item{a.description ? " \u00b7 " + a.description : ""}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 mt-2">
                                            <button onClick={(e) => { e.stopPropagation(); handleToggleAddOn(a); }}
                                                className={"text-xs font-medium hover:underline " + (a.active ? "text-orange-600" : "text-emerald-600")}>
                                                {a.active ? "Deactivate" : "Activate"}
                                            </button>
                                            <button onClick={(e) => { e.stopPropagation(); handleDeleteAddOn(a.id, a.name); }}
                                                className="text-xs font-medium text-[var(--ck-danger)] hover:underline">Delete</button>
                                        </div>
                                    </div>
                                ))}
                                {addOns.length === 0 && <div className="p-4 text-center text-sm ui-text-muted">No add-ons yet. Create your first optional extra.</div>}
                            </div>
                        </div>
                    </div>

                    {/* Add / Edit Add-On Form */}
                    <div>
                        <h3 className="text-sm font-semibold text-[var(--ck-text-strong)] mb-3">
                            {editingAddOn ? "Edit Add-On" : "Add New Add-On"}
                        </h3>
                        <form onSubmit={handleSaveAddOn} className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5 space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Name</label>
                                <input type="text" required value={addOnForm.name} onChange={e => setAddOnForm({ ...addOnForm, name: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="e.g. GoPro Photos" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Description (optional)</label>
                                <input type="text" value={addOnForm.description} onChange={e => setAddOnForm({ ...addOnForm, description: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="Short description shown to customer" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-strong)] mb-1">Image (optional)</label>
                                <div className="flex items-center gap-3">
                                    {addOnForm.image_url && (
                                        <img src={addOnForm.image_url} alt="Preview" className="w-16 h-16 object-cover rounded-lg border border-[var(--ck-border-subtle)] shrink-0" />
                                    )}
                                    <div className="flex-1">
                                        <label className={"inline-flex items-center gap-2 cursor-pointer rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-xs font-medium text-[var(--ck-text-strong)] hover:bg-[var(--ck-bg-subtle)] transition-colors" + (uploadingField === "addon_image" ? " opacity-50 pointer-events-none" : "")}>
                                            {uploadingField === "addon_image" ? "Uploading..." : (addOnForm.image_url ? "Change image" : "Upload image")}
                                            <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;
                                                setUploadingField("addon_image");
                                                await handleImageUpload(file, "email-images", businessId + "/addons", (url) => setAddOnForm(prev => ({ ...prev, image_url: url })));
                                                setUploadingField(null);
                                                e.target.value = "";
                                            }} />
                                        </label>
                                        {addOnForm.image_url && (
                                            <button type="button" onClick={() => setAddOnForm({ ...addOnForm, image_url: "" })} className="ml-2 text-xs text-[var(--ck-danger)] hover:underline">Remove</button>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Price (R)</label>
                                    <input type="number" required min="0" step="0.01" value={addOnForm.price}
                                        onChange={e => setAddOnForm({ ...addOnForm, price: e.target.value })}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="150" />
                                </div>
                                <div className="flex items-end pb-1">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input type="checkbox" checked={addOnForm.active} onChange={e => setAddOnForm({ ...addOnForm, active: e.target.checked })}
                                            className="w-4 h-4 rounded border-gray-300 text-[var(--ck-accent)] focus:ring-[var(--ck-accent)]" />
                                        <span className="text-sm text-[var(--ck-text-strong)]">Active</span>
                                    </label>
                                </div>
                            </div>

                            {addOnError && <div className="text-xs text-[var(--ck-danger)] font-medium">{addOnError}</div>}

                            <div className="flex gap-3">
                                <button type="submit" disabled={addOnSaving}
                                    className="flex-1 rounded-xl bg-[var(--ck-text-strong)] py-2.5 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:opacity-90 disabled:opacity-50">
                                    {addOnSaving ? "Saving..." : editingAddOn ? "Update Add-On" : "Add Add-On"}
                                </button>
                                {editingAddOn && (
                                    <button type="button" onClick={resetAddOnForm}
                                        className="px-4 rounded-xl border border-[var(--ck-border-subtle)] text-sm font-medium text-[var(--ck-text-muted)] hover:bg-[var(--ck-bg)]">
                                        Cancel
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>

                </div>
            </CollapsibleSection>}

            {canAccess("resources") && <CollapsibleSection id="resources" title="Shared Resources & Capacity Pools" subtitle="Assets like vans, guides, kayaks that reduce availability across tours" openSections={openSections} toggle={toggleSection}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-medium text-[var(--ck-text-muted)]">{resources.length} resource{resources.length !== 1 ? "s" : ""}</span>
                            <button type="button" onClick={resetResourceForm} className="text-xs font-medium text-[var(--ck-accent)] hover:underline">+ New Resource</button>
                        </div>
                        <div className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] overflow-hidden">
                            <div className="divide-y divide-[var(--ck-border-subtle)]">
                                {resources.map((resource) => (
                                    <div key={resource.id} className={"p-4 " + (resourceForm.id === resource.id ? "bg-blue-50" : "")}>
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium text-sm text-[var(--ck-text-strong)]">{resource.name}</span>
                                                    <span className={"text-[10px] font-semibold px-2 py-0.5 rounded-full " + (resource.active ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500")}>
                                                        {resource.active ? "Active" : "Inactive"}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-[var(--ck-text-muted)] mt-1">{resource.resource_type} · Total pool {resource.capacity_total}</div>
                                            </div>
                                            <div className="flex items-center gap-3 shrink-0">
                                                <button type="button" onClick={() => setResourceForm({ id: resource.id, name: resource.name, resource_type: resource.resource_type, capacity_total: String(resource.capacity_total), active: resource.active })} className="text-xs font-medium text-[var(--ck-accent)] hover:underline">Edit</button>
                                                <button type="button" onClick={() => handleDeleteResource(resource)} className="text-xs font-medium text-[var(--ck-danger)] hover:underline">Delete</button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {resources.length === 0 && <div className="p-4 text-center text-sm ui-text-muted">No shared resources yet.</div>}
                            </div>
                        </div>

                        <form onSubmit={handleSaveResource} className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5 space-y-4 mt-4">
                            <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">{resourceForm.id ? "Edit Resource" : "Add Resource"}</h3>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Resource Name</label>
                                <input type="text" value={resourceForm.name} onChange={e => setResourceForm({ ...resourceForm, name: e.target.value })} className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="e.g. Safari Van 1" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Resource Type</label>
                                    <input type="text" value={resourceForm.resource_type} onChange={e => setResourceForm({ ...resourceForm, resource_type: e.target.value })} className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="VAN / GUIDE / BIKE" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Total Capacity</label>
                                    <input type="number" min="1" value={resourceForm.capacity_total} onChange={e => setResourceForm({ ...resourceForm, capacity_total: e.target.value })} className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" />
                                </div>
                            </div>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" checked={resourceForm.active} onChange={e => setResourceForm({ ...resourceForm, active: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-[var(--ck-accent)] focus:ring-[var(--ck-accent)]" />
                                <span className="text-sm text-[var(--ck-text-strong)]">Resource is active</span>
                            </label>
                            <div className="flex gap-3">
                                <button type="submit" disabled={resourceSaving} className="flex-1 rounded-xl bg-[var(--ck-text-strong)] py-2.5 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:opacity-90 disabled:opacity-50">
                                    {resourceSaving ? "Saving..." : resourceForm.id ? "Update Resource" : "Add Resource"}
                                </button>
                                {resourceForm.id && (
                                    <button type="button" onClick={resetResourceForm} className="px-4 rounded-xl border border-[var(--ck-border-subtle)] text-sm font-medium text-[var(--ck-text-muted)] hover:bg-[var(--ck-bg)]">
                                        Cancel
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-medium text-[var(--ck-text-muted)]">{tourResourceLinks.length} shared mapping{tourResourceLinks.length !== 1 ? "s" : ""}</span>
                            <button type="button" onClick={resetAssignmentForm} className="text-xs font-medium text-[var(--ck-accent)] hover:underline">+ New Mapping</button>
                        </div>
                        <div className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] overflow-hidden">
                            <div className="divide-y divide-[var(--ck-border-subtle)]">
                                {tourResourceLinks.map((link) => (
                                    <div key={link.id} className={"p-4 " + (assignmentForm.id === link.id ? "bg-blue-50" : "")}>
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="font-medium text-sm text-[var(--ck-text-strong)]">{link.tours?.name || "Tour"} <span className="text-[var(--ck-text-muted)]">→</span> {link.resources?.name || "Resource"}</div>
                                                <div className="text-xs text-[var(--ck-text-muted)] mt-1">{link.units_per_guest} unit{link.units_per_guest === 1 ? "" : "s"} consumed per guest · {link.resources?.resource_type || "GENERAL"}</div>
                                            </div>
                                            <div className="flex items-center gap-3 shrink-0">
                                                <button type="button" onClick={() => setAssignmentForm({ id: link.id, tour_id: link.tour_id, resource_id: link.resource_id, units_per_guest: String(link.units_per_guest), active: link.active })} className="text-xs font-medium text-[var(--ck-accent)] hover:underline">Edit</button>
                                                <button type="button" onClick={() => handleDeleteAssignment(link)} className="text-xs font-medium text-[var(--ck-danger)] hover:underline">Delete</button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {tourResourceLinks.length === 0 && <div className="p-4 text-center text-sm ui-text-muted">No tour-to-resource mappings yet.</div>}
                            </div>
                        </div>

                        <form onSubmit={handleSaveAssignment} className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5 space-y-4 mt-4">
                            <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">{assignmentForm.id ? "Edit Mapping" : "Add Tour Mapping"}</h3>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Tour</label>
                                <select value={assignmentForm.tour_id} onChange={e => setAssignmentForm({ ...assignmentForm, tour_id: e.target.value })} className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none">
                                    <option value="">Select a tour...</option>
                                    {tours.map((tour) => <option key={tour.id} value={tour.id}>{tour.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Shared Resource</label>
                                <select value={assignmentForm.resource_id} onChange={e => setAssignmentForm({ ...assignmentForm, resource_id: e.target.value })} className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none">
                                    <option value="">Select a resource...</option>
                                    {resources.filter((resource) => resource.active).map((resource) => (
                                        <option key={resource.id} value={resource.id}>{resource.name} · {resource.capacity_total} total</option>
                                    ))}
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Units Per Guest</label>
                                    <input type="number" min="1" value={assignmentForm.units_per_guest} onChange={e => setAssignmentForm({ ...assignmentForm, units_per_guest: e.target.value })} className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" />
                                </div>
                                <label className="flex items-end gap-2 cursor-pointer pb-2">
                                    <input type="checkbox" checked={assignmentForm.active} onChange={e => setAssignmentForm({ ...assignmentForm, active: e.target.checked })} className="w-4 h-4 rounded border-gray-300 text-[var(--ck-accent)] focus:ring-[var(--ck-accent)]" />
                                    <span className="text-sm text-[var(--ck-text-strong)]">Mapping active</span>
                                </label>
                            </div>
                            <div className="rounded-xl border border-[var(--ck-border-subtle)] bg-[var(--ck-bg)] p-3 text-xs text-[var(--ck-text-muted)]">
                                Example: if a 10-seat van is shared between two tours, and each guest consumes 1 van unit, bookings on either tour will reduce the sellable capacity on the other when their slots overlap.
                            </div>
                            <div className="flex gap-3">
                                <button type="submit" disabled={assignmentSaving} className="flex-1 rounded-xl bg-[var(--ck-text-strong)] py-2.5 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:opacity-90 disabled:opacity-50">
                                    {assignmentSaving ? "Saving..." : assignmentForm.id ? "Update Mapping" : "Save Mapping"}
                                </button>
                                {assignmentForm.id && (
                                    <button type="button" onClick={resetAssignmentForm} className="px-4 rounded-xl border border-[var(--ck-border-subtle)] text-sm font-medium text-[var(--ck-text-muted)] hover:bg-[var(--ck-bg)]">
                                        Cancel
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>
                </div>

                {resourceMessage.text && (
                    <div className={"mt-4 text-sm font-medium " + (resourceMessage.type === "error" ? "text-[var(--ck-danger)]" : "text-[var(--ck-success)]")}>
                        {resourceMessage.text}
                    </div>
                )}
            </CollapsibleSection>}

            {canAccess("external") && (
                <CollapsibleSection id="external" title="External Booking Integration" subtitle="B2B partner API keys and mappings" openSections={openSections} toggle={toggleSection}>
                    <ExternalBookingSettings tours={tours.map((t) => ({ id: t.id, name: t.name }))} />
                </CollapsibleSection>
            )}

            {canAccess("site") && <CollapsibleSection id="site" title="Booking Site Configuration" subtitle="These settings directly affect the public booking page" openSections={openSections} toggle={toggleSection}>
                <form onSubmit={handleSaveSiteSettings} className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-6 space-y-8">

                    {/* Legal & Text Policies */}
                    <div>
                        <h3 className="text-sm font-semibold text-[var(--ck-text-strong)] mb-4 pb-2 border-b border-[var(--ck-border-subtle)]">Policies &amp; Information</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Directions &amp; Meeting Info</label>
                                <RichTextEditor value={siteSettings.directions} onChange={v => setSiteSettings({ ...siteSettings, directions: v })} rows={10} placeholder="Enter how to find the location..." />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Terms &amp; Conditions</label>
                                <RichTextEditor value={siteSettings.terms_conditions} onChange={v => setSiteSettings({ ...siteSettings, terms_conditions: v })} rows={10} placeholder="Enter T&C's..." />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Privacy Policy</label>
                                <RichTextEditor value={siteSettings.privacy_policy} onChange={v => setSiteSettings({ ...siteSettings, privacy_policy: v })} rows={10} />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Cookies Policy</label>
                                <RichTextEditor value={siteSettings.cookies_policy} onChange={v => setSiteSettings({ ...siteSettings, cookies_policy: v })} rows={10} />
                            </div>
                        </div>
                    </div>

                    {/* Branding & Hero Text */}
                    <div>
                        <h3 className="text-sm font-semibold text-[var(--ck-text-strong)] mb-1 pb-2 border-b border-[var(--ck-border-subtle)]">Branding &amp; Hero Text</h3>
                        <p className="text-xs text-[var(--ck-text-muted)] mb-4">The <strong>Business Name</strong> and <strong>Logo</strong> below control: the admin dashboard sidebar, the browser tab title, all outgoing emails, and the public booking site header.</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Business Name <span className="text-[var(--ck-accent)]">— appears in the dashboard header &amp; all emails</span></label>
                                <input type="text" value={siteSettings.business_name} onChange={e => setSiteSettings({ ...siteSettings, business_name: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="e.g. Cape Kayak Adventures" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Business Tagline</label>
                                <input type="text" value={siteSettings.business_tagline} onChange={e => setSiteSettings({ ...siteSettings, business_tagline: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="Cape Town's Original Since 1994" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Logo <span className="text-[var(--ck-accent)]">— appears next to the business name in the dashboard sidebar</span></label>
                                <div className="flex items-center gap-3">
                                    {siteSettings.logo_url && (
                                        <img src={siteSettings.logo_url} alt="Logo preview" className="h-10 w-10 object-contain rounded border border-[var(--ck-border-subtle)] shrink-0" />
                                    )}
                                    <div>
                                        <label className={"inline-flex items-center gap-2 cursor-pointer rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-xs font-medium text-[var(--ck-text-strong)] hover:bg-[var(--ck-bg-subtle)] transition-colors" + (uploadingField === "logo" ? " opacity-50 pointer-events-none" : "")}>
                                            {uploadingField === "logo" ? "Uploading..." : (siteSettings.logo_url ? "Change logo" : "Upload logo")}
                                            <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;
                                                setUploadingField("logo");
                                                await handleImageUpload(file, "email-images", businessId + "/branding", (url) => setSiteSettings(prev => ({ ...prev, logo_url: url })));
                                                setUploadingField(null);
                                                e.target.value = "";
                                            }} />
                                        </label>
                                        {siteSettings.logo_url && (
                                            <button type="button" onClick={() => setSiteSettings({ ...siteSettings, logo_url: "" })} className="ml-2 text-xs text-[var(--ck-danger)] hover:underline">Remove</button>
                                        )}
                                    </div>
                                </div>
                                <p className="text-xs text-[var(--ck-text-muted)] mt-1">Leave empty to show the default icon.</p>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Hero Eyebrow</label>
                                <input type="text" value={siteSettings.hero_eyebrow} onChange={e => setSiteSettings({ ...siteSettings, hero_eyebrow: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="Cape Town Sea Kayaking" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Hero Title</label>
                                <input type="text" value={siteSettings.hero_title} onChange={e => setSiteSettings({ ...siteSettings, hero_title: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="Find Your Perfect Paddle" />
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Hero Subtitle</label>
                                <input type="text" value={siteSettings.hero_subtitle} onChange={e => setSiteSettings({ ...siteSettings, hero_subtitle: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="Explore the Atlantic coastline by kayak with Cape Town's original guided team." />
                            </div>
                        </div>
                    </div>

                    <div>
                        <h3 className="text-sm font-semibold text-[var(--ck-text-strong)] mb-4 pb-2 border-b border-[var(--ck-border-subtle)]">Navigation, Buttons &amp; Footer Copy</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Gift Voucher Nav Label</label>
                                <input type="text" value={siteSettings.nav_gift_voucher_label} onChange={e => setSiteSettings({ ...siteSettings, nav_gift_voucher_label: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="Gift Voucher" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">My Bookings Nav Label</label>
                                <input type="text" value={siteSettings.nav_my_bookings_label} onChange={e => setSiteSettings({ ...siteSettings, nav_my_bookings_label: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="My Bookings" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Primary Tour CTA Label</label>
                                <input type="text" value={siteSettings.card_cta_label} onChange={e => setSiteSettings({ ...siteSettings, card_cta_label: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="Book Now" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Chat Widget Label</label>
                                <input type="text" value={siteSettings.chat_widget_label} onChange={e => setSiteSettings({ ...siteSettings, chat_widget_label: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="Book here" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Footer Line One</label>
                                <input type="text" value={siteSettings.footer_line_one} onChange={e => setSiteSettings({ ...siteSettings, footer_line_one: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="Kayaks Adventures · Coastal Activity Centre" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Footer Line Two</label>
                                <input type="text" value={siteSettings.footer_line_two} onChange={e => setSiteSettings({ ...siteSettings, footer_line_two: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="Established: 1994 · BookingTours Platform" />
                            </div>
                        </div>
                    </div>

                    {role === "SUPER_ADMIN" && (
                        <div>
                            <h3 className="text-sm font-semibold text-[var(--ck-text-strong)] mb-4 pb-2 border-b border-[var(--ck-border-subtle)]">Booking Site Links &amp; Redirects</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Booking Site URL</label>
                                    <input type="url" value={siteSettings.booking_site_url} onChange={e => setSiteSettings({ ...siteSettings, booking_site_url: e.target.value })}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder={DEFAULT_BOOKING_URL} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Manage Bookings URL</label>
                                    <input type="url" value={siteSettings.manage_bookings_url} onChange={e => setSiteSettings({ ...siteSettings, manage_bookings_url: e.target.value })}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder={DEFAULT_MANAGE_BOOKINGS_URL} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Gift Voucher Page URL</label>
                                    <input type="url" value={siteSettings.gift_voucher_url} onChange={e => setSiteSettings({ ...siteSettings, gift_voucher_url: e.target.value })}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder={DEFAULT_GIFT_VOUCHER_URL} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Payment Success URL</label>
                                    <input type="url" value={siteSettings.booking_success_url} onChange={e => setSiteSettings({ ...siteSettings, booking_success_url: e.target.value })}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder={DEFAULT_BOOKING_SUCCESS_URL} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Payment Cancel URL</label>
                                    <input type="url" value={siteSettings.booking_cancel_url} onChange={e => setSiteSettings({ ...siteSettings, booking_cancel_url: e.target.value })}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder={DEFAULT_BOOKING_CANCEL_URL} />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Voucher Success URL</label>
                                    <input type="url" value={siteSettings.voucher_success_url} onChange={e => setSiteSettings({ ...siteSettings, voucher_success_url: e.target.value })}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder={DEFAULT_VOUCHER_SUCCESS_URL} />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Waiver URL</label>
                                    <input type="url" value={siteSettings.waiver_url} onChange={e => setSiteSettings({ ...siteSettings, waiver_url: e.target.value })}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="Leave blank to use the built-in waiver form" />
                                    <p className="mt-1 text-xs text-[var(--ck-text-muted)]">If left blank, the platform will generate a booking-specific waiver form automatically. If you use a custom URL, booking and token query params are appended.</p>
                                </div>
                            </div>
                            <p className="mt-3 text-xs text-[var(--ck-text-muted)]">Use full URLs here. Payment links, admin weather broadcasts, and related booking actions can reuse these values instead of hardcoded paths.</p>
                        </div>
                    )}

                    <div className="space-y-4">
                        <div className="pb-2 border-b border-[var(--ck-border-subtle)]">
                            <h3 className="text-sm font-semibold text-[var(--ck-text-strong)] mb-1">Custom Booking Questions</h3>
                            <p className="text-xs text-[var(--ck-text-muted)]">
                                Use this section to ask your customers additional questions during checkout (e.g., allergies, hotel pickups, or experience levels). 
                                Click the buttons below to instantly add common questions, or write your own using the text box.
                            </p>
                        </div>
                        
                        <div>
                            <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-2">Quick Insert Templates</label>
                            <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => {
                                    try {
                                        let current = JSON.parse(bookingCustomFieldsJson || "[]");
                                        if (!Array.isArray(current)) current = [];
                                        current.push({ key: "dietary_" + Date.now().toString().slice(-4), label: "Any dietary requirements or allergies?", type: "textarea", required: false, placeholder: "e.g. Vegetarian, nut allergy, none" });
                                        setBookingCustomFieldsJson(JSON.stringify(current, null, 2));
                                    } catch(e) { alert("Please ensure the box below contains valid JSON (starts with [ and ends with ]) before adding a template."); }
                                }} className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--ck-border-subtle)] bg-[var(--ck-surface)] hover:bg-gray-50 text-[var(--ck-text-strong)] transition-colors">+ Dietary Requirements</button>

                                <button type="button" onClick={() => {
                                    try {
                                        let current = JSON.parse(bookingCustomFieldsJson || "[]");
                                        if (!Array.isArray(current)) current = [];
                                        current.push({ key: "hotel_" + Date.now().toString().slice(-4), label: "Where are you staying in Cape Town? (For pickup routing)", type: "text", required: false, placeholder: "Hotel name or address" });
                                        setBookingCustomFieldsJson(JSON.stringify(current, null, 2));
                                    } catch(e) { alert("Please ensure the box below contains valid JSON (starts with [ and ends with ]) before adding a template."); }
                                }} className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--ck-border-subtle)] bg-[var(--ck-surface)] hover:bg-gray-50 text-[var(--ck-text-strong)] transition-colors">+ Hotel / Pickup</button>

                                <button type="button" onClick={() => {
                                    try {
                                        let current = JSON.parse(bookingCustomFieldsJson || "[]");
                                        if (!Array.isArray(current)) current = [];
                                        current.push({ key: "experience_" + Date.now().toString().slice(-4), label: "Have you ever kayaked before?", type: "text", required: true, placeholder: "Yes, No, or A little bit" });
                                        setBookingCustomFieldsJson(JSON.stringify(current, null, 2));
                                    } catch(e) { alert("Please ensure the box below contains valid JSON (starts with [ and ends with ]) before adding a template."); }
                                }} className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--ck-border-subtle)] bg-[var(--ck-surface)] hover:bg-gray-50 text-[var(--ck-text-strong)] transition-colors">+ Kayaking Experience</button>

                                <button type="button" onClick={() => {
                                    try {
                                        let current = JSON.parse(bookingCustomFieldsJson || "[]");
                                        if (!Array.isArray(current)) current = [];
                                        current.push({ key: "emergency_" + Date.now().toString().slice(-4), label: "Emergency Contact (Name & Phone Number)", type: "text", required: true, placeholder: "John Doe - +27 123 456 789" });
                                        setBookingCustomFieldsJson(JSON.stringify(current, null, 2));
                                    } catch(e) { alert("Please ensure the box below contains valid JSON (starts with [ and ends with ]) before adding a template."); }
                                }} className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--ck-border-subtle)] bg-[var(--ck-surface)] hover:bg-gray-50 text-[var(--ck-text-strong)] transition-colors">+ Emergency Contact</button>

                                <button type="button" onClick={() => {
                                    try {
                                        let current = JSON.parse(bookingCustomFieldsJson || "[]");
                                        if (!Array.isArray(current)) current = [];
                                        current.push({ key: "medical_" + Date.now().toString().slice(-4), label: "Do you have any medical conditions we should be aware of?", type: "textarea", required: false, placeholder: "List any relevant medical conditions" });
                                        setBookingCustomFieldsJson(JSON.stringify(current, null, 2));
                                    } catch(e) { alert("Please ensure the box below contains valid JSON (starts with [ and ends with ]) before adding a template."); }
                                }} className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--ck-border-subtle)] bg-[var(--ck-surface)] hover:bg-gray-50 text-[var(--ck-text-strong)] transition-colors">+ Medical Conditions</button>

                                <button type="button" onClick={() => {
                                    try {
                                        let current = JSON.parse(bookingCustomFieldsJson || "[]");
                                        if (!Array.isArray(current)) current = [];
                                        current.push({ key: "referral_" + Date.now().toString().slice(-4), label: "How did you hear about us?", type: "text", required: false, placeholder: "Google, TripAdvisor, Friend, etc." });
                                        setBookingCustomFieldsJson(JSON.stringify(current, null, 2));
                                    } catch(e) { alert("Please ensure the box below contains valid JSON (starts with [ and ends with ]) before adding a template."); }
                                }} className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--ck-border-subtle)] bg-[var(--ck-surface)] hover:bg-gray-50 text-[var(--ck-text-strong)] transition-colors">+ Referral Source</button>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Configuration Code (JSON)</label>
                            <textarea
                                value={bookingCustomFieldsJson}
                                onChange={e => setBookingCustomFieldsJson(e.target.value)}
                                rows={12}
                                className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none font-mono tracking-tight"
                                placeholder={`[\n  {\n    "key": "dietary_1234",\n    "label": "Dietary Requirements",\n    "type": "textarea",\n    "required": false,\n    "placeholder": "List allergies..."\n  }\n]`}
                            />
                            <p className="mt-2 text-xs text-[var(--ck-text-muted)] leading-relaxed">
                                This box stores the questions in a computer-readable format (JSON). It must always start with <code>[</code> and end with <code>]</code>.
                                Each question has a <code>key</code> (internal ID), <code>label</code> (the public question), <code>type</code> (<code>text</code> or <code>textarea</code>), <code>placeholder</code> (hint text), and <code>required</code> (true/false).
                            </p>
                        </div>
                    </div>

                    <div>
                        <h3 className="text-sm font-semibold text-[var(--ck-text-strong)] mb-4 pb-2 border-b border-[var(--ck-border-subtle)]">Booking Page Copy Preview</h3>
                        <div className="rounded-3xl border border-[var(--ck-border-subtle)] overflow-hidden" style={{ background: siteSettings.color_bg }}>
                            <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-[var(--ck-border-subtle)]" style={{ background: siteSettings.color_nav }}>
                                <div className="min-w-0">
                                    <div className="text-lg font-semibold truncate" style={{ color: siteSettings.color_secondary }}>{siteSettings.business_name || "Business Name"}</div>
                                    <div className="text-sm truncate" style={{ color: siteSettings.color_main }}>{siteSettings.business_tagline || "Business tagline"}</div>
                                </div>
                                <div className="flex items-center gap-3 text-sm shrink-0">
                                    <span style={{ color: siteSettings.color_secondary }}>{siteSettings.nav_gift_voucher_label || "Gift Voucher"}</span>
                                    <span className="px-4 py-2 rounded-full font-semibold" style={{ background: siteSettings.color_main, color: "#ffffff" }}>{siteSettings.nav_my_bookings_label || "My Bookings"}</span>
                                </div>
                            </div>
                            <div className="px-6 py-8 text-center">
                                <div className="text-xs font-semibold uppercase tracking-[0.3em]" style={{ color: siteSettings.color_main }}>{siteSettings.hero_eyebrow || "Hero Eyebrow"}</div>
                                <div className="mt-3 text-4xl font-semibold" style={{ color: siteSettings.color_secondary }}>{siteSettings.hero_title || "Hero Title"}</div>
                                <div className="mt-3 text-base max-w-2xl mx-auto" style={{ color: siteSettings.color_secondary, opacity: 0.72 }}>{siteSettings.hero_subtitle || "Hero subtitle appears here."}</div>
                                <div className="mt-8 inline-flex px-5 py-2.5 rounded-full font-semibold text-sm" style={{ background: siteSettings.color_cta, color: "#ffffff" }}>{siteSettings.card_cta_label || "Book Now"}</div>
                            </div>
                            <div className="px-6 py-6 border-t border-[var(--ck-border-subtle)] text-center text-sm">
                                <div style={{ color: siteSettings.color_secondary }}>{siteSettings.footer_line_one || ((siteSettings.business_name || "Business Name") + " · Coastal Activity Centre")}</div>
                                <div className="mt-2" style={{ color: siteSettings.color_secondary, opacity: 0.72 }}>{siteSettings.footer_line_two || "Established: 1994 · BookingTours Platform"}</div>
                                <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-full font-semibold" style={{ background: siteSettings.color_nav, color: siteSettings.color_secondary, boxShadow: "0 8px 24px rgba(15, 23, 42, 0.12)" }}>{siteSettings.chat_widget_label || "Book here"}</div>
                            </div>
                        </div>
                    </div>

                    {/* Branding Colors */}
                    <div>
                        <div className="flex items-center justify-between mb-4 pb-2 border-b border-[var(--ck-border-subtle)]">
                            <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">Theme Colors</h3>
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Choose Template -</span>
                                <select
                                    className="ui-control px-3 py-1 text-xs rounded-lg outline-none cursor-pointer bg-[var(--ck-surface)] border border-[var(--ck-border-subtle)]"
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (!val) return;
                                        const palettes: Record<string, any> = {
                                            "Gentle Sea Breeze": { color_main: "#1F7A8C", color_secondary: "#022B3A", color_cta: "#1F7A8C", color_bg: "#E1E5F2", color_nav: "#FFFFFF", color_hover: "#BFDBF7" },
                                            "Earthy Green": { color_main: "#52796F", color_secondary: "#2F3E46", color_cta: "#52796F", color_bg: "#CAD2C5", color_nav: "#F2F4F0", color_hover: "#84A98C" },
                                            "Cherry Blossom": { color_main: "#BD632F", color_secondary: "#273E47", color_cta: "#A4243B", color_bg: "#D8C99B", color_nav: "#F8F5EE", color_hover: "#D8973C" },
                                            "Soft Sand": { color_main: "#D5BDAF", color_secondary: "#4A4036", color_cta: "#D5BDAF", color_bg: "#F5EBE0", color_nav: "#FFFFFF", color_hover: "#D6CCC2" },
                                            "Golden Summer Fields": { color_main: "#D4A373", color_secondary: "#3D4A27", color_cta: "#D4A373", color_bg: "#FEFAE0", color_nav: "#FFFFFF", color_hover: "#E9EDC9" },
                                            "Pastel Dreams": { color_main: "#FF99C8", color_secondary: "#2D3748", color_cta: "#FF99C8", color_bg: "#FCF6BD", color_nav: "#FFFFFF", color_hover: "#D0F4DE" },
                                            "Purple Haze": { color_main: "#A167A5", color_secondary: "#0E273C", color_cta: "#A167A5", color_bg: "#E8D7F1", color_nav: "#F8F4FA", color_hover: "#D3BCCC" }
                                        };
                                        if (palettes[val]) setSiteSettings(prev => ({ ...prev, ...palettes[val] }));
                                        e.target.value = "";
                                    }}
                                >
                                    <option value="">Select a Palette...</option>
                                    <option value="Gentle Sea Breeze">Gentle Sea Breeze</option>
                                    <option value="Earthy Green">Earthy Green</option>
                                    <option value="Cherry Blossom">Cherry Blossom</option>
                                    <option value="Soft Sand">Soft Sand</option>
                                    <option value="Golden Summer Fields">Golden Summer Fields</option>
                                    <option value="Pastel Dreams">Pastel Dreams</option>
                                    <option value="Purple Haze">Purple Haze</option>
                                </select>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Main Color</label>
                                <div className="flex bg-[var(--ck-surface)] rounded-lg border border-[var(--ck-border-subtle)] overflow-hidden focus-within:ring-2 focus-within:ring-[var(--ck-accent)]">
                                    <input type="color" value={siteSettings.color_main} onChange={e => setSiteSettings({ ...siteSettings, color_main: e.target.value })}
                                        className="h-10 w-12 p-1 bg-transparent cursor-pointer border-r border-[var(--ck-border-subtle)]" />
                                    <input type="text" value={siteSettings.color_main} onChange={e => setSiteSettings({ ...siteSettings, color_main: e.target.value })}
                                        className="flex-1 w-full px-3 py-2 text-sm outline-none uppercase" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Secondary Color</label>
                                <div className="flex bg-[var(--ck-surface)] rounded-lg border border-[var(--ck-border-subtle)] overflow-hidden focus-within:ring-2 focus-within:ring-[var(--ck-accent)]">
                                    <input type="color" value={siteSettings.color_secondary} onChange={e => setSiteSettings({ ...siteSettings, color_secondary: e.target.value })}
                                        className="h-10 w-12 p-1 bg-transparent cursor-pointer border-r border-[var(--ck-border-subtle)]" />
                                    <input type="text" value={siteSettings.color_secondary} onChange={e => setSiteSettings({ ...siteSettings, color_secondary: e.target.value })}
                                        className="flex-1 w-full px-3 py-2 text-sm outline-none uppercase" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Call To Action</label>
                                <div className="flex bg-[var(--ck-surface)] rounded-lg border border-[var(--ck-border-subtle)] overflow-hidden focus-within:ring-2 focus-within:ring-[var(--ck-accent)]">
                                    <input type="color" value={siteSettings.color_cta} onChange={e => setSiteSettings({ ...siteSettings, color_cta: e.target.value })}
                                        className="h-10 w-12 p-1 bg-transparent cursor-pointer border-r border-[var(--ck-border-subtle)]" />
                                    <input type="text" value={siteSettings.color_cta} onChange={e => setSiteSettings({ ...siteSettings, color_cta: e.target.value })}
                                        className="flex-1 w-full px-3 py-2 text-sm outline-none uppercase" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Page Background</label>
                                <div className="flex bg-[var(--ck-surface)] rounded-lg border border-[var(--ck-border-subtle)] overflow-hidden focus-within:ring-2 focus-within:ring-[var(--ck-accent)]">
                                    <input type="color" value={siteSettings.color_bg} onChange={e => setSiteSettings({ ...siteSettings, color_bg: e.target.value })}
                                        className="h-10 w-12 p-1 bg-transparent cursor-pointer border-r border-[var(--ck-border-subtle)]" />
                                    <input type="text" value={siteSettings.color_bg} onChange={e => setSiteSettings({ ...siteSettings, color_bg: e.target.value })}
                                        className="flex-1 w-full px-3 py-2 text-sm outline-none uppercase" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Navigation Bar</label>
                                <div className="flex bg-[var(--ck-surface)] rounded-lg border border-[var(--ck-border-subtle)] overflow-hidden focus-within:ring-2 focus-within:ring-[var(--ck-accent)]">
                                    <input type="color" value={siteSettings.color_nav} onChange={e => setSiteSettings({ ...siteSettings, color_nav: e.target.value })}
                                        className="h-10 w-12 p-1 bg-transparent cursor-pointer border-r border-[var(--ck-border-subtle)]" />
                                    <input type="text" value={siteSettings.color_nav} onChange={e => setSiteSettings({ ...siteSettings, color_nav: e.target.value })}
                                        className="flex-1 w-full px-3 py-2 text-sm outline-none uppercase" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Card Hover Overlay</label>
                                <div className="flex bg-[var(--ck-surface)] rounded-lg border border-[var(--ck-border-subtle)] overflow-hidden focus-within:ring-2 focus-within:ring-[var(--ck-accent)]">
                                    <input type="color" value={siteSettings.color_hover} onChange={e => setSiteSettings({ ...siteSettings, color_hover: e.target.value })}
                                        className="h-10 w-12 p-1 bg-transparent cursor-pointer border-r border-[var(--ck-border-subtle)]" />
                                    <input type="text" value={siteSettings.color_hover} onChange={e => setSiteSettings({ ...siteSettings, color_hover: e.target.value })}
                                        className="flex-1 w-full px-3 py-2 text-sm outline-none uppercase" />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Chatbot Avatar */}
                    <div>
                        <h3 className="text-sm font-semibold text-[var(--ck-text-strong)] mb-4 pb-2 border-b border-[var(--ck-border-subtle)]">Chatbot Avatar</h3>
                        <div className="flex flex-wrap gap-4">
                            {chatbotAvatars.length === 0 && (
                                <p className="text-xs text-[var(--ck-text-muted)]">No avatars available. Ask a super admin to add some.</p>
                            )}
                            {chatbotAvatars.map(({ id, lottie_url, label }) => {
                                const isSelected = siteSettings.chatbot_avatar === lottie_url;
                                return (
                                    <div key={id}
                                        title={label || ""}
                                        onClick={() => setSiteSettings({ ...siteSettings, chatbot_avatar: lottie_url })}
                                        className={"relative cursor-pointer transition-all hover:scale-105 rounded-xl p-1 " + (isSelected ? "bg-[var(--ck-accent)] ring-2 ring-offset-2 ring-[var(--ck-accent)]" : "bg-transparent")}
                                    >
                                        <div className="w-16 h-16 bg-[var(--ck-surface)] rounded-lg flex items-center justify-center shadow-inner overflow-hidden border border-[var(--ck-border-subtle)]"
                                            dangerouslySetInnerHTML={{ __html: `<dotlottie-wc src="${lottie_url}" style="width: 100%; height: 100%" autoplay loop></dotlottie-wc>` }}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Save Footer */}
                    <div className="pt-4 border-t border-[var(--ck-border-subtle)] flex items-center justify-between">
                        <div>
                            {siteMessage.text && (
                                <span className={"text-sm font-medium " + (siteMessage.type === "error" ? "text-[var(--ck-danger)]" : "text-[var(--ck-success)]")}>
                                    {siteMessage.text}
                                </span>
                            )}
                        </div>
                        <button type="submit" disabled={siteSaving}
                            className="rounded-xl px-8 bg-[var(--ck-text-strong)] py-2.5 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:opacity-90 disabled:opacity-50">
                            {siteSaving ? "Saving..." : "Save Site Settings"}
                        </button>
                    </div>

                </form>

                {/* Cancellation Policy — separate from the main site settings form */}
                <div className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-6 space-y-5 mt-6">
                    <div>
                        <h3 className="text-sm font-semibold text-[var(--ck-text-strong)] mb-1">Cancellation Policy</h3>
                        <p className="text-xs text-[var(--ck-text-muted)]">
                            Each tier: how many hours <strong>before</strong> the tour the customer cancels → what % they get refunded. The highest-hours tier they still qualify for wins. Weather cancellations by the operator always get a full refund.
                        </p>
                    </div>

                    <div className="space-y-2">
                        {refundTiers.map((t, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <input type="number" value={t.hours_before} min={0} onChange={e => setRefundTiers(prev => {
                                    const next = [...prev]; next[i] = { ...next[i], hours_before: Number(e.target.value) }; return next;
                                })} className="ui-control w-20 px-2 py-1.5 text-sm rounded-lg outline-none text-center" />
                                <span className="text-xs text-[var(--ck-text-muted)]">hours before →</span>
                                <input type="number" value={t.refund_percent} min={0} max={100} onChange={e => setRefundTiers(prev => {
                                    const next = [...prev]; next[i] = { ...next[i], refund_percent: Number(e.target.value) }; return next;
                                })} className="ui-control w-20 px-2 py-1.5 text-sm rounded-lg outline-none text-center" />
                                <span className="text-xs text-[var(--ck-text-muted)]">% refund</span>
                                <button type="button" onClick={() => setRefundTiers(prev => prev.filter((_, j) => j !== i))}
                                    className="text-xs text-[var(--ck-danger)] hover:underline ml-1">Remove</button>
                            </div>
                        ))}
                        <button type="button" onClick={() => setRefundTiers(prev => [...prev, { hours_before: 0, refund_percent: 0 }])}
                            className="text-xs font-medium text-[var(--ck-accent)] hover:underline">+ Add tier</button>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Plain-language summary (shown to customers)</label>
                        <textarea value={refundPolicyText} onChange={e => setRefundPolicyText(e.target.value)} rows={3}
                            className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none resize-y" />
                    </div>

                    <div className="flex items-center gap-3">
                        <button type="button" onClick={handleSaveRefundPolicy} disabled={refundSaving}
                            className="rounded-xl px-6 bg-[var(--ck-text-strong)] py-2 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:opacity-90 disabled:opacity-50">
                            {refundSaving ? "Saving..." : "Save Cancellation Policy"}
                        </button>
                        {refundMessage.text && (
                            <span className={"text-sm font-medium " + (refundMessage.type === "error" ? "text-[var(--ck-danger)]" : "text-[var(--ck-success)]")}>
                                {refundMessage.text}
                            </span>
                        )}
                    </div>
                </div>
            </CollapsibleSection>}

            {canAccess("email") && <CollapsibleSection id="email" title="Email Customisation" subtitle="Colour theme and banner images for each email type" openSections={openSections} toggle={toggleSection}>
                <form onSubmit={handleSaveEmailImages} className="space-y-6">
                    {/* Email Color Picker */}
                    <div className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5">
                        <div className="mb-3">
                            <span className="text-sm font-semibold text-[var(--ck-text-strong)]">Email Colour</span>
                            <span className="ml-2 text-xs text-[var(--ck-text-muted)]">Header, footer, and button colour used in all emails</span>
                        </div>
                        <div className="flex flex-wrap gap-3">
                            {([
                                { color: "#1b3b36", name: "Teal" },
                                { color: "#1e3a5f", name: "Navy" },
                                { color: "#2d3436", name: "Charcoal" },
                                { color: "#2c3e50", name: "Midnight" },
                                { color: "#1a472a", name: "Forest" },
                                { color: "#4a1942", name: "Plum" },
                                { color: "#5b2c3f", name: "Burgundy" },
                                { color: "#3c1518", name: "Maroon" },
                                { color: "#2b2d42", name: "Slate" },
                                { color: "#4e3629", name: "Espresso" },
                            ]).map(({ color, name }) => (
                                <button key={color} type="button" onClick={() => setEmailColor(color)}
                                    className={"flex flex-col items-center gap-1.5 rounded-xl px-3 py-2.5 border-2 transition-all " + (emailColor === color ? "border-[var(--ck-accent)] shadow-sm" : "border-transparent hover:border-[var(--ck-border-subtle)]")}>
                                    <div className="w-10 h-10 rounded-lg shadow-sm" style={{ backgroundColor: color }} />
                                    <span className="text-[11px] font-medium text-[var(--ck-text-muted)]">{name}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {([
                        { key: "payment", label: "Payment Link", desc: "Sent when admin creates a booking requiring payment" },
                        { key: "confirm", label: "Booking Confirmation", desc: "Sent after payment is completed" },
                        { key: "invoice", label: "Invoice", desc: "Sent with the tax invoice attachment" },
                        { key: "gift", label: "Gift Voucher", desc: "Sent to the gift voucher buyer after purchase" },
                        { key: "cancel", label: "Cancellation – General", desc: "Sent when a booking is cancelled for any reason" },
                        { key: "cancel_weather", label: "Cancellation – Weather", desc: "Sent when a booking is cancelled due to weather" },
                        { key: "indemnity", label: "Waiver Reminder", desc: "Sent the day before the tour as a waiver reminder" },
                        { key: "admin", label: "Admin Welcome", desc: "Sent to new admin users with their setup link" },
                        { key: "voucher", label: "Voucher Code", desc: "Sent when a customer receives a voucher code" },
                        { key: "photos", label: "Trip Photos", desc: "Sent when trip photos are uploaded and shared" },
                    ] as { key: keyof typeof emailImgs; label: string; desc: string }[]).map(({ key, label, desc }) => (
                        <div key={key} className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5">
                            <div className="flex gap-5 items-start">
                                {emailImgs[key] ? (
                                    <img src={emailImgs[key]} alt={label} className="w-24 h-16 object-cover rounded-lg border border-[var(--ck-border-subtle)] shrink-0 bg-gray-100" />
                                ) : (
                                    <div className="w-24 h-16 rounded-lg border border-dashed border-[var(--ck-border-subtle)] bg-gray-50 flex items-center justify-center shrink-0">
                                        <span className="text-xs text-[var(--ck-text-muted)]">Default</span>
                                    </div>
                                )}
                                <div className="flex-1 min-w-0">
                                    <div className="mb-1">
                                        <span className="text-sm font-semibold text-[var(--ck-text-strong)]">{label}</span>
                                        <span className="ml-2 text-xs text-[var(--ck-text-muted)]">{desc}</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <input
                                            type="url"
                                            value={emailImgs[key]}
                                            onChange={e => setEmailImgs({ ...emailImgs, [key]: e.target.value })}
                                            className="ui-control flex-1 px-3 py-2 text-sm rounded-lg outline-none"
                                            placeholder="https://example.com/your-image.jpg"
                                        />
                                        <label className={"px-3 py-2 text-xs rounded-lg border border-[var(--ck-border-subtle)] text-[var(--ck-text-muted)] hover:text-[var(--ck-accent)] hover:border-[var(--ck-accent)] transition-colors cursor-pointer inline-flex items-center gap-1.5" + (emailImgUploading === key ? " opacity-50 pointer-events-none" : "")}>
                                            {emailImgUploading === key ? (
                                                <><svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg> Uploading</>
                                            ) : (
                                                <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg> Upload</>
                                            )}
                                            <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadEmailImage(key, f); e.target.value = ""; }} />
                                        </label>
                                        {emailImgs[key] && (
                                            <button type="button" onClick={() => setEmailImgs({ ...emailImgs, [key]: "" })}
                                                className="px-3 py-2 text-xs rounded-lg border border-[var(--ck-border-subtle)] text-[var(--ck-text-muted)] hover:text-[var(--ck-danger)] hover:border-[var(--ck-danger)] transition-colors">
                                                Reset
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                    {/* Social Media Links */}
                    <div className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5">
                        <div className="mb-4">
                            <span className="text-sm font-semibold text-[var(--ck-text-strong)]">Social Media Links</span>
                            <span className="ml-2 text-xs text-[var(--ck-text-muted)]">Icons appear in email footers only when a link is provided</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {([
                                { key: "facebook", label: "Facebook", placeholder: "https://facebook.com/yourbusiness" },
                                { key: "instagram", label: "Instagram", placeholder: "https://instagram.com/yourbusiness" },
                                { key: "tiktok", label: "TikTok", placeholder: "https://tiktok.com/@yourbusiness" },
                                { key: "youtube", label: "YouTube", placeholder: "https://youtube.com/@yourbusiness" },
                                { key: "twitter", label: "X / Twitter", placeholder: "https://x.com/yourbusiness" },
                                { key: "linkedin", label: "LinkedIn", placeholder: "https://linkedin.com/company/yourbusiness" },
                                { key: "tripadvisor", label: "TripAdvisor", placeholder: "https://tripadvisor.com/..." },
                                { key: "google_reviews", label: "Google Reviews", placeholder: "https://g.page/r/..." },
                            ] as { key: keyof typeof socialLinks; label: string; placeholder: string }[]).map(({ key, label, placeholder }) => (
                                <div key={key}>
                                    <label className="text-xs font-medium text-[var(--ck-text-muted)] mb-1 block">{label}</label>
                                    <input
                                        type="url"
                                        value={socialLinks[key]}
                                        onChange={e => setSocialLinks({ ...socialLinks, [key]: e.target.value })}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none"
                                        placeholder={placeholder}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                        <div>
                            {emailImgsMessage.text && (
                                <span className={"text-sm font-medium " + (emailImgsMessage.type === "error" ? "text-[var(--ck-danger)]" : "text-[var(--ck-success)]")}>
                                    {emailImgsMessage.text}
                                </span>
                            )}
                        </div>
                        <button type="submit" disabled={emailImgsSaving}
                            className="rounded-xl px-8 bg-[var(--ck-text-strong)] py-2.5 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:opacity-90 disabled:opacity-50">
                            {emailImgsSaving ? "Saving..." : "Save Email Settings"}
                        </button>
                    </div>
                </form>
            </CollapsibleSection>}

            {canAccess("site") && <CollapsibleSection id="operations" title="Operations & AI Configuration" subtitle="Meeting info, what to bring/wear, FAQ, and AI chatbot personality" openSections={openSections} toggle={toggleSection}>
                <form onSubmit={async (e) => {
                    e.preventDefault();
                    setOpsSaving(true);
                    const faqObj: Record<string, string> = {};
                    for (const entry of faqEntries) { if (entry.q.trim() && entry.a.trim()) faqObj[entry.q.trim()] = entry.a.trim(); }
                    const { error } = await supabase.from("businesses").update({
                        what_to_bring: opsConfig.what_to_bring || null,
                        what_to_wear: opsConfig.what_to_wear || null,
                        arrival_instructions: opsConfig.arrival_instructions || null,
                        ai_system_prompt: opsConfig.ai_system_prompt || null,
                        faq_json: faqObj,
                    }).eq("id", businessId);
                    setOpsSaving(false);
                    if (error) { notify({ message: error.message, tone: "error" }); return; }
                    notify({ message: "Operations & AI settings saved.", tone: "success" });
                }} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="block">
                            <span className="text-xs font-medium text-[var(--ck-text-muted)]">What to bring</span>
                            <textarea value={opsConfig.what_to_bring} onChange={e => setOpsConfig({ ...opsConfig, what_to_bring: e.target.value })}
                                rows={4} placeholder="e.g. Sunscreen, towel, water bottle, hat..." className="mt-1 w-full rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-sm bg-[var(--ck-surface)]" />
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-[var(--ck-text-muted)]">What to wear</span>
                            <textarea value={opsConfig.what_to_wear} onChange={e => setOpsConfig({ ...opsConfig, what_to_wear: e.target.value })}
                                rows={4} placeholder="e.g. Comfortable clothes that can get wet, closed-toe shoes..." className="mt-1 w-full rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-sm bg-[var(--ck-surface)]" />
                        </label>
                    </div>

                    <label className="block">
                        <span className="text-xs font-medium text-[var(--ck-text-muted)]">Arrival instructions</span>
                        <p className="text-[11px] text-[var(--ck-text-muted)] mb-1">Shown beneath the meeting point in confirmation emails. Defaults to &quot;Please arrive 15 minutes before launch.&quot; if left blank.</p>
                        <textarea value={opsConfig.arrival_instructions} onChange={e => setOpsConfig({ ...opsConfig, arrival_instructions: e.target.value })}
                            rows={2} placeholder="e.g. Please arrive 20 minutes before departure and check in at the kiosk." className="mt-1 w-full rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-sm bg-[var(--ck-surface)]" />
                    </label>

                    <label className="block">
                        <span className="text-xs font-medium text-[var(--ck-text-muted)]">AI chatbot personality &amp; knowledge</span>
                        <p className="text-[11px] text-[var(--ck-text-muted)] mb-1">This is the system prompt for your AI chatbot on your booking site and WhatsApp. It tells the AI who it is, your business rules, and how to handle questions.</p>
                        <textarea value={opsConfig.ai_system_prompt} onChange={e => setOpsConfig({ ...opsConfig, ai_system_prompt: e.target.value })}
                            rows={8} placeholder="You are a friendly booking assistant for [business]. You help customers book tours, answer FAQs..." className="mt-1 w-full rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-sm bg-[var(--ck-surface)] font-mono text-xs" />
                    </label>

                    {/* FAQ Repeater */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-[var(--ck-text-muted)]">Frequently Asked Questions</span>
                            <button type="button" onClick={() => setFaqEntries([...faqEntries, { q: "", a: "" }])}
                                className="text-xs font-medium px-2 py-1 rounded-lg border border-[var(--ck-border-subtle)] hover:bg-[var(--ck-bg-subtle)]"
                                style={{ color: "var(--ck-accent)" }}>
                                + Add FAQ
                            </button>
                        </div>
                        {faqEntries.length === 0 && (
                            <p className="text-xs text-[var(--ck-text-muted)] italic">No FAQs yet. Add questions your customers commonly ask — these power the AI chatbot.</p>
                        )}
                        <div className="space-y-3">
                            {faqEntries.map((faq, i) => (
                                <div key={i} className="rounded-lg border border-[var(--ck-border-subtle)] p-3 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[11px] font-semibold text-[var(--ck-text-muted)]">FAQ {i + 1}</span>
                                        <button type="button" onClick={() => setFaqEntries(faqEntries.filter((_, j) => j !== i))}
                                            className="text-xs text-red-500 hover:text-red-700">Remove</button>
                                    </div>
                                    <input type="text" value={faq.q} onChange={e => { const next = [...faqEntries]; next[i] = { ...next[i], q: e.target.value }; setFaqEntries(next); }}
                                        placeholder="Question" className="w-full rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-sm bg-[var(--ck-surface)]" />
                                    <textarea value={faq.a} onChange={e => { const next = [...faqEntries]; next[i] = { ...next[i], a: e.target.value }; setFaqEntries(next); }}
                                        rows={2} placeholder="Answer" className="w-full rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-sm bg-[var(--ck-surface)]" />
                                </div>
                            ))}
                        </div>
                    </div>

                    <div>
                        <button type="submit" disabled={opsSaving}
                            className="rounded-xl px-8 bg-[var(--ck-text-strong)] py-2.5 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:opacity-90 disabled:opacity-50">
                            {opsSaving ? "Saving..." : "Save Operations & AI"}
                        </button>
                    </div>
                </form>
            </CollapsibleSection>}

            {isPrivileged(role) && (
              <CollapsibleSection id="whatsapp-bot" title="WhatsApp Bot Mode" subtitle="Control when the AI assistant auto-replies to WhatsApp messages" openSections={openSections} toggle={toggleSection}>
                <WhatsAppBotSection />
              </CollapsibleSection>
            )}

            {isPrivileged(role) && <CollapsibleSection id="autotags" title="Automation Tag Rules" subtitle="Control how tags are automatically assigned to marketing contacts based on booking behaviour" openSections={openSections} toggle={toggleSection}>
                <form onSubmit={async (e) => {
                    e.preventDefault();
                    setAutoTagSaving(true);
                    const { error } = await supabase.from("businesses").update({ automation_config: autoTagConfig }).eq("id", businessId);
                    setAutoTagSaving(false);
                    if (error) { notify({ message: error.message, tone: "error" }); return; }
                    notify({ message: "Automation tag rules saved.", tone: "success" });
                }} className="space-y-6">
                    <p className="text-xs text-[var(--ck-text-muted)]">
                        Tags are automatically applied to your marketing contacts daily based on their booking history. These tags power your automations — for example, when a contact gets tagged <strong>vip</strong>, any automation triggered by that tag fires instantly.
                    </p>

                    {/* VIP Rules */}
                    <div className="rounded-lg border border-[var(--ck-border-subtle)] p-4 space-y-3">
                        <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">VIP Tag</h3>
                        <p className="text-xs text-[var(--ck-text-muted)]">Assigned when a customer makes a certain number of paid bookings within a time window. Expires after a set period unless they rebook.</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Bookings required</span>
                                <input type="number" min={1} max={50} value={autoTagConfig.vip_bookings} onChange={e => setAutoTagConfig({ ...autoTagConfig, vip_bookings: parseInt(e.target.value) || 3 })}
                                    className="mt-1 w-full rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-sm bg-[var(--ck-surface)]" />
                            </label>
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Within (days)</span>
                                <input type="number" min={7} max={365} value={autoTagConfig.vip_window_days} onChange={e => setAutoTagConfig({ ...autoTagConfig, vip_window_days: parseInt(e.target.value) || 90 })}
                                    className="mt-1 w-full rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-sm bg-[var(--ck-surface)]" />
                            </label>
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">VIP valid for (days)</span>
                                <input type="number" min={30} max={1825} value={autoTagConfig.vip_valid_days} onChange={e => setAutoTagConfig({ ...autoTagConfig, vip_valid_days: parseInt(e.target.value) || 365 })}
                                    className="mt-1 w-full rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-sm bg-[var(--ck-surface)]" />
                            </label>
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Renew after (bookings)</span>
                                <input type="number" min={1} max={50} value={autoTagConfig.vip_renewal_bookings} onChange={e => setAutoTagConfig({ ...autoTagConfig, vip_renewal_bookings: parseInt(e.target.value) || 3 })}
                                    className="mt-1 w-full rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-sm bg-[var(--ck-surface)]" />
                            </label>
                        </div>
                        <p className="text-[11px] text-[var(--ck-text-muted)]">
                            Default: 3 bookings within 90 days = VIP for 1 year. Renews if they make 3 more bookings before it expires.
                        </p>
                    </div>

                    {/* Lapsed Rules */}
                    <div className="rounded-lg border border-[var(--ck-border-subtle)] p-4 space-y-3">
                        <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">Lapsed Customer Tag</h3>
                        <p className="text-xs text-[var(--ck-text-muted)]">Assigned when a customer hasn't booked in a while. Removed automatically when they book again.</p>
                        <label className="block max-w-xs">
                            <span className="text-xs font-medium text-[var(--ck-text-muted)]">Days since last booking</span>
                            <input type="number" min={14} max={365} value={autoTagConfig.lapsed_days} onChange={e => setAutoTagConfig({ ...autoTagConfig, lapsed_days: parseInt(e.target.value) || 90 })}
                                className="mt-1 w-full rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-sm bg-[var(--ck-surface)]" />
                        </label>
                        <p className="text-[11px] text-[var(--ck-text-muted)]">
                            Default: 90 days. Tag name: <code className="bg-[var(--ck-bg-subtle)] px-1 rounded">lapsed-{autoTagConfig.lapsed_days}-days</code>
                        </p>
                    </div>

                    {/* Other Tags */}
                    <div className="rounded-lg border border-[var(--ck-border-subtle)] p-4 space-y-3">
                        <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">Other Auto-Tags</h3>
                        <div className="space-y-2">
                            <label className="flex items-center gap-2">
                                <input type="checkbox" checked={autoTagConfig.completed_tour_enabled} onChange={e => setAutoTagConfig({ ...autoTagConfig, completed_tour_enabled: e.target.checked })}
                                    className="rounded border-[var(--ck-border-subtle)]" />
                                <span className="text-sm text-[var(--ck-text)]"><strong>completed-tour</strong> — after a booked tour date has passed</span>
                            </label>
                            <label className="flex items-center gap-2">
                                <input type="checkbox" checked={autoTagConfig.new_booker_enabled} onChange={e => setAutoTagConfig({ ...autoTagConfig, new_booker_enabled: e.target.checked })}
                                    className="rounded border-[var(--ck-border-subtle)]" />
                                <span className="text-sm text-[var(--ck-text)]"><strong>new-booker</strong> — first-time customers (removed after 2nd booking)</span>
                            </label>
                        </div>
                        <label className="block max-w-xs">
                            <span className="text-xs font-medium text-[var(--ck-text-muted)]">Voucher expiry warning (days before)</span>
                            <input type="number" min={7} max={90} value={autoTagConfig.voucher_expiry_days} onChange={e => setAutoTagConfig({ ...autoTagConfig, voucher_expiry_days: parseInt(e.target.value) || 30 })}
                                className="mt-1 w-full rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-sm bg-[var(--ck-surface)]" />
                        </label>
                    </div>

                    <div>
                        <button type="submit" disabled={autoTagSaving}
                            className="rounded-xl px-8 bg-[var(--ck-text-strong)] py-2.5 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:opacity-90 disabled:opacity-50">
                            {autoTagSaving ? "Saving..." : "Save Tag Rules"}
                        </button>
                    </div>
                </form>
            </CollapsibleSection>}

            {canAccess("invoice") && <CollapsibleSection id="invoice" title={isPrivileged(role) ? "Invoice & Banking Details" : "Invoice Details"} subtitle={isPrivileged(role) ? "Company info and banking details shown on pro forma invoices" : "Company information shown on pro forma invoices"} openSections={openSections} toggle={toggleSection}>
                <form onSubmit={handleSaveInvoice} className="space-y-6">
                    <div>
                        <h3 className="text-sm font-semibold text-[var(--ck-text-strong)] mb-3">Company Details</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Company name (on invoice)</span>
                                <input type="text" value={invoiceForm.company_name} onChange={e => setInvoiceForm({ ...invoiceForm, company_name: e.target.value })}
                                    placeholder="e.g. Aonyx Adventures" className="mt-1 w-full rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-sm bg-[var(--ck-surface)]" />
                            </label>
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Registration number</span>
                                <input type="text" value={invoiceForm.reg_number} onChange={e => setInvoiceForm({ ...invoiceForm, reg_number: e.target.value })}
                                    placeholder="e.g. Reg. 2024/123456/07" className="mt-1 w-full rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-sm bg-[var(--ck-surface)]" />
                            </label>
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">VAT number</span>
                                <input type="text" value={invoiceForm.vat_number} onChange={e => setInvoiceForm({ ...invoiceForm, vat_number: e.target.value })}
                                    placeholder="e.g. 4290176926" className="mt-1 w-full rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-sm bg-[var(--ck-surface)]" />
                            </label>
                        </div>
                        <div className="mt-4 space-y-3">
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Address line 1</span>
                                <input type="text" value={invoiceForm.address_line1} onChange={e => setInvoiceForm({ ...invoiceForm, address_line1: e.target.value })}
                                    placeholder="e.g. 179 Beach Road" className="mt-1 w-full rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-sm bg-[var(--ck-surface)]" />
                            </label>
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Address line 2</span>
                                <input type="text" value={invoiceForm.address_line2} onChange={e => setInvoiceForm({ ...invoiceForm, address_line2: e.target.value })}
                                    placeholder="e.g. Three Anchor Bay, Cape Town" className="mt-1 w-full rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-sm bg-[var(--ck-surface)]" />
                            </label>
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Address line 3</span>
                                <input type="text" value={invoiceForm.address_line3} onChange={e => setInvoiceForm({ ...invoiceForm, address_line3: e.target.value })}
                                    placeholder="e.g. 8005" className="mt-1 w-full rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-sm bg-[var(--ck-surface)]" />
                            </label>
                        </div>
                    </div>

                    {isPrivileged(role) && <>
                    <hr className="border-[var(--ck-border-subtle)]" />

                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">Banking Details</h3>
                        </div>
                        <p className="text-xs text-[var(--ck-text-muted)] mb-4">Banking details are encrypted at rest.</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Account owner</span>
                                <input type="text" value={bankForm.account_owner} onChange={e => { setBankForm({ ...bankForm, account_owner: e.target.value }); }}
                                    placeholder="e.g. Aonyx Adventures" className="mt-1 w-full rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-sm bg-[var(--ck-surface)]" />
                            </label>
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Account number</span>
                                <input type="text" value={bankForm.account_number} onChange={e => { setBankForm({ ...bankForm, account_number: e.target.value }); }}
                                    placeholder="e.g. 070631824" className="mt-1 w-full rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-sm bg-[var(--ck-surface)]" />
                            </label>
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Account type</span>
                                <input type="text" value={bankForm.account_type} onChange={e => { setBankForm({ ...bankForm, account_type: e.target.value }); }}
                                    placeholder="e.g. Current / Cheque" className="mt-1 w-full rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-sm bg-[var(--ck-surface)]" />
                            </label>
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Bank name</span>
                                <input type="text" value={bankForm.bank_name} onChange={e => { setBankForm({ ...bankForm, bank_name: e.target.value }); }}
                                    placeholder="e.g. Standard Bank" className="mt-1 w-full rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-sm bg-[var(--ck-surface)]" />
                            </label>
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Branch code</span>
                                <input type="text" value={bankForm.branch_code} onChange={e => { setBankForm({ ...bankForm, branch_code: e.target.value }); }}
                                    placeholder="e.g. 020909" className="mt-1 w-full rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-sm bg-[var(--ck-surface)]" />
                            </label>
                        </div>

                    </div>
                    </>}

                    {!isPrivileged(role) && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 mt-2">
                            <p className="text-sm text-amber-800 font-medium">Banking details can only be edited by the Main Admin.</p>
                        </div>
                    )}

                    {invoiceMessage.text && (
                        <div className={"p-3 rounded-xl text-sm font-medium " + (invoiceMessage.type === "error" ? "bg-red-50 border border-red-200 text-[var(--ck-danger)]" : "bg-emerald-50 border border-emerald-200 text-emerald-700")}>
                            {invoiceMessage.text}
                        </div>
                    )}

                    <button type="submit" disabled={invoiceSaving}
                        className="rounded-lg bg-[var(--ck-accent)] px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                        {invoiceSaving ? "Saving..." : "Save invoice details"}
                    </button>
                </form>
            </CollapsibleSection>}

            {canAccess("credentials") && <CollapsibleSection id="credentials" title="Integration Credentials" subtitle="AES-256 encrypted at rest. Update each integration independently." openSections={openSections} toggle={toggleSection}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

                    {/* WhatsApp */}
                    <form onSubmit={handleSaveWa} className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5 space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-[var(--ck-border-subtle)]">
                            <div className="flex items-center gap-2">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-[#25D366]"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>
                                <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">WhatsApp (Meta API)</h3>
                            </div>
                            {credStatus !== null && (
                                <span className={"text-xs font-semibold px-2.5 py-1 rounded-full " + (credStatus.wa ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
                                    {credStatus.wa ? "✓ Configured" : "⚠ Not set"}
                                </span>
                            )}
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Access Token</label>
                            <input
                                type="password"
                                value={waForm.token}
                                onChange={e => setWaForm({ ...waForm, token: e.target.value })}
                                className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none font-mono"
                                placeholder={credStatus?.wa ? "●●●●●●●● (set — enter new value to replace)" : "EAAG..."}
                                autoComplete="new-password"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Phone Number ID</label>
                            <input
                                type="text"
                                value={waForm.phoneId}
                                onChange={e => setWaForm({ ...waForm, phoneId: e.target.value })}
                                className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none font-mono"
                                placeholder={credStatus?.wa ? "●●●●●●●● (set — enter new value to replace)" : "123456789012345"}
                                autoComplete="off"
                            />
                            <p className="mt-1 text-xs text-[var(--ck-text-muted)]">Found in Meta Business Manager → WhatsApp → API Setup → Phone number ID.</p>
                        </div>
                        <button
                            type="submit"
                            disabled={waSaving || !waForm.token.trim() || !waForm.phoneId.trim()}
                            className="w-full rounded-xl bg-[var(--ck-text-strong)] py-2.5 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:opacity-90 disabled:opacity-40 transition-opacity"
                        >
                            {waSaving ? "Encrypting & saving..." : "Save WhatsApp Credentials"}
                        </button>
                    </form>

                    {/* Yoco */}
                    <form onSubmit={handleSaveYoco} className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5 space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-[var(--ck-border-subtle)]">
                            <div className="flex items-center gap-2">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--ck-accent)]"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>
                                <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">Yoco (Payments)</h3>
                            </div>
                            {credStatus !== null && (
                                <span className={"text-xs font-semibold px-2.5 py-1 rounded-full " + (credStatus.yoco ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
                                    {credStatus.yoco ? "✓ Configured" : "⚠ Not set"}
                                </span>
                            )}
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Secret Key</label>
                            <input
                                type="password"
                                value={yocoForm.secretKey}
                                onChange={e => setYocoForm({ ...yocoForm, secretKey: e.target.value })}
                                className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none font-mono"
                                placeholder={credStatus?.yoco ? "●●●●●●●● (set — enter new value to replace)" : "sk_live_..."}
                                autoComplete="new-password"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Webhook Signing Secret</label>
                            <input
                                type="password"
                                value={yocoForm.webhookSecret}
                                onChange={e => setYocoForm({ ...yocoForm, webhookSecret: e.target.value })}
                                className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none font-mono"
                                placeholder={credStatus?.yoco ? "●●●●●●●● (set — enter new value to replace)" : "whsec_..."}
                                autoComplete="new-password"
                            />
                            <p className="mt-1 text-xs text-[var(--ck-text-muted)]">Found in your Yoco Dashboard → Developers → Webhooks → Signing secret.</p>
                        </div>
                        <button
                            type="submit"
                            disabled={yocoSaving || !yocoForm.secretKey.trim() || !yocoForm.webhookSecret.trim()}
                            className="w-full rounded-xl bg-[var(--ck-text-strong)] py-2.5 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:opacity-90 disabled:opacity-40 transition-opacity"
                        >
                            {yocoSaving ? "Encrypting & saving..." : "Save Yoco Credentials"}
                        </button>
                    </form>

                    {/* Yoco Test Mode */}
                    <div className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5 space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-[var(--ck-border-subtle)]">
                            <div className="flex items-center gap-2">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-orange-500"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                                <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">Yoco Test Mode</h3>
                            </div>
                            {credStatus !== null && (
                                <span className={"text-xs font-semibold px-2.5 py-1 rounded-full " + (credStatus.yoco_test_mode ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-gray-600")}>
                                    {credStatus.yoco_test_mode ? "TEST MODE ON" : "Live mode"}
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-[var(--ck-text-muted)] leading-relaxed">
                            When enabled, all Yoco payments will use sandbox (test) keys. No real charges will be processed. Use this to test the payment flow with Yoco test cards.
                        </p>
                        <button
                            type="button"
                            onClick={handleToggleTestMode}
                            disabled={testModeToggling || (!credStatus?.yoco_test && !credStatus?.yoco_test_mode)}
                            className={"w-full rounded-xl py-2.5 text-sm font-semibold transition-opacity disabled:opacity-40 " + (credStatus?.yoco_test_mode
                                ? "border border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100"
                                : "bg-orange-500 text-white hover:bg-orange-600")}
                        >
                            {testModeToggling ? "Updating..." : credStatus?.yoco_test_mode ? "Disable Test Mode" : "Enable Test Mode"}
                        </button>
                        {!credStatus?.yoco_test && !credStatus?.yoco_test_mode && (
                            <p className="text-xs text-amber-600">Save test credentials below before enabling test mode.</p>
                        )}
                    </div>

                    {/* Yoco Test Credentials */}
                    <form onSubmit={handleSaveYocoTest} className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5 space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-[var(--ck-border-subtle)]">
                            <div className="flex items-center gap-2">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-orange-400"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>
                                <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">Yoco Test Credentials</h3>
                            </div>
                            {credStatus !== null && (
                                <span className={"text-xs font-semibold px-2.5 py-1 rounded-full " + (credStatus.yoco_test ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
                                    {credStatus.yoco_test ? "Configured" : "Not set"}
                                </span>
                            )}
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Test Secret Key</label>
                            <input
                                type="password"
                                value={yocoTestForm.secretKey}
                                onChange={e => setYocoTestForm({ ...yocoTestForm, secretKey: e.target.value })}
                                className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none font-mono"
                                placeholder={credStatus?.yoco_test ? "●●●●●●●● (set — enter new value to replace)" : "sk_test_..."}
                                autoComplete="new-password"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Test Webhook Signing Secret</label>
                            <input
                                type="password"
                                value={yocoTestForm.webhookSecret}
                                onChange={e => setYocoTestForm({ ...yocoTestForm, webhookSecret: e.target.value })}
                                className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none font-mono"
                                placeholder={credStatus?.yoco_test ? "●●●●●●●● (set — enter new value to replace)" : "whsec_test_..."}
                                autoComplete="new-password"
                            />
                            <p className="mt-1 text-xs text-[var(--ck-text-muted)]">Found in your Yoco Dashboard → Developers → Test environment → Webhooks.</p>
                        </div>
                        <button
                            type="submit"
                            disabled={yocoTestSaving || !yocoTestForm.secretKey.trim() || !yocoTestForm.webhookSecret.trim()}
                            className="w-full rounded-xl bg-[var(--ck-text-strong)] py-2.5 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:opacity-90 disabled:opacity-40 transition-opacity"
                        >
                            {yocoTestSaving ? "Encrypting & saving..." : "Save Yoco Test Credentials"}
                        </button>
                    </form>

                    {/* Google Drive */}
                    <div className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5 space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-[var(--ck-border-subtle)]">
                            <div className="flex items-center gap-2">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-[#4285F4]"><path d="M7.71 3.5L1.15 15l3.43 5.94h6.87L7.71 3.5z" fill="#0066DA"/><path d="M16.29 3.5H7.71l3.74 17.44h6.87l3.43-5.94L16.29 3.5z" fill="#00AC47"/><path d="M1.15 15l3.43 5.94h14.84l3.43-5.94H1.15z" fill="#EA4335"/><path d="M7.71 3.5l3.74 6.48L16.29 3.5H7.71z" fill="#00832D"/><path d="M11.45 9.98L7.71 3.5 1.15 15h7.48l2.82-5.02z" fill="#2684FC"/><path d="M11.45 9.98L16.29 3.5l5.56 11.5h-7.48l-2.92-5.02z" fill="#FFBA00"/></svg>
                                <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">Google Drive (Photos)</h3>
                            </div>
                            <span className={"text-xs font-semibold px-2.5 py-1 rounded-full " + (gdriveConnected ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
                                {gdriveConnected ? "Connected" : "Not connected"}
                            </span>
                        </div>
                        {gdriveConnected ? (
                            <>
                                <p className="text-sm text-[var(--ck-text-muted)]">
                                    Connected as <span className="font-medium text-[var(--ck-text-strong)]">{gdriveEmail}</span>
                                </p>
                                <p className="text-xs text-[var(--ck-text-muted)]">Trip photo uploads go to your Google Drive. Disconnect to revoke access.</p>
                                <button
                                    type="button"
                                    onClick={handleDisconnectGdrive}
                                    disabled={gdriveLoading}
                                    className="w-full rounded-xl border border-red-200 bg-red-50 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-40 transition-opacity"
                                >
                                    {gdriveLoading ? "Disconnecting..." : "Disconnect Google Drive"}
                                </button>
                            </>
                        ) : (
                            <>
                                <p className="text-sm text-[var(--ck-text-muted)]">Connect Google Drive to upload trip photos directly from the Photos page.</p>
                                <button
                                    type="button"
                                    onClick={handleConnectGdrive}
                                    disabled={gdriveLoading}
                                    className="w-full rounded-xl bg-[var(--ck-text-strong)] py-2.5 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:opacity-90 disabled:opacity-40 transition-opacity"
                                >
                                    {gdriveLoading ? "Connecting..." : "Connect Google Drive"}
                                </button>
                            </>
                        )}
                    </div>

                    {/* Google Reviews */}
                    <div className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5 space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-[var(--ck-border-subtle)]">
                            <div className="flex items-center gap-2">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                                <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">Google Reviews</h3>
                            </div>
                            {googlePlaceId && (
                                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">✓ Configured</span>
                            )}
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Google Place ID</label>
                            <input
                                type="text"
                                value={googlePlaceId}
                                onChange={e => setGooglePlaceId(e.target.value)}
                                className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none font-mono"
                                placeholder="ChIJ..."
                                autoComplete="off"
                            />
                            <p className="mt-1 text-xs text-[var(--ck-text-muted)]">Find your Place ID at <a href="https://developers.google.com/maps/documentation/places/web-service/place-id" target="_blank" rel="noopener" className="underline">Google&apos;s Place ID Finder</a>. Reviews sync daily at 03:17 UTC.</p>
                        </div>
                        <button
                            type="button"
                            disabled={googlePlaceSaving}
                            onClick={async () => {
                                setGooglePlaceSaving(true);
                                const { error } = await supabase.from("businesses").update({ google_place_id: googlePlaceId.trim() || null }).eq("id", businessId);
                                setCredMessage(error ? { type: "error", text: "Failed to save Place ID." } : { type: "success", text: "Google Place ID saved." });
                                setGooglePlaceSaving(false);
                            }}
                            className="w-full rounded-xl bg-[var(--ck-text-strong)] py-2.5 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:opacity-90 disabled:opacity-40 transition-opacity"
                        >
                            {googlePlaceSaving ? "Saving..." : "Save Google Place ID"}
                        </button>
                    </div>

                </div>

                {credMessage.text && (
                    <div className={"mt-4 p-3 rounded-xl text-sm font-medium " + (credMessage.type === "error" ? "bg-red-50 border border-red-200 text-[var(--ck-danger)]" : "bg-emerald-50 border border-emerald-200 text-emerald-700")}>
                        {credMessage.text}
                    </div>
                )}
            </CollapsibleSection>}

            </div>
        </div >
    );
}
