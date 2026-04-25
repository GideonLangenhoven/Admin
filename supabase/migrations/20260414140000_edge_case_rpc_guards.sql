-- Edge case fixes from AH3 and AH7 testing (2026-04-14)
-- AH3: deduct_voucher_balance did not check expires_at — expired vouchers redeemable via API
-- AH7: create_hold_with_capacity_check did not check start_time — past slots bookable via API

-- FIX AH3: Add expires_at check to deduct_voucher_balance
CREATE OR REPLACE FUNCTION deduct_voucher_balance(p_voucher_id uuid, p_amount numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row vouchers%ROWTYPE;
  v_new_balance numeric;
  v_deducted numeric;
BEGIN
  SELECT * INTO v_row
  FROM vouchers
  WHERE id = p_voucher_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Voucher not found', 'deducted', 0, 'remaining', 0);
  END IF;

  IF v_row.status NOT IN ('ACTIVE') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Voucher is not active (status: ' || v_row.status || ')', 'deducted', 0, 'remaining', COALESCE(v_row.current_balance, 0));
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

-- FIX AH7: Add start_time check to create_hold_with_capacity_check
CREATE OR REPLACE FUNCTION create_hold_with_capacity_check(
  p_booking_id UUID,
  p_slot_id UUID,
  p_qty INTEGER,
  p_expires_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_capacity_total INTEGER;
  v_booked INTEGER;
  v_held INTEGER;
  v_available INTEGER;
  v_hold_id UUID;
  v_start_time TIMESTAMPTZ;
BEGIN
  SELECT capacity_total, booked, COALESCE(held, 0), start_time
    INTO v_capacity_total, v_booked, v_held, v_start_time
    FROM slots
    WHERE id = p_slot_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Slot not found', 'available', 0);
  END IF;

  IF v_start_time <= NOW() + INTERVAL '60 minutes' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This time slot is no longer available', 'available', 0);
  END IF;

  v_available := v_capacity_total - v_booked - v_held;

  IF v_available < p_qty THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Sorry, those spots were just taken! Please try another time slot.',
      'available', v_available
    );
  END IF;

  INSERT INTO holds (booking_id, slot_id, expires_at, status)
    VALUES (p_booking_id, p_slot_id, p_expires_at, 'ACTIVE')
    RETURNING id INTO v_hold_id;

  UPDATE slots
    SET held = COALESCE(held, 0) + p_qty
    WHERE id = p_slot_id;

  RETURN jsonb_build_object('success', true, 'hold_id', v_hold_id, 'available', v_available - p_qty);
END;
$$;
