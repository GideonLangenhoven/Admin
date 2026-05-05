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

export async function classifyIntent(message: string, businessName: string): Promise<ClassificationResult> {
  const start = Date.now();
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return { intent: "OTHER", confidence: 0, model: null, ms: 0 };
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 50,
        system: SYSTEM,
        messages: [{ role: "user", content: `Business: ${businessName}\nMessage: ${message}` }],
      }),
    });

    if (!res.ok) {
      console.warn("INTENT_CLASSIFY_ERR status=" + res.status);
      return { intent: "OTHER", confidence: 0, model: null, ms: Date.now() - start };
    }

    const data = await res.json();
    const text = data?.content?.[0]?.text ?? "{}";
    const parsed = JSON.parse(text);
    return {
      intent: validIntent(parsed.intent),
      confidence: clamp01(Number(parsed.confidence) || 0),
      model: data.model || "claude-haiku-4-5-20251001",
      ms: Date.now() - start,
    };
  } catch (e) {
    console.warn("INTENT_CLASSIFY_ERR:", e);
    return { intent: "OTHER", confidence: 0, model: null, ms: Date.now() - start };
  }
}

export async function findFaqMatch(
  db: any,
  businessId: string,
  intent: string,
  message: string
): Promise<string | null> {
  const { data: entries } = await db.from("chat_faq_entries")
    .select("id, match_keywords, answer")
    .eq("business_id", businessId)
    .eq("intent", intent)
    .eq("enabled", true);

  if (!entries || entries.length === 0) return null;

  const words = message.toLowerCase().split(/\s+/);
  let bestScore = 0;
  let bestAnswer: string | null = null;
  let bestId: string | null = null;

  for (const entry of entries) {
    const keywords: string[] = entry.match_keywords || [];
    let score = 0;
    for (const kw of keywords) {
      if (words.some((w: string) => w.includes(kw.toLowerCase()) || kw.toLowerCase().includes(w))) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestAnswer = entry.answer;
      bestId = entry.id;
    }
  }

  if (bestScore > 0 && bestId) {
    await db.from("chat_faq_entries").update({
      use_count: (entries.find((e: any) => e.id === bestId)?.use_count ?? 0) + 1,
      last_used_at: new Date().toISOString(),
    }).eq("id", bestId);
    return bestAnswer;
  }

  return null;
}
