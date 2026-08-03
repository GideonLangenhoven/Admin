"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useBusinessContext } from "../../components/BusinessContext";
import { AI_QUOTA_FNS, AI_HARD_CEILING_MULTIPLE, computeAiOverage } from "../lib/platform-billing";

// Live per-tenant AI usage, read straight from llm_usage (tenant-scoped by RLS
// policy llm_usage_auth_select — an operator sees their own rows and no one
// else's, and cannot write any).
//
// "Live" here means polled, not streamed: llm_usage has no realtime
// publication and a 30-second refresh is well inside the resolution anyone
// needs for a monthly allowance.

const REFRESH_MS = 30_000;

type Row = { fn: string; model: string; prompt_tokens: number; completion_tokens: number; cached_tokens: number; created_at: string };

const SURFACE_LABELS: Record<string, string> = {
  "wa-faq": "WhatsApp bot",
  "wa-ask": "WhatsApp questions",
  "web-faq": "Website chat",
  "wa-v2": "WhatsApp bot (v2)",
  "wa-v2-shadow": "v2 shadow (not billed)",
  "wa-intent": "Intent classifier (not billed)",
  "wa-date": "Date parser (not billed)",
  "web-date": "Date parser (not billed)",
  "admin-help": "Admin help chat (not billed)",
};

