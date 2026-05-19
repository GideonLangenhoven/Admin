const VALID_INTENTS = [
  "BOOKING_QUESTION", "BOOKING_MODIFY", "REFUND_REQUEST", "WEATHER_CONCERN",
  "LOGISTICS", "COMPLAINT", "MARKETING_OPTOUT", "OTHER",
] as const;

export type ChatIntent = typeof VALID_INTENTS[number];

const SYSTEM = `You classify customer messages for a tour-booking business into one of these intents:
- BOOKING_QUESTION: pre-purchase availability/pricing/what's included
- BOOKING_MODIFY: existing booking change (date, guests, contact)
- REFUND_REQUEST: refund or cancellation request
- WEATHER_CONCERN: worried about weather conditions or trip going ahead
- LOGISTICS: meeting point, parking, what to bring, timing on the day
- COMPLAINT: negative experience or escalation request
- MARKETING_OPTOUT: unsubscribe / stop messaging
- OTHER: anything else

Return JSON only: {"intent": "...", "confidence": 0.00-1.00}. No prose.`;

function validIntent(s: unknown): ChatIntent {
  const v = String(s || "").toUpperCase();
  if ((VALID_INTENTS as readonly string[]).includes(v)) return v as ChatIntent;
  return "OTHER";
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
}

export function priorityForIntent(intent: ChatIntent): "LOW" | "NORMAL" | "HIGH" {
  if (["REFUND_REQUEST", "COMPLAINT", "WEATHER_CONCERN"].includes(intent)) return "HIGH";
  if (intent === "MARKETING_OPTOUT") return "LOW";
  return "NORMAL";
}

export type ClassificationResult = {
  intent: ChatIntent;
  confidence: number;
  model: string | null;
  ms: number;
};

// Strip ```json ... ``` or ``` ... ``` fences that Gemini sometimes wraps
// JSON output in despite the "JSON only, no prose" instruction.
function stripCodeFences(s: string): string {
  return s.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}

export async function classifyIntent(message: string, businessName: string): Promise<ClassificationResult> {
  const start = Date.now();
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return { intent: "OTHER", confidence: 0, model: null, ms: 0 };
  }

  const model = "gemini-2.0-flash";
  try {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + apiKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: "user", parts: [{ text: `Business: ${businessName}\nMessage: ${message}` }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 60,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    if (!res.ok) {
      console.warn("INTENT_CLASSIFY_ERR status=" + res.status);
      return { intent: "OTHER", confidence: 0, model: null, ms: Date.now() - start };
    }

    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(stripCodeFences(raw));
    } catch {
      console.warn("INTENT_CLASSIFY_PARSE_ERR raw=" + raw.slice(0, 200));
      return { intent: "OTHER", confidence: 0, model: model, ms: Date.now() - start };
    }
    return {
      intent: validIntent(parsed.intent),
      confidence: clamp01(Number(parsed.confidence) || 0),
      model,
      ms: Date.now() - start,
    };
  } catch (e) {
    console.warn("INTENT_CLASSIFY_ERR:", e);
    return { intent: "OTHER", confidence: 0, model: null, ms: Date.now() - start };
  }
}

/**
 * Score all enabled chat_faq_entries for a business against the user's
 * message. Used by both the verbatim-reply path (web-chat returns the
 * answer directly when confidence is high) and the LLM grounding path
 * (top-K entries injected into the system prompt so the model can't drop
 * facts like "Amex" from a configured answer).
 *
 * AJ5/AJ6 fix — previously findFaqMatch only matched within a single
 * intent bucket and required findFaqMatch's caller to pre-classify with
 * >=0.75 confidence. Both gates conspired to skip the FAQ for "What
 * payment methods do you accept?" and "How long are vouchers valid?" —
 * exact configured questions. We now match across all entries by keyword
 * score, with a minimum threshold for confident verbatim reply, and
 * always surface the top entries to the LLM regardless.
 */
export interface FaqCandidate {
  id: string;
  question: string;
  answer: string;
  score: number;
  keywords: string[];
}

export async function loadFaqCandidates(
  db: any,
  businessId: string,
  message: string,
  limit = 5,
): Promise<FaqCandidate[]> {
  const { data: entries } = await db.from("chat_faq_entries")
    .select("id, question_pattern, match_keywords, answer, use_count")
    .eq("business_id", businessId)
    .eq("enabled", true);
  if (!entries || entries.length === 0) return [];

  const words = String(message || "").toLowerCase().split(/\s+/).filter(Boolean);
  const scored: FaqCandidate[] = [];
  for (const entry of entries) {
    const keywords: string[] = entry.match_keywords || [];
    if (keywords.length === 0) continue;
    let score = 0;
    for (const rawKw of keywords) {
      const kw = String(rawKw || "").toLowerCase();
      if (!kw) continue;
      // Match if any word in the message contains the keyword (or vice versa).
      // Substring tolerance handles plurals ("vouchers" vs "voucher") and
      // light morphology ("paying" vs "pay") without needing a stemmer.
      if (words.some((w) => w.includes(kw) || kw.includes(w))) {
        score++;
      }
    }
    if (score > 0) {
      scored.push({
        id: entry.id,
        question: entry.question_pattern || "",
        answer: entry.answer,
        keywords,
        score,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Backwards-compatible single-match helper. Returns the top match's
 * answer iff it scored at least `minScore` (default 2 keyword matches —
 * tuned so single-word coincidences like "pay" don't trigger a verbatim
 * reply that ignores the rest of the user's question). Increments
 * use_count + last_used_at when a match is returned.
 *
 * `intent` is accepted for back-compat but ignored — the keyword-score
 * model already beats intent gating in practice.
 */
export async function findFaqMatch(
  db: any,
  businessId: string,
  intent: string,
  message: string,
  minScore = 2,
): Promise<string | null> {
  void intent; // legacy param, retained for callers that still pass it
  const candidates = await loadFaqCandidates(db, businessId, message, 1);
  if (candidates.length === 0) return null;
  const top = candidates[0];
  if (top.score < minScore) return null;
  await db.from("chat_faq_entries").update({
    use_count: db.rpc ? undefined : undefined, // no rpc bump available — do a read-modify-write
    last_used_at: new Date().toISOString(),
  }).eq("id", top.id);
  // Increment use_count atomically via select-then-update fallback
  const { data: cur } = await db.from("chat_faq_entries").select("use_count").eq("id", top.id).maybeSingle();
  await db.from("chat_faq_entries").update({ use_count: (cur?.use_count ?? 0) + 1 }).eq("id", top.id);
  return top.answer;
}
