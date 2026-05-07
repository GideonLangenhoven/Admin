"use client";
import { useEffect, useState, useRef } from "react";
import { useBusinessContext } from "../../../components/BusinessContext";
import { getAuthHeaders } from "../../lib/admin-auth";
import { notify } from "../../lib/app-notify";
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
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    const headers = await getAuthHeaders();
    const r = await fetch("/api/admin/whatsapp/bot-mode", { headers });
    if (r.ok) {
      const data = await r.json();
      setState(data);
      setSelectedMode(data.mode);
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
    if (!isPrivileged || selectedMode === state?.mode) return;
    setSaving(true);
    const r = await fetch("/api/admin/whatsapp/bot-mode", {
      method: "PUT",
      headers: await getAuthHeaders(),
      body: JSON.stringify({ mode: selectedMode }),
    });
    if (r.ok) {
      const data = await r.json();
      setState(prev => prev ? { ...prev, mode: data.mode, currentlyActive: data.currentlyActive } : prev);
      notify({ title: "Saved", message: `WhatsApp bot mode set to ${data.mode.replace("_", " ").toLowerCase()}`, tone: "success" });
    } else {
      const err = await r.json();
      notify({ title: "Something went wrong", message: err.error || "Could not save. Try again.", tone: "error" });
    }
    setSaving(false);
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

  const businessHoursSummary = state.businessHours
    ? "your configured business hours"
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

      {isPrivileged ? (
        <button
          onClick={save}
          disabled={selectedMode === state.mode || saving}
          className="mt-6 rounded-xl px-6 py-3 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
      ) : (
        <p className="mt-4 text-xs" style={{ color: "var(--ck-text-muted)" }}>
          Only the main admin can change this setting.
        </p>
      )}

      {selectedMode === "OUTSIDE_HOURS" && !state.businessHours && (
        <p className="mt-4 text-xs text-red-600">
          You must configure business hours in the General tab before using this mode.
        </p>
      )}

      {state.mode === "OUTSIDE_HOURS" && state.businessHours && (
        <p className="mt-4 text-xs" style={{ color: "var(--ck-text-muted)" }}>
          Tip: your business hours are managed in the General tab. The assistant uses those to decide when to reply.
        </p>
      )}
    </section>
  );
}
