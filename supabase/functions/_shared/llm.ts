// Unified LLM completion for the chat bots (WhatsApp + web chat).
//
// Primary:  OpenRouter — env OPENROUTER_API_KEY, model env OPENROUTER_MODEL
//           (default deepseek/deepseek-v4-flash). OpenAI-compatible, so the
//           model can be swapped without any code change.
// Thinking: OFF by default for every model. The bots answer short, grounded,
//           retrieval-backed questions under a 60-word cap; chain-of-thought
//           bills as output tokens and forces a 45s timeout floor, which is
//           the wrong trade for a chat reply. Set OPENROUTER_REASONING_EFFORT
//           (high|xhigh) to turn it back on globally.
// Fallback: Google Gemini — legacy path, env GEMINI_API_KEY + GEMINI_MODEL.
//
// Every completion is metered into llm_usage (business_id, call-site label,
// model, prompt/completion/cached tokens) — best-effort, never fails a reply.
//
// A dead provider must DEGRADE, never dead-end: failures log loudly
// (LLM_*_ERR) and fall through. The 2026-07 incident where a silently
// retired Gemini model froze both bots is the reason this module exists.

import { createServiceClient } from "./tenant.ts";
import { OPENROUTER_PROVIDER_PREFS } from "./openrouter-provider.ts";

export type LlmMessage = { role: "user" | "assistant"; content: string };

export type LlmOpts = {
  system: string;
  user?: string;            // single-turn shortcut
  messages?: LlmMessage[];  // multi-turn history (takes precedence over `user`)
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  label?: string;           // appears in logs and as llm_usage.fn
  reasoning?: "off" | "high" | "xhigh"; // per-call override of the env/default effort
  businessId?: string;      // tenant this call belongs to, for llm_usage
  userKey?: string;         // stable per-conversation id, sent as OpenRouter `user`
  quota?: boolean;          // customer-facing reply: counts toward the tenant's AI fair-use cap
};

// The call-site labels that count as customer-facing AI replies. Micro-
// classifiers (wa-intent, wa-date, web-date), the v2 shadow run and the
// internal admin help chat are deliberately excluded: they are not what the
// fair-use policy is about, and counting them would burn an operator's
// allowance on plumbing. Kept in sync with AI_QUOTA_FNS in
// app/lib/platform-billing.ts, which the admin usage page reads.
export const QUOTA_FNS = ["wa-faq", "wa-ask", "web-faq", "wa-v2"];

// Hard stop at this multiple of the tenant's included allowance. Between
// `included` and the ceiling the operator is simply billed for overage; past
// it the bot stops generating and the deterministic menu takes over.
const HARD_CEILING_MULTIPLE = 3;

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";
const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") || "deepseek/deepseek-v4-flash";
// "xhigh" is OpenRouter's maximum effort and maps to DeepSeek Think Max
// ("max" itself is not a valid OpenRouter effort value).
const REASONING_EFFORT = (Deno.env.get("OPENROUTER_REASONING_EFFORT") || "off")
  .toLowerCase()
  .replace(/^max$/, "xhigh"); // accept "max" — that's DeepSeek's marketing name for it

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";

// One client for the whole isolate; built on first use so a function that
// never calls the LLM pays nothing.
let usageDb: any = null;

// AI fair-use cap. Returns false only when the tenant is provably past their
// hard ceiling for the current calendar month.
//
// Fails OPEN, deliberately, and this is the opposite of every other gate in
// this change set. The money gates (checkout, marketing) fail closed because
// the cost of wrongly allowing is real revenue. Here the cost of wrongly
// allowing is a few rand of tokens, while the cost of wrongly denying is a
// paying operator's customer-facing bot going silent. A broken counter must
// never silence the bot.
//
// ponytail: counts on every quota'd reply — one indexed count per bot message,
// on the (business_id, created_at, fn) index. If that ever shows up in reply
// latency, cache the count per isolate for ~60s; do not cache longer, the
// ceiling is the point.
export async function withinAiQuota(businessId: string, label: string): Promise<boolean> {
  try {
    usageDb ??= createServiceClient();

    const { data: biz } = await usageDb
      .from("businesses").select("ai_included_replies").eq("id", businessId).maybeSingle();
    const included = Number(biz?.ai_included_replies ?? 0);
    if (!included || included <= 0) return true; // 0 or unset = uncapped

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const { count, error } = await usageDb
      .from("llm_usage")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .gte("created_at", monthStart.toISOString())
      .in("fn", QUOTA_FNS);
    if (error) {
      console.error("AI_QUOTA_COUNT_ERR business=" + businessId + " err=" + error.message);
      return true;
    }

    const used = count ?? 0;
    if (used < included * HARD_CEILING_MULTIPLE) return true;

    console.warn("AI_QUOTA_EXCEEDED business=" + businessId + " label=" + label +
      " used=" + used + " included=" + included + " ceiling=" + included * HARD_CEILING_MULTIPLE);
    return false;
  } catch (e) {
    console.error("AI_QUOTA_ERR: " + (e instanceof Error ? e.message : String(e)));
    return true;
  }
}

