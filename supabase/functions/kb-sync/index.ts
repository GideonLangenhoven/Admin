// IMPORTANT: This function uses the service role key, which BYPASSES RLS.
// Every query against a tenant-owned table MUST include .eq("business_id", X).
//
// kb-sync — (re)builds the pgvector knowledge base (kb_chunks) per tenant.
// Sources: businesses.faq_json, chat_faq_entries (Quick Answers), tours.
// content_hash skip means unchanged items are never re-embedded, so the
// hourly all-tenant sweep costs ~zero embedding calls at steady state and
// stays cheap at 2000 tenants.
//
// Invocation (service key or cron):
//   POST { "business_id": "<uuid>" }  — sync one tenant
//   POST { "all": true }              — sweep every business
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { embedText, sha256Hex } from "../_shared/kb.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type ChunkInput = { chunk_key: string; source: string; title: string | null; content: string };

const FAQ_TITLES: Record<string, string> = {
  meeting_point: "Meeting point",
  what_to_bring: "What to bring",
  cancellation: "Cancellation policy",
  duration: "Tour duration",
  safety: "Safety",
  weather: "Weather policy",
  price: "Pricing",
  pricing: "Pricing",
  age: "Kids and age requirements",
  parking: "Parking",
  expect: "What to expect",
  tours: "Our tours",
  payment: "Payment methods",
};

async function collectChunks(businessId: string): Promise<ChunkInput[]> {
  const chunks: ChunkInput[] = [];

  const { data: biz } = await supabase.from("businesses")
    .select("faq_json").eq("id", businessId).maybeSingle();
  const faq = biz?.faq_json;
  if (faq && typeof faq === "object" && !Array.isArray(faq)) {
    for (const [key, value] of Object.entries(faq)) {
      if (typeof value === "string" && value.trim()) {
        chunks.push({
          chunk_key: "faq:" + key,
          source: "faq",
          title: FAQ_TITLES[key] || key.replace(/_/g, " "),
          content: value.trim(),
        });
      }
    }
  }

  const { data: qas } = await supabase.from("chat_faq_entries")
    .select("id, question_pattern, answer, enabled")
    .eq("business_id", businessId).eq("enabled", true).limit(500);
  for (const qa of qas || []) {
    const q = String(qa.question_pattern || "").trim();
    const a = String(qa.answer || "").trim();
    if (!a) continue;
    chunks.push({
      chunk_key: "qa:" + qa.id,
      source: "quick_answer",
      title: q || null,
      content: (q ? "Q: " + q + "\nA: " : "") + a,
    });
  }

  const { data: tours } = await supabase.from("tours")
    .select("id, name, description, duration_minutes, base_price_per_person, active")
    .eq("business_id", businessId).eq("active", true).limit(200);
  for (const t of tours || []) {
    chunks.push({
      chunk_key: "tour:" + t.id,
      source: "tour",
      title: t.name,
      content: t.name + " — " + String(t.description || "").trim() +
        " Duration: " + t.duration_minutes + " minutes. Price: R" + t.base_price_per_person + " per person.",
    });
  }

  return chunks;
}

async function syncBusiness(businessId: string) {
  const chunks = await collectChunks(businessId);

  const { data: existing } = await supabase.from("kb_chunks")
    .select("chunk_key, content_hash").eq("business_id", businessId).limit(2000);
  const existingHash = new Map((existing || []).map((r: any) => [r.chunk_key, r.content_hash]));

  let embedded = 0, skipped = 0, failed = 0;
  const errors: string[] = [];

  for (const c of chunks) {
    const hash = await sha256Hex(c.content);
    if (existingHash.get(c.chunk_key) === hash) { skipped++; continue; }
    const emb = await embedText(c.content, "RETRIEVAL_DOCUMENT");
    if (!emb) {
      failed++;
      errors.push(c.chunk_key + ": embedding failed");
      continue;
    }
    const { error } = await supabase.from("kb_chunks").upsert({
      business_id: businessId,
      chunk_key: c.chunk_key,
      source: c.source,
      title: c.title,
      content: c.content,
      content_hash: hash,
      embedding: emb,
      updated_at: new Date().toISOString(),
    }, { onConflict: "business_id,chunk_key" });
    if (error) { failed++; errors.push(c.chunk_key + ": " + error.message); }
    else embedded++;
  }

  // Remove chunks whose source item was deleted/disabled
  const liveKeys = chunks.map((c) => c.chunk_key);
  let removed = 0;
  if (liveKeys.length > 0) {
    const staleKeys = (existing || []).map((r: any) => r.chunk_key).filter((k: string) => !liveKeys.includes(k));
    if (staleKeys.length > 0) {
      const { error } = await supabase.from("kb_chunks").delete()
        .eq("business_id", businessId).in("chunk_key", staleKeys);
      if (!error) removed = staleKeys.length;
    }
  } else {
    const { error } = await supabase.from("kb_chunks").delete().eq("business_id", businessId);
    if (!error) removed = existing?.length || 0;
  }

  return { business_id: businessId, total: chunks.length, embedded, skipped, removed, failed, errors: errors.slice(0, 5) };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Not allowed", { status: 405 });
  // Shared-secret guard: embedding sweeps cost real money, so this function
  // must not be publicly triggerable. Cron and admin callers send the key.
  const syncKey = Deno.env.get("KB_SYNC_KEY") || "";
  if (syncKey && req.headers.get("x-kb-sync-key") !== syncKey) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  try {
    const body = await req.json().catch(() => ({}));

    if (body.business_id) {
      const result = await syncBusiness(String(body.business_id));
      return new Response(JSON.stringify({ ok: true, results: [result] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (body.all === true) {
      const { data: businesses } = await supabase.from("businesses").select("id").limit(5000);
      const results = [];
      for (const b of businesses || []) {
        try { results.push(await syncBusiness(b.id)); }
        catch (e) { results.push({ business_id: b.id, error: e instanceof Error ? e.message : String(e) }); }
      }
      const summary = {
        businesses: results.length,
        embedded: results.reduce((s, r: any) => s + (r.embedded || 0), 0),
        skipped: results.reduce((s, r: any) => s + (r.skipped || 0), 0),
        failed: results.reduce((s, r: any) => s + (r.failed || 0), 0),
      };
      console.log("KB_SYNC_SWEEP " + JSON.stringify(summary));
      return new Response(JSON.stringify({ ok: true, summary }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: false, error: "Pass { business_id } or { all: true }" }), { status: 400, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error("KB_SYNC_ERR:", err);
    return new Response(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
