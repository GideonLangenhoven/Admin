-- RLS Prompt 9: Close remaining MEDIUM findings from the Prompt 8 audit.
-- Combo-related items (5 tables) deferred to V2 per Gideon's directive.
--
-- FLAGGED for follow-up: businesses anon SELECT exposes sensitive columns
-- (google_drive_refresh_token, bank_account_*, paysafe_account_id, etc.).
-- Requires column-level REVOKE or table split in a dedicated prompt.

BEGIN;

-- ============================================================================
-- 1. booking_add_ons
--    No business_id; joins via booking_id → bookings.business_id.
--    Drop 7 overly-permissive public/anon USING(true) policies.
--    Add: auth CRUD scoped via bookings join, anon INSERT for checkout,
--    anon SELECT for the booking-site confirmation page.
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

-- Anon INSERT: customer checkout flow inserts add-ons for their booking.
-- The booking must already exist (created moments before by the same flow).
CREATE POLICY "booking_add_ons_anon_insert"
  ON public.booking_add_ons FOR INSERT TO anon
  WITH CHECK (
    booking_id IN (SELECT id FROM public.bookings)
  );

-- Anon SELECT: booking confirmation page reads add-ons for a specific booking.
CREATE POLICY "booking_add_ons_anon_select"
  ON public.booking_add_ons FOR SELECT TO anon
  USING (
    booking_id IN (SELECT id FROM public.bookings)
  );

-- ============================================================================
-- 2. messages
--    No business_id; joins via conversation_id → conversations.business_id.
--    0 rows, not referenced in app/ code. Used by edge functions via service_role.
--    Replace auth SELECT USING(true) with tenant-scoped via conversations join.
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
--    No business_id; joins via referral_id → referrals.business_id.
--    0 rows, no code references in app/ or edge functions.
--    Replace auth SELECT USING(true) with tenant-scoped via referrals join.
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
--    No business_id. Only used by edge functions (yoco-webhook, paysafe-webhook,
--    super-admin-onboard) which run as service_role (bypasses RLS).
--    Replace anon ALL USING(true) with service_role-only policy.
-- ============================================================================

DROP POLICY IF EXISTS "idempotency_keys_anon_all" ON public.idempotency_keys;

CREATE POLICY "idempotency_keys_service_only"
  ON public.idempotency_keys FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- 5. pending_reschedules
--    HAS business_id. 0 rows. Used by edge functions only (rebook-booking,
--    yoco-webhook, cron-tasks) via service_role. Admin UI may read in future.
--    Add service_role ALL + tenant-scoped auth CRUD.
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
-- 6. businesses — anon SELECT kept (booking site needs it)
--    FINDING: sensitive columns exposed to anon via this policy:
--      - google_drive_refresh_token (PLAINTEXT)
--      - bank_account_number, bank_account_owner, bank_account_type,
--        bank_name, bank_branch_code (PLAINTEXT)
--      - paysafe_account_id, paysafe_linked_account_id (PLAINTEXT)
--      - wa_token_encrypted, wa_phone_id_encrypted,
--        yoco_secret_key_encrypted, yoco_webhook_secret_encrypted,
--        paysafe_api_key_encrypted, paysafe_api_secret_encrypted (BYTEA)
--    ACTION REQUIRED: follow-up prompt to either:
--      (a) REVOKE SELECT on sensitive columns from anon, or
--      (b) Move sensitive columns to a business_credentials table.
--    Policy left unchanged in this migration — booking site depends on it.
-- ============================================================================

-- No policy change. Documented above for audit trail.

COMMIT;
