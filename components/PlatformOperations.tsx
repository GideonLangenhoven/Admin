"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuthHeaders } from "../app/lib/admin-auth";
import { confirmAction } from "../app/lib/app-notify";
import { useBusinessContext } from "./BusinessContext";

const AUTOMATIC = {
  billing_ready: "Billing subscription exists", policies_ready: "Policies record exists",
  owner_ready: "Owner has set a password", activity_ready: "Visible activity exists",
  availability_ready: "Future bookable time exists", payments_configured: "Live payment key and webhook saved",
  whatsapp_configured: "WhatsApp credentials saved",
} as const;
const MANUAL = {
  owner_login: "Owner signed in and saw only this business",
  payment_refund: "Payment, confirmation and refund tested for this business",
  email_received: "Test email actually arrived",
  whatsapp_received: "Test WhatsApp actually arrived",
  tenant_isolation: "Booking, voucher and staff access checked against a second business",
  content_approved: "Owner approved prices, times, policies and contact details",
} as const;
type Client = { id: string; name: string; status: string; subdomain: string | null; checks: Record<string, boolean>; checked_at: string | null; failed_notifications: number; failed_whatsapp_24h: number; refunds_needing_review: number } & Record<keyof typeof AUTOMATIC, boolean>;
type Audit = { id: string; created_at: string; action_type: string; business_name: string | null; actor: string; target_id: string; reason: string | null };
type Snapshot = { clients: Client[]; audit: Audit[]; as_of: string };

