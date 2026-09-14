-- Correct checkout retries and make failed payment confirmation leave voucher
-- balances, reservations and capacity unchanged. No historical rows rewritten.
BEGIN;

CREATE OR REPLACE FUNCTION public.reserve_voucher_amount(
  p_voucher_id uuid, p_booking_id uuid, p_business_id uuid, p_amount numeric
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_balance numeric;
  v_reserved numeric;
  v_take numeric;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid amount', 'reserved', 0);
  END IF;
  -- Use the same booking -> voucher -> reservation lock order as settlement.
  PERFORM 1 FROM bookings WHERE id = p_booking_id AND business_id = p_business_id
    AND status IN ('DRAFT', 'PENDING', 'HELD', 'PENDING PAYMENT', 'CONFIRMED') FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not available', 'reserved', 0);
  END IF;
  SELECT COALESCE(current_balance, value, purchase_amount, 0) INTO v_balance
    FROM vouchers WHERE id = p_voucher_id AND business_id = p_business_id
      AND status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > NOW()) FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Voucher not available', 'reserved', 0);
  END IF;
  IF EXISTS (SELECT 1 FROM voucher_reservations WHERE voucher_id = p_voucher_id
      AND booking_id = p_booking_id AND status = 'settled') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Voucher already settled', 'reserved', 0);
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_reserved FROM voucher_reservations
    WHERE voucher_id = p_voucher_id AND booking_id <> p_booking_id
      AND status = 'reserved' AND expires_at > NOW();
  v_take := LEAST(p_amount, v_balance - v_reserved);
  IF v_take <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Voucher fully reserved', 'reserved', 0);
  END IF;
  INSERT INTO voucher_reservations (voucher_id, booking_id, business_id, amount)
    VALUES (p_voucher_id, p_booking_id, p_business_id, v_take)
    ON CONFLICT (voucher_id, booking_id) DO UPDATE
      SET amount = EXCLUDED.amount, status = 'reserved',
          expires_at = NOW() + interval '25 minutes';
  RETURN jsonb_build_object('success', true, 'reserved', v_take);
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_voucher_reservations(p_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bk bookings%ROWTYPE;
  r RECORD;
  v_total numeric;
  v_balance numeric;
  v_other_reserved numeric;
  v_ded jsonb;
  v_shortfall numeric := 0;
BEGIN
  SELECT * INTO v_bk FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_total FROM voucher_reservations
    WHERE booking_id = p_booking_id AND business_id = v_bk.business_id
      AND status IN ('reserved', 'settled');
  IF ABS(v_total - COALESCE(v_bk.voucher_amount_paid, 0)) > 0.01 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Voucher coverage does not match booking',
      'shortfall', GREATEST(0, COALESCE(v_bk.voucher_amount_paid, 0) - v_total));
  END IF;
  PERFORM v.id FROM vouchers v JOIN voucher_reservations vr ON vr.voucher_id = v.id
    WHERE vr.booking_id = p_booking_id AND vr.status = 'reserved'
    ORDER BY v.id FOR UPDATE OF v;

  FOR r IN SELECT * FROM voucher_reservations
      WHERE booking_id = p_booking_id AND status = 'reserved'
      ORDER BY voucher_id FOR UPDATE LOOP
    SELECT COALESCE(current_balance, value, purchase_amount, 0) INTO v_balance
      FROM vouchers WHERE id = r.voucher_id AND business_id = v_bk.business_id
        AND r.business_id = v_bk.business_id AND status = 'ACTIVE'
        AND (expires_at IS NULL OR expires_at > NOW());
    IF NOT FOUND THEN v_balance := 0; END IF;
    SELECT COALESCE(SUM(amount), 0) INTO v_other_reserved FROM voucher_reservations
      WHERE voucher_id = r.voucher_id AND booking_id <> p_booking_id
        AND status = 'reserved' AND expires_at > NOW();
    v_shortfall := GREATEST(0, r.amount - GREATEST(0, v_balance - v_other_reserved));
    IF v_shortfall > 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'Voucher funding incomplete';
    END IF;
    v_ded := deduct_voucher_balance(r.voucher_id, r.amount);
    IF NOT COALESCE((v_ded->>'success')::boolean, false)
        OR COALESCE((v_ded->>'deducted')::numeric, 0) <> r.amount THEN
      v_shortfall := r.amount - COALESCE((v_ded->>'deducted')::numeric, 0);
      RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'Voucher deduction incomplete';
    END IF;
    UPDATE voucher_reservations SET status = 'settled' WHERE id = r.id;
    UPDATE vouchers SET redeemed_booking_id = p_booking_id WHERE id = r.voucher_id;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'shortfall', 0);
