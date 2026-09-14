BEGIN;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS yoco_mode text, ADD COLUMN IF NOT EXISTS last_amendment_id uuid;
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS yoco_mode text;
ALTER TABLE public.pending_reschedules
  ADD COLUMN IF NOT EXISTS yoco_checkout_id text,
  ADD COLUMN IF NOT EXISTS yoco_mode text,
  ADD COLUMN IF NOT EXISTS expected_amount_cents integer,
  ADD COLUMN IF NOT EXISTS expected_currency text DEFAULT 'ZAR';

CREATE OR REPLACE FUNCTION public.prepare_booking_amendment(
  p_booking_id uuid, p_new_slot_id uuid, p_new_qty integer,
  p_new_unit_price numeric, p_new_total_amount numeric, p_diff numeric
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  b bookings%ROWTYPE; s slots%ROWTYPE; h holds%ROWTYPE; pr pending_reschedules%ROWTYPE;
  seats integer; kind text; unpaid boolean; expiry timestamptz;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR p_new_qty IS NULL OR p_new_qty < 1 OR p_new_qty > 50 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid booking or guest count');
  END IF;
  IF b.status = 'CANCELLED' AND b.refund_status IN ('REQUESTED', 'REFUND_PENDING', 'MANUAL_EFT_REQUIRED') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Complete the existing refund before rebooking this cancellation');
  END IF;
  unpaid := b.status IN ('HELD', 'PENDING', 'PENDING PAYMENT');
  IF unpaid AND (b.yoco_checkout_id IS NOT NULL OR b.checkout_request IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Complete payment before changing this booking, or cancel it and create a new booking.');
  END IF;
  IF NOT unpaid AND b.status NOT IN ('PAID', 'CONFIRMED')
      AND b.status <> 'CANCELLED' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Booking is not available for changes');
  END IF;
  kind := CASE WHEN p_new_slot_id = b.slot_id THEN 'ADD_GUESTS' ELSE 'RESCHEDULE' END;
  seats := CASE WHEN kind = 'ADD_GUESTS' THEN p_new_qty - b.qty ELSE p_new_qty END;
  IF seats <= 0 OR p_diff < 0 OR (kind = 'ADD_GUESTS' AND round(p_diff, 2) <> round(seats * b.unit_price, 2)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid amendment price');
  END IF;
  SELECT * INTO s FROM slots WHERE id = p_new_slot_id AND business_id = b.business_id FOR UPDATE;
  IF NOT FOUND OR s.status IN ('CLOSED', 'CANCELLED') OR s.start_time <= now() + interval '60 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This departure is no longer available');
  END IF;
  SELECT * INTO h FROM holds WHERE booking_id = b.id AND status = 'ACTIVE'
    AND hold_type IN ('RESCHEDULE', 'ADD_GUESTS') ORDER BY expires_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF h.hold_type <> kind OR h.slot_id <> s.id OR (h.metadata->>'new_qty')::integer IS DISTINCT FROM p_new_qty OR h.expires_at <= now() THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Another booking change is still pending. Please finish it or wait for its hold to expire.');
    END IF;
    SELECT * INTO pr FROM pending_reschedules WHERE hold_id = h.id;
    RETURN jsonb_build_object('ok', true, 'hold_id', h.id, 'pending_reschedule_id', pr.id, 'expires_at', h.expires_at);
  END IF;
  IF s.capacity_total - COALESCE(s.booked, 0) - COALESCE(s.held, 0) < seats THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not enough spots available');
  END IF;
  expiry := CASE WHEN unpaid THEN GREATEST(now() + interval '15 minutes', COALESCE(b.payment_deadline, now())) ELSE now() + interval '15 minutes' END;
  INSERT INTO holds(booking_id, slot_id, qty, status, expires_at, hold_type, metadata)
    VALUES(b.id, s.id, seats, 'ACTIVE', expiry, CASE WHEN unpaid THEN 'BOOKING' ELSE kind END,
      jsonb_build_object('old_qty', b.qty, 'new_qty', p_new_qty, 'old_slot_id', b.slot_id, 'diff', p_diff)) RETURNING * INTO h;
  UPDATE slots SET held = COALESCE(held, 0) + seats WHERE id = s.id;
  IF unpaid AND kind = 'ADD_GUESTS' THEN
    UPDATE bookings SET qty = p_new_qty, total_amount = total_amount + p_diff,
      yoco_checkout_id = NULL, payment_url = NULL, checkout_priced_at = NULL WHERE id = b.id;
  ELSIF kind = 'RESCHEDULE' THEN
    INSERT INTO pending_reschedules(booking_id, business_id, old_slot_id, new_slot_id, hold_id, diff, new_unit_price, new_total_amount, new_tour_id, new_qty)
      VALUES(b.id, b.business_id, b.slot_id, s.id, h.id, p_diff, p_new_unit_price, p_new_total_amount, s.tour_id, p_new_qty) RETURNING * INTO pr;
  END IF;
  RETURN jsonb_build_object('ok', true, 'hold_id', h.id, 'pending_reschedule_id', pr.id, 'expires_at', h.expires_at, 'unpaid', unpaid);
END $$;
REVOKE ALL ON FUNCTION public.prepare_booking_amendment(uuid, uuid, integer, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_booking_amendment(uuid, uuid, integer, numeric, numeric, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_booking_uplift(
  p_booking_id uuid, p_payment_id text, p_checkout_id text, p_captured_cents integer, p_currency text,
  p_hold_id uuid, p_pending_reschedule_id uuid, p_new_qty integer
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  b bookings%ROWTYPE; h holds%ROWTYPE; pr pending_reschedules%ROWTYPE; s slots%ROWTYPE;
  target uuid; new_qty integer; seats integer; own_held integer; expected integer; voucher_paid numeric; cash numeric; cancelled boolean;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  SELECT * INTO h FROM holds WHERE id = p_hold_id AND booking_id = b.id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'hold_not_found'); END IF;
  IF h.metadata->>'payment_id' = p_payment_id AND h.status = 'CONVERTED' THEN
    RETURN jsonb_build_object('ok', true, 'already_paid', true, 'waiver_token', b.waiver_token);
  END IF;
  cancelled := b.status = 'CANCELLED';
  IF b.status NOT IN ('PAID', 'CONFIRMED') AND NOT cancelled THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_status');
  END IF;
  IF p_pending_reschedule_id IS NOT NULL THEN
    SELECT * INTO pr FROM pending_reschedules WHERE id = p_pending_reschedule_id AND booking_id = b.id AND business_id = b.business_id FOR UPDATE;
    IF NOT FOUND OR pr.hold_id IS DISTINCT FROM h.id OR pr.old_slot_id IS DISTINCT FROM b.slot_id OR pr.status NOT IN ('PENDING', 'EXPIRED') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'amendment_changed');
    END IF;
    target := pr.new_slot_id; new_qty := COALESCE(pr.new_qty, b.qty); seats := new_qty;
    expected := round(pr.diff * 100)::integer;
    IF pr.yoco_checkout_id IS DISTINCT FROM p_checkout_id THEN RETURN jsonb_build_object('ok', false, 'error', 'checkout_mismatch'); END IF;
  ELSE
    target := b.slot_id; new_qty := (h.metadata->>'new_qty')::integer; seats := new_qty - b.qty;
    expected := round(seats * b.unit_price * 100)::integer;
    IF h.hold_type <> 'ADD_GUESTS' OR new_qty IS DISTINCT FROM p_new_qty OR (h.metadata->>'old_qty')::integer IS DISTINCT FROM b.qty THEN
      RETURN jsonb_build_object('ok', false, 'error', 'amendment_changed');
    END IF;
  END IF;
  IF h.metadata->>'yoco_checkout_id' IS DISTINCT FROM p_checkout_id THEN RETURN jsonb_build_object('ok', false, 'error', 'checkout_mismatch'); END IF;
  IF p_captured_cents IS NULL OR p_captured_cents <= 0 OR expected <> p_captured_cents
      OR p_captured_cents IS DISTINCT FROM (h.metadata->>'expected_amount_cents')::integer
      OR upper(p_currency) IS DISTINCT FROM upper(COALESCE(h.metadata->>'expected_currency', 'ZAR')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount_mismatch');
  END IF;
  -- All seat changes lock slots in a stable order; booking always comes first.
  PERFORM id FROM slots WHERE id IN (b.slot_id, target) ORDER BY id FOR UPDATE;
  SELECT * INTO s FROM slots WHERE id = target AND business_id = b.business_id;
  IF NOT FOUND OR s.status IN ('CLOSED', 'CANCELLED') THEN RETURN jsonb_build_object('ok', false, 'error', 'slot_closed'); END IF;
  SELECT * INTO h FROM holds WHERE id = p_hold_id FOR UPDATE;
  own_held := CASE WHEN h.status = 'ACTIVE' THEN h.qty ELSE 0 END;
  IF h.status NOT IN ('ACTIVE', 'EXPIRED') OR seats <= 0 OR h.qty <> seats
      OR s.capacity_total - COALESCE(s.booked, 0) - GREATEST(0, COALESCE(s.held, 0) - own_held) < seats THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_capacity');
  END IF;
  voucher_paid := CASE WHEN b.converted_to_voucher_id IS NOT NULL OR (cancelled AND b.refund_status IS DISTINCT FROM 'ACTION_REQUIRED') THEN 0 ELSE COALESCE(b.voucher_amount_paid, 0) END;
  cash := COALESCE(b.total_amount, 0);
  IF COALESCE(b.original_total, 0) > 0 AND cash + voucher_paid > b.original_total THEN cash := GREATEST(0, b.original_total - voucher_paid); END IF;
  IF p_pending_reschedule_id IS NOT NULL THEN
    IF NOT cancelled THEN UPDATE slots SET booked = GREATEST(0, booked - b.qty) WHERE id = b.slot_id; END IF;
    cash := GREATEST(0, pr.new_total_amount - voucher_paid);
    UPDATE pending_reschedules SET status = 'COMPLETED', completed_at = now() WHERE id = pr.id;
  ELSE cash := cash + p_captured_cents / 100.0;
  END IF;
  UPDATE slots SET booked = COALESCE(booked, 0) + seats, held = GREATEST(0, COALESCE(held, 0) - own_held) WHERE id = target;
  UPDATE holds SET status = 'CONVERTED', metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('payment_id', p_payment_id, 'captured_cents', p_captured_cents) WHERE id = h.id;
  UPDATE bookings SET status = 'PAID', slot_id = target, qty = new_qty, last_amendment_id = h.id,
    tour_id = COALESCE(pr.new_tour_id, b.tour_id), unit_price = COALESCE(pr.new_unit_price, b.unit_price),
    total_amount = cash, voucher_amount_paid = voucher_paid, original_total = cash + voucher_paid,
    total_captured = COALESCE(NULLIF(b.total_captured, 0), b.total_amount, 0) + p_captured_cents / 100.0,
    payment_status = 'CAPTURED',
    waiver_status = CASE WHEN new_qty > b.qty OR COALESCE(pr.new_tour_id, b.tour_id) <> b.tour_id THEN 'PENDING' ELSE b.waiver_status END,
    waiver_token = CASE WHEN new_qty > b.qty OR COALESCE(pr.new_tour_id, b.tour_id) <> b.tour_id THEN gen_random_uuid() ELSE b.waiver_token END,
    refund_status = CASE WHEN cancelled THEN NULL ELSE b.refund_status END,
    refund_amount = CASE WHEN cancelled THEN NULL ELSE b.refund_amount END,
    cancelled_at = NULL, cancellation_reason = NULL,
    reschedule_count = b.reschedule_count + CASE WHEN p_pending_reschedule_id IS NOT NULL THEN 1 ELSE 0 END
    WHERE id = b.id RETURNING * INTO b;
  RETURN jsonb_build_object('ok', true, 'waiver_token', b.waiver_token, 'qty', b.qty, 'slot_id', b.slot_id);
END $$;
REVOKE ALL ON FUNCTION public.confirm_booking_uplift(uuid, text, text, integer, text, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_booking_uplift(uuid, text, text, integer, text, uuid, uuid, integer) TO service_role;
COMMIT;