export default function PlatformOperations() {
  const { switchOperator } = useBusinessContext();
  const router = useRouter();
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/super-admin/operations", { headers: await getAuthHeaders() });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load operations");
      setData(result);
    } catch (e) { setError(e instanceof Error ? e.message : "Connection failed"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function change(client: Client, action: string, check?: string, complete?: boolean) {
    const message = action === "complete_setup"
      ? "Create any missing subscription and policies for " + client.name + ", starting today? Existing records stay unchanged. This does not send an invoice or take payment."
      : client.name + ": " + (complete ? "confirm you personally verified" : "clear the confirmation for") + " “" + MANUAL[check as keyof typeof MANUAL] + "”?";
    if (!await confirmAction({ title: action === "complete_setup" ? "Complete client setup" : "Record launch check", message, confirmLabel: "Confirm", tone: "warning" })) return;
    setBusy(client.id); setError("");
    try {
      const response = await fetch("/api/super-admin/business", { method: "POST", headers: await getAuthHeaders(client.id), body: JSON.stringify({ action, business_id: client.id, check, complete }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Change failed");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Change failed"); }
    finally { setBusy(null); }
  }
  function openClient(client: Client, path: string) {
    switchOperator?.(client.id);
    router.push(path);
  }
  return <section className="ui-card p-4 sm:p-6 space-y-4" aria-labelledby="operations-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="operations-heading" className="text-lg font-semibold">Client readiness & support</h2>
        <p className="text-sm text-[var(--ck-text-muted)]">Saved settings are not proof of delivery or successful payment. Confirm each test below before onboarding.</p></div>
      <button className="ui-btn ui-btn-ghost" onClick={() => void load()} disabled={loading || !!busy}>{loading ? "Checking…" : "Refresh checks"}</button>
    </div>
    <div className="flex flex-wrap gap-4 text-sm">
      <a className="underline" href="https://bookingtours.sentry.io/issues/?environment=production" target="_blank" rel="noreferrer">Sentry errors ↗</a>
      <a className="underline" href="https://bookingtours.sentry.io/monitors/" target="_blank" rel="noreferrer">Sentry monitors ↗</a>
      <a className="underline" href="/help?topic=super-admin">Super Admin help</a>
    </div>
    <details className="text-sm border-b border-[var(--ck-border-subtle)] pb-3">
      <summary className="cursor-pointer font-semibold">New to Sentry? Start here</summary>
      <ol className="list-decimal pl-5 mt-3 space-y-2">
        <li>Open Sentry errors. Choose <strong>production</strong> and <strong>Unresolved</strong>, then check the last 24 hours.</li>
        <li>Open a new or repeating issue. Note its link, first/last seen, number of events, and the <strong>app</strong>, <strong>business_id</strong> and <strong>function.name</strong> tags when available.</li>
        <li>Payment, refund, sign-in, wrong-client data or missed scheduled-job problems need immediate attention. Check the affected client here; do not repeat a payment or refund just to test it.</li>
        <li>Send the issue link and what the client was doing to your developer. Resolve it only after the fix is deployed and that action works again. A returning fixed error is a regression.</li>
      </ol>
      <p className="mt-3">Check at the start and end of each day and after every onboarding. The cron monitor must show recent successful runs; no new errors is not proof that everything is working. Alert emails still need a delivery test.</p>
    </details>
    {error && <p role="alert" className="text-sm text-[var(--ck-danger)]">{error} {data && "The previous snapshot below may be out of date."}</p>}
    {data && <p className="text-xs text-[var(--ck-text-muted)]">Checked {new Date(data.as_of).toLocaleString()}. Refresh after changing another section.</p>}
    {!loading && !data && <p>Checks unavailable. Do not treat this as a launch approval.</p>}
    {data?.clients.length === 0 && <p>No clients yet. Create your first client below.</p>}
    {data?.clients.map(client => {
      const remaining = Object.keys(AUTOMATIC).filter(k => !client[k as keyof typeof AUTOMATIC]).length
        + Object.keys(MANUAL).filter(k => !client.checks[k]).length + (client.subdomain ? 0 : 1);
      return <details key={client.id} className="rounded-lg border border-[var(--ck-border-subtle)] p-3">
        <summary className="cursor-pointer text-sm font-semibold">{client.name} · {client.status} · {remaining ? remaining + " checks outstanding" : "Checklist complete"}
          {(client.failed_notifications + client.failed_whatsapp_24h + client.refunds_needing_review > 0) && " · Needs support review"}
        </summary>
        <div className="mt-4 space-y-4">
          <p className="text-xs">Booking address: {client.subdomain ? <a className="underline" href={"https://" + client.subdomain + ".booking.bookingtours.co.za"} target="_blank" rel="noreferrer">{client.subdomain}.booking.bookingtours.co.za ↗</a> : "Missing — set a booking subdomain in the client editor below."}</p>
          <ul className="grid sm:grid-cols-2 gap-2 text-sm">
            {Object.entries(AUTOMATIC).map(([key,label]) => <li key={key}>{client[key as keyof typeof AUTOMATIC] ? "✓" : "Missing:"} {label}</li>)}
          </ul>
          {(!client.billing_ready || !client.policies_ready) && <button className="ui-btn ui-btn-ghost" disabled={!!busy} onClick={() => change(client,"complete_setup")}>Complete missing setup</button>}
          <fieldset className="space-y-2"><legend className="font-semibold text-sm mb-2">Tests you must verify with this client</legend>
            {Object.entries(MANUAL).map(([key,label]) => <label key={key} className="flex gap-2 text-sm items-start">
              <input type="checkbox" checked={client.checks[key] === true} disabled={!!busy} onChange={e => change(client,"release_check",key,e.target.checked)} className="mt-1" />{label}
            </label>)}
          </fieldset>
          <p className="text-sm">{client.failed_notifications} failed/expired queued messages · {client.failed_whatsapp_24h} WhatsApp send failures in 24 hours · {client.refunds_needing_review} pending/failed refund operations. Counts may refer to the same delivery; inspect before retrying.</p>
          <div className="flex flex-wrap gap-2">
            <button className="ui-btn ui-btn-ghost" onClick={() => openClient(client,"/notifications")}>Review notifications</button>
            <button className="ui-btn ui-btn-ghost" onClick={() => openClient(client,"/refunds")}>Review refunds</button>
            <button className="ui-btn ui-btn-ghost" onClick={() => openClient(client,"/billing")}>Open client billing</button>
            <button className="ui-btn ui-btn-ghost" onClick={() => openClient(client,"/settings")}>Open client settings</button>
          </div>
        </div>
      </details>;
    })}
    <details className="border-t border-[var(--ck-border-subtle)] pt-3"><summary className="cursor-pointer font-semibold text-sm">Recent audit trail (latest 100 actions)</summary>
      <p className="text-xs my-2 text-[var(--ck-text-muted)]">Who changed what, and when. Financial documents and older history are retained in the database.</p>
      <ol className="space-y-2 text-xs max-h-96 overflow-auto">
        {data?.audit.map(event => <li key={event.id} className="border-b border-[var(--ck-border-subtle)] py-2 break-words">
          {new Date(event.created_at).toLocaleString()} · {event.business_name || "Platform"} · {event.actor}<br />
          {event.action_type.replaceAll("_"," ").toLowerCase()}{event.reason && " — " + event.reason}<br /><span className="text-[var(--ck-text-muted)]">Record: {event.target_id}</span>
        </li>)}
      </ol>
    </details>
  </section>;
}
