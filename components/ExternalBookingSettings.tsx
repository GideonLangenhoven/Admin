"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../app/lib/supabase";
import { confirmAction, notify } from "../app/lib/app-notify";
import { useBusinessContext } from "./BusinessContext";

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">{label}</div>
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-white/70 px-2.5 py-1.5">
        <span className="flex-1 font-mono text-[11px] break-all text-emerald-900">{value}</span>
        <button
          type="button"
          onClick={handleCopy}
          title="Copy to clipboard"
          className="shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold transition-colors"
          style={{
            background: copied ? "rgb(16,185,129)" : "rgb(209,250,229)",
            color: copied ? "white" : "rgb(4,120,87)",
          }}
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

type TourOption = {
  id: string;
  name: string;
};

type MappingRow = {
  id: string;
  source: string;
  tour_id: string;
  external_product_id: string | null;
  external_product_code: string | null;
  external_product_name: string | null;
  active: boolean;
  created_at: string;
  tours: { name?: string } | { name?: string }[] | null;
};

type CredentialRow = {
  id: string;
  source: string;
  api_key_last4: string | null;
  hmac_secret: string | null;
  hmac_secret_encrypted: string | null;
  active: boolean;
  created_at: string;
};

type GeneratedSecrets = {
  source: string;
  apiKey: string;
  hmacSecret: string | null;
};

const EMPTY_MAPPING_FORM = {
  source: "VIATOR",
  tour_id: "",
  external_product_id: "",
  external_product_code: "",
  external_product_name: "",
  active: true,
};

const EMPTY_CREDENTIAL_FORM = {
  source: "VIATOR",
  active: true,
  hmacEnabled: true,
  rotateApiKey: true,
  rotateHmacSecret: true,
};

function pickTourName(value: MappingRow["tours"]): string {
  if (!value) return "";
  if (Array.isArray(value)) return value[0]?.name || "";
  return value.name || "";
}

