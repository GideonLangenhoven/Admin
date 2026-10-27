"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useBusinessContext } from "../../../components/BusinessContext";
import { getAuthHeaders } from "../../lib/admin-auth";

type Connection={ id:string; provider:string; scopes:string[]; enabled:boolean; created_at:string; expires_at:string; disconnected_at:string|null };
type Consent={ provider:string; scopes:string[]; expires_in_days:number };
const permission:Record<string,string>={ "departures:read":"Departure schedules", "availability:read":"Current capacity snapshots", "attention:read":"Aggregate counts of outstanding payments and participant waivers" };
export default function AgentConnectionsPage() {
  const { businessId,businessName,role,readOnly }=useBusinessContext();
  const [connections,setConnections]=useState<Connection[]>([]);
  const [consent,setConsent]=useState<Consent|null>(null);
  const [ticket,setTicket]=useState("");
  const [status,setStatus]=useState("Checking connections…");
  const [busy,setBusy]=useState(false);
  const [confirmed,setConfirmed]=useState(false);
  const [enabled,setEnabled]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    if (!businessId || role!=="MAIN_ADMIN" || readOnly) return ()=>controller.abort();
    const request=new URL(window.location.href).searchParams.get("request") || "";
    setTicket(request);
    setConfirmed(false);
    void (async()=>{
      try {
        const params=new URLSearchParams({ business_id:businessId,...(request ? { request } : {}) });
        const response=await fetch("/api/agent/connections?"+params,{ headers:await getAuthHeaders(businessId),signal:controller.signal,cache:"no-store" });
        if (!response.ok) throw new Error(response.status===503 ? "Agent connections are not available yet." : "Connections could not be verified. Try again or contact support.");
        const data=await response.json();
        if (!controller.signal.aborted) { setConnections(data.connections);setConsent(data.consent);setEnabled(data.chatgpt_enabled);setStatus(""); }
      } catch(error) { if (!controller.signal.aborted) { setConnections([]);setConsent(null);setEnabled(false);setStatus(error instanceof Error ? error.message : "Connections could not be verified."); } }
    })();
    return ()=>controller.abort();
  },[businessId,role,readOnly]);
  async function decide(allow:boolean) {
    setBusy(true);setStatus("");
    try {
      const response=await fetch("/api/agent/oauth/consent",{ method:"POST",headers:await getAuthHeaders(businessId),
        body:JSON.stringify({ request:ticket,business_id:businessId,allow }) });
      if (!response.ok) throw new Error("Authorization could not be completed. Start a new connection request in ChatGPT.");
      const data=await response.json();
      const redirect=new URL(data.redirect);
      if (redirect.origin!=="https://chatgpt.com") throw new Error("The authorization response could not be verified.");
      window.location.assign(redirect.href);
    } catch(error) { setStatus(error instanceof Error ? error.message : "Authorization failed.");setBusy(false); }
  }
  async function disconnect(id:string) {
    setBusy(true);setStatus("");
    try {
      const response=await fetch("/api/agent/connections",{ method:"POST",headers:await getAuthHeaders(businessId),body:JSON.stringify({ business_id:businessId,grant_id:id }) });
      if (!response.ok) throw new Error("Disconnection could not be confirmed. Try again or contact support.");
      setConnections(rows=>rows.map(row=>row.id===id ? { ...row,enabled:false,disconnected_at:new Date().toISOString() } : row));
      setStatus("Disconnected. Data access and token renewal stopped.");
    } catch(error) { setStatus(error instanceof Error ? error.message : "Disconnection could not be confirmed."); }
    finally { setBusy(false); }
  }
  return <main className="max-w-3xl space-y-6">
    <Link href="/settings" className="text-sm underline text-[var(--ck-text-muted)] focus-visible:outline">Back to settings</Link>
    <div><h2 className="text-2xl font-semibold text-[var(--ck-text-strong)]">AI agent connections</h2>
      <p className="mt-2 text-sm text-[var(--ck-text-muted)] max-w-prose">Manage read access to {businessName || "your business"}. Connection permission is separate from email marketing consent.</p></div>
    {role!=="MAIN_ADMIN" || readOnly ? <p role="status">Only the owner can approve connections.</p> : <>
      {status && <p role="status" className="text-sm">{status}</p>}
      {consent && enabled && <section aria-labelledby="consent-title" className="ui-card p-5 space-y-4">
        <h2 id="consent-title" className="text-lg font-semibold">Allow ChatGPT to read {businessName}?</h2>
        <ul className="list-disc pl-5 space-y-2 text-sm">{consent.scopes.map(scope=><li key={scope}>{permission[scope]}</li>)}</ul>
        <p className="text-sm max-w-prose">Access expires after {consent.expires_in_days} days. Disconnect at any time. Results exclude guest names, contact details and waiver documents. Capacity is a snapshot, and reading it does not reserve seats.</p>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} disabled={busy} className="mt-1" />
          <span>I authorize these read permissions for {businessName}.</span></label>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={()=>void decide(true)} disabled={busy || !confirmed} className="rounded-lg bg-[var(--ck-accent)] px-4 py-2 text-sm font-semibold text-[var(--ck-surface)] disabled:opacity-50 focus-visible:outline">{busy ? "Processing…" : "Authorize read access"}</button>
          <button type="button" onClick={()=>void decide(false)} disabled={busy} className="rounded-lg border border-[var(--ck-border-subtle)] px-4 py-2 text-sm disabled:opacity-50 focus-visible:outline">Decline</button>
        </div>
      </section>}
      {!consent && enabled && <p className="text-sm">Connect your custom MCP server in ChatGPT, then approve access here.</p>}
      <section aria-labelledby="connections-title" className="space-y-3">
        <h2 id="connections-title" className="text-lg font-semibold">Your connections</h2>
        {!status && !connections.length && <p className="text-sm text-[var(--ck-text-muted)]">No connections yet.</p>}
        {connections.map(connection=>{
          const active=connection.enabled && !connection.disconnected_at && Date.parse(connection.expires_at)>Date.now();
          return <div key={connection.id} className="py-4 border-b border-[var(--ck-border-subtle)] space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3"><p className="font-medium">{connection.provider} · {active ? "Authorized grant" : "Inactive grant"}</p>
              {active && <button type="button" disabled={busy} onClick={()=>void disconnect(connection.id)} className="rounded-lg border border-[var(--ck-border-subtle)] px-3 py-2 text-sm disabled:opacity-50 focus-visible:outline">Disconnect</button>}</div>
            <p className="text-sm text-[var(--ck-text-muted)]">Expires <time dateTime={connection.expires_at}>{new Date(connection.expires_at).toLocaleString()}</time></p>
            <p className="text-sm">{connection.scopes.map(scope=>permission[scope]).join("; ")}</p>
          </div>;
        })}
      </section>
      <p className="text-sm text-[var(--ck-text-muted)]">Muse connection is not available yet.</p>
    </>}
  </main>;
}
