"use client";

import { useEffect, useState } from "react";
import { notify } from "../lib/app-notify";
import { supabase } from "../lib/supabase";
import { sendAdminSetupLink } from "../lib/admin-auth";
import { useBusinessContext } from "../../components/BusinessContext";

type OnboardForm = {
  businessName: string;
  businessTagline: string;
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

export default function SuperAdminPage() {
  const { role } = useBusinessContext();
  const [requesterEmail, setRequesterEmail] = useState("");
  const [requesterPassword, setRequesterPassword] = useState("");
  const [form, setForm] = useState<OnboardForm>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [createdClient, setCreatedClient] = useState<{ businessId: string; businessName: string; adminEmail: string } | null>(null);

  useEffect(() => {
    setRequesterEmail(localStorage.getItem("ck_admin_email") || "");
  }, []);

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
    </div>
  );
}
