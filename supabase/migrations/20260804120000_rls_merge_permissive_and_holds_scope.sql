-- Two follow-ons to 20260804090000.
--
-- 1. Merge overlapping permissive SELECT policies on the three high-read
--    tables. Postgres ORs permissive policies together anyway, so one policy
--    holding the same OR means the same thing and is evaluated once per row
--    instead of two or three times.
--
--    Only tours, slots and bookings. The other 14 overlapping pairs are on
--    low-volume tables (add_ons, promotions, reviews, audit_logs...), and now
--    that the expensive parts of every predicate are InitPlanned, the residual
--    cost of a second policy is comparing already-computed values. Churning 28
--    more security policies for that is a bad trade.
--
--    NOT done by narrowing the anon policies to the anon role, which is the
--    other obvious way to remove the overlap. An authenticated visitor with no
--    admin_users row — a customer logged in via my-bookings OTP — would then
--    match neither policy and the storefront would go blank for them. That
--    exact regression has already happened once here (2026-07-06).
--
-- 2. Remove the `booking_id IS NULL` escape from the holds policies. It let
--    any authenticated user read, update or delete any hold with no booking
--    attached, in any tenant. Zero of the 141 live rows qualify and all three
--    insert paths set booking_id, so this removes access to an empty set.
--
--    The cross-table lookup stays. Rewriting it as a correlated EXISTS was
--    tried and EXPLAIN showed Postgres flattens it to the identical hashed
--    SubPlan — no gain. What actually fixes that scan is
--    idx_bookings_business_status from the previous migration.

BEGIN;

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

ALTER POLICY holds_authenticated_select ON public.holds
  USING (
    booking_id IN (SELECT b.id FROM public.bookings b WHERE b.business_id IN (SELECT unnest((SELECT public.current_business_ids()))))
    OR slot_id IN (SELECT s.id FROM public.slots s WHERE s.business_id IN (SELECT unnest((SELECT public.current_business_ids()))))
  );
ALTER POLICY holds_authenticated_delete ON public.holds
  USING (
    booking_id IN (SELECT b.id FROM public.bookings b WHERE b.business_id IN (SELECT unnest((SELECT public.current_business_ids()))))
    OR slot_id IN (SELECT s.id FROM public.slots s WHERE s.business_id IN (SELECT unnest((SELECT public.current_business_ids()))))
  );
-- USING and WITH CHECK both: altering only USING leaves the old WITH CHECK in
-- place, which would keep the null-booking escape alive on writes.
ALTER POLICY holds_authenticated_update ON public.holds
  USING (
    booking_id IN (SELECT b.id FROM public.bookings b WHERE b.business_id IN (SELECT unnest((SELECT public.current_business_ids()))))
    OR slot_id IN (SELECT s.id FROM public.slots s WHERE s.business_id IN (SELECT unnest((SELECT public.current_business_ids()))))
  )
  WITH CHECK (
    booking_id IN (SELECT b.id FROM public.bookings b WHERE b.business_id IN (SELECT unnest((SELECT public.current_business_ids()))))
    OR slot_id IN (SELECT s.id FROM public.slots s WHERE s.business_id IN (SELECT unnest((SELECT public.current_business_ids()))))
  );

COMMIT;
