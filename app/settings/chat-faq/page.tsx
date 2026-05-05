"use client";
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useBusinessContext } from "../../../components/BusinessContext";
import { notify } from "../../lib/app-notify";
import { CHAT_INTENTS, INTENT_LABELS, type ChatIntent } from "../../lib/intent-types";

type FaqEntry = {
  id: string;
  intent: string;
  question_pattern: string;
  match_keywords: string[];
  answer: string;
  enabled: boolean;
  use_count: number;
  last_used_at: string | null;
};

export default function ChatFaqPage() {
  const { businessId } = useBusinessContext();
  const [entries, setEntries] = useState<FaqEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ intent: "BOOKING_QUESTION", question_pattern: "", keywords: "", answer: "" });
  const [saving, setSaving] = useState(false);

  async function authHeaders() {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }

  async function load() {
    setLoading(true);
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const r = await fetch("/api/admin/chat-faq", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (r.ok) {
      const data = await r.json();
      setEntries(data.entries ?? []);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [businessId]);

  async function handleSave() {
    if (!form.question_pattern || !form.keywords || !form.answer) {
      notify({ title: "Missing fields", message: "All fields are required", tone: "error" });
      return;
    }
    setSaving(true);
    const keywords = form.keywords.split(",").map(k => k.trim()).filter(Boolean);

    if (editId) {
      const r = await fetch(`/api/admin/chat-faq/${editId}`, {
        method: "PATCH",
        headers: await authHeaders(),
        body: JSON.stringify({ intent: form.intent, question_pattern: form.question_pattern, match_keywords: keywords, answer: form.answer }),
      });
      if (r.ok) { notify({ title: "Updated", message: "FAQ entry updated", tone: "success" }); }
      else { notify({ title: "Error", message: (await r.json()).error, tone: "error" }); }
    } else {
      const r = await fetch("/api/admin/chat-faq", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ intent: form.intent, question_pattern: form.question_pattern, match_keywords: keywords, answer: form.answer }),
      });
      if (r.ok) { notify({ title: "Created", message: "FAQ entry added", tone: "success" }); }
      else { notify({ title: "Error", message: (await r.json()).error, tone: "error" }); }
    }
    setSaving(false);
    setShowAdd(false);
    setEditId(null);
    setForm({ intent: "BOOKING_QUESTION", question_pattern: "", keywords: "", answer: "" });
    load();
  }

  async function toggleEnabled(entry: FaqEntry) {
    const r = await fetch(`/api/admin/chat-faq/${entry.id}`, {
      method: "PATCH",
      headers: await authHeaders(),
      body: JSON.stringify({ enabled: !entry.enabled }),
    });
    if (r.ok) load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this FAQ entry?")) return;
    const r = await fetch(`/api/admin/chat-faq/${id}`, { method: "DELETE", headers: await authHeaders() });
    if (r.ok) load();
  }

  function startEdit(entry: FaqEntry) {
    setForm({ intent: entry.intent, question_pattern: entry.question_pattern, keywords: entry.match_keywords.join(", "), answer: entry.answer });
    setEditId(entry.id);
    setShowAdd(true);
  }

  const grouped = CHAT_INTENTS.reduce((acc, intent) => {
    acc[intent] = entries.filter(e => e.intent === intent);
    return acc;
  }, {} as Record<string, FaqEntry[]>);

  if (loading) {
    return <div className="flex items-center justify-center min-h-[50vh]"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" /></div>;
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--ck-text-strong)" }}>Chat FAQ Bank</h1>
          <p className="text-sm mt-1" style={{ color: "var(--ck-text-muted)" }}>
            Auto-reply entries matched by intent + keywords. High-confidence FAQ matches are sent instantly to customers.
          </p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setEditId(null); setForm({ intent: "BOOKING_QUESTION", question_pattern: "", keywords: "", answer: "" }); }}
          className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
        >
          + Add entry
        </button>
      </div>

      {/* Add/Edit form */}
      {showAdd && (
        <div className="p-4 rounded-xl border space-y-3" style={{ background: "var(--ck-surface)", borderColor: "var(--ck-border)" }}>
          <h3 className="font-semibold text-sm" style={{ color: "var(--ck-text-strong)" }}>{editId ? "Edit" : "New"} FAQ Entry</h3>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs" style={{ color: "var(--ck-text-muted)" }}>Intent</span>
              <select value={form.intent} onChange={e => setForm({ ...form, intent: e.target.value })}
                className="mt-1 w-full rounded border px-2 py-1.5 text-sm" style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }}>
                {CHAT_INTENTS.map(i => <option key={i} value={i}>{INTENT_LABELS[i]}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs" style={{ color: "var(--ck-text-muted)" }}>Label</span>
              <input value={form.question_pattern} onChange={e => setForm({ ...form, question_pattern: e.target.value })}
                placeholder="e.g. What time does the tour start?" className="mt-1 w-full rounded border px-2 py-1.5 text-sm" style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }} />
            </label>
          </div>
          <label className="block">
            <span className="text-xs" style={{ color: "var(--ck-text-muted)" }}>Keywords (comma-separated)</span>
            <input value={form.keywords} onChange={e => setForm({ ...form, keywords: e.target.value })}
              placeholder="time, start, when, schedule" className="w-full rounded border px-2 py-1.5 text-sm" style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }} />
          </label>
          <label className="block">
            <span className="text-xs" style={{ color: "var(--ck-text-muted)" }}>Answer (max 1000 chars)</span>
            <textarea value={form.answer} onChange={e => setForm({ ...form, answer: e.target.value.slice(0, 1000) })} rows={3}
              placeholder="Our tours depart at 06:00 and 08:30 daily..." className="w-full rounded border px-2 py-1.5 text-sm" style={{ borderColor: "var(--ck-border)", background: "var(--ck-bg)", color: "var(--ck-text)" }} />
          </label>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setShowAdd(false); setEditId(null); }} className="px-3 py-1.5 rounded text-sm" style={{ color: "var(--ck-text)" }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 rounded bg-emerald-600 text-white text-sm font-medium disabled:opacity-50">
              {saving ? "Saving..." : editId ? "Update" : "Create"}
            </button>
          </div>
        </div>
      )}

      {/* Entries by intent */}
      {CHAT_INTENTS.filter(i => grouped[i].length > 0).map(intent => (
        <section key={intent}>
          <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--ck-text-strong)" }}>{INTENT_LABELS[intent as ChatIntent]} ({grouped[intent].length})</h2>
          <div className="space-y-2">
            {grouped[intent].map(entry => (
              <div key={entry.id} className={`p-3 rounded-lg border flex items-start gap-3 ${!entry.enabled ? "opacity-50" : ""}`}
                style={{ background: "var(--ck-surface)", borderColor: "var(--ck-border)" }}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--ck-text-strong)" }}>{entry.question_pattern}</p>
                  <p className="text-xs mt-0.5 truncate" style={{ color: "var(--ck-text-muted)" }}>Keywords: {entry.match_keywords.join(", ")}</p>
                  <p className="text-xs mt-1 line-clamp-2" style={{ color: "var(--ck-text)" }}>{entry.answer}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs" style={{ color: "var(--ck-text-muted)" }}>{entry.use_count}x</span>
                  <button onClick={() => toggleEnabled(entry)} className="text-xs px-2 py-1 rounded border" style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}>
                    {entry.enabled ? "Disable" : "Enable"}
                  </button>
                  <button onClick={() => startEdit(entry)} className="text-xs px-2 py-1 rounded border" style={{ borderColor: "var(--ck-border)", color: "var(--ck-text)" }}>Edit</button>
                  <button onClick={() => handleDelete(entry.id)} className="text-xs px-2 py-1 rounded text-red-600">Del</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {entries.length === 0 && (
        <p className="text-sm text-center py-8" style={{ color: "var(--ck-text-muted)" }}>
          No FAQ entries yet. Add entries to enable auto-replies for common questions.
        </p>
      )}
    </div>
  );
}
