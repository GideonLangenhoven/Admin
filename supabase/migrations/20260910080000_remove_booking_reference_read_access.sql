-- R01: a booking reference is an identifier, never a credential. Confirmation
-- reads now go through booking-success, which verifies a short-lived HMAC
-- capability bound to both the booking and operator before querying any data.
-- Preserve the independent waiver/verified-customer/operator paths. The public
-- DRAFT/PENDING write/read-back boundary is tracked separately under R05.
BEGIN;
DROP POLICY IF EXISTS bookings_read ON public.bookings;
CREATE POLICY bookings_read ON public.bookings
  FOR SELECT TO anon, authenticated
  USING (
    (
      COALESCE((SELECT current_setting('request.method', true)), '') = ANY (ARRAY['POST', 'PATCH'])
      AND business_id::text = (SELECT public.bt_request_header('x-tenant-business-id'))
      AND status = ANY (ARRAY['DRAFT', 'PENDING'])
    )
    OR (
      (SELECT public.bt_request_header('x-booking-id')) = id::text
      AND (SELECT public.bt_request_header('x-booking-waiver-token')) = waiver_token::text
    )
    OR customer_id IN (SELECT c.id FROM public.customers c WHERE c.user_id = (SELECT auth.uid()))
    OR business_id IN (SELECT unnest((SELECT public.current_business_ids())))
  );
COMMIT;
