-- AI overage becomes a platform-invoice line item, mirroring the
-- email_overage_count / email_overage_zar pair from 20260717092131 so the
-- generator, send route and email template have one shape to follow. The
-- count is always derived per business from llm_usage (business_id-scoped,
-- QUOTA_FNS only) — one operator's bot traffic can never land on another's
-- invoice.
ALTER TABLE public.platform_invoices
  ADD COLUMN IF NOT EXISTS ai_overage_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_overage_zar numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.platform_invoices.ai_overage_count IS 'Billable AI replies beyond ai_included_replies for the invoiced month.';
COMMENT ON COLUMN public.platform_invoices.ai_overage_zar IS 'ZAR charged for those replies at businesses.ai_overage_rate_zar.';

-- Included allowance rises 3000 -> 5000. The backfill matches the old default
-- exactly so a hand-tuned allowance is never clobbered.
ALTER TABLE public.businesses
  ALTER COLUMN ai_included_replies SET DEFAULT 5000;
UPDATE public.businesses SET ai_included_replies = 5000 WHERE ai_included_replies = 3000;

COMMENT ON COLUMN public.businesses.ai_included_replies IS 'Monthly included AI bot replies (default 5000). Hard ceiling is 3x this; past it the bot degrades to the deterministic menu.';
