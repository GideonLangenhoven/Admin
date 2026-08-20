-- Close three anonymous cross-tenant read paths on bookings.
--
-- Found by tests/tenant-isolation/probe.mjs against production: a caller with
-- nothing but the public anon key could read every tenant's bookings.
--
-- 1. bookings_read opened COMPLETELY on any POST or PATCH. The clause exists so
--    the checkout can read back the row it just wrote (booking/app/book/page.tsx
--    :368/:435/:438 all use .insert(...).select() / .update(...).select()), but
--    it was not scoped to the writer: because a PostgREST RPC call is a POST,
--    any /rpc/* invocation ran with the bookings SELECT policy disabled.
--    Proven live: anon check_loyalty(phone, <any business_id>) returned exact
--    PAID counts for every tenant (38 / 3 / 0, matching the table).
--    Now scoped to the tenant that issued the checkout, and to the two statuses
--    a checkout actually writes, so the read-back keeps working and nothing else
--    is exposed.
--
-- 2. search_bookings_by_ref(p_business_id, p_ref) took the business_id from the
--    CALLER and ran SECURITY DEFINER with PUBLIC EXECUTE, so anon could list any
--    tenant's booking ids. Combined with the success-token read below that is
--    bulk customer-PII extraction. It has no caller anywhere in the repo.
--
-- 3. calculate_booking_refund / check_loyalty were executable by anon. The
--    original refund migration (20260504000000) revoked it FROM PUBLIC, but the
--    grant came back; check_loyalty still carries a bare PUBLIC EXECUTE. Revoke
--    from PUBLIC *and* anon — revoking only one leaves the other in place, which
--    is how this regressed the first time.

-- 1 ---------------------------------------------------------------------------
DROP POLICY IF EXISTS bookings_read ON public.bookings;

-- Every per-request call stays wrapped in a scalar subquery so the planner
-- hoists it out of the row loop (tests/unit/rls-initplan.test.ts pins this).
CREATE POLICY bookings_read ON public.bookings
  FOR SELECT TO anon, authenticated
  USING (
    -- checkout read-back: only the writing tenant, only the statuses a checkout
    -- writes (DRAFT on hold, PENDING on submit). Never PAID/COMPLETED rows.
    (
      COALESCE((SELECT current_setting('request.method', true)), '') = ANY (ARRAY['POST', 'PATCH'])
      AND business_id::text = (SELECT public.bt_request_header('x-tenant-business-id'))
      AND status = ANY (ARRAY['DRAFT', 'PENDING'])
    )
    -- customer-facing success page + waiver link (unchanged)
    OR (SELECT public.bt_request_header('x-booking-success-token')) = id::text
    OR (
      (SELECT public.bt_request_header('x-booking-id')) = id::text
      AND (SELECT public.bt_request_header('x-booking-waiver-token')) = waiver_token::text
    )
    -- signed-in customer reading their own bookings (unchanged)
    OR customer_id IN (SELECT c.id FROM public.customers c WHERE c.user_id = (SELECT auth.uid()))
    -- the operator's own admin session (unchanged)
    OR business_id IN (SELECT unnest((SELECT public.current_business_ids())))
  );

-- 2 ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.search_bookings_by_ref(uuid, text);

-- 3 ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.calculate_booking_refund(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_loyalty(text, uuid) FROM PUBLIC, anon;
-- wa-webhook (service role) is check_loyalty's only caller; booking/app's
-- my-bookings calls calculate_booking_refund from an OTP-authenticated session.
GRANT EXECUTE ON FUNCTION public.calculate_booking_refund(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_loyalty(text, uuid) TO service_role;
