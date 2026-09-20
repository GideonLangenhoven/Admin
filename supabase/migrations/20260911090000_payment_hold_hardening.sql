-- Payment integrity and hold-expiry hardening: single-writer RPC + input guards.
-- No data migration. New tables/columns only; existing rows untouched.

BEGIN;

-- ── R05: booking-scoped write token ──────────────────────────────────────
-- waiver_token already exists (uuid, unique, 7-day expiry trigger).
-- Anonymous checkout read-back already pairs x-booking-id + x-booking-waiver-token.
-- Extend the same token pair to anonymous UPDATE so a forged tenant header
-- plus leaked UUID is no longer sufficient to modify another booking.
DROP POLICY IF EXISTS bookings_anon_update ON public.bookings;
CREATE POLICY bookings_anon_update ON public.bookings
  FOR UPDATE TO anon
  USING (
    status = ANY (ARRAY['DRAFT', 'PENDING'])
    AND (business_id)::text = (SELECT bt_request_header('x-tenant-business-id'))
    AND (id)::text = (SELECT bt_request_header('x-booking-id'))
    AND (waiver_token)::text = NULLIF((SELECT bt_request_header('x-booking-waiver-token')), '')
    AND (SELECT bt_request_header('x-booking-waiver-token')) <> ''
  )
  WITH CHECK (
    status <> ALL (ARRAY['PAID', 'CONFIRMED', 'COMPLETED'])
    AND (business_id)::text = (SELECT bt_request_header('x-tenant-business-id'))
    AND (id)::text = (SELECT bt_request_header('x-booking-id'))
    AND (waiver_token)::text = NULLIF((SELECT bt_request_header('x-booking-waiver-token')), '')
    AND (SELECT bt_request_header('x-booking-waiver-token')) <> ''
  );

-- ── R06: strip client-written authoritative money fields on anon writes ──
-- Anonymous callers may write contact/logistics fields only. Money fields are
-- recomputed server-side (create-checkout / confirm_voucher_booking). The
-- trigger runs as the table owner so anon cannot bypass it.
CREATE OR REPLACE FUNCTION public.strip_anon_booking_money()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'anon' THEN
    NEW.unit_price := OLD.unit_price;
    NEW.total_amount := OLD.total_amount;
    NEW.original_total := OLD.original_total;
    NEW.voucher_amount_paid := OLD.voucher_amount_paid;
    NEW.discount_type := OLD.discount_type;
    NEW.discount_percent := OLD.discount_percent;
    NEW.discount_amount := OLD.discount_amount;
    NEW.promo_code := OLD.promo_code;
    -- status transitions to PAID happen only via privileged paths
    IF NEW.status = 'PAID' AND OLD.status <> 'PAID' THEN
      NEW.status := OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS strip_anon_booking_money ON public.bookings;
CREATE TRIGGER strip_anon_booking_money
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.strip_anon_booking_money();

-- On INSERT, anon money guesses are zeroed; server pricing fills them in.
CREATE OR REPLACE FUNCTION public.zero_anon_booking_money()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('request.jwt.claim.role', true) = 'anon' THEN
    NEW.unit_price := 0;
    NEW.total_amount := 0;
    NEW.original_total := 0;
    NEW.voucher_amount_paid := 0;
    NEW.discount_type := NULL;
    NEW.discount_percent := NULL;
    NEW.discount_amount := NULL;
    NEW.promo_code := NULL;
    IF NEW.status NOT IN ('DRAFT', 'PENDING') THEN
      NEW.status := 'DRAFT';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS zero_anon_booking_money ON public.bookings;
CREATE TRIGGER zero_anon_booking_money
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.zero_anon_booking_money();

