DROP POLICY IF EXISTS bookings_read ON public.bookings;

CREATE POLICY bookings_read ON public.bookings
  FOR SELECT TO anon, authenticated
  USING (
    (
      COALESCE((SELECT current_setting('request.method', true)), '') = ANY (ARRAY['POST', 'PATCH'])
      AND business_id::text = (SELECT public.bt_request_header('x-tenant-business-id'))
      AND status = ANY (ARRAY['DRAFT', 'PENDING'])
    )
    OR (SELECT public.bt_request_header('x-booking-success-token')) = id::text
    OR (
      (SELECT public.bt_request_header('x-booking-id')) = id::text
      AND (SELECT public.bt_request_header('x-booking-waiver-token')) = waiver_token::text
    )
    OR customer_id IN (SELECT c.id FROM public.customers c WHERE c.user_id = (SELECT auth.uid()))
    OR business_id IN (SELECT unnest((SELECT public.current_business_ids())))
  );

DROP FUNCTION IF EXISTS public.search_bookings_by_ref(uuid, text);

REVOKE EXECUTE ON FUNCTION public.calculate_booking_refund(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_loyalty(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_booking_refund(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_loyalty(text, uuid) TO service_role;;
