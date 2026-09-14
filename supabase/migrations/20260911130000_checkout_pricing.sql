-- One authoritative quote for storefront, operator and conversational checkout.
BEGIN;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checkout_priced_at timestamptz, ADD COLUMN IF NOT EXISTS checkout_request jsonb;

CREATE OR REPLACE FUNCTION public.create_hold_with_capacity_check(
  p_booking_id uuid, p_slot_id uuid, p_qty integer, p_expires_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  b bookings%ROWTYPE; s slots%ROWTYPE; h holds%ROWTYPE; own_qty integer;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR p_qty IS NULL OR p_qty <= 0 OR p_qty > 50 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid booking or quantity');
  END IF;
  IF auth.role() = 'anon' AND (bt_request_header('x-booking-id') IS DISTINCT FROM b.id::text
      OR bt_request_header('x-booking-waiver-token') IS DISTINCT FROM b.waiver_token::text
      OR bt_request_header('x-tenant-business-id') IS DISTINCT FROM b.business_id::text) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking verification required');
  END IF;
  IF b.status NOT IN ('DRAFT', 'PENDING', 'HELD', 'PENDING PAYMENT')
      OR b.slot_id IS DISTINCT FROM p_slot_id OR b.qty <> p_qty THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking changed. Please refresh.');
  END IF;
  SELECT * INTO s FROM slots WHERE id = p_slot_id FOR UPDATE;
  IF NOT FOUND OR s.business_id <> b.business_id OR s.tour_id <> b.tour_id
      OR s.status IN ('CLOSED', 'CANCELLED') OR s.start_time <= now() + interval '60 minutes' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This time slot is no longer available');
  END IF;
  SELECT * INTO h FROM holds WHERE booking_id = b.id AND slot_id = s.id
    AND status = 'ACTIVE' AND COALESCE(hold_type, 'BOOKING') NOT IN ('RESCHEDULE', 'ADD_GUESTS')
    ORDER BY expires_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    SELECT COALESCE(sum(qty), 0) INTO own_qty FROM holds WHERE booking_id = b.id AND slot_id = s.id AND status = 'ACTIVE' AND COALESCE(hold_type, 'BOOKING') NOT IN ('RESCHEDULE', 'ADD_GUESTS');
    IF h.expires_at <= now() OR own_qty <> p_qty THEN
      RETURN jsonb_build_object('success', false, 'error', 'Reservation expired. Please choose a time again.');
    END IF;
    RETURN jsonb_build_object('success', true, 'hold_id', h.id, 'expires_at', h.expires_at);
  END IF;
  IF s.capacity_total - COALESCE(s.booked, 0) - COALESCE(s.held, 0) < p_qty THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sorry, those spots were just taken. Please choose another time.');
  END IF;
  INSERT INTO holds(booking_id, slot_id, qty, status, expires_at)
    VALUES(b.id, s.id, p_qty, 'ACTIVE', GREATEST(now() + interval '1 minute', LEAST(COALESCE(p_expires_at, now() + interval '15 minutes'), now() + interval '24 hours'))) RETURNING * INTO h;
  UPDATE slots SET held = COALESCE(held, 0) + p_qty WHERE id = s.id;
  RETURN jsonb_build_object('success', true, 'hold_id', h.id, 'expires_at', h.expires_at);
END $$;

CREATE OR REPLACE FUNCTION public.prepare_booking_checkout(
  p_booking_id uuid, p_promo_code text DEFAULT NULL,
  p_voucher_ids uuid[] DEFAULT NULL, p_voucher_codes text[] DEFAULT NULL,
  p_add_ons jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  b bookings%ROWTYPE; s slots%ROWTYPE; p promotions%ROWTYPE;
  v vouchers%ROWTYPE; item jsonb; r jsonb;
  unit numeric; gross numeric; discount numeric := 0; credit numeric := 0; net numeric;
  addon_price numeric; addon_qty integer; promo text; ids uuid[]; hold_result jsonb;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR b.status NOT IN ('DRAFT', 'PENDING', 'HELD', 'PENDING PAYMENT', 'CONFIRMED') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Booking is no longer awaiting payment');
  END IF;
  -- An issued checkout is immutable. Retrying must neither reprice it nor reserve twice.
  IF b.checkout_priced_at IS NOT NULL AND (b.checkout_request IS NOT NULL OR (b.yoco_checkout_id IS NOT NULL AND b.payment_url IS NOT NULL)) THEN
    RETURN jsonb_build_object('ok', true, 'amount', b.total_amount, 'redirectUrl', b.payment_url,
      'checkout_id', b.yoco_checkout_id, 'expires_at', (SELECT max(expires_at) FROM holds WHERE booking_id = b.id AND status = 'ACTIVE'));
  END IF;
  SELECT * INTO s FROM slots WHERE id = b.slot_id AND business_id = b.business_id AND tour_id = b.tour_id FOR UPDATE;
  IF NOT FOUND OR s.status IN ('CLOSED', 'CANCELLED') OR b.qty <= 0 OR b.qty > 50 THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'This departure is no longer available';
  END IF;
  SELECT COALESCE(s.price_per_person_override, base_price_per_person) INTO unit FROM tours
    WHERE id = b.tour_id AND business_id = b.business_id;
  IF unit IS NULL OR unit < 0 THEN RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'Tour price unavailable'; END IF;
  IF p_add_ons IS NOT NULL THEN
    IF jsonb_typeof(p_add_ons) <> 'array' OR jsonb_array_length(p_add_ons) > 50 THEN
      RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'Invalid extras';
    END IF;
    DELETE FROM booking_add_ons WHERE booking_id = b.id;
    FOR item IN SELECT value FROM jsonb_array_elements(p_add_ons) LOOP
      addon_qty := (item->>'qty')::integer;
      SELECT price INTO addon_price FROM add_ons WHERE id = (item->>'id')::uuid AND business_id = b.business_id AND active;
      IF NOT FOUND OR addon_qty IS NULL OR addon_qty <= 0 OR addon_qty > 50 THEN
        RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'An extra is no longer available';
      END IF;
      INSERT INTO booking_add_ons(booking_id, add_on_id, qty, unit_price) VALUES(b.id, (item->>'id')::uuid, addon_qty, addon_price);
    END LOOP;
  END IF;
  -- Re-read saved extra prices as well: anonymous inserts cannot supply a price.
  UPDATE booking_add_ons ba SET unit_price = a.price FROM add_ons a WHERE ba.booking_id = b.id AND ba.add_on_id = a.id AND a.business_id = b.business_id;
  IF EXISTS(SELECT 1 FROM booking_add_ons ba LEFT JOIN add_ons a ON a.id = ba.add_on_id AND a.business_id = b.business_id WHERE ba.booking_id = b.id AND (a.id IS NULL OR ba.qty < 1 OR ba.qty > 50 OR ba.unit_price < 0)) THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'Invalid saved extras';
  END IF;
  gross := round(unit * b.qty + COALESCE((SELECT sum(unit_price * qty) FROM booking_add_ons WHERE booking_id = b.id), 0), 2);
  promo := NULLIF(trim(COALESCE(p_promo_code, b.promo_code)), '');
  IF promo IS NOT NULL THEN
    SELECT * INTO p FROM promotions WHERE business_id = b.business_id AND upper(code) = upper(promo) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'Invalid promo code'; END IF;
    -- The use is reserved for this booking until payment or hold cancellation.
    IF NOT EXISTS(SELECT 1 FROM promotion_uses WHERE promotion_id = p.id AND booking_id = b.id) THEN
      IF NOT p.active OR p.valid_from > now() OR p.valid_until < now()
          OR (p.max_uses IS NOT NULL AND p.used_count >= p.max_uses) OR gross < COALESCE(p.min_order_amount, 0)
          OR EXISTS(SELECT 1 FROM promotion_uses WHERE promotion_id = p.id AND lower(trim(email)) = lower(trim(b.email))) THEN
        RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'This promo code is no longer available for this booking';
      END IF;
      INSERT INTO promotion_uses(promotion_id, email, booking_id) VALUES(p.id, lower(trim(b.email)), b.id);
      UPDATE promotions SET used_count = used_count + 1 WHERE id = p.id;
    END IF;
    discount := LEAST(gross, round(CASE WHEN p.discount_type = 'PERCENT' THEN gross * p.discount_value / 100 ELSE p.discount_value END, 2));
  ELSE
    discount := LEAST(gross, GREATEST(0, round(CASE WHEN b.discount_type = 'PERCENT' THEN gross * COALESCE(b.discount_percent, 0) / 100 ELSE COALESCE(b.discount_amount, 0) END, 2)));
  END IF;
  net := gross - discount;
  IF b.status <> 'CONFIRMED' THEN
    hold_result := create_hold_with_capacity_check(b.id, b.slot_id, b.qty, COALESCE(b.payment_deadline, now() + interval '15 minutes'));
    IF NOT COALESCE((hold_result->>'success')::boolean, false) THEN
      RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = COALESCE(hold_result->>'error', 'No capacity');
    END IF;
  END IF;
  ids := p_voucher_ids;
  IF p_voucher_ids IS NULL AND p_voucher_codes IS NULL THEN
    SELECT array_agg(voucher_id) INTO ids FROM voucher_reservations WHERE booking_id = b.id AND status = 'reserved';
  END IF;
  IF COALESCE(cardinality(ids), 0) = 0 AND COALESCE(cardinality(p_voucher_codes), 0) > 0 THEN
    SELECT array_agg(id) INTO ids FROM vouchers WHERE business_id = b.business_id AND code = ANY(p_voucher_codes);
    IF COALESCE(cardinality(ids), 0) <> (SELECT count(DISTINCT x) FROM unnest(p_voucher_codes) x) THEN
      RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'Voucher not valid for this operator';
    END IF;
  END IF;
  UPDATE voucher_reservations SET status = 'released' WHERE booking_id = b.id AND status = 'reserved';
  -- Preserve credit already settled by a trusted operator flow.
  SELECT COALESCE(sum(amount), 0) INTO credit FROM voucher_reservations WHERE booking_id = b.id AND status = 'settled';
  FOR v IN SELECT * FROM vouchers WHERE id = ANY(ids) ORDER BY id FOR UPDATE LOOP
    IF v.business_id <> b.business_id OR v.status <> 'ACTIVE' OR v.expires_at <= now() THEN
      RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'A voucher is no longer available';
    END IF;
    IF net > credit THEN
      r := reserve_voucher_amount(v.id, b.id, b.business_id, net - credit);
      credit := credit + COALESCE((r->>'reserved')::numeric, 0);
    END IF;
  END LOOP;
  IF COALESCE(cardinality(ids), 0) > 0 AND (SELECT count(*) FROM vouchers WHERE id = ANY(ids)) <> (SELECT count(DISTINCT x) FROM unnest(ids) x) THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'Voucher not found';
  END IF;
  IF COALESCE(b.voucher_amount_paid, 0) > 0 AND credit = 0 AND COALESCE(cardinality(ids), 0) = 0 AND p_voucher_ids IS NULL AND p_voucher_codes IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'Please supply the voucher used for this booking';
  END IF;
  UPDATE bookings SET unit_price = unit, original_total = gross, total_amount = net - credit,
    voucher_amount_paid = credit, discount_amount = discount, promo_code = promo,
    discount_type = CASE WHEN promo IS NOT NULL THEN p.discount_type ELSE b.discount_type END,
    discount_percent = CASE WHEN promo IS NOT NULL AND p.discount_type = 'PERCENT' THEN p.discount_value::integer WHEN promo IS NOT NULL THEN 0 ELSE b.discount_percent END,
    expected_amount_cents = round((net - credit) * 100)::integer, checkout_priced_at = now(),
    status = CASE WHEN b.status = 'CONFIRMED' THEN b.status ELSE 'HELD' END WHERE id = b.id;
  RETURN jsonb_build_object('ok', true, 'amount', net - credit, 'total', net, 'voucher_amount', credit,
    'promo_id', p.id, 'promo_code', promo, 'expires_at', hold_result->>'expires_at');
EXCEPTION WHEN SQLSTATE 'PZ001' THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END $$;
REVOKE ALL ON FUNCTION public.prepare_booking_checkout(uuid, text, uuid[], text[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_booking_checkout(uuid, text, uuid[], text[], jsonb) TO service_role;


CREATE OR REPLACE FUNCTION public.strip_anon_booking_money()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() = 'anon' THEN
    NEW.unit_price := OLD.unit_price;
    NEW.total_amount := OLD.total_amount;
    NEW.original_total := OLD.original_total;
    NEW.voucher_amount_paid := OLD.voucher_amount_paid;
    NEW.discount_type := OLD.discount_type;
    NEW.discount_percent := OLD.discount_percent;
    NEW.discount_amount := OLD.discount_amount;
    NEW.promo_code := OLD.promo_code;
    -- status transitions to PAID happen only via privileged paths
    IF NEW.status = 'PAID' AND OLD.status <> 'PAID' THEN
      NEW.status := OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.zero_anon_booking_money()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() = 'anon' THEN
    NEW.unit_price := 0;
    NEW.total_amount := 0;
    NEW.original_total := 0;
    NEW.voucher_amount_paid := 0;
    NEW.discount_type := NULL;
    NEW.discount_percent := NULL;
    NEW.discount_amount := NULL;
    NEW.promo_code := NULL;
    IF NEW.status NOT IN ('DRAFT', 'PENDING') THEN
      NEW.status := 'DRAFT';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_booking_payment(
  p_booking_id uuid, p_payment_id text, p_captured_cents integer, p_currency text DEFAULT 'ZAR'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bk bookings%ROWTYPE;
  v_slot slots%ROWTYPE;
  v_expected integer;
  v_held integer;
  v_counted integer;
  v_settle jsonb;
BEGIN
  IF p_captured_cents IS NULL OR p_captured_cents < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;
  SELECT * INTO v_bk FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF v_bk.status IN ('PAID', 'COMPLETED') THEN
    RETURN jsonb_build_object('ok', true, 'already_paid', true);
  END IF;
  IF v_bk.status NOT IN ('HELD', 'PENDING', 'PENDING PAYMENT', 'CONFIRMED') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_status');
  END IF;
  IF p_captured_cents = 0 AND (v_bk.checkout_priced_at IS NULL OR v_bk.total_amount <> 0) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;
  SELECT * INTO v_slot FROM slots WHERE id = v_bk.slot_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'slot_not_found'); END IF;
  IF v_slot.business_id <> v_bk.business_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tenant_mismatch');
  END IF;
  IF v_slot.status IN ('CLOSED', 'CANCELLED') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'slot_closed');
  END IF;
  v_expected := COALESCE(v_bk.expected_amount_cents, ROUND(COALESCE(v_bk.total_amount, 0) * 100)::integer);
  IF p_captured_cents <> v_expected
      OR upper(p_currency) IS DISTINCT FROM upper(COALESCE(v_bk.expected_currency, 'ZAR')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount_mismatch',
      'expected_cents', v_expected, 'captured_cents', p_captured_cents);
  END IF;
  SELECT COALESCE(SUM(qty), 0) INTO v_held FROM (
    SELECT qty FROM holds WHERE booking_id = p_booking_id AND slot_id = v_bk.slot_id
      AND status = 'ACTIVE' AND COALESCE(hold_type, 'BOOKING') NOT IN ('RESCHEDULE', 'ADD_GUESTS') FOR UPDATE
  ) own_holds;
  SELECT LEAST(v_bk.qty, COALESCE(sum(qty), 0)) INTO v_counted FROM holds WHERE booking_id = v_bk.id AND slot_id = v_bk.slot_id AND status = 'CONVERTED';
  IF v_bk.qty IS NULL OR v_bk.qty <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_quantity');
  END IF;
  IF v_slot.capacity_total - COALESCE(v_slot.booked, 0)
      - GREATEST(0, COALESCE(v_slot.held, 0) - v_held) < v_bk.qty - v_counted THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_capacity');
  END IF;
  -- Every capacity check precedes settlement. A funding error rolls back its
  -- deductions; unexpected SQL errors roll back the entire RPC transaction.
  v_settle := settle_voucher_reservations(p_booking_id);
  IF NOT COALESCE((v_settle->>'success')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voucher_shortfall', 'shortfall', v_settle->>'shortfall');
  END IF;
  UPDATE holds SET status = 'CONVERTED' WHERE booking_id = p_booking_id
    AND slot_id = v_bk.slot_id AND status = 'ACTIVE' AND COALESCE(hold_type, 'BOOKING') NOT IN ('RESCHEDULE', 'ADD_GUESTS');
  UPDATE slots SET booked = COALESCE(booked, 0) + v_bk.qty - v_counted,
    held = GREATEST(0, COALESCE(held, 0) - v_held) WHERE id = v_bk.slot_id;
  UPDATE bookings SET status = 'PAID', yoco_payment_id = p_payment_id,
    total_captured = p_captured_cents / 100.0, payment_status = 'CAPTURED' WHERE id = p_booking_id;
  RETURN jsonb_build_object('ok', true, 'captured_cents', p_captured_cents);
END;
$$;

-- Legacy conversational callers use the same quote and capacity transaction.
CREATE OR REPLACE FUNCTION public.confirm_voucher_booking(p_booking_id uuid, p_voucher_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r jsonb; b bookings%ROWTYPE; remainders jsonb;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF b.status = 'PAID' THEN RETURN jsonb_build_object('ok', true, 'already_paid', true); END IF;
  r := prepare_booking_checkout(p_booking_id, NULL, p_voucher_ids);
  IF NOT COALESCE((r->>'ok')::boolean, false) THEN RETURN r; END IF;
  IF (r->>'amount')::numeric <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'insufficient_voucher';
  END IF;
  r := confirm_booking_payment(p_booking_id, 'VOUCHER_WEB', 0, COALESCE(b.expected_currency, 'ZAR'));
  IF NOT COALESCE((r->>'ok')::boolean, false) THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = r->>'error';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('code', code, 'remaining', current_balance)), '[]'::jsonb)
    INTO remainders FROM vouchers WHERE id = ANY(p_voucher_ids) AND business_id = b.business_id AND current_balance > 0;
  RETURN r || jsonb_build_object('remainders', remainders);
EXCEPTION WHEN SQLSTATE 'PZ001' THEN RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END $$;
REVOKE ALL ON FUNCTION public.confirm_voucher_booking(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_voucher_booking(uuid, uuid[]) TO service_role;
COMMIT;