function monthStartIso() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function AiUsage() {
  const { businessId } = useBusinessContext();
  const [rows, setRows] = useState<Row[]>([]);
  const [included, setIncluded] = useState(0);
  const [rate, setRate] = useState(0);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState("");

  const load = useCallback(async () => {
    if (!businessId) return;
    const [usageRes, bizRes] = await Promise.all([
      supabase.from("llm_usage")
        .select("fn, model, prompt_tokens, completion_tokens, cached_tokens, created_at")
        .eq("business_id", businessId)
        .gte("created_at", monthStartIso())
        .order("created_at", { ascending: false })
        .limit(5000),
      supabase.from("businesses")
        .select("ai_included_replies, ai_overage_rate_zar")
        .eq("id", businessId)
        .maybeSingle(),
    ]);
    setRows((usageRes.data || []) as Row[]);
    setIncluded(Number(bizRes.data?.ai_included_replies || 0));
    setRate(Number(bizRes.data?.ai_overage_rate_zar || 0));
    setUpdatedAt(new Date().toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  if (loading) {
    return <div className="space-y-4 py-2"><div className="ui-skeleton h-8 w-48" /><div className="ui-skeleton h-[140px] !rounded-2xl" /><div className="ui-skeleton h-[320px] !rounded-2xl" /></div>;
  }

  const billable = rows.filter((r) => AI_QUOTA_FNS.includes(r.fn));
  const replies = billable.length;
  const ceiling = included * AI_HARD_CEILING_MULTIPLE;
  const { overageReplies, overageZar } = computeAiOverage(replies, included, rate);
  const pct = included > 0 ? Math.min(100, Math.round((replies / included) * 100)) : 0;

  const promptTokens = rows.reduce((n, r) => n + Number(r.prompt_tokens || 0), 0);
  const completionTokens = rows.reduce((n, r) => n + Number(r.completion_tokens || 0), 0);
  const cachedTokens = rows.reduce((n, r) => n + Number(r.cached_tokens || 0), 0);
  // Share of prompt tokens served from the provider's prefix cache. Low is not
  // a fault, it just means conversations are short or spread out.
  const cacheHitPct = promptTokens > 0 ? Math.round((cachedTokens / promptTokens) * 100) : 0;

  const bySurface = new Map<string, { calls: number; billable: boolean; tokens: number }>();
  for (const r of rows) {
    const cur = bySurface.get(r.fn) || { calls: 0, billable: AI_QUOTA_FNS.includes(r.fn), tokens: 0 };
    cur.calls++;
    cur.tokens += Number(r.prompt_tokens || 0) + Number(r.completion_tokens || 0);
    bySurface.set(r.fn, cur);
  }
  const surfaces = [...bySurface.entries()].sort((a, b) => b[1].calls - a[1].calls);

  const overCeiling = included > 0 && replies >= ceiling;
  const nearLimit = included > 0 && !overCeiling && replies >= included;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="anim-fade-up flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="ui-mono-label mb-2">Growth · AI Usage</p>
          <h2 className="font-display text-[28px] font-semibold leading-none" style={{ color: "var(--ck-text-strong)" }}>AI Assistant Usage</h2>
          <p className="mt-2 text-[13px]" style={{ color: "var(--ck-text-muted)" }}>
            Customer-facing bot replies this month. Updates every 30 seconds{updatedAt ? " · last checked " + updatedAt : ""}.
          </p>
        </div>
      </div>

      {overCeiling && (
        <div className="ui-card anim-fade-up p-4" style={{ borderColor: "var(--ck-danger, #b3261e)" }}>
          <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Fair-use ceiling reached</p>
          <p className="mt-1 text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>
            The assistant has paused generating new replies for this month and customers now see the menu options instead.
            Existing bookings, reminders and payments are unaffected. Talk to us to raise your allowance.
          </p>
        </div>
      )}
      {nearLimit && (
        <div className="ui-card anim-fade-up p-4">
          <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>Past your included replies</p>
          <p className="mt-1 text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>
            The assistant keeps answering. Replies beyond your allowance are billed at R{rate.toFixed(2)} each, and it pauses at {ceiling.toLocaleString()}.
          </p>
        </div>
      )}

      <div className="anim-fade-up anim-d1 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="ui-card p-4">
          <div className="mb-2 flex items-center gap-2.5"><span className="ui-mono-label !text-[10px]">Replies</span></div>
          <p className="font-display text-[28px] font-semibold leading-none tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{replies.toLocaleString()}</p>
          <p className="mt-1 text-[12px]" style={{ color: "var(--ck-text-muted)" }}>
            {included > 0 ? "of " + included.toLocaleString() + " included" : "no cap set"}
          </p>
        </div>
        <div className="ui-card p-4">
          <div className="mb-2 flex items-center gap-2.5"><span className="ui-mono-label !text-[10px]">Allowance used</span></div>
          <p className="font-display text-[28px] font-semibold leading-none tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{included > 0 ? pct + "%" : "—"}</p>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--ck-border, rgba(0,0,0,0.08))" }}>
            <div className="h-full rounded-full" style={{ width: pct + "%", background: overCeiling || nearLimit ? "var(--ck-danger, #b3261e)" : "var(--ck-accent, #00a86b)" }} />
          </div>
        </div>
        <div className="ui-card p-4">
          <div className="mb-2 flex items-center gap-2.5"><span className="ui-mono-label !text-[10px]">Overage</span></div>
          <p className="font-display text-[28px] font-semibold leading-none tabular-nums" style={{ color: "var(--ck-text-strong)" }}>R{overageZar.toFixed(2)}</p>
          <p className="mt-1 text-[12px]" style={{ color: "var(--ck-text-muted)" }}>{overageReplies.toLocaleString()} replies over</p>
        </div>
        <div className="ui-card p-4">
          <div className="mb-2 flex items-center gap-2.5"><span className="ui-mono-label !text-[10px]">Cache hits</span></div>
          <p className="font-display text-[28px] font-semibold leading-none tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{cacheHitPct}%</p>
          <p className="mt-1 text-[12px]" style={{ color: "var(--ck-text-muted)" }}>{(promptTokens + completionTokens).toLocaleString()} tokens</p>
        </div>
      </div>

      <div className="ui-card anim-fade-up anim-d2">
        {surfaces.length === 0 ? (
          <div className="ui-empty">
            <p className="text-[13.5px] font-semibold" style={{ color: "var(--ck-text-strong)" }}>No AI activity yet this month</p>
            <p className="text-[12.5px]" style={{ color: "var(--ck-text-muted)" }}>Replies from the WhatsApp bot and website chat will appear here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left"><span className="ui-mono-label !text-[10px]">Surface</span></th>
                  <th className="px-4 py-3 text-right"><span className="ui-mono-label !text-[10px]">Calls</span></th>
                  <th className="px-4 py-3 text-right"><span className="ui-mono-label !text-[10px]">Tokens</span></th>
                  <th className="px-4 py-3 text-right"><span className="ui-mono-label !text-[10px]">Counts to allowance</span></th>
                </tr>
              </thead>
              <tbody>
                {surfaces.map(([fn, s]) => (
                  <tr key={fn}>
                    <td className="px-4 py-3" style={{ color: "var(--ck-text-strong)" }}>{SURFACE_LABELS[fn] || fn}</td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: "var(--ck-text-strong)" }}>{s.calls.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: "var(--ck-text-muted)" }}>{s.tokens.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right" style={{ color: "var(--ck-text-muted)" }}>{s.billable ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
