"use client";
import { useEffect, useState, useRef } from "react";
import { useBusinessContext } from "../../../components/BusinessContext";
import { getAuthHeaders } from "../../lib/admin-auth";
import { notify } from "../../lib/app-notify";
import {
  DAY_KEYS,
  DAY_LABELS,
  type BusinessHours,
  type DayBusinessHours,
  type DayKey,
  isCompleteBusinessHours,
  normalizeBusinessHours,
} from "../../lib/business-hours";
import LiveStatusBadge from "./LiveStatusBadge";
import ModeOption from "./ModeOption";

type BotModeState = {
  mode: string;
  currentlyActive: boolean;
  businessHours: any;
  timezone: string;
};

export default function WhatsAppBotSection() {
  const { businessId, role } = useBusinessContext();
  const isPrivileged = role === "MAIN_ADMIN" || role === "SUPER_ADMIN";
  const [state, setState] = useState<BotModeState | null>(null);
  const [selectedMode, setSelectedMode] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [hoursDraft, setHoursDraft] = useState<BusinessHours>(() => normalizeBusinessHours(null));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hoursDirtyRef = useRef(false);

  async function load() {
    const headers = await getAuthHeaders();
    const r = await fetch("/api/admin/whatsapp/bot-mode", { headers });
    if (r.ok) {
      const data = await r.json();
      setState(data);
      setSelectedMode(data.mode);
      if (!hoursDirtyRef.current) {
        setHoursDraft(normalizeBusinessHours(data.businessHours));
      }
      setLoadError("");
    } else if (r.status === 401) {
      setLoadError("sign-in");
    } else {
      setLoadError("failed");
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, 60_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [businessId]);

  async function save() {
    if (!isPrivileged || !state || (selectedMode === state.mode && !hasHoursChanged)) return;
    setSaving(true);
    const r = await fetch("/api/admin/whatsapp/bot-mode", {
      method: "PUT",
      headers: await getAuthHeaders(),
      body: JSON.stringify({ mode: selectedMode, businessHours: hoursDraft }),
    });
    if (r.ok) {
      const data = await r.json();
      hoursDirtyRef.current = false;
      setState(prev => prev ? { ...prev, mode: data.mode, currentlyActive: data.currentlyActive, businessHours: data.businessHours } : prev);
      setHoursDraft(normalizeBusinessHours(data.businessHours));
      notify({ title: "Saved", message: "WhatsApp auto-reply settings updated.", tone: "success" });
    } else {
      const err = await r.json();
      notify({ title: "Something went wrong", message: err.error || "Could not save. Try again.", tone: "error" });
    }
    setSaving(false);
  }

  function updateDay(day: DayKey, patch: Partial<DayBusinessHours>) {
    hoursDirtyRef.current = true;
    setHoursDraft(prev => ({ ...prev, [day]: { ...prev[day], ...patch } }));
  }

  if (loading) {
    return (
      <div className="p-6 rounded-xl border animate-pulse" style={{ background: "var(--ck-surface)", borderColor: "var(--ck-border)" }}>
        <div className="h-5 w-48 rounded bg-[var(--ck-border-subtle)]" />
        <div className="h-4 w-72 mt-2 rounded bg-[var(--ck-border-subtle)]" />
      </div>
    );
  }

  if (loadError || !state) {
    return (
      <section className="p-6 rounded-xl border" style={{ background: "var(--ck-surface)", borderColor: "var(--ck-border)" }}>
        <p className="text-sm" style={{ color: "var(--ck-text-muted)" }}>
          {loadError === "sign-in"
            ? "Please sign out and sign back in to manage WhatsApp auto-replies."
            : "Could not load WhatsApp settings. Try refreshing the page."}
        </p>
        <button onClick={() => { setLoading(true); load(); }} className="mt-3 text-sm text-emerald-600 hover:underline">
          Try again
        </button>
      </section>
    );
  }

  const hasSavedBusinessHours = isCompleteBusinessHours(state.businessHours);
  const savedHours = normalizeBusinessHours(state.businessHours);
  const hasHoursChanged = !hasSavedBusinessHours || JSON.stringify(hoursDraft) !== JSON.stringify(savedHours);
  const canSave = isPrivileged && !saving && (selectedMode !== state.mode || hasHoursChanged);
  const businessHoursSummary = hasSavedBusinessHours
    ? "the support hours below"
    : "business hours (not yet configured)";

  return (
    <section className="p-6 rounded-xl border" style={{ background: "var(--ck-surface)", borderColor: "var(--ck-border)" }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold" style={{ color: "var(--ck-text-strong)" }}>WhatsApp auto-reply</h3>
          <p className="mt-1 text-sm" style={{ color: "var(--ck-text-muted)" }}>
            Choose when the AI assistant replies to incoming WhatsApp messages.
          </p>
        </div>
        <LiveStatusBadge active={state.currentlyActive} mode={state.mode} />
      </div>

      <div className="mt-6 space-y-2">
        <ModeOption
          value="ALWAYS_ON"
          checked={selectedMode === "ALWAYS_ON"}
          onChange={setSelectedMode}
          title="Always on"
          description="The assistant answers FAQs instantly, 24/7. Complex questions still go to your inbox."
          disabled={!isPrivileged}
        />
        <ModeOption
          value="OUTSIDE_HOURS"
          checked={selectedMode === "OUTSIDE_HOURS"}
          onChange={setSelectedMode}
          title="Outside business hours only"
          description={`The assistant only replies when you're closed. Inside ${businessHoursSummary}, all messages go straight to your inbox.`}
          disabled={!isPrivileged}
        />
        <ModeOption
          value="OFF"
          checked={selectedMode === "OFF"}
          onChange={setSelectedMode}
          title="Off"
          description="Every WhatsApp message goes to your inbox. No AI replies. Works like a normal WhatsApp inbox."
          disabled={!isPrivileged}
        />
      </div>

      <div className="mt-6 rounded-xl border p-4" style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg-subtle)" }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold" style={{ color: "var(--ck-text-strong)" }}>WhatsApp support hours</h4>
            <p className="mt-1 text-xs" style={{ color: "var(--ck-text-muted)" }}>
              When set to outside-hours mode, the assistant replies outside these times.
            </p>
          </div>
          <span className="rounded-full px-2.5 py-1 text-[11px] font-medium" style={{ background: "rgba(16, 185, 129, 0.12)", color: "var(--ck-accent)" }}>
            {state.timezone || "UTC"}
          </span>
        </div>

        <div className="mt-4 space-y-2">
          {DAY_KEYS.map(day => {
            const hours = hoursDraft[day];
            return (
              <div key={day} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(110px,1fr)_auto_auto_auto]" style={{ borderColor: "var(--ck-border-subtle)", background: "var(--ck-surface)" }}>
                <label className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--ck-text-strong)" }}>
                  <input
                    type="checkbox"
                    checked={!hours.closed}
                    disabled={!isPrivileged}
                    onChange={(e) => updateDay(day, { closed: !e.target.checked })}
                    className="accent-emerald-600"
                  />
                  {DAY_LABELS[day]}
                </label>
                <label className="grid gap-1 text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--ck-text-muted)" }}>
                  Opens
                  <input
                    type="time"
                    value={hours.open}
                    disabled={!isPrivileged || hours.closed}
                    onChange={(e) => updateDay(day, { open: e.target.value })}
                    className="h-9 rounded-lg border px-2 text-sm normal-case"
                    style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
                  />
                </label>
                <label className="grid gap-1 text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--ck-text-muted)" }}>
                  Closes
                  <input
                    type="time"
                    value={hours.close}
                    disabled={!isPrivileged || hours.closed}
                    onChange={(e) => updateDay(day, { close: e.target.value })}
                    className="h-9 rounded-lg border px-2 text-sm normal-case"
                    style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}
                  />
                </label>
                <div className="flex items-end text-xs" style={{ color: "var(--ck-text-muted)" }}>
                  {hours.closed ? "Closed all day" : `${hours.open} to ${hours.close}`}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {isPrivileged ? (
        <button
          onClick={save}
          disabled={!canSave}
          className="mt-6 rounded-xl px-6 py-3 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
      ) : (
        <p className="mt-4 text-xs" style={{ color: "var(--ck-text-muted)" }}>
          Only the main admin can change this setting.
        </p>
      )}

      {state.mode === "OUTSIDE_HOURS" && hasSavedBusinessHours && (
        <p className="mt-4 text-xs" style={{ color: "var(--ck-text-muted)" }}>
          The assistant uses these support hours to decide when to reply.
        </p>
      )}
    </section>
  );
}
