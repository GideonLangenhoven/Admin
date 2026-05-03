BEGIN;

-- Add user_id column to link customers to Supabase Auth users
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_user_id
  ON public.customers (user_id) WHERE user_id IS NOT NULL;

-- Grant authenticated role read access (needed for magic-link auth flow)
GRANT SELECT ON public.bookings TO authenticated;
GRANT SELECT ON public.customers TO authenticated;
GRANT SELECT ON public.slots TO authenticated;
GRANT SELECT ON public.tours TO authenticated;
GRANT SELECT ON public.trip_photos TO authenticated;
GRANT SELECT ON public.logs TO authenticated;
GRANT SELECT ON public.vouchers TO authenticated;
GRANT SELECT ON public.promotions TO authenticated;

-- link_customer_user: links current auth user to matching customer records by email
CREATE OR REPLACE FUNCTION public.link_customer_user()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  IF v_email IS NULL THEN RETURN; END IF;

  UPDATE public.customers
  SET user_id = auth.uid(), updated_at = now()
  WHERE email_lower = lower(v_email)
    AND user_id IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.link_customer_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_customer_user() TO authenticated;

-- Customer self-read: authenticated users can see their own customer record
DROP POLICY IF EXISTS customers_self_read ON public.customers;
CREATE POLICY customers_self_read
  ON public.customers FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Customer self-update: authenticated users can update their own profile fields
DROP POLICY IF EXISTS customers_self_update ON public.customers;
CREATE POLICY customers_self_update
  ON public.customers FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Bookings self-read: authenticated users can see bookings linked to their customer record
DROP POLICY IF EXISTS bookings_self_read ON public.bookings;
CREATE POLICY bookings_self_read
  ON public.bookings FOR SELECT TO authenticated
  USING (customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid()));

COMMIT;