function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function ExternalBookingSettings({ tours }: { tours: TourOption[] }) {
  const { businessId } = useBusinessContext();

  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [credentials, setCredentials] = useState<CredentialRow[]>([]);
  const [loadingMappings, setLoadingMappings] = useState(true);
  const [loadingCredentials, setLoadingCredentials] = useState(true);
  const [savingMapping, setSavingMapping] = useState(false);
  const [savingCredential, setSavingCredential] = useState(false);
  const [mappingForm, setMappingForm] = useState(EMPTY_MAPPING_FORM);
  const [credentialForm, setCredentialForm] = useState(EMPTY_CREDENTIAL_FORM);
  const [editingMappingId, setEditingMappingId] = useState<string | null>(null);
  const [editingCredentialId, setEditingCredentialId] = useState<string | null>(null);
  const [mappingMessage, setMappingMessage] = useState<{ type: "success" | "error" | ""; text: string }>({ type: "", text: "" });
  const [credentialMessage, setCredentialMessage] = useState<{ type: "success" | "error" | ""; text: string }>({ type: "", text: "" });
  const [generatedSecrets, setGeneratedSecrets] = useState<GeneratedSecrets | null>(null);

  const orderedTours = useMemo(() => [...tours].sort((a, b) => a.name.localeCompare(b.name)), [tours]);
  const selectedTourId = mappingForm.tour_id || orderedTours[0]?.id || "";

  const loadMappings = useCallback(async () => {
    setLoadingMappings(true);
    const { data, error } = await supabase
      .from("external_product_mappings")
      .select("id, source, tour_id, external_product_id, external_product_code, external_product_name, active, created_at, tours(name)")
      .eq("business_id", businessId)
      .order("source", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) {
      setMappingMessage({ type: "error", text: error.message });
      setMappings([]);
    } else {
      setMappings((data || []) as MappingRow[]);
    }
    setLoadingMappings(false);
  }, [businessId]);

  const loadCredentials = useCallback(async () => {
    setLoadingCredentials(true);
    const { data, error } = await supabase
      .from("external_booking_credentials")
      .select("id, source, api_key_last4, hmac_secret, hmac_secret_encrypted, active, created_at")
      .eq("business_id", businessId)
      .order("source", { ascending: true });

    if (error) {
      setCredentialMessage({ type: "error", text: error.message });
      setCredentials([]);
    } else {
      setCredentials((data || []) as CredentialRow[]);
    }
    setLoadingCredentials(false);
  }, [businessId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadMappings();
      void loadCredentials();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadMappings, loadCredentials]);

  function resetMappingForm() {
    setMappingForm({ ...EMPTY_MAPPING_FORM, tour_id: orderedTours[0]?.id || "" });
    setEditingMappingId(null);
    setMappingMessage({ type: "", text: "" });
  }

  function resetCredentialForm() {
    setCredentialForm(EMPTY_CREDENTIAL_FORM);
    setEditingCredentialId(null);
    setCredentialMessage({ type: "", text: "" });
  }

  async function handleSaveMapping(e: React.FormEvent) {
    e.preventDefault();
    setMappingMessage({ type: "", text: "" });

    if (!mappingForm.source.trim()) {
      setMappingMessage({ type: "error", text: "Source is required." });
      return;
    }
    if (!selectedTourId) {
      setMappingMessage({ type: "error", text: "Tour is required." });
      return;
    }
    if (!mappingForm.external_product_id.trim() && !mappingForm.external_product_code.trim() && !mappingForm.external_product_name.trim()) {
      setMappingMessage({ type: "error", text: "Add at least one external identifier." });
      return;
    }

    setSavingMapping(true);

    const payload = {
      business_id: businessId,
      source: mappingForm.source.trim().toUpperCase(),
      tour_id: selectedTourId,
      external_product_id: mappingForm.external_product_id.trim() || null,
      external_product_code: mappingForm.external_product_code.trim() || null,
      external_product_name: mappingForm.external_product_name.trim() || null,
      active: mappingForm.active,
      updated_at: new Date().toISOString(),
    };

    const query = editingMappingId
      ? supabase.from("external_product_mappings").update(payload).eq("id", editingMappingId)
      : supabase.from("external_product_mappings").insert(payload);

    const { error } = await query;
    if (error) {
      setMappingMessage({ type: "error", text: error.message });
    } else {
      setMappingMessage({ type: "success", text: editingMappingId ? "Mapping updated." : "Mapping created." });
      await loadMappings();
      resetMappingForm();
    }

    setSavingMapping(false);
  }

  async function handleSaveCredential(e: React.FormEvent) {
    e.preventDefault();
    setCredentialMessage({ type: "", text: "" });
    setGeneratedSecrets(null);

    if (!credentialForm.source.trim()) {
      setCredentialMessage({ type: "error", text: "Source is required." });
      return;
    }

    setSavingCredential(true);

    const shouldRotateApiKey = !editingCredentialId || credentialForm.rotateApiKey;
    const shouldRotateHmac = credentialForm.hmacEnabled && (!editingCredentialId || credentialForm.rotateHmacSecret);

    const apiKey = shouldRotateApiKey ? `ckext_${randomHex(20)}` : null;
    const apiKeyHash = apiKey ? await sha256Hex(apiKey) : null;
    const hmacSecret = shouldRotateHmac ? randomHex(32) : null;

    const payload: Record<string, unknown> = {
      business_id: businessId,
      source: credentialForm.source.trim().toUpperCase(),
      active: credentialForm.active,
      updated_at: new Date().toISOString(),
    };

    if (apiKeyHash) {
      payload.api_key_hash = apiKeyHash;
      payload.api_key_last4 = apiKey!.slice(-4);
    }

    let credentialId = editingCredentialId;
    let saveError: string | null = null;

    if (editingCredentialId) {
      const { error } = await supabase.from("external_booking_credentials").update(payload).eq("id", editingCredentialId);
      if (error) saveError = error.message;
    } else {
      const { data: inserted, error } = await supabase
        .from("external_booking_credentials")
        .insert(payload)
        .select("id")
        .single();
      if (error) saveError = error.message;
      else credentialId = inserted?.id || null;
    }

    if (saveError) {
      setCredentialMessage({ type: "error", text: saveError });
      setSavingCredential(false);
      return;
    }

    if (credentialId) {
      const hmacValue = !credentialForm.hmacEnabled ? null : (hmacSecret || undefined);
      if (hmacValue !== undefined) {
        const { error: fnErr } = await supabase.functions.invoke("external-booking", {
          body: { action: "admin_set_hmac", credential_id: credentialId, hmac_secret: hmacValue },
        });
        if (fnErr) console.error("Failed to encrypt HMAC secret:", fnErr);
      }
    }

    setCredentialMessage({ type: "success", text: editingCredentialId ? "Credential updated." : "Credential created." });
    if (apiKey || hmacSecret) {
      setGeneratedSecrets({
        source: credentialForm.source.trim().toUpperCase(),
        apiKey: apiKey || "",
        hmacSecret: credentialForm.hmacEnabled ? (hmacSecret || null) : null,
      });
    }
    await loadCredentials();
    resetCredentialForm();

    setSavingCredential(false);
  }

  function handleEditMapping(row: MappingRow) {
    setEditingMappingId(row.id);
    setMappingForm({
      source: row.source,
      tour_id: row.tour_id,
      external_product_id: row.external_product_id || "",
      external_product_code: row.external_product_code || "",
      external_product_name: row.external_product_name || "",
      active: row.active,
    });
    setMappingMessage({ type: "", text: "" });
  }

  function handleEditCredential(row: CredentialRow) {
    setEditingCredentialId(row.id);
    setCredentialForm({
      source: row.source,
      active: row.active,
      hmacEnabled: Boolean(row.hmac_secret_encrypted || row.hmac_secret),
      rotateApiKey: false,
      rotateHmacSecret: false,
    });
    setGeneratedSecrets(null);
    setCredentialMessage({ type: "", text: "" });
  }

  async function handleDeleteMapping(id: string) {
    if (!await confirmAction({ title: "Delete mapping", message: "Delete this mapping?", tone: "warning", confirmLabel: "Delete" })) return;
    const { error } = await supabase.from("external_product_mappings").delete().eq("id", id);
    if (error) {
      setMappingMessage({ type: "error", text: error.message });
      return;
    }
    await loadMappings();
    if (editingMappingId === id) resetMappingForm();
    notify({ title: "Mapping deleted", message: "The external product mapping was removed.", tone: "success" });
  }

  async function handleDeleteCredential(id: string) {
    if (!await confirmAction({
      title: "Delete credential",
      message: "Delete this credential? This will immediately revoke that business/source API key.",
      tone: "warning",
      confirmLabel: "Revoke credential",
    })) return;
    const { error } = await supabase.from("external_booking_credentials").delete().eq("id", id);
    if (error) {
      setCredentialMessage({ type: "error", text: error.message });
      return;
    }
    await loadCredentials();
    if (editingCredentialId === id) resetCredentialForm();
    notify({ title: "Credential deleted", message: "The external booking credential was revoked.", tone: "success" });
  }

  async function handleToggleMapping(row: MappingRow) {
    const { error } = await supabase
      .from("external_product_mappings")
      .update({ active: !row.active, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      setMappingMessage({ type: "error", text: error.message });
      return;
    }
    await loadMappings();
  }

  async function handleToggleCredential(row: CredentialRow) {
    const { error } = await supabase
      .from("external_booking_credentials")
      .update({ active: !row.active, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    if (error) {
      setCredentialMessage({ type: "error", text: error.message });
      return;
    }
    await loadCredentials();
  }

  return (
    <div className="mt-10 border-t border-[var(--ck-border-subtle)] pt-10 space-y-10">
      <div>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--ck-text-strong)]">External Booking API</h2>
            <p className="text-xs text-[var(--ck-text-muted)] mt-1">
              One shared webhook endpoint serves every business. Incoming `x-api-key` resolves the correct business automatically.
            </p>
          </div>
          <div className="rounded-xl border border-[var(--ck-border-subtle)] bg-[var(--ck-bg-subtle)] px-3 py-2 text-xs text-[var(--ck-text-muted)]">
            Endpoint: <span className="font-medium text-[var(--ck-text-strong)]">/functions/v1/external-booking</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-8">
          <div>
            <div className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] overflow-hidden">
              <div className="border-b border-[var(--ck-border-subtle)] px-4 py-3 text-sm font-semibold text-[var(--ck-text-strong)]">
                Credentials
              </div>
              {loadingCredentials ? (
                <div className="p-4 text-sm text-[var(--ck-text-muted)]">Loading credentials...</div>
              ) : credentials.length === 0 ? (
                <div className="p-4 text-sm text-[var(--ck-text-muted)]">No credentials yet. Create one per source for this business.</div>
              ) : (
                <div className="divide-y divide-[var(--ck-border-subtle)]">
                  {credentials.map((row) => (
                    <div key={row.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-[var(--ck-text-strong)]">{row.source}</span>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${row.active ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                              {row.active ? "Active" : "Inactive"}
                            </span>
                          </div>
                          <div className="mt-2 space-y-1 text-xs text-[var(--ck-text-muted)]">
                            <div>API key: {row.api_key_last4 ? `••••${row.api_key_last4}` : "Not set"}</div>
                            <div>HMAC: {(row.hmac_secret_encrypted || row.hmac_secret) ? "Enabled" : "Disabled"}</div>
                            <div>Created: {new Date(row.created_at).toLocaleDateString()}</div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2 text-xs font-medium">
                          <button onClick={() => handleEditCredential(row)} className="text-[var(--ck-accent)] hover:underline">Edit</button>
                          <button onClick={() => handleToggleCredential(row)} className="text-amber-600 hover:underline">{row.active ? "Disable" : "Enable"}</button>
                          <button onClick={() => handleDeleteCredential(row.id)} className="text-[var(--ck-danger)] hover:underline">Delete</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <form onSubmit={handleSaveCredential} className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">{editingCredentialId ? "Edit Credential" : "Create Credential"}</h3>
                <p className="text-xs text-[var(--ck-text-muted)] mt-1">Each business/source pair gets its own API key. HMAC is optional but recommended.</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Source</label>
                <input
                  type="text"
                  value={credentialForm.source}
                  onChange={(e) => setCredentialForm((prev) => ({ ...prev, source: e.target.value.toUpperCase() }))}
                  className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none"
                  placeholder="VIATOR"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={credentialForm.active} onChange={(e) => setCredentialForm((prev) => ({ ...prev, active: e.target.checked }))} className="w-4 h-4 rounded border-gray-300 text-[var(--ck-accent)] focus:ring-[var(--ck-accent)]" />
                <span className="text-sm text-[var(--ck-text-strong)]">Active</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={credentialForm.hmacEnabled} onChange={(e) => setCredentialForm((prev) => ({ ...prev, hmacEnabled: e.target.checked }))} className="w-4 h-4 rounded border-gray-300 text-[var(--ck-accent)] focus:ring-[var(--ck-accent)]" />
                <span className="text-sm text-[var(--ck-text-strong)]">Require HMAC signatures</span>
              </label>

              {editingCredentialId && (
                <>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={credentialForm.rotateApiKey} onChange={(e) => setCredentialForm((prev) => ({ ...prev, rotateApiKey: e.target.checked }))} className="w-4 h-4 rounded border-gray-300 text-[var(--ck-accent)] focus:ring-[var(--ck-accent)]" />
                    <span className="text-sm text-[var(--ck-text-strong)]">Rotate API key on save</span>
                  </label>
                  {credentialForm.hmacEnabled && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={credentialForm.rotateHmacSecret} onChange={(e) => setCredentialForm((prev) => ({ ...prev, rotateHmacSecret: e.target.checked }))} className="w-4 h-4 rounded border-gray-300 text-[var(--ck-accent)] focus:ring-[var(--ck-accent)]" />
                      <span className="text-sm text-[var(--ck-text-strong)]">Rotate HMAC secret on save</span>
                    </label>
                  )}
                </>
              )}

              {credentialMessage.text && (
                <div className={`text-xs font-medium ${credentialMessage.type === "error" ? "text-[var(--ck-danger)]" : "text-[var(--ck-success)]"}`}>
                  {credentialMessage.text}
                </div>
              )}

              {generatedSecrets && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-emerald-700">*</span>
                    <div>
                      <div className="text-xs font-bold text-emerald-900">Save these credentials now.</div>
                      <div className="text-[10px] text-emerald-700">They are only shown once and cannot be recovered.</div>
                    </div>
                  </div>
                  <CopyField label="Source" value={generatedSecrets.source} />
                  <CopyField label="Webhook URL" value="https://ukdsrndqhsatjkmxijuj.supabase.co/functions/v1/external-booking" />
                  <CopyField label="API Key" value={generatedSecrets.apiKey} />
                  {generatedSecrets.hmacSecret && (
                    <CopyField label="HMAC Secret" value={generatedSecrets.hmacSecret} />
                  )}
                </div>
              )}

              <div className="flex gap-3">
                <button type="submit" disabled={savingCredential} className="flex-1 rounded-xl bg-[var(--ck-text-strong)] py-2.5 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:opacity-90 disabled:opacity-50">
                  {savingCredential ? "Saving..." : editingCredentialId ? "Update Credential" : "Create Credential"}
                </button>
                <button type="button" onClick={resetCredentialForm} className="px-4 rounded-xl border border-[var(--ck-border-subtle)] text-sm font-medium text-[var(--ck-text-muted)] hover:bg-[var(--ck-bg)]">
                  Reset
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--ck-text-strong)]">Product Mappings</h2>
            <p className="text-xs text-[var(--ck-text-muted)] mt-1">Map supplier product IDs or codes to this business&apos;s tours.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-8">
          <div>
            <div className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] overflow-hidden">
              <div className="border-b border-[var(--ck-border-subtle)] px-4 py-3 text-sm font-semibold text-[var(--ck-text-strong)]">Mappings</div>
              {loadingMappings ? (
                <div className="p-4 text-sm text-[var(--ck-text-muted)]">Loading mappings...</div>
              ) : mappings.length === 0 ? (
                <div className="p-4 text-sm text-[var(--ck-text-muted)]">No mappings yet. Add your first supplier product mapping.</div>
              ) : (
                <div className="divide-y divide-[var(--ck-border-subtle)]">
                  {mappings.map((row) => (
                    <div key={row.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-[var(--ck-text-strong)]">{row.source}</span>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${row.active ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                              {row.active ? "Active" : "Inactive"}
                            </span>
                          </div>
                          <div className="mt-1 text-sm text-[var(--ck-text-strong)]">{pickTourName(row.tours) || "Unlinked tour"}</div>
                          <div className="mt-2 space-y-1 text-xs text-[var(--ck-text-muted)]">
                            <div>Product ID: {row.external_product_id || "-"}</div>
                            <div>Product Code: {row.external_product_code || "-"}</div>
                            <div>Product Name: {row.external_product_name || "-"}</div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2 text-xs font-medium">
                          <button onClick={() => handleEditMapping(row)} className="text-[var(--ck-accent)] hover:underline">Edit</button>
                          <button onClick={() => handleToggleMapping(row)} className="text-amber-600 hover:underline">{row.active ? "Disable" : "Enable"}</button>
                          <button onClick={() => handleDeleteMapping(row.id)} className="text-[var(--ck-danger)] hover:underline">Delete</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <form onSubmit={handleSaveMapping} className="ui-surface rounded-2xl border border-[var(--ck-border-subtle)] p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-[var(--ck-text-strong)]">{editingMappingId ? "Edit Mapping" : "Add Mapping"}</h3>
                <p className="text-xs text-[var(--ck-text-muted)] mt-1">You only need one of Product ID, Product Code, or Product Name for matching.</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Source</label>
                <input type="text" value={mappingForm.source} onChange={(e) => setMappingForm((prev) => ({ ...prev, source: e.target.value.toUpperCase() }))} className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="VIATOR" />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">Tour</label>
                <select value={selectedTourId} onChange={(e) => setMappingForm((prev) => ({ ...prev, tour_id: e.target.value }))} className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none">
                  {orderedTours.map((tour) => <option key={tour.id} value={tour.id}>{tour.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">External Product ID</label>
                <input type="text" value={mappingForm.external_product_id} onChange={(e) => setMappingForm((prev) => ({ ...prev, external_product_id: e.target.value }))} className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="12345678" />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">External Product Code</label>
                <input type="text" value={mappingForm.external_product_code} onChange={(e) => setMappingForm((prev) => ({ ...prev, external_product_code: e.target.value }))} className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="SEA-KAYAK-AM" />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--ck-text-muted)] mb-1">External Product Name</label>
                <input type="text" value={mappingForm.external_product_name} onChange={(e) => setMappingForm((prev) => ({ ...prev, external_product_name: e.target.value }))} className="ui-control w-full px-3 py-2 text-sm rounded-lg outline-none" placeholder="Sea Kayak Tour" />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={mappingForm.active} onChange={(e) => setMappingForm((prev) => ({ ...prev, active: e.target.checked }))} className="w-4 h-4 rounded border-gray-300 text-[var(--ck-accent)] focus:ring-[var(--ck-accent)]" />
                <span className="text-sm text-[var(--ck-text-strong)]">Active</span>
              </label>

              {mappingMessage.text && (
                <div className={`text-xs font-medium ${mappingMessage.type === "error" ? "text-[var(--ck-danger)]" : "text-[var(--ck-success)]"}`}>{mappingMessage.text}</div>
              )}

              <div className="flex gap-3">
                <button type="submit" disabled={savingMapping} className="flex-1 rounded-xl bg-[var(--ck-text-strong)] py-2.5 text-sm font-semibold text-[var(--ck-btn-primary-text)] hover:opacity-90 disabled:opacity-50">
                  {savingMapping ? "Saving..." : editingMappingId ? "Update Mapping" : "Add Mapping"}
                </button>
                <button type="button" onClick={resetMappingForm} className="px-4 rounded-xl border border-[var(--ck-border-subtle)] text-sm font-medium text-[var(--ck-text-muted)] hover:bg-[var(--ck-bg)]">Reset</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
