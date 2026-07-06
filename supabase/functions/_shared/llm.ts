// Unified LLM completion for the chat bots (WhatsApp + web chat).
//
// Primary:  OpenRouter — env OPENROUTER_API_KEY, model env OPENROUTER_MODEL
//           (default z-ai/glm-5.2). OpenAI-compatible, so the model can be
//           swapped (e.g. to z-ai/glm-4.7-flash) without any code change.
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
};

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";
const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") || "z-ai/glm-5.2";
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
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + OPENROUTER_API_KEY,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://bookingtours.co.za",
          "X-Title": "BookingTours",
        },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          // Chat replies must be fast and cheap — no hidden chain-of-thought.
          // (GLM-5.x are reasoning models; a one-word reply burned 142
          // reasoning tokens with this enabled.)
          reasoning: { enabled: false },
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
