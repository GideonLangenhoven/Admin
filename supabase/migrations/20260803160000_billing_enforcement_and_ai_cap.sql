-- Billing enforcement (Fix 4) + AI fair-use cap.
--
-- businesses.subscription_status is the canonical tenant state — it is NOT NULL,
-- populated for every tenant, and already read by AuthGate, AppShell,
-- super-admin, settings and (since Fix 2) the server-side API gate. The
-- subscriptions table stays a billing record; its CHECK constraint only allows
-- ACTIVE|INACTIVE|CANCELLED and is deliberately left alone.
--
-- Values in use on subscription_status: ACTIVE, TRIAL, PAST_DUE, PAUSED,
-- SUSPENDED, CANCELLED. ACTIVE/TRIAL/PAST_DUE trade; the rest do not.

-- Why a tenant is suspended. NON_PAYMENT is set (and cleared) automatically by
-- the billing-enforcement pass; MANUAL is an operator/super-admin decision and
-- must never be auto-restored by a payment landing.
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS suspension_reason text;

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_suspension_reason_check;
ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_suspension_reason_check
  CHECK (suspension_reason IS NULL OR suspension_reason IN ('NON_PAYMENT', 'MANUAL'));

-- AI fair-use, mirroring the existing marketing_included_emails /
-- marketing_overage_rate_zar pair so the invoice generator has one shape to
-- follow. Defaults are deliberately generous: at roughly R0.005 per reply,
-- 3000 replies costs the platform about R15/month. The cap exists to stop
-- runaway loops and abuse, not to recover cost.
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS ai_included_replies integer NOT NULL DEFAULT 3000;
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS ai_overage_rate_zar numeric NOT NULL DEFAULT 0.15;

COMMENT ON COLUMN public.businesses.suspension_reason IS 'NON_PAYMENT (auto, auto-restored on payment) | MANUAL (never auto-restored) | NULL';
COMMENT ON COLUMN public.businesses.ai_included_replies IS 'Monthly included AI bot replies. Hard ceiling is 3x this; past it the bot degrades to the deterministic menu.';
COMMENT ON COLUMN public.businesses.ai_overage_rate_zar IS 'ZAR per AI reply beyond ai_included_replies, billed like marketing email overage.';

-- Per-tenant monthly AI reply count, read on every bot turn by the fair-use
-- gate and by the admin usage page. A plain count over llm_usage would scan the
-- tenant's whole month on every message; this index makes it an index-only
-- range scan. `fn` is included because the gate counts customer-facing replies
-- only, never the micro-classifiers.
CREATE INDEX IF NOT EXISTS llm_usage_business_month_fn_idx
  ON public.llm_usage (business_id, created_at DESC, fn);

-- llm_usage shipped with RLS on and no policies because nothing read it. The
-- admin AI-usage page is now that reader, so it gets the tenant-scoped SELECT
-- every other business-scoped table uses. Writes stay service-role only: no
-- INSERT/UPDATE/DELETE policy exists, so an operator can see their usage and
-- cannot manufacture or erase it.
GRANT SELECT ON public.llm_usage TO authenticated;

DROP POLICY IF EXISTS llm_usage_auth_select ON public.llm_usage;
CREATE POLICY llm_usage_auth_select ON public.llm_usage
  FOR SELECT TO authenticated
  USING (business_id = any(public.current_business_ids()));
