"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useBusinessContext } from "../../components/BusinessContext";
import { getAdminTimezone } from "../lib/admin-timezone";
import { SpinnerGap } from "@phosphor-icons/react";

type AuditRow = {
  id: string;
  created_at: string;
  action_type: string;
  actor_email: string | null;
  actor_role: string | null;
  target_entity: string | null;
  target_id: string | null;
  ip_address: string | null;
  metadata: Record<string, unknown> | null;
  source: string | null;
};

const ACTION_OPTIONS = [
  "ADMIN_LOGIN",
  "ADMIN_LOGIN_FAIL",
  "ADMIN_INVITE",
  "ADMIN_RESET_REQUESTED",
  "ADMIN_PASSWORD_CHANGED",
  "ADMIN_DELETED",
  "TENANT_ONBOARDED",
  "CREDENTIALS_UPDATED",
  "BOOKING_CANCELLED",
  "REFUND_INITIATED",
  "REFUND_DECLINED",
  "TOUR_CREATED",
  "TOUR_UPDATED",
  "TOUR_DELETED",
  "SLOT_GENERATED",
  "SETTINGS_UPDATED",
  "BROADCAST_SENT",
  "INSERT",
  "UPDATE",
  "DELETE",
];

function fmtTimestamp(iso: string) {
  return new Date(iso).toLocaleString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: getAdminTimezone(),
  });
}

function ActionBadge({ action }: { action: string }) {
  var color = "bg-gray-100 text-gray-700";
  if (action.includes("FAIL") || action === "DELETE" || action === "ADMIN_DELETED") color = "bg-red-50 text-red-700";
  else if (action.includes("LOGIN") || action.includes("ONBOARD")) color = "bg-green-50 text-green-700";
  else if (action.includes("CANCEL") || action.includes("REFUND")) color = "bg-amber-50 text-amber-700";
  else if (action === "INSERT" || action.includes("CREATED")) color = "bg-blue-50 text-blue-700";
  else if (action === "UPDATE" || action.includes("UPDATED") || action.includes("CHANGED")) color = "bg-purple-50 text-purple-700";
  return <span className={"inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold " + color}>{action}</span>;
}

export default function AuditLogPage() {
  var { businessId, role } = useBusinessContext();
  var isSuperAdmin = role === "SUPER_ADMIN";
  var [rows, setRows] = useState<AuditRow[]>([]);
  var [loading, setLoading] = useState(true);
  var [actionFilter, setActionFilter] = useState("");
  var [actorFilter, setActorFilter] = useState("");
  var [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId && !isSuperAdmin) return;
    setLoading(true);
    var query = supabase
      .from("audit_logs")
      .select("id, created_at, action_type, actor_email, actor_role, target_entity, target_id, ip_address, metadata, source")
      .order("created_at", { ascending: false })
      .limit(200);

    if (actionFilter) query = query.eq("action_type", actionFilter);
    if (actorFilter) query = query.ilike("actor_email", "%" + actorFilter + "%");

    query.then(({ data, error }) => {
      if (error) console.error("AUDIT_LOG_FETCH:", error.message);
      setRows((data as AuditRow[]) || []);
      setLoading(false);
    });
  }, [businessId, isSuperAdmin, actionFilter, actorFilter]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--ck-text-strong)" }}>Audit Log</h1>
          <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>
            {isSuperAdmin ? "All tenant activity" : "Activity for your business"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)", color: "var(--ck-text)" }}
          >
            <option value="">All actions</option>
            {ACTION_OPTIONS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Filter by actor email…"
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm w-56"
            style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)", color: "var(--ck-text)" }}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <SpinnerGap size={28} className="animate-spin" style={{ color: "var(--ck-text-muted)" }} />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border p-10 text-center" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}>
          <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>No audit events found.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--ck-border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--ck-surface)" }}>
                <th className="px-4 py-3 text-left font-semibold" style={{ color: "var(--ck-text-muted)" }}>Time</th>
                <th className="px-4 py-3 text-left font-semibold" style={{ color: "var(--ck-text-muted)" }}>Action</th>
                <th className="px-4 py-3 text-left font-semibold" style={{ color: "var(--ck-text-muted)" }}>Actor</th>
                <th className="px-4 py-3 text-left font-semibold" style={{ color: "var(--ck-text-muted)" }}>Entity</th>
                <th className="px-4 py-3 text-left font-semibold" style={{ color: "var(--ck-text-muted)" }}>Source</th>
                <th className="px-4 py-3 text-left font-semibold" style={{ color: "var(--ck-text-muted)" }}>IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t cursor-pointer transition-colors"
                  style={{ borderColor: "var(--ck-border)" }}
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--ck-sidebar-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = ""; }}
                >
                  <td className="px-4 py-2.5 whitespace-nowrap tabular-nums" style={{ color: "var(--ck-text-muted)" }}>{fmtTimestamp(r.created_at)}</td>
                  <td className="px-4 py-2.5"><ActionBadge action={r.action_type} /></td>
                  <td className="px-4 py-2.5" style={{ color: "var(--ck-text)" }}>
                    {r.actor_email || "—"}
                    {r.actor_role && <span className="ml-1 text-xs" style={{ color: "var(--ck-text-muted)" }}>({r.actor_role})</span>}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: "var(--ck-text-muted)" }}>
                    {r.target_entity || "—"}
                    {r.target_id && <span className="ml-1 text-xs font-mono">{r.target_id.substring(0, 8)}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: "var(--ck-text-muted)" }}>{r.source || "api"}</td>
                  <td className="px-4 py-2.5 text-xs font-mono" style={{ color: "var(--ck-text-muted)" }}>{r.ip_address || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {expanded && (
        <div className="mt-4 rounded-xl border p-4" style={{ borderColor: "var(--ck-border)", background: "var(--ck-surface)" }}>
          <h3 className="mb-2 text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>Event Details</h3>
          <pre className="overflow-x-auto rounded-lg p-3 text-xs" style={{ background: "var(--ck-bg)", color: "var(--ck-text-muted)" }}>
            {JSON.stringify(rows.find((r) => r.id === expanded), null, 2)}
          </pre>
        </div>
      )}

      <p className="mt-4 text-xs" style={{ color: "var(--ck-text-muted)" }}>
        Showing up to 200 most recent events. DB triggers (source: trigger) fire automatically on admin_users and businesses changes.
      </p>
    </div>
  );
}
