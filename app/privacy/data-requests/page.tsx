"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useBusinessContext } from "../../../components/BusinessContext";
import { confirmAction, notify } from "../../lib/app-notify";

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
    const colors: Record<string, string> = {
      PENDING_CONFIRMATION: "bg-gray-100 text-gray-700",
      CONFIRMED: "bg-blue-100 text-blue-800",
      IN_REVIEW: "bg-amber-100 text-amber-800",
      FULFILLED: "bg-emerald-100 text-emerald-800",
      CANCELLED: "bg-gray-100 text-gray-500",
      REJECTED: "bg-red-100 text-red-700",
    };
    return <span className={`text-xs px-2 py-0.5 rounded font-medium ${colors[status] || "bg-gray-100"}`}>{status.replace(/_/g, " ")}</span>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: "var(--ck-text-strong)" }}>POPIA Data Requests</h1>
        <span className="text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-800 font-medium">
          {requests.filter(r => ["CONFIRMED", "IN_REVIEW"].includes(r.status)).length} actionable
        </span>
      </div>

      <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>
        Under POPIA, data subjects can request access to or deletion of their personal information.
        Deletion requests have a mandatory 30-day cooling-off period before they can be fulfilled.
      </p>

      {/* Tabs */}
      <div className="flex gap-1 border-b" style={{ borderColor: "var(--ck-border)" }}>
        {STATUS_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key ? "border-emerald-600 text-emerald-700" : "border-transparent"
            }`}
            style={tab !== t.key ? { color: "var(--ck-text-muted)" } : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <p className="text-sm py-8 text-center" style={{ color: "var(--ck-text-muted)" }}>No requests in this category.</p>
      ) : (
        <div className="space-y-3">
          {filtered.map(r => {
            const daysUntilDue = r.scheduled_for
              ? Math.max(0, Math.ceil((new Date(r.scheduled_for).getTime() - now) / 86_400_000))
              : null;
            return (
              <div key={r.id} className="p-4 rounded-xl border" style={{ background: "var(--ck-surface)", borderColor: "var(--ck-border)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium" style={{ color: "var(--ck-text-strong)" }}>{r.email}</span>
                      {statusBadge(r.status)}
                      <span className={`text-xs px-1.5 py-0.5 rounded ${r.request_type === "DELETION" ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"}`}>
                        {r.request_type}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs" style={{ color: "var(--ck-text-muted)" }}>
                      <span>Requested {new Date(r.created_at).toLocaleDateString("en-ZA")}</span>
                      {r.customers && (
                        <span>{r.customers.total_bookings} bookings · R{r.customers.total_spent}</span>
                      )}
                      {daysUntilDue !== null && r.status === "CONFIRMED" && (
                        <span className="font-medium text-amber-700">{daysUntilDue} days until due</span>
                      )}
                      {daysUntilDue === 0 && r.status === "IN_REVIEW" && (
                        <span className="font-medium text-red-700">Overdue — ready to fulfill</span>
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
                          className="px-2.5 py-1.5 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          Export
                        </button>
                      )}
                      {r.request_type === "DELETION" && (
                        <button
                          onClick={() => handleFulfill(r.id)}
                          disabled={actionLoading}
                          className="px-2.5 py-1.5 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          Fulfill
                        </button>
                      )}
                      <button
                        onClick={() => setRejectId(r.id)}
                        disabled={actionLoading}
                        className="px-2.5 py-1.5 rounded text-xs font-medium border hover:bg-gray-50 disabled:opacity-50"
                        style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}
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
                      className="flex-1 text-sm px-3 py-2 rounded border"
                      style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
                    />
                    <button
                      onClick={() => handleReject(r.id)}
                      disabled={actionLoading || rejectReason.trim().length < 5}
                      className="px-3 py-2 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      Confirm Reject
                    </button>
                    <button
                      onClick={() => { setRejectId(null); setRejectReason(""); }}
                      className="px-3 py-2 rounded text-xs font-medium border"
                      style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}
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
