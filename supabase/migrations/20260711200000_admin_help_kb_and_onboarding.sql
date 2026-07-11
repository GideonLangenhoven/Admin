-- In-dashboard help chatbot KB + first-login onboarding state.
--
-- admin_kb_chunks holds PLATFORM-WIDE help articles ("how does the dashboard
-- work") — deliberately no business_id: the content describes the product,
-- not any tenant's data. Role gating instead of tenant gating: a chunk with
-- required_role = 'MAIN_ADMIN' is never retrieved for an OPERATOR, so the
-- bot cannot leak instructions to pages the caller can't open.
--
-- Same retrieval design as kb_chunks (20260706090000): corpus is small
-- (~100-300 rows total, platform-wide), exact cosine scan, no ANN index.
BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_kb_chunks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_key     text NOT NULL UNIQUE,      -- 'help:<article-slug>:<chunk-n>'
  title         text,
  route         text,                      -- admin route the article documents, e.g. '/settings'
  required_role text NOT NULL DEFAULT 'OPERATOR'
                CHECK (required_role IN ('OPERATOR', 'MAIN_ADMIN', 'SUPER_ADMIN')),
  content       text NOT NULL,
  content_hash  text NOT NULL,             -- sha256 of content; unchanged => skip re-embedding
  embedding     extensions.vector(768),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_kb_chunks ENABLE ROW LEVEL SECURITY;
-- Service-role only (admin-help-chat + kb-sync); no client policies on purpose.

CREATE OR REPLACE FUNCTION public.match_admin_kb_chunks(
  p_role text,
  p_query extensions.vector(768),
  p_count int DEFAULT 5,
  p_min_similarity float DEFAULT 0.40
)
RETURNS TABLE (title text, route text, content text, similarity float)
LANGUAGE sql
STABLE
AS $$
  SELECT title, route, content, similarity FROM (
    SELECT c.title, c.route, c.content,
           1 - (c.embedding <=> p_query) AS similarity
    FROM public.admin_kb_chunks c
    WHERE c.embedding IS NOT NULL
      AND CASE c.required_role
            WHEN 'OPERATOR'    THEN 1
            WHEN 'MAIN_ADMIN'  THEN 2
            WHEN 'SUPER_ADMIN' THEN 3
          END
          <=
          CASE p_role
            WHEN 'MAIN_ADMIN'  THEN 2
            WHEN 'SUPER_ADMIN' THEN 3
            ELSE 1  -- OPERATOR + legacy ADMIN + unknown roles: base-level content only
          END
    ORDER BY c.embedding <=> p_query
    LIMIT p_count
  ) ranked
  WHERE ranked.similarity >= p_min_similarity
$$;

REVOKE ALL ON TABLE public.admin_kb_chunks FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.match_admin_kb_chunks(text, extensions.vector(768), int, float) FROM PUBLIC, anon, authenticated;

-- ── First-login onboarding state ─────────────────────────────────────────
-- admin_users has RLS enabled with no client policies, so the dashboard
-- reads/writes its own onboarding flag through self-scoped RPCs (auth.uid()
-- only — a caller can never touch another admin's row).

ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

CREATE OR REPLACE FUNCTION public.get_my_admin_onboarding()
RETURNS TABLE (onboarding_completed_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Legacy admin rows may predate auth-user linking (user_id NULL); the
  -- dashboard itself resolves admins by email (AuthGate), so fall back to
  -- the JWT email for those rows.
  SELECT a.onboarding_completed_at
  FROM public.admin_users a
  WHERE (a.user_id = auth.uid()
         OR (a.user_id IS NULL AND lower(a.email) = lower(auth.jwt() ->> 'email')))
    AND a.suspended IS NOT TRUE
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.complete_my_admin_onboarding()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.admin_users
  SET onboarding_completed_at = now()
  WHERE (user_id = auth.uid()
         OR (user_id IS NULL AND lower(email) = lower(auth.jwt() ->> 'email')))
    AND onboarding_completed_at IS NULL
$$;

REVOKE ALL ON FUNCTION public.get_my_admin_onboarding() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_my_admin_onboarding() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_admin_onboarding() TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_my_admin_onboarding() TO authenticated;

COMMIT;
