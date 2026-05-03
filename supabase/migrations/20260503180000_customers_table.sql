BEGIN;

CREATE TABLE IF NOT EXISTS public.customers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  email               text NOT NULL,
  email_lower         text GENERATED ALWAYS AS (lower(email)) STORED,
  name                text,
  phone               text,
  marketing_consent   boolean NOT NULL DEFAULT false,
  total_bookings      integer NOT NULL DEFAULT 0,
  total_spent         numeric(12, 2) NOT NULL DEFAULT 0,
  first_booking_at    timestamptz,
  last_booking_at     timestamptz,
  date_of_birth       date,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_business_email
  ON public.customers (business_id, email_lower);

CREATE INDEX IF NOT EXISTS idx_customers_business_phone
  ON public.customers (business_id, phone);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_customer_id
  ON public.bookings (customer_id);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customers_select_own_business ON public.customers;
CREATE POLICY customers_select_own_business
  ON public.customers FOR SELECT TO authenticated
  USING (business_id = ANY(current_business_ids()));

DROP POLICY IF EXISTS customers_modify_own_business ON public.customers;
CREATE POLICY customers_modify_own_business
  ON public.customers FOR ALL TO authenticated
  USING (business_id = ANY(current_business_ids()))
  WITH CHECK (business_id = ANY(current_business_ids()));

DROP POLICY IF EXISTS customers_service_all ON public.customers;
CREATE POLICY customers_service_all
  ON public.customers FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.upsert_customer(
  p_business_id uuid,
  p_email       text,
  p_name        text DEFAULT NULL,
  p_phone       text DEFAULT NULL,
  p_marketing_consent boolean DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_business_id IS NULL OR p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RAISE EXCEPTION 'business_id and email are required';
  END IF;

  SELECT id INTO v_id
  FROM public.customers
  WHERE business_id = p_business_id
    AND email_lower = lower(p_email)
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.customers SET
      name = COALESCE(NULLIF(trim(p_name), ''), name),
      phone = COALESCE(NULLIF(trim(p_phone), ''), phone),
      marketing_consent = COALESCE(p_marketing_consent, marketing_consent),
      updated_at = now()
    WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.customers (business_id, email, name, phone, marketing_consent)
  VALUES (
    p_business_id,
    trim(p_email),
    NULLIF(trim(p_name), ''),
    NULLIF(trim(p_phone), ''),
    COALESCE(p_marketing_consent, false)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_customer(uuid, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_customer(uuid, text, text, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.recompute_customer_stats(p_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.customers c SET
    total_bookings = sub.cnt,
    total_spent    = sub.spent,
    first_booking_at = sub.first_at,
    last_booking_at  = sub.last_at,
    updated_at = now()
  FROM (
    SELECT
      count(*) AS cnt,
      coalesce(sum(total_amount), 0) AS spent,
      min(created_at) AS first_at,
      max(created_at) AS last_at
    FROM public.bookings
    WHERE customer_id = p_customer_id
      AND status IN ('PAID', 'CONFIRMED', 'COMPLETED')
  ) AS sub
  WHERE c.id = p_customer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_customer_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_customer_stats(uuid) TO service_role;

-- Backfill: create customer rows from existing bookings
DO $$
DECLARE
  rec record;
  v_customer_id uuid;
BEGIN
  FOR rec IN
    SELECT b.id AS booking_id, b.business_id, b.email, b.customer_name, b.phone, b.created_at, b.total_amount
    FROM public.bookings b
    WHERE b.customer_id IS NULL
      AND b.email IS NOT NULL
      AND length(trim(b.email)) > 0
    ORDER BY b.created_at ASC
    LIMIT 50000
  LOOP
    BEGIN
      v_customer_id := public.upsert_customer(rec.business_id, rec.email, rec.customer_name, rec.phone, NULL);
      UPDATE public.bookings SET customer_id = v_customer_id WHERE id = rec.booking_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'skip booking %: %', rec.booking_id, SQLERRM;
    END;
  END LOOP;
END $$;

-- Refresh stats for all backfilled customers
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.customers LOOP
    PERFORM public.recompute_customer_stats(r.id);
  END LOOP;
END $$;

COMMIT;
