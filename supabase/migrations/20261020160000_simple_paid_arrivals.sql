BEGIN;

CREATE OR REPLACE FUNCTION public.record_booking_arrival(
  p_booking_id uuid,
  p_business_id uuid,
  p_actor_admin_id uuid,
  p_arrived_count integer,
  p_expected_arrived_count integer,
  p_client_event_id text,
  p_source text,
  p_notes text,
  p_slot_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  b public.bookings%ROWTYPE;
  target_count integer;
  previous_count integer;
  existing_event public.slot_check_ins%ROWTYPE;
  claimed_events integer;
BEGIN
  SELECT * INTO b
  FROM public.bookings
  WHERE id = p_booking_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'error', 'Booking not found');
  END IF;

  IF p_slot_id IS NOT NULL AND p_slot_id IS DISTINCT FROM b.slot_id THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'STALE_SLOT',
      'error', 'This booking moved to another departure. Refresh and try again.',
      'arrived_count', b.arrived_count, 'qty', b.qty, 'slot_id', b.slot_id
    );
  END IF;

  IF p_client_event_id IS NOT NULL THEN
    SELECT * INTO existing_event
    FROM public.slot_check_ins
    WHERE booking_id = b.id AND client_event_id = p_client_event_id;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', true, 'replay', true,
        'arrived_count', b.arrived_count, 'qty', b.qty,
        'checked_in', b.checked_in, 'checked_in_at', b.checked_in_at,
        'slot_id', b.slot_id
      );
    END IF;
  END IF;

  target_count := COALESCE(p_arrived_count, b.qty);
  previous_count := b.arrived_count;
  IF target_count < 0 OR target_count > b.qty THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'OUT_OF_RANGE',
      'error', format('Arrived count must be between 0 and %s.', b.qty),
      'arrived_count', b.arrived_count, 'qty', b.qty
    );
  END IF;

  IF p_expected_arrived_count IS NOT NULL
      AND p_expected_arrived_count IS DISTINCT FROM b.arrived_count THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'STALE',
      'error', 'Arrival count changed on another device. Review the latest count and try again.',
      'arrived_count', b.arrived_count, 'qty', b.qty,
      'checked_in', b.checked_in, 'checked_in_at', b.checked_in_at,
      'slot_id', b.slot_id
    );
  END IF;

  -- Simple View requires a settled balance, including approved account bookings.
  IF target_count > b.arrived_count AND p_source IN ('simple-view', 'simple-guide')
      AND greatest(0, coalesce(b.total_amount, 0) - CASE
        WHEN coalesce(b.total_captured, 0) > 0 THEN b.total_captured
        WHEN b.status IN ('PAID', 'COMPLETED') THEN coalesce(b.total_amount, 0)
        ELSE 0 END) > 0.005 THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'PAYMENT_REQUIRED',
      'error', 'Payment must be received in full before recording arrivals.',
      'arrived_count', b.arrived_count, 'qty', b.qty
    );
  END IF;

  -- Resetting/correcting to zero is always possible. Recording arrivals keeps
  -- the established settled-booking and signed-waiver guard.
  IF target_count > b.arrived_count AND NOT public.booking_arrival_payment_ready(b.business_id,b.id,b.slot_id,b.status,b.total_amount,b.total_captured) THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'PAYMENT_REQUIRED',
      'error', 'Record the balance received or obtain admin account/reseller approval before arrival.',
      'arrived_count', b.arrived_count, 'qty', b.qty
    );
  END IF;

  IF target_count > b.arrived_count AND COALESCE(b.waiver_status, '') <> 'SIGNED' THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'WAIVER_REQUIRED',
      'error', 'A signed waiver is required before check-in.',
      'arrived_count', b.arrived_count, 'qty', b.qty
    );
  END IF;

  UPDATE public.bookings
  SET arrived_count = target_count
  WHERE id = b.id
  RETURNING * INTO b;

  IF target_count IS DISTINCT FROM previous_count THEN
    -- The trigger wrote the immutable audit row in this transaction. The
    -- booking row lock serializes writers, so the exact before/after pair is
    -- unambiguous and can be enriched with the RPC's actor and replay id.
    UPDATE public.slot_check_ins SET
      actor_admin_id = p_actor_admin_id,
      client_event_id = NULLIF(left(COALESCE(p_client_event_id, ''), 160), ''),
      source = left(COALESCE(NULLIF(p_source, ''), 'admin'), 80),
      notes = NULLIF(left(COALESCE(p_notes, ''), 500), '')
    WHERE id = (
      SELECT id FROM public.slot_check_ins
      WHERE booking_id = b.id
        AND arrived_count_before = previous_count
        AND arrived_count_after = target_count
        AND client_event_id IS NULL
      ORDER BY checked_in_at DESC, id DESC
      LIMIT 1
      FOR UPDATE
    );
    GET DIAGNOSTICS claimed_events = ROW_COUNT;
    IF claimed_events <> 1 THEN RAISE EXCEPTION 'Arrival audit could not be attributed'; END IF;
  ELSE
    INSERT INTO public.slot_check_ins (
      business_id, booking_id, slot_id, actor_admin_id, checked_in_at,
      client_event_id, source, notes, arrived_count_before, arrived_count_after
    ) VALUES (
      b.business_id, b.id, b.slot_id, p_actor_admin_id, now(),
      NULLIF(left(COALESCE(p_client_event_id, ''), 160), ''),
      left(COALESCE(NULLIF(p_source, ''), 'admin'), 80),
      NULLIF(left(COALESCE(p_notes, ''), 500), ''),
      previous_count, target_count
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'replay', false,
    'arrived_count', b.arrived_count, 'qty', b.qty,
    'checked_in', b.checked_in, 'checked_in_at', b.checked_in_at,
    'slot_id', b.slot_id
  );
END $$;

COMMIT;
