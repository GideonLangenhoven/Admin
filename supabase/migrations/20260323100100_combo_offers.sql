-- Combo offers: bundled tours across two partner businesses
CREATE TABLE IF NOT EXISTS public.combo_offers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  partnership_id uuid NOT NULL REFERENCES public.business_partnerships(id),
  name text NOT NULL,
  description text,
  image_url text,
  tour_a_id uuid NOT NULL REFERENCES public.tours(id),
  tour_b_id uuid NOT NULL REFERENCES public.tours(id),
  business_a_id uuid NOT NULL REFERENCES public.businesses(id),
  business_b_id uuid NOT NULL REFERENCES public.businesses(id),
  combo_price numeric NOT NULL CHECK (combo_price >= 0),
  original_price numeric NOT NULL CHECK (original_price >= 0),
  split_type text NOT NULL CHECK (split_type IN ('PERCENT', 'FIXED')),
  split_a_percent numeric CHECK (split_a_percent >= 0 AND split_a_percent <= 100),
  split_b_percent numeric CHECK (split_b_percent >= 0 AND split_b_percent <= 100),
  split_a_fixed numeric CHECK (split_a_fixed >= 0),
  split_b_fixed numeric CHECK (split_b_fixed >= 0),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'ZAR',
  created_by uuid,
  created_at timestamptz DEFAULT now() NOT NULL,

  -- When split_type = PERCENT, the two percentages must sum to 100
  CONSTRAINT percent_split_sums_to_100 CHECK (
    split_type != 'PERCENT' OR (split_a_percent + split_b_percent = 100)
  ),
  -- When split_type = FIXED, the two fixed amounts must sum to combo_price
  CONSTRAINT fixed_split_sums_to_price CHECK (
    split_type != 'FIXED' OR (split_a_fixed + split_b_fixed = combo_price)
  )
);

CREATE INDEX IF NOT EXISTS idx_combo_offers_partnership ON public.combo_offers (partnership_id);
CREATE INDEX IF NOT EXISTS idx_combo_offers_active ON public.combo_offers (active) WHERE active = true;

ALTER TABLE public.combo_offers ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.combo_offers TO service_role;
