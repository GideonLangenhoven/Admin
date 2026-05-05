BEGIN;

-- Plans table — extend with pricing columns
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS monthly_price_zar numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_seat_price_zar numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS included_seats integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS features_json jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- Seed the default Standard plan if nothing active exists
INSERT INTO public.plans (name, monthly_price_zar, extra_seat_price_zar, included_seats, features_json, active)
SELECT 'Standard', 1500, 750, 1, '{"all_features": true}'::jsonb, true
WHERE NOT EXISTS (SELECT 1 FROM public.plans WHERE active = true AND name = 'Standard');

-- Subscriptions: per-business self-service columns
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS seats_purchased integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS billing_cycle_start date,
  ADD COLUMN IF NOT EXISTS billing_cycle_end date,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS resumed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_method_last4 text,
  ADD COLUMN IF NOT EXISTS payment_provider text,
  ADD COLUMN IF NOT EXISTS payment_provider_customer_id text;

-- Add status check constraint if not already present
DO $$ BEGIN
  ALTER TABLE public.subscriptions
    ADD CONSTRAINT subscriptions_status_check
    CHECK (status IN ('ACTIVE', 'PAUSED', 'CANCELLED', 'SUSPENDED', 'TRIAL'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_business
  ON public.subscriptions (business_id);

-- Backfill: every business gets a Standard ACTIVE subscription
INSERT INTO public.subscriptions (business_id, plan_id, status, seats_purchased, billing_cycle_start, billing_cycle_end)
SELECT b.id,
       (SELECT id FROM public.plans WHERE active = true ORDER BY monthly_price_zar ASC LIMIT 1),
       'ACTIVE',
       1,
       date_trunc('month', now())::date,
       (date_trunc('month', now()) + interval '1 month - 1 day')::date
FROM public.businesses b
WHERE NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.business_id = b.id)
ON CONFLICT DO NOTHING;

-- billing_line_items: extend for self-service history
ALTER TABLE public.billing_line_items
  ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS invoice_period_start date,
  ADD COLUMN IF NOT EXISTS invoice_period_end date,
  ADD COLUMN IF NOT EXISTS line_type text,
  ADD COLUMN IF NOT EXISTS quantity integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS unit_amount_zar numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_amount_zar numeric(12,2) DEFAULT 0;

-- Add status column with check if not exists
DO $$ BEGIN
  ALTER TABLE public.billing_line_items
    ADD COLUMN billing_status text DEFAULT 'PENDING'
    CHECK (billing_status IN ('PENDING','INVOICED','PAID','WAIVED'));
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_billing_line_items_business_period
  ON public.billing_line_items (business_id, invoice_period_start DESC);

-- RLS policies
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subscriptions_admin ON public.subscriptions;
CREATE POLICY subscriptions_admin ON public.subscriptions FOR SELECT TO authenticated
  USING (business_id IN (
    SELECT au.business_id FROM public.admin_users au
    WHERE au.user_id = auth.uid() AND NOT au.suspended
  ));
DROP POLICY IF EXISTS subscriptions_service ON public.subscriptions;
CREATE POLICY subscriptions_service ON public.subscriptions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

ALTER TABLE public.billing_line_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_admin_read ON public.billing_line_items;
CREATE POLICY billing_admin_read ON public.billing_line_items FOR SELECT TO authenticated
  USING (business_id IN (
    SELECT au.business_id FROM public.admin_users au
    WHERE au.user_id = auth.uid() AND NOT au.suspended
  ));
DROP POLICY IF EXISTS billing_service ON public.billing_line_items;
CREATE POLICY billing_service ON public.billing_line_items FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Helper RPC: current monthly total
CREATE OR REPLACE FUNCTION public.subscription_monthly_total(p_business_id uuid)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_base numeric := 0;
  v_extra numeric := 0;
  v_included integer := 0;
  v_seats integer := 0;
  v_status text;
BEGIN
  SELECT s.status, s.seats_purchased, p.monthly_price_zar, p.extra_seat_price_zar, p.included_seats
    INTO v_status, v_seats, v_base, v_extra, v_included
    FROM public.subscriptions s
    LEFT JOIN public.plans p ON p.id = s.plan_id
    WHERE s.business_id = p_business_id;
  IF v_status IS NULL OR v_status != 'ACTIVE' THEN RETURN 0; END IF;
  RETURN v_base + GREATEST(0, COALESCE(v_seats,1) - COALESCE(v_included,1)) * COALESCE(v_extra,0);
END;
$$;
GRANT EXECUTE ON FUNCTION public.subscription_monthly_total(uuid) TO authenticated, service_role;

COMMIT;