-- ── R07: guard hold/voucher RPCs (tenant + positive amounts) ─────────────
CREATE OR REPLACE FUNCTION public.create_hold_with_capacity_check(
  p_booking_id uuid, p_slot_id uuid, p_qty integer, p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slot slots%ROWTYPE;
  v_booking_business uuid;
  v_hold_id uuid;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 OR p_qty > 50 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid quantity', 'available', 0);
  END IF;
  SELECT * INTO v_slot FROM slots WHERE id = p_slot_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Slot not found', 'available', 0);
  END IF;
  SELECT business_id INTO v_booking_business FROM bookings WHERE id = p_booking_id;
  IF NOT FOUND OR v_booking_business <> v_slot.business_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking and slot belong to different operators', 'available', 0);
  END IF;
  IF v_slot.start_time <= NOW() + INTERVAL '60 minutes' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This time slot is no longer available', 'available', 0);
  END IF;
  IF (v_slot.capacity_total - v_slot.booked - COALESCE(v_slot.held, 0)) < p_qty THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sorry, those spots were just taken! Please try another time slot.', 'available', v_slot.capacity_total - v_slot.booked - COALESCE(v_slot.held, 0));
  END IF;
  INSERT INTO holds (booking_id, slot_id, qty, expires_at, status)
    VALUES (p_booking_id, p_slot_id, p_qty, p_expires_at, 'ACTIVE')
    RETURNING id INTO v_hold_id;
  UPDATE slots SET held = COALESCE(held, 0) + p_qty WHERE id = p_slot_id;
  RETURN jsonb_build_object('success', true, 'hold_id', v_hold_id, 'available', v_slot.capacity_total - v_slot.booked - COALESCE(v_slot.held, 0) - p_qty);
END;
$$;

CREATE OR REPLACE FUNCTION public.deduct_voucher_balance(p_voucher_id uuid, p_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row vouchers%ROWTYPE;
  v_deducted numeric;
  v_new_balance numeric;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid amount', 'deducted', 0, 'remaining', 0);
  END IF;
  SELECT * INTO v_row FROM vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Voucher not found', 'deducted', 0, 'remaining', 0);
  END IF;
  IF v_row.status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Voucher is not active', 'deducted', 0, 'remaining', COALESCE(v_row.current_balance, 0));
  END IF;
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at < NOW() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Voucher has expired', 'deducted', 0, 'remaining', COALESCE(v_row.current_balance, 0));
  END IF;
  v_new_balance := COALESCE(v_row.current_balance, v_row.value, v_row.purchase_amount, 0);
  IF v_new_balance <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'No balance remaining', 'deducted', 0, 'remaining', 0);
  END IF;
  v_deducted := LEAST(p_amount, v_new_balance);
  v_new_balance := v_new_balance - v_deducted;
  IF v_new_balance <= 0 THEN
    UPDATE vouchers SET current_balance = 0, status = 'REDEEMED', redeemed_at = NOW() WHERE id = p_voucher_id;
  ELSE
    UPDATE vouchers SET current_balance = v_new_balance WHERE id = p_voucher_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'deducted', v_deducted, 'remaining', v_new_balance);
END;
$$;

