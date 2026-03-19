-- Atomic hold creation with capacity check to prevent overbooking.
-- Uses SELECT FOR UPDATE to lock the slot row, ensuring no two concurrent
-- requests can exceed capacity.
--
-- Returns a JSON object:
--   { "success": true, "hold_id": "...", "available": N }
-- or on failure:
--   { "success": false, "error": "...", "available": N }

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
BEGIN
  -- Lock the slot row to prevent concurrent modifications
  SELECT capacity_total, booked, COALESCE(held, 0)
    INTO v_capacity_total, v_booked, v_held
    FROM slots
    WHERE id = p_slot_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Slot not found', 'available', 0);
  END IF;

  v_available := v_capacity_total - v_booked - v_held;

  IF v_available < p_qty THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Sorry, those spots were just taken! Please try another time slot.',
      'available', v_available
    );
  END IF;

  -- Create the hold
  INSERT INTO holds (booking_id, slot_id, expires_at, status)
    VALUES (p_booking_id, p_slot_id, p_expires_at, 'ACTIVE')
    RETURNING id INTO v_hold_id;

  -- Atomically increment the held count
  UPDATE slots
    SET held = COALESCE(held, 0) + p_qty
    WHERE id = p_slot_id;

  RETURN jsonb_build_object('success', true, 'hold_id', v_hold_id, 'available', v_available - p_qty);
END;
$$;
