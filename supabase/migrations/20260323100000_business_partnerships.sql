-- Business partnerships: links two businesses for combo offers
CREATE TABLE IF NOT EXISTS public.business_partnerships (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_a_id uuid NOT NULL REFERENCES public.businesses(id),
  business_b_id uuid NOT NULL REFERENCES public.businesses(id),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'REVOKED')),
  initiated_by uuid NOT NULL REFERENCES public.businesses(id),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,

  -- Canonical ordering: always store smaller UUID first
  CONSTRAINT business_a_before_b CHECK (business_a_id < business_b_id),
  CONSTRAINT unique_partnership UNIQUE (business_a_id, business_b_id)
);

CREATE INDEX IF NOT EXISTS idx_partnerships_business_a ON public.business_partnerships (business_a_id);
CREATE INDEX IF NOT EXISTS idx_partnerships_business_b ON public.business_partnerships (business_b_id);

ALTER TABLE public.business_partnerships ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.business_partnerships TO service_role;
