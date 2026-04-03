"use client";
import { useState, useEffect, ReactNode } from "react";
import { confirmAction, notify } from "../lib/app-notify";
import { supabase } from "../lib/supabase";
import { generateSecureToken, sendAdminSetupLink, sha256 } from "../lib/admin-auth";
import { useBusinessContext } from "../../components/BusinessContext";
import dynamic from "next/dynamic";
import { ChevronDown } from "lucide-react";

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

// SUPER_ADMIN has every right that MAIN_ADMIN has, plus cross-tenant access.
function isPrivileged(r: string | null) {
    return r === "MAIN_ADMIN" || r === "SUPER_ADMIN";
}

// Default Booking App URLs (separate from Admin Dashboard: https://admin-tawny-delta-92.vercel.app)
var DEFAULT_BOOKING_URL = "https://booking-mu-steel.vercel.app";
var DEFAULT_MANAGE_BOOKINGS_URL = "https://booking-mu-steel.vercel.app/my-bookings";
var DEFAULT_GIFT_VOUCHER_URL = "https://booking-mu-steel.vercel.app/gift-voucher";
var DEFAULT_BOOKING_SUCCESS_URL = "https://booking-mu-steel.vercel.app/success";
var DEFAULT_BOOKING_CANCEL_URL = "https://booking-mu-steel.vercel.app/cancelled";
var DEFAULT_VOUCHER_SUCCESS_URL = "https://booking-mu-steel.vercel.app/voucher-success";

