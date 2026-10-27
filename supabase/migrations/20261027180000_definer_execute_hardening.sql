-- Section 5 (Supabase advisors, 27 Oct). SECURITY DEFINER functions that anon
-- or authenticated could execute although no browser needs them. Edge
-- functions call them as service_role and cron runs as postgres, so both keep
-- access. Customers signed in to My Bookings are "authenticated" too, which is
-- why the admin-app functions below also check the caller's business.
--
-- Kept for anon on purpose:
--   current_business_ids  three anon policies call it; without a session it returns no businesses
--   sign_waiver           needs the booking's waiver token
--   validate_promo_code   booking-site checkout; read-only

-- Edge functions only, or no caller at all.
revoke execute on function
  public.bt_record_otp_failed_attempt(text, integer, integer),
  public.calculate_refund_percent(uuid, timestamptz, timestamptz),
  public.cleanup_old_idempotency_keys(),
  public.cleanup_stale_webchat_sessions(),
  public.create_hold_with_capacity_check(uuid, uuid, integer, timestamptz),
  public.deduct_voucher_balance(uuid, numeric),
  public.increment_campaign_counter(uuid, text, integer),
  public.increment_contact_counter(uuid, text, integer),
  public.increment_marketing_email_usage(uuid, integer),
  public.list_all_businesses(),
  public.next_invoice_number(),
  public.recompute_customer_stats(uuid),
  public.reset_stale_wa_conversations(),
  public.resolve_business_by_subdomain(text),
  public.set_business_admin_seats(uuid, integer),
  public.set_business_email_rate(uuid, numeric)
from public, anon, authenticated;
grant execute on function
  public.bt_record_otp_failed_attempt(text, integer, integer),
  public.calculate_refund_percent(uuid, timestamptz, timestamptz),
  public.cleanup_old_idempotency_keys(),
  public.cleanup_stale_webchat_sessions(),
  public.create_hold_with_capacity_check(uuid, uuid, integer, timestamptz),
  public.deduct_voucher_balance(uuid, numeric),
  public.increment_campaign_counter(uuid, text, integer),
  public.increment_contact_counter(uuid, text, integer),
  public.increment_marketing_email_usage(uuid, integer),
  public.list_all_businesses(),
  public.next_invoice_number(),
  public.recompute_customer_stats(uuid),
  public.reset_stale_wa_conversations(),
  public.resolve_business_by_subdomain(text),
  public.set_business_admin_seats(uuid, integer),
  public.set_business_email_rate(uuid, numeric)
to service_role;

-- Signed-in admins (admin app) and customers (link_customer_user) only.
revoke execute on function
  public.apply_promo_code(uuid, text, uuid, text),
  public.increment_automation_counter(uuid, text, integer),
  public.link_customer_user(),
  public.next_invoice_number(uuid),
  public.storage_admin_business_ids(),
  public.storage_is_super_admin()
from public, anon;
grant execute on function
  public.apply_promo_code(uuid, text, uuid, text),
  public.increment_automation_counter(uuid, text, integer),
  public.link_customer_user(),
  public.next_invoice_number(uuid),
  public.storage_admin_business_ids(),
  public.storage_is_super_admin()
to authenticated, service_role;

-- Trigger functions: a trigger fires without EXECUTE on its function.
revoke execute on function
  public._audit_admin_users_changes(),
  public._audit_businesses_changes(),
  public.block_read_only_admin_write(),
  public.ck_sync_marketing_contact(),
  public.protect_platform_business_fields(),
  public.set_hold_business(),
  public.strip_anon_booking_money(),
  public.zero_anon_booking_money()
from public, anon, authenticated;

