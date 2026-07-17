"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/app/lib/supabase";
import { useBusinessContext } from "@/components/BusinessContext";
import { Trash, ToggleLeft, ToggleRight } from "@phosphor-icons/react";

type Mapping = {
  id: string;
  tour_id: string;
  external_product_code: string;
  external_option_code: string | null;
  default_markup_pct: number;
  enabled: boolean;
  notes: string | null;
};

type Tour = { id: string; name: string };

type Status = {
  channel: string;
  configured: boolean;
  secret_configured: boolean;
  webhook_configured: boolean;
  enabled: boolean;
  test_mode: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
};

type ChannelConfig = {
  key: string;
  label: string;
  webhookFunction: string;
  primaryCredLabel: string;
  secondaryCredLabel: string | null;
  webhookSecretLabel: string;
  syncNote: string;
};

const CHANNELS: ChannelConfig[] = [
  {
    key: "VIATOR", label: "Viator", webhookFunction: "viator-webhook",
    primaryCredLabel: "API Key (exp-api-key)", secondaryCredLabel: null,
    webhookSecretLabel: "Webhook Secret (for signature verification)",
    syncNote: "Availability syncs to Viator every hour at :07. Next 90 days of OPEN slots are pushed.",
  },
  {
    key: "GETYOURGUIDE", label: "GetYourGuide", webhookFunction: "getyourguide-webhook",
    primaryCredLabel: "Client ID", secondaryCredLabel: "Client Secret",
    webhookSecretLabel: "Webhook Secret (for signature verification)",
    syncNote: "Availability syncs to GetYourGuide every hour at :12. Next 90 days of OPEN slots are pushed.",
  },
];