var DEFAULT_SITE_SETTINGS = {
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

export default function SettingsPage() {
    var { businessId } = useBusinessContext();
    var [admins, setAdmins] = useState<any[]>([]);
    var [loading, setLoading] = useState(true);
    var [role, setRole] = useState<string | null>(null);

    // Collapsible section state
    var [openSections, setOpenSections] = useState<Record<string, boolean>>({ admins: true });
    function toggleSection(id: string) { setOpenSections((prev) => ({ ...prev, [id]: !(prev[id] ?? false) })); }

    // New Admin Form
    var [newName, setNewName] = useState("");
    var [newEmail, setNewEmail] = useState("");
    var [adding, setAdding] = useState(false);
    var [error, setError] = useState("");
    var [adminMessage, setAdminMessage] = useState("");
    var [resendingAdminId, setResendingAdminId] = useState("");

    // Tours state
    var [tours, setTours] = useState<Tour[]>([]);
    var [editingTour, setEditingTour] = useState<Tour | null>(null);
    var [tourForm, setTourForm] = useState({ name: "", description: "", price: "", duration: "", sort_order: "0", active: true, image_url: "", default_capacity: "10", slotStartDate: "", slotEndDate: "", slotTimes: [""] as string[], slotDays: [0, 1, 2, 3, 4, 5, 6] as number[] });
    var [tourSaving, setTourSaving] = useState(false);
    var [tourError, setTourError] = useState("");
    var [slotMessage, setSlotMessage] = useState("");
    var [slotGenerating, setSlotGenerating] = useState(false);
    var [tourSlotCounts, setTourSlotCounts] = useState<Record<string, number>>({});
    var [resources, setResources] = useState<ResourceRecord[]>([]);
    var [tourResourceLinks, setTourResourceLinks] = useState<TourResourceLink[]>([]);
    var [resourceForm, setResourceForm] = useState({ id: "", name: "", resource_type: "GENERAL", capacity_total: "10", active: true });
    var [assignmentForm, setAssignmentForm] = useState({ id: "", tour_id: "", resource_id: "", units_per_guest: "1", active: true });
    var [resourceSaving, setResourceSaving] = useState(false);
    var [assignmentSaving, setAssignmentSaving] = useState(false);
    var [resourceMessage, setResourceMessage] = useState({ type: "", text: "" });

    // Site Settings State
    var [siteSettings, setSiteSettings] = useState(DEFAULT_SITE_SETTINGS);
    var [bookingCustomFieldsJson, setBookingCustomFieldsJson] = useState("[]");
    var [siteSaving, setSiteSaving] = useState(false);
    var [siteMessage, setSiteMessage] = useState({ type: "", text: "" });
    var [usageSnapshot, setUsageSnapshot] = useState<UsageSnapshot | null>(null);

    // Email Header Images State
    var [emailImgs, setEmailImgs] = useState({ payment: "", confirm: "", invoice: "", gift: "", cancel: "", cancel_weather: "", indemnity: "", admin: "", voucher: "", photos: "" });
    var [emailImgsSaving, setEmailImgsSaving] = useState(false);
    var [emailImgsMessage, setEmailImgsMessage] = useState({ type: "", text: "" });
    var [emailImgUploading, setEmailImgUploading] = useState<string | null>(null);
    var [emailColor, setEmailColor] = useState("#1b3b36");

    // Credentials State
    var [credStatus, setCredStatus] = useState<{ wa: boolean; yoco: boolean } | null>(null);
    var [waForm, setWaForm] = useState({ token: "", phoneId: "" });
    var [yocoForm, setYocoForm] = useState({ secretKey: "", webhookSecret: "" });
    var [waSaving, setWaSaving] = useState(false);
    var [yocoSaving, setYocoSaving] = useState(false);
    var [credMessage, setCredMessage] = useState({ type: "", text: "" });

    useEffect(() => {
        var r = localStorage.getItem("ck_admin_role");
        setRole(r);
        if (isPrivileged(r)) {
            fetchAdmins();
            fetchTours();
            fetchResources();
            fetchSiteSettings();
            fetchPlanUsage();
            fetchCredStatus();
        } else {
            setLoading(false);
        }

        if (!document.getElementById("dotlottie-script")) {
            var script = document.createElement("script");
            script.id = "dotlottie-script";
            script.src = "https://unpkg.com/@lottiefiles/dotlottie-wc@0.9.3/dist/dotlottie-wc.js";
            script.type = "module";
            document.head.appendChild(script);
        }
    }, [businessId]);

    async function fetchAdmins() {
        setLoading(true);
        var { data, error } = await supabase.from("admin_users").select("id, name, email, role, created_at, password_set_at, must_set_password, invite_sent_at").eq("business_id", businessId).order("created_at");
        if (data) setAdmins(data);
        setLoading(false);
    }

    async function fetchPlanUsage() {
        try {
            var usage = await fetchUsageSnapshot(businessId);
            setUsageSnapshot(usage);
        } catch (e) {
            console.error("Failed to load plan usage:", e);
            setUsageSnapshot(null);
        }
    }

    async function handleAddAdmin(e: React.FormEvent) {
        e.preventDefault();
        if (!newName.trim() || !newEmail.trim()) return setError("Name and email are required.");
        var seatLimit = usageSnapshot?.seat_limit || 10;
        if (admins.length >= seatLimit) return setError("Admin seat limit reached for your current plan (" + seatLimit + "). Upgrade to add more admins.");

        setAdding(true);
        setError("");
        setAdminMessage("");

        var hash = await sha256(generateSecureToken(24));
        var adminEmail = newEmail.trim().toLowerCase();
        var { data: insertedAdmin, error: insertErr } = await supabase.from("admin_users").insert({
            name: newName.trim(),
            email: adminEmail,
            password_hash: hash,
            role: "ADMIN",
            business_id: businessId,
            must_set_password: true,
            password_set_at: null,
        }).select("id, email, name").single();

        if (insertErr) {
            setAdding(false);
            if (insertErr.code === "23505") setError("Email already exists");
            else setError("Failed to add admin: " + insertErr.message);
            return;
        }

        if (!insertedAdmin) {
            setAdding(false);
            setError("Admin created, but failed to retrieve details for setup link.");
            return;
        }

        try {
            await sendAdminSetupLink(insertedAdmin, "ADMIN_INVITE");
            setAdminMessage("Admin added. A secure password setup email has been sent.");
        } catch (emailErr: any) {
            console.error("Welcome email failed:", emailErr);
            var emailErrMsg = String(emailErr?.message || "");
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
            await sendAdminSetupLink(admin, "RESET");
            setAdminMessage("A fresh password setup email has been sent to " + admin.email + ".");
            fetchAdmins();
        } catch (resendError: any) {
            console.error("Failed to resend password setup link:", resendError);
            var resendErrMsg = String(resendError?.message || "");
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
            var sentLabel = admin.invite_sent_at ? "Setup email sent " + new Date(admin.invite_sent_at).toLocaleDateString() : "Setup email not sent yet";
            return { label: "Password setup pending", detail: sentLabel, tone: "text-amber-700" };
        }

        return {
            label: "Password created",
            detail: "Created " + new Date(admin.password_set_at).toLocaleDateString(),
            tone: "text-emerald-700",
        };
    }

    async function fetchTours() {
        var { data } = await supabase.from("tours").select("*").eq("business_id", businessId).order("sort_order", { ascending: true });
        setTours((data || []) as Tour[]);
        if (data && data.length > 0) {
            fetchSlotCounts(data.map((t: any) => t.id));
        }
    }

    async function fetchSlotCounts(tourIds: string[]) {
        var now = new Date().toISOString();
        var counts: Record<string, number> = {};
        for (var tid of tourIds) {
            var { count } = await supabase.from("slots").select("id", { count: "exact", head: true }).eq("tour_id", tid).eq("status", "OPEN").gte("start_time", now);
            counts[tid] = count || 0;
        }
        setTourSlotCounts(counts);
    }

    var [dragIdx, setDragIdx] = useState<number | null>(null);

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

    var DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    function toggleDay(day: number) {
        setTourForm(prev => {
            var days = prev.slotDays.includes(day) ? prev.slotDays.filter(d => d !== day) : [...prev.slotDays, day];
            return { ...prev, slotDays: days };
        });
    }

    async function generateSlotsForTour(tourId: string) {
        var validTimes = tourForm.slotTimes.filter(t => t.trim() !== "");
        if (!tourForm.slotStartDate || !tourForm.slotEndDate || validTimes.length === 0) {
            setTourError("Please fill in start date, end date, and at least one start time.");
            return 0;
        }
        if (tourForm.slotDays.length === 0) {
            setTourError("Please select at least one day of the week.");
            return 0;
        }

        var slots: any[] = [];
        var start = new Date(tourForm.slotStartDate + "T00:00:00");
        var end = new Date(tourForm.slotEndDate + "T00:00:00");
        var capacity = Number(tourForm.default_capacity) || 10;

        for (var d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            if (!tourForm.slotDays.includes(d.getDay())) continue;

            var localDateStr = d.toISOString().split("T")[0];

            for (var ti = 0; ti < validTimes.length; ti++) {
                var localDateTime = localDateStr + "T" + validTimes[ti] + ":00";
                var localDate = new Date(localDateTime);
                localDate.setHours(localDate.getHours() - 2);
                var utcStart = localDate.toISOString();

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
            return 0;
        }

        var { error: slotErr } = await supabase.from("slots").insert(slots);
        if (slotErr) {
            setTourError("Slots failed: " + slotErr.message);
            return 0;
        }
        return slots.length;
    }

    async function handleGenerateSlots() {
        if (!editingTour) return;
        setSlotGenerating(true);
        setTourError("");
        setSlotMessage("");
        var count = await generateSlotsForTour(editingTour.id);
        if (count > 0) {
            setSlotMessage(count + " slot" + (count !== 1 ? "s" : "") + " generated for " + editingTour.name + "!");
            setTimeout(() => setSlotMessage(""), 5000);
            fetchSlotCounts(tours.map(t => t.id));
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

        var payload = {
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
            var { error: upErr } = await supabase.from("tours").update(payload).eq("id", editingTour.id);
            if (upErr) { setTourError("Failed: " + upErr.message); setTourSaving(false); return; }
        } else {
            var { data: newTour, error: inErr } = await supabase.from("tours").insert({ ...payload, business_id: businessId }).select().single();
            if (inErr) { setTourError("Failed: " + inErr.message); setTourSaving(false); return; }

            // Auto-generate slots if date range and time are provided
            if (newTour && tourForm.slotStartDate && tourForm.slotEndDate && tourForm.slotTimes.some(t => t.trim() !== "")) {
                var count = await generateSlotsForTour(newTour.id);
                if (count > 0) {
                    setSlotMessage("Tour created with " + count + " slot" + (count !== 1 ? "s" : "") + " generated!");
                    setTimeout(() => setSlotMessage(""), 5000);
                }
            }
        }

        setTourSaving(false);
        resetTourForm();
        fetchTours();
    }

    async function handleDeleteTour(id: string, name: string) {
        // Check for active unredeemed vouchers linked to this tour
        var { count: activeVoucherCount } = await supabase
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
            message: "Delete \"" + name + "\"? This cannot be undone.",
            tone: "warning",
            confirmLabel: "Delete tour",
        })) return;
        await supabase.from("tours").delete().eq("id", id);
        if (editingTour?.id === id) resetTourForm();
        fetchTours();
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
        var reordered = [...tours];
        var [moved] = reordered.splice(dragIdx, 1);
        reordered.splice(targetIdx, 0, moved);
        setTours(reordered);
        setDragIdx(null);
        for (var i = 0; i < reordered.length; i++) {
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

        await supabase.from("admin_users").delete().eq("id", id);
        fetchAdmins();
        fetchPlanUsage();
    }

    async function fetchSiteSettings() {
        var { data } = await supabase.from("businesses").select("*").eq("id", businessId).maybeSingle();
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
            });
            setBookingCustomFieldsJson(JSON.stringify(Array.isArray(data.booking_custom_fields) ? data.booking_custom_fields : [], null, 2));
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
            setEmailColor(data.email_color || "#1b3b36");
        }
    }

    function resetResourceForm() {
        setResourceForm({ id: "", name: "", resource_type: "GENERAL", capacity_total: "10", active: true });
    }

    function resetAssignmentForm() {
        setAssignmentForm({ id: "", tour_id: "", resource_id: "", units_per_guest: "1", active: true });
    }

    async function fetchResources() {
        try {
            var [resourcesRes, linksRes] = await Promise.all([
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

        var payload = {
            business_id: businessId,
            name: resourceForm.name.trim(),
            resource_type: resourceForm.resource_type.trim() || "GENERAL",
            capacity_total: Number(resourceForm.capacity_total),
            active: resourceForm.active,
        };

        var query = resourceForm.id
            ? supabase.from("resources").update(payload).eq("id", resourceForm.id)
            : supabase.from("resources").insert(payload);

        var { error: saveError } = await query;
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

        var { error: deleteError } = await supabase.from("resources").delete().eq("id", resource.id);
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

        var payload = {
            business_id: businessId,
            tour_id: assignmentForm.tour_id,
            resource_id: assignmentForm.resource_id,
            units_per_guest: Number(assignmentForm.units_per_guest),
            active: assignmentForm.active,
        };

        var query = assignmentForm.id
            ? supabase.from("tour_resources").update(payload).eq("id", assignmentForm.id)
            : supabase.from("tour_resources").upsert(payload, { onConflict: "tour_id,resource_id" });

        var { error: saveError } = await query;
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

        var { error: deleteError } = await supabase.from("tour_resources").delete().eq("id", link.id);
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

        var parsedBookingFields: any[] = [];
        try {
            parsedBookingFields = JSON.parse(bookingCustomFieldsJson || "[]");
            if (!Array.isArray(parsedBookingFields)) throw new Error("Custom booking fields must be a JSON array.");
        } catch (parseError: any) {
            setSiteMessage({ type: "error", text: "Custom booking fields JSON is invalid: " + String(parseError?.message || parseError) });
            setSiteSaving(false);
            return;
        }

        // Get the single business row that exists
        var { data: biz } = await supabase.from("businesses").select("id").eq("id", businessId).maybeSingle();
        if (!biz) {
            setSiteMessage({ type: "error", text: "No business record found to update." });
            setSiteSaving(false);
            return;
        }

        var { error } = await supabase.from("businesses").update({
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
            booking_custom_fields: parsedBookingFields,
        }).eq("id", biz.id);

        if (error) {
            setSiteMessage({ type: "error", text: "Error saving: " + error.message });
        } else {
            setSiteMessage({ type: "success", text: "Site settings saved successfully!" });
            setTimeout(() => setSiteMessage({ type: "", text: "" }), 3000);
        }
        setSiteSaving(false);
    }

    async function fetchCredStatus() {
        try {
            var res = await fetch("/api/credentials?business_id=" + businessId);
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
            var res = await fetch("/api/credentials", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ business_id: businessId, section: "wa", wa_token: waForm.token, wa_phone_id: waForm.phoneId }),
            });
            var d = await res.json();
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
            var res = await fetch("/api/credentials", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ business_id: businessId, section: "yoco", yoco_secret_key: yocoForm.secretKey, yoco_webhook_secret: yocoForm.webhookSecret }),
            });
            var d = await res.json();
            if (!res.ok || d.error) throw new Error(d.error || "Save failed");
            setCredMessage({ type: "success", text: "Yoco credentials saved and encrypted successfully." });
            setYocoForm({ secretKey: "", webhookSecret: "" });
            fetchCredStatus();
        } catch (err: any) {
            setCredMessage({ type: "error", text: String(err?.message || "Failed to save Yoco credentials.") });
        }
        setYocoSaving(false);
    }

    async function handleUploadEmailImage(key: string, file: File) {
        setEmailImgUploading(key);
        try {
            var ext = file.name.split(".").pop() || "jpg";
            var path = `${businessId}/${key}.${ext}`;
            var { error } = await supabase.storage.from("email-images").upload(path, file, { upsert: true });
            if (error) { notify("Upload failed: " + error.message); return; }
            var { data: urlData } = supabase.storage.from("email-images").getPublicUrl(path);
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
        var { error } = await supabase.from("businesses").update({
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

    if (!isPrivileged(role)) {
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

            <CollapsibleSection id="admins" title="Admin Users" openSections={openSections} toggle={toggleSection} defaultOpen>
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
                                var status = adminPasswordStatus(a);
                                return (
                                    <div key={a.id} className="p-4 flex items-center justify-between">
                                        <div>
                                            <div className="font-medium text-[var(--ck-text-strong)] text-sm">{a.name || a.email}</div>
                                            <div className="text-xs text-[var(--ck-text-muted)] mt-0.5">{a.email}</div>
                                            <div className="text-xs text-[var(--ck-text-muted)] mt-0.5">
                                                {a.role === "MAIN_ADMIN" ? "Main Admin" : "Admin"} • Added {new Date(a.created_at).toLocaleDateString()}
                                            </div>
                                            <div className={"text-xs mt-0.5 " + status.tone}>
                                                {status.label} • {status.detail}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            {a.role !== "MAIN_ADMIN" && (
                                                <button
                                                    onClick={() => handleResendSetup(a)}
                                                    disabled={resendingAdminId === a.id}
                                                    className="text-[var(--ck-accent)] text-sm font-medium hover:underline disabled:opacity-50"
                                                >
                                                    {resendingAdminId === a.id ? "Sending..." : ((a.must_set_password || !a.password_set_at) ? "Resend setup link" : "Email reset link")}
                                                </button>
                                            )}
                                            {a.role !== "MAIN_ADMIN" && (
                                                <button onClick={() => handleDelete(a.id, a.role)} className="text-[var(--ck-danger)] text-sm font-medium hover:underline">
                                                    Remove
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                            {admins.length === 0 && <div className="p-4 text-center text-sm ui-text-muted">No admins found</div>}
                        </div>
                    </div>
                </div>

                {/* Add Admin Form */}
                <div>
                    <h2 className="text-lg font-semibold text-[var(--ck-text-strong)] mb-4">Add New Admin</h2>
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
            </CollapsibleSection>

            <CollapsibleSection id="tours" title="Tours & Activities" openSections={openSections} toggle={toggleSection}>
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
                                <label className="block text-xs font-medium text-[var(--ck-text-strong)] mb-1">Image URL</label>
                                <input type="url" value={tourForm.image_url} onChange={e => setTourForm({ ...tourForm, image_url: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="Paste any image URL here..." />
                                <p className="text-xs text-[var(--ck-text-muted)] mt-1">Paste any direct image link here, or upload your image at <a href="https://imgbb.com/" target="_blank" rel="noopener noreferrer" className="text-[var(--ck-accent)] hover:underline">imgbb.com</a> if you don't have a link.</p>
                                {tourForm.image_url && (
                                    <img src={tourForm.image_url} alt="Preview" className="mt-2 w-full max-w-[160px] aspect-square object-cover rounded-lg border border-[var(--ck-border-subtle)]" />
                                )}
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
                                {editingTour && (
                                    <a href={`/slots?tour=${editingTour.id}`} className="text-xs text-emerald-600 font-medium mb-2 block hover:underline cursor-pointer">{tourSlotCounts[editingTour.id] ?? 0} upcoming open slots →</a>
                                )}
                                <p className="text-xs text-[var(--ck-text-muted)] mb-3">Creates one slot per selected day in the date range. Edit individual slots on the Slots page.</p>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Start Date</label>
                                        <input type="date" value={tourForm.slotStartDate} onChange={e => setTourForm({ ...tourForm, slotStartDate: e.target.value })}
                                            className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">End Date</label>
                                        <input type="date" value={tourForm.slotEndDate} onChange={e => setTourForm({ ...tourForm, slotEndDate: e.target.value })}
                                            min={tourForm.slotStartDate || undefined}
                                            className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" />
                                    </div>
                                </div>
                                <div className="mt-3">
                                    <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Start Time{tourForm.slotTimes.length > 1 ? "s" : ""} (SAST)</label>
                                    <div className="space-y-2">
                                        {tourForm.slotTimes.map((t, idx) => (
                                            <div key={idx} className="flex gap-2 items-center">
                                                <input type="time" value={t} onChange={e => { var times = [...tourForm.slotTimes]; times[idx] = e.target.value; setTourForm({ ...tourForm, slotTimes: times }); }}
                                                    className="ui-control flex-1 px-3 py-2 text-sm rounded-lg outline-none" />
                                                {tourForm.slotTimes.length > 1 && (
                                                    <button type="button" onClick={() => { var times = tourForm.slotTimes.filter((_, i) => i !== idx); setTourForm({ ...tourForm, slotTimes: times }); }}
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
                    </div>

                </div>
            </CollapsibleSection>

            <CollapsibleSection id="resources" title="Shared Resources & Capacity Pools" subtitle="Assets like vans, guides, kayaks that reduce availability across tours" openSections={openSections} toggle={toggleSection}>
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
            </CollapsibleSection>

            {isPrivileged(role) && (
                <CollapsibleSection id="external" title="External Booking Integration" subtitle="B2B partner API keys and mappings" openSections={openSections} toggle={toggleSection}>
                    <ExternalBookingSettings tours={tours.map((t) => ({ id: t.id, name: t.name }))} />
                </CollapsibleSection>
            )}

            <CollapsibleSection id="site" title="Booking Site Configuration" subtitle="These settings directly affect the public booking page" openSections={openSections} toggle={toggleSection}>
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
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Logo URL <span className="text-[var(--ck-accent)]">— appears next to the business name in the dashboard sidebar</span></label>
                                <input type="url" value={siteSettings.logo_url} onChange={e => setSiteSettings({ ...siteSettings, logo_url: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="https://your-cdn.com/logo.png" />
                                <p className="text-xs text-[var(--ck-text-muted)] mt-1">
                                    Paste any direct image link here. To get one: right-click your logo on any website → <strong>Copy image address</strong> → paste it above.
                                    Or upload your logo at <a href="https://imgbb.com/" target="_blank" rel="noopener noreferrer" className="text-[var(--ck-accent)] hover:underline">imgbb.com</a> → after uploading, click the image thumbnail → copy the <strong>Direct link</strong> (ends in .png or .jpg).
                                    Leave empty to show the default icon.
                                </p>
                                {siteSettings.logo_url && (
                                    <img src={siteSettings.logo_url} alt="Logo preview" className="mt-2 h-10 object-contain rounded border border-[var(--ck-border-subtle)]" />
                                )}
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
                            {[
                                "https://lottie.host/f88dfbd9-9fbb-43af-9ac4-400d4f0b96ae/tc9tMgAjqf.lottie",
                                "https://lottie.host/b37e717c-85a0-4b3a-85ac-da0d0c21d0ce/6y2qqYBhTF.lottie",
                                "https://lottie.host/e1aecbea-cf94-47e8-aae2-5f59c567c6d9/zHX4Roi2Eb.lottie",
                                "https://lottie.host/deee1aa7-f9b1-4869-8191-b9dccacb0017/Inaq5Gmhwf.lottie",
                                "https://lottie.host/b73fce61-6b44-489d-9692-f0a769da24a4/dhP4Oftcxd.lottie",
                                "https://lottie.host/ec6b7394-d3cb-4e43-97b5-804cd66d76ad/QhsvIwZ3y8.lottie",
                                "https://lottie.host/ff097c6d-c89a-4206-9b49-002cb4536da9/VHw4byv4mh.lottie",
                                "https://lottie.host/4392b24a-4204-4e8d-9148-6744361410d6/c3f09SNsC0.lottie",
                                "https://lottie.host/f69dd8f8-82b1-476d-b903-d8aa74eba356/o2oHgsa2mD.lottie",
                                "https://lottie.host/0b80a0e1-bc90-4e40-9e0a-602afab059d1/HYkrm9Y0bN.lottie",
                                "https://lottie.host/28fea83d-7e0e-442d-9146-02fb112a8116/uUo4UHGopv.lottie"
                            ].map(url => {
                                const isSelected = siteSettings.chatbot_avatar === url;
                                return (
                                    <div key={url}
                                        onClick={() => setSiteSettings({ ...siteSettings, chatbot_avatar: url })}
                                        className={"relative cursor-pointer transition-all hover:scale-105 rounded-xl p-1 " + (isSelected ? "bg-[var(--ck-accent)] ring-2 ring-offset-2 ring-[var(--ck-accent)]" : "bg-transparent")}
                                    >
                                        <div className="w-16 h-16 bg-[var(--ck-surface)] rounded-lg flex items-center justify-center shadow-inner overflow-hidden border border-[var(--ck-border-subtle)]"
                                            dangerouslySetInnerHTML={{ __html: `<dotlottie-wc src="${url}" style="width: 100%; height: 100%" autoplay loop></dotlottie-wc>` }}
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
            </CollapsibleSection>

            <CollapsibleSection id="email" title="Email Customisation" subtitle="Colour theme and banner images for each email type" openSections={openSections} toggle={toggleSection}>
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
                                            <input type="file" accept="image/*" className="hidden" onChange={e => { var f = e.target.files?.[0]; if (f) handleUploadEmailImage(key, f); e.target.value = ""; }} />
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
                            {emailImgsSaving ? "Saving..." : "Save Email Images"}
                        </button>
                    </div>
                </form>
            </CollapsibleSection>

            <CollapsibleSection id="credentials" title="Integration Credentials" subtitle="AES-256 encrypted at rest. Update each integration independently." openSections={openSections} toggle={toggleSection}>
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

                </div>

                {credMessage.text && (
                    <div className={"mt-4 p-3 rounded-xl text-sm font-medium " + (credMessage.type === "error" ? "bg-red-50 border border-red-200 text-[var(--ck-danger)]" : "bg-emerald-50 border border-emerald-200 text-emerald-700")}>
                        {credMessage.text}
                    </div>
                )}
            </CollapsibleSection>

            </div>
        </div >
    );
}
