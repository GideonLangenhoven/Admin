// Tenant knowledge-base embeddings + retrieval (pgvector RAG).
//
// Embeddings: Google gemini-embedding-001 (same GEMINI_API_KEY the bots
// already carry as their LLM fallback), truncated to 768 dims via MRL —
// model env-overridable through GEMINI_EMBED_MODEL. Retrieval failures
// must DEGRADE (bot answers from the legacy faq_json prompt injection),
// never block a reply.

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const GEMINI_EMBED_MODEL = Deno.env.get("GEMINI_EMBED_MODEL") || "gemini-embedding-001";
export const KB_EMBEDDING_DIMS = 768;

export async function embedText(
  text: string,
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
): Promise<number[] | null> {
  if (!GEMINI_API_KEY) {
    console.error("KB_EMBED_ERR: GEMINI_API_KEY not configured");
    return null;
  }
  try {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_EMBED_MODEL + ":embedContent?key=" + GEMINI_API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          content: { parts: [{ text: text.slice(0, 8000) }] },
          taskType,
          outputDimensionality: KB_EMBEDDING_DIMS,
        }),
      },
    );
    const d = await r.json();
    if (!r.ok) {
      console.error("KB_EMBED_ERR status:" + r.status + " " + JSON.stringify(d?.error || d).substring(0, 200));
      return null;
    }
    const values = d?.embedding?.values;
    if (Array.isArray(values) && values.length === KB_EMBEDDING_DIMS) return values;
    console.error("KB_EMBED_ERR unexpected shape (len=" + (values?.length ?? "none") + ")");
    return null;
  } catch (e) {
    console.error("KB_EMBED_ERR: " + (e instanceof Error ? e.message : String(e)));
    return null;
  }
}

export type KbHit = { source: string; title: string | null; content: string; similarity: number };

// Top-k tenant-scoped retrieval. Returns [] on any failure.
export async function retrieveKb(
  supabase: any,
  businessId: string,
  query: string,
  count = 4,
): Promise<KbHit[]> {
  const q = String(query || "").trim();
  if (!q || q.length < 3) return [];
  const emb = await embedText(q, "RETRIEVAL_QUERY");
  if (!emb) return [];
  const { data, error } = await supabase.rpc("match_kb_chunks", {
    p_business_id: businessId,
    p_query: emb,
    p_count: count,
  });
  if (error) {
    console.error("KB_MATCH_ERR: " + error.message);
    return [];
  }
  return Array.isArray(data) ? data : [];
}

// Formats hits as a system-prompt section. Empty string when nothing relevant.
export async function retrieveKbContext(
  supabase: any,
  businessId: string,
  query: string,
): Promise<string> {
  const hits = await retrieveKb(supabase, businessId, query);
  if (hits.length === 0) return "";
  const lines = hits.map((h) => "- " + (h.title ? h.title + ": " : "") + h.content);
  return "Verified business knowledge (answer from these facts where relevant; never contradict them):\n" + lines.join("\n");
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
