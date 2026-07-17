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
      <div className="anim-fade-up max-w-3xl">
        <p className="ui-mono-label mb-2">Outbox queue</p>
        <h1 className="font-display text-[28px] font-semibold leading-none mb-4" style={{ color: "var(--ck-text-strong)" }}>Failed Notifications</h1>
        <div className="ui-card p-6">
          <div className="ui-empty">            <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Restricted area</p>
            <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>You need MAIN_ADMIN access to view failed notifications.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="anim-fade-up max-w-5xl space-y-6">
      <div>
        <p className="ui-mono-label mb-2">Outbox queue</p>
        <h1 className="font-display text-[28px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}>Failed Notifications</h1>
      </div>
      <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>
        WhatsApp messages in the outbox queue. Failed rows have exhausted their 2-attempt retry budget;
        the Retry button requeues them at PENDING for the next outbox-send cron tick (every 5 min).
      </p>

      <div className="ui-seg anim-fade-up anim-d1">
        {[
          { key: "failed", label: "Failed" },
          { key: "waiting", label: "Waiting for window" },
          { key: "recent", label: "Recent sent" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as "failed" | "waiting" | "recent")}
            className="ui-seg-item"
            data-active={tab === t.key}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3 py-2"><div className="ui-skeleton h-16 !rounded-xl" /><div className="ui-skeleton h-16 !rounded-xl" /><div className="ui-skeleton h-16 !rounded-xl" /></div>
      ) : rows.length === 0 ? (
        <div className="ui-empty anim-fade-up anim-d2">          <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>
            {tab === "failed" ? "No failed messages" : tab === "waiting" ? "Nothing waiting" : "No recent sends"}
          </p>
          <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>
            {tab === "failed" ? "Everything in the outbox went through." : tab === "waiting" ? "No messages waiting for the 24h window to reopen." : "No recent sent messages."}
          </p>
        </div>
      ) : (
        <div className="space-y-3 anim-fade-up anim-d2">
          {rows.map((r) => (
            <div key={r.id} className="ui-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium" style={{ color: "var(--ck-text-strong)" }}>{r.phone}</span>
                    <span className="ui-pill ui-pill-neutral">{r.message_type}</span>
                    <span className={`ui-status ${
                      r.status === "FAILED" ? "ui-pill-danger"
                        : r.status === "EXPIRED" ? "ui-pill-warning"
                        : r.status === "WAITING_WINDOW" ? "ui-pill-ocean"
                        : r.status === "SENT" ? "ui-pill-success"
                        : "ui-pill-neutral"
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
                        <a className="underline" style={{ color: "var(--ck-accent)" }} href={`/bookings/${r.booking_id}`}>booking</a>
                      </>
                    )}
                  </div>
                  {r.error && (
                    <p className="mt-1 text-xs break-words" style={{ color: "var(--ck-danger)" }}><span className="font-medium">Error:</span> {r.error}</p>
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
                      className="ui-btn ui-btn-primary !h-8 !px-3 text-xs disabled:opacity-50"
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
