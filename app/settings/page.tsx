"use client";
import { renderGiftVoucherFace } from "../../supabase/functions/_shared/gift-voucher-face";
import { formatZar } from "../lib/money";
import GuideAccessSettings from "@/components/guide/GuideAccessSettings";
import { useState, useEffect, ReactNode } from "react";
import Link from "next/link";
import { confirmAction, notify } from "../lib/app-notify";
import { formatDuration } from "../lib/duration";
import { OPERATOR_HIDEABLE_SECTIONS } from "../lib/operator-sections";
import { supabase } from "../lib/supabase";
import { functionError } from "../lib/function-error";
import { sendAdminSetupLink, getAuthHeaders } from "../lib/admin-auth";
import { SETTINGS_SECTIONS } from "../lib/settings-sections";
import { BOOKING_PALETTES } from "../lib/booking-palettes";
import { getAdminTimezone, setAdminTimezone, normalize24HourTime } from "../lib/admin-timezone";
import { buildTourSlotStartTimes } from "../lib/tour-slot-generation";
import { useBusinessContext } from "../../components/BusinessContext";
import DataRequestBadge from "../../components/DataRequestBadge";
import BookingSitePreview from "../../components/booking/BookingSitePreview";
import dynamic from "next/dynamic";
import { CaretDown } from "@phosphor-icons/react";
import { DatePicker } from "../../components/DatePicker";
import WhatsAppBotSection from "./components/WhatsAppBotSection";
import EmailWordingSection, { type EmailOverrides } from "./components/EmailWordingSection";
import { DemoFeatureLink } from "../../components/DemoActionGuide";
import { isDemoPathVisible } from "../lib/demo-guide";
import RemoveIntegrationButton from "../../components/RemoveIntegrationButton";
import AdminContactEditor from "../../components/AdminContactEditor";

function CollapsibleSection({ id, title, subtitle, children, defaultOpen = false, openSections, toggle }: {
    id: string; title: string; subtitle?: string; children: ReactNode; defaultOpen?: boolean;
    openSections: Record<string, boolean>; toggle: (id: string) => void;
}) {
    const isOpen = openSections[id] ?? defaultOpen;
    return (
        <div id={id} className="ui-card anim-fade-up scroll-mt-6 overflow-hidden">
            <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`${id}-content`}
                onClick={() => toggle(id)}
                className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-[var(--ck-surface-sunken)]"
            >
                <div className="min-w-0">
                    <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--ck-text-strong)]">{title}</h2>
                    {subtitle && <p className="text-[12px] text-[var(--ck-text-muted)] mt-0.5 leading-snug">{subtitle}</p>}
                </div>
                <CaretDown size={18} weight="bold" className={"shrink-0 text-[var(--ck-text-muted)] transition-transform duration-200 " + (isOpen ? "rotate-180" : "")} />
            </button>
            {isOpen && <div id={`${id}-content`} className="px-5 pb-5 pt-3 border-t border-[var(--ck-border-subtle)]"><DemoFeatureLink feature={id} />{children}</div>}
        </div>
    );
}
const RichTextEditor = dynamic(() => import("../../components/RichTextEditor"), { ssr: false, loading: () => <div className="h-40 ui-skeleton" /> });
const ExternalBookingSettings = dynamic(() => import("../../components/ExternalBookingSettings"), { ssr: false });
import { fetchUsageSnapshot, type UsageSnapshot } from "../lib/billing";
import InlineSlotManager from "../../components/InlineSlotManager";

// SUPER_ADMIN has every right that MAIN_ADMIN has, plus cross-tenant access.
function isPrivileged(r: string | null) {
    return r === "MAIN_ADMIN" || r === "SUPER_ADMIN";
}

// Personal (per-admin) preference — stored on the caller's own admin_users row
// via self-scoped RPCs, so it follows them across devices. Not gated by
// settings_permissions: every Settings viewer manages only their own bubble.
function HelpAssistantSection() {
    const [hidden, setHidden] = useState<boolean | null>(null);

    useEffect(() => {
        let cancelled = false;
        supabase.rpc("get_my_admin_onboarding").then(({ data }) => {
            if (!cancelled) setHidden(!!(Array.isArray(data) && data[0]?.help_chat_hidden));
        });
        return () => { cancelled = true; };
    }, []);

    async function toggle(next: boolean) {
        setHidden(next);
        const { error } = await supabase.rpc("set_my_help_chat_hidden", { p_hidden: next });
        if (error) {
            setHidden(!next);
            notify({ message: "Couldn't save the preference: " + error.message, tone: "error" });
            return;
        }
        // HelpChat (mounted in AppShell) listens for this so the bubble reacts instantly.
        window.dispatchEvent(new CustomEvent("ck-help-chat-hidden", { detail: { hidden: next } }));
        notify({ message: next ? "Help assistant hidden. Turn it on here any time." : "Help assistant is back.", tone: "success" });
    }

    return (
        <div className="flex items-start justify-between gap-4">
            <div>
                <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">Help assistant bubble</h3>
                <p className="mt-1 text-xs text-[var(--ck-text-muted)]">
                    Dashboard help chat. This setting applies only to your account.
                </p>
            </div>
            <label className="flex shrink-0 cursor-pointer items-center gap-2">
                <input data-demo-action="assistant.toggle"
                    type="checkbox"
                    checked={hidden === null ? true : !hidden}
                    disabled={hidden === null}
                    onChange={(e) => toggle(!e.target.checked)}
                    className="h-4 w-4 accent-[var(--ck-accent)]"
                />
                <span className="text-sm text-[var(--ck-text)]">Show</span>
            </label>
        </div>
    );
}

