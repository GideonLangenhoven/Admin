"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useBusinessContext } from "../../../components/BusinessContext";
import { confirmAction, notify } from "../../lib/app-notify";
import { ShieldCheck } from "@phosphor-icons/react";

type DataRequest = {
  id: string;
  email: string;
  request_type: "ACCESS" | "DELETION" | "CORRECTION";
  status: string;
  reason: string | null;
  confirmed_at: string | null;
  scheduled_for: string | null;
  fulfilled_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  customer_id: string | null;
  customers: { name: string | null; total_bookings: number; total_spent: number } | null;
};

const STATUS_TABS = [
  { key: "actionable", label: "Action Required" },
  { key: "PENDING_CONFIRMATION", label: "Pending" },
  { key: "FULFILLED", label: "Fulfilled" },
  { key: "REJECTED", label: "Rejected" },
  { key: "CANCELLED", label: "Cancelled" },
] as const;

export default function DataRequestsPage() {
  const { businessId, role } = useBusinessContext();
  const [requests, setRequests] = useState<DataRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<string>("actionable");
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const isPrivileged = role === "MAIN_ADMIN" || role === "SUPER_ADMIN";

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(iv);
  }, []);

  async function authHeaders() {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }

  async function load() {
    setLoading(true);
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    const r = await fetch("/api/admin/data-requests", { headers });
    if (r.ok) {
      const data = await r.json();
      setRequests(data.requests ?? []);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [businessId]);

  const filtered = requests.filter(r => {
    if (tab === "actionable") return ["CONFIRMED", "IN_REVIEW"].includes(r.status);
    return r.status === tab;
  });

  async function handleFulfill(id: string) {
    const confirmed = await confirmAction({
      title: "Fulfill deletion request",
      message: "This will permanently anonymize all personal data for this customer. Financial records will be preserved with anonymized identifiers. This cannot be undone.",
      tone: "warning",
      confirmLabel: "Anonymize & Fulfill",
    });
    if (!confirmed) return;

    setActionLoading(true);
    const r = await fetch(`/api/admin/data-requests/${id}/fulfill`, {
      method: "POST",
      headers: await authHeaders(),
    });
    const data = await r.json();
    setActionLoading(false);
    if (r.ok) {
      notify({ title: "Request fulfilled", message: "Customer data has been anonymized.", tone: "success" });
      load();
    } else {
      notify({ title: "Fulfillment failed", message: data.error, tone: "error" });
    }
  }

  async function handleReject(id: string) {
    if (!rejectReason || rejectReason.trim().length < 5) {
      notify({ title: "Reason required", message: "Provide a reason for rejecting (min 5 chars).", tone: "error" });
      return;
    }
    setActionLoading(true);
    const r = await fetch(`/api/admin/data-requests/${id}/reject`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ reason: rejectReason }),
    });
    const data = await r.json();
    setActionLoading(false);
    if (r.ok) {
      notify({ title: "Request rejected", message: "Customer has been notified.", tone: "success" });
      setRejectId(null);
      setRejectReason("");
      load();
    } else {
      notify({ title: "Rejection failed", message: data.error, tone: "error" });
    }
  }

  async function handleExport(id: string) {
    setActionLoading(true);
    const r = await fetch(`/api/admin/data-requests/${id}/export`, {
      method: "POST",
      headers: await authHeaders(),
    });
    const data = await r.json();
    setActionLoading(false);
    if (r.ok) {
      if (data.export_url) {
        window.open(data.export_url, "_blank");
      }
      notify({ title: "Export generated", message: "Customer has been emailed the download link.", tone: "success" });
      load();
    } else {
      notify({ title: "Export failed", message: data.error, tone: "error" });
    }
  }

  const statusBadge = (status: string) => {
    const pill: Record<string, string> = {
      PENDING_CONFIRMATION: "ui-pill-neutral",
      CONFIRMED: "ui-pill-ocean",
      IN_REVIEW: "ui-pill-warning",
      FULFILLED: "ui-pill-success",
      CANCELLED: "ui-pill-neutral",
      REJECTED: "ui-pill-danger",
    };
    return <span className={`ui-status ${pill[status] || "ui-pill-neutral"}`}>{status.replace(/_/g, " ")}</span>;
  };

  if (loading) {
    return (
      <div className="space-y-4 py-2"><div className="ui-skeleton h-8 w-48" /><div className="ui-skeleton h-[140px] !rounded-2xl" /><div className="ui-skeleton h-[320px] !rounded-2xl" /></div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="anim-fade-up flex items-center justify-between">
        <div>
          <p className="ui-mono-label mb-2">Admin · Privacy</p>
          <h1 className="font-display text-[28px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}>POPIA Data Requests</h1>
        </div>
        <span className="ui-status ui-pill-success">
          {requests.filter(r => ["CONFIRMED", "IN_REVIEW"].includes(r.status)).length} actionable
        </span>
      </div>

      <p className="anim-fade-up anim-d1 text-sm" style={{ color: "var(--ck-text-muted)" }}>
        Under POPIA, data subjects can request access to or deletion of their personal information.
        Deletion requests have a mandatory 30-day cooling-off period before they can be fulfilled.
      </p>

      {/* Tabs */}
      <div className="anim-fade-up anim-d1 ui-seg">
        {STATUS_TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className="ui-seg-item"
            data-active={tab === t.key}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab help text — explains why Pending rows don't show actions */}
      {tab === "PENDING_CONFIRMATION" && filtered.length > 0 && (
        <p className="text-xs rounded-md border px-3 py-2" style={{ borderColor: "var(--ck-border-subtle)", background: "var(--ck-surface-sunken)", color: "var(--ck-text-muted)" }}>
          These customers haven&rsquo;t clicked the confirmation link yet. Pending requests auto-expire 24h
          after submission. Export / Fulfill / Reject buttons appear once the request moves to <strong>Action Required</strong>.
        </p>
      )}

      {/* List */}
      {filtered.length === 0 ? (
        <div className="ui-card">
          <div className="ui-empty">
            <span className="ui-icon-chip"><ShieldCheck size={19} /></span>
            <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No requests in this category</p>
            <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Data requests will appear here as customers submit them.</p>
          </div>
        </div>
      ) : (
        <div className="anim-fade-up anim-d2 space-y-3">
          {filtered.map(r => {
            const daysUntilDue = r.scheduled_for
              ? Math.max(0, Math.ceil((new Date(r.scheduled_for).getTime() - now) / 86_400_000))
              : null;
            return (
              <div key={r.id} className="ui-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium" style={{ color: "var(--ck-text-strong)" }}>{r.email}</span>
                      {statusBadge(r.status)}
                      <span className={`ui-status ${r.request_type === "DELETION" ? "ui-pill-danger" : "ui-pill-ocean"}`}>
                        {r.request_type}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs" style={{ color: "var(--ck-text-muted)" }}>
                      <span>Requested {new Date(r.created_at).toLocaleDateString("en-ZA")}</span>
                      {r.customers && (
                        <span>{r.customers.total_bookings} bookings · R{r.customers.total_spent}</span>
                      )}
                      {daysUntilDue !== null && r.status === "CONFIRMED" && (
                        <span className="font-medium" style={{ color: "var(--ck-amber)" }}>{daysUntilDue} days until due</span>
                      )}
                      {daysUntilDue === 0 && r.status === "IN_REVIEW" && (
                        <span className="font-medium" style={{ color: "var(--ck-danger)" }}>Overdue — ready to fulfill</span>
                      )}
                    </div>
                    {r.reason && <p className="mt-1 text-xs italic" style={{ color: "var(--ck-text-muted)" }}>"{r.reason}"</p>}
                  </div>

                  {isPrivileged && ["CONFIRMED", "IN_REVIEW"].includes(r.status) && (
                    <div className="flex gap-1.5 shrink-0">
                      {r.request_type === "ACCESS" && (
                        <button
                          onClick={() => handleExport(r.id)}
                          disabled={actionLoading}
                          className="ui-btn ui-btn-primary !h-8 !px-3 !text-[12.5px]"
                        >
                          Export
                        </button>
                      )}
                      {r.request_type === "DELETION" && (
                        <button
                          onClick={() => handleFulfill(r.id)}
                          disabled={actionLoading}
                          className="ui-btn ui-btn-danger !h-8 !px-3 !text-[12.5px]"
                        >
                          Fulfill
                        </button>
                      )}
                      <button
                        onClick={() => setRejectId(r.id)}
                        disabled={actionLoading}
                        className="ui-btn ui-btn-ghost !h-8 !px-3 !text-[12.5px]"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>

                {/* Reject form inline */}
                {rejectId === r.id && (
                  <div className="mt-3 flex gap-2 items-end">
                    <input
                      type="text"
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      placeholder="Reason for rejection (e.g. active refund dispute)"
                      className="ui-control flex-1 text-sm"
                    />
                    <button
                      onClick={() => handleReject(r.id)}
                      disabled={actionLoading || rejectReason.trim().length < 5}
                      className="ui-btn ui-btn-danger !px-3 !text-[12.5px]"
                    >
                      Confirm Reject
                    </button>
                    <button
                      onClick={() => { setRejectId(null); setRejectReason(""); }}
                      className="ui-btn ui-btn-ghost !px-3 !text-[12.5px]"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
