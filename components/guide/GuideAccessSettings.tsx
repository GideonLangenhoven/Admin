"use client";
import { useEffect, useState } from "react";
import { getAuthHeaders } from "@/app/lib/admin-auth";
import { useBusinessContext } from "@/components/BusinessContext";

type Guide = { login_name: string; suspended: boolean; must_set_password: boolean; password_set_at: string | null };
export default function GuideAccessSettings() {
  const { businessId } = useBusinessContext();
  const [guide, setGuide] = useState<Guide | null>(null), [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false), [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [link, setLink] = useState(""), [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true; setGuide(null); setLink(""); setError(""); setLoading(true); setLoaded(false);
    getAuthHeaders(businessId).then(headers => fetch("/api/guide/access", { headers })).then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (active) { setGuide(data.guide); setLoaded(true); }
    }).catch(err => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [businessId, reload]);
  async function update(action: "issue" | "suspend") {
    setBusy(true); setError(""); setCopied(false);
    try {
      const response = await fetch("/api/guide/access", { method: "POST", headers: await getAuthHeaders(businessId), body: JSON.stringify({ action, suspended: !guide?.suspended }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (action === "issue") { setGuide(data.guide); setLink(data.setup_url); }
      else setGuide(current => current ? { ...current, suspended: !current.suspended } : null);
    } catch (err) { setError(err instanceof Error ? err.message : "Guide access could not be updated"); }
    setBusy(false);
  }
  return <section aria-label="Guide login" className="border-t border-[var(--ck-border-subtle)] pt-5 mt-6 space-y-3">
    <h3 className="text-base font-semibold">Guide login</h3>
    {loading ? <p role="status">Loading guide access…</p> : !loaded ? <button className="ui-btn ui-btn-soft min-h-11" onClick={() => setReload(value => value + 1)}>Retry</button> : <>
      {guide && <p className="break-all text-sm"><strong>{guide.login_name}</strong> · {guide.suspended ? "Disabled" : guide.must_set_password ? "Password setup required" : "Active"}</p>}
      <div className="flex flex-wrap gap-3"><button type="button" className="ui-btn ui-btn-primary min-h-11" disabled={busy} onClick={() => update("issue")}>{busy ? "Saving…" : guide ? "New setup link" : "Create guide login"}</button>
      {guide && <button type="button" className="ui-btn ui-btn-soft min-h-11" disabled={busy} onClick={() => update("suspend")}>{guide.suspended ? "Enable guide access" : "Disable guide access"}</button>}</div>
      {guide && <p className="text-xs ui-text-muted">{link ? "Share privately. Valid once for 48 hours." : "A fresh setup link requires a new shared password."}</p>}
      {link && <div className="space-y-2"><label className="block text-sm">Private password setup link<input className="ui-control mt-1 w-full min-h-11 px-3 text-sm" readOnly value={link} onFocus={e => e.target.select()} /></label><button type="button" className="ui-btn ui-btn-soft min-h-11" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setError("Select and copy the private link above."); } }}>{copied ? "Copied" : "Copy setup link"}</button></div>}
    </>}
    {error && <p role="alert" className="text-sm">{error}</p>}
  </section>;
}
