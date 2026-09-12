-- bookings_anon_insert / bookings_anon_update had no tenant scoping at all.
-- The only condition was on `status`, so an anonymous caller who knew (or
-- leaked) a booking UUID could UPDATE any DRAFT or PENDING booking belonging
-- to any operator on the platform, and could INSERT a booking into any tenant.
--
-- Unlike the neighbouring booking_add_ons policies, these could not be saved by
-- Postgres applying RLS inside a policy subquery, because there is no subquery
-- here: the predicate reads only the row being written.
--
-- Now scoped by the same x-tenant-business-id header every other anon policy
-- uses. The booking app was pointed at the tenant-scoped client and deployed
-- BEFORE this, so the header is already present on every one of these writes.
ALTER POLICY bookings_anon_insert ON public.bookings
  WITH CHECK (
    status = ANY (ARRAY['DRAFT', 'PENDING'])
    AND (business_id)::text = (SELECT public.bt_request_header('x-tenant-business-id'))
  );

ALTER POLICY bookings_anon_update ON public.bookings
  USING (
    status = ANY (ARRAY['DRAFT', 'PENDING'])
    AND (business_id)::text = (SELECT public.bt_request_header('x-tenant-business-id'))
  )
  WITH CHECK (
    status <> ALL (ARRAY['PAID', 'CONFIRMED'])
    AND (business_id)::text = (SELECT public.bt_request_header('x-tenant-business-id'))
  );;
