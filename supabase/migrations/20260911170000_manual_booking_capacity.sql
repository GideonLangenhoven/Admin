BEGIN;
CREATE OR REPLACE FUNCTION public.account_manual_booking(
  p_booking_id uuid, p_business_id uuid, p_mark_paid boolean, p_payment_method text DEFAULT 'Admin (Manual)'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b bookings%ROWTYPE; s slots%ROWTYPE; held_qty integer; counted_qty integer; result jsonb;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND OR b.status NOT IN ('PENDING', 'PENDING PAYMENT', 'HELD', 'PAID', 'CONFIRMED') OR b.qty < 1 OR b.qty > 50 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Booking cannot be confirmed');
  END IF;
  IF NOT p_mark_paid AND b.status IN ('PENDING', 'PENDING PAYMENT', 'HELD') THEN
    result := create_hold_with_capacity_check(b.id, b.slot_id, b.qty, COALESCE(b.payment_deadline, now() + interval '24 hours'));
    RETURN result || jsonb_build_object('ok', COALESCE((result->>'success')::boolean, false));
  END IF;
  SELECT * INTO s FROM slots WHERE id = b.slot_id AND business_id = b.business_id FOR UPDATE;
  IF NOT FOUND OR s.status IN ('CLOSED', 'CANCELLED') THEN RETURN jsonb_build_object('ok', false, 'error', 'Departure is closed'); END IF;
  SELECT COALESCE(sum(qty) FILTER (WHERE status = 'ACTIVE' AND COALESCE(hold_type, 'BOOKING') NOT IN ('ADD_GUESTS', 'RESCHEDULE')), 0), LEAST(b.qty, COALESCE(sum(qty) FILTER (WHERE status = 'CONVERTED'), 0))
    INTO held_qty, counted_qty FROM holds WHERE booking_id = b.id AND slot_id = b.slot_id;
  IF s.capacity_total - COALESCE(s.booked, 0) - GREATEST(0, COALESCE(s.held, 0) - held_qty) < b.qty - counted_qty THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not enough capacity');
  END IF;
  IF p_mark_paid THEN
    result := settle_voucher_reservations(b.id);
    IF NOT COALESCE((result->>'success')::boolean, false) THEN RETURN jsonb_build_object('ok', false, 'error', 'Voucher credit could not be settled'); END IF;
  END IF;
  UPDATE slots SET booked = COALESCE(booked, 0) + b.qty - counted_qty,
    held = GREATEST(0, COALESCE(held, 0) - held_qty) WHERE id = s.id;
  UPDATE holds SET status = 'CONVERTED' WHERE booking_id = b.id AND slot_id = s.id AND status = 'ACTIVE' AND COALESCE(hold_type, 'BOOKING') NOT IN ('ADD_GUESTS', 'RESCHEDULE');
  IF held_qty + counted_qty = 0 THEN
    INSERT INTO holds(booking_id, slot_id, qty, status, expires_at) VALUES(b.id, s.id, b.qty, 'CONVERTED', now());
  END IF;
  IF p_mark_paid OR b.status = 'PAID' THEN
    UPDATE bookings SET status = 'PAID', payment_status = 'CAPTURED',
      payment_method = CASE WHEN p_mark_paid THEN p_payment_method ELSE COALESCE(payment_method, 'Admin (Manual)') END,
      total_captured = GREATEST(COALESCE(total_captured, 0), COALESCE(total_amount, 0)) WHERE id = b.id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'already_paid', p_mark_paid AND b.status = 'PAID', 'booking_id', b.id);
END $$;
REVOKE ALL ON FUNCTION public.account_manual_booking(uuid, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_manual_booking(uuid, uuid, boolean, text) TO service_role;
COMMIT;
