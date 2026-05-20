"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useBusinessContext } from "../../components/BusinessContext";
import { notify } from "../lib/app-notify";

// AM3/AM5: minimal admin surface for inspecting failed outbox messages and
// retrying them. The outbox table is the project's notification queue —
// status=FAILED rows are messages that exhausted their 2-attempt retry
// budget. Retry resets status=PENDING and clears the error so the
// outbox-send cron picks them up on its next run (every 5 minutes).

type OutboxRow = {
  id: string;
  phone: string;
  message_type: string;
  message_body: string | null;
  status: string;
  attempts: number;
  error: string | null;
  scheduled_for: string;
  sent_at: string | null;
  created_at: string;
  booking_id: string | null;
};

const FAILED_STATUSES = ["FAILED", "EXPIRED"];

export default function NotificationsPage() {
  const { businessId, role } = useBusinessContext();
  const [rows, setRows] = useState<OutboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [tab, setTab] = useState<"failed" | "waiting" | "recent">("failed");
  const isPrivileged = role === "MAIN_ADMIN" || role === "SUPER_ADMIN";

  async function load() {
    if (!businessId) return;
    setLoading(true);
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
    const r = await fetch(`/api/admin/notifications?tab=${tab}`, { headers });
    if (r.ok) {
      const data = await r.json();
      setRows(data.rows ?? []);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [businessId, tab]);

  async function retryOne(id: string) {
    setRetrying(id);
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const r = await fetch(`/api/admin/notifications/${id}/retry`, {
      method: "POST",
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    const data = await r.json();
    setRetrying(null);
    if (r.ok) {
      notify({ title: "Queued for retry", message: "outbox-send will pick this up on the next cron run.", tone: "success" });
      load();
    } else {
      notify({ title: "Retry failed", message: data.error || "Could not requeue", tone: "error" });
    }
  }

  if (!isPrivileged) {
    return (
      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold mb-4" style={{ color: "var(--ck-text-strong)" }}>Notifications</h1>
        <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>
          You need MAIN_ADMIN access to view failed notifications.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: "var(--ck-text-strong)" }}>Failed Notifications</h1>
      </div>
      <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>
        WhatsApp messages in the outbox queue. Failed rows have exhausted their 2-attempt retry budget;
        the Retry button requeues them at PENDING for the next outbox-send cron tick (every 5 min).
      </p>

      <div className="flex gap-1 border-b" style={{ borderColor: "var(--ck-border)" }}>
        {[
          { key: "failed", label: "Failed" },
          { key: "waiting", label: "Waiting for window" },
          { key: "recent", label: "Recent sent" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as "failed" | "waiting" | "recent")}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key ? "border-emerald-600 text-emerald-700" : "border-transparent"
            }`}
            style={tab !== t.key ? { color: "var(--ck-text-muted)" } : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[20vh]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm py-8 text-center" style={{ color: "var(--ck-text-muted)" }}>
          {tab === "failed" ? "No failed messages — nice." : tab === "waiting" ? "No messages waiting for the 24h window to reopen." : "No recent sent messages."}
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div
              key={r.id}
              className="p-4 rounded-xl border"
              style={{ background: "var(--ck-surface)", borderColor: "var(--ck-border)" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium" style={{ color: "var(--ck-text-strong)" }}>{r.phone}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">{r.message_type}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      r.status === "FAILED" ? "bg-red-50 text-red-700"
                        : r.status === "EXPIRED" ? "bg-amber-50 text-amber-700"
                        : r.status === "WAITING_WINDOW" ? "bg-blue-50 text-blue-700"
                        : r.status === "SENT" ? "bg-emerald-50 text-emerald-700"
                        : "bg-slate-100 text-slate-700"
                    }`}>{r.status}</span>
                    <span className="text-xs" style={{ color: "var(--ck-text-muted)" }}>
                      {r.attempts} attempt{r.attempts === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs" style={{ color: "var(--ck-text-muted)" }}>
                    Queued {new Date(r.created_at).toLocaleString("en-ZA")}
                    {r.booking_id && (
                      <>
                        {" · "}
                        <a className="underline" href={`/bookings/${r.booking_id}`}>booking</a>
                      </>
                    )}
                  </div>
                  {r.error && (
                    <p className="mt-1 text-xs text-red-700 break-words"><span className="font-medium">Error:</span> {r.error}</p>
                  )}
                  {r.message_body && (
                    <details className="mt-2">
                      <summary className="text-xs cursor-pointer" style={{ color: "var(--ck-text-muted)" }}>
                        Show message body
                      </summary>
                      <pre className="mt-1 text-xs whitespace-pre-wrap" style={{ color: "var(--ck-text)" }}>{r.message_body}</pre>
                    </details>
                  )}
                </div>

                {FAILED_STATUSES.includes(r.status) && (
                  <div className="shrink-0">
                    <button
                      onClick={() => retryOne(r.id)}
                      disabled={retrying === r.id}
                      className="px-3 py-1.5 rounded text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {retrying === r.id ? "Queuing…" : "Retry"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
