begin;
-- Keep paid value parked for operator handling without exposing customer actions.
ALTER TABLE public.bookings ADD COLUMN cancellation_self_service boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.bookings.cancellation_self_service IS 'Whether customers may resolve an operator cancellation themselves. False leaves compensation with the operator.';
DROP FUNCTION public.cancel_booking_transaction(uuid, uuid, text, boolean, boolean);
CREATE OR REPLACE FUNCTION public.cancel_booking_transaction(
  p_booking_id uuid, p_business_id uuid, p_reason text,
  p_allow_late_choice boolean DEFAULT false, p_weather boolean DEFAULT false,
  p_offer_choice boolean DEFAULT true
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
  -- CONFIRMED reserves places; it does not establish receipt of money.
  -- Retain the established PAID fallback for legacy rows without captured totals.
  cash := CASE WHEN COALESCE(b.total_captured,0)>0 THEN
    LEAST(COALESCE(b.total_amount,0),GREATEST(0,b.total_captured-COALESCE(b.total_refunded,0)))
    WHEN b.status='PAID' THEN GREATEST(0,COALESCE(b.total_amount,0)-COALESCE(b.total_refunded,0)) ELSE 0 END;
  credit := CASE WHEN b.converted_to_voucher_id IS NULL THEN COALESCE(b.voucher_amount_paid, 0) ELSE 0 END;
  IF COALESCE(b.original_total, 0) > 0 AND cash + credit > b.original_total THEN cash := GREATEST(0, b.original_total - credit); END IF;
  amount := CASE WHEN paid AND b.source NOT LIKE 'OTA_%' THEN cash + credit ELSE 0 END;
  SELECT start_time < now() + interval '24 hours' INTO late FROM slots WHERE id = b.slot_id;
  p_offer_choice := COALESCE(p_offer_choice, true);
  choice := amount > 0 AND (NOT p_offer_choice OR p_weather OR p_allow_late_choice OR NOT COALESCE(late, false));
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
    cancellation_self_service = p_offer_choice,
    refund_status = CASE WHEN choice THEN 'ACTION_REQUIRED' ELSE b.refund_status END,
    refund_amount = CASE WHEN choice THEN amount ELSE b.refund_amount END,
    refund_notes = CASE WHEN choice AND NOT p_offer_choice THEN 'Cancellation notified; compensation to be handled by the operator'
      WHEN choice THEN 'Customer to choose reschedule, voucher or refund via My Bookings'
      WHEN paid AND amount > 0 THEN 'Cancelled within 24h of trip start. Booking forfeited per cancellation policy' ELSE b.refund_notes END
    WHERE id = b.id;
  RETURN jsonb_build_object('ok', true, 'is_paid', paid, 'refund_action_required', choice AND p_offer_choice, 'notification_only', NOT p_offer_choice, 'refund_amount', CASE WHEN choice THEN amount ELSE 0 END,
    'late_forfeit', paid AND amount > 0 AND NOT choice);
END $$;
REVOKE ALL ON FUNCTION public.cancel_booking_transaction(uuid, uuid, text, boolean, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_booking_transaction(uuid, uuid, text, boolean, boolean, boolean) TO service_role;
NOTIFY pgrst, 'reload schema';
commit;
