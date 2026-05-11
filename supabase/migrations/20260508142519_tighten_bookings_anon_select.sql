-- Tighten customer-facing bookings reads.
--
-- The previous anon SELECT policy was USING (true), which let browser clients
-- enumerate bookings across every tenant. Keep narrow read-back support for
-- existing checkout POST/PATCH flows, and require random bearer-style tokens
-- for customer success/waiver GET reads.

CREATE OR REPLACE FUNCTION public.bt_request_header(header_name text)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.headers', true), '')::jsonb ->> lower(header_name),
    ''
  );
$$;

DROP POLICY IF EXISTS bookings_anon_select ON public.bookings;

CREATE POLICY bookings_anon_select ON public.bookings
  FOR SELECT TO anon
  USING (
    COALESCE(current_setting('request.method', true), '') IN ('POST', 'PATCH')
    OR public.bt_request_header('x-booking-success-token') = bookings.id::text
    OR (
      public.bt_request_header('x-booking-id') = bookings.id::text
      AND public.bt_request_header('x-booking-waiver-token') = bookings.waiver_token::text
    )
  );
