ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS suspension_reason text;

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_suspension_reason_check;
ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_suspension_reason_check
  CHECK (suspension_reason IS NULL OR suspension_reason IN ('NON_PAYMENT', 'MANUAL'));

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS ai_included_replies integer NOT NULL DEFAULT 3000;
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS ai_overage_rate_zar numeric NOT NULL DEFAULT 0.15;

COMMENT ON COLUMN public.businesses.suspension_reason IS 'NON_PAYMENT (auto, auto-restored on payment) | MANUAL (never auto-restored) | NULL';
COMMENT ON COLUMN public.businesses.ai_included_replies IS 'Monthly included AI bot replies. Hard ceiling is 3x this; past it the bot degrades to the deterministic menu.';
COMMENT ON COLUMN public.businesses.ai_overage_rate_zar IS 'ZAR per AI reply beyond ai_included_replies, billed like marketing email overage.';

CREATE INDEX IF NOT EXISTS llm_usage_business_month_fn_idx
  ON public.llm_usage (business_id, created_at DESC, fn);

GRANT SELECT ON public.llm_usage TO authenticated;

DROP POLICY IF EXISTS llm_usage_auth_select ON public.llm_usage;
CREATE POLICY llm_usage_auth_select ON public.llm_usage
  FOR SELECT TO authenticated
  USING (business_id = any(public.current_business_ids()));;
