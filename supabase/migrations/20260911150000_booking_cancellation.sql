BEGIN;
CREATE OR REPLACE FUNCTION public.cancel_booking_transaction(
  p_booking_id uuid, p_business_id uuid, p_reason text,
  p_allow_late_choice boolean DEFAULT false, p_weather boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  b bookings%ROWTYPE; h record; promo record;
  paid boolean; late boolean; choice boolean; amount numeric; cash numeric; credit numeric;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Booking not found'); END IF;
  IF b.status = 'CANCELLED' THEN RETURN jsonb_build_object('ok', true, 'already_cancelled', true); END IF;
  IF b.status = 'COMPLETED' THEN RETURN jsonb_build_object('ok', false, 'error', 'Completed trips cannot be cancelled'); END IF;
  paid := b.status IN ('PAID', 'CONFIRMED');
  cash := COALESCE(b.total_amount, 0); credit := CASE WHEN b.converted_to_voucher_id IS NULL THEN COALESCE(b.voucher_amount_paid, 0) ELSE 0 END;
  IF COALESCE(b.original_total, 0) > 0 AND cash + credit > b.original_total THEN cash := GREATEST(0, b.original_total - credit); END IF;
  IF COALESCE(b.total_captured, 0) > 0 THEN cash := LEAST(cash, GREATEST(0, b.total_captured - COALESCE(b.total_refunded, 0))); END IF;
  amount := CASE WHEN paid AND b.source NOT LIKE 'OTA_%' THEN cash + credit ELSE 0 END;
  SELECT start_time < now() + interval '24 hours' INTO late FROM slots WHERE id = b.slot_id;
  choice := amount > 0 AND (p_weather OR p_allow_late_choice OR NOT COALESCE(late, false));
  PERFORM id FROM slots WHERE business_id = b.business_id AND (id = b.slot_id OR id IN
    (SELECT slot_id FROM holds WHERE booking_id = b.id AND status = 'ACTIVE')) ORDER BY id FOR UPDATE;
  IF paid THEN UPDATE slots SET booked = GREATEST(0, booked - b.qty) WHERE id = b.slot_id AND business_id = b.business_id; END IF;
  FOR h IN SELECT slot_id, sum(qty) AS qty FROM holds WHERE booking_id = b.id AND status = 'ACTIVE' GROUP BY slot_id LOOP
    UPDATE slots SET held = GREATEST(0, COALESCE(held, 0) - h.qty) WHERE id = h.slot_id AND business_id = b.business_id;
  END LOOP;
  UPDATE holds SET status = 'CANCELLED' WHERE booking_id = b.id AND status = 'ACTIVE';
  UPDATE pending_reschedules SET status = 'CANCELLED' WHERE booking_id = b.id AND business_id = b.business_id AND status IN ('PENDING', 'EXPIRED');
  PERFORM release_voucher_reservations(b.id);
  IF NOT paid THEN
    FOR promo IN DELETE FROM promotion_uses WHERE booking_id = b.id RETURNING promotion_id LOOP
      UPDATE promotions SET used_count = GREATEST(0, used_count - 1) WHERE id = promo.promotion_id;
    END LOOP;
  END IF;
  UPDATE bookings SET status = 'CANCELLED', cancelled_at = now(), cancellation_reason = p_reason,
    refund_status = CASE WHEN choice THEN 'ACTION_REQUIRED' ELSE b.refund_status END,
    refund_amount = CASE WHEN choice THEN amount ELSE b.refund_amount END,
    refund_notes = CASE WHEN choice THEN 'Customer to choose reschedule, voucher or refund via My Bookings'
      WHEN paid AND amount > 0 THEN 'Cancelled within 24h of trip start. Booking forfeited per cancellation policy' ELSE b.refund_notes END
    WHERE id = b.id;
  RETURN jsonb_build_object('ok', true, 'is_paid', paid, 'refund_action_required', choice, 'refund_amount', CASE WHEN choice THEN amount ELSE 0 END,
    'late_forfeit', paid AND amount > 0 AND NOT choice);
END $$;
REVOKE ALL ON FUNCTION public.cancel_booking_transaction(uuid, uuid, text, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking_transaction(uuid, uuid, text, boolean, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.expire_single_hold(p_hold_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE h holds%ROWTYPE; b bookings%ROWTYPE; amendment boolean; promo record;
BEGIN
  SELECT * INTO h FROM holds WHERE id = p_hold_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  SELECT * INTO b FROM bookings WHERE id = h.booking_id FOR UPDATE;
  PERFORM id FROM slots WHERE id = h.slot_id AND business_id = b.business_id FOR UPDATE;
  SELECT * INTO h FROM holds WHERE id = p_hold_id FOR UPDATE;
  IF h.status <> 'ACTIVE' THEN RETURN jsonb_build_object('ok', true, 'already', h.status); END IF;
  IF h.expires_at > now() - interval '5 minutes' THEN RETURN jsonb_build_object('ok', false, 'error', 'in_grace'); END IF;
  amendment := COALESCE(h.hold_type IN ('RESCHEDULE', 'ADD_GUESTS'), false);
  -- The original payment never pays for a later amendment.
  IF NOT amendment AND b.status <> 'CANCELLED' AND (b.status IN ('PAID', 'COMPLETED', 'CONFIRMED') OR b.allow_unpaid) THEN
    UPDATE holds SET status = 'CONVERTED' WHERE id = h.id;
    UPDATE slots SET held = GREATEST(0, COALESCE(held, 0) - h.qty), booked = COALESCE(booked, 0) + h.qty
      WHERE id = h.slot_id AND business_id = b.business_id;
    IF b.allow_unpaid AND b.status IN ('HELD', 'PENDING', 'PENDING PAYMENT') THEN UPDATE bookings SET status = 'CONFIRMED' WHERE id = b.id; END IF;
    RETURN jsonb_build_object('ok', true, 'converted', true);
  END IF;
  UPDATE holds SET status = 'EXPIRED' WHERE id = h.id;
  UPDATE slots SET held = GREATEST(0, COALESCE(held, 0) - h.qty) WHERE id = h.slot_id AND business_id = b.business_id;
  IF amendment THEN
    UPDATE pending_reschedules SET status = 'EXPIRED', expired_at = now() WHERE hold_id = h.id AND status = 'PENDING';
  ELSIF b.status NOT IN ('PAID', 'CONFIRMED', 'COMPLETED') THEN
    PERFORM release_voucher_reservations(b.id);
    FOR promo IN DELETE FROM promotion_uses WHERE booking_id = b.id RETURNING promotion_id LOOP
      UPDATE promotions SET used_count = GREATEST(0, used_count - 1) WHERE id = promo.promotion_id;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('ok', true, 'expired', true, 'hold_type', h.hold_type);
END $$;
COMMIT;