// Meter a completion into the shared llm_usage table (migration
// 20260803130000, also written by the v2 bot path in _shared/bot-llm.ts).
// business_id is NOT NULL there, so an untenanted call is skipped rather than
// rejected. Best-effort by design: metering must never cost a customer their
// reply.
async function recordUsage(opts: LlmOpts, usage: any) {
  if (!usage || !opts.businessId) return;
  try {
    usageDb ??= createServiceClient();
    await usageDb.from("llm_usage").insert({
      business_id: opts.businessId,
      fn: opts.label || "llm",
      model: OPENROUTER_MODEL,
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    });
  } catch (e) {
    console.error("LLM_USAGE_LOG_ERR: " + (e instanceof Error ? e.message : String(e)));
  }
}

export function llmAvailable(): boolean {
  return !!OPENROUTER_API_KEY || !!GEMINI_API_KEY;
}

export async function llmText(opts: LlmOpts): Promise<string | null> {
  const label = opts.label || "llm";
  const msgs: LlmMessage[] = opts.messages && opts.messages.length > 0
    ? opts.messages
    : [{ role: "user", content: opts.user || "" }];

  // Fair-use ceiling. Returning null here is not a new failure mode: every
  // caller already handles a null (a dead provider does the same thing) by
  // falling back to the deterministic menu, so the bot degrades to buttons
  // rather than going silent.
  if (opts.quota && opts.businessId && !(await withinAiQuota(opts.businessId, label))) {
    return null;
  }

  if (OPENROUTER_API_KEY) {
    const effort = opts.reasoning ?? REASONING_EFFORT;
    const thinking = effort === "high" || effort === "xhigh";
    // A thinking model needs wall-clock: a caller's snappy timeout would abort
    // mid-reasoning and silently degrade every reply to the Gemini fallback.
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + OPENROUTER_API_KEY,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://bookingtours.co.za",
          "X-Title": "BookingTours",
        },
        signal: AbortSignal.timeout(thinking ? Math.max(opts.timeoutMs ?? 8000, 45000) : (opts.timeoutMs ?? 8000)),
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          // OpenRouter returns reasoning in message.reasoning, never in
          // message.content, so replies stay clean with thinking on or off.
          reasoning: thinking ? { enabled: true, effort } : { enabled: false },
          messages: [{ role: "system", content: opts.system }, ...msgs],
          max_tokens: opts.maxTokens ?? 150,
          temperature: opts.temperature ?? 0.7,
          // OpenRouter has no session/sticky-routing field — `user` is a
          // stable end-user identifier used for abuse detection. It does NOT
          // control prompt-cache affinity; DeepSeek caching is automatic and
          // keyed on the prompt prefix.
          ...(opts.userKey ? { user: opts.userKey } : {}),
          // POPIA provider constraints (all envs unset = no-op); see openrouter-provider.ts
          ...(OPENROUTER_PROVIDER_PREFS ? { provider: OPENROUTER_PROVIDER_PREFS } : {}),
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        console.error("LLM_OPENROUTER_ERR " + label + " status:" + r.status + " " + JSON.stringify(d?.error || d).substring(0, 200));
      } else {
        await recordUsage(opts, d?.usage);
        const text = d?.choices?.[0]?.message?.content;
        if (typeof text === "string" && text.trim()) return text.trim();
        console.error("LLM_OPENROUTER_EMPTY " + label);
      }
    } catch (e) {
      console.error("LLM_OPENROUTER_ERR " + label + ": " + (e instanceof Error ? e.message : String(e)));
    }
  }

  if (GEMINI_API_KEY) {
    try {
      const contents = msgs.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent?key=" + GEMINI_API_KEY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
        body: JSON.stringify({
          system_instruction: { parts: [{ text: opts.system }] },
          contents,
          generationConfig: { temperature: opts.temperature ?? 0.7, maxOutputTokens: opts.maxTokens ?? 150 },
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        console.error("LLM_GEMINI_ERR " + label + " status:" + r.status + " " + JSON.stringify(d?.error || d).substring(0, 200));
        return null;
      }
      const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text === "string" && text.trim()) return text.trim();
      console.error("LLM_GEMINI_EMPTY " + label);
      return null;
    } catch (e) {
      console.error("LLM_GEMINI_ERR " + label + ": " + (e instanceof Error ? e.message : String(e)));
      return null;
    }
  }

  return null;
}
