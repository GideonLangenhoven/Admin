-- Merge overlapping permissive SELECT policies on the three high-read tables.
-- Postgres ORs permissive policies together anyway, so one policy holding the
-- same OR is identical in meaning and evaluated once instead of two or three
-- times per row.

DROP POLICY IF EXISTS tours_anon_select ON public.tours;
DROP POLICY IF EXISTS tours_tenant_select ON public.tours;
CREATE POLICY tours_read ON public.tours FOR SELECT TO anon, authenticated
USING (
  (
    (business_id)::text = (SELECT public.bt_request_header('x-tenant-business-id'))
    AND active = true
    AND COALESCE(hidden, false) = false
  )
  OR business_id IN (SELECT unnest((SELECT public.current_business_ids())))
);

DROP POLICY IF EXISTS slots_anon_select ON public.slots;
DROP POLICY IF EXISTS slots_tenant_select ON public.slots;
CREATE POLICY slots_read ON public.slots FOR SELECT TO anon, authenticated
USING (
  (
    (business_id)::text = (SELECT public.bt_request_header('x-tenant-business-id'))
    AND status = 'OPEN'
    AND start_time > (now() - '7 days'::interval)
  )
  OR business_id IN (SELECT unnest((SELECT public.current_business_ids())))
);

DROP POLICY IF EXISTS bookings_anon_select ON public.bookings;
DROP POLICY IF EXISTS bookings_self_read ON public.bookings;
DROP POLICY IF EXISTS bookings_tenant_select ON public.bookings;
CREATE POLICY bookings_read ON public.bookings FOR SELECT TO anon, authenticated
USING (
  COALESCE((SELECT current_setting('request.method', true)), '') = ANY (ARRAY['POST', 'PATCH'])
  OR (SELECT public.bt_request_header('x-booking-success-token')) = (id)::text
  OR (
    (SELECT public.bt_request_header('x-booking-id')) = (id)::text
    AND (SELECT public.bt_request_header('x-booking-waiver-token')) = (waiver_token)::text
  )
  OR customer_id IN (SELECT c.id FROM public.customers c WHERE c.user_id = (SELECT auth.uid()))
  OR business_id IN (SELECT unnest((SELECT public.current_business_ids())))
);

-- holds: drop the `booking_id IS NULL` escape. It granted every authenticated
-- user access to any hold with no booking attached, regardless of tenant. Zero
-- of the 141 existing rows qualify and all three insert paths
-- (create-paysafe-checkout, rebook-booking, manual-mark-paid) set booking_id,
-- so this removes access to a set that is empty and stays empty.
ALTER POLICY holds_authenticated_select ON public.holds
  USING (
    booking_id IN (SELECT b.id FROM public.bookings b WHERE b.business_id IN (SELECT unnest((SELECT public.current_business_ids()))))
    OR slot_id IN (SELECT s.id FROM public.slots s WHERE s.business_id IN (SELECT unnest((SELECT public.current_business_ids()))))
  );
ALTER POLICY holds_authenticated_update ON public.holds
  USING (
    booking_id IN (SELECT b.id FROM public.bookings b WHERE b.business_id IN (SELECT unnest((SELECT public.current_business_ids()))))
    OR slot_id IN (SELECT s.id FROM public.slots s WHERE s.business_id IN (SELECT unnest((SELECT public.current_business_ids()))))
  );
ALTER POLICY holds_authenticated_delete ON public.holds
  USING (
    booking_id IN (SELECT b.id FROM public.bookings b WHERE b.business_id IN (SELECT unnest((SELECT public.current_business_ids()))))
    OR slot_id IN (SELECT s.id FROM public.slots s WHERE s.business_id IN (SELECT unnest((SELECT public.current_business_ids()))))
  );;
