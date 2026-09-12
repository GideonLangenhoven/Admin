CREATE TABLE IF NOT EXISTS public.llm_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  fn text NOT NULL,
  model text NOT NULL,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  cached_tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.llm_usage ADD COLUMN IF NOT EXISTS action text;
ALTER TABLE public.llm_usage ADD COLUMN IF NOT EXISTS intent text;
ALTER TABLE public.llm_usage ADD COLUMN IF NOT EXISTS grounded boolean;
ALTER TABLE public.llm_usage ADD COLUMN IF NOT EXISTS shadow boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS llm_usage_business_created_idx
  ON public.llm_usage (business_id, created_at DESC);

ALTER TABLE public.llm_usage ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.llm_usage FROM anon;
REVOKE ALL ON public.llm_usage FROM authenticated;

COMMENT ON TABLE public.llm_usage IS 'One row per LLM completion. service_role writes only; RLS on with no policies until a reader exists.';
COMMENT ON COLUMN public.llm_usage.fn IS 'Call-site label, e.g. wa-faq, web-faq, wa-intent, wa-v2, wa-v2-shadow';
COMMENT ON COLUMN public.llm_usage.cached_tokens IS 'usage.prompt_tokens_details.cached_tokens — prompt-cache hit size, 0 on a cold prompt';
COMMENT ON COLUMN public.llm_usage.action IS 'v2 contract action: reply|silent|flow|escalate|template|parse_fail (null for legacy calls)';
COMMENT ON COLUMN public.llm_usage.grounded IS 'v2 self-reported grounding flag — the hallucination canary; monitor the false rate';
COMMENT ON COLUMN public.llm_usage.shadow IS 'true when the v2 call ran in shadow mode (logged only, nothing sent)';;
