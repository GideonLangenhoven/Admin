-- Tenant knowledge base with pgvector retrieval (RAG) for the chat bots.
--
-- Scaling design (2000-tenant ready by construction):
--   Every query is tenant-scoped: WHERE business_id = X ORDER BY embedding <=> q.
--   The btree on business_id narrows to that tenant's rows first, then exact
--   cosine distance is computed over ONLY those rows (~50-500 per tenant).
--   Cost therefore tracks each tenant's own KB size, never the tenant count.
--   No global ANN index — a global HNSW scans across tenants and post-filters,
--   which is slower AND risks cross-tenant ranking artifacts. If a single
--   tenant ever exceeds ~5k chunks, add a partial HNSW index for that tenant
--   (or partition) — not before.
--
-- Embeddings: gemini-embedding-001 truncated to 768 dims (MRL), cosine.
BEGIN;

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.kb_chunks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  chunk_key     text NOT NULL,             -- stable id: 'faq:<key>' | 'qa:<uuid>' | 'tour:<uuid>'
  source        text NOT NULL,             -- 'faq' | 'quick_answer' | 'tour'
  title         text,
  content       text NOT NULL,
  content_hash  text NOT NULL,             -- sha256 of content; unchanged => skip re-embedding
  embedding     extensions.vector(768),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, chunk_key)
);

CREATE INDEX IF NOT EXISTS idx_kb_chunks_business ON public.kb_chunks (business_id);

ALTER TABLE public.kb_chunks ENABLE ROW LEVEL SECURITY;
-- Service-role only (bots + kb-sync); no client policies on purpose.

CREATE OR REPLACE FUNCTION public.match_kb_chunks(
  p_business_id uuid,
  p_query extensions.vector(768),
  p_count int DEFAULT 4,
  p_min_similarity float DEFAULT 0.45
)
RETURNS TABLE (source text, title text, content text, similarity float)
LANGUAGE sql
STABLE
AS $$
  SELECT source, title, content, similarity FROM (
    SELECT c.source, c.title, c.content,
           1 - (c.embedding <=> p_query) AS similarity
    FROM public.kb_chunks c
    WHERE c.business_id = p_business_id
      AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> p_query
    LIMIT p_count
  ) ranked
  WHERE ranked.similarity >= p_min_similarity
$$;

-- Bots and kb-sync run with service_role; nothing here is client-callable.
REVOKE ALL ON TABLE public.kb_chunks FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.match_kb_chunks(uuid, extensions.vector(768), int, float) FROM PUBLIC, anon, authenticated;

COMMIT;
