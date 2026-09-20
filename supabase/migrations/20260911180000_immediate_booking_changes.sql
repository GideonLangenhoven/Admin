BEGIN;
-- A seat move/reduction and its credit must either all commit or all roll back.
CREATE OR REPLACE FUNCTION public.apply_booking_change(
  p_booking_id uuid, p_old_slot_id uuid, p_old_qty integer, p_old_value numeric,
  p_new_slot_id uuid, p_new_qty integer, p_new_unit_price numeric,
  p_new_total numeric, p_excess_action text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  b bookings%ROWTYPE; s slots%ROWTYPE; unpaid boolean; cancelled boolean; cash numeric; credit numeric;
  excess numeric; voucher_share numeric; cash_share numeric; voucher_amount numeric := 0; refund numeric := 0;
  voucher_id uuid; voucher_code text; held_qty integer; expiry timestamptz; pct numeric; result jsonb; attempt integer;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR b.status NOT IN ('PENDING', 'PENDING PAYMENT', 'HELD', 'PAID', 'CONFIRMED', 'CANCELLED')
      OR p_new_qty IS NULL OR p_new_qty < 1 OR p_new_qty > 50 OR p_new_total IS NULL OR p_new_total < 0 OR p_new_unit_price < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid booking change');
  END IF;
  cash := COALESCE(b.total_amount, 0); credit := CASE WHEN b.converted_to_voucher_id IS NULL THEN COALESCE(b.voucher_amount_paid, 0) ELSE 0 END;
  IF COALESCE(b.original_total, 0) > 0 AND cash + credit > b.original_total THEN cash := GREATEST(0, b.original_total - credit); END IF;
  IF b.slot_id IS DISTINCT FROM p_old_slot_id OR b.qty IS DISTINCT FROM p_old_qty OR round(cash + credit, 2) <> round(p_old_value, 2) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Booking changed. Refresh before trying again.');
  END IF;
  unpaid := b.status IN ('PENDING', 'PENDING PAYMENT', 'HELD'); cancelled := b.status = 'CANCELLED';
  IF b.refund_status IN ('REQUESTED', 'MANUAL_EFT_REQUIRED', 'REFUND_PENDING', 'FAILED') OR
      EXISTS(SELECT 1 FROM holds WHERE booking_id = b.id AND status = 'ACTIVE' AND hold_type IN ('ADD_GUESTS', 'RESCHEDULE')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Finish the pending payment or refund before changing this booking.');
  END IF;
  IF unpaid AND (b.yoco_checkout_id IS NOT NULL OR b.checkout_request IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Complete payment before changing this booking, or cancel it and create a new booking.');
  END IF;
  IF cancelled AND (b.refund_status IS DISTINCT FROM 'ACTION_REQUIRED' OR b.converted_to_voucher_id IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This cancellation no longer has available booking credit.');
  END IF;
  PERFORM id FROM slots WHERE id IN (b.slot_id, p_new_slot_id) ORDER BY id FOR UPDATE;
  SELECT * INTO s FROM slots WHERE id = p_new_slot_id AND business_id = b.business_id;
  IF NOT FOUND OR (p_new_slot_id <> b.slot_id AND (s.status IN ('CLOSED', 'CANCELLED') OR s.start_time <= now() + interval '60 minutes')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This departure is no longer available');
  END IF;
  SELECT COALESCE(sum(qty), 0), max(expires_at) INTO held_qty, expiry FROM holds
    WHERE booking_id = b.id AND slot_id = b.slot_id AND status = 'ACTIVE' AND COALESCE(hold_type, 'BOOKING') NOT IN ('RESCHEDULE', 'ADD_GUESTS');
  IF s.capacity_total - COALESCE(s.booked, 0) - COALESCE(s.held, 0)
      + (CASE WHEN s.id = b.slot_id THEN CASE WHEN unpaid THEN held_qty WHEN NOT cancelled THEN b.qty ELSE 0 END ELSE 0 END) < p_new_qty THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not enough spots available');
  END IF;
  excess := round(cash + credit - p_new_total, 2);
  IF NOT unpaid AND excess < 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'This change requires payment first'); END IF;
  IF NOT unpaid AND excess > 0 AND COALESCE(p_excess_action, '') NOT IN ('REFUND', 'VOUCHER') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Choose how to receive the price difference');
  END IF;
  voucher_share := LEAST(GREATEST(0, excess), credit); cash_share := GREATEST(0, excess - voucher_share);
  IF NOT unpaid AND excess > 0 THEN
    voucher_amount := CASE WHEN p_excess_action = 'VOUCHER' THEN excess ELSE voucher_share END;
    IF p_excess_action = 'REFUND' AND cash_share > 0 THEN
      pct := CASE WHEN cancelled THEN 100 WHEN s.id <> b.slot_id THEN 95 ELSE calculate_refund_percent(b.business_id, s.start_time) END;
      refund := LEAST(round(cash_share * pct / 100, 2), GREATEST(0, COALESCE(NULLIF(b.total_captured, 0), cash) - COALESCE(b.total_refunded, 0)));
    END IF;
    IF voucher_amount > 0 THEN
      FOR attempt IN 1..5 LOOP
        BEGIN
          voucher_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
          INSERT INTO vouchers(business_id, code, status, type, value, current_balance, source_booking_id, expires_at)
            VALUES(b.business_id, voucher_code, 'ACTIVE', 'CREDIT', voucher_amount, voucher_amount, b.id, now() + interval '3 years') RETURNING id INTO voucher_id;
          EXIT;
        EXCEPTION WHEN unique_violation THEN IF attempt = 5 THEN RAISE; END IF;
        END;
      END LOOP;
    END IF;
  END IF;
  IF unpaid THEN
    UPDATE slots SET held = GREATEST(0, COALESCE(held, 0) - held_qty) WHERE id = b.slot_id;
    UPDATE holds SET status = 'CANCELLED' WHERE booking_id = b.id AND status = 'ACTIVE';
    UPDATE bookings SET slot_id = s.id, tour_id = s.tour_id, qty = p_new_qty, unit_price = p_new_unit_price,
      total_amount = GREATEST(0, p_new_total - credit), original_total = p_new_total, checkout_priced_at = NULL WHERE id = b.id;
    result := create_hold_with_capacity_check(b.id, s.id, p_new_qty, GREATEST(now() + interval '15 minutes', COALESCE(expiry, b.payment_deadline)));
    IF NOT COALESCE((result->>'success')::boolean, false) THEN RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = result->>'error'; END IF;
  ELSE
    IF NOT cancelled THEN UPDATE slots SET booked = GREATEST(0, COALESCE(booked, 0) - b.qty) WHERE id = b.slot_id; END IF;
    UPDATE slots SET booked = COALESCE(booked, 0) + p_new_qty WHERE id = s.id;
    INSERT INTO holds(booking_id, slot_id, qty, status, expires_at, hold_type) VALUES(b.id, s.id, p_new_qty, 'CONVERTED', now(), 'BOOKING');
    UPDATE bookings SET status = CASE WHEN cancelled THEN 'PAID' ELSE b.status END,
      slot_id = s.id, tour_id = s.tour_id, qty = p_new_qty, unit_price = p_new_unit_price,
      total_amount = p_new_total - (credit - voucher_share), voucher_amount_paid = credit - voucher_share, original_total = p_new_total,
      refund_status = CASE WHEN refund > 0 THEN 'REQUESTED' ELSE NULL END, refund_amount = refund, refund_request_id = NULL,
      -- Cash exchanged for a credit voucher is no longer refundable to the card.
      total_refunded = COALESCE(total_refunded, 0) + CASE WHEN p_excess_action = 'VOUCHER' THEN cash_share ELSE 0 END,
      cancelled_at = NULL, cancellation_reason = NULL,
      checked_in = CASE WHEN s.id <> b.slot_id THEN false ELSE b.checked_in END,
      checked_in_at = CASE WHEN s.id <> b.slot_id THEN NULL ELSE b.checked_in_at END,
      waiver_status = CASE WHEN s.tour_id <> b.tour_id OR p_new_qty > b.qty THEN 'PENDING' ELSE b.waiver_status END,
      waiver_token = CASE WHEN s.tour_id <> b.tour_id OR p_new_qty > b.qty THEN gen_random_uuid() ELSE b.waiver_token END
      WHERE id = b.id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'new_total', p_new_total, 'diff', 0, 'voucher_code', voucher_code,
    'voucher_amount', voucher_amount, 'refund_amount', refund, 'refund_status', CASE WHEN refund > 0 THEN 'REQUESTED' ELSE NULL END);
EXCEPTION WHEN SQLSTATE 'PZ001' THEN RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END $$;
REVOKE ALL ON FUNCTION public.apply_booking_change(uuid, uuid, integer, numeric, uuid, integer, numeric, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_booking_change(uuid, uuid, integer, numeric, uuid, integer, numeric, numeric, text) TO service_role;
COMMIT;
