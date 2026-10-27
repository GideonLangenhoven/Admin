-- M2 (go-live 2026-10-27): Mark Paid records the amount actually received.
-- A part-payment (deposit) confirms the booking, so its seats count, and keeps
-- the balance due; only a payment that clears the balance marks it PAID.
-- p_expected_captured is the amount already received when the operator opened
-- the dialog, so a retried request cannot record the same payment twice.
--
-- An issued payment link was priced for the full amount, so a part-payment
-- retires it: payment reminders stop sending it, and paying it anyway lands in
-- mismatch quarantine instead of silently overpaying. No new link can be issued
-- for a part-paid booking; the balance is recorded with Mark Paid.
BEGIN;

DROP FUNCTION public.account_manual_booking(uuid, uuid, boolean, text);

CREATE FUNCTION public.account_manual_booking(p_booking_id uuid, p_business_id uuid, p_mark_paid boolean,
  p_payment_method text DEFAULT 'Admin (Manual)'::text, p_amount numeric DEFAULT NULL, p_expected_captured numeric DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE b bookings%ROWTYPE; s slots%ROWTYPE; held_qty integer; counted_qty integer; result jsonb;
  due numeric; part boolean := false;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND OR b.status NOT IN ('PENDING', 'PENDING PAYMENT', 'HELD', 'PAID', 'CONFIRMED') OR b.qty < 1 OR (b.qty > 50 AND NOT public.is_operator_departure_override(b.id)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Booking cannot be confirmed');
  END IF;
  IF NOT p_mark_paid AND b.status IN ('PENDING', 'PENDING PAYMENT', 'HELD') THEN
    result := create_hold_with_capacity_check(b.id, b.slot_id, b.qty, COALESCE(b.payment_deadline, now() + interval '24 hours'));
    RETURN result || jsonb_build_object('ok', COALESCE((result->>'success')::boolean, false));
  END IF;
  due := GREATEST(COALESCE(b.total_amount, 0) - COALESCE(b.total_captured, 0), 0);
  IF p_mark_paid AND b.status <> 'PAID' THEN
    IF p_expected_captured IS NOT NULL AND abs(COALESCE(b.total_captured, 0) - p_expected_captured) > 0.005 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'This booking''s payments changed since you opened it. Refresh and check the balance.');
    END IF;
    IF p_amount IS NOT NULL THEN
      IF p_amount <= 0 OR p_amount <> round(p_amount, 2) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Enter the amount received in rand and cents.');
      END IF;
      IF p_amount > due + 0.005 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'That is more than the R' || to_char(due, 'FM9999999990.00') || ' still due.');
      END IF;
      part := p_amount < due - 0.005;
    END IF;
  END IF;
  SELECT * INTO s FROM slots WHERE id = b.slot_id AND business_id = b.business_id FOR UPDATE;
  IF NOT FOUND OR (s.status='CANCELLED' OR (s.status='CLOSED' AND NOT public.is_operator_departure_override(b.id))) THEN RETURN jsonb_build_object('ok', false, 'error', 'Departure is closed'); END IF;
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
  IF part THEN
    UPDATE bookings SET status = 'CONFIRMED', payment_method = p_payment_method,
      total_captured = COALESCE(total_captured, 0) + p_amount,
      payment_url = NULL, expected_amount_cents = round((due - p_amount) * 100)::integer
    WHERE id = b.id;
  ELSIF p_mark_paid OR b.status = 'PAID' THEN
    UPDATE bookings SET status = 'PAID', payment_status = 'CAPTURED',
      payment_method = CASE WHEN p_mark_paid THEN p_payment_method ELSE COALESCE(payment_method, 'Admin (Manual)') END,
      total_captured = GREATEST(COALESCE(total_captured, 0), COALESCE(total_amount, 0)) WHERE id = b.id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'already_paid', p_mark_paid AND b.status = 'PAID', 'booking_id', b.id,
    'previous_status', b.status,
    'amount', CASE WHEN NOT p_mark_paid OR b.status = 'PAID' THEN 0 WHEN part THEN p_amount ELSE due END,
    'balance_due', CASE WHEN part THEN due - p_amount WHEN p_mark_paid OR b.status = 'PAID' THEN 0 ELSE due END);
END $function$;

REVOKE ALL ON FUNCTION public.account_manual_booking(uuid, uuid, boolean, text, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_manual_booking(uuid, uuid, boolean, text, numeric, numeric) TO service_role;

DO $$
DECLARE
  definition text;
  anchor constant text := 'RETURN jsonb_build_object(''ok'', false, ''error'', ''Booking is no longer awaiting payment'');';
BEGIN
  SELECT pg_get_functiondef('public.prepare_booking_checkout(uuid,text,uuid[],text[],jsonb)'::regprocedure) INTO definition;
  IF (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one awaiting-payment guard in prepare_booking_checkout';
  END IF;
  EXECUTE replace(definition, anchor, anchor || '
  ELSIF COALESCE(b.total_captured, 0) > 0 THEN
    RETURN jsonb_build_object(''ok'', false, ''error'', ''Part of this booking is already paid, so a payment link cannot be created for it. Record the balance with Mark Paid.'');');
END $$;

COMMIT;