export default function OtaSettingsPage() {
  const { businessId } = useBusinessContext();
  const [activeTab, setActiveTab] = useState("VIATOR");
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [tours, setTours] = useState<Tour[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [testMode, setTestMode] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [addForm, setAddForm] = useState({ tour_id: "", external_product_code: "", external_option_code: "", default_markup_pct: "0", notes: "" });
  const [addSaving, setAddSaving] = useState(false);

  useEffect(() => {
    if (businessId) refreshAll();
  }, [businessId]);

  useEffect(() => {
    if (businessId) refreshChannel(activeTab);
  }, [activeTab]);

  // AG1 fix: /api/ota's getCallerAdmin() decodes the Bearer access_token to
  // resolve the admin_users row. Without this header every call landed in
  // the "MAIN_ADMIN or SUPER_ADMIN required" 403 branch even for a valid
  // SUPER_ADMIN session. Same pattern as /api/billing/*.
  async function authHeaders(): Promise<HeadersInit> {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    return { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) };
  }

  async function refreshAll() {
    const [toursRes] = await Promise.all([
      supabase.from("tours").select("id, name").eq("business_id", businessId).order("name"),
    ]);
    setTours((toursRes.data as Tour[]) || []);
    for (const ch of CHANNELS) {
      await refreshChannel(ch.key);
    }
  }

  async function refreshChannel(channel: string) {
    const headers = await authHeaders();
    const [statusRes, mappingsRes] = await Promise.all([
      fetch("/api/ota?business_id=" + businessId + "&channel=" + channel, { headers }).then(r => r.json()),
      supabase.from("ota_product_mappings").select("*").eq("business_id", businessId).eq("channel", channel).order("created_at"),
    ]);
    setStatuses(prev => ({ ...prev, [channel]: statusRes }));
    if (channel === activeTab) {
      setMappings((mappingsRes.data as Mapping[]) || []);
      if (statusRes.test_mode !== undefined) setTestMode(statusRes.test_mode);
    }
    setMsg("");
    setApiKey("");
    setApiSecret("");
    setWebhookSecret("");
  }

  const ch = CHANNELS.find(c => c.key === activeTab)!;
  const status = statuses[activeTab] || null;

  async function saveCredentials() {
    setSaving(true);
    setMsg("");
    const res = await fetch("/api/ota", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({
        business_id: businessId, action: "save_credentials", channel: activeTab,
        api_key: apiKey, api_secret: apiSecret || null, webhook_secret: webhookSecret, test_mode: testMode,
      }),
    });
    const data = await res.json();
    if (data.ok) { setMsg("Credentials saved"); setApiKey(""); setApiSecret(""); setWebhookSecret(""); refreshChannel(activeTab); }
    else setMsg(data.error || "Save failed");
    setSaving(false);
  }

  async function toggleEnabled() {
    const newVal = !status?.enabled;
    await fetch("/api/ota", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ business_id: businessId, action: "toggle_enabled", channel: activeTab, enabled: newVal }),
    });
    refreshChannel(activeTab);
  }

  async function toggleTestMode() {
    const newVal = !status?.test_mode;
    await fetch("/api/ota", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ business_id: businessId, action: "toggle_test_mode", channel: activeTab, test_mode: newVal }),
    });
    setTestMode(newVal);
    refreshChannel(activeTab);
  }

  async function addMapping() {
    if (!addForm.tour_id || !addForm.external_product_code.trim()) return;
    setAddSaving(true);
    await supabase.from("ota_product_mappings").insert({
      business_id: businessId,
      channel: activeTab,
      tour_id: addForm.tour_id,
      external_product_code: addForm.external_product_code.trim(),
      external_option_code: addForm.external_option_code.trim() || null,
      default_markup_pct: Number(addForm.default_markup_pct) || 0,
      notes: addForm.notes.trim() || null,
    });
    setAddForm({ tour_id: "", external_product_code: "", external_option_code: "", default_markup_pct: "0", notes: "" });
    setAddSaving(false);
    refreshChannel(activeTab);
  }

  async function toggleMapping(id: string, enabled: boolean) {
    await supabase.from("ota_product_mappings").update({ enabled, updated_at: new Date().toISOString() }).eq("id", id);
    refreshChannel(activeTab);
  }

  async function deleteMapping(id: string) {
    if (!confirm("Remove this mapping?")) return;
    await supabase.from("ota_product_mappings").delete().eq("id", id);
    refreshChannel(activeTab);
  }

  const tourMap: Record<string, string> = {};
  tours.forEach(t => { tourMap[t.id] = t.name; });

  const webhookUrl = typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_SUPABASE_URL || "") + "/functions/v1/" + ch.webhookFunction + "?b=" + businessId
    : "";

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="anim-fade-up flex items-center gap-3">
        <div>
          <p className="ui-mono-label mb-1">Admin · Settings</p>
          <h1 className="font-display text-[26px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}>OTA Integrations</h1>
        </div>
      </div>

      {/* Channel Tabs */}
      <div className="anim-fade-up anim-d1 ui-seg">
        {CHANNELS.map(c => {
          const s = statuses[c.key];
          return (
            <button key={c.key} type="button" onClick={() => setActiveTab(c.key)} className="ui-seg-item" data-active={activeTab === c.key}>
              {c.label}
              {s?.enabled && <span className="h-[5px] w-[5px] rounded-full" style={{ background: "var(--ck-success)" }} aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      <div className="anim-fade-up anim-d2 space-y-6">
        {/* Credentials */}
        <section className="ui-card p-5">
          <h2 className="text-[15px] font-semibold mb-4" style={{ color: "var(--ck-text-strong)" }}>{ch.label} Credentials</h2>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: "var(--ck-text-muted)" }}>{ch.primaryCredLabel}</label>
              <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={status?.configured ? "••••••• (saved)" : "Paste your " + ch.primaryCredLabel}
                className="ui-control w-full" />
            </div>
            {ch.secondaryCredLabel && (
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: "var(--ck-text-muted)" }}>{ch.secondaryCredLabel}</label>
                <input type="password" value={apiSecret} onChange={e => setApiSecret(e.target.value)} placeholder={status?.secret_configured ? "••••••• (saved)" : "Paste your " + ch.secondaryCredLabel}
                  className="ui-control w-full" />
              </div>
            )}
            <div>
              <label className="text-xs font-medium mb-1 block" style={{ color: "var(--ck-text-muted)" }}>{ch.webhookSecretLabel}</label>
              <input type="password" value={webhookSecret} onChange={e => setWebhookSecret(e.target.value)} placeholder={status?.webhook_configured ? "••••••• (saved)" : "Paste webhook secret"}
                className="ui-control w-full" />
            </div>
            <div className="flex items-center gap-4">
              <button type="button" onClick={toggleTestMode} className="flex items-center gap-2 text-sm" style={{ color: "var(--ck-text)" }}>
                {testMode ? <ToggleRight size={24} weight="fill" style={{ color: "var(--ck-amber)" }} /> : <ToggleLeft size={24} style={{ color: "var(--ck-text-muted)" }} />}
                {testMode ? "Sandbox mode" : "Production mode"}
              </button>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button onClick={saveCredentials} disabled={saving || !apiKey.trim()} className="ui-btn ui-btn-primary disabled:opacity-50">
                {saving ? "Saving..." : "Save Credentials"}
              </button>
              {status?.configured && (
                <button onClick={toggleEnabled} className={`ui-btn ${status.enabled ? "ui-btn-danger" : "ui-btn-soft"}`}>
                  {status.enabled ? "Disable Integration" : "Enable Integration"}
                </button>
              )}
            </div>
            {msg && <p className="text-sm mt-1" style={{ color: msg.includes("saved") ? "var(--ck-success)" : "var(--ck-danger)" }}>{msg}</p>}
          </div>
        </section>

        {/* Webhook URL */}
        {status?.configured && (
          <section className="ui-card p-5">
            <h2 className="text-[15px] font-semibold mb-2" style={{ color: "var(--ck-text-strong)" }}>Webhook URL</h2>
            <p className="text-xs mb-2" style={{ color: "var(--ck-text-muted)" }}>Paste this into your {ch.label} partner portal webhook settings:</p>
            <code className="block text-xs rounded-lg p-3 break-all select-all" style={{ background: "var(--ck-surface-sunken)", color: "var(--ck-text-strong)" }}>{webhookUrl}</code>
          </section>
        )}

        {/* Sync Status */}
        {status?.configured && (
          <section className="ui-card p-5">
            <h2 className="text-[15px] font-semibold mb-3" style={{ color: "var(--ck-text-strong)" }}>Availability Sync</h2>
            <div className="flex items-center gap-3 text-sm">
              {status.last_sync_status === "ok" ? (
                <span className="flex items-center gap-1.5" style={{ color: "var(--ck-success)" }}>Last sync succeeded</span>
              ) : status.last_sync_status === "error" ? (
                <span className="flex items-center gap-1.5" style={{ color: "var(--ck-danger)" }}>Last sync failed</span>
              ) : (
                <span style={{ color: "var(--ck-text-muted)" }}>No sync yet</span>
              )}
              {status.last_sync_at && <span className="text-xs font-mono" style={{ color: "var(--ck-text-muted)" }}>{new Date(status.last_sync_at).toLocaleString()}</span>}
            </div>
            {status.last_sync_error && <p className="text-xs mt-1" style={{ color: "var(--ck-danger)" }}>{status.last_sync_error}</p>}
            <p className="text-xs mt-2" style={{ color: "var(--ck-text-muted)" }}>{ch.syncNote}</p>
          </section>
        )}

        {/* Product Mappings */}
        <section className="ui-card p-5">
          <h2 className="text-[15px] font-semibold mb-4" style={{ color: "var(--ck-text-strong)" }}>Tour ↔ {ch.label} Product Mappings</h2>

          {mappings.length > 0 && (
            <div className="space-y-2 mb-4">
              {mappings.map(m => (
                <div key={m.id} className="flex items-center gap-3 p-3 rounded-lg border transition-colors" style={{ borderColor: "var(--ck-border-subtle)", background: m.enabled ? "var(--ck-surface-sunken)" : "transparent", borderStyle: m.enabled ? "solid" : "dashed", opacity: m.enabled ? 1 : 0.6 }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--ck-text-strong)" }}>{tourMap[m.tour_id] || m.tour_id}</p>
                    <p className="text-xs" style={{ color: "var(--ck-text-muted)" }}>
                      {m.external_product_code}{m.external_option_code ? " / " + m.external_option_code : ""}
                      {m.default_markup_pct > 0 ? " · +" + m.default_markup_pct + "% markup" : ""}
                    </p>
                    {m.notes && <p className="text-xs italic mt-0.5" style={{ color: "var(--ck-text-muted)" }}>{m.notes}</p>}
                  </div>
                  <button onClick={() => toggleMapping(m.id, !m.enabled)} className="ui-btn ui-btn-ghost !h-7 !px-2.5 !text-[11px]">
                    {m.enabled ? "Disable" : "Enable"}
                  </button>
                  <button onClick={() => deleteMapping(m.id)} className="transition-colors" style={{ color: "var(--ck-text-muted)" }} onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ck-danger)")} onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ck-text-muted)")}>
                    <Trash size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-lg p-4 border" style={{ borderColor: "var(--ck-border-subtle)", borderStyle: "dashed", background: "var(--ck-surface-sunken)" }}>
            <p className="text-xs font-semibold mb-3 flex items-center gap-1.5" style={{ color: "var(--ck-text-muted)" }}>Add Mapping</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--ck-text-muted)" }}>Tour</label>
                <select value={addForm.tour_id} onChange={e => setAddForm({ ...addForm, tour_id: e.target.value })} className="ui-control w-full">
                  <option value="">Select tour...</option>
                  {tours.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--ck-text-muted)" }}>{ch.label} Product Code</label>
                <input value={addForm.external_product_code} onChange={e => setAddForm({ ...addForm, external_product_code: e.target.value })} placeholder={activeTab === "VIATOR" ? "e.g. 12345P3" : "e.g. 98765"}
                  className="ui-control w-full" />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--ck-text-muted)" }}>Option Code (optional)</label>
                <input value={addForm.external_option_code} onChange={e => setAddForm({ ...addForm, external_option_code: e.target.value })} placeholder={activeTab === "VIATOR" ? "e.g. TG1" : "e.g. 12345"}
                  className="ui-control w-full" />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--ck-text-muted)" }}>Markup %</label>
                <input type="number" value={addForm.default_markup_pct} onChange={e => setAddForm({ ...addForm, default_markup_pct: e.target.value })} min="0" max="100" step="0.5"
                  className="ui-control w-full" />
              </div>
            </div>
            <div className="mt-3">
              <label className="text-xs mb-1 block" style={{ color: "var(--ck-text-muted)" }}>Notes (optional)</label>
              <input value={addForm.notes} onChange={e => setAddForm({ ...addForm, notes: e.target.value })} placeholder="e.g. Half-day tour, morning departure"
                className="ui-control w-full" />
            </div>
            <button onClick={addMapping} disabled={addSaving || !addForm.tour_id || !addForm.external_product_code.trim()} className="ui-btn ui-btn-primary mt-3 disabled:opacity-50">
              {addSaving ? "Adding..." : "Add Mapping"}
            </button>
          </div>
        </section>

        {/* Status badges */}
        {status && (
          <div className="flex flex-wrap gap-2">
            {/* AG8 fix: previously .split(" ")[0] which produced "Client: not set"
                for both pills on the GYG tab (since both labels start with "Client").
                Strip just the parenthetical so "API Key (exp-api-key)" trims to
                "API Key" while "Client ID" and "Client Secret" stay distinct. */}
            <span className={`ui-status ${status.configured ? "ui-pill-success" : "ui-pill-neutral"}`}>
              {ch.primaryCredLabel.replace(/\s*\([^)]*\)\s*$/, "")}: {status.configured ? "configured" : "not set"}
            </span>
            {ch.secondaryCredLabel && (
              <span className={`ui-status ${status.secret_configured ? "ui-pill-success" : "ui-pill-neutral"}`}>
                {ch.secondaryCredLabel.replace(/\s*\([^)]*\)\s*$/, "")}: {status.secret_configured ? "configured" : "not set"}
              </span>
            )}
            <span className={`ui-status ${status.webhook_configured ? "ui-pill-success" : "ui-pill-neutral"}`}>
              Webhook: {status.webhook_configured ? "configured" : "not set"}
            </span>
            <span className={`ui-status ${status.enabled ? "ui-pill-success" : "ui-pill-warning"}`}>
              {status.enabled ? "Enabled" : "Disabled"}
            </span>
            <span className={`ui-status ${status.test_mode ? "ui-pill-amber" : "ui-pill-ocean"}`}>
              {status.test_mode ? "Sandbox" : "Production"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
