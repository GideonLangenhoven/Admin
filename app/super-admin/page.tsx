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

type BusinessRow = {
  id: string;
  business_name: string;
  subdomain: string | null;
  max_admin_seats: number;
  admin_count?: number;
};

export default function SuperAdminPage() {
  const { role } = useBusinessContext();
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

  async function loadBusinesses() {
    setLoadingBiz(true);
    // Anon role has SELECT on businesses (RLS allows it)
    const { data, error } = await supabase
      .from("businesses")
      .select("id, business_name, subdomain, max_admin_seats, marketing_included_emails, marketing_overage_rate_zar")
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
    var { error } = await supabase.from("businesses").update({
      subdomain: slug,
      booking_site_url: `https://${slug}.${BOOKING_DOMAIN}`,
    }).eq("id", businessId);
    if (error) {
      notify({ title: "Failed", message: error.code === "23505" ? "This subdomain is already taken." : error.message, tone: "error" });
    } else {
      notify({ title: "Subdomain saved", message: `${slug}.${BOOKING_DOMAIN}`, tone: "success" });
      setBusinesses((prev) => prev.map((b) => b.id === businessId ? { ...b, subdomain: slug } : b));
    }
    setEditingSubdomain(null);
    setSavingSubdomain(false);
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
          await sendAdminSetupLink({ id: admin.id, email: admin.email, name: admin.name || form.adminName }, "ADMIN_INVITE");
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
                  {/* Right: Seat controls */}
                  <div className="flex items-center gap-1 shrink-0">
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
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Email Usage & Billing ── */}
      <EmailUsageBilling />
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
