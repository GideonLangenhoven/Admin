"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/app/lib/supabase";
import { useBusinessContext } from "@/components/BusinessContext";
import { Globe, Plus, Trash, ArrowsClockwise, Check, Warning, ToggleLeft, ToggleRight } from "@phosphor-icons/react";

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

var CHANNELS: ChannelConfig[] = [
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
  var { businessId } = useBusinessContext();
  var [activeTab, setActiveTab] = useState("VIATOR");
  var [statuses, setStatuses] = useState<Record<string, Status>>({});
  var [mappings, setMappings] = useState<Mapping[]>([]);
  var [tours, setTours] = useState<Tour[]>([]);
  var [apiKey, setApiKey] = useState("");
  var [apiSecret, setApiSecret] = useState("");
  var [webhookSecret, setWebhookSecret] = useState("");
  var [testMode, setTestMode] = useState(true);
  var [saving, setSaving] = useState(false);
  var [msg, setMsg] = useState("");
  var [addForm, setAddForm] = useState({ tour_id: "", external_product_code: "", external_option_code: "", default_markup_pct: "0", notes: "" });
  var [addSaving, setAddSaving] = useState(false);

  useEffect(() => {
    if (businessId) refreshAll();
  }, [businessId]);

  useEffect(() => {
    if (businessId) refreshChannel(activeTab);
  }, [activeTab]);

  async function refreshAll() {
    var [toursRes] = await Promise.all([
      supabase.from("tours").select("id, name").eq("business_id", businessId).order("name"),
    ]);
    setTours((toursRes.data as Tour[]) || []);
    for (var ch of CHANNELS) {
      await refreshChannel(ch.key);
    }
  }

  async function refreshChannel(channel: string) {
    var [statusRes, mappingsRes] = await Promise.all([
      fetch("/api/ota?business_id=" + businessId + "&channel=" + channel).then(r => r.json()),
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

  var ch = CHANNELS.find(c => c.key === activeTab)!;
  var status = statuses[activeTab] || null;

  async function saveCredentials() {
    setSaving(true);
    setMsg("");
    var res = await fetch("/api/ota", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_id: businessId, action: "save_credentials", channel: activeTab,
        api_key: apiKey, api_secret: apiSecret || null, webhook_secret: webhookSecret, test_mode: testMode,
      }),
    });
    var data = await res.json();
    if (data.ok) { setMsg("Credentials saved"); setApiKey(""); setApiSecret(""); setWebhookSecret(""); refreshChannel(activeTab); }
    else setMsg(data.error || "Save failed");
    setSaving(false);
  }

  async function toggleEnabled() {
    var newVal = !status?.enabled;
    await fetch("/api/ota", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: businessId, action: "toggle_enabled", channel: activeTab, enabled: newVal }),
    });
    refreshChannel(activeTab);
  }

  async function toggleTestMode() {
    var newVal = !status?.test_mode;
    await fetch("/api/ota", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

  var tourMap: Record<string, string> = {};
  tours.forEach(t => { tourMap[t.id] = t.name; });

  var webhookUrl = typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_SUPABASE_URL || "") + "/functions/v1/" + ch.webhookFunction + "?b=" + businessId
    : "";

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Globe size={28} weight="duotone" className="text-[color:var(--accent)]" />
        <h1 className="text-2xl font-bold text-[color:var(--text)]">OTA Integrations</h1>
      </div>

      {/* Channel Tabs */}
      <div className="flex gap-1 mb-6 border-b border-[color:var(--border)]">
        {CHANNELS.map(c => {
          var s = statuses[c.key];
          return (
            <button key={c.key} onClick={() => setActiveTab(c.key)}
              className={"px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px " +
                (activeTab === c.key
                  ? "border-[color:var(--accent)] text-[color:var(--accent)]"
                  : "border-transparent text-[color:var(--textMuted)] hover:text-[color:var(--text)]")}>
              {c.label}
              {s?.enabled && <span className="ml-2 inline-block w-2 h-2 rounded-full bg-emerald-500" />}
            </button>
          );
        })}
      </div>

      {/* Credentials */}
      <section className="bg-[color:var(--surface)] rounded-xl border border-[color:var(--border)] p-5 mb-6">
        <h2 className="font-semibold text-[color:var(--text)] mb-4">{ch.label} Credentials</h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-[color:var(--textMuted)] mb-1 block">{ch.primaryCredLabel}</label>
            <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={status?.configured ? "••••••• (saved)" : "Paste your " + ch.primaryCredLabel}
              className="w-full px-3 py-2 text-sm border border-[color:var(--border)] rounded-lg bg-[color:var(--surface2)] text-[color:var(--text)]" />
          </div>
          {ch.secondaryCredLabel && (
            <div>
              <label className="text-xs font-medium text-[color:var(--textMuted)] mb-1 block">{ch.secondaryCredLabel}</label>
              <input type="password" value={apiSecret} onChange={e => setApiSecret(e.target.value)} placeholder={status?.secret_configured ? "••••••• (saved)" : "Paste your " + ch.secondaryCredLabel}
                className="w-full px-3 py-2 text-sm border border-[color:var(--border)] rounded-lg bg-[color:var(--surface2)] text-[color:var(--text)]" />
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-[color:var(--textMuted)] mb-1 block">{ch.webhookSecretLabel}</label>
            <input type="password" value={webhookSecret} onChange={e => setWebhookSecret(e.target.value)} placeholder={status?.webhook_configured ? "••••••• (saved)" : "Paste webhook secret"}
              className="w-full px-3 py-2 text-sm border border-[color:var(--border)] rounded-lg bg-[color:var(--surface2)] text-[color:var(--text)]" />
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-[color:var(--text)] cursor-pointer" onClick={toggleTestMode}>
              {testMode ? <ToggleRight size={24} weight="fill" className="text-amber-500" /> : <ToggleLeft size={24} className="text-[color:var(--textMuted)]" />}
              {testMode ? "Sandbox mode" : "Production mode"}
            </label>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={saveCredentials} disabled={saving || !apiKey.trim()}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-[color:var(--accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity">
              {saving ? "Saving..." : "Save Credentials"}
            </button>
            {status?.configured && (
              <button onClick={toggleEnabled}
                className={"px-4 py-2 text-sm font-semibold rounded-lg border transition-colors " + (status.enabled ? "border-red-300 text-red-600 hover:bg-red-50" : "border-emerald-300 text-emerald-600 hover:bg-emerald-50")}>
                {status.enabled ? "Disable Integration" : "Enable Integration"}
              </button>
            )}
          </div>
          {msg && <p className={"text-sm mt-1 " + (msg.includes("saved") ? "text-emerald-600" : "text-red-500")}>{msg}</p>}
        </div>
      </section>

      {/* Webhook URL */}
      {status?.configured && (
        <section className="bg-[color:var(--surface)] rounded-xl border border-[color:var(--border)] p-5 mb-6">
          <h2 className="font-semibold text-[color:var(--text)] mb-2">Webhook URL</h2>
          <p className="text-xs text-[color:var(--textMuted)] mb-2">Paste this into your {ch.label} partner portal webhook settings:</p>
          <code className="block text-xs bg-[color:var(--surface2)] rounded-lg p-3 break-all text-[color:var(--text)] select-all">{webhookUrl}</code>
        </section>
      )}

      {/* Sync Status */}
      {status?.configured && (
        <section className="bg-[color:var(--surface)] rounded-xl border border-[color:var(--border)] p-5 mb-6">
          <h2 className="font-semibold text-[color:var(--text)] mb-3">Availability Sync</h2>
          <div className="flex items-center gap-3 text-sm">
            {status.last_sync_status === "ok" ? (
              <span className="flex items-center gap-1.5 text-emerald-600"><Check size={16} weight="bold" /> Last sync succeeded</span>
            ) : status.last_sync_status === "error" ? (
              <span className="flex items-center gap-1.5 text-red-500"><Warning size={16} weight="bold" /> Last sync failed</span>
            ) : (
              <span className="text-[color:var(--textMuted)]">No sync yet</span>
            )}
            {status.last_sync_at && <span className="text-xs text-[color:var(--textMuted)]">{new Date(status.last_sync_at).toLocaleString()}</span>}
          </div>
          {status.last_sync_error && <p className="text-xs text-red-500 mt-1">{status.last_sync_error}</p>}
          <p className="text-xs text-[color:var(--textMuted)] mt-2">{ch.syncNote}</p>
        </section>
      )}

      {/* Product Mappings */}
      <section className="bg-[color:var(--surface)] rounded-xl border border-[color:var(--border)] p-5 mb-6">
        <h2 className="font-semibold text-[color:var(--text)] mb-4">Tour ↔ {ch.label} Product Mappings</h2>

        {mappings.length > 0 && (
          <div className="space-y-2 mb-4">
            {mappings.map(m => (
              <div key={m.id} className={"flex items-center gap-3 p-3 rounded-lg border transition-colors " + (m.enabled ? "border-[color:var(--border)] bg-[color:var(--surface2)]" : "border-dashed border-[color:var(--border)] opacity-60")}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[color:var(--text)] truncate">{tourMap[m.tour_id] || m.tour_id}</p>
                  <p className="text-xs text-[color:var(--textMuted)]">
                    {m.external_product_code}{m.external_option_code ? " / " + m.external_option_code : ""}
                    {m.default_markup_pct > 0 ? " · +" + m.default_markup_pct + "% markup" : ""}
                  </p>
                  {m.notes && <p className="text-xs text-[color:var(--textMuted)] italic mt-0.5">{m.notes}</p>}
                </div>
                <button onClick={() => toggleMapping(m.id, !m.enabled)} className="text-xs px-2 py-1 rounded border border-[color:var(--border)] text-[color:var(--textMuted)] hover:text-[color:var(--text)]">
                  {m.enabled ? "Disable" : "Enable"}
                </button>
                <button onClick={() => deleteMapping(m.id)} className="text-red-400 hover:text-red-600"><Trash size={16} /></button>
              </div>
            ))}
          </div>
        )}

        <div className="border border-dashed border-[color:var(--border)] rounded-lg p-4">
          <p className="text-xs font-semibold text-[color:var(--textMuted)] mb-3 flex items-center gap-1.5"><Plus size={14} /> Add Mapping</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[color:var(--textMuted)] mb-1 block">Tour</label>
              <select value={addForm.tour_id} onChange={e => setAddForm({ ...addForm, tour_id: e.target.value })}
                className="w-full px-2 py-1.5 text-sm border border-[color:var(--border)] rounded-lg bg-[color:var(--surface2)] text-[color:var(--text)]">
                <option value="">Select tour...</option>
                {tours.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[color:var(--textMuted)] mb-1 block">{ch.label} Product Code</label>
              <input value={addForm.external_product_code} onChange={e => setAddForm({ ...addForm, external_product_code: e.target.value })} placeholder={activeTab === "VIATOR" ? "e.g. 12345P3" : "e.g. 98765"}
                className="w-full px-2 py-1.5 text-sm border border-[color:var(--border)] rounded-lg bg-[color:var(--surface2)] text-[color:var(--text)]" />
            </div>
            <div>
              <label className="text-xs text-[color:var(--textMuted)] mb-1 block">Option Code (optional)</label>
              <input value={addForm.external_option_code} onChange={e => setAddForm({ ...addForm, external_option_code: e.target.value })} placeholder={activeTab === "VIATOR" ? "e.g. TG1" : "e.g. 12345"}
                className="w-full px-2 py-1.5 text-sm border border-[color:var(--border)] rounded-lg bg-[color:var(--surface2)] text-[color:var(--text)]" />
            </div>
            <div>
              <label className="text-xs text-[color:var(--textMuted)] mb-1 block">Markup %</label>
              <input type="number" value={addForm.default_markup_pct} onChange={e => setAddForm({ ...addForm, default_markup_pct: e.target.value })} min="0" max="100" step="0.5"
                className="w-full px-2 py-1.5 text-sm border border-[color:var(--border)] rounded-lg bg-[color:var(--surface2)] text-[color:var(--text)]" />
            </div>
          </div>
          <div className="mt-3">
            <label className="text-xs text-[color:var(--textMuted)] mb-1 block">Notes (optional)</label>
            <input value={addForm.notes} onChange={e => setAddForm({ ...addForm, notes: e.target.value })} placeholder="e.g. Half-day tour, morning departure"
              className="w-full px-2 py-1.5 text-sm border border-[color:var(--border)] rounded-lg bg-[color:var(--surface2)] text-[color:var(--text)]" />
          </div>
          <button onClick={addMapping} disabled={addSaving || !addForm.tour_id || !addForm.external_product_code.trim()}
            className="mt-3 px-4 py-2 text-sm font-semibold rounded-lg bg-[color:var(--accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity">
            {addSaving ? "Adding..." : "Add Mapping"}
          </button>
        </div>
      </section>

      {/* Status badges */}
      {status && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className={"px-2 py-1 rounded-full border " + (status.configured ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-gray-200 bg-gray-50 text-gray-500")}>
            {ch.primaryCredLabel.split(" ")[0]}: {status.configured ? "configured" : "not set"}
          </span>
          {ch.secondaryCredLabel && (
            <span className={"px-2 py-1 rounded-full border " + (status.secret_configured ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-gray-200 bg-gray-50 text-gray-500")}>
              {ch.secondaryCredLabel.split(" ")[0]}: {status.secret_configured ? "configured" : "not set"}
            </span>
          )}
          <span className={"px-2 py-1 rounded-full border " + (status.webhook_configured ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-gray-200 bg-gray-50 text-gray-500")}>
            Webhook: {status.webhook_configured ? "configured" : "not set"}
          </span>
          <span className={"px-2 py-1 rounded-full border " + (status.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700")}>
            {status.enabled ? "Enabled" : "Disabled"}
          </span>
          <span className={"px-2 py-1 rounded-full border " + (status.test_mode ? "border-amber-200 bg-amber-50 text-amber-700" : "border-blue-200 bg-blue-50 text-blue-700")}>
            {status.test_mode ? "Sandbox" : "Production"}
          </span>
        </div>
      )}
    </div>
  );
}