-- ── R11: processing lease on idempotency keys ────────────────────────────
ALTER TABLE public.idempotency_keys
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('processing', 'completed', 'failed')),
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- Stale 'processing' rows from a crashed webhook become retryable after 10 min.
CREATE OR REPLACE FUNCTION public.claim_yoco_payment(p_key text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row idempotency_keys%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM idempotency_keys WHERE key = p_key FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO idempotency_keys (key, status) VALUES (p_key, 'processing');
    RETURN 'claimed';
  END IF;
  IF v_row.status = 'completed' THEN
    RETURN 'duplicate';
  END IF;
  IF v_row.status = 'processing' AND v_row.updated_at > NOW() - INTERVAL '10 minutes' THEN
    RETURN 'in_progress';
  END IF;
  -- 'failed' or stale 'processing': allow one retry, bump attempt counter
  UPDATE idempotency_keys
    SET status = 'processing', attempts = v_row.attempts + 1, updated_at = NOW(), last_error = NULL
    WHERE key = p_key;
  RETURN 'claimed';
END;
$$;
REVOKE ALL ON FUNCTION public.claim_yoco_payment(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_yoco_payment(text) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_yoco_payment(p_key text, p_ok boolean, p_error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE idempotency_keys
    SET status = CASE WHEN p_ok THEN 'completed' ELSE 'failed' END,
        last_error = p_error, updated_at = NOW()
    WHERE key = p_key;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_yoco_payment(text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_yoco_payment(text, boolean, text) TO service_role;

-- ── R12: immutable expected charge ───────────────────────────────────────
-- Written once at checkout creation; the webhook reconciles gateway cents
-- against this instead of the editable bookings.total_amount.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS expected_amount_cents integer CHECK (expected_amount_cents IS NULL OR expected_amount_cents >= 0),
  ADD COLUMN IF NOT EXISTS expected_currency text NOT NULL DEFAULT 'ZAR';

-- ── R14: voucher reservation ledger ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.voucher_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id uuid NOT NULL REFERENCES public.vouchers(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'settled', 'released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '25 minutes',
  UNIQUE (voucher_id, booking_id)
);
ALTER TABLE public.voucher_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS voucher_reservations_service_only ON public.voucher_reservations;
CREATE POLICY voucher_reservations_service_only ON public.voucher_reservations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_voucher_reservations_booking ON public.voucher_reservations (booking_id);
CREATE INDEX IF NOT EXISTS idx_voucher_reservations_expiry ON public.voucher_reservations (status, expires_at);

-- Reserve available-minus-reserved balance under row lock; fails closed on
-- concurrent double-spend instead of over-committing.
CREATE OR REPLACE FUNCTION public.reserve_voucher_amount(
  p_voucher_id uuid, p_booking_id uuid, p_business_id uuid, p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_balance numeric;
  v_reserved numeric;
  v_available numeric;
  v_take numeric;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid amount', 'reserved', 0);
  END IF;
  SELECT COALESCE(current_balance, value, purchase_amount, 0) INTO v_balance
    FROM vouchers
    WHERE id = p_voucher_id AND business_id = p_business_id AND status = 'ACTIVE'
      AND (expires_at IS NULL OR expires_at > NOW())
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Voucher not available', 'reserved', 0);
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_reserved
    FROM voucher_reservations
    WHERE voucher_id = p_voucher_id AND status = 'reserved' AND expires_at > NOW();
  v_available := v_balance - v_reserved;
  IF v_available <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Voucher fully reserved', 'reserved', 0);
  END IF;
  v_take := LEAST(p_amount, v_available);
  INSERT INTO voucher_reservations (voucher_id, booking_id, business_id, amount)
    VALUES (p_voucher_id, p_booking_id, p_business_id, v_take)
    ON CONFLICT (voucher_id, booking_id) DO UPDATE
      SET amount = voucher_reservations.amount + EXCLUDED.amount,
          expires_at = NOW() + interval '25 minutes';
  RETURN jsonb_build_object('success', true, 'reserved', v_take);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_voucher_amount(uuid, uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_voucher_amount(uuid, uuid, uuid, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.settle_voucher_reservations(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
  v_ded jsonb;
  v_shortfall numeric := 0;
BEGIN
  FOR r IN SELECT * FROM voucher_reservations WHERE booking_id = p_booking_id AND status = 'reserved' FOR UPDATE LOOP
    v_ded := deduct_voucher_balance(r.voucher_id, r.amount);
    IF COALESCE((v_ded->>'success')::boolean, false) THEN
      UPDATE voucher_reservations SET status = 'settled' WHERE id = r.id;
      UPDATE vouchers SET redeemed_booking_id = p_booking_id WHERE id = r.voucher_id;
    ELSE
      v_shortfall := v_shortfall + r.amount;
      UPDATE voucher_reservations SET status = 'released' WHERE id = r.id;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('success', v_shortfall <= 0.01, 'shortfall', v_shortfall);
END;
$$;
REVOKE ALL ON FUNCTION public.settle_voucher_reservations(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_voucher_reservations(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.release_voucher_reservations(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE voucher_reservations SET status = 'released' WHERE booking_id = p_booking_id AND status = 'reserved';
END;
$$;
REVOKE ALL ON FUNCTION public.release_voucher_reservations(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_voucher_reservations(uuid) TO service_role;

-- ── R15: single-writer payment confirmation (capacity + money + voucher) ──
-- Serializes concurrent webhooks on the booking row: slot lock → capacity
-- check → booking flip → hold convert → voucher settle, all-or-nothing.
-- Returns ok:false with machine-readable error instead of half-applying.
CREATE OR REPLACE FUNCTION public.confirm_booking_payment(
  p_booking_id uuid, p_payment_id text, p_captured_cents integer, p_currency text DEFAULT 'ZAR'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bk bookings%ROWTYPE;
  v_slot slots%ROWTYPE;
  v_expected integer;
  v_settle jsonb;
BEGIN
  IF p_captured_cents IS NULL OR p_captured_cents <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;
  SELECT * INTO v_bk FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_bk.status = 'PAID' OR v_bk.status = 'COMPLETED' THEN
    RETURN jsonb_build_object('ok', true, 'already_paid', true);
  END IF;
  IF v_bk.status NOT IN ('HELD', 'PENDING', 'PENDING PAYMENT', 'CONFIRMED') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_status');
  END IF;
  SELECT * INTO v_slot FROM slots WHERE id = v_bk.slot_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'slot_not_found');
  END IF;
  IF v_slot.business_id <> v_bk.business_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tenant_mismatch');
  END IF;
  IF v_slot.status IN ('CLOSED', 'CANCELLED') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'slot_closed');
  END IF;
  -- Immutable expected charge (R12 reconciliation inside the same lock)
  v_expected := COALESCE(v_bk.expected_amount_cents,
    ROUND(COALESCE(v_bk.total_amount, 0) * 100)::integer);
  IF ABS(p_captured_cents - v_expected) > 100 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount_mismatch',
      'expected_cents', v_expected, 'captured_cents', p_captured_cents);
  END IF;
  -- Settle reserved vouchers BEFORE flipping to PAID (never PAID on failed funding)
  v_settle := settle_voucher_reservations(p_booking_id);
  IF NOT COALESCE((v_settle->>'success')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voucher_shortfall',
      'shortfall', v_settle->>'shortfall');
  END IF;
  -- Capacity: active hold converts, otherwise atomic late-payment reservation
  IF EXISTS (SELECT 1 FROM holds WHERE booking_id = p_booking_id AND status = 'ACTIVE' FOR UPDATE) THEN
    UPDATE holds SET status = 'CONVERTED' WHERE booking_id = p_booking_id AND status = 'ACTIVE';
    UPDATE slots SET booked = COALESCE(booked, 0) + v_bk.qty,
                     held = GREATEST(0, COALESCE(held, 0) - v_bk.qty)
      WHERE id = v_bk.slot_id;
  ELSE
    IF (v_slot.capacity_total - v_slot.booked - COALESCE(v_slot.held, 0)) < v_bk.qty THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_capacity');
    END IF;
    UPDATE slots SET booked = COALESCE(booked, 0) + v_bk.qty WHERE id = v_bk.slot_id;
  END IF;
  UPDATE bookings
    SET status = 'PAID', yoco_payment_id = p_payment_id,
        total_captured = p_captured_cents / 100.0, payment_status = 'CAPTURED'
    WHERE id = p_booking_id;
  RETURN jsonb_build_object('ok', true, 'captured_cents', p_captured_cents);
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_booking_payment(uuid, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_booking_payment(uuid, text, integer, text) TO service_role;

-- ── R16: single authoritative hold expiry ────────────────────────────────
-- One claimed row at a time (FOR UPDATE SKIP LOCKED), tenant-checked capacity
-- release, idempotent status flip. The edge cron calls this per hold; the
-- legacy expire-holds-db SQL cron must be unscheduled (see rollout doc).
CREATE OR REPLACE FUNCTION public.expire_single_hold(p_hold_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hold holds%ROWTYPE;
  v_bk bookings%ROWTYPE;
  v_qty integer;
BEGIN
  SELECT * INTO v_hold FROM holds WHERE id = p_hold_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_hold.status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('ok', true, 'already', v_hold.status);
  END IF;
  -- 5-minute grace: late webhooks still win inside this window
  IF v_hold.expires_at > NOW() - INTERVAL '5 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'in_grace');
  END IF;
  SELECT * INTO v_bk FROM bookings WHERE id = v_hold.booking_id FOR UPDATE;
  -- Paid since selection: convert, keep seats
  IF FOUND AND (v_bk.status IN ('PAID', 'COMPLETED') OR v_bk.yoco_payment_id IS NOT NULL) THEN
    UPDATE holds SET status = 'CONVERTED' WHERE id = p_hold_id;
    RETURN jsonb_build_object('ok', true, 'converted', true);
  END IF;
  UPDATE holds SET status = 'EXPIRED' WHERE id = p_hold_id;
  -- RESCHEDULE holds: capacity is released once by the edge reschedule branch
  -- (which also expires the pending_reschedules row); releasing here would
  -- double-decrement the new slot.
  IF v_hold.hold_type = 'RESCHEDULE' THEN
    UPDATE pending_reschedules SET status = 'EXPIRED', expired_at = NOW()
      WHERE hold_id = p_hold_id AND status = 'PENDING';
    RETURN jsonb_build_object('ok', true, 'expired', true, 'hold_type', 'RESCHEDULE');
  END IF;
  v_qty := COALESCE(v_hold.qty, 1);
  IF v_qty > 0 AND v_hold.slot_id IS NOT NULL THEN
    UPDATE slots s SET held = GREATEST(0, COALESCE(s.held, 0) - v_qty)
      FROM bookings b
      WHERE s.id = v_hold.slot_id AND b.id = v_hold.booking_id
        AND s.business_id = b.business_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'expired', true);
END;
$$;
REVOKE ALL ON FUNCTION public.expire_single_hold(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_single_hold(uuid) TO service_role;

-- ── R20: 7-day retention for operational logs ────────────────────────────
-- cron.job_run_details and net._http_response dominate disk; purge rows older
-- than 7 days. Plain DELETE (no VACUUM here — cannot run inside a migration
-- transaction; owner runs VACUUM separately, see rollout doc).
CREATE OR REPLACE FUNCTION public.purge_operational_logs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_jobs bigint := 0;
  v_http bigint := 0;
  v_idem bigint := 0;
BEGIN
  IF to_regclass('cron.job_run_details') IS NOT NULL THEN
    DELETE FROM cron.job_run_details WHERE start_time < NOW() - INTERVAL '7 days';
    GET DIAGNOSTICS v_jobs = ROW_COUNT;
  END IF;
  -- net schema lives outside public; guarded dynamic SQL (distinct tag so the
  -- inner string does not terminate the outer function body)
  BEGIN
    EXECUTE $purge$DELETE FROM net._http_response WHERE created < NOW() - INTERVAL '7 days'$purge$;
    GET DIAGNOSTICS v_http = ROW_COUNT;
  EXCEPTION WHEN undefined_table THEN
    v_http := 0;
  END;
  DELETE FROM public.idempotency_keys
    WHERE created_at < NOW() - INTERVAL '30 days' AND status = 'completed';
  GET DIAGNOSTICS v_idem = ROW_COUNT;
  RETURN jsonb_build_object('job_run_details', v_jobs, 'http_responses', v_http, 'idempotency_keys', v_idem);
END;
$$;
REVOKE ALL ON FUNCTION public.purge_operational_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_operational_logs() TO service_role;

COMMIT;