-- The three admin-app functions above acted on any business's rows. They now
-- act only within the caller's businesses (all of them for a super-admin);
-- edge functions call them as service_role. Bodies are unchanged otherwise.
CREATE OR REPLACE FUNCTION public.apply_promo_code(p_promo_id uuid, p_customer_email text, p_booking_id uuid DEFAULT NULL::uuid, p_customer_phone text DEFAULT NULL::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_promo RECORD;
    v_normalized_email TEXT;
BEGIN
    v_normalized_email := LOWER(TRIM(COALESCE(p_customer_email, '')));
    IF v_normalized_email = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'customer email is required');
    END IF;

    -- Lock the promo row to serialize concurrent applies. Another business's
    -- promo reads as not found.
    SELECT id, max_uses, used_count, active, valid_until INTO v_promo
    FROM public.promotions
    WHERE id = p_promo_id
      AND (auth.role() = 'service_role' OR business_id = ANY(public.current_business_ids()))
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'promo not found');
    END IF;

    IF NOT v_promo.active THEN
        RETURN jsonb_build_object('ok', false, 'error', 'promo is not active');
    END IF;

    IF v_promo.valid_until IS NOT NULL AND v_promo.valid_until < NOW() THEN
        RETURN jsonb_build_object('ok', false, 'error', 'promo has expired');
    END IF;

    IF v_promo.max_uses IS NOT NULL AND v_promo.used_count >= v_promo.max_uses THEN
        RETURN jsonb_build_object('ok', false, 'error', 'promo has reached its use limit');
    END IF;

    -- Insert the use record. Unique index on (promotion_id, lower(email))
    -- guarantees a single email cannot consume the same promo twice even
    -- under concurrent requests. Catch the duplicate so we can return a
    -- friendly response instead of a 23505 surface error.
    BEGIN
        INSERT INTO public.promotion_uses (id, promotion_id, email, booking_id, used_at)
        VALUES (gen_random_uuid(), p_promo_id, v_normalized_email, p_booking_id, NOW());
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('ok', false, 'error', 'this email has already used this promo');
    END;

    -- Increment under the same lock
    UPDATE public.promotions
    SET used_count = used_count + 1
    WHERE id = p_promo_id;

    RETURN jsonb_build_object('ok', true, 'used_count', v_promo.used_count + 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_automation_counter(p_automation_id uuid, p_column text, p_amount integer DEFAULT 1)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_column NOT IN ('enrolled_count', 'completed_count') THEN
    RAISE EXCEPTION 'Invalid column name: %', p_column;
  END IF;
  EXECUTE format(
    'UPDATE public.marketing_automations SET %I = COALESCE(%I, 0) + $1 WHERE id = $2 AND ($3 OR business_id = ANY(public.current_business_ids()))',
    p_column, p_column
  ) USING p_amount, p_automation_id, auth.role() = 'service_role';
END;
$$;

CREATE OR REPLACE FUNCTION public.next_invoice_number(p_business_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  next_val integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND (p_business_id = ANY(public.current_business_ids())) IS NOT TRUE THEN
    RAISE EXCEPTION 'Not allowed for this business' USING ERRCODE = '42501';
  END IF;

  -- Ensure a row exists for this business
  INSERT INTO public.tenant_invoice_sequences (business_id, last_number)
  VALUES (p_business_id, 0)
  ON CONFLICT (business_id) DO NOTHING;

  -- Lock the row and increment atomically
  UPDATE public.tenant_invoice_sequences
  SET last_number = last_number + 1
  WHERE business_id = p_business_id
  RETURNING last_number INTO next_val;

  RETURN 'INV-' || LPAD(next_val::text, 5, '0');
END;
$$;

-- Mutable search_path (advisor 0011). pgvector lives in extensions.
alter function public.advance_arrival_approval_version() set search_path = public, extensions, pg_temp;
alter function public.guard_arrival_approval_history() set search_path = public, extensions, pg_temp;
alter function public.is_inside_business_hours(uuid) set search_path = public, extensions, pg_temp;
alter function public.match_kb_chunks(uuid, extensions.vector, integer, double precision) set search_path = public, extensions, pg_temp;
alter function public.match_admin_kb_chunks(text, extensions.vector, integer, double precision) set search_path = public, extensions, pg_temp;
alter function app_private.validate_business_config() set search_path = public, extensions, pg_temp;
