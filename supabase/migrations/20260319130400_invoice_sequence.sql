-- Per-tenant gapless invoice sequences
CREATE TABLE IF NOT EXISTS public.tenant_invoice_sequences (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  last_number integer NOT NULL DEFAULT 0
);

ALTER TABLE public.tenant_invoice_sequences ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.tenant_invoice_sequences TO service_role;

-- Replace the global next_invoice_number() with a per-tenant version
-- that uses SELECT FOR UPDATE for gapless sequential numbering.
CREATE OR REPLACE FUNCTION public.next_invoice_number(p_business_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_val integer;
BEGIN
  -- Ensure a row exists for this business
  INSERT INTO public.tenant_invoice_sequences (business_id, last_number)
  VALUES (p_business_id, 0)
  ON CONFLICT (business_id) DO NOTHING;

  -- Lock the row and increment atomically
  UPDATE public.tenant_invoice_sequences
  SET last_number = last_number + 1
  WHERE business_id = p_business_id
  RETURNING last_number INTO next_val;

  RETURN 'INV-' || LPAD(next_val::text, 5, '0');
END;
$$;

-- Keep the old zero-arg version as a fallback (uses global sequence)
-- so existing callers don't break until they're migrated.

GRANT EXECUTE ON FUNCTION public.next_invoice_number(uuid) TO service_role, authenticated, anon;
