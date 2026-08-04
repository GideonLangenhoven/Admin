-- bookings_anon_insert / bookings_anon_update had no tenant scoping at all.
-- The only condition was on `status`, so an anonymous caller who knew or leaked
-- a booking UUID could UPDATE any DRAFT or PENDING booking belonging to any
-- operator on the platform, and could INSERT a booking into any tenant.
--
-- Unlike the neighbouring booking_add_ons policies, these could not be saved by
-- Postgres applying RLS inside a policy subquery: there is no subquery here,
-- the predicate reads only the row being written.
--
-- ORDER MATTERS. The booking app performed these writes with the bare supabase
-- client, which sends no tenant header, so applying this first would have taken
-- checkout offline. booking/app/book/page.tsx was moved onto the tenant-scoped
-- client and deployed BEFORE this migration ran. Adding a header is strictly
-- additive — no policy requires its absence — so that deploy was safe on its
-- own, and this migration is safe only after it.
--
-- Verified against a disposable DRAFT booking on a test tenant: anon with the
-- wrong tenant header returned [], anon with no header returned [], anon with
-- the correct header updated the row. Canary deleted.
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
  );