// Settings sections that MAIN_ADMIN can grant to regular admins
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
    // Blank, not seeded copy: the storefront renders its own POPIA-aligned
    // template whenever these are empty, and the old seed text named another
    // operator and was long enough to defeat that fallback once saved.
    privacy_policy: "",
    cookies_policy: "",
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
    hero_image: "",
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
    public_email: "",
    public_phone: "",
    public_whatsapp: "",
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
    voucher_image_url: string | null;
    hidden: boolean;
    confirmation_tagline: string | null;
    last_minute_hours: number | null;
    last_minute_end_hours: number | null;
    last_minute_price: number | null;
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
    const { businessId, refreshBusiness, readOnly } = useBusinessContext();
    const [admins, setAdmins] = useState<any[]>([]);
    const usedAdminSeats = admins.filter(a => !a.suspended).length;
    const [billingAdminId, setBillingAdminId] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const [role, setRole] = useState<string | null>(null);
    const [myEmail, setMyEmail] = useState<string | null>(null);
    const [changingRole, setChangingRole] = useState<string | null>(null);

    // Collapsible section state
    const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
    function toggleSection(id: string) { setOpenSections((prev) => ({ ...prev, [id]: !(prev[id] ?? false) })); }
    useEffect(() => {
        const openLinkedSection = () => {
            const id = window.location.hash.slice(1);
            if (id) setOpenSections(prev => ({ ...prev, [id === "add-admin" ? "admins" : id]: true }));
        };
        openLinkedSection();
        window.addEventListener("hashchange", openLinkedSection);
        return () => window.removeEventListener("hashchange", openLinkedSection);
    }, []);
    useEffect(() => {
        if (!loading && openSections.admins && window.location.hash === "#add-admin") {
            const heading = document.getElementById("add-admin");
            heading?.focus();
            heading?.scrollIntoView({ block: "start" });
        }
    }, [loading, openSections.admins]);

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
    const [tourForm, setTourForm] = useState({ name: "", description: "", confirmationTagline: "", price: "", lastMinuteHours: "", lastMinuteEndHours: "", lastMinutePrice: "", duration: "", durationMinutes: "0", durationUnit: "min" as "min" | "hours" | "days", sort_order: "0", active: true, image_url: "", voucher_image_url: "", default_capacity: "10", slotDateMode: "range" as "range" | "specific", slotDates: [""] as string[], slotStartDate: "", slotEndDate: "", slotTimes: [""] as string[], slotDays: [0, 1, 2, 3, 4, 5, 6] as number[] });
    const [tourSaving, setTourSaving] = useState(false);
    const [tourError, setTourError] = useState("");
    const [slotMessage, setSlotMessage] = useState("");
    const [slotGenerating, setSlotGenerating] = useState(false);
    const [tourSlotCounts, setTourSlotCounts] = useState<Record<string, number>>({});

    // Site Settings State
    const [siteSettings, setSiteSettings] = useState(DEFAULT_SITE_SETTINGS);
    const selectedPalette = Object.entries(BOOKING_PALETTES).find(([, colors]) =>
        Object.entries(colors).every(([key, value]) => siteSettings[key as keyof typeof colors].toLowerCase() === value.toLowerCase())
    )?.[0] || "";
    const [subdomain, setSubdomain] = useState<string | null>(null);
    // The tenant's booking site, for deep links to a single tour.
    const bookingSiteBase = (siteSettings.booking_site_url || (subdomain ? "https://" + subdomain + ".booking.bookingtours.co.za" : "")).replace(/\/+$/, "");
    // Custom booking questions — edited as a plain form; serialised to the
    // businesses.booking_custom_fields JSON array on save (same structure the
    // admin new-booking form and the chat bots already consume).
    type BookingQuestion = { key: string; label: string; type: string; required: boolean; placeholder: string; [setting: string]: unknown };
    const [bookingQuestions, setBookingQuestions] = useState<BookingQuestion[]>([]);
    const [questionsSaving, setQuestionsSaving] = useState(false);
    const [questionsMessage, setQuestionsMessage] = useState<{ type: string; text: string }>({ type: "", text: "" });
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
    const [emailTagline, setEmailTagline] = useState("");
    const [emailOverrides, setEmailOverrides] = useState<EmailOverrides>({});
    const [activityVerbPast, setActivityVerbPast] = useState("");
    const [locationPhrase, setLocationPhrase] = useState("");
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
    const [credentialRemoving, setCredentialRemoving] = useState(false);
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
    const [bankDirty, setBankDirty] = useState(false);
    const [bankLoadError, setBankLoadError] = useState("");
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
        setMyEmail(localStorage.getItem("ck_admin_email"));
        if (isPrivileged(r)) {
            fetchAdmins();
            fetchTours();
            fetchSiteSettings();
            fetchPlanUsage();
            fetchCredStatus();
            checkGdriveStatus();
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
            if (perms.site || perms.email || perms.invoice) fetchSiteSettings();
            if (perms.credentials) { fetchCredStatus(); checkGdriveStatus(); }
        }
        setLoading(false);
    }

    async function fetchAdmins() {
        setLoading(true);
        const { data, error } = await supabase.from("admin_users").select("id, name, email, phone, role, suspended, created_at, password_set_at, must_set_password, invite_sent_at, settings_permissions").eq("business_id", businessId).order("created_at");
        if (data) setAdmins(data.filter(a => a.role !== "SUPER_ADMIN"));
        const { data: biz } = await supabase.from("businesses").select("billing_admin_user_id").eq("id", businessId).maybeSingle();
        setBillingAdminId(biz?.billing_admin_user_id || "");
        setLoading(false);
    }

    async function saveBillingContact(adminId: string) {
        setBillingAdminId(adminId);
        const { error } = await supabase.from("businesses").update({ billing_admin_user_id: adminId || null }).eq("id", businessId);
        notify(error
            ? { message: "Failed to update billing contact: " + error.message, tone: "error" }
            : { message: adminId ? "Billing contact updated. BookingTours invoices go to them now." : "Billing contact reset. Invoices go to the first admin on the account.", tone: "success" });
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
        if (usedAdminSeats >= seatLimit) return setError("Admin seat limit reached for your current plan (" + seatLimit + "). Upgrade to add more admins.");

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
                setError("Admin added, but email couldn't be delivered: " + emailErrMsg + ". Set a verified EMAIL_FROM domain in the Supabase send-email function secrets.");
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
                setError("Setup link was saved, but the email couldn't be delivered: " + resendErrMsg + ". Set a verified EMAIL_FROM domain in the Supabase send-email function secrets.");
            } else {
                setError("Failed to send a password setup email to " + admin.email + "." + (resendErrMsg ? " (" + resendErrMsg + ")" : ""));
            }
        }
        setResendingAdminId("");
    }

    function adminPasswordStatus(admin: any) {
        if (admin.must_set_password || !admin.password_set_at) {
            const sentLabel = admin.invite_sent_at ? "Setup email sent " + new Date(admin.invite_sent_at).toLocaleDateString() : "Setup email not sent yet";
            return { label: "Password setup pending", detail: sentLabel, tone: "text-[var(--ck-warning)]" };
        }

        return {
            label: "Password created",
            detail: "Created " + new Date(admin.password_set_at).toLocaleDateString(),
            tone: "text-[var(--ck-success)]",
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
        setTourForm({ name: "", description: "", confirmationTagline: "", price: "", lastMinuteHours: "", lastMinuteEndHours: "", lastMinutePrice: "", duration: "", durationMinutes: "0", durationUnit: "min", sort_order: "0", active: true, image_url: "", voucher_image_url: "", default_capacity: "10", slotDateMode: "range", slotDates: [""], slotStartDate: "", slotEndDate: "", slotTimes: [""], slotDays: [0, 1, 2, 3, 4, 5, 6] });
        setTourError("");
    }

    const DURATION_UNIT_MINUTES = { min: 1, hours: 60, days: 1440 } as const;

    function minutesToDurationForm(m: number | null) {
        const mins = Number(m || 0);
        if (mins >= 1440 && mins % 1440 === 0) return { duration: String(mins / 1440), durationUnit: "days" as const, durationMinutes: "0" };
        if (mins >= 60) return { duration: String(Math.floor(mins / 60)), durationUnit: "hours" as const, durationMinutes: String(mins % 60) };
        return { duration: String(mins || ""), durationUnit: "min" as const, durationMinutes: "0" };
    }

    function startEditTour(t: Tour) {
        setEditingTour(t);
        setTourForm({
            name: t.name,
            description: t.description || "",
            confirmationTagline: t.confirmation_tagline || "",
            price: String(t.base_price_per_person || ""),
            lastMinuteHours: t.last_minute_hours != null ? String(t.last_minute_hours) : "",
            // A deal saved before cut-offs existed ran to departure, i.e. 0.
            lastMinuteEndHours: t.last_minute_end_hours != null ? String(t.last_minute_end_hours) : (t.last_minute_hours != null ? "0" : ""),
            lastMinutePrice: t.last_minute_price != null ? String(t.last_minute_price) : "",
            ...minutesToDurationForm(t.duration_minutes),
            sort_order: String(t.sort_order || 0),
            active: t.active,
            image_url: t.image_url || "",
            voucher_image_url: t.voucher_image_url || "",
            default_capacity: String((t as any).default_capacity || 10),
            slotDateMode: "range",
            slotDates: [""],
            slotStartDate: "",
            slotEndDate: "",
            slotTimes: [""],
            slotDays: [0, 1, 2, 3, 4, 5, 6],
        });
        setTourError("");
    }

    const tourTimezone = getAdminTimezone();

    const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    function toggleDay(day: number) {
        setTourForm(prev => {
            const days = prev.slotDays.includes(day) ? prev.slotDays.filter(d => d !== day) : [...prev.slotDays, day];
            return { ...prev, slotDays: days };
        });
    }

    const hasSlotDates = tourForm.slotDateMode === "specific"
        ? tourForm.slotDates.some(Boolean)
        : !!tourForm.slotStartDate && !!tourForm.slotEndDate && tourForm.slotDays.length > 0;
    const canGenerateSlots = hasSlotDates && tourForm.slotTimes.some(t => t.trim() !== "");

    async function generateSlotsForTour(tourId: string): Promise<{ created: number; skipped: number } | null> {
        try {
            const slots = buildTourSlotStartTimes(tourForm, tourTimezone).map(start_time => ({
                business_id: businessId,
                tour_id: tourId,
                start_time,
                capacity_total: Number(tourForm.default_capacity) || 10,
                booked: 0,
                held: 0,
                status: "OPEN",
            }));
            const { data: inserted, error: slotErr } = await supabase
                .from("slots")
                .upsert(slots, { onConflict: "business_id,tour_id,start_time", ignoreDuplicates: true })
                .select("id");
            if (slotErr) throw new Error("Slots failed: " + slotErr.message);
            const created = inserted?.length ?? 0;
            return { created, skipped: slots.length - created };
        } catch (error) {
            setTourError(error instanceof Error ? error.message : "Could not generate slots. Please try again.");
            return null;
        }
    }

    async function handleGenerateSlots() {
        if (!editingTour) return;
        setSlotGenerating(true);
        setTourError("");
        setSlotMessage("");
        const result = await generateSlotsForTour(editingTour.id);
        if (result) {
            const { created, skipped } = result;
            const parts: string[] = [];
            if (created > 0) parts.push(`${created} slot${created !== 1 ? "s" : ""} generated`);
            if (skipped > 0) parts.push(`${skipped} already existed and were skipped`);
            setSlotMessage(parts.join("; ") + " for " + editingTour.name + ".");
            setTimeout(() => setSlotMessage(""), 6000);
            if (created > 0) fetchSlotCounts(tours.map(t => t.id));
        }
        setSlotGenerating(false);
    }

    async function handleSaveTour(e: React.FormEvent) {
        e.preventDefault();
        if (!tourForm.name.trim()) return setTourError("Name is required");
        if (!tourForm.price || Number(tourForm.price) <= 0) return setTourError("Price must be greater than 0");
        const duration = Number(tourForm.duration);
        const extraMinutes = tourForm.durationUnit === "hours" ? Number(tourForm.durationMinutes || 0) : 0;
        const durationMinutes = duration * DURATION_UNIT_MINUTES[tourForm.durationUnit] + extraMinutes;
        if (tourForm.duration === "" || !Number.isInteger(duration) || duration < 0 || !Number.isInteger(extraMinutes) || extraMinutes < 0 || extraMinutes > 59 || !Number.isSafeInteger(durationMinutes) || durationMinutes <= 0) return setTourError("Enter a duration above zero: whole hours plus 0 to 59 minutes.");
        const autoGenerateSlots = !editingTour && (tourForm.slotTimes.some(t => t.trim() !== "") || (tourForm.slotDateMode === "specific" ? tourForm.slotDates.some(Boolean) : !!tourForm.slotStartDate || !!tourForm.slotEndDate));
        if (autoGenerateSlots) {
            try {
                buildTourSlotStartTimes(tourForm, tourTimezone);
            } catch (error) {
                return setTourError(error instanceof Error ? error.message : "Please check the departure dates and times.");
            }
        }
        const lmHours = tourForm.lastMinuteHours.trim() === "" ? null : Number(tourForm.lastMinuteHours);
        const lmEndHours = tourForm.lastMinuteEndHours.trim() === "" ? null : Number(tourForm.lastMinuteEndHours);
        const lmPrice = tourForm.lastMinutePrice.trim() === "" ? null : Number(tourForm.lastMinutePrice);
        const lmSet = [lmHours, lmEndHours, lmPrice].filter(v => v !== null).length;
        if (lmSet > 0 && lmSet < 3) return setTourError("Enter a start, cut-off and price. Clear all three to turn off the deal.");
        // Capped at 30 days: a mistyped 480 instead of 48 would otherwise discount
        // a month of departures before anyone noticed.
        if (lmHours !== null && (lmHours <= 0 || lmHours > 720)) return setTourError("Last-minute start must be between 1 and 720 hours (30 days) before departure");
        if (lmEndHours !== null && (lmEndHours < 0 || lmEndHours >= (lmHours as number))) return setTourError("Last-minute cut-off must be closer to departure than the start (0 runs the deal to departure)");
        if (lmPrice !== null && (lmPrice <= 0 || lmPrice >= Number(tourForm.price))) return setTourError("Last-minute price must be greater than 0 and lower than the normal price");

        setTourSaving(true);
        setTourError("");

        const payload = {
            name: tourForm.name.trim(),
            description: tourForm.description.trim() || null,
            confirmation_tagline: tourForm.confirmationTagline.trim() || null,
            base_price_per_person: Number(tourForm.price),
            last_minute_hours: lmHours,
            last_minute_end_hours: lmEndHours,
            last_minute_price: lmPrice,
            duration_minutes: durationMinutes,
            sort_order: Number(tourForm.sort_order) || 0,
            active: tourForm.active,
            image_url: tourForm.image_url.trim() || null,
            voucher_image_url: tourForm.voucher_image_url.trim() || null,
            default_capacity: Number(tourForm.default_capacity) || 10,
        };

        if (editingTour) {
            const { error: upErr } = await supabase.from("tours").update(payload).eq("id", editingTour.id);
            if (upErr) { setTourError("Failed: " + upErr.message); setTourSaving(false); return; }
        } else {
            const { data: newTour, error: inErr } = await supabase.from("tours").insert({ ...payload, business_id: businessId }).select().single();
            if (inErr) { setTourError("Failed: " + inErr.message); setTourSaving(false); return; }

            if (newTour && autoGenerateSlots) {
                const result = await generateSlotsForTour(newTour.id);
                if (!result) {
                    // Keep the chosen schedule available to retry without creating another tour.
                    setEditingTour(newTour as Tour);
                    setTourError(message => "Tour created. " + message + " Choose Generate Slots to retry.");
                    setTourSaving(false);
                    fetchTours();
                    return;
                }
                const { created, skipped } = result;
                if (created > 0 || skipped > 0) {
                    const parts: string[] = [];
                    if (created > 0) parts.push(`${created} slot${created !== 1 ? "s" : ""} generated`);
                    if (skipped > 0) parts.push(`${skipped} already existed`);
                    setSlotMessage("Tour created: " + parts.join(", ") + ".");
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

        // Any booking history (any status) blocks deletion — bookings must
        // never disappear because the tour they were made on was deleted.
        // The DB enforces this unconditionally too; this check exists so the
        // admin sees a clear message instead of a raw constraint error.
        const { count: bookingCount } = await supabase
            .from("bookings")
            .select("id", { count: "exact", head: true })
            .eq("business_id", businessId)
            .eq("tour_id", id);

        if ((bookingCount || 0) > 0) {
            notify({
                title: "Cannot delete tour",
                message: bookingCount + " booking(s) exist for \"" + name + "\". Deactivate the tour instead; deleting it would abandon that booking history.",
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
            // 23503 = foreign_key_violation. A friendly message beats the raw
            // Postgres constraint text reaching the admin, for whatever
            // dependency the checks above didn't anticipate.
            const message = (delErr as { code?: string }).code === "23503"
                ? "This tour still has related records (bookings, combo offers, or other data) that need to be removed first. Try deactivating the tour instead."
                : delErr.message;
            notify({ title: "Delete failed", message, tone: "error" });
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

    async function handleChangeRole(admin: { id: string; name?: string | null; email: string; role: string }, newRole: "ADMIN" | "MAIN_ADMIN") {
        const label = admin.name || admin.email;
        const promoting = newRole === "MAIN_ADMIN";
        if (!await confirmAction({
            title: promoting ? "Make Main Admin" : "Change to Admin",
            message: promoting
                ? `Give ${label} full Main Admin access (settings, billing, admin management)?`
                : `Reduce ${label} to a regular Admin? They'll lose settings, billing and admin-management access.`,
            tone: "warning",
            confirmLabel: promoting ? "Make Main Admin" : "Change to Admin",
        })) return;

        setChangingRole(admin.id);
        const res = await fetch("/api/admin/update", {
            method: "POST",
            headers: await getAuthHeaders(),
            body: JSON.stringify({ action: "update_role", admin_id: admin.id, role: newRole }),
        });
        const data = await res.json().catch(() => ({}));
        setChangingRole(null);
        if (!res.ok) {
            notify({ title: "Couldn't change role", message: data?.error || "Unknown error", tone: "error" });
            return;
        }
        setAdmins(admins.map(x => x.id === admin.id ? { ...x, role: newRole } : x));
        notify({ title: "Role updated", message: `${label} is now ${promoting ? "a Main Admin" : "a regular Admin"}.`, tone: "success" });
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
        if (t.active && !await confirmAction({
            title: "Deactivate tour",
            message: "Deactivate \"" + t.name + "\"? Guests can't book it until you activate it again.",
            tone: "warning",
            confirmLabel: "Deactivate",
        })) return;
        const { error } = await supabase.from("tours").update({ active: !t.active }).eq("id", t.id).eq("business_id", businessId);
        if (error) tourUpdateFailed(error);
        fetchTours();
    }

    async function handleToggleHidden(t: Tour) {
        if (!t.hidden && !await confirmAction({
            title: "Hide tour",
            message: "Hide \"" + t.name + "\" from your booking site? It stays bookable through a direct link.",
            tone: "warning",
            confirmLabel: "Hide",
        })) return;
        const { error } = await supabase.from("tours").update({ hidden: !t.hidden }).eq("id", t.id).eq("business_id", businessId);
        if (error) tourUpdateFailed(error);
        fetchTours();
    }

    function tourUpdateFailed(error: unknown) {
        console.error("[settings] tour update failed", error);
        notify({ title: "Tour not updated", message: "The tour could not be updated. Please try again.", tone: "error" });
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
            message: "Remove this admin?",
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
                hero_image: data.hero_image || DEFAULT_SITE_SETTINGS.hero_image,
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
                public_email: data.public_email || DEFAULT_SITE_SETTINGS.public_email,
                public_phone: data.public_phone || DEFAULT_SITE_SETTINGS.public_phone,
                public_whatsapp: data.public_whatsapp || DEFAULT_SITE_SETTINGS.public_whatsapp,
                timezone: data.timezone || DEFAULT_SITE_SETTINGS.timezone,
            });
            setSubdomain(data.subdomain || null);
            setBookingQuestions((Array.isArray(data.booking_custom_fields) ? data.booking_custom_fields : [])
                .filter((f: any) => f && (f.key || f.id || f.label))
                .map((f: any) => ({
                    ...f,
                    key: String(f.key || f.id || ""),
                    label: String(f.label || ""),
                    type: typeof f.type === "string" ? f.type : "text",
                    required: !!f.required,
                    placeholder: String(f.placeholder || ""),
                })));
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
            setEmailTagline(data.email_tagline || "");
            setEmailOverrides(data.email_overrides && typeof data.email_overrides === "object" ? data.email_overrides : {});
            setActivityVerbPast(data.activity_verb_past || "");
            setLocationPhrase(data.location_phrase || "");
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
            // Bank details fetched separately via encrypted edge function.
            // Always name the target business: this runs before the role
            // state is set, and the function only reads it for super-admins.
            supabase.functions.invoke("bank-details", {
                body: { action: "get", business_id: businessId },
                headers: { "x-admin-business-id": businessId },
            }).then(async (bankRes) => {
                const failure = await functionError(bankRes, "Please refresh the page and try again.");
                setBankLoadError(failure ? "Banking details could not be loaded: " + failure : "");
                // On failure clear the form, so it never shows another business's details.
                const bankData = failure ? null : bankRes.data;
                setBankForm({
                    account_owner: bankData?.account_owner || "",
                    account_number: bankData?.account_number || "",
                    account_type: bankData?.account_type || "",
                    bank_name: bankData?.bank_name || "",
                    branch_code: bankData?.branch_code || "",
                });
                setBankDirty(false);
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
                ? "Block dashboard access for all admins?"
                : "Restore dashboard access for all admins?",
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

    // Serialise the plain-form questions back into the booking_custom_fields
    // JSON array (same shape the new-booking form and bots consume). Keys are
    // stable once assigned — answers in bookings.custom_fields are keyed on
    // them — so only brand-new questions get a generated key.
    async function saveBookingQuestions() {
        setQuestionsSaving(true);
        const cleaned = bookingQuestions
            .filter(q => q.label.trim())
            .map((q, i) => ({
                ...q,
                key: q.key || (q.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "question") + "_" + Date.now().toString().slice(-4) + i,
                label: q.label.trim(),
                type: q.type,
                required: q.required,
                ...(q.placeholder.trim() ? { placeholder: q.placeholder.trim() } : {}),
            }));
        const { error } = await supabase.from("businesses").update({ booking_custom_fields: cleaned }).eq("id", businessId);
        if (error) {
            setQuestionsMessage({ type: "error", text: "Failed to save questions: " + error.message });
        } else {
            setBookingQuestions(cleaned.map(f => ({ ...f, placeholder: f.placeholder || "" })));
            setQuestionsMessage({ type: "success", text: "Booking questions saved." });
            setTimeout(() => setQuestionsMessage({ type: "", text: "" }), 3000);
        }
        setQuestionsSaving(false);
    }

    async function handleSaveSiteSettings(e: React.FormEvent) {
        e.preventDefault();
        setSiteSaving(true);
        setSiteMessage({ type: "", text: "" });

        // Get the single business row that exists
        const { data: biz } = await supabase.from("businesses").select("id").eq("id", businessId).maybeSingle();
        if (!biz) {
            setSiteMessage({ type: "error", text: "No business record found to update." });
            setSiteSaving(false);
            return;
        }

        // Theme colors are consumed by the public booking site — reject
        // non-hex values here so garbage never reaches the tenant theme row.
        const HEX_RE = /^#?[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/;
        const colorFields = ["color_main", "color_secondary", "color_cta", "color_bg", "color_nav", "color_hover"] as const;
        for (const key of colorFields) {
            const raw = String((siteSettings as any)[key] || "").trim();
            if (!HEX_RE.test(raw)) {
                setSiteMessage({ type: "error", text: `"${key.replace("color_", "").replace("_", " ")}" color must be a hex value like #1F7A8C (got "${raw}").` });
                setSiteSaving(false);
                return;
            }
        }
        const normHex = (v: string) => {
            let h = v.trim().replace(/^#/, "").toLowerCase();
            if (h.length === 3) h = h.split("").map((c) => c + c).join("");
            return "#" + h;
        };

        const { error } = await supabase.from("businesses").update({
            directions: siteSettings.directions,
            terms_conditions: siteSettings.terms_conditions,
            privacy_policy: siteSettings.privacy_policy,
            cookies_policy: siteSettings.cookies_policy,
            color_main: normHex(siteSettings.color_main),
            color_secondary: normHex(siteSettings.color_secondary),
            color_cta: normHex(siteSettings.color_cta),
            color_bg: normHex(siteSettings.color_bg),
            color_nav: normHex(siteSettings.color_nav),
            color_hover: normHex(siteSettings.color_hover),
            chatbot_avatar: siteSettings.chatbot_avatar,
            hero_eyebrow: siteSettings.hero_eyebrow || null,
            hero_title: siteSettings.hero_title || null,
            hero_subtitle: siteSettings.hero_subtitle || null,
            hero_image: siteSettings.hero_image || null,
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
            public_email: siteSettings.public_email || null,
            public_phone: siteSettings.public_phone || null,
            public_whatsapp: siteSettings.public_whatsapp || null,
            timezone: siteSettings.timezone || DEFAULT_SITE_SETTINGS.timezone,
        }).eq("id", biz.id);

        if (error) {
            setSiteMessage({ type: "error", text: "Error saving: " + error.message });
        } else {
            setAdminTimezone(siteSettings.timezone || DEFAULT_SITE_SETTINGS.timezone);
            setSiteMessage({ type: "success", text: "Site settings saved successfully!" });
            setTimeout(() => setSiteMessage({ type: "", text: "" }), 3000);
            // Z1: business_name / logo_url are read by the sidebar via
            // BusinessContext; re-fetch so the change appears without a
            // hard page reload.
            if (refreshBusiness) await refreshBusiness();
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
        if (readOnly) return;
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

        if (isPrivileged(role) && bankDirty) {
            const bankRes = await supabase.functions.invoke("bank-details", {
                body: {
                    action: "set",
                    business_id: businessId,
                    account_owner: bankForm.account_owner || null,
                    account_number: bankForm.account_number || null,
                    account_type: bankForm.account_type || null,
                    bank_name: bankForm.bank_name || null,
                    branch_code: bankForm.branch_code || null,
                },
                headers: { "x-admin-business-id": businessId },
            });
            const bankFailure = await functionError(bankRes, "Please try again.");
            if (bankFailure || !bankRes.data?.success) {
                setInvoiceMessage({ type: "error", text: "Bank details failed: " + (bankFailure || "Please try again.") });
                setInvoiceSaving(false);
                return;
            }
            setBankDirty(false);
        }

        setInvoiceMessage({ type: "success", text: bankDirty ? "Invoice and banking details saved." : "Invoice details saved." });
        setTimeout(() => setInvoiceMessage({ type: "", text: "" }), 3000);
        setInvoiceSaving(false);
    }


    async function fetchCredStatus() {
        try {
            const headers = await getAuthHeaders(businessId);
            const res = await fetch("/api/credentials?business_id=" + businessId, { headers });
            if (res.ok) setCredStatus(await res.json());
        } catch (e) {
            console.error("Failed to load credential status:", e);
        }
    }

    function handleCredentialsRemoved(section: "wa" | "yoco" | "yoco_test") {
        setCredStatus(current => current && { ...current, [section]: false });
        setCredMessage({ type: "", text: "" });
    }

    async function handleSaveWa(e: React.FormEvent) {
        e.preventDefault();
        if (readOnly) return;
        setWaSaving(true);
        setCredMessage({ type: "", text: "" });
        try {
            const res = await fetch("/api/credentials", {
                method: "POST",
                headers: await getAuthHeaders(businessId),
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
        if (readOnly) return;
        setYocoSaving(true);
        setCredMessage({ type: "", text: "" });
        try {
            const res = await fetch("/api/credentials", {
                method: "POST",
                headers: await getAuthHeaders(businessId),
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
        if (readOnly) return;
        setTestModeToggling(true);
        setCredMessage({ type: "", text: "" });
        const newMode = !(credStatus?.yoco_test_mode);
        try {
            const res = await fetch("/api/credentials", {
                method: "POST",
                headers: await getAuthHeaders(businessId),
                body: JSON.stringify({ business_id: businessId, section: "yoco_test_mode", yoco_test_mode: newMode }),
            });
            const d = await res.json();
            if (!res.ok || d.error) throw new Error(d.error || "Toggle failed");
            setCredMessage({ type: "success", text: newMode ? "Yoco test mode on. Payments use test keys." : "Yoco test mode off. Live payments active." });
            fetchCredStatus();
        } catch (err: any) {
            setCredMessage({ type: "error", text: String(err?.message || "Failed to toggle test mode.") });
        }
        setTestModeToggling(false);
    }

    async function handleSaveYocoTest(e: React.FormEvent) {
        e.preventDefault();
        if (readOnly) return;
        setYocoTestSaving(true);
        setCredMessage({ type: "", text: "" });
        try {
            const res = await fetch("/api/credentials", {
                method: "POST",
                headers: await getAuthHeaders(businessId),
                body: JSON.stringify({ business_id: businessId, section: "yoco_test", yoco_test_secret_key: yocoTestForm.secretKey, yoco_test_webhook_secret: yocoTestForm.webhookSecret }),
            });
            const d = await res.json();
            if (!res.ok || d.error) throw new Error(d.error || "Save failed");
            setCredMessage({ type: "success", text: "Yoco test credentials saved and encrypted successfully." + (credStatus?.yoco_test_mode ? "" : " Enable Test Mode above before creating test payment links.") });
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
            const nonce = crypto.randomUUID();
            sessionStorage.setItem("google-drive-oauth-nonce", nonce);
            const { data, error } = await supabase.functions.invoke("google-drive", {
                body: {
                    action: "auth_url",
                    business_id: businessId,
                    return_origin: window.location.origin,
                    nonce,
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

    // Downscale/compress a photo in the browser so operators can upload
    // camera-size originals: longest edge capped, re-encoded as JPEG. Returns
    // the original file untouched if it's already small or not bitmap-decodable
    // (e.g. SVG).
    async function compressImage(file: File, maxEdge = 2560, quality = 0.82): Promise<File> {
        if (file.size < 600 * 1024 || file.type === "image/svg+xml" || file.type === "image/gif") return file;
        try {
            const bitmap = await createImageBitmap(file);
            const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
            const w = Math.round(bitmap.width * scale);
            const h = Math.round(bitmap.height * scale);
            const canvas = document.createElement("canvas");
            canvas.width = w; canvas.height = h;
            canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
            bitmap.close();
            const blob: Blob | null = await new Promise(res => canvas.toBlob(res, "image/jpeg", quality));
            if (!blob || blob.size >= file.size) return file;
            return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
        } catch {
            return file; // decode failed — let the normal size gate handle it
        }
    }

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
            const path = key === "gift" ? `${businessId}/gift-${Date.now()}.${ext}` : `${businessId}/${key}.${ext}`;
            const { error } = await supabase.storage.from("email-images").upload(path, file, { upsert: true });
            if (error) { notify("Upload failed: " + error.message); return; }
            const { data: urlData } = supabase.storage.from("email-images").getPublicUrl(path);
            setEmailImgs(prev => ({ ...prev, [key]: urlData.publicUrl }));
            notify("Image uploaded. Save email settings to keep it.");
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
            email_tagline: emailTagline.trim() || null,
            email_overrides: Object.fromEntries(Object.entries(emailOverrides)
                .map(([k, o]) => [k, Object.fromEntries(Object.entries(o).map(([f, v]) => [f, (v || "").trim()]).filter(([, v]) => v))])
                .filter(([, o]) => Object.keys(o).length)),
            activity_verb_past: activityVerbPast.trim() || null,
            location_phrase: locationPhrase.trim() || null,
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

    if (loading) return (
        <div className="max-w-4xl">
            <div className="mb-6">
                <div className="ui-skeleton h-3 w-24 mb-3" />
                <div className="ui-skeleton h-8 w-40" />
            </div>
            <div className="space-y-4">
                {[0, 1, 2, 3].map(i => <div key={i} className="ui-skeleton h-[68px] w-full !rounded-2xl" />)}
            </div>
        </div>
    );

    const hasAnyPerm = Object.values(myPerms).some(Boolean);
    if (!isPrivileged(role) && !hasAnyPerm) {
        return (
            <div className="max-w-2xl">
                <div className="anim-fade-up mb-6">
                    <p className="ui-mono-label mb-2">Admin Console</p>
                    <h1 className="font-display text-[28px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}>Settings</h1>
                </div>
                <div className="ui-card anim-fade-up anim-d1">
                    <div className="ui-empty">
                        <p className="text-[14px] font-medium" style={{ color: "var(--ck-text-strong)" }}>No settings access</p>
                        <p className="text-[13px] ui-text-muted">You do not have permission to view or manage admin settings.</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-4xl">
            <div className="anim-fade-up mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                <p className="ui-mono-label mb-2">Admin Console</p>
                <h1 className="font-display text-[28px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}>Settings</h1>
                </div>
                {isPrivileged(role) && <a href="#add-admin" onClick={() => setOpenSections(prev => ({ ...prev, admins: true }))} className="ui-btn ui-btn-primary">Add admin</a>}
            </div>

            <div className="space-y-4">

            {isPrivileged(role) && <CollapsibleSection id="admins" title="Admin Users" openSections={openSections} toggle={toggleSection}>
                <GuideAccessSettings />
                {/* Business logo — shown in the dashboard sidebar, the booking
                    site header, every customer email, and on invoices. Saves
                    immediately on upload/remove. */}
                <div className="mb-8 rounded-2xl border border-[var(--ck-border-subtle)] bg-[var(--ck-surface)] p-4">
                    <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-2">Business Logo <span className="text-[var(--ck-accent)]">(appears on the dashboard sidebar, booking site, all emails, and invoices)</span></label>
                    <div className="flex items-center gap-3">
                        {siteSettings.logo_url && (
                            <img src={siteSettings.logo_url} alt="Logo preview" className="h-10 w-10 object-contain rounded border border-[var(--ck-border-subtle)] shrink-0" />
                        )}
                        <label className={"inline-flex items-center gap-2 cursor-pointer rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-xs font-medium text-[var(--ck-text-strong)] hover:bg-[var(--ck-surface-sunken)] transition-colors" + (uploadingField === "logo" ? " opacity-50 pointer-events-none" : "")}>
                            {uploadingField === "logo" ? "Uploading..." : (siteSettings.logo_url ? "Change logo" : "Upload logo")}
                            <input data-demo-action="logo.upload" type="file" accept="image/*" className="hidden" onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                setUploadingField("logo");
                                await handleImageUpload(file, "email-images", businessId + "/branding", async (url) => {
                                    setSiteSettings(prev => ({ ...prev, logo_url: url }));
                                    const { error } = await supabase.from("businesses").update({ logo_url: url }).eq("id", businessId);
                                    notify(error ? { message: "Logo upload saved locally but failed to persist: " + error.message, tone: "error" } : { message: "Logo updated everywhere.", tone: "success" });
                                });
                                setUploadingField(null);
                                e.target.value = "";
                            }} />
                        </label>
                        {siteSettings.logo_url && (
                            <button data-demo-action="logo.remove" type="button" onClick={async () => {
                                setSiteSettings(prev => ({ ...prev, logo_url: "" }));
                                const { error } = await supabase.from("businesses").update({ logo_url: null }).eq("id", businessId);
                                notify(error ? { message: "Failed to remove logo: " + error.message, tone: "error" } : { message: "Logo removed.", tone: "success" });
                            }} className="text-xs text-[var(--ck-danger)] hover:underline">Remove</button>
                        )}
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                    <div className="flex items-center justify-between mb-4">
                        <span className="inline-flex items-center gap-2 rounded-full bg-[var(--ck-surface-sunken)] px-3 py-1">
                            <span className="font-display text-[15px] font-semibold tabular-nums text-[var(--ck-text-strong)] leading-none">{usedAdminSeats}</span>
                            <span className="ui-mono-label !text-[9.5px]">/ {usageSnapshot?.seat_limit || 10} seats</span>
                        </span>
                        <label className="flex items-center gap-2 text-xs text-[var(--ck-text-muted)]" title="Receives subscription invoices. Defaults to the first admin.">
                            Billing contact
                            <select data-demo-action="admin.billing" value={billingAdminId} onChange={e => saveBillingContact(e.target.value)} className="ui-control px-2 py-1.5 text-xs rounded-lg outline-none max-w-[180px]">
                                <option value="">First admin (default)</option>
                                {admins.map(a => <option key={a.id} value={a.id}>{a.name || a.email}</option>)}
                            </select>
                        </label>
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
                                        <div className="p-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 transition-colors hover:bg-[var(--ck-surface-warm)]">
                                            <div className="min-w-0">
                                                <div className="font-medium text-[var(--ck-text-strong)] text-sm">{a.name || a.email}</div>
                                                <div className="text-xs text-[var(--ck-text-muted)] mt-0.5">{a.email}</div>
                                                {a.phone && <div className="text-xs text-[var(--ck-text-muted)] mt-0.5">{a.phone}</div>}
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
                                            <div className="flex flex-wrap items-center gap-3">
                                                {a.role !== "SUPER_ADMIN" && a.email !== myEmail && (
                                                    <button data-demo-action={a.role === "MAIN_ADMIN" ? "admin.demote" : "admin.promote"}
                                                        onClick={() => handleChangeRole(a, a.role === "MAIN_ADMIN" ? "ADMIN" : "MAIN_ADMIN")}
                                                        disabled={changingRole === a.id}
                                                        className="text-sm font-medium hover:underline disabled:opacity-50 whitespace-nowrap"
                                                        style={{ color: "var(--ck-text-muted)" }}
                                                    >
                                                        {changingRole === a.id ? "Saving..." : (a.role === "MAIN_ADMIN" ? "Change to Admin" : "Make Main Admin")}
                                                    </button>
                                                )}
                                                {a.role !== "MAIN_ADMIN" && a.role !== "SUPER_ADMIN" && (
                                                    <button
                                                        onClick={() => setExpandedPermsAdmin(isExpanded ? null : a.id)}
                                                        className="text-[var(--ck-accent)] text-sm font-medium hover:underline whitespace-nowrap"
                                                    >
                                                        {isExpanded ? "Close" : "Permissions"}
                                                    </button>
                                                )}
                                                {a.role !== "SUPER_ADMIN" && (
                                                    <button data-demo-action={(a.must_set_password || !a.password_set_at) ? "admin.setup" : "admin.reset"}
                                                        onClick={() => handleResendSetup(a)}
                                                        disabled={resendingAdminId === a.id}
                                                        className="text-[var(--ck-accent)] text-sm font-medium hover:underline disabled:opacity-50 whitespace-nowrap"
                                                    >
                                                        {resendingAdminId === a.id ? "Sending..." : ((a.must_set_password || !a.password_set_at) ? "Send setup link" : "Email reset link")}
                                                    </button>
                                                )}
                                                {a.role !== "MAIN_ADMIN" && (
                                                    <button data-demo-action="admin.remove" onClick={() => handleDelete(a.id, a.role)} className="text-[var(--ck-danger)] text-sm font-medium hover:underline whitespace-nowrap">
                                                        Remove
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <div className="px-4 pb-4">
                                            <AdminContactEditor key={`${businessId}:${a.id}`} admin={a} businessId={businessId} disabled={readOnly} onSaved={updated => {
                                                setAdmins(rows => rows.map(row => row.id === updated.id ? { ...row, ...updated } : row));
                                                setMyEmail(localStorage.getItem("ck_admin_email"));
                                            }} />
                                        </div>
                                        {/* Expandable permissions panel */}
                                        {isExpanded && a.role !== "MAIN_ADMIN" && a.role !== "SUPER_ADMIN" && (
                                            <div className="px-4 pb-4 pt-1 bg-[var(--ck-surface-sunken)] border-t border-[var(--ck-border-subtle)]">
                                                <p className="text-xs font-semibold text-[var(--ck-text-strong)] mb-3">Settings page access for {a.name || a.email}</p>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                    {SETTINGS_SECTIONS.map(section => (
                                                        <label key={section.key} className="flex items-center gap-2 cursor-pointer select-none rounded-lg px-3 py-2 hover:bg-[var(--ck-surface)] transition-colors">
                                                            <input data-demo-action={perms[section.key] ? "admin.revoke" : "admin.grant"} data-demo-subject={section.label}
                                                                type="checkbox"
                                                                checked={perms[section.key] === true}
                                                                onChange={() => {
                                                                    const newPerms = { ...perms, [section.key]: !perms[section.key] };
                                                                    // Optimistic update
                                                                    setAdmins(admins.map(x => x.id === a.id ? { ...x, settings_permissions: newPerms } : x));
                                                                    handleSaveAdminPerms(a.id, newPerms);
                                                                }}
                                                                disabled={savingPerms === a.id}
                                                                className="h-4 w-4 rounded border-[var(--ck-border-strong)] accent-[var(--ck-accent)]"
                                                            />
                                                            <span className="text-xs text-[var(--ck-text)]">{section.label}</span>
                                                        </label>
                                                    ))}
                                                </div>
                                                <p className="text-xs font-semibold text-[var(--ck-text-strong)] mt-5 mb-1">Dashboard sections visible to {a.name || a.email}</p>
                                                <p className="text-[10px] text-[var(--ck-text-muted)] mb-3 leading-relaxed">Uncheck to hide sections. Billing, Chat FAQ and Data Requests require Main Admin access.</p>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                    {OPERATOR_HIDEABLE_SECTIONS.filter(section => !readOnly || !section.key.startsWith("/") || isDemoPathVisible(section.key)).map(section => {
                                                        const hideKey = `hide:${section.key}`;
                                                        const visible = perms[hideKey] !== true;
                                                        return (
                                                            <label key={section.key} className="flex items-center gap-2 cursor-pointer select-none rounded-lg px-3 py-2 hover:bg-[var(--ck-surface)] transition-colors">
                                                                <input data-demo-action={visible ? "admin.hide" : "admin.show"} data-demo-subject={section.label}
                                                                    type="checkbox"
                                                                    checked={visible}
                                                                    onChange={() => {
                                                                        const newPerms = { ...perms, [hideKey]: visible };
                                                                        setAdmins(admins.map(x => x.id === a.id ? { ...x, settings_permissions: newPerms } : x));
                                                                        handleSaveAdminPerms(a.id, newPerms);
                                                                    }}
                                                                    disabled={savingPerms === a.id}
                                                                    className="h-4 w-4 rounded border-[var(--ck-border-strong)] accent-[var(--ck-accent)]"
                                                                />
                                                                <span className="text-xs text-[var(--ck-text)]">{section.label}</span>
                                                            </label>
                                                        );
                                                    })}
                                                </div>
                                                <p className="text-[10px] text-[var(--ck-text-muted)] mt-3 leading-relaxed">
                                                    Only the Main Admin can manage banking details and admins.
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
                        <h2 id="add-admin" tabIndex={-1} className="scroll-mt-6 text-[15px] font-semibold tracking-[-0.01em] text-[var(--ck-text-strong)]">Add New Admin</h2>
                        <button data-demo-action={subscriptionStatus === "SUSPENDED" ? "admin.reactivate" : "admin.suspend"}
                            onClick={toggleSubscription}
                            disabled={togglingSubscription}
                            className={"text-[11px] font-medium px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 whitespace-nowrap " +
                                (subscriptionStatus === "SUSPENDED"
                                    ? "border-[var(--ck-success)] text-[var(--ck-success)] hover:bg-[var(--ck-success-soft)]"
                                    : "border-[var(--ck-danger)] text-[var(--ck-danger)] hover:bg-[var(--ck-danger-soft)]")}
                        >
                            {togglingSubscription ? "..." : (subscriptionStatus === "SUSPENDED" ? "Reactivate" : "Suspend")}
                        </button>
                    </div>
                    <form data-demo-submit="admin.add" onSubmit={handleAddAdmin} className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5 space-y-4">
                        {usedAdminSeats >= (usageSnapshot?.seat_limit || 10) ? (
                            <div className="p-3 rounded-xl text-sm" style={{ background: "var(--ck-warning-soft)", color: "var(--ck-warning)", border: "1px solid color-mix(in srgb, var(--ck-warning) 25%, transparent)" }}>
                                You have reached the admin seat limit for your plan ({usageSnapshot?.seat_limit || 10}).
                            </div>
                        ) : (
                            <>
                                <div>
                                    <label htmlFor="settings-admin-name" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Admin Name</label>
                                    <input id="settings-admin-name" type="text" required value={newName} onChange={e => setNewName(e.target.value)}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="e.g. Sarah Jacobs" />
                                </div>
                                <div>
                                    <label htmlFor="settings-admin-email" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Email Address</label>
                                    <input id="settings-admin-email" type="email" required value={newEmail} onChange={e => setNewEmail(e.target.value)}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="admin@example.com" />
                                </div>
                                <div>
                                    <div className="rounded-xl border border-[var(--ck-border-subtle)] bg-[var(--ck-bg)] p-3 text-xs text-[var(--ck-text-muted)]">
                                        The new admin gets an email to set their password.
                                    </div>
                                </div>
                                {error && <div className="text-xs text-[var(--ck-danger)] font-medium">{error}</div>}
                                {adminMessage && <div className="text-xs text-[var(--ck-success)] font-medium">{adminMessage}</div>}
                                <button type="submit" disabled={adding} className="ui-btn ui-btn-primary w-full disabled:opacity-50">
                                    {adding ? "Adding..." : "Add admin"}
                                </button>
                            </>
                        )}
                    </form>
                </div>
                </div>

                {/* Marketing test email recipient */}
                <div className="mt-6 pt-5 border-t border-[var(--ck-border-subtle)]">
                    <h3 className="text-sm font-semibold text-[var(--ck-text-strong)] mb-1">Marketing Test Email Recipient</h3>
                    <p className="text-xs text-[var(--ck-text-muted)] mb-3">Choose who receives test marketing emails.</p>
                    <div className="flex items-end gap-3">
                        <select data-demo-action="admin.test-email" aria-label="Marketing test email recipient"
                            value={marketingTestEmail}
                            onChange={(e) => handleSaveMarketingTestEmail(e.target.value)}
                            disabled={savingTestEmail}
                            className="ui-control flex-1 disabled:opacity-50"
                        >
                            <option value="">Select an admin...</option>
                            {admins.map(a => (
                                <option key={a.id} value={a.email}>{a.name || a.email} ({a.email})</option>
                            ))}
                        </select>
                        {marketingTestEmail && (
                            <span className="ui-status ui-pill-success shrink-0 self-center">
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
                            <span className="ui-mono-label !text-[10px]">{tours.length} tour{tours.length !== 1 ? "s" : ""}</span>
                            <button onClick={resetTourForm} className="text-xs font-medium text-[var(--ck-accent)] hover:underline">+ New Tour</button>
                        </div>
                        <div className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] overflow-hidden">
                            <div className="divide-y divide-[var(--ck-border-subtle)]">
                                {tours.map((t, idx) => (
                                    <div key={t.id}
                                        draggable
                                        data-demo-drag="tour.reorder"
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
                                                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                                                    <span className="font-medium text-sm text-[var(--ck-text-strong)]">{t.name}</span>
                                                    <div className="flex items-center gap-1.5">
                                                        {t.hidden && (
                                                            <span className="ui-status ui-pill-amber">Hidden</span>
                                                        )}
                                                        <span className={"ui-status " + (t.active ? "ui-pill-success" : "ui-pill-neutral")}>
                                                            {t.active ? "Active" : "Inactive"}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="text-xs text-[var(--ck-text-muted)]">
                                                    {formatZar(Number(t.base_price_per_person || 0))}/person · <span className={tourSlotCounts[t.id] ? "text-emerald-600" : "text-orange-500"}>{tourSlotCounts[t.id] ?? "…"} upcoming slot{tourSlotCounts[t.id] !== 1 ? "s" : ""}</span>
                                                </div>
                                                <p className="mt-2 text-sm font-semibold text-[var(--ck-text-strong)]">Duration: {t.duration_minutes ? formatDuration(t.duration_minutes) : "Not set"}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 mt-2">
                                            <button data-demo-action={t.active ? "tour.deactivate" : "tour.activate"} onClick={(e) => { e.stopPropagation(); handleToggleTour(t); }}
                                                className={"text-xs font-medium hover:underline " + (t.active ? "text-orange-600" : "text-emerald-600")}>
                                                {t.active ? "Deactivate" : "Activate"}
                                            </button>
                                            <button data-demo-action={t.hidden ? "tour.show" : "tour.hide"} onClick={(e) => { e.stopPropagation(); handleToggleHidden(t); }}
                                                className={"text-xs font-medium hover:underline " + (t.hidden ? "text-[var(--ck-accent)]" : "text-amber-600")}>
                                                {t.hidden ? "Show" : "Hide"}
                                            </button>
                                            <button data-demo-action="tour.delete" onClick={(e) => { e.stopPropagation(); handleDeleteTour(t.id, t.name); }}
                                                className="text-xs font-medium text-[var(--ck-danger)] hover:underline">Delete</button>
                                            {bookingSiteBase && <a href={bookingSiteBase + "/book?tour=" + t.id} target="_blank" rel="noopener noreferrer"
                                                onClick={(e) => e.stopPropagation()}
                                                className="text-xs font-medium text-[var(--ck-accent)] hover:underline ml-auto">Book Page &rarr;</a>}
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
                        <form aria-label="Tour details" data-demo-submit="tour.save" onSubmit={handleSaveTour} className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5 space-y-4">
                            <div>
                                <label htmlFor="settings-tour-name" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Tour Name</label>
                                <input id="settings-tour-name" type="text" required value={tourForm.name} onChange={e => setTourForm({ ...tourForm, name: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="e.g. Sunset Paddle" />
                            </div>
                            <div>
                                <label htmlFor="settings-tour-description" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Description</label>
                                <textarea id="settings-tour-description" required value={tourForm.description} onChange={e => setTourForm({ ...tourForm, description: e.target.value })}
                                    rows={3} className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none resize-none"
                                    placeholder="Describe this activity..." />
                            </div>
                            <div>
                                <label htmlFor="settings-tour-tagline" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Confirmation email tagline</label>
                                <input id="settings-tour-tagline" type="text" value={tourForm.confirmationTagline} onChange={e => setTourForm({ ...tourForm, confirmationTagline: e.target.value })}
                                    maxLength={200} className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none"
                                    placeholder="e.g. Lace up your boots for an unforgettable day on the trail." />
                                <p className="text-[11px] text-[var(--ck-text-muted)] mt-1">Custom line for this tour&apos;s confirmation email. Blank uses your account default.</p>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-strong)] mb-1">Tour Image</label>
                                <div className="flex items-center gap-3">
                                    {tourForm.image_url && (
                                        <img src={tourForm.image_url} alt="Preview" className="w-16 h-16 object-cover rounded-lg border border-[var(--ck-border-subtle)] shrink-0" />
                                    )}
                                    <div className="flex-1">
                                        <label className={"inline-flex items-center gap-2 cursor-pointer rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-xs font-medium text-[var(--ck-text-strong)] hover:bg-[var(--ck-surface-sunken)] transition-colors" + (uploadingField === "tour_image" ? " opacity-50 pointer-events-none" : "")}>
                                            {uploadingField === "tour_image" ? "Uploading..." : (tourForm.image_url ? "Change image" : "Upload image")}
                                            <input data-demo-action="tour.image" type="file" accept="image/*" className="hidden" onChange={async (e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;
                                                setUploadingField("tour_image");
                                                await handleImageUpload(file, "email-images", businessId + "/tours", (url) => setTourForm(prev => ({ ...prev, image_url: url })));
                                                setUploadingField(null);
                                                e.target.value = "";
                                            }} />
                                        </label>
                                        {tourForm.image_url && (
                                            <button data-demo-action="tour.image-remove" type="button" onClick={() => setTourForm({ ...tourForm, image_url: "" })} className="ml-2 text-xs text-[var(--ck-danger)] hover:underline">Remove</button>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="rounded-xl border border-[var(--ck-border-subtle)] p-4 space-y-3">
                                <div>
                                    <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">Gift voucher photo</h3>
                                    <p className="mt-1 text-xs text-[var(--ck-text-muted)]">Gift voucher photo, with the recipient&apos;s name, voucher details and message. Blank uses the tour image.</p>
                                </div>
                                <div className="flex flex-wrap items-center gap-3">
                                    <label className="ui-btn ui-btn-secondary relative cursor-pointer focus-within:ring-2 focus-within:ring-[var(--ck-accent)]">
                                        {uploadingField === "voucherImage" ? "Uploading…" : "Upload voucher photo"}
                                        <input type="file" aria-label="Upload gift voucher photo" accept="image/jpeg,image/png,image/webp" disabled={uploadingField === "voucherImage"}
                                            className="absolute inset-0 w-full opacity-0 cursor-pointer"
                                            onChange={async e => {
                                                const file = e.target.files?.[0];
                                                e.target.value = "";
                                                if (!file) return;
                                                if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { notify({ message: "Choose a JPG, PNG or WebP photo.", tone: "warning" }); return; }
                                                setUploadingField("voucherImage");
                                                try { await handleImageUpload(file, "email-images", businessId + "/voucher-photos", url => setTourForm(prev => ({ ...prev, voucher_image_url: url }))); }
                                                catch { notify({ message: "Photo upload failed. Please try again.", tone: "error" }); }
                                                finally { setUploadingField(null); }
                                            }} />
                                    </label>
                                    {tourForm.voucher_image_url && <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setTourForm(prev => ({ ...prev, voucher_image_url: "" }))}>Use tour image</button>}
                                    <span className="text-xs text-[var(--ck-text-muted)]">JPG, PNG or WebP · Up to 5 MB</span>
                                </div>
                                <details>
                                    <summary className="cursor-pointer text-sm font-medium py-2">Preview gift voucher</summary>
                                    <div className="max-w-lg mt-2" dangerouslySetInnerHTML={{ __html: renderGiftVoucherFace({ imageUrl: tourForm.voucher_image_url || tourForm.image_url || emailImgs.gift, businessName: siteSettings.business_name, logoUrl: siteSettings.logo_url, experienceName: tourForm.name, recipientName: "Alex", buyerName: "Sam", message: "Happy birthday! Here’s to your next adventure together.", value: tourForm.price || "500", expiresLabel: "Valid for 3 years" }) }} />
                                    <p className="mt-2 text-xs text-[var(--ck-text-muted)]">Sample voucher. Save the tour to use this photo.</p>
                                </details>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="settings-tour-price" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Price per Person (R)</label>
                                    <input id="settings-tour-price" type="number" required min="1" step="1" value={tourForm.price}
                                        onChange={e => setTourForm({ ...tourForm, price: e.target.value })}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="600" />
                                </div>
                                <fieldset className="min-w-0 sm:col-span-2">
                                    <legend className="mb-2 text-sm font-semibold text-[var(--ck-text-strong)]">Tour duration</legend>
                                    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,7rem),1fr))] gap-3">
                                        <label className="block text-sm text-[var(--ck-text-strong)]">
                                            {tourForm.durationUnit === "hours" ? "Hours" : tourForm.durationUnit === "days" ? "Days" : "Minutes"}
                                        <input type="number" required min={tourForm.durationUnit === "hours" ? "0" : "1"} step="1" value={tourForm.duration}
                                            aria-label={tourForm.durationUnit === "hours" ? "Duration hours" : "Duration"}
                                            onChange={e => setTourForm({ ...tourForm, duration: e.target.value })}
                                            className="ui-control mt-1 w-full tabular-nums" placeholder={tourForm.durationUnit === "hours" ? "1" : "90"} />
                                        </label>
                                        <label className="block text-sm text-[var(--ck-text-strong)]">
                                            Unit
                                        <select value={tourForm.durationUnit}
                                            onChange={e => setTourForm({ ...tourForm, durationUnit: e.target.value as "min" | "hours" | "days", durationMinutes: "0" })}
                                            className="ui-control mt-1 w-full" aria-label="Duration unit">
                                            <option value="min">Minutes</option>
                                            <option value="hours">Hours</option>
                                            <option value="days">Days</option>
                                        </select>
                                        </label>
                                        {tourForm.durationUnit === "hours" && <label className="block text-sm text-[var(--ck-text-strong)]">
                                            Minutes
                                            <input type="number" min="0" max="59" step="1" value={tourForm.durationMinutes}
                                                onChange={e => setTourForm({ ...tourForm, durationMinutes: e.target.value })}
                                                aria-label="Duration minutes"
                                                className="ui-control mt-1 w-full tabular-nums" placeholder="0" />
                                        </label>}
                                    </div>
                                </fieldset>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="settings-tour-capacity" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Default Capacity</label>
                                    <input id="settings-tour-capacity" type="number" min="1" step="1" value={tourForm.default_capacity}
                                        onChange={e => setTourForm({ ...tourForm, default_capacity: e.target.value })}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="10" />
                                    <p className="text-xs text-[var(--ck-text-muted)] mt-1">Max people per slot</p>
                                </div>
                                <div className="flex items-end pb-1">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input type="checkbox" checked={tourForm.active} onChange={e => setTourForm({ ...tourForm, active: e.target.checked })}
                                            className="w-4 h-4 rounded border-[var(--ck-border-strong)] text-[var(--ck-accent)] focus:ring-[var(--ck-accent)]" />
                                        <span className="text-sm text-[var(--ck-text-strong)]">Active</span>
                                    </label>
                                </div>
                            </div>

                            {/* Last-minute deals */}
                            <div className="border-t border-[var(--ck-border-subtle)] pt-4">
                                <DemoFeatureLink feature="tour.last-minute" />
                                <label className="block text-xs font-semibold text-[var(--ck-text-strong)] mb-1">Last-minute deal (optional)</label>
                                <p className="text-xs text-[var(--ck-text-muted)] mb-3">Unsold seats use the deal price until the cut-off, then return to normal. Blank turns it off.</p>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    <div>
                                        <label htmlFor="settings-deal-starts" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Starts (hours before departure)</label>
                                        <input id="settings-deal-starts" type="number" min="1" max="720" step="1" value={tourForm.lastMinuteHours}
                                            onChange={e => setTourForm({ ...tourForm, lastMinuteHours: e.target.value })}
                                            className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="48" />
                                    </div>
                                    <div>
                                        <label htmlFor="settings-deal-cutoff" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Cut-off (hours before departure)</label>
                                        <input id="settings-deal-cutoff" type="number" min="0" step="1" value={tourForm.lastMinuteEndHours}
                                            onChange={e => setTourForm({ ...tourForm, lastMinuteEndHours: e.target.value })}
                                            className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="4" />
                                    </div>
                                    <div>
                                        <label htmlFor="settings-deal-price" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Deal price per person (R)</label>
                                        <input id="settings-deal-price" type="number" min="1" step="1" value={tourForm.lastMinutePrice}
                                            onChange={e => setTourForm({ ...tourForm, lastMinutePrice: e.target.value })}
                                            className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="450" />
                                    </div>
                                </div>
                            </div>

                            {/* Slot Generation */}
                            <div className="border-t border-[var(--ck-border-subtle)] pt-4">
                                <label className="block text-xs font-semibold text-[var(--ck-text-strong)] mb-1">
                                    {editingTour ? "Generate Slots" : "Auto-generate Slots (optional)"}
                                </label>
                                <p className="text-xs text-[var(--ck-text-muted)] mb-3">{tourForm.slotDateMode === "specific" ? "Creates departures on these dates at each time below." : "Creates departures on these weekdays and dates at each time below."}</p>
                                {editingTour && <p className="mb-3 text-sm text-[var(--ck-text-strong)]">Existing slots keep their current availability. To stop weekday bookings, use <Link className="font-medium underline underline-offset-2" href={`/slots?panel=bulk-edit&tour=${editingTour.id}`}>Slots → Bulk Edit → Close weekday slots</Link>.</p>}
                                <fieldset className="mb-3">
                                    <legend className="text-xs font-medium text-[var(--ck-text-muted)] mb-1">Schedule dates</legend>
                                    <div className="flex flex-wrap gap-x-5">
                                        {([["range", "Date range"], ["specific", "Specific dates"]] as const).map(([value, label]) => (
                                            <label key={value} className="flex min-h-11 items-center gap-2 cursor-pointer text-sm text-[var(--ck-text-strong)]">
                                                <input type="radio" name="tourSlotDateMode" value={value} checked={tourForm.slotDateMode === value}
                                                    onChange={() => { setTourForm(prev => ({ ...prev, slotDateMode: value })); setTourError(""); setSlotMessage(""); }}
                                                    className="h-4 w-4 accent-[var(--ck-accent)]" />
                                                {label}
                                            </label>
                                        ))}
                                    </div>
                                </fieldset>
                                {tourForm.slotDateMode === "specific" ? (
                                    <fieldset>
                                        <legend className="text-xs font-medium text-[var(--ck-text-muted)] mb-1">Tour dates</legend>
                                        <div className="space-y-2">
                                            {tourForm.slotDates.map((date, idx) => (
                                                <div key={idx} className="flex items-center gap-2">
                                                    <div className="min-w-0 flex-1">
                                                        <DatePicker value={date} placeholder={`Select date ${idx + 1}`} className="min-h-11 focus-visible:ring-2 focus-visible:ring-[var(--ck-accent)]"
                                                            onChange={value => setTourForm(prev => ({ ...prev, slotDates: prev.slotDates.map((d, i) => i === idx ? value : d) }))}
                                                            disabled={{ before: new Date() }} />
                                                    </div>
                                                    <button type="button" aria-label={`Remove date ${idx + 1}`}
                                                        onClick={() => setTourForm(prev => ({ ...prev, slotDates: prev.slotDates.length > 1 ? prev.slotDates.filter((_, i) => i !== idx) : [""] }))}
                                                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--ck-danger)] hover:bg-[var(--ck-surface-sunken)]">
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                        <button type="button" onClick={() => setTourForm(prev => ({ ...prev, slotDates: [...prev.slotDates, ""] }))}
                                            className="mt-1.5 inline-flex min-h-11 items-center text-xs font-medium text-[var(--ck-accent)] hover:underline">Add date</button>
                                    </fieldset>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                                )}
                                <div className="mt-3">
                                    <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Start Time{tourForm.slotTimes.length > 1 ? "s" : ""} (24-hour · {tourTimezone === "Africa/Johannesburg" ? "SAST" : tourTimezone})</label>
                                    <div className="space-y-2">
                                        {tourForm.slotTimes.map((t, idx) => (
                                            <div key={idx} className="flex gap-2 items-center">
                                                <input type="text" inputMode="numeric" autoComplete="off" maxLength={5} placeholder="18:00" value={t}
                                                    aria-label={`Start time ${idx + 1} (24-hour)`} aria-describedby="tour-time-hint"
                                                    onFocus={e => e.currentTarget.select()}
                                                    onChange={e => { const value = e.target.value; const times = [...tourForm.slotTimes]; times[idx] = /^\d{4}$/.test(value) ? normalize24HourTime(value) || value : value; setTourForm({ ...tourForm, slotTimes: times }); }}
                                                    onBlur={() => { const normalized = normalize24HourTime(t); if (normalized) setTourForm(prev => ({ ...prev, slotTimes: prev.slotTimes.map((time, i) => i === idx ? normalized : time) })); }}
                                                    className="ui-control min-w-0 flex-1 px-3 py-2 text-sm rounded-lg outline-none tabular-nums" />
                                                {tourForm.slotTimes.length > 1 && (
                                                    <button type="button" onClick={() => { const times = tourForm.slotTimes.filter((_, i) => i !== idx); setTourForm({ ...tourForm, slotTimes: times }); }}
                                                        className="text-[var(--ck-danger)] hover:bg-red-50 rounded-lg p-1.5" title="Remove time">
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    <p id="tour-time-hint" className="mt-1.5 text-xs text-[var(--ck-text-muted)]">24-hour time: 1800 becomes 18:00; 0930 becomes 09:30.</p>
                                    <button type="button" onClick={() => setTourForm({ ...tourForm, slotTimes: [...tourForm.slotTimes, ""] })}
                                        className="mt-1.5 text-xs font-medium text-[var(--ck-accent)] hover:underline">Add time</button>
                                </div>
                                {tourForm.slotDateMode === "range" && <div className="mt-3">
                                    <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Days of the Week</label>
                                    <div className="flex flex-wrap gap-1.5 mt-1">
                                        {DAY_LABELS.map((label, idx) => (
                                            <button key={idx} type="button" onClick={() => toggleDay(idx)}
                                                className={"px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors " + (tourForm.slotDays.includes(idx) ? "bg-[var(--ck-text-strong)] text-[var(--ck-surface)] border-[var(--ck-text-strong)]" : "bg-[var(--ck-surface)] text-[var(--ck-text-muted)] border-[var(--ck-border-subtle)] hover:border-[var(--ck-text-muted)]")}>
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="flex gap-2 mt-1.5">
                                        <button type="button" onClick={() => setTourForm(prev => ({ ...prev, slotDays: [0, 1, 2, 3, 4, 5, 6] }))} className="inline-flex min-h-11 items-center px-2 text-sm text-[var(--ck-accent)] hover:underline">All</button>
                                        <button type="button" onClick={() => setTourForm(prev => ({ ...prev, slotDays: [1, 2, 3, 4, 5] }))} className="inline-flex min-h-11 items-center px-2 text-sm text-[var(--ck-accent)] hover:underline">Weekdays</button>
                                        <button type="button" onClick={() => setTourForm(prev => ({ ...prev, slotDays: [0, 6] }))} className="inline-flex min-h-11 items-center px-2 text-sm text-[var(--ck-accent)] hover:underline">Weekends</button>
                                        <button type="button" onClick={() => setTourForm(prev => ({ ...prev, slotDays: [] }))} className="inline-flex min-h-11 items-center px-2 text-sm text-[var(--ck-text-muted)] hover:underline">None</button>
                                    </div>
                                </div>}
                                {editingTour && (
                                    <button data-demo-action="slot.generate" type="button" onClick={handleGenerateSlots} disabled={slotGenerating || tourSaving || !canGenerateSlots}
                                        className="mt-3 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                                        {slotGenerating ? "Generating..." : "Generate Slots for " + editingTour.name}
                                    </button>
                                )}
                            </div>

                            {tourError && <div className="text-xs text-[var(--ck-danger)] font-medium">{tourError}</div>}
                            {slotMessage && <div className="text-xs text-[var(--ck-success)] font-medium">{slotMessage}</div>}

                            <div className="flex gap-3">
                                <button type="submit" disabled={tourSaving || slotGenerating || uploadingField === "voucherImage"}
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
                            <InlineSlotManager tourId={editingTour.id} businessId={businessId} timezone={tourTimezone} />
                        )}
                    </div>

                </div>

                {/* Custom Booking Questions — plain form; the JSON the backend
                    expects is generated on save, never shown to the operator. */}
                <div className="mt-10 space-y-4">
                    <div className="pb-2 border-b border-[var(--ck-border-subtle)]">
                        <h3 className="text-sm font-semibold text-[var(--ck-text-strong)] mb-1">Custom Booking Questions</h3>
                        <p className="text-xs text-[var(--ck-text-muted)]">
                            Booking questions, such as allergies or pickup location. Add your own or use a template.
                        </p>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-2">Add a common question</label>
                        <div className="flex flex-wrap gap-2">
                            {[
                                { name: "+ Dietary Requirements", q: { label: "Any dietary requirements or allergies?", type: "textarea" as const, required: false, placeholder: "e.g. Vegetarian, nut allergy, none" } },
                                { name: "+ Hotel / Pickup", q: { label: "Where are you staying? (For pickup routing)", type: "text" as const, required: false, placeholder: "Hotel name or address" } },
                                { name: "+ Experience Level", q: { label: "Have you done this activity before?", type: "text" as const, required: true, placeholder: "Yes, No, or A little bit" } },
                                { name: "+ Emergency Contact", q: { label: "Emergency Contact (Name & Phone Number)", type: "text" as const, required: true, placeholder: "John Doe - +27 123 456 789" } },
                                { name: "+ Medical Conditions", q: { label: "Do you have any medical conditions we should be aware of?", type: "textarea" as const, required: false, placeholder: "List any relevant medical conditions" } },
                                { name: "+ Referral Source", q: { label: "How did you hear about us?", type: "text" as const, required: false, placeholder: "Google, TripAdvisor, Friend, etc." } },
                            ].map(t => (
                                <button key={t.name} type="button"
                                    onClick={() => setBookingQuestions(prev => [...prev, { key: "", ...t.q }])}
                                    className="px-3 py-1.5 text-xs font-medium rounded border border-[var(--ck-border-subtle)] bg-[var(--ck-surface)] hover:bg-gray-50 text-[var(--ck-text-strong)] transition-colors">
                                    {t.name}
                                </button>
                            ))}
                        </div>
                    </div>

                    {bookingQuestions.length === 0 ? (
                        <p className="text-xs text-[var(--ck-text-muted)]">No questions yet. Choose &quot;Add question&quot; or a template above.</p>
                    ) : (
                        <div className="space-y-3">
                            {bookingQuestions.map((q, i) => (
                                <div key={q.key || "new-" + i} className="rounded-xl border border-[var(--ck-border-subtle)] bg-[var(--ck-surface)] p-3 grid grid-cols-1 md:grid-cols-[1fr_150px_1fr_auto_auto] gap-2 items-center">
                                    <input type="text" value={q.label} aria-label={"Question " + (i + 1)}
                                        onChange={e => setBookingQuestions(prev => prev.map((p, j) => j === i ? { ...p, label: e.target.value } : p))}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="The question, e.g. Any allergies?" />
                                    <select value={q.type} aria-label={"Question " + (i + 1) + " answer type"}
                                        onChange={e => setBookingQuestions(prev => prev.map((p, j) => j === i ? { ...p, type: e.target.value as any } : p))}
                                        className="ui-control px-2 py-2 text-sm rounded-lg outline-none">
                                        <option value="text">Short answer</option>
                                        <option value="textarea">Long answer</option>
                                        <option value="number">Number</option>
                                        {!["text", "textarea", "number"].includes(q.type) && <option value={q.type}>{({ select: "Dropdown", radio: "Single choice", multiselect: "Multiple choices", checkbox: "Checkbox", date: "Date" } as Record<string, string>)[q.type] || q.type}</option>}
                                    </select>
                                    <input type="text" value={q.placeholder} aria-label={"Question " + (i + 1) + " hint"}
                                        onChange={e => setBookingQuestions(prev => prev.map((p, j) => j === i ? { ...p, placeholder: e.target.value } : p))}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="Hint text (optional)" />
                                    <label className="flex items-center gap-1.5 text-xs font-medium text-[var(--ck-text-muted)] cursor-pointer select-none whitespace-nowrap">
                                        <input type="checkbox" checked={q.required}
                                            onChange={e => setBookingQuestions(prev => prev.map((p, j) => j === i ? { ...p, required: e.target.checked } : p))}
                                            className="rounded border-gray-300 accent-[var(--ck-accent)]" />
                                        Required
                                    </label>
                                    <button type="button" aria-label="Remove question"
                                        onClick={() => setBookingQuestions(prev => prev.filter((_, j) => j !== i))}
                                        className="justify-self-end px-2 py-1 text-sm font-bold text-[var(--ck-danger)] hover:opacity-70 transition-opacity">×</button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="flex items-center gap-3">
                        <button type="button" onClick={() => setBookingQuestions(prev => [...prev, { key: "", label: "", type: "text", required: false, placeholder: "" }])}
                            className="px-4 py-2 rounded-xl border border-[var(--ck-border-subtle)] text-sm font-medium text-[var(--ck-text-strong)] hover:bg-[var(--ck-bg)]">
                            Add question
                        </button>
                        <button data-demo-action="questions.save" type="button" disabled={questionsSaving} onClick={saveBookingQuestions}
                            className="px-4 py-2 rounded-xl bg-[var(--ck-text-strong)] text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:opacity-90 disabled:opacity-40 transition-opacity">
                            {questionsSaving ? "Saving..." : "Save Questions"}
                        </button>
                        {questionsMessage.text && (
                            <span className={"text-xs font-medium " + (questionsMessage.type === "error" ? "text-[var(--ck-danger)]" : "text-emerald-700")}>{questionsMessage.text}</span>
                        )}
                    </div>
                </div>
            </CollapsibleSection>}

            {canAccess("addons") && <CollapsibleSection id="addons" title="Booking Add-Ons" subtitle="Booking extras, such as photos or equipment hire." openSections={openSections} toggle={toggleSection}>
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
                                        data-demo-drag="addon.reorder"
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
                                                    <span className={"ui-status " + (a.active ? "ui-pill-success" : "ui-pill-neutral")}>
                                                        {a.active ? "Active" : "Inactive"}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-[var(--ck-text-muted)]">
                                                    {formatZar(Number(a.price))}/item{a.description ? " \u00b7 " + a.description : ""}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 mt-2">
                                            <button data-demo-action={a.active ? "addon.deactivate" : "addon.activate"} onClick={(e) => { e.stopPropagation(); handleToggleAddOn(a); }}
                                                className={"text-xs font-medium hover:underline " + (a.active ? "text-orange-600" : "text-emerald-600")}>
                                                {a.active ? "Deactivate" : "Activate"}
                                            </button>
                                            <button data-demo-action="addon.delete" onClick={(e) => { e.stopPropagation(); handleDeleteAddOn(a.id, a.name); }}
                                                className="text-xs font-medium text-[var(--ck-danger)] hover:underline">Delete</button>
                                        </div>
                                    </div>
                                ))}
                                {addOns.length === 0 && <div className="p-4 text-center text-sm ui-text-muted">No extras yet. Add one above.</div>}
                            </div>
                        </div>
                    </div>

                    {/* Add / Edit Add-On Form */}
                    <div>
                        <h3 className="text-sm font-semibold text-[var(--ck-text-strong)] mb-3">
                            {editingAddOn ? "Edit Add-On" : "Add New Add-On"}
                        </h3>
                        <form data-demo-submit="addon.save" onSubmit={handleSaveAddOn} className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5 space-y-4">
                            <div>
                                <label htmlFor="settings-addon-name" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Name</label>
                                <input id="settings-addon-name" type="text" required value={addOnForm.name} onChange={e => setAddOnForm({ ...addOnForm, name: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="e.g. GoPro Photos" />
                            </div>
                            <div>
                                <label htmlFor="settings-addon-description" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Description (optional)</label>
                                <input id="settings-addon-description" type="text" value={addOnForm.description} onChange={e => setAddOnForm({ ...addOnForm, description: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="Short description shown to customer" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-strong)] mb-1">Image (optional)</label>
                                <div className="flex items-center gap-3">
                                    {addOnForm.image_url && (
                                        <img src={addOnForm.image_url} alt="Preview" className="w-16 h-16 object-cover rounded-lg border border-[var(--ck-border-subtle)] shrink-0" />
                                    )}
                                    <div className="flex-1">
                                        <label className={"inline-flex items-center gap-2 cursor-pointer rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-xs font-medium text-[var(--ck-text-strong)] hover:bg-[var(--ck-surface-sunken)] transition-colors" + (uploadingField === "addon_image" ? " opacity-50 pointer-events-none" : "")}>
                                            {uploadingField === "addon_image" ? "Uploading..." : (addOnForm.image_url ? "Change image" : "Upload image")}
                                            <input data-demo-action="addon.image" type="file" accept="image/*" className="hidden" onChange={async (e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;
                                                setUploadingField("addon_image");
                                                await handleImageUpload(file, "email-images", businessId + "/addons", (url) => setAddOnForm(prev => ({ ...prev, image_url: url })));
                                                setUploadingField(null);
                                                e.target.value = "";
                                            }} />
                                        </label>
                                        {addOnForm.image_url && (
                                            <button data-demo-action="addon.image-remove" type="button" onClick={() => setAddOnForm({ ...addOnForm, image_url: "" })} className="ml-2 text-xs text-[var(--ck-danger)] hover:underline">Remove</button>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="settings-addon-price" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Price (R)</label>
                                    <input id="settings-addon-price" type="number" required min="0" step="0.01" value={addOnForm.price}
                                        onChange={e => setAddOnForm({ ...addOnForm, price: e.target.value })}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="150" />
                                </div>
                                <div className="flex items-end pb-1">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input type="checkbox" checked={addOnForm.active} onChange={e => setAddOnForm({ ...addOnForm, active: e.target.checked })}
                                            className="w-4 h-4 rounded border-[var(--ck-border-strong)] text-[var(--ck-accent)] focus:ring-[var(--ck-accent)]" />
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

            {canAccess("external") && (
                <CollapsibleSection id="external" title="External Booking Integration" subtitle="B2B partner API keys and mappings" openSections={openSections} toggle={toggleSection}>
                    <ExternalBookingSettings tours={tours.map((t) => ({ id: t.id, name: t.name }))} />
                </CollapsibleSection>
            )}

            {canAccess("site") && <CollapsibleSection id="site" title="Booking Site Configuration" subtitle="Settings for your public booking page." openSections={openSections} toggle={toggleSection}>
                <form data-demo-submit="site.save" onSubmit={handleSaveSiteSettings} className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-6 space-y-8">

                    {/* Legal & Text Policies */}
                    <div>
                        <h3 className="text-sm font-semibold text-[var(--ck-text-strong)] mb-4 pb-2 border-b border-[var(--ck-border-subtle)]">Policies &amp; Information</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label id="settings-directions-label" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Directions &amp; Meeting Info</label>
                                <RichTextEditor labelledBy="settings-directions-label" value={siteSettings.directions} onChange={v => setSiteSettings({ ...siteSettings, directions: v })} rows={10} placeholder="Enter how to find the location..." />
                            </div>
                            <div>
                                <label id="settings-terms-label" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Terms &amp; Conditions</label>
                                <RichTextEditor labelledBy="settings-terms-label" value={siteSettings.terms_conditions} onChange={v => setSiteSettings({ ...siteSettings, terms_conditions: v })} rows={10} placeholder="Enter T&C's..." />
                                <p className="mt-1 text-xs text-[var(--ck-text-muted)]">Booking site terms. Blank or under 100 characters uses labelled platform-default terms.</p>
                            </div>
                            <div>
                                <label id="settings-privacy-label" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Privacy Policy</label>
                                <RichTextEditor labelledBy="settings-privacy-label" value={siteSettings.privacy_policy} onChange={v => setSiteSettings({ ...siteSettings, privacy_policy: v })} rows={10} />
                            </div>
                            <div>
                                <label id="settings-cookies-label" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Cookies Policy</label>
                                <RichTextEditor labelledBy="settings-cookies-label" value={siteSettings.cookies_policy} onChange={v => setSiteSettings({ ...siteSettings, cookies_policy: v })} rows={10} />
                            </div>
                        </div>
                    </div>

                    {/* Branding & Hero Text */}
                    <div>
                        <h3 className="text-sm font-semibold text-[var(--ck-text-strong)] mb-1 pb-2 border-b border-[var(--ck-border-subtle)]">Branding &amp; Hero Text</h3>
                        <p className="text-xs text-[var(--ck-text-muted)] mb-4">The <strong>Business Name</strong> and <strong>Logo</strong> below control: the admin dashboard sidebar, the browser tab title, all outgoing emails, and the public booking site header.</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label htmlFor="settings-business-name" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Business Name <span className="text-[var(--ck-accent)]">(appears in the dashboard header &amp; all emails)</span></label>
                                <input id="settings-business-name" type="text" value={siteSettings.business_name} onChange={e => setSiteSettings({ ...siteSettings, business_name: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="e.g. Cape Kayak Adventures" />
                            </div>
                            <div>
                                <label htmlFor="settings-business-tagline" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Business Tagline</label>
                                <input id="settings-business-tagline" type="text" value={siteSettings.business_tagline} onChange={e => setSiteSettings({ ...siteSettings, business_tagline: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="Cape Town's Original Since 1994" />
                            </div>
                            <div>
                                <label htmlFor="settings-hero-eyebrow" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Hero Eyebrow</label>
                                <input id="settings-hero-eyebrow" type="text" value={siteSettings.hero_eyebrow} onChange={e => setSiteSettings({ ...siteSettings, hero_eyebrow: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="Cape Town Sea Kayaking" />
                            </div>
                            <div>
                                <label htmlFor="settings-hero-title" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Hero Title</label>
                                <input id="settings-hero-title" type="text" value={siteSettings.hero_title} onChange={e => setSiteSettings({ ...siteSettings, hero_title: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="Find Your Perfect Paddle" />
                            </div>
                            <div className="md:col-span-2">
                                <label htmlFor="settings-hero-subtitle" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Hero Subtitle</label>
                                <input id="settings-hero-subtitle" type="text" value={siteSettings.hero_subtitle} onChange={e => setSiteSettings({ ...siteSettings, hero_subtitle: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="Explore the Atlantic coastline by kayak with Cape Town's original guided team." />
                                {/* The booking site shows the hero only when it has a title. */}
                                {!siteSettings.hero_title.trim() && (siteSettings.hero_eyebrow.trim() || siteSettings.hero_subtitle.trim()) && (
                                    <p className="text-[11px] text-[var(--ck-warning)] mt-1">Add a Hero Title to show the eyebrow and subtitle on your booking site.</p>
                                )}
                            </div>
                            {/* Site background image — saves immediately on upload/remove
                                (same pattern as the logo). Uses a palette background
                                when empty. */}
                            <div className="md:col-span-2 rounded-2xl border border-[var(--ck-border-subtle)] bg-[var(--ck-surface)] p-4">
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Site Background Image <span className="text-[var(--ck-accent)]">(the photo behind your booking catalogue)</span></label>
                                <p className="mb-3 text-[11px] text-[var(--ck-text-muted)]">Landscape photo, up to 20MB. Best at 16:9, e.g. 2560×1440. Resized to 2560px wide and blurred behind cards. Blank uses your palette.</p>
                                <div className="flex items-center gap-3">
                                    {siteSettings.hero_image && (
                                        /* eslint-disable-next-line @next/next/no-img-element */
                                        <img src={siteSettings.hero_image} alt="Background preview" className="h-14 w-24 shrink-0 rounded border border-[var(--ck-border-subtle)] object-cover" />
                                    )}
                                    <label className={"inline-flex items-center gap-2 cursor-pointer rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-xs font-medium text-[var(--ck-text-strong)] hover:bg-[var(--ck-surface-sunken)] transition-colors" + (uploadingField === "hero_bg" ? " opacity-50 pointer-events-none" : "")}>
                                        {uploadingField === "hero_bg" ? "Uploading..." : (siteSettings.hero_image ? "Change background" : "Upload background")}
                                        <input data-demo-action="site.hero" type="file" accept="image/*" className="hidden" onChange={async (e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            if (file.size > 20 * 1024 * 1024) {
                                                notify({ title: "File too large", message: "Please choose a photo under 20MB.", tone: "warning" });
                                                e.target.value = "";
                                                return;
                                            }
                                            setUploadingField("hero_bg");
                                            const optimised = await compressImage(file);
                                            await handleImageUpload(optimised, "email-images", businessId + "/branding", async (url) => {
                                                setSiteSettings(prev => ({ ...prev, hero_image: url }));
                                                const { error } = await supabase.from("businesses").update({ hero_image: url }).eq("id", businessId);
                                                notify(error ? { message: "Background uploaded but failed to persist: " + error.message, tone: "error" } : { message: "Background image updated. Reload your booking site to see it.", tone: "success" });
                                            });
                                            setUploadingField(null);
                                            e.target.value = "";
                                        }} />
                                    </label>
                                    {siteSettings.hero_image && (
                                        <button data-demo-action="site.hero-remove" type="button" onClick={async () => {
                                            setSiteSettings(prev => ({ ...prev, hero_image: "" }));
                                            const { error } = await supabase.from("businesses").update({ hero_image: null }).eq("id", businessId);
                                            notify(error ? { message: "Failed to remove background: " + error.message, tone: "error" } : { message: "Background removed. Your palette provides the background.", tone: "success" });
                                        }} className="text-xs text-[var(--ck-danger)] hover:underline">Remove</button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div>
                        <h3 className="text-sm font-semibold text-[var(--ck-text-strong)] mb-4 pb-2 border-b border-[var(--ck-border-subtle)]">Navigation, Buttons &amp; Footer Copy</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label htmlFor="settings-nav-gift-voucher" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Gift Voucher Nav Label</label>
                                <input id="settings-nav-gift-voucher" type="text" value={siteSettings.nav_gift_voucher_label} onChange={e => setSiteSettings({ ...siteSettings, nav_gift_voucher_label: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="Gift Voucher" />
                            </div>
                            <div>
                                <label htmlFor="settings-nav-my-bookings" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">My Bookings Nav Label</label>
                                <input id="settings-nav-my-bookings" type="text" value={siteSettings.nav_my_bookings_label} onChange={e => setSiteSettings({ ...siteSettings, nav_my_bookings_label: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="My Bookings" />
                            </div>
                            <div>
                                <label htmlFor="settings-nav-tour-cta" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Primary Tour CTA Label</label>
                                <input id="settings-nav-tour-cta" type="text" value={siteSettings.card_cta_label} onChange={e => setSiteSettings({ ...siteSettings, card_cta_label: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="Book Now" />
                            </div>
                            <div>
                                <label htmlFor="settings-chat-label" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Chat Widget Label</label>
                                <input id="settings-chat-label" type="text" value={siteSettings.chat_widget_label} onChange={e => setSiteSettings({ ...siteSettings, chat_widget_label: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="Book here" />
                            </div>
                            <div>
                                <label htmlFor="settings-footer-one" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Footer Line One</label>
                                <input id="settings-footer-one" type="text" value={siteSettings.footer_line_one} onChange={e => setSiteSettings({ ...siteSettings, footer_line_one: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="Kayaks Adventures · Coastal Activity Centre" />
                            </div>
                            <div>
                                <label htmlFor="settings-footer-two" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Footer Line Two</label>
                                <input id="settings-footer-two" type="text" value={siteSettings.footer_line_two} onChange={e => setSiteSettings({ ...siteSettings, footer_line_two: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="Established: 1994 · BookingTours Platform" />
                            </div>
                            <div>
                                <label htmlFor="settings-contact-email" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Public Contact Email</label>
                                <input id="settings-contact-email" type="email" value={siteSettings.public_email} onChange={e => setSiteSettings({ ...siteSettings, public_email: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="hello@yourbusiness.co.za" />
                                <p className="text-[11px] text-[var(--ck-text-muted)] mt-1">Shown in Contact Us. Blank hides it.</p>
                            </div>
                            <div>
                                <label htmlFor="settings-contact-phone" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Public Contact Phone</label>
                                <input id="settings-contact-phone" type="tel" value={siteSettings.public_phone} onChange={e => setSiteSettings({ ...siteSettings, public_phone: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="+27821234567" />
                                <p className="text-[11px] text-[var(--ck-text-muted)] mt-1">Include country code. Blank hides it.</p>
                            </div>
                            <div>
                                <label htmlFor="settings-contact-whatsapp" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Public WhatsApp Number</label>
                                <input id="settings-contact-whatsapp" type="tel" value={siteSettings.public_whatsapp} onChange={e => setSiteSettings({ ...siteSettings, public_whatsapp: e.target.value })}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="+27821234567" />
                                <p className="text-[11px] text-[var(--ck-text-muted)] mt-1">Include country code. Blank hides it.</p>
                            </div>
                        </div>
                    </div>

                    {role === "SUPER_ADMIN" && (
                        <div>
                            <h3 className="text-sm font-semibold text-[var(--ck-text-strong)] mb-4 pb-2 border-b border-[var(--ck-border-subtle)]">Booking Site Links &amp; Redirects</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label htmlFor="settings-url-booking-site" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Booking Site URL</label>
                                    <input id="settings-url-booking-site" type="url" value={siteSettings.booking_site_url} onChange={e => setSiteSettings({ ...siteSettings, booking_site_url: e.target.value })}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder={DEFAULT_BOOKING_URL} />
                                </div>
                                <div>
                                    <label htmlFor="settings-url-manage-bookings" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Manage Bookings URL</label>
                                    <input id="settings-url-manage-bookings" type="url" value={siteSettings.manage_bookings_url} onChange={e => setSiteSettings({ ...siteSettings, manage_bookings_url: e.target.value })}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder={DEFAULT_MANAGE_BOOKINGS_URL} />
                                </div>
                                <div>
                                    <label htmlFor="settings-url-gift-voucher" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Gift Voucher Page URL</label>
                                    <input id="settings-url-gift-voucher" type="url" value={siteSettings.gift_voucher_url} onChange={e => setSiteSettings({ ...siteSettings, gift_voucher_url: e.target.value })}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder={DEFAULT_GIFT_VOUCHER_URL} />
                                </div>
                                <div>
                                    <label htmlFor="settings-url-payment-success" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Payment Success URL</label>
                                    <input id="settings-url-payment-success" type="url" value={siteSettings.booking_success_url} onChange={e => setSiteSettings({ ...siteSettings, booking_success_url: e.target.value })}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder={DEFAULT_BOOKING_SUCCESS_URL} />
                                </div>
                                <div>
                                    <label htmlFor="settings-url-payment-cancel" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Payment Cancel URL</label>
                                    <input id="settings-url-payment-cancel" type="url" value={siteSettings.booking_cancel_url} onChange={e => setSiteSettings({ ...siteSettings, booking_cancel_url: e.target.value })}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder={DEFAULT_BOOKING_CANCEL_URL} />
                                </div>
                                <div>
                                    <label htmlFor="settings-url-voucher-success" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Voucher Success URL</label>
                                    <input id="settings-url-voucher-success" type="url" value={siteSettings.voucher_success_url} onChange={e => setSiteSettings({ ...siteSettings, voucher_success_url: e.target.value })}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder={DEFAULT_VOUCHER_SUCCESS_URL} />
                                </div>
                                <div className="md:col-span-2">
                                    <label htmlFor="settings-url-waiver" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Waiver URL</label>
                                    <input id="settings-url-waiver" type="url" value={siteSettings.waiver_url} onChange={e => setSiteSettings({ ...siteSettings, waiver_url: e.target.value })}
                                        className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="Blank uses the built-in waiver." />
                                    <p className="mt-1 text-xs text-[var(--ck-text-muted)]">Blank creates a waiver per booking. Custom URLs receive booking and token parameters.</p>
                                </div>
                            </div>
                            <p className="mt-3 text-xs text-[var(--ck-text-muted)]">Use full URLs. Payment links, weather notices and booking actions use these addresses.</p>
                        </div>
                    )}

                    <BookingSitePreview siteSettings={siteSettings} tours={tours} />

                    {/* Branding Colors */}
                    <div>
                        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-2 border-b border-[var(--ck-border-subtle)]">
                            <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">Theme Colors</h3>
                            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                                <label htmlFor="booking-palette" className="text-xs font-medium text-[var(--ck-text-muted)]">Choose Palette</label>
                                <select
                                    id="booking-palette"
                                    value={selectedPalette}
                                    className="ui-control min-h-11 max-w-full px-3 py-2 text-xs rounded-lg outline-none cursor-pointer bg-[var(--ck-surface)] border border-[var(--ck-border-subtle)]"
                                    onChange={(e) => {
                                        const colors = BOOKING_PALETTES[e.target.value];
                                        if (colors) setSiteSettings(prev => ({ ...prev, ...colors }));
                                    }}
                                >
                                    <option value="">Custom colours</option>
                                    {Object.keys(BOOKING_PALETTES).map(name => <option key={name} value={name}>{name}</option>)}
                                </select>
                                <div className="flex overflow-hidden rounded border border-[var(--ck-border-subtle)]" role="img" aria-label="Current palette: main, secondary, button, background, navigation and hover colours">
                                    {(["color_main", "color_secondary", "color_cta", "color_bg", "color_nav", "color_hover"] as const).map(key => (
                                        <span key={key} className="h-6 w-5" style={{ backgroundColor: siteSettings[key] }} title={`${key.replace("color_", "")}: ${siteSettings[key]}`} />
                                    ))}
                                </div>
                            </div>
                        </div>
                        <p className="text-xs text-[var(--ck-text-muted)] mb-4">Preview a palette, then save to publish. 27 available.</p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1" htmlFor="settings-color-main">Main Color</label>
                                <div className="flex bg-[var(--ck-surface)] rounded-lg border border-[var(--ck-border-subtle)] overflow-hidden focus-within:ring-2 focus-within:ring-[var(--ck-accent)]">
                                    <input type="color" id="settings-color-main" value={siteSettings.color_main} onChange={e => setSiteSettings({ ...siteSettings, color_main: e.target.value })}
                                        className="h-10 w-12 p-1 bg-transparent cursor-pointer border-r border-[var(--ck-border-subtle)]" />
                                    <input type="text" aria-label="Main Color hex value" value={siteSettings.color_main} onChange={e => setSiteSettings({ ...siteSettings, color_main: e.target.value })}
                                        className="flex-1 w-full px-3 py-2 text-sm outline-none uppercase" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1" htmlFor="settings-color-secondary">Secondary Color</label>
                                <div className="flex bg-[var(--ck-surface)] rounded-lg border border-[var(--ck-border-subtle)] overflow-hidden focus-within:ring-2 focus-within:ring-[var(--ck-accent)]">
                                    <input type="color" id="settings-color-secondary" value={siteSettings.color_secondary} onChange={e => setSiteSettings({ ...siteSettings, color_secondary: e.target.value })}
                                        className="h-10 w-12 p-1 bg-transparent cursor-pointer border-r border-[var(--ck-border-subtle)]" />
                                    <input type="text" aria-label="Secondary Color hex value" value={siteSettings.color_secondary} onChange={e => setSiteSettings({ ...siteSettings, color_secondary: e.target.value })}
                                        className="flex-1 w-full px-3 py-2 text-sm outline-none uppercase" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1" htmlFor="settings-color-cta">Call To Action</label>
                                <div className="flex bg-[var(--ck-surface)] rounded-lg border border-[var(--ck-border-subtle)] overflow-hidden focus-within:ring-2 focus-within:ring-[var(--ck-accent)]">
                                    <input type="color" id="settings-color-cta" value={siteSettings.color_cta} onChange={e => setSiteSettings({ ...siteSettings, color_cta: e.target.value })}
                                        className="h-10 w-12 p-1 bg-transparent cursor-pointer border-r border-[var(--ck-border-subtle)]" />
                                    <input type="text" aria-label="Call To Action hex value" value={siteSettings.color_cta} onChange={e => setSiteSettings({ ...siteSettings, color_cta: e.target.value })}
                                        className="flex-1 w-full px-3 py-2 text-sm outline-none uppercase" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1" htmlFor="settings-color-bg">Page Background</label>
                                <div className="flex bg-[var(--ck-surface)] rounded-lg border border-[var(--ck-border-subtle)] overflow-hidden focus-within:ring-2 focus-within:ring-[var(--ck-accent)]">
                                    <input type="color" id="settings-color-bg" value={siteSettings.color_bg} onChange={e => setSiteSettings({ ...siteSettings, color_bg: e.target.value })}
                                        className="h-10 w-12 p-1 bg-transparent cursor-pointer border-r border-[var(--ck-border-subtle)]" />
                                    <input type="text" aria-label="Page Background hex value" value={siteSettings.color_bg} onChange={e => setSiteSettings({ ...siteSettings, color_bg: e.target.value })}
                                        className="flex-1 w-full px-3 py-2 text-sm outline-none uppercase" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1" htmlFor="settings-color-nav">Navigation Bar</label>
                                <div className="flex bg-[var(--ck-surface)] rounded-lg border border-[var(--ck-border-subtle)] overflow-hidden focus-within:ring-2 focus-within:ring-[var(--ck-accent)]">
                                    <input type="color" id="settings-color-nav" value={siteSettings.color_nav} onChange={e => setSiteSettings({ ...siteSettings, color_nav: e.target.value })}
                                        className="h-10 w-12 p-1 bg-transparent cursor-pointer border-r border-[var(--ck-border-subtle)]" />
                                    <input type="text" aria-label="Navigation Bar hex value" value={siteSettings.color_nav} onChange={e => setSiteSettings({ ...siteSettings, color_nav: e.target.value })}
                                        className="flex-1 w-full px-3 py-2 text-sm outline-none uppercase" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1" htmlFor="settings-color-hover">Card Hover Overlay</label>
                                <div className="flex bg-[var(--ck-surface)] rounded-lg border border-[var(--ck-border-subtle)] overflow-hidden focus-within:ring-2 focus-within:ring-[var(--ck-accent)]">
                                    <input type="color" id="settings-color-hover" value={siteSettings.color_hover} onChange={e => setSiteSettings({ ...siteSettings, color_hover: e.target.value })}
                                        className="h-10 w-12 p-1 bg-transparent cursor-pointer border-r border-[var(--ck-border-subtle)]" />
                                    <input type="text" aria-label="Card Hover Overlay hex value" value={siteSettings.color_hover} onChange={e => setSiteSettings({ ...siteSettings, color_hover: e.target.value })}
                                        className="flex-1 w-full px-3 py-2 text-sm outline-none uppercase" />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Chatbot Avatar */}
                    <div>
                        <DemoFeatureLink feature="site.avatar" />
                        <h3 className="text-sm font-semibold text-[var(--ck-text-strong)] mb-4 pb-2 border-b border-[var(--ck-border-subtle)]">Chatbot Avatar</h3>
                        <div className="flex flex-wrap gap-4">
                            {chatbotAvatars.length === 0 && (
                                <p className="text-xs text-[var(--ck-text-muted)]">No avatars. Ask a super admin to add one.</p>
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
                        <label htmlFor="settings-refund-summary" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Plain-language summary (shown to customers)</label>
                        <textarea id="settings-refund-summary" value={refundPolicyText} onChange={e => setRefundPolicyText(e.target.value)} rows={3}
                            className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none resize-y" />
                    </div>

                    <div className="flex items-center gap-3">
                        <button data-demo-action="site.cancellation" type="button" onClick={handleSaveRefundPolicy} disabled={refundSaving}
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

            {canAccess("site") && <CollapsibleSection id="embed-widget" title="Embed Widget Snippet" subtitle="Paste this code into your website." openSections={openSections} toggle={toggleSection}>
                <div className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-6 space-y-4">
                    {subdomain ? (
                        <>
                            <p className="text-sm text-[var(--ck-text)]">
                                Embed on any HTML page. The iframe resizes automatically.
                            </p>
                            <div className="relative">
                                <pre className="bg-[var(--ck-surface-sunken)] border border-[var(--ck-border-subtle)] rounded-lg px-4 py-3 pr-20 text-xs font-mono overflow-x-auto whitespace-pre-wrap">{`<div id="bookingtours-widget" data-tenant="${subdomain}"></div>\n<script src="https://booking.bookingtours.co.za/widget.js" async></script>`}</pre>
                                <button data-demo-action="embed.copy"
                                    type="button"
                                    onClick={async () => {
                                        const snippet = `<div id="bookingtours-widget" data-tenant="${subdomain}"></div>\n<script src="https://booking.bookingtours.co.za/widget.js" async></script>`;
                                        try {
                                            await navigator.clipboard.writeText(snippet);
                                            notify({ title: "Copied", message: "Embed snippet copied to clipboard.", tone: "success" });
                                        } catch {
                                            notify({ title: "Copy failed", message: "Select and copy the snippet manually.", tone: "error" });
                                        }
                                    }}
                                    className="absolute top-2 right-2 px-2.5 py-1 rounded text-xs font-medium bg-[var(--ck-text-strong)] text-[var(--ck-btn-primary-text)] hover:opacity-90"
                                >
                                    Copy
                                </button>
                            </div>
                            <p className="text-xs text-[var(--ck-text-muted)]">
                                Optional attributes: <code>data-tour=&quot;&lt;tour-id&gt;&quot;</code> preselects a tour, <code>data-bg=&quot;#fff&quot;</code> sets the background, <code>data-min-height=&quot;800&quot;</code> sets the initial height (default 600).
                            </p>
                        </>
                    ) : (
                        <p className="text-sm text-[var(--ck-text-muted)]">
                            Contact support to set up your booking subdomain before embedding.
                        </p>
                    )}
                </div>
            </CollapsibleSection>}

            {canAccess("email") && <CollapsibleSection id="email" title="Email Customisation" subtitle="Colour theme, wording and banner images for each email type" openSections={openSections} toggle={toggleSection}>
                <form data-demo-submit="email.save" onSubmit={handleSaveEmailImages} className="space-y-6">
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

                    <div className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <label className="block">
                                <span className="text-sm font-semibold text-[var(--ck-text-strong)]">Activity verb</span>
                                <p className="text-xs text-[var(--ck-text-muted)] mt-0.5 mb-2">Post-trip wording: &quot;Thank you for … with us.&quot; Blank uses &quot;adventuring&quot;.</p>
                                <input type="text" value={activityVerbPast} onChange={e => setActivityVerbPast(e.target.value)}
                                    maxLength={40}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none"
                                    placeholder="e.g. paddling, exploring, riding" />
                            </label>
                            <label className="block">
                                <span className="text-sm font-semibold text-[var(--ck-text-strong)]">Location phrase</span>
                                <p className="text-xs text-[var(--ck-text-muted)] mt-0.5 mb-2">Ends &quot;We hope you had an incredible time …&quot; in photo emails. Optional.</p>
                                <input type="text" value={locationPhrase} onChange={e => setLocationPhrase(e.target.value)}
                                    maxLength={60}
                                    className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none"
                                    placeholder="e.g. on the water, in the bush" />
                            </label>
                        </div>
                        <label className="block">
                            <span className="text-sm font-semibold text-[var(--ck-text-strong)]">Confirmation tagline</span>
                            <p className="text-xs text-[var(--ck-text-muted)] mt-0.5 mb-2">Custom line in confirmation emails. Blank uses wording based on the tour name.</p>
                            <input type="text" value={emailTagline} onChange={e => setEmailTagline(e.target.value)}
                                maxLength={200}
                                className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none"
                                placeholder="e.g. Get ready to meet the lions up close on an unforgettable safari." />
                        </label>
                    </div>

                    <EmailWordingSection businessId={businessId} value={emailOverrides} onChange={setEmailOverrides} />

                    {([
                        { key: "payment", label: "Payment Link", desc: "Sent when admin creates a booking requiring payment" },
                        { key: "confirm", label: "Booking Confirmation", desc: "Sent after payment is completed" },
                        { key: "invoice", label: "Invoice", desc: "Sent with the invoice PDF: a pro forma until paid, then the tax invoice" },
                        { key: "gift", label: "Gift Voucher Default Photo", desc: "Fallback voucher background. Set a photo per experience in Tours above." },
                        { key: "cancel", label: "Cancellation – General", desc: "Sent when a booking is cancelled for any reason" },
                        { key: "cancel_weather", label: "Cancellation – Weather", desc: "Sent when a booking is cancelled due to weather" },
                        { key: "indemnity", label: "Trip Reminder / Waiver", desc: "Used by the pre-trip reminder email (sent if WhatsApp fails) and waiver requests" },
                        { key: "admin", label: "Admin Welcome", desc: "Sent to new admin users with their setup link" },
                        { key: "voucher", label: "Voucher Code", desc: "Sent when a customer receives a voucher code" },
                        { key: "photos", label: "Trip Photos", desc: "Sent when trip photos are uploaded and shared" },
                    ] as { key: keyof typeof emailImgs; label: string; desc: string }[]).map(({ key, label, desc }) => (
                        <div key={key} className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5">
                            <div className="flex gap-5 items-start">
                                {emailImgs[key] ? (
                                    <img src={emailImgs[key]} alt={label} className="w-24 h-16 object-cover rounded-lg border border-[var(--ck-border-subtle)] shrink-0" style={{ background: "var(--ck-surface-sunken)" }} />
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
                                            aria-label={label + " image URL"}
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
                                            <input data-demo-action="email.image" data-demo-subject={label} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadEmailImage(key, f); e.target.value = ""; }} />
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
                                    <label htmlFor={"settings-social-" + key} className="text-xs font-medium text-[var(--ck-text-muted)] mb-1 block">{label}</label>
                                    <input
                                        id={"settings-social-" + key}
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
                <form data-demo-submit="operations.save" onSubmit={async (e) => {
                    e.preventDefault();
                    setOpsSaving(true);
                    const faqObj: Record<string, string> = {};
                    for (const entry of faqEntries) { if (entry.q.trim() && entry.a.trim()) faqObj[entry.q.trim()] = entry.a.trim(); }
                    const { error } = await supabase.from("businesses").update({
                        what_to_bring: opsConfig.what_to_bring || null,
                        what_to_wear: opsConfig.what_to_wear || null,
                        arrival_instructions: opsConfig.arrival_instructions || null,
                        // Blank means the standard assistant; the column is NOT NULL, so store "".
                        ai_system_prompt: opsConfig.ai_system_prompt.trim(),
                        faq_json: faqObj,
                    }).eq("id", businessId);
                    setOpsSaving(false);
                    if (error) {
                        console.error("Operations settings save failed:", error);
                        notify({ title: "Settings not saved", message: "The operations and AI settings could not be saved. Please try again.", tone: "error" });
                        return;
                    }
                    notify({ message: "Operations & AI settings saved.", tone: "success" });
                }} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="block">
                            <span className="text-xs font-medium text-[var(--ck-text-muted)]">What to bring</span>
                            <textarea value={opsConfig.what_to_bring} onChange={e => setOpsConfig({ ...opsConfig, what_to_bring: e.target.value })}
                                rows={4} placeholder="e.g. Sunscreen, towel, water bottle, hat..." className="ui-control mt-1 w-full" />
                        </label>
                        <label className="block">
                            <span className="text-xs font-medium text-[var(--ck-text-muted)]">What to wear</span>
                            <textarea value={opsConfig.what_to_wear} onChange={e => setOpsConfig({ ...opsConfig, what_to_wear: e.target.value })}
                                rows={4} placeholder="e.g. Comfortable clothes that can get wet, closed-toe shoes..." className="ui-control mt-1 w-full" />
                        </label>
                    </div>

                    <label className="block">
                        <span className="text-xs font-medium text-[var(--ck-text-muted)]">Arrival instructions</span>
                        <p className="text-[11px] text-[var(--ck-text-muted)] mb-1">Shown below the meeting point in confirmations and day-before waiver reminders. Blank uses &quot;Please arrive 15 minutes before launch.&quot;</p>
                        <textarea value={opsConfig.arrival_instructions} onChange={e => setOpsConfig({ ...opsConfig, arrival_instructions: e.target.value })}
                            rows={2} placeholder="e.g. Please arrive 20 minutes before departure and check in at the kiosk." className="ui-control mt-1 w-full" />
                    </label>

                    <label className="block">
                        <span className="text-xs font-medium text-[var(--ck-text-muted)]">AI chatbot personality &amp; knowledge</span>
                        <p className="text-[11px] text-[var(--ck-text-muted)] mb-1">Instructions for your website and WhatsApp chatbot: role, business rules and answers. Leave blank to use the standard assistant.</p>
                        <textarea value={opsConfig.ai_system_prompt} onChange={e => setOpsConfig({ ...opsConfig, ai_system_prompt: e.target.value })}
                            rows={8} placeholder="You are a friendly booking assistant for [business]. You help customers book tours, answer FAQs..." className="ui-control mt-1 w-full font-mono text-xs" />
                    </label>

                    {/* FAQ Repeater */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-[var(--ck-text-muted)]">Frequently Asked Questions</span>
                            <button type="button" onClick={() => setFaqEntries([...faqEntries, { q: "", a: "" }])}
                                className="text-xs font-medium px-2 py-1 rounded-lg border border-[var(--ck-border-subtle)] hover:bg-[var(--ck-surface-sunken)]"
                                style={{ color: "var(--ck-accent)" }}>
                                + Add FAQ
                            </button>
                        </div>
                        {faqEntries.length === 0 && (
                            <p className="text-xs text-[var(--ck-text-muted)] italic">Add common questions and answers for the chatbot.</p>
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
                                        placeholder="Question" className="ui-control w-full" />
                                    <textarea value={faq.a} onChange={e => { const next = [...faqEntries]; next[i] = { ...next[i], a: e.target.value }; setFaqEntries(next); }}
                                        rows={2} placeholder="Answer" className="ui-control w-full" />
                                </div>
                            ))}
                        </div>
                    </div>

                    <div>
                        <button type="submit" disabled={opsSaving}
                            className="rounded-xl px-8 bg-[var(--ck-text-strong)] py-2.5 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:opacity-90 disabled:opacity-50">
                            {opsSaving ? "Saving..." : "Save"}
                        </button>
                    </div>
                </form>
            </CollapsibleSection>}

            {isPrivileged(role) && (
              <CollapsibleSection id="whatsapp-bot" title="WhatsApp Bot Mode" subtitle="Choose when WhatsApp auto-replies run." openSections={openSections} toggle={toggleSection}>
                <WhatsAppBotSection />
              </CollapsibleSection>
            )}

            <CollapsibleSection id="dashboard-prefs" title="Dashboard Preferences" subtitle="Personal preferences for your own admin account" openSections={openSections} toggle={toggleSection}>
                <HelpAssistantSection />
            </CollapsibleSection>

            {isPrivileged(role) && <CollapsibleSection id="autotags" title="Automation Tag Rules" subtitle="Tag marketing contacts by booking history." openSections={openSections} toggle={toggleSection}>
                <form data-demo-submit="tags.save" onSubmit={async (e) => {
                    e.preventDefault();
                    setAutoTagSaving(true);
                    const { error } = await supabase.from("businesses").update({ automation_config: autoTagConfig }).eq("id", businessId);
                    setAutoTagSaving(false);
                    if (error) { notify({ message: error.message, tone: "error" }); return; }
                    notify({ message: "Automation tag rules saved.", tone: "success" });
                }} className="space-y-6">
                    <p className="text-xs text-[var(--ck-text-muted)]">
                        Tags update daily from booking history and can start automations. For example, <strong>vip</strong> starts any automation using that tag.
                    </p>

                    {/* VIP Rules */}
                    <div className="rounded-lg border border-[var(--ck-border-subtle)] p-4 space-y-3">
                        <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">VIP Tag</h3>
                        <p className="text-xs text-[var(--ck-text-muted)]">Based on paid bookings within a set period. Expires unless they rebook.</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Bookings required</span>
                                <input type="number" min={1} max={50} value={autoTagConfig.vip_bookings} onChange={e => setAutoTagConfig({ ...autoTagConfig, vip_bookings: parseInt(e.target.value) || 3 })}
                                    className="ui-control mt-1 w-full" />
                            </label>
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Within (days)</span>
                                <input type="number" min={7} max={365} value={autoTagConfig.vip_window_days} onChange={e => setAutoTagConfig({ ...autoTagConfig, vip_window_days: parseInt(e.target.value) || 90 })}
                                    className="ui-control mt-1 w-full" />
                            </label>
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">VIP valid for (days)</span>
                                <input type="number" min={30} max={1825} value={autoTagConfig.vip_valid_days} onChange={e => setAutoTagConfig({ ...autoTagConfig, vip_valid_days: parseInt(e.target.value) || 365 })}
                                    className="ui-control mt-1 w-full" />
                            </label>
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Renew after (bookings)</span>
                                <input type="number" min={1} max={50} value={autoTagConfig.vip_renewal_bookings} onChange={e => setAutoTagConfig({ ...autoTagConfig, vip_renewal_bookings: parseInt(e.target.value) || 3 })}
                                    className="ui-control mt-1 w-full" />
                            </label>
                        </div>
                        <p className="text-[11px] text-[var(--ck-text-muted)]">
                            Default: 3 bookings within 90 days = VIP for 1 year. Renews if they make 3 more bookings before it expires.
                        </p>
                    </div>

                    {/* Lapsed Rules */}
                    <div className="rounded-lg border border-[var(--ck-border-subtle)] p-4 space-y-3">
                        <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">Lapsed Customer Tag</h3>
                        <p className="text-xs text-[var(--ck-text-muted)]">Applied after a gap in bookings. Removed when they book again.</p>
                        <label className="block max-w-xs">
                            <span className="text-xs font-medium text-[var(--ck-text-muted)]">Days since last booking</span>
                            <input type="number" min={14} max={365} value={autoTagConfig.lapsed_days} onChange={e => setAutoTagConfig({ ...autoTagConfig, lapsed_days: parseInt(e.target.value) || 90 })}
                                className="ui-control mt-1 w-full" />
                        </label>
                        <p className="text-[11px] text-[var(--ck-text-muted)]">
                            Default: 90 days. Tag name: <code className="bg-[var(--ck-surface-sunken)] px-1 rounded">lapsed-{autoTagConfig.lapsed_days}-days</code>
                        </p>
                    </div>

                    {/* Other Tags */}
                    <div className="rounded-lg border border-[var(--ck-border-subtle)] p-4 space-y-3">
                        <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">Other Auto-Tags</h3>
                        <div className="space-y-2">
                            <label className="flex items-center gap-2">
                                <input type="checkbox" checked={autoTagConfig.completed_tour_enabled} onChange={e => setAutoTagConfig({ ...autoTagConfig, completed_tour_enabled: e.target.checked })}
                                    className="rounded border-[var(--ck-border-subtle)]" />
                                <span className="text-sm text-[var(--ck-text)]"><strong>completed-tour</strong>: applied after a booked tour date has passed</span>
                            </label>
                            <label className="flex items-center gap-2">
                                <input type="checkbox" checked={autoTagConfig.new_booker_enabled} onChange={e => setAutoTagConfig({ ...autoTagConfig, new_booker_enabled: e.target.checked })}
                                    className="rounded border-[var(--ck-border-subtle)]" />
                                <span className="text-sm text-[var(--ck-text)]"><strong>new-booker</strong>: first-time customers (removed after 2nd booking)</span>
                            </label>
                        </div>
                        <label className="block max-w-xs">
                            <span className="text-xs font-medium text-[var(--ck-text-muted)]">Voucher expiry warning (days before)</span>
                            <input type="number" min={7} max={90} value={autoTagConfig.voucher_expiry_days} onChange={e => setAutoTagConfig({ ...autoTagConfig, voucher_expiry_days: parseInt(e.target.value) || 30 })}
                                className="ui-control mt-1 w-full" />
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
                <form data-demo-submit="invoice.settings" onSubmit={handleSaveInvoice} className="space-y-6">
                    <div>
                        <h3 className="text-sm font-semibold text-[var(--ck-text-strong)] mb-3">Company Details</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Company name (on invoice)</span>
                                <input type="text" value={invoiceForm.company_name} onChange={e => setInvoiceForm({ ...invoiceForm, company_name: e.target.value })}
                                    placeholder="e.g. Aonyx Adventures" className="ui-control mt-1 w-full" />
                            </label>
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Registration number</span>
                                <input type="text" value={invoiceForm.reg_number} onChange={e => setInvoiceForm({ ...invoiceForm, reg_number: e.target.value })}
                                    placeholder="e.g. Reg. 2024/123456/07" className="ui-control mt-1 w-full" />
                            </label>
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">VAT number</span>
                                <input type="text" value={invoiceForm.vat_number} onChange={e => setInvoiceForm({ ...invoiceForm, vat_number: e.target.value })}
                                    placeholder="e.g. 4290176926" className="ui-control mt-1 w-full" />
                            </label>
                        </div>
                        <div className="mt-4 space-y-3">
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Address line 1</span>
                                <input type="text" value={invoiceForm.address_line1} onChange={e => setInvoiceForm({ ...invoiceForm, address_line1: e.target.value })}
                                    placeholder="e.g. 179 Beach Road" className="ui-control mt-1 w-full" />
                            </label>
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Address line 2</span>
                                <input type="text" value={invoiceForm.address_line2} onChange={e => setInvoiceForm({ ...invoiceForm, address_line2: e.target.value })}
                                    placeholder="e.g. Three Anchor Bay, Cape Town" className="ui-control mt-1 w-full" />
                            </label>
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Address line 3</span>
                                <input type="text" value={invoiceForm.address_line3} onChange={e => setInvoiceForm({ ...invoiceForm, address_line3: e.target.value })}
                                    placeholder="e.g. 8005" className="ui-control mt-1 w-full" />
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
                        {bankLoadError && <p className="mb-4 p-3 rounded-xl text-sm font-medium bg-red-50 border border-red-200 text-[var(--ck-danger)]">{bankLoadError}</p>}
                        {/* Locked when the load failed, so a save can't blank the stored details. */}
                        <fieldset disabled={!!bankLoadError} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Account owner</span>
                                <input type="text" value={bankForm.account_owner} onChange={e => { setBankForm({ ...bankForm, account_owner: e.target.value }); setBankDirty(true); }}
                                    placeholder="e.g. Aonyx Adventures" className="ui-control mt-1 w-full" />
                            </label>
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Account number</span>
                                <input type="text" value={bankForm.account_number} onChange={e => { setBankForm({ ...bankForm, account_number: e.target.value }); setBankDirty(true); }}
                                    placeholder="e.g. 070631824" className="ui-control mt-1 w-full" />
                            </label>
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Account type</span>
                                <input type="text" value={bankForm.account_type} onChange={e => { setBankForm({ ...bankForm, account_type: e.target.value }); setBankDirty(true); }}
                                    placeholder="e.g. Current / Cheque" className="ui-control mt-1 w-full" />
                            </label>
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Bank name</span>
                                <input type="text" value={bankForm.bank_name} onChange={e => { setBankForm({ ...bankForm, bank_name: e.target.value }); setBankDirty(true); }}
                                    placeholder="e.g. Standard Bank" className="ui-control mt-1 w-full" />
                            </label>
                            <label className="block">
                                <span className="text-xs font-medium text-[var(--ck-text-muted)]">Branch code</span>
                                <input type="text" value={bankForm.branch_code} onChange={e => { setBankForm({ ...bankForm, branch_code: e.target.value }); setBankDirty(true); }}
                                    placeholder="e.g. 020909" className="ui-control mt-1 w-full" />
                            </label>
                        </fieldset>


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

                    <button type="submit" disabled={readOnly || invoiceSaving}
                        className="rounded-lg bg-[var(--ck-accent)] px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                        {invoiceSaving ? "Saving..." : "Save invoice details"}
                    </button>
                </form>
            </CollapsibleSection>}

            {/* Privileged-only: credential saves are hard-gated to MAIN_ADMIN/SUPER_ADMIN
                server-side, so never show this section to a delegated admin. */}
            {isPrivileged(role) && <CollapsibleSection id="credentials" title="Integration Credentials" subtitle="AES-256 encrypted at rest. Update each integration independently." openSections={openSections} toggle={toggleSection}>
                <p className="mb-4 text-sm text-[var(--ck-text-muted)]">Enter both values to replace an integration, or remove it to start again.</p>
                {role === "MAIN_ADMIN" && !readOnly && <p className="mb-4 text-sm"><Link href="/settings/agent-connections" className="underline">AI connections</Link></p>}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

                    {/* WhatsApp */}
                    <form data-demo-submit="credentials.whatsapp" onSubmit={handleSaveWa} className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5 space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-[var(--ck-border-subtle)]">
                            <div className="flex items-center gap-2" title="WhatsApp (Meta API)">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-[#25D366]"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>
                                <h3 className="sr-only">WhatsApp (Meta API)</h3>
                            </div>
                            {credStatus !== null && (
                                <span className={"ui-status " + (credStatus.wa ? "ui-pill-success" : "ui-pill-amber")}>
                                    {credStatus.wa ? "✓ Configured" : "⚠ Not set"}
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-[var(--ck-text-muted)]">Ask BookingTours to connect your WhatsApp account first. Tokens must come from the BookingTours Meta app.</p>
                        <div>
                            <label htmlFor="settings-wa-token" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Access Token</label>
                            <input id="settings-wa-token"
                                type="password"
                                value={waForm.token}
                                onChange={e => setWaForm({ ...waForm, token: e.target.value })}
                                className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none font-mono"
                                placeholder={credStatus?.wa ? "●●●●●●●● (set; enter a new value to replace)" : "EAAG..."}
                                autoComplete="new-password"
                            />
                            <p className="mt-1 text-xs text-[var(--ck-text-muted)]">BookingTours setup: Meta Business Suite → Settings → Users → System users → Generate token for the BookingTours app. Grant WhatsApp messaging and management access to this business account. The token shown in the app&apos;s WhatsApp API Setup is temporary.</p>
                        </div>
                        <div>
                            <label htmlFor="settings-wa-phone-id" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Phone Number ID</label>
                            <input id="settings-wa-phone-id"
                                type="text"
                                value={waForm.phoneId}
                                onChange={e => setWaForm({ ...waForm, phoneId: e.target.value })}
                                className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none font-mono"
                                placeholder={credStatus?.wa ? "●●●●●●●● (set; enter a new value to replace)" : "123456789012345"}
                                autoComplete="off"
                            />
                            <p className="mt-1 text-xs text-[var(--ck-text-muted)]">Find the Phone Number ID in WhatsApp Manager → Phone numbers, or in the connected Meta app → WhatsApp → API Setup. Use the numeric ID, not your phone number or WhatsApp Business Account ID.</p>
                        </div>
                        <button
                            type="submit"
                            disabled={readOnly || credentialRemoving || waSaving || !waForm.token.trim() || !waForm.phoneId.trim()}
                            className="w-full rounded-xl bg-[var(--ck-text-strong)] py-2.5 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:opacity-90 disabled:opacity-40 transition-opacity"
                        >
                            {waSaving ? "Encrypting & saving..." : "Save WhatsApp Credentials"}
                        </button>
                        {credStatus?.wa && <RemoveIntegrationButton businessId={businessId} section="wa" disabled={readOnly || credentialRemoving || waSaving || yocoSaving || yocoTestSaving || testModeToggling} onBusyChange={setCredentialRemoving} onRemoved={() => handleCredentialsRemoved("wa")} />}
                    </form>

                    {/* Yoco */}
                    <form data-demo-submit="credentials.yoco" onSubmit={handleSaveYoco} className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5 space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-[var(--ck-border-subtle)]">
                            <div className="flex items-center gap-2">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--ck-accent)]"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>
                                <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">Yoco (Payments)</h3>
                            </div>
                            {credStatus !== null && (
                                <span className={"ui-status " + (credStatus.yoco ? "ui-pill-success" : "ui-pill-amber")}>
                                    {credStatus.yoco ? "✓ Configured" : "⚠ Not set"}
                                </span>
                            )}
                        </div>
                        <div>
                            <label htmlFor="settings-yoco-secret" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Secret Key</label>
                            <input id="settings-yoco-secret"
                                type="password"
                                value={yocoForm.secretKey}
                                onChange={e => setYocoForm({ ...yocoForm, secretKey: e.target.value })}
                                className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none font-mono"
                                placeholder={credStatus?.yoco ? "●●●●●●●● (set; enter a new value to replace)" : "sk_live_..."}
                                autoComplete="new-password"
                            />
                        </div>
                        <div>
                            <label htmlFor="settings-yoco-webhook-secret" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Webhook Signing Secret</label>
                            <input id="settings-yoco-webhook-secret"
                                type="password"
                                value={yocoForm.webhookSecret}
                                onChange={e => setYocoForm({ ...yocoForm, webhookSecret: e.target.value })}
                                className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none font-mono"
                                placeholder={credStatus?.yoco ? "●●●●●●●● (set; enter a new value to replace)" : "whsec_..."}
                                autoComplete="new-password"
                            />
                            <p className="mt-1 text-xs text-[var(--ck-text-muted)]">Found in your Yoco Dashboard → Developers → Webhooks → Signing secret.</p>
                        </div>
                        <button
                            type="submit"
                            disabled={readOnly || credentialRemoving || yocoSaving || !yocoForm.secretKey.trim() || !yocoForm.webhookSecret.trim()}
                            className="w-full rounded-xl bg-[var(--ck-text-strong)] py-2.5 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:opacity-90 disabled:opacity-40 transition-opacity"
                        >
                            {yocoSaving ? "Encrypting & saving..." : "Save Yoco Credentials"}
                        </button>
                        {credStatus?.yoco && <RemoveIntegrationButton businessId={businessId} section="yoco" disabled={readOnly || credentialRemoving || waSaving || yocoSaving || yocoTestSaving || testModeToggling} onBusyChange={setCredentialRemoving} onRemoved={() => handleCredentialsRemoved("yoco")} />}
                    </form>

                    {/* Yoco Test Mode */}
                    <div className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5 space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-[var(--ck-border-subtle)]">
                            <div className="flex items-center gap-2">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-orange-500"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                                <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">Yoco Test Mode</h3>
                            </div>
                            {credStatus !== null && (
                                <span className={"ui-status " + (credStatus.yoco_test_mode ? "ui-pill-amber" : "ui-pill-neutral")}>
                                    {credStatus.yoco_test_mode ? "TEST MODE ON" : "Live mode"}
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-[var(--ck-text-muted)] leading-relaxed">
                            Uses Yoco test keys and cards. No real charges.
                        </p>
                        {credStatus?.yoco_test && !credStatus.yoco_test_mode && (
                            <p className="text-xs text-amber-600">Test keys saved. Checkout is still live; turn on Test Mode for test links.</p>
                        )}
                        <button data-demo-action={credStatus?.yoco_test_mode ? "credentials.test-off" : "credentials.test-on"}
                            type="button"
                            onClick={handleToggleTestMode}
                            disabled={readOnly || credentialRemoving || testModeToggling || (!credStatus?.yoco_test && !credStatus?.yoco_test_mode)}
                            className={"w-full rounded-xl py-2.5 text-sm font-semibold transition-opacity disabled:opacity-40 " + (credStatus?.yoco_test_mode
                                ? "border border-[color-mix(in_srgb,var(--ck-amber-bright)_35%,transparent)] bg-[var(--ck-amber-soft)] text-[var(--ck-amber)] hover:bg-[color-mix(in_srgb,var(--ck-amber-bright)_18%,transparent)]"
                                : "bg-orange-500 text-white hover:bg-orange-600")}
                        >
                            {testModeToggling ? "Updating..." : credStatus?.yoco_test_mode ? "Disable Test Mode" : "Enable Test Mode"}
                        </button>
                        {!credStatus?.yoco_test && !credStatus?.yoco_test_mode && (
                            <p className="text-xs text-amber-600">Save test credentials below before enabling test mode.</p>
                        )}
                    </div>

                    {/* Yoco Test Credentials */}
                    <form data-demo-submit="credentials.yoco-test" onSubmit={handleSaveYocoTest} className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5 space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-[var(--ck-border-subtle)]">
                            <div className="flex items-center gap-2">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-orange-400"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>
                                <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">Yoco Test Credentials</h3>
                            </div>
                            {credStatus !== null && (
                                <span className={"ui-status " + (credStatus.yoco_test ? "ui-pill-success" : "ui-pill-amber")}>
                                    {credStatus.yoco_test ? "Configured" : "Not set"}
                                </span>
                            )}
                        </div>
                        <div>
                            <label htmlFor="settings-yoco-test-secret" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Test Secret Key</label>
                            <input id="settings-yoco-test-secret"
                                type="password"
                                value={yocoTestForm.secretKey}
                                onChange={e => setYocoTestForm({ ...yocoTestForm, secretKey: e.target.value })}
                                className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none font-mono"
                                placeholder={credStatus?.yoco_test ? "●●●●●●●● (set; enter a new value to replace)" : "sk_test_..."}
                                autoComplete="new-password"
                            />
                        </div>
                        <div>
                            <label htmlFor="settings-yoco-test-webhook-secret" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Test Webhook Signing Secret</label>
                            <input id="settings-yoco-test-webhook-secret"
                                type="password"
                                value={yocoTestForm.webhookSecret}
                                onChange={e => setYocoTestForm({ ...yocoTestForm, webhookSecret: e.target.value })}
                                className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none font-mono"
                                placeholder={credStatus?.yoco_test ? "●●●●●●●● (set; enter a new value to replace)" : "whsec_test_..."}
                                autoComplete="new-password"
                            />
                            <p className="mt-1 text-xs text-[var(--ck-text-muted)]">Found in your Yoco Dashboard → Developers → Test environment → Webhooks.</p>
                        </div>
                        <button
                            type="submit"
                            disabled={readOnly || credentialRemoving || yocoTestSaving || !yocoTestForm.secretKey.trim() || !yocoTestForm.webhookSecret.trim()}
                            className="w-full rounded-xl bg-[var(--ck-text-strong)] py-2.5 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:opacity-90 disabled:opacity-40 transition-opacity"
                        >
                            {yocoTestSaving ? "Encrypting & saving..." : "Save test credentials"}
                        </button>
                        {credStatus?.yoco_test && <RemoveIntegrationButton businessId={businessId} section="yoco_test" disabled={readOnly || credentialRemoving || waSaving || yocoSaving || yocoTestSaving || testModeToggling} onBusyChange={setCredentialRemoving} onRemoved={() => handleCredentialsRemoved("yoco_test")} />}
                    </form>

                    {/* Google Drive */}
                    <div className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5 space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-[var(--ck-border-subtle)]">
                            <div className="flex items-center gap-2">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-[#4285F4]"><path d="M7.71 3.5L1.15 15l3.43 5.94h6.87L7.71 3.5z" fill="#0066DA"/><path d="M16.29 3.5H7.71l3.74 17.44h6.87l3.43-5.94L16.29 3.5z" fill="#00AC47"/><path d="M1.15 15l3.43 5.94h14.84l3.43-5.94H1.15z" fill="#EA4335"/><path d="M7.71 3.5l3.74 6.48L16.29 3.5H7.71z" fill="#00832D"/><path d="M11.45 9.98L7.71 3.5 1.15 15h7.48l2.82-5.02z" fill="#2684FC"/><path d="M11.45 9.98L16.29 3.5l5.56 11.5h-7.48l-2.92-5.02z" fill="#FFBA00"/></svg>
                                <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">Google Drive (Photos)</h3>
                            </div>
                            <span className={"ui-status " + (gdriveConnected ? "ui-pill-success" : "ui-pill-amber")}>
                                {gdriveConnected ? "Connected" : "Not connected"}
                            </span>
                        </div>
                        {gdriveConnected ? (
                            <>
                                <p className="text-sm text-[var(--ck-text-muted)]">
                                    Connected as <span className="font-medium text-[var(--ck-text-strong)]">{gdriveEmail}</span>
                                </p>
                                <p className="text-xs text-[var(--ck-text-muted)]">Trip photo uploads go to your Google Drive. Disconnect to revoke access.</p>
                                <button data-demo-action="credentials.drive-off"
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
                                <p className="text-sm text-[var(--ck-text-muted)]">Connect Google Drive for uploads from Photos.</p>
                                <button data-demo-action="credentials.drive"
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
                    {!readOnly && <div className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5 space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-[var(--ck-border-subtle)]">
                            <div className="flex items-center gap-2">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                                <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">Google Reviews</h3>
                            </div>
                            {googlePlaceId && (
                                <span className="ui-status ui-pill-success">✓ Configured</span>
                            )}
                        </div>
                        <div>
                            <label htmlFor="settings-google-place-id" className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Google Place ID</label>
                            <input id="settings-google-place-id"
                                type="text"
                                value={googlePlaceId}
                                onChange={e => setGooglePlaceId(e.target.value)}
                                className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none font-mono"
                                placeholder="ChIJ..."
                                autoComplete="off"
                            />
                            <div className="mt-2 space-y-2 text-xs leading-relaxed text-[var(--ck-text-muted)]">
                                <p><strong className="text-[var(--ck-text-strong)]">How reviews work:</strong> guests automatically get a WhatsApp review link a few hours after their trip. Their reviews land on your <a href="/reviews" className="underline">Reviews</a> page as <em>Pending</em>. Approve them to publish on your booking site, or hide them. Connecting your Google Place ID also imports your Google reviews overnight; they display alongside your own (they&apos;re already public on Google, so they skip moderation).</p>
                                <p><strong className="text-[var(--ck-text-strong)]">Find your Place ID:</strong> open <a href="https://developers.google.com/maps/documentation/places/web-service/place-id" target="_blank" rel="noopener" className="underline">Google&apos;s Place ID Finder</a>, search for your business name exactly as it appears on Google Maps, click your business on the map, and copy the ID shown (it usually starts with &quot;ChIJ&quot;). No Google account needed. Reviews sync daily at 03:17 UTC.</p>
                            </div>
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
                            {googlePlaceSaving ? "Saving..." : "Save Place ID"}
                        </button>
                    </div>}

                </div>

                {credMessage.text && (
                    <div className={"mt-4 p-3 rounded-xl text-sm font-medium " + (credMessage.type === "error" ? "bg-red-50 border border-red-200 text-[var(--ck-danger)]" : "bg-emerald-50 border border-emerald-200 text-emerald-700")}>
                        {credMessage.text}
                    </div>
                )}
            </CollapsibleSection>}

            {isPrivileged(role) && <nav aria-label="Settings tools" className="ui-card divide-y divide-[var(--ck-border-subtle)] px-5">
                <Link href="/privacy/data-requests" className="flex items-center gap-3 py-4 text-sm hover:text-[var(--ck-accent)]">
                    <span className="font-semibold">Data Requests</span>
                    <span className="text-xs text-[var(--ck-text-muted)]">Data requests</span>
                    <DataRequestBadge />
                </Link>
                <div className="py-4">
                    <p className="text-sm font-semibold text-[var(--ck-text-strong)]">OTA Channels</p>
                    <p className="mt-1 text-xs text-[var(--ck-text-muted)]">Direct Viator and GetYourGuide connections are not available yet.</p>
                </div>
            </nav>}

            </div>
        </div >
    );
}
