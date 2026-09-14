// v2 bot completion: JSON contract, non-thinking, prefix-cache friendly.
//
// Primary:  OpenRouter — env OPENROUTER_BOT_MODEL (default deepseek/deepseek-v4-flash,
//           $0.14/M in, $0.28/M out, cached reads 0.1x). reasoning disabled: the
//           contract's "plan" field replaces chain-of-thought on this bounded task.
//           DeepSeek prompt caching is automatic and keyed on the prompt prefix —
//           the byte-stable block ordering (invariants + BLOCK_A + blockB before
//           any per-request content) is what earns the cache hits. OpenRouter has
//           no session/sticky-routing field; `user` is a stable end-user
//           identifier (abuse detection), sent for parity with _shared/llm.ts.
// Contract: the model returns ONE JSON object (see BLOCK_A OUTPUT CONTRACT).
//           We do NOT send response_format — OpenRouter structured outputs are
//           json_schema-typed with per-provider support that varies for DeepSeek;
//           a rejecting provider would error the whole call. The contract is
//           prompt-enforced and validated here, with one corrective retry.
// Fallback: Gemini (same degrade doctrine as _shared/llm.ts — a dead provider
//           must never dead-end the bot), with native JSON response_mime_type.
//
// Only `out.message` may ever reach a customer. `plan` is internal; a leaked
// plan is a sev-2 (see wa-webhook dispatch, which sends out.message alone).

import { OPENROUTER_PROVIDER_PREFS } from "./openrouter-provider.ts";

export type BotAction = "reply" | "silent" | "flow" | "escalate" | "template";

export type BotOut = {
  plan: string;
  action: BotAction;
  message: string | null;
  flow_id: "booking_capture" | "availability_check" | null;
  template_id: string | null;
  template_params: Record<string, string> | null;
  escalation_reason: string | null;
  intent: string;
  grounded: boolean;
};

export type BotUsage = {
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
};

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";
const BOT_MODEL = Deno.env.get("OPENROUTER_BOT_MODEL") || "deepseek/deepseek-v4-flash";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";

const ACTIONS: BotAction[] = ["reply", "silent", "flow", "escalate", "template"];

// Parse + shape-check the model's JSON. Returns null on anything unusable.
export function validateBotOut(raw: string): BotOut | null {
  let text = String(raw || "").trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let o: any;
  try { o = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;

  const action = String(o.action || "").toLowerCase() as BotAction;
  if (!ACTIONS.includes(action)) return null;

  let message: string | null = typeof o.message === "string" ? o.message.trim() : null;
  if (action === "silent" || action === "template") message = null;
  if (action === "reply" && !message) return null;
  if (message && message.length > 4000) message = message.slice(0, 4000); // WA hard limit safety
  // A plan leaking into the customer message means the model ignored the
  // contract shape — treat as invalid rather than sending it.
  if (message && /"plan"\s*:/.test(message)) return null;

  const flowId = o.flow_id === "booking_capture" || o.flow_id === "availability_check" ? o.flow_id : null;
  const params = o.template_params && typeof o.template_params === "object" && !Array.isArray(o.template_params)
    ? Object.fromEntries(Object.entries(o.template_params).map(([k, v]) => [k, String(v)]))
    : null;

  return {
    plan: typeof o.plan === "string" ? o.plan : "",
    action,
    message,
    flow_id: flowId,
    template_id: typeof o.template_id === "string" && o.template_id ? o.template_id : null,
    template_params: params,
    escalation_reason: typeof o.escalation_reason === "string" && o.escalation_reason ? o.escalation_reason : null,
    intent: typeof o.intent === "string" && o.intent ? o.intent.toLowerCase() : "other",
    grounded: o.grounded === true,
  };
}

type Msg = { role: "user" | "assistant"; content: string };

async function callOpenRouter(
  system: string,
  msgs: Msg[],
  userKey: string,
  label: string,
  timeoutMs: number,
): Promise<{ text: string; usage: BotUsage } | null> {
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + OPENROUTER_API_KEY,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://bookingtours.co.za",
        "X-Title": "BookingTours",
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: BOT_MODEL,
        reasoning: { enabled: false },
        user: userKey,
        messages: [{ role: "system", content: system }, ...msgs],
        max_tokens: 400,
        temperature: 0.2,
        // POPIA provider constraints (all envs unset = no-op); see openrouter-provider.ts
        ...(OPENROUTER_PROVIDER_PREFS ? { provider: OPENROUTER_PROVIDER_PREFS } : {}),
      }),
    });
    const d = await r.json();
    if (!r.ok) {
      console.error("BOT_LLM_OR_ERR " + label + " status:" + r.status + " " + JSON.stringify(d?.error || d).substring(0, 200));
      return null;
    }
    const text = d?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) { console.error("BOT_LLM_OR_EMPTY " + label); return null; }
    const u = d?.usage || {};
    return {
      text: text.trim(),
      usage: {
        model: BOT_MODEL,
        promptTokens: Number(u.prompt_tokens || 0),
        completionTokens: Number(u.completion_tokens || 0),
        cachedTokens: Number(u.prompt_tokens_details?.cached_tokens || 0),
      },
    };
  } catch (e) {
    console.error("BOT_LLM_OR_ERR " + label + ": " + (e instanceof Error ? e.message : String(e)));
    return null;
  }
}

