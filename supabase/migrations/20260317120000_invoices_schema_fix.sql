-- Add missing discount columns to invoices table
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS discount_type    text,
  ADD COLUMN IF NOT EXISTS discount_percent numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount  numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_notes   text;

-- Add invoice_id back-reference on bookings if it doesn't exist
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;

-- Create the next_invoice_number function if it doesn't exist.
-- Uses a simple sequence stored in a dedicated sequence object.
CREATE SEQUENCE IF NOT EXISTS public.invoice_number_seq START 1000;

CREATE OR REPLACE FUNCTION public.next_invoice_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_val bigint;
BEGIN
  SELECT nextval('public.invoice_number_seq') INTO next_val;
  RETURN 'INV-' || LPAD(next_val::text, 5, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_invoice_number() TO service_role, authenticated, anon;