EXCEPTION WHEN SQLSTATE 'PZ001' THEN
  -- This block rolls back ALL preceding deductions, including earlier vouchers.
  RETURN jsonb_build_object('success', false, 'shortfall', v_shortfall);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_booking_payment(
  p_booking_id uuid, p_payment_id text, p_captured_cents integer, p_currency text DEFAULT 'ZAR'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bk bookings%ROWTYPE;
  v_slot slots%ROWTYPE;
  v_expected integer;
  v_held integer;
  v_settle jsonb;
BEGIN
  IF p_captured_cents IS NULL OR p_captured_cents <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;
  SELECT * INTO v_bk FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF v_bk.status IN ('PAID', 'COMPLETED') THEN
    RETURN jsonb_build_object('ok', true, 'already_paid', true);
  END IF;
  IF v_bk.status NOT IN ('HELD', 'PENDING', 'PENDING PAYMENT', 'CONFIRMED') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_status');
  END IF;
  SELECT * INTO v_slot FROM slots WHERE id = v_bk.slot_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'slot_not_found'); END IF;
  IF v_slot.business_id <> v_bk.business_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tenant_mismatch');
  END IF;
  IF v_slot.status IN ('CLOSED', 'CANCELLED') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'slot_closed');
  END IF;
  v_expected := COALESCE(v_bk.expected_amount_cents, ROUND(COALESCE(v_bk.total_amount, 0) * 100)::integer);
  IF ABS(p_captured_cents - v_expected) > 100
      OR upper(p_currency) IS DISTINCT FROM upper(COALESCE(v_bk.expected_currency, 'ZAR')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount_mismatch',
      'expected_cents', v_expected, 'captured_cents', p_captured_cents);
  END IF;
  SELECT COALESCE(SUM(qty), 0) INTO v_held FROM (
    SELECT qty FROM holds WHERE booking_id = p_booking_id AND slot_id = v_bk.slot_id
      AND status = 'ACTIVE' AND hold_type IS DISTINCT FROM 'RESCHEDULE' FOR UPDATE
  ) own_holds;
  IF v_bk.qty IS NULL OR v_bk.qty <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_quantity');
  END IF;
  IF v_slot.capacity_total - COALESCE(v_slot.booked, 0)
      - GREATEST(0, COALESCE(v_slot.held, 0) - v_held) < v_bk.qty THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_capacity');
  END IF;
  -- Every capacity check precedes settlement. A funding error rolls back its
  -- deductions; unexpected SQL errors roll back the entire RPC transaction.
  v_settle := settle_voucher_reservations(p_booking_id);
  IF NOT COALESCE((v_settle->>'success')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voucher_shortfall', 'shortfall', v_settle->>'shortfall');
  END IF;
  UPDATE holds SET status = 'CONVERTED' WHERE booking_id = p_booking_id
    AND slot_id = v_bk.slot_id AND status = 'ACTIVE' AND hold_type IS DISTINCT FROM 'RESCHEDULE';
  UPDATE slots SET booked = COALESCE(booked, 0) + v_bk.qty,
    held = GREATEST(0, COALESCE(held, 0) - v_held) WHERE id = v_bk.slot_id;
  UPDATE bookings SET status = 'PAID', yoco_payment_id = p_payment_id,
    total_captured = p_captured_cents / 100.0, payment_status = 'CAPTURED' WHERE id = p_booking_id;
  RETURN jsonb_build_object('ok', true, 'captured_cents', p_captured_cents);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_voucher_reservations(p_booking_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM 1 FROM bookings WHERE id = p_booking_id FOR UPDATE;
  UPDATE voucher_reservations SET status = 'released'
    WHERE booking_id = p_booking_id AND status = 'reserved';
END;
$$;

-- Existing service-only grants are retained by CREATE OR REPLACE.
COMMIT;
