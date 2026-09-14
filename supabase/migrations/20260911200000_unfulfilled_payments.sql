BEGIN;
CREATE OR REPLACE FUNCTION public.record_unfulfilled_payment(
  p_booking_id uuid, p_payment_id text, p_checkout_id text, p_amount_cents integer, p_hold_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b bookings%ROWTYPE; h holds%ROWTYPE; r jsonb;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR p_amount_cents IS NULL OR p_amount_cents <= 0 THEN RETURN jsonb_build_object('ok', false); END IF;
  IF p_hold_id IS NOT NULL THEN
    SELECT * INTO h FROM holds WHERE id = p_hold_id AND booking_id = b.id;
    IF NOT FOUND OR h.metadata->>'yoco_checkout_id' IS DISTINCT FROM p_checkout_id THEN RETURN jsonb_build_object('ok', false); END IF;
    IF h.metadata->>'payment_id' = p_payment_id THEN RETURN jsonb_build_object('ok', true); END IF;
    IF h.status = 'CONVERTED' THEN RETURN jsonb_build_object('ok', false); END IF;
    PERFORM id FROM slots WHERE id = h.slot_id FOR UPDATE;
    SELECT * INTO h FROM holds WHERE id = p_hold_id FOR UPDATE;
    IF h.status = 'ACTIVE' THEN UPDATE slots SET held = GREATEST(0, held - h.qty) WHERE id = h.slot_id; END IF;
    UPDATE holds SET status = 'CANCELLED', metadata = COALESCE(metadata, '{}'::jsonb) ||
      jsonb_build_object('payment_id', p_payment_id, 'captured_cents', p_amount_cents, 'unfulfilled', true) WHERE id = h.id;
    UPDATE pending_reschedules SET status = 'CANCELLED' WHERE hold_id = h.id;
    UPDATE bookings SET total_captured = COALESCE(NULLIF(total_captured, 0), total_amount, 0) + p_amount_cents / 100.0,
      refund_status = 'REQUESTED', refund_amount = p_amount_cents / 100.0, refund_request_id = NULL WHERE id = b.id;
  ELSE
    IF b.yoco_payment_id = p_payment_id AND b.refund_status IN ('REQUESTED', 'REFUND_PENDING', 'REFUNDED', 'FAILED') THEN RETURN jsonb_build_object('ok', true); END IF;
    IF b.yoco_checkout_id IS DISTINCT FROM p_checkout_id OR b.status IN ('PAID', 'COMPLETED') THEN RETURN jsonb_build_object('ok', false); END IF;
    r := cancel_booking_transaction(b.id, b.business_id, 'Payment arrived after the reservation became unavailable', false, false);
    IF NOT COALESCE((r->>'ok')::boolean, false) THEN RETURN r; END IF;
    UPDATE bookings SET total_captured = p_amount_cents / 100.0, yoco_payment_id = p_payment_id,
      payment_status = 'REFUND_PENDING', refund_status = 'REQUESTED', refund_amount = p_amount_cents / 100.0, refund_request_id = NULL WHERE id = b.id;
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.record_unfulfilled_payment(uuid, text, text, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_unfulfilled_payment(uuid, text, text, integer, uuid) TO service_role;
COMMIT;
