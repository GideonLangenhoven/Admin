-- Marketing Billing: usage tracking, included allowances, overage rates

-- 1. Add billing columns to businesses table
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS marketing_included_emails int NOT NULL DEFAULT 500;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS marketing_overage_rate_zar numeric(10,2) NOT NULL DEFAULT 0.15;

-- 2. Monthly usage tracking table
CREATE TABLE IF NOT EXISTS public.marketing_usage_monthly (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  period text NOT NULL,  -- format: "2026-03"
  emails_sent int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id, period)
);

ALTER TABLE public.marketing_usage_monthly ENABLE ROW LEVEL SECURITY;

-- RLS: service_role full access
CREATE POLICY marketing_usage_monthly_service ON public.marketing_usage_monthly
  FOR ALL USING (auth.role() = 'service_role');

-- RLS: admin users can read their own business data
CREATE POLICY marketing_usage_monthly_read_own ON public.marketing_usage_monthly
  FOR SELECT USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

-- 3. Atomic increment RPC
CREATE OR REPLACE FUNCTION public.increment_marketing_monthly_usage(
  p_business_id uuid,
  p_period text,
  p_amount int DEFAULT 1
) RETURNS void AS $$
BEGIN
  INSERT INTO public.marketing_usage_monthly (business_id, period, emails_sent)
  VALUES (p_business_id, p_period, p_amount)
  ON CONFLICT (business_id, period)
  DO UPDATE SET emails_sent = public.marketing_usage_monthly.emails_sent + p_amount,
                updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.increment_marketing_monthly_usage TO service_role;

-- 4. Atomic increment for businesses.marketing_email_usage (avoids read-then-write race)
CREATE OR REPLACE FUNCTION public.increment_marketing_email_usage(
  p_business_id uuid,
  p_amount int DEFAULT 1
) RETURNS void AS $$
BEGIN
  UPDATE public.businesses
  SET marketing_email_usage = COALESCE(marketing_email_usage, 0) + p_amount
  WHERE id = p_business_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.increment_marketing_email_usage TO service_role;
