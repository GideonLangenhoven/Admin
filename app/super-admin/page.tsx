"use client";

import { useEffect, useState } from "react";
import { notify } from "../lib/app-notify";
import { supabase } from "../lib/supabase";
import { sendAdminSetupLink } from "../lib/admin-auth";
import { useBusinessContext } from "../../components/BusinessContext";

type OnboardForm = {
  businessName: string;
  businessTagline: string;
  subdomain: string;
  adminName: string;
  adminEmail: string;
  timezone: string;
  currency: string;
  logoUrl: string;
  waToken: string;
  waPhoneId: string;
  yocoSecretKey: string;
  yocoWebhookSecret: string;
};

const DEFAULT_FORM: OnboardForm = {
  businessName: "",
  businessTagline: "",
  subdomain: "",
  adminName: "",
  adminEmail: "",
  timezone: "UTC",
  currency: "ZAR",
  logoUrl: "",
  waToken: "",
  waPhoneId: "",
  yocoSecretKey: "",
  yocoWebhookSecret: "",
};

const BOOKING_DOMAIN = "bookingtours.co.za";

async function sha256(msg: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

type BusinessRow = {
  id: string;
  business_name: string;
  subdomain: string | null;
  max_admin_seats: number;
  admin_count?: number;
  subscription_status: string;
};

export default function SuperAdminPage() {
  const { role } = useBusinessContext();

  if (role !== "SUPER_ADMIN") {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-[var(--ck-text-muted)] text-sm">You do not have permission to view this page.</p>
      </div>
    );
  }
  const [requesterEmail, setRequesterEmail] = useState("");
  const [requesterPassword, setRequesterPassword] = useState("");
  const [form, setForm] = useState<OnboardForm>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [createdClient, setCreatedClient] = useState<{ businessId: string; businessName: string; adminEmail: string } | null>(null);

  // Business admin seat management
  const [businesses, setBusinesses] = useState<BusinessRow[]>([]);
  const [loadingBiz, setLoadingBiz] = useState(false);
  const [savingSeatId, setSavingSeatId] = useState<string | null>(null);
  const [editingSubdomain, setEditingSubdomain] = useState<{ id: string; value: string } | null>(null);
  const [savingSubdomain, setSavingSubdomain] = useState(false);
  const [togglingStatusId, setTogglingStatusId] = useState<string | null>(null);
  const [expandedBiz, setExpandedBiz] = useState<string | null>(null);
  const [bizDetail, setBizDetail] = useState<Record<string, any> | null>(null);
  const [bizDetailLoading, setBizDetailLoading] = useState(false);
  const [bizDetailSaving, setBizDetailSaving] = useState(false);
  const [bizTours, setBizTours] = useState<any[]>([]);
  const [bizFaqs, setBizFaqs] = useState<Array<{ q: string; a: string }>>([]);
  const [bizAdmins, setBizAdmins] = useState<Array<{ id: string; email: string; name: string | null; role: string; suspended: boolean }>>([]);
  const [resettingPasswordId, setResettingPasswordId] = useState<string | null>(null);

  async function loadBusinesses() {
    setLoadingBiz(true);
    // Anon role has SELECT on businesses (RLS allows it)
    const { data, error } = await supabase
      .from("businesses")
      .select("id, business_name, subdomain, max_admin_seats, subscription_status, marketing_included_emails, marketing_overage_rate_zar")
      .order("business_name");
    if (error) {
      console.error("LOAD_BIZ_ERR:", error.message);
      notify({ title: "Failed to load businesses", message: error.message, tone: "error" });
      setLoadingBiz(false);
      return;
    }
    if (data) {
      // Get admin counts per business in parallel
      const withCounts = await Promise.all(
        (data as any[]).map(async (b: any) => {
          const { count } = await supabase
            .from("admin_users")
            .select("id", { count: "exact", head: true })
            .eq("business_id", b.id);
          return { ...b, admin_count: count || 0 };
        })
      );
      setBusinesses(withCounts);
    }
    setLoadingBiz(false);
  }

  async function updateSeatLimit(businessId: string, newLimit: number) {
    setSavingSeatId(businessId);
    const val = Math.max(1, newLimit);
    const { error } = await supabase
      .from("businesses")
      .update({ max_admin_seats: val })
      .eq("id", businessId);
    if (error) {
      notify({ title: "Failed", message: error.message, tone: "error" });
    } else {
      notify({ title: "Updated", message: "Admin seat limit updated.", tone: "success" });
      setBusinesses((prev) =>
        prev.map((b) => (b.id === businessId ? { ...b, max_admin_seats: val } : b))
      );
    }
    setSavingSeatId(null);
  }

  async function saveSubdomain(businessId: string, raw: string) {
    setSavingSubdomain(true);
    var slug = raw.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
    if (!slug) { notify({ title: "Invalid", message: "Subdomain must contain at least one letter or number.", tone: "error" }); setSavingSubdomain(false); return; }
    var base = `https://${slug}.${BOOKING_DOMAIN}`;
    var { error } = await supabase.from("businesses").update({
      subdomain: slug,
      booking_site_url: base,
      manage_bookings_url: base + "/my-bookings",
      booking_success_url: base + "/success",
      booking_cancel_url: base + "/cancelled",
      gift_voucher_url: base + "/voucher",
      voucher_success_url: base + "/voucher-success",
      waiver_url: base + "/waiver",
    }).eq("id", businessId);
    if (error) {
      notify({ title: "Failed", message: error.code === "23505" ? "This subdomain is already taken." : error.message, tone: "error" });
    } else {
      notify({ title: "Subdomain saved", message: `${slug}.${BOOKING_DOMAIN} — all 6 booking URLs regenerated`, tone: "success" });
      setBusinesses((prev) => prev.map((b) => b.id === businessId ? { ...b, subdomain: slug } : b));
      // Refresh expanded detail if this is the open one
      if (expandedBiz === businessId) await loadBizDetail(businessId);
    }
    setEditingSubdomain(null);
    setSavingSubdomain(false);
  }

  async function regenerateDerivedUrls(businessId: string, subdomain: string | null) {
    if (!subdomain) { notify({ title: "No subdomain", message: "Set a subdomain first.", tone: "error" }); return; }
    var base = `https://${subdomain}.${BOOKING_DOMAIN}`;
    var { error } = await supabase.from("businesses").update({
      booking_site_url: base,
      manage_bookings_url: base + "/my-bookings",
      booking_success_url: base + "/success",
      booking_cancel_url: base + "/cancelled",
      gift_voucher_url: base + "/voucher",
      voucher_success_url: base + "/voucher-success",
      waiver_url: base + "/waiver",
    }).eq("id", businessId);
    if (error) {
      notify({ title: "Regenerate failed", message: error.message, tone: "error" });
    } else {
      notify({ title: "URLs regenerated", message: "All 6 booking-site URLs reset to match the subdomain.", tone: "success" });
      if (expandedBiz === businessId) await loadBizDetail(businessId);
    }
  }

  async function toggleSubscriptionStatus(bizId: string, current: string) {
    setTogglingStatusId(bizId);
    var next = current === "SUSPENDED" ? "ACTIVE" : "SUSPENDED";
    var { error } = await supabase.from("businesses").update({ subscription_status: next }).eq("id", bizId);
    if (error) {
      notify({ title: "Failed", message: error.message, tone: "error" });
    } else {
      notify({ title: next === "SUSPENDED" ? "Suspended" : "Reactivated", message: "Subscription status updated to " + next + ".", tone: "success" });
      setBusinesses((prev) => prev.map((b) => b.id === bizId ? { ...b, subscription_status: next } : b));
    }
    setTogglingStatusId(null);
  }

  async function loadBizDetail(bizId: string) {
    if (expandedBiz === bizId) { setExpandedBiz(null); return; }
    setBizDetailLoading(true);
    setExpandedBiz(bizId);

    const { data } = await supabase.from("businesses").select("*").eq("id", bizId).single();
    setBizDetail(data || {});

    // Load tours
    const { data: tours } = await supabase.from("tours").select("id, name, base_price_per_person, duration_minutes, default_capacity, hidden, image_url, description").eq("business_id", bizId).order("sort_order");
    setBizTours(tours || []);

    // Load admin users
    const { data: admins } = await supabase.from("admin_users").select("id, email, name, role, suspended").eq("business_id", bizId).order("role");
    setBizAdmins(admins || []);

    // Parse FAQs
    const faqRaw = data?.faq_json;
    if (faqRaw && typeof faqRaw === "object") {
      if (Array.isArray(faqRaw)) {
        setBizFaqs(faqRaw.map((f: any) => ({ q: f.question || f.q || "", a: f.answer || f.a || "" })));
      } else {
        setBizFaqs(Object.entries(faqRaw).map(([q, a]) => ({ q, a: String(a) })));
      }
    } else { setBizFaqs([]); }

    setBizDetailLoading(false);
  }

  async function saveBizDetail() {
    if (!bizDetail || !expandedBiz) return;
    setBizDetailSaving(true);

    // Rebuild faq_json from array
    const faqObj: Record<string, string> = {};
    bizFaqs.filter(f => f.q.trim()).forEach(f => { faqObj[f.q.trim()] = f.a.trim(); });

    const { error } = await supabase.from("businesses").update({
      business_name: bizDetail.business_name,
      business_tagline: bizDetail.business_tagline,
      operator_email: bizDetail.operator_email,
      from_email: bizDetail.from_email || null,
      timezone: bizDetail.timezone,
      currency: bizDetail.currency,
      logo_url: bizDetail.logo_url,
      hero_eyebrow: bizDetail.hero_eyebrow,
      hero_title: bizDetail.hero_title,
      hero_subtitle: bizDetail.hero_subtitle,
      hero_image: bizDetail.hero_image || null,
      chatbot_avatar: bizDetail.chatbot_avatar,
      color_main: bizDetail.color_main,
      color_secondary: bizDetail.color_secondary,
      color_cta: bizDetail.color_cta,
      color_bg: bizDetail.color_bg,
      color_nav: bizDetail.color_nav,
      color_hover: bizDetail.color_hover,
      directions: bizDetail.directions,
      what_to_bring: bizDetail.what_to_bring,
      what_to_wear: bizDetail.what_to_wear,
      terms_conditions: bizDetail.terms_conditions,
      privacy_policy: bizDetail.privacy_policy,
      cookies_policy: bizDetail.cookies_policy,
      ai_system_prompt: bizDetail.ai_system_prompt,
      faq_json: faqObj,
      nav_gift_voucher_label: bizDetail.nav_gift_voucher_label,
      nav_my_bookings_label: bizDetail.nav_my_bookings_label,
      card_cta_label: bizDetail.card_cta_label,
      chat_widget_label: bizDetail.chat_widget_label,
      footer_line_one: bizDetail.footer_line_one,
      footer_line_two: bizDetail.footer_line_two,
      booking_custom_fields: bizDetail.booking_custom_fields,
      // ── booking-site URLs (explicit override of the derive-from-subdomain defaults) ──
      booking_site_url: bizDetail.booking_site_url || null,
      manage_bookings_url: bizDetail.manage_bookings_url || null,
      booking_success_url: bizDetail.booking_success_url || null,
      booking_cancel_url: bizDetail.booking_cancel_url || null,
      gift_voucher_url: bizDetail.gift_voucher_url || null,
      voucher_success_url: bizDetail.voucher_success_url || null,
      waiver_url: bizDetail.waiver_url || null,
      // ── social links (used in email footers and booking-site footer) ──
      social_facebook: bizDetail.social_facebook || null,
      social_instagram: bizDetail.social_instagram || null,
      social_tiktok: bizDetail.social_tiktok || null,
      social_youtube: bizDetail.social_youtube || null,
      social_twitter: bizDetail.social_twitter || null,
      social_linkedin: bizDetail.social_linkedin || null,
      social_tripadvisor: bizDetail.social_tripadvisor || null,
      social_google_reviews: bizDetail.social_google_reviews || null,
      // ── terminology for booking-site copy ──
      activity_noun: bizDetail.activity_noun || null,
      activity_verb_past: bizDetail.activity_verb_past || null,
      location_phrase: bizDetail.location_phrase || null,
      // ── marketing ──
      marketing_test_email: bizDetail.marketing_test_email || null,
      weather_relevance: bizDetail.weather_relevance ?? true,
    }).eq("id", expandedBiz);

    if (error) { notify({ title: "Save failed", message: error.message, tone: "error" }); }
    else { notify({ title: "Saved", message: "Business details updated.", tone: "success" }); }
    setBizDetailSaving(false);
  }

  async function resetAdminPassword(adminId: string, adminEmail: string) {
    const newPassword = window.prompt(`Enter new password for ${adminEmail}:`);
    if (!newPassword) return;
    if (newPassword.length < 6) {
      notify({ title: "Too short", message: "Password must be at least 6 characters.", tone: "error" });
      return;
    }
    setResettingPasswordId(adminId);
    try {
      const hashed = await sha256(newPassword);
      const { error } = await supabase
        .from("admin_users")
        .update({
          password_hash: hashed,
          must_set_password: false,
          password_set_at: new Date().toISOString(),
        })
        .eq("id", adminId);
      if (error) throw error;
      notify({ title: "Password reset", message: `Password updated for ${adminEmail}.`, tone: "success" });
    } catch (err: any) {
      notify({ title: "Reset failed", message: err.message || "Could not reset password.", tone: "error" });
    } finally {
      setResettingPasswordId(null);
    }
  }

  function updateDetail(key: string, value: any) {
    setBizDetail((prev: any) => prev ? { ...prev, [key]: value } : prev);
  }

  useEffect(() => {
    setRequesterEmail(localStorage.getItem("ck_admin_email") || "");
    if (/super/i.test(role || "")) loadBusinesses();
  }, [role]);

  async function handleLogoUpload(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      setForm((prev) => ({ ...prev, logoUrl: result }));
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/super/i.test(role || "")) {
      notify({ title: "Access denied", message: "Only super admins can onboard new clients.", tone: "error" });
      return;
    }
    if (!requesterEmail) {
      notify({ title: "Missing session email", message: "Sign in again before creating a new tenant.", tone: "warning" });
      return;
    }
    if (!requesterPassword) {
      notify({ title: "Password required", message: "Enter your current password to authorize this onboarding action.", tone: "warning" });
      return;
    }

    setSubmitting(true);
    try {
      const res = await supabase.functions.invoke("super-admin-onboard", {
        body: {
          requester_email: requesterEmail,
          requester_password: requesterPassword,
          business_name: form.businessName,
          business_tagline: form.businessTagline,
          subdomain: form.subdomain || null,
          booking_site_url: form.subdomain ? `https://${form.subdomain}.${BOOKING_DOMAIN}` : null,
          admin_name: form.adminName,
          admin_email: form.adminEmail,
          timezone: form.timezone,
          currency: form.currency,
          logo_url: form.logoUrl || null,
          wa_token: form.waToken || null,
          wa_phone_id: form.waPhoneId || null,
          yoco_secret_key: form.yocoSecretKey || null,
          yoco_webhook_secret: form.yocoWebhookSecret || null,
        },
      });

      if (res.error) throw new Error(res.error.message);
      if (!res.data?.success) throw new Error(res.data?.error || "Unknown onboarding error");

      const admin = res.data.admin;
      if (admin?.id && admin?.email) {
        try {
          await sendAdminSetupLink({ id: admin.id, email: admin.email, name: admin.name || form.adminName }, "ADMIN_INVITE", res.data.business?.id || "");
        } catch (inviteError) {
          console.error("Invite email failed after onboarding:", inviteError);
          notify({
            title: "Client created",
            message: "Tenant was created, but the admin setup email could not be sent automatically.",
            tone: "warning",
          });
        }
      }

      setCreatedClient({
        businessId: res.data.business.id,
        businessName: res.data.business.business_name,
        adminEmail: admin?.email || form.adminEmail,
      });
      setForm(DEFAULT_FORM);
      setRequesterPassword("");
      notify({ title: "Client created", message: "The tenant environment was created successfully.", tone: "success" });
    } catch (error) {
      notify({
        title: "Onboarding failed",
        message: error instanceof Error ? error.message : "There was a problem creating the tenant.",
        tone: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (!/super/i.test(role || "")) {
    return (
      <div className="max-w-2xl">
        <h1 className="mb-6 text-2xl font-bold tracking-tight text-[var(--ck-text-strong)]">Super Admin</h1>
        <div className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-6 text-center">
          <p className="ui-text-muted">This route is restricted to super admin accounts.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--ck-text-strong)]">Super Admin</h1>
        <p className="mt-2 text-sm text-[var(--ck-text-muted)]">Hidden onboarding workspace for creating new client tenants without touching SQL manually.</p>
      </div>

      {createdClient && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <div className="font-semibold">{createdClient.businessName} created</div>
          <div className="mt-1">Business ID: {createdClient.businessId}</div>
          <div className="mt-1">Admin invite target: {createdClient.adminEmail}</div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-6 space-y-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--ck-text-muted)]">Super Admin Email</label>
            <input value={requesterEmail} onChange={(e) => setRequesterEmail(e.target.value)} required className="ui-control w-full rounded-lg px-3 py-2 text-sm outline-none" placeholder="superadmin@example.com" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--ck-text-muted)]">Confirm Your Password</label>
            <input type="password" value={requesterPassword} onChange={(e) => setRequesterPassword(e.target.value)} required className="ui-control w-full rounded-lg px-3 py-2 text-sm outline-none" placeholder="Current admin password" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--ck-text-muted)]">Business Name</label>
            <input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} required className="ui-control w-full rounded-lg px-3 py-2 text-sm outline-none" placeholder="Atlas Adventures" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--ck-text-muted)]">Business Tagline</label>
            <input value={form.businessTagline} onChange={(e) => setForm({ ...form, businessTagline: e.target.value })} className="ui-control w-full rounded-lg px-3 py-2 text-sm outline-none" placeholder="Small-group desert and mountain tours" />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-medium text-[var(--ck-text-muted)]">Booking Subdomain</label>
            <div className="flex items-center gap-0">
              <input
                value={form.subdomain}
                onChange={(e) => setForm({ ...form, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                className="ui-control rounded-r-none rounded-lg px-3 py-2 text-sm outline-none flex-1"
                placeholder="atlas-adventures"
              />
              <span className="inline-flex items-center rounded-r-lg border border-l-0 px-3 py-2 text-xs font-medium" style={{ borderColor: "var(--ck-border-strong)", background: "var(--ck-bg)", color: "var(--ck-text-muted)" }}>.{BOOKING_DOMAIN}</span>
            </div>
            {form.subdomain && (
              <p className="mt-1 text-[10px]" style={{ color: "var(--ck-accent)" }}>
                Booking page: https://{form.subdomain}.{BOOKING_DOMAIN}
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--ck-text-muted)]">Main Admin Name</label>
            <input value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} required className="ui-control w-full rounded-lg px-3 py-2 text-sm outline-none" placeholder="Aisha Khan" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--ck-text-muted)]">Main Admin Email</label>
            <input type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} required className="ui-control w-full rounded-lg px-3 py-2 text-sm outline-none" placeholder="owner@example.com" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--ck-text-muted)]">Timezone</label>
            <input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} required className="ui-control w-full rounded-lg px-3 py-2 text-sm outline-none" placeholder="UTC" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--ck-text-muted)]">Currency</label>
            <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} required maxLength={3} className="ui-control w-full rounded-lg px-3 py-2 text-sm uppercase outline-none" placeholder="ZAR" />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--ck-text-muted)]">Logo Upload</label>
          <input type="file" accept="image/*" onChange={(e) => handleLogoUpload(e.target.files?.[0] || null)} className="ui-control w-full rounded-lg px-3 py-2 text-sm outline-none" />
          {form.logoUrl && <img src={form.logoUrl} alt="Logo preview" className="mt-3 h-20 w-20 rounded-xl border border-[var(--ck-border-subtle)] object-cover" />}
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--ck-text-muted)]">WhatsApp Token</label>
            <textarea value={form.waToken} onChange={(e) => setForm({ ...form, waToken: e.target.value })} rows={4} className="ui-control w-full rounded-lg px-3 py-2 text-sm outline-none" placeholder="EAAG..." />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--ck-text-muted)]">WhatsApp Phone ID</label>
            <textarea value={form.waPhoneId} onChange={(e) => setForm({ ...form, waPhoneId: e.target.value })} rows={4} className="ui-control w-full rounded-lg px-3 py-2 text-sm outline-none" placeholder="1234567890" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--ck-text-muted)]">Yoco Secret Key</label>
            <textarea value={form.yocoSecretKey} onChange={(e) => setForm({ ...form, yocoSecretKey: e.target.value })} rows={4} className="ui-control w-full rounded-lg px-3 py-2 text-sm outline-none" placeholder="sk_live_..." />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--ck-text-muted)]">Yoco Webhook Secret</label>
            <textarea value={form.yocoWebhookSecret} onChange={(e) => setForm({ ...form, yocoWebhookSecret: e.target.value })} rows={4} className="ui-control w-full rounded-lg px-3 py-2 text-sm outline-none" placeholder="whsec_..." />
          </div>
        </div>

        <div className="rounded-xl border border-[var(--ck-border-subtle)] bg-[var(--ck-bg)] p-4 text-xs text-[var(--ck-text-muted)]">
          This creates a new business row, a main admin account, stores encrypted payment and WhatsApp credentials when supplied, and sends the main admin a password setup email.
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={submitting} className="rounded-xl bg-[var(--ck-text-strong)] px-5 py-2.5 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:opacity-90 disabled:opacity-50">
            {submitting ? "Creating client..." : "Add New Client"}
          </button>
        </div>
      </form>

      {/* ── Business Management ── */}
      <div className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--ck-text-strong)]">Business Management</h2>
            <p className="text-xs text-[var(--ck-text-muted)] mt-1">Manage subdomains, admin seats, and booking page routes per business.</p>
          </div>
          <button onClick={loadBusinesses} disabled={loadingBiz} className="text-xs font-medium text-[var(--ck-accent)] hover:underline">
            {loadingBiz ? "Loading..." : "Refresh"}
          </button>
        </div>

        {businesses.length === 0 && !loadingBiz && (
          <p className="text-sm text-[var(--ck-text-muted)]">No businesses found.</p>
        )}

        {businesses.length > 0 && (
          <div className="space-y-3">
            {businesses.map((b) => (
              <div key={b.id} className="rounded-xl border p-4" style={{ borderColor: "var(--ck-border-subtle)" }}>
                <div className="flex items-start justify-between gap-4">
                  {/* Left: Name + ID */}
                  <div>
                    <div className="font-semibold text-[var(--ck-text-strong)]">{b.business_name}</div>
                    <div className="text-[10px] text-[var(--ck-text-muted)] font-mono mt-0.5">{b.id}</div>
                  </div>
                  {/* Right: Status + Seat controls */}
                  <div className="flex items-center gap-3 shrink-0">
                    {/* Subscription status */}
                    <button
                      onClick={() => toggleSubscriptionStatus(b.id, b.subscription_status || "ACTIVE")}
                      disabled={togglingStatusId === b.id}
                      title={b.subscription_status === "SUSPENDED" ? "Click to reactivate" : "Click to suspend"}
                      className={"inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold cursor-pointer transition-colors " +
                        (b.subscription_status === "SUSPENDED"
                          ? "bg-red-100 text-red-700 hover:bg-red-200"
                          : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200")}
                    >
                      {togglingStatusId === b.id ? "..." : (b.subscription_status || "ACTIVE")}
                    </button>
                    {/* Seat controls */}
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-[var(--ck-text-muted)] mr-1">Seats:</span>
                      <button onClick={() => updateSeatLimit(b.id, b.max_admin_seats - 1)} disabled={b.max_admin_seats <= 1 || savingSeatId === b.id}
                        className="h-7 w-7 rounded-lg border border-[var(--ck-border-subtle)] text-sm font-bold hover:bg-[var(--ck-bg-subtle)] disabled:opacity-30">−</button>
                      <span className="w-6 text-center font-semibold text-[var(--ck-text-strong)] text-sm">{b.max_admin_seats}</span>
                      <button onClick={() => updateSeatLimit(b.id, b.max_admin_seats + 1)} disabled={savingSeatId === b.id}
                        className="h-7 w-7 rounded-lg border border-[var(--ck-border-subtle)] text-sm font-bold hover:bg-[var(--ck-bg-subtle)] disabled:opacity-30">+</button>
                      <span className={"ml-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold " +
                        ((b.admin_count || 0) >= b.max_admin_seats ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700")}>
                        {b.admin_count || 0}/{b.max_admin_seats}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Subdomain row */}
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-xs font-medium text-[var(--ck-text-muted)] w-20 shrink-0">Subdomain:</span>
                  {editingSubdomain?.id === b.id ? (
                    <div className="flex items-center gap-0 flex-1">
                      <input
                        value={editingSubdomain.value}
                        onChange={(e) => setEditingSubdomain({ id: b.id, value: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })}
                        className="ui-control rounded-r-none py-1 px-2 text-xs flex-1"
                        placeholder="my-business"
                        autoFocus
                      />
                      <span className="inline-flex items-center border border-l-0 rounded-r-lg px-2 py-1 text-[10px]" style={{ borderColor: "var(--ck-border-strong)", background: "var(--ck-bg)", color: "var(--ck-text-muted)" }}>.{BOOKING_DOMAIN}</span>
                      <button onClick={() => saveSubdomain(b.id, editingSubdomain.value)} disabled={savingSubdomain}
                        className="ml-2 rounded-lg px-3 py-1 text-xs font-semibold text-white" style={{ background: "var(--ck-accent)" }}>
                        {savingSubdomain ? "..." : "Save"}
                      </button>
                      <button onClick={() => setEditingSubdomain(null)} className="ml-1 text-xs text-[var(--ck-text-muted)]">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-1">
                      {b.subdomain ? (
                        <a href={`https://${b.subdomain}.${BOOKING_DOMAIN}`} target="_blank" rel="noopener noreferrer"
                          className="text-xs font-mono font-medium" style={{ color: "var(--ck-accent)" }}>
                          {b.subdomain}.{BOOKING_DOMAIN}
                        </a>
                      ) : (
                        <span className="text-xs italic text-[var(--ck-text-muted)]">Not configured</span>
                      )}
                      <button onClick={() => setEditingSubdomain({ id: b.id, value: b.subdomain || "" })}
                        className="text-[10px] font-medium text-[var(--ck-accent)] hover:underline">
                        {b.subdomain ? "Change" : "Set up"}
                      </button>
                    </div>
                  )}
                  {/* View/Edit Details toggle */}
                  <button onClick={() => loadBizDetail(b.id)} className="mt-2 text-[10px] font-medium hover:underline" style={{ color: "var(--ck-accent)" }}>
                    {expandedBiz === b.id ? "▲ Hide Details" : "▼ View / Edit Details"}
                  </button>
                </div>

                {/* ── Expanded Detail Panel ── */}
                {expandedBiz === b.id && (
                  <div className="mt-3 border-t pt-4 space-y-5" style={{ borderColor: "var(--ck-border-subtle)" }}>
                    {bizDetailLoading ? (
                      <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400" /></div>
                    ) : bizDetail ? (
                      <>
                        {/* ── Business Info ── */}
                        <fieldset>
                          <legend className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--ck-text-muted)" }}>Business Info</legend>
                          <div className="grid grid-cols-2 gap-3">
                            {[
                              ["business_name", "Business Name"],
                              ["business_tagline", "Tagline"],
                              ["operator_email", "Operator Email"],
                              ["timezone", "Timezone"],
                              ["currency", "Currency"],
                              ["logo_url", "Logo URL"],
                              ["from_email", "Sender Email (Resend verified)"],
                            ].map(([key, label]) => (
                              <label key={key} className="text-xs text-[var(--ck-text-muted)]">
                                {label}
                                <input value={bizDetail[key] || ""} onChange={(e) => updateDetail(key, e.target.value)}
                                  className="mt-0.5 w-full ui-control rounded-lg px-2 py-1.5 text-xs" />
                              </label>
                            ))}
                          </div>
                        </fieldset>

                        {/* ── Branding ── */}
                        <fieldset>
                          <legend className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--ck-text-muted)" }}>Branding & Colors</legend>
                          <div className="grid grid-cols-3 gap-3">
                            {[
                              ["hero_eyebrow", "Hero Eyebrow"],
                              ["hero_title", "Hero Title"],
                              ["hero_subtitle", "Hero Subtitle"],
                            ].map(([key, label]) => (
                              <label key={key} className="text-xs text-[var(--ck-text-muted)]">
                                {label}
                                <input value={bizDetail[key] || ""} onChange={(e) => updateDetail(key, e.target.value)}
                                  className="mt-0.5 w-full ui-control rounded-lg px-2 py-1.5 text-xs" />
                              </label>
                            ))}
                          </div>
                          <div className="grid grid-cols-6 gap-2 mt-2">
                            {[
                              ["color_main", "Main"],
                              ["color_secondary", "Secondary"],
                              ["color_cta", "CTA"],
                              ["color_bg", "Background"],
                              ["color_nav", "Nav"],
                              ["color_hover", "Hover"],
                            ].map(([key, label]) => (
                              <label key={key} className="text-xs text-center text-[var(--ck-text-muted)]">
                                {label}
                                <input type="color" value={bizDetail[key] || "#000000"} onChange={(e) => updateDetail(key, e.target.value)}
                                  className="mt-0.5 mx-auto block h-8 w-10 cursor-pointer rounded border-0" />
                              </label>
                            ))}
                          </div>
                          <label className="mt-2 block text-xs text-[var(--ck-text-muted)]">
                            Chatbot Avatar URL
                            <input value={bizDetail.chatbot_avatar || ""} onChange={(e) => updateDetail("chatbot_avatar", e.target.value)}
                              className="mt-0.5 w-full ui-control rounded-lg px-2 py-1.5 text-xs" />
                          </label>
                        </fieldset>

                        {/* ── Operations ── */}
                        <fieldset>
                          <legend className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--ck-text-muted)" }}>Operations & Content</legend>
                          <div className="grid grid-cols-1 gap-3">
                            {[
                              ["directions", "Meeting Point / Directions"],
                              ["what_to_bring", "What to Bring"],
                              ["what_to_wear", "What to Wear"],
                            ].map(([key, label]) => (
                              <label key={key} className="text-xs text-[var(--ck-text-muted)]">
                                {label}
                                <textarea value={bizDetail[key] || ""} onChange={(e) => updateDetail(key, e.target.value)} rows={2}
                                  className="mt-0.5 w-full ui-control rounded-lg px-2 py-1.5 text-xs" />
                              </label>
                            ))}
                          </div>
                        </fieldset>

                        {/* ── Navigation & Footer Labels ── */}
                        <fieldset>
                          <legend className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--ck-text-muted)" }}>Booking Page Labels</legend>
                          <div className="grid grid-cols-3 gap-3">
                            {[
                              ["nav_gift_voucher_label", "Gift Voucher Label"],
                              ["nav_my_bookings_label", "My Bookings Label"],
                              ["card_cta_label", "Tour Card CTA"],
                              ["chat_widget_label", "Chat Widget Label"],
                              ["footer_line_one", "Footer Line 1"],
                              ["footer_line_two", "Footer Line 2"],
                            ].map(([key, label]) => (
                              <label key={key} className="text-xs text-[var(--ck-text-muted)]">
                                {label}
                                <input value={bizDetail[key] || ""} onChange={(e) => updateDetail(key, e.target.value)}
                                  className="mt-0.5 w-full ui-control rounded-lg px-2 py-1.5 text-xs" />
                              </label>
                            ))}
                          </div>
                        </fieldset>

                        {/* ── Booking Site URLs ── */}
                        <fieldset>
                          <div className="flex items-center justify-between mb-2">
                            <legend className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--ck-text-muted)" }}>Booking Site URLs</legend>
                            <button type="button" onClick={() => regenerateDerivedUrls(b.id, bizDetail.subdomain || b.subdomain)}
                              className="text-[10px] font-medium hover:underline" style={{ color: "var(--ck-accent)" }}>
                              ⟲ Regenerate from subdomain
                            </button>
                          </div>
                          <div className="grid grid-cols-1 gap-2">
                            {[
                              ["booking_site_url", "Booking site (customer entry)"],
                              ["manage_bookings_url", "Manage bookings (customer self-service)"],
                              ["booking_success_url", "Payment success redirect"],
                              ["booking_cancel_url", "Payment cancel redirect"],
                              ["gift_voucher_url", "Gift voucher purchase"],
                              ["voucher_success_url", "Voucher purchase success"],
                              ["waiver_url", "Waiver signing page"],
                            ].map(([key, label]) => (
                              <label key={key} className="text-xs text-[var(--ck-text-muted)]">
                                {label}
                                <input type="url" value={bizDetail[key] || ""} onChange={(e) => updateDetail(key, e.target.value)}
                                  className="mt-0.5 w-full ui-control rounded-lg px-2 py-1.5 text-xs font-mono" placeholder="https://…" />
                              </label>
                            ))}
                          </div>
                        </fieldset>

                        {/* ── Social Links ── */}
                        <fieldset>
                          <legend className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--ck-text-muted)" }}>Social Links (email footers + site footer)</legend>
                          <div className="grid grid-cols-2 gap-3">
                            {[
                              ["social_facebook", "Facebook"],
                              ["social_instagram", "Instagram"],
                              ["social_tiktok", "TikTok"],
                              ["social_youtube", "YouTube"],
                              ["social_twitter", "Twitter / X"],
                              ["social_linkedin", "LinkedIn"],
                              ["social_tripadvisor", "TripAdvisor"],
                              ["social_google_reviews", "Google Reviews"],
                            ].map(([key, label]) => (
                              <label key={key} className="text-xs text-[var(--ck-text-muted)]">
                                {label}
                                <input type="url" value={bizDetail[key] || ""} onChange={(e) => updateDetail(key, e.target.value)}
                                  className="mt-0.5 w-full ui-control rounded-lg px-2 py-1.5 text-xs" placeholder="https://…" />
                              </label>
                            ))}
                          </div>
                        </fieldset>

                        {/* ── Terminology / Messaging ── */}
                        <fieldset>
                          <legend className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--ck-text-muted)" }}>Terminology & Messaging</legend>
                          <div className="grid grid-cols-3 gap-3">
                            {[
                              ["activity_noun", "Activity noun (e.g. 'tour', 'dive', 'flight')"],
                              ["activity_verb_past", "Activity verb — past (e.g. 'kayaked')"],
                              ["location_phrase", "Location phrase (e.g. 'in Cape Town')"],
                            ].map(([key, label]) => (
                              <label key={key} className="text-xs text-[var(--ck-text-muted)]">
                                {label}
                                <input value={bizDetail[key] || ""} onChange={(e) => updateDetail(key, e.target.value)}
                                  className="mt-0.5 w-full ui-control rounded-lg px-2 py-1.5 text-xs" />
                              </label>
                            ))}
                          </div>
                        </fieldset>

                        {/* ── Hero Image + Marketing test recipient + Weather relevance ── */}
                        <fieldset>
                          <legend className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--ck-text-muted)" }}>Hero / Marketing / Weather</legend>
                          <div className="grid grid-cols-1 gap-3">
                            <label className="text-xs text-[var(--ck-text-muted)]">
                              Hero background image URL
                              <input type="url" value={bizDetail.hero_image || ""} onChange={(e) => updateDetail("hero_image", e.target.value)}
                                className="mt-0.5 w-full ui-control rounded-lg px-2 py-1.5 text-xs" placeholder="https://…" />
                            </label>
                            <label className="text-xs text-[var(--ck-text-muted)]">
                              Marketing test recipient (where test campaign sends go)
                              <input type="email" value={bizDetail.marketing_test_email || ""} onChange={(e) => updateDetail("marketing_test_email", e.target.value)}
                                className="mt-0.5 w-full ui-control rounded-lg px-2 py-1.5 text-xs" placeholder="test@operator.example" />
                            </label>
                            <label className="flex items-center gap-2 text-xs text-[var(--ck-text-muted)]">
                              <input type="checkbox" checked={bizDetail.weather_relevance !== false} onChange={(e) => updateDetail("weather_relevance", e.target.checked)} />
                              Weather-sensitive operation (enables weather-cancel logic)
                            </label>
                          </div>
                        </fieldset>

                        {/* ── AI & Chatbot ── */}
                        <fieldset>
                          <legend className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--ck-text-muted)" }}>AI Chatbot Configuration</legend>
                          <label className="text-xs text-[var(--ck-text-muted)]">
                            AI System Prompt
                            <textarea value={bizDetail.ai_system_prompt || ""} onChange={(e) => updateDetail("ai_system_prompt", e.target.value)} rows={4}
                              className="mt-0.5 w-full ui-control rounded-lg px-2 py-1.5 text-xs font-mono"
                              placeholder="You are a friendly booking assistant for [business]. Keep replies short..." />
                          </label>
                        </fieldset>

                        {/* ── FAQs ── */}
                        <fieldset>
                          <legend className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--ck-text-muted)" }}>
                            FAQs ({bizFaqs.length}) — Powers chatbot responses
                          </legend>
                          <div className="space-y-2">
                            {bizFaqs.map((faq, i) => (
                              <div key={i} className="flex gap-2 items-start">
                                <div className="flex-1 grid grid-cols-2 gap-2">
                                  <input value={faq.q} onChange={(e) => { const next = [...bizFaqs]; next[i].q = e.target.value; setBizFaqs(next); }}
                                    className="ui-control rounded-lg px-2 py-1.5 text-xs" placeholder="Question" />
                                  <input value={faq.a} onChange={(e) => { const next = [...bizFaqs]; next[i].a = e.target.value; setBizFaqs(next); }}
                                    className="ui-control rounded-lg px-2 py-1.5 text-xs" placeholder="Answer" />
                                </div>
                                <button onClick={() => setBizFaqs(bizFaqs.filter((_, j) => j !== i))} className="text-red-500 text-xs mt-1">✕</button>
                              </div>
                            ))}
                            <button onClick={() => setBizFaqs([...bizFaqs, { q: "", a: "" }])}
                              className="text-xs font-medium hover:underline" style={{ color: "var(--ck-accent)" }}>+ Add FAQ</button>
                          </div>
                        </fieldset>

                        {/* ── Policies / Legal ── */}
                        <fieldset>
                          <legend className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--ck-text-muted)" }}>Legal & Policies</legend>
                          <div className="grid grid-cols-1 gap-3">
                            {[
                              ["terms_conditions", "Terms & Conditions"],
                              ["privacy_policy", "Privacy Policy"],
                              ["cookies_policy", "Cookies Policy"],
                            ].map(([key, label]) => (
                              <label key={key} className="text-xs text-[var(--ck-text-muted)]">
                                {label}
                                <textarea value={bizDetail[key] || ""} onChange={(e) => updateDetail(key, e.target.value)} rows={3}
                                  className="mt-0.5 w-full ui-control rounded-lg px-2 py-1.5 text-xs" />
                              </label>
                            ))}
                          </div>
                        </fieldset>

                        {/* ── Tours (read-only overview) ── */}
                        <fieldset>
                          <legend className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--ck-text-muted)" }}>
                            Tours ({bizTours.length})
                          </legend>
                          {bizTours.length === 0 ? (
                            <p className="text-xs italic text-[var(--ck-text-muted)]">No tours configured. Tours can be added in Settings when logged in as this business.</p>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {bizTours.map((t) => (
                                <div key={t.id} className="rounded-lg border p-2.5 flex items-center gap-3" style={{ borderColor: "var(--ck-border-subtle)" }}>
                                  {t.image_url && <img src={t.image_url} alt="" className="h-10 w-10 rounded object-cover shrink-0" />}
                                  <div className="min-w-0">
                                    <div className="text-xs font-semibold text-[var(--ck-text-strong)] truncate">{t.name}</div>
                                    <div className="text-[10px] text-[var(--ck-text-muted)]">
                                      R{t.base_price_per_person} · {t.duration_minutes}min · Cap {t.default_capacity}
                                      {t.hidden && <span className="ml-1 text-amber-500">(Hidden)</span>}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </fieldset>

                        {/* ── Admin Users ── */}
                        <fieldset>
                          <legend className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--ck-text-muted)" }}>
                            Admin Users ({bizAdmins.length})
                          </legend>
                          {bizAdmins.length === 0 ? (
                            <p className="text-xs italic text-[var(--ck-text-muted)]">No admin users found for this business.</p>
                          ) : (
                            <div className="space-y-2">
                              {bizAdmins.map((admin) => (
                                <div key={admin.id} className="flex items-center justify-between rounded-lg border p-2.5" style={{ borderColor: "var(--ck-border-subtle)" }}>
                                  <div className="min-w-0">
                                    <div className="text-xs font-semibold text-[var(--ck-text-strong)] truncate">
                                      {admin.name || admin.email}
                                      {admin.suspended && <span className="ml-1.5 text-red-500 text-[10px] font-bold">(Suspended)</span>}
                                    </div>
                                    <div className="text-[10px] text-[var(--ck-text-muted)]">
                                      {admin.email} · {admin.role}
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => resetAdminPassword(admin.id, admin.email)}
                                    disabled={resettingPasswordId === admin.id}
                                    className="shrink-0 ml-3 rounded-lg border px-3 py-1 text-xs font-semibold transition-colors hover:bg-[var(--ck-bg-subtle)] disabled:opacity-50"
                                    style={{ borderColor: "var(--ck-border-subtle)", color: "var(--ck-text-strong)" }}
                                  >
                                    {resettingPasswordId === admin.id ? "Resetting..." : "Reset Password"}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </fieldset>

                        {/* ── Save ── */}
                        <div className="flex justify-end pt-2 border-t" style={{ borderColor: "var(--ck-border-subtle)" }}>
                          <button onClick={saveBizDetail} disabled={bizDetailSaving}
                            className="rounded-lg px-5 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: "var(--ck-accent)" }}>
                            {bizDetailSaving ? "Saving..." : "Save All Changes"}
                          </button>
                        </div>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Landing Pages ── */}
      <LandingPageManager businesses={businesses} />

      {/* ── Email Usage & Billing ── */}
      <EmailUsageBilling />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Landing Page Manager
   ══════════════════════════════════════════════════════════════ */

const TEMPLATES = [
  { id: "adventure", name: "Adventure", desc: "Cinematic fullscreen hero, scroll-reveal animations, glassmorphism nav", preview: "A" },
  { id: "modern", name: "Modern", desc: "Bold split-hero layout, stat counters, sharp geometric design", preview: "M" },
  { id: "luxury", name: "Luxury", desc: "Elegant serif typography, gold accents, refined whitespace", preview: "L" },
  { id: "safari", name: "Safari", desc: "Warm earthy tones, bottom-aligned hero, lodge aesthetic", preview: "S" },
  { id: "coastal", name: "Coastal", desc: "Ocean blues, wave dividers, fresh beach vibes", preview: "C" },
  { id: "minimal", name: "Minimal", desc: "Ultra-clean whitespace, no decoration, typography-focused", preview: "Mi" },
  { id: "dark", name: "Dark", desc: "Full dark mode, neon glow accents, cinematic moody feel", preview: "D" },
  { id: "retro", name: "Retro", desc: "Vintage serif fonts, warm film tones, nostalgic charm", preview: "R" },
  { id: "tropical", name: "Tropical", desc: "Lush greens, vibrant gradients, paradise island energy", preview: "T" },
  { id: "bold", name: "Bold", desc: "Oversized typography, editorial magazine style, high contrast", preview: "B" },
  { id: "zen", name: "Zen", desc: "Japanese-inspired minimalism, extreme calm, soft neutrals", preview: "Z" },
  { id: "vibrant", name: "Vibrant", desc: "Colorful gradients, glassmorphism cards, energetic youth feel", preview: "V" },
  { id: "nordic", name: "Nordic", desc: "Scandinavian clean lines, muted blues, geometric accents", preview: "N" },
  { id: "heritage", name: "Heritage", desc: "South African warmth, terracotta tones, cultural patterns", preview: "H" },
];

function LandingPageManager({ businesses }: { businesses: any[] }) {
  const [selectedBiz, setSelectedBiz] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("adventure");
  const [generating, setGenerating] = useState(false);
  const [generatedHtml, setGeneratedHtml] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [customDomain, setCustomDomain] = useState("");
  const [firebaseSite, setFirebaseSite] = useState("");

  async function generateLandingPage() {
    if (!selectedBiz) { notify({ title: "Select a business", message: "Choose which business to generate a landing page for.", tone: "warning" }); return; }
    setGenerating(true);

    // Load business + tours data
    const { data: biz } = await supabase.from("businesses").select("*").eq("id", selectedBiz).single();
    const { data: tours } = await supabase.from("tours").select("name, description, duration_minutes, default_capacity, base_price_per_person, image_url").eq("business_id", selectedBiz).eq("hidden", false).order("sort_order");

    if (!biz) { notify({ title: "Error", message: "Business not found.", tone: "error" }); setGenerating(false); return; }

    // Build context
    const ctx: Record<string, any> = {
      business_name: biz.business_name || biz.name || "",
      tagline: biz.business_tagline || "",
      logo_url: biz.logo_url || "",
      hero_eyebrow: biz.hero_eyebrow || "",
      hero_title: biz.hero_title || biz.business_name || "Welcome",
      hero_subtitle: biz.hero_subtitle || biz.business_tagline || "",
      hero_image: "",
      color_main: biz.color_main || "#1a3c34",
      color_secondary: biz.color_secondary || "#132833",
      color_cta: biz.color_cta || "#ca6c2f",
      color_bg: biz.color_bg || "#f5f5f5",
      color_nav: biz.color_nav || "#ffffff",
      color_hover: biz.color_hover || "#48cfad",
      booking_url: biz.booking_site_url || (biz.subdomain ? `https://${biz.subdomain}.bookingtours.co.za` : "#"),
      directions: biz.directions || "",
      what_to_bring: biz.what_to_bring || "",
      what_to_wear: biz.what_to_wear || "",
      footer_line_one: biz.footer_line_one || `Thanks for choosing ${biz.business_name || "us"}.`,
      footer_line_two: biz.footer_line_two || "",
      currency: biz.currency || "R",
      year: new Date().getFullYear().toString(),
      tours: (tours || []).map((t: any) => ({
        name: t.name, description: t.description || "",
        duration_minutes: t.duration_minutes || "90",
        default_capacity: t.default_capacity || "10",
        base_price_per_person: t.base_price_per_person || "0",
        image_url: t.image_url || "",
      })),
    };

    // Fetch template
    try {
      const res = await fetch(`/landing-pages/templates/${selectedTemplate}.html`);
      if (!res.ok) throw new Error("Template not found");
      let tpl = await res.text();

      // Simple template rendering (same logic as build.mjs but client-side)
      function render(template: string, data: Record<string, any>, parent: Record<string, any> = {}): string {
        let r = template;
        r = r.replace(/\{\{#each (\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, key, body) => {
          return (data[key] || []).map((item: any) => render(body, item, data)).join("\n");
        });
        r = r.replace(/\{\{#if (\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g, (_, key, ifBody, elseBody) => {
          return data[key] ? render(ifBody, data, parent) : (elseBody ? render(elseBody, data, parent) : "");
        });
        r = r.replace(/\{\{\.\.\/([\w.]+)\}\}/g, (_, key) => String(parent[key] ?? data[key] ?? ""));
        r = r.replace(/\{\{(\w+)\}\}/g, (_, key) => String(data[key] ?? ""));
        return r;
      }

      const html = render(tpl, ctx);
      setGeneratedHtml(html);
      setShowPreview(true);
      setFirebaseSite(biz.subdomain || biz.business_name?.toLowerCase().replace(/[^a-z0-9]/g, "-") || "site");
      setCustomDomain("");
      notify({ title: "Landing page generated", message: `${ctx.business_name} — ${selectedTemplate} template`, tone: "success" });
    } catch (err: any) {
      notify({ title: "Generation failed", message: err.message, tone: "error" });
    }
    setGenerating(false);
  }

  function downloadHtml() {
    const blob = new Blob([generatedHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${firebaseSite}-landing-page.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadProject() {
    // Package as a deployable folder (firebase.json + index.html)
    const firebaseJson = JSON.stringify({
      hosting: {
        public: ".",
        ignore: ["firebase.json", "**/.*"],
        headers: [{ source: "**", headers: [{ key: "X-Frame-Options", value: "DENY" }] }],
        rewrites: [{ source: "**", destination: "/index.html" }]
      }
    }, null, 2);

    // Create a simple zip-like download (two files)
    const content = `<!--- FIREBASE DEPLOYMENT PACKAGE --->\n<!--- 1. Save index.html and firebase.json in the same folder --->\n<!--- 2. Run: firebase deploy --only hosting:${firebaseSite} --->\n\n<!-- firebase.json -->\n<!--\n${firebaseJson}\n-->\n\n${generatedHtml}`;
    const blob = new Blob([generatedHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${firebaseSite}/index.html`;
    a.click();
    URL.revokeObjectURL(url);

    // Also download firebase.json
    setTimeout(() => {
      const b2 = new Blob([firebaseJson], { type: "application/json" });
      const u2 = URL.createObjectURL(b2);
      const a2 = document.createElement("a");
      a2.href = u2;
      a2.download = `${firebaseSite}-firebase.json`;
      a2.click();
      URL.revokeObjectURL(u2);
    }, 500);

    notify({ title: "Downloaded", message: "Save both files in the same folder, then run firebase deploy.", tone: "success" });
  }

  return (
    <div className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-[var(--ck-text-strong)]">Landing Pages</h2>
        <p className="text-xs text-[var(--ck-text-muted)] mt-1">Generate polished landing pages for each business. Choose a template, preview, and deploy to Firebase.</p>
      </div>

      {/* Step 1: Select business */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="text-xs font-medium text-[var(--ck-text-muted)] mb-1 block">Business</label>
          <select value={selectedBiz} onChange={(e) => setSelectedBiz(e.target.value)}
            className="w-full ui-control rounded-lg px-3 py-2 text-sm">
            <option value="">Select a business...</option>
            {businesses.map((b) => <option key={b.id} value={b.id}>{b.business_name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-[var(--ck-text-muted)] mb-1 block">Template</label>
          <select value={selectedTemplate} onChange={(e) => setSelectedTemplate(e.target.value)}
            className="w-full ui-control rounded-lg px-3 py-2 text-sm">
            {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.desc}</option>)}
          </select>
        </div>
      </div>

      {/* Template previews */}
      <div className="grid grid-cols-7 gap-2 mb-4">
        {TEMPLATES.map((t) => (
          <button key={t.id} onClick={() => setSelectedTemplate(t.id)}
            className={"rounded-xl border p-2.5 text-center transition-all cursor-pointer " + (selectedTemplate === t.id ? "ring-2 shadow-sm" : "opacity-50 hover:opacity-80")}
            style={{ borderColor: selectedTemplate === t.id ? "var(--ck-accent)" : "var(--ck-border-subtle)", ["--tw-ring-color" as any]: "var(--ck-accent)" }}>
            <div className="w-8 h-8 rounded-lg mx-auto mb-1.5 flex items-center justify-center text-xs font-bold text-white" style={{ background: selectedTemplate === t.id ? "var(--ck-accent)" : "var(--ck-text-muted)" }}>{t.preview}</div>
            <div className="text-[11px] font-semibold text-[var(--ck-text-strong)] leading-tight">{t.name}</div>
          </button>
        ))}
      </div>

      {/* Generate button */}
      <button onClick={generateLandingPage} disabled={generating || !selectedBiz}
        className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 w-full" style={{ background: "var(--ck-accent)" }}>
        {generating ? "Generating..." : "Generate Landing Page"}
      </button>

      {/* Preview + Actions */}
      {showPreview && generatedHtml && (
        <div className="mt-4 space-y-3">
          {/* Preview iframe */}
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--ck-border-subtle)" }}>
            <div className="px-3 py-2 flex items-center justify-between text-xs" style={{ background: "var(--ck-bg-subtle)", color: "var(--ck-text-muted)" }}>
              <span>Preview — {TEMPLATES.find((t) => t.id === selectedTemplate)?.name} template</span>
              <div className="flex gap-2">
                <button onClick={() => setShowPreview(!showPreview)} className="hover:underline">{showPreview ? "Hide" : "Show"}</button>
              </div>
            </div>
            <iframe srcDoc={generatedHtml} className="w-full border-0" style={{ height: "500px" }} title="Landing page preview" sandbox="allow-scripts" />
          </div>

          {/* Actions */}
          <div className="grid grid-cols-3 gap-2">
            <button onClick={downloadHtml} className="rounded-lg border px-4 py-2.5 text-xs font-semibold text-center" style={{ borderColor: "var(--ck-border-subtle)", color: "var(--ck-text-strong)" }}>
              Download HTML
            </button>
            <button onClick={downloadProject} className="rounded-lg border px-4 py-2.5 text-xs font-semibold text-center" style={{ borderColor: "var(--ck-border-subtle)", color: "var(--ck-text-strong)" }}>
              Download for IDE
            </button>
            <button onClick={() => {
              const w = window.open("", "_blank");
              if (w) { w.document.write(generatedHtml); w.document.close(); }
            }} className="rounded-lg border px-4 py-2.5 text-xs font-semibold text-center" style={{ borderColor: "var(--ck-border-subtle)", color: "var(--ck-text-strong)" }}>
              Open Full Page
            </button>
          </div>

          {/* Deployment guide */}
          <div className="rounded-xl border p-4" style={{ borderColor: "var(--ck-border-subtle)", background: "var(--ck-bg-subtle)" }}>
            <h3 className="text-sm font-semibold text-[var(--ck-text-strong)] mb-2">Deploy to Firebase</h3>
            <div className="space-y-2 text-xs" style={{ color: "var(--ck-text-muted)" }}>
              <div className="flex items-start gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full bg-[var(--ck-accent)] text-white flex items-center justify-center text-[10px] font-bold">1</span>
                <div>
                  <div className="font-medium text-[var(--ck-text)]">Create Firebase site</div>
                  <code className="block mt-0.5 p-1.5 rounded bg-[var(--ck-surface)] text-[10px] font-mono">firebase hosting:sites:create {firebaseSite} --project bookingtours-sites</code>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full bg-[var(--ck-accent)] text-white flex items-center justify-center text-[10px] font-bold">2</span>
                <div>
                  <div className="font-medium text-[var(--ck-text)]">Deploy</div>
                  <code className="block mt-0.5 p-1.5 rounded bg-[var(--ck-surface)] text-[10px] font-mono">firebase deploy --only hosting:{firebaseSite} --project bookingtours-sites</code>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="shrink-0 w-5 h-5 rounded-full bg-[var(--ck-accent)] text-white flex items-center justify-center text-[10px] font-bold">3</span>
                <div>
                  <div className="font-medium text-[var(--ck-text)]">Add custom domain (Firebase Console → Hosting → {firebaseSite} → Custom domain)</div>
                  <div className="mt-1">
                    <label className="text-[10px] font-medium">Custom domain for this site:</label>
                    <input value={customDomain} onChange={(e) => setCustomDomain(e.target.value)} placeholder="e.g. www.clientbusiness.co.za"
                      className="mt-0.5 w-full rounded border px-2 py-1 text-[11px]" style={{ borderColor: "var(--ck-border-strong)", background: "var(--ck-surface)" }} />
                  </div>
                  {customDomain && (
                    <div className="mt-1 p-2 rounded text-[10px]" style={{ background: "var(--ck-surface)" }}>
                      <div className="font-semibold mb-1">DNS records to add at your registrar:</div>
                      <div><strong>A</strong> record → <code>151.101.1.195</code> and <code>151.101.65.195</code></div>
                      <div><strong>TXT</strong> record → <code>hosting-site={firebaseSite}</code></div>
                      <div className="mt-1 text-[9px] opacity-60">Exact values will be shown in Firebase Console after adding the domain. SSL auto-provisions in ~30 min.</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Email Usage Dashboard + Invoice Generator (separate component
   to keep state isolated)
   ══════════════════════════════════════════════════════════════ */

type EmailUsageRow = {
  business_id: string;
  business_name: string;
  period: string;
  emails_sent: number;
  included: number;
  overage: number;
  rate_zar: number;
  overage_cost: number;
};

function EmailUsageBilling() {
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [rows, setRows] = useState<EmailUsageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingRate, setEditingRate] = useState<{ id: string; value: string } | null>(null);
  const [savingRate, setSavingRate] = useState(false);
  const [generatingInvoice, setGeneratingInvoice] = useState<string | null>(null);

  async function loadUsage() {
    setLoading(true);

    const { data: bizData, error: bizErr } = await supabase
      .from("businesses")
      .select("id, business_name, marketing_included_emails, marketing_overage_rate_zar")
      .order("business_name");
    if (bizErr) {
      console.error("LOAD_BIZ_USAGE_ERR:", bizErr.message);
      setLoading(false);
      return;
    }

    if (!bizData) { setLoading(false); return; }

    // Get usage for the selected period
    const { data: usageData } = await supabase
      .from("marketing_usage_monthly")
      .select("business_id, emails_sent")
      .eq("period", period);

    const usageMap = new Map((usageData || []).map((u: any) => [u.business_id, u.emails_sent]));

    const combined: EmailUsageRow[] = bizData.map((b: any) => {
      const sent = usageMap.get(b.id) || 0;
      const included = Number(b.marketing_included_emails || 500);
      const rate = Number(b.marketing_overage_rate_zar || 0.15);
      const overage = Math.max(0, sent - included);
      return {
        business_id: b.id,
        business_name: b.business_name,
        period,
        emails_sent: sent,
        included,
        overage,
        rate_zar: rate,
        overage_cost: Math.round(overage * rate * 100) / 100,
      };
    });

    setRows(combined);
    setLoading(false);
  }

  useEffect(() => { loadUsage(); }, [period]);

  async function saveRate(businessId: string, newRate: number) {
    setSavingRate(true);
    const { error } = await supabase
      .from("businesses")
      .update({ marketing_overage_rate_zar: Math.max(0, newRate) })
      .eq("id", businessId);
    if (error) {
      notify({ title: "Failed", message: error.message, tone: "error" });
    } else {
      notify({ title: "Rate updated", message: `Email rate set to R${newRate.toFixed(2)}/email`, tone: "success" });
      setRows((prev) => prev.map((r) =>
        r.business_id === businessId
          ? { ...r, rate_zar: newRate, overage_cost: Math.round(r.overage * newRate * 100) / 100 }
          : r
      ));
    }
    setEditingRate(null);
    setSavingRate(false);
  }

  async function generateInvoice(row: EmailUsageRow) {
    if (row.overage_cost <= 0) {
      notify({ title: "No overage", message: "This business has no overage charges for this period.", tone: "warning" });
      return;
    }
    setGeneratingInvoice(row.business_id);

    try {
      // Create invoice in invoices table
      const periodLabel = new Date(row.period + "-01").toLocaleDateString("en-ZA", { month: "long", year: "numeric" });

      // Get next invoice number
      const invNumRes = await supabase.rpc("next_invoice_number", { p_business_id: row.business_id });
      if (invNumRes.error) console.warn("next_invoice_number RPC failed, using fallback");
      const invNum = invNumRes.data || `MKT-${row.period}-${row.business_id.substring(0, 4).toUpperCase()}`;

      const { data: inv, error: invErr } = await supabase.from("invoices").insert({
        business_id: row.business_id,
        invoice_number: invNum,
        customer_name: row.business_name,
        customer_email: "",
        tour_name: "Marketing Email Overage",
        qty: row.overage,
        unit_price: row.rate_zar,
        subtotal: row.overage_cost,
        total_amount: row.overage_cost,
        payment_method: "Pending",
        discount_type: null,
        discount_percent: 0,
        discount_amount: 0,
        discount_notes: `${row.emails_sent} emails sent in ${periodLabel}. ${row.included} included, ${row.overage} overage at R${row.rate_zar.toFixed(2)}/email.`,
      }).select("id, invoice_number").single();

      if (invErr) throw invErr;

      notify({
        title: "Invoice created",
        message: `Invoice ${inv.invoice_number} for R${row.overage_cost.toFixed(2)} — ${row.overage} overage emails in ${periodLabel}`,
        tone: "success",
      });
    } catch (err: any) {
      notify({ title: "Invoice failed", message: err.message || "Unknown error", tone: "error" });
    }
    setGeneratingInvoice(null);
  }

  const totalSent = rows.reduce((s, r) => s + r.emails_sent, 0);
  const totalOverageCost = rows.reduce((s, r) => s + r.overage_cost, 0);
  const periodLabel = new Date(period + "-01").toLocaleDateString("en-ZA", { month: "long", year: "numeric" });

  return (
    <div className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--ck-text-strong)]">Email Usage & Billing</h2>
          <p className="text-xs text-[var(--ck-text-muted)] mt-1">Track emails sent per business, set per-email pricing, and generate overage invoices.</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="ui-control rounded-lg px-3 py-1.5 text-sm outline-none"
          />
          <button onClick={loadUsage} disabled={loading} className="text-xs font-medium text-[var(--ck-accent)] hover:underline">
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="rounded-xl border border-[var(--ck-border-subtle)] p-3 text-center">
          <div className="text-2xl font-bold text-[var(--ck-text-strong)]">{totalSent.toLocaleString()}</div>
          <div className="text-xs text-[var(--ck-text-muted)]">Emails sent in {periodLabel}</div>
        </div>
        <div className="rounded-xl border border-[var(--ck-border-subtle)] p-3 text-center">
          <div className="text-2xl font-bold text-[var(--ck-text-strong)]">{rows.filter((r) => r.overage > 0).length}</div>
          <div className="text-xs text-[var(--ck-text-muted)]">Businesses over limit</div>
        </div>
        <div className="rounded-xl border border-[var(--ck-border-subtle)] p-3 text-center">
          <div className={"text-2xl font-bold " + (totalOverageCost > 0 ? "text-amber-600" : "text-[var(--ck-text-strong)]")}>R{totalOverageCost.toFixed(2)}</div>
          <div className="text-xs text-[var(--ck-text-muted)]">Total overage charges</div>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="divide-y divide-[var(--ck-border-subtle)] rounded-xl border border-[var(--ck-border-subtle)] overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-[var(--ck-bg-subtle)] text-xs font-medium text-[var(--ck-text-muted)]">
            <div className="col-span-3">Business</div>
            <div className="col-span-2 text-center">Emails Sent</div>
            <div className="col-span-1 text-center">Included</div>
            <div className="col-span-1 text-center">Overage</div>
            <div className="col-span-2 text-center">Rate (R/email)</div>
            <div className="col-span-1 text-center">Owed</div>
            <div className="col-span-2 text-center">Invoice</div>
          </div>

          {rows.map((r) => (
            <div key={r.business_id} className="grid grid-cols-12 gap-2 px-4 py-3 items-center text-sm">
              {/* Business name */}
              <div className="col-span-3">
                <div className="font-medium text-[var(--ck-text-strong)] truncate">{r.business_name}</div>
              </div>

              {/* Emails sent */}
              <div className="col-span-2 text-center">
                <span className="font-semibold text-[var(--ck-text-strong)]">{r.emails_sent.toLocaleString()}</span>
              </div>

              {/* Included */}
              <div className="col-span-1 text-center text-[var(--ck-text-muted)]">{r.included}</div>

              {/* Overage */}
              <div className="col-span-1 text-center">
                {r.overage > 0 ? (
                  <span className="text-amber-600 font-semibold">{r.overage}</span>
                ) : (
                  <span className="text-emerald-600">0</span>
                )}
              </div>

              {/* Rate */}
              <div className="col-span-2 flex items-center justify-center gap-1">
                {editingRate?.id === r.business_id ? (
                  <div className="flex items-center gap-1">
                    <span className="text-xs">R</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editingRate.value}
                      onChange={(e) => setEditingRate({ id: r.business_id, value: e.target.value })}
                      className="w-16 rounded border border-[var(--ck-border-subtle)] px-1.5 py-0.5 text-xs text-center outline-none"
                      autoFocus
                    />
                    <button
                      onClick={() => saveRate(r.business_id, Number(editingRate.value))}
                      disabled={savingRate}
                      className="text-xs text-emerald-600 font-semibold hover:underline"
                    >Save</button>
                    <button onClick={() => setEditingRate(null)} className="text-xs text-[var(--ck-text-muted)] hover:underline">Cancel</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setEditingRate({ id: r.business_id, value: r.rate_zar.toFixed(2) })}
                    className="text-xs font-medium hover:underline"
                    title="Click to edit rate"
                  >
                    R{r.rate_zar.toFixed(2)}
                  </button>
                )}
              </div>

              {/* Owed */}
              <div className="col-span-1 text-center">
                {r.overage_cost > 0 ? (
                  <span className="font-bold text-amber-600">R{r.overage_cost.toFixed(2)}</span>
                ) : (
                  <span className="text-emerald-600 text-xs">R0</span>
                )}
              </div>

              {/* Invoice button */}
              <div className="col-span-2 text-center">
                <button
                  onClick={() => generateInvoice(r)}
                  disabled={r.overage_cost <= 0 || generatingInvoice === r.business_id}
                  className="rounded-lg bg-[var(--ck-text-strong)] px-3 py-1 text-xs font-medium text-[var(--ck-btn-primary-text)] hover:opacity-90 disabled:opacity-30 transition-opacity"
                >
                  {generatingInvoice === r.business_id ? "..." : r.overage_cost > 0 ? "Generate Invoice" : "No charge"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