async function callGeminiJson(system: string, msgs: Msg[], label: string, timeoutMs: number): Promise<{ text: string; usage: BotUsage } | null> {
  try {
    const contents = msgs.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent?key=" + GEMINI_API_KEY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { temperature: 0.2, maxOutputTokens: 400, responseMimeType: "application/json" },
      }),
    });
    const d = await r.json();
    if (!r.ok) { console.error("BOT_LLM_GEM_ERR " + label + " status:" + r.status); return null; }
    const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string" || !text.trim()) { console.error("BOT_LLM_GEM_EMPTY " + label); return null; }
    const um = d?.usageMetadata || {};
    return {
      text: text.trim(),
      usage: {
        model: GEMINI_MODEL,
        promptTokens: Number(um.promptTokenCount || 0),
        completionTokens: Number(um.candidatesTokenCount || 0),
        cachedTokens: Number(um.cachedContentTokenCount || 0),
      },
    };
  } catch (e) {
    console.error("BOT_LLM_GEM_ERR " + label + ": " + (e instanceof Error ? e.message : String(e)));
    return null;
  }
}

export async function botReply(opts: {
  system: string;
  user: string;
  history?: Msg[];
  userKey: string;
  label: string;
  timeoutMs?: number;
}): Promise<{ out: BotOut; usage: BotUsage } | null> {
  const timeoutMs = opts.timeoutMs ?? 15000; // non-thinking, but 400 JSON tokens
  const msgs: Msg[] = [...(opts.history || []), { role: "user", content: opts.user }];

  if (OPENROUTER_API_KEY) {
    const first = await callOpenRouter(opts.system, msgs, opts.userKey, opts.label, timeoutMs);
    if (first) {
      const out = validateBotOut(first.text);
      if (out) return { out, usage: first.usage };
      // One corrective retry, per the contract's own error protocol.
      const retryMsgs: Msg[] = [...msgs, { role: "assistant", content: first.text }, { role: "user", content: "Return only valid JSON matching the contract." }];
      const second = await callOpenRouter(opts.system, retryMsgs, opts.userKey, opts.label + "-retry", timeoutMs);
      if (second) {
        const out2 = validateBotOut(second.text);
        if (out2) return { out: out2, usage: second.usage };
      }
      console.error("BOT_LLM_INVALID_JSON " + opts.label);
    }
  }

  if (GEMINI_API_KEY) {
    const g = await callGeminiJson(opts.system, msgs, opts.label, timeoutMs);
    if (g) {
      const out = validateBotOut(g.text);
      if (out) return { out, usage: g.usage };
      console.error("BOT_LLM_INVALID_JSON_GEM " + opts.label);
    }
  }

  return null;
}
