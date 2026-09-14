-- create_hold_with_capacity_check incremented slots.held by p_qty but inserted
-- the holds row WITHOUT qty (column defaults to 1). The S3 reconciler
-- (20260711160200) recomputes held = SUM(qty) of ACTIVE holds, so any
-- multi-guest hold would be reconciled down to 1 reserved seat — silently
-- shrinking real reservations. Insert the actual qty.

CREATE OR REPLACE FUNCTION public.create_hold_with_capacity_check(
  p_booking_id uuid,
  p_slot_id uuid,
  p_qty integer,
  p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

  INSERT INTO holds (booking_id, slot_id, qty, expires_at, status)
    VALUES (p_booking_id, p_slot_id, p_qty, p_expires_at, 'ACTIVE')
    RETURNING id INTO v_hold_id;

  UPDATE slots
    SET held = COALESCE(held, 0) + p_qty
    WHERE id = p_slot_id;

  RETURN jsonb_build_object('success', true, 'hold_id', v_hold_id, 'available', v_available - p_qty);
END;
$$;
