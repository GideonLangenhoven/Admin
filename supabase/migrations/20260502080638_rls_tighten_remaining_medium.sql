-- RLS Prompt 9: Close remaining MEDIUM findings from the Prompt 8 audit.

-- ============================================================================
-- 1. booking_add_ons
-- ============================================================================

DROP POLICY IF EXISTS "Anyone can read booking_add_ons" ON public.booking_add_ons;
DROP POLICY IF EXISTS "Service can insert booking_add_ons" ON public.booking_add_ons;
DROP POLICY IF EXISTS "booking_add_ons_anon_insert" ON public.booking_add_ons;
DROP POLICY IF EXISTS "booking_add_ons_delete" ON public.booking_add_ons;
DROP POLICY IF EXISTS "booking_add_ons_insert" ON public.booking_add_ons;
DROP POLICY IF EXISTS "booking_add_ons_select" ON public.booking_add_ons;
DROP POLICY IF EXISTS "booking_add_ons_update" ON public.booking_add_ons;

CREATE POLICY "booking_add_ons_auth_select"
  ON public.booking_add_ons FOR SELECT TO authenticated
  USING (
    booking_id IN (
      SELECT id FROM public.bookings
      WHERE business_id = ANY (current_business_ids())
    )
  );

CREATE POLICY "booking_add_ons_auth_insert"
  ON public.booking_add_ons FOR INSERT TO authenticated
  WITH CHECK (
    booking_id IN (
      SELECT id FROM public.bookings
      WHERE business_id = ANY (current_business_ids())
    )
  );

CREATE POLICY "booking_add_ons_auth_update"
  ON public.booking_add_ons FOR UPDATE TO authenticated
  USING (
    booking_id IN (
      SELECT id FROM public.bookings
      WHERE business_id = ANY (current_business_ids())
    )
  )
  WITH CHECK (
    booking_id IN (
      SELECT id FROM public.bookings
      WHERE business_id = ANY (current_business_ids())
    )
  );

CREATE POLICY "booking_add_ons_auth_delete"
  ON public.booking_add_ons FOR DELETE TO authenticated
  USING (
    booking_id IN (
      SELECT id FROM public.bookings
      WHERE business_id = ANY (current_business_ids())
    )
  );

CREATE POLICY "booking_add_ons_anon_insert"
  ON public.booking_add_ons FOR INSERT TO anon
  WITH CHECK (
    booking_id IN (SELECT id FROM public.bookings)
  );

CREATE POLICY "booking_add_ons_anon_select"
  ON public.booking_add_ons FOR SELECT TO anon
  USING (
    booking_id IN (SELECT id FROM public.bookings)
  );

-- ============================================================================
-- 2. messages
-- ============================================================================

DROP POLICY IF EXISTS "messages_authenticated_select" ON public.messages;

CREATE POLICY "messages_auth_select"
  ON public.messages FOR SELECT TO authenticated
  USING (
    conversation_id IN (
      SELECT id FROM public.conversations
      WHERE business_id = ANY (current_business_ids())
    )
  );

-- ============================================================================
-- 3. referral_uses
-- ============================================================================

DROP POLICY IF EXISTS "referral_uses_authenticated_select" ON public.referral_uses;

CREATE POLICY "referral_uses_auth_select"
  ON public.referral_uses FOR SELECT TO authenticated
  USING (
    referral_id IN (
      SELECT id FROM public.referrals
      WHERE business_id = ANY (current_business_ids())
    )
  );

-- ============================================================================
-- 4. idempotency_keys
-- ============================================================================

DROP POLICY IF EXISTS "idempotency_keys_anon_all" ON public.idempotency_keys;

CREATE POLICY "idempotency_keys_service_only"
  ON public.idempotency_keys FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- 5. pending_reschedules
-- ============================================================================

CREATE POLICY "pending_reschedules_service"
  ON public.pending_reschedules FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "pending_reschedules_auth_select"
  ON public.pending_reschedules FOR SELECT TO authenticated
  USING (business_id = ANY (current_business_ids()));

CREATE POLICY "pending_reschedules_auth_insert"
  ON public.pending_reschedules FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (current_business_ids()));

CREATE POLICY "pending_reschedules_auth_update"
  ON public.pending_reschedules FOR UPDATE TO authenticated
  USING (business_id = ANY (current_business_ids()))
  WITH CHECK (business_id = ANY (current_business_ids()));

CREATE POLICY "pending_reschedules_auth_delete"
  ON public.pending_reschedules FOR DELETE TO authenticated
  USING (business_id = ANY (current_business_ids()));

-- ============================================================================
-- 6. businesses — no policy change, documented in local migration file
-- ============================================================================;
