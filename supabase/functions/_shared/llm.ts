// Unified LLM completion for the chat bots (WhatsApp + web chat).
//
// Primary:  OpenRouter — env OPENROUTER_API_KEY, model env OPENROUTER_MODEL
//           (default deepseek/deepseek-v4-pro). OpenAI-compatible, so the
//           model can be swapped without any code change.
// Thinking: DeepSeek V4 runs at reasoning effort "xhigh" (Think Max) by
//           default. Env OPENROUTER_REASONING_EFFORT (off|high|xhigh)
//           overrides globally; callers pass reasoning:"off" per call — the
//           intent/date micro-classifiers do, they need 5-second answers.
//           Non-DeepSeek models default to off (GLM-5.x burned reasoning
//           tokens on one-word replies).
// Fallback: Google Gemini — legacy path, env GEMINI_API_KEY + GEMINI_MODEL.
//
// A dead provider must DEGRADE, never dead-end: failures log loudly
// (LLM_*_ERR) and fall through. The 2026-07 incident where a silently
// retired Gemini model froze both bots is the reason this module exists.

export type LlmMessage = { role: "user" | "assistant"; content: string };

export type LlmOpts = {
  system: string;
  user?: string;            // single-turn shortcut
  messages?: LlmMessage[];  // multi-turn history (takes precedence over `user`)
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  label?: string;           // appears in logs
  reasoning?: "off" | "high" | "xhigh"; // per-call override of the env/default effort
};

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";
const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") || "deepseek/deepseek-v4-pro";
// "xhigh" is OpenRouter's maximum effort and maps to DeepSeek Think Max
// ("max" itself is not a valid OpenRouter effort value).
const REASONING_EFFORT = ((Deno.env.get("OPENROUTER_REASONING_EFFORT") ||
  (OPENROUTER_MODEL.startsWith("deepseek/") ? "xhigh" : "off")).toLowerCase())
  .replace(/^max$/, "xhigh"); // accept "max" — that's DeepSeek's marketing name for it
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";

export function llmAvailable(): boolean {
  return !!OPENROUTER_API_KEY || !!GEMINI_API_KEY;
}

export async function llmText(opts: LlmOpts): Promise<string | null> {
  const label = opts.label || "llm";
  const msgs: LlmMessage[] = opts.messages && opts.messages.length > 0
    ? opts.messages
    : [{ role: "user", content: opts.user || "" }];

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
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        console.error("LLM_OPENROUTER_ERR " + label + " status:" + r.status + " " + JSON.stringify(d?.error || d).substring(0, 200));
      } else {
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
