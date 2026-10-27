BEGIN;

ALTER TABLE public.bookings
  ADD COLUMN payment_failed_at timestamptz,
  ADD COLUMN payment_failure_reason text,
  ADD COLUMN payment_recovery_emailed_at timestamptz;
CREATE INDEX bookings_payment_recovery_idx ON public.bookings(business_id, payment_failed_at DESC)
  WHERE payment_failed_at IS NOT NULL;

CREATE FUNCTION public.protect_payment_recovery_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() IN ('anon', 'authenticated') THEN
    NEW.payment_failed_at := CASE WHEN TG_OP = 'UPDATE' THEN OLD.payment_failed_at END;
    NEW.payment_failure_reason := CASE WHEN TG_OP = 'UPDATE' THEN OLD.payment_failure_reason END;
    NEW.payment_recovery_emailed_at := CASE WHEN TG_OP = 'UPDATE' THEN OLD.payment_recovery_emailed_at END;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_payment_recovery_fields BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.protect_payment_recovery_fields();

-- The booking lock serializes failures with successful payment confirmation.
CREATE FUNCTION public.record_booking_payment_failure(
  p_booking_id uuid, p_business_id uuid, p_checkout_id text, p_payment_id text, p_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b bookings%ROWTYPE; attempts integer;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND OR b.status NOT IN ('HELD', 'PENDING', 'PENDING PAYMENT')
      OR b.yoco_checkout_id IS DISTINCT FROM p_checkout_id OR NULLIF(p_checkout_id, '') IS NULL THEN
    RETURN jsonb_build_object('recorded', false);
  END IF;
  INSERT INTO idempotency_keys(key) VALUES ('yoco_failed:' || b.business_id || ':' ||
    COALESCE(b.yoco_mode, 'legacy') || ':' || COALESCE(NULLIF(p_payment_id, ''), p_checkout_id))
    ON CONFLICT (key) DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('recorded', false); END IF;
  UPDATE bookings SET status = 'PENDING PAYMENT', payment_failed_at = now(),
    payment_failure_reason = left(COALESCE(NULLIF(p_reason, ''), 'Payment was not completed'), 500) WHERE id = b.id;
  INSERT INTO logs(business_id, booking_id, event, payload) VALUES (b.business_id, b.id,
    'booking_payment_failed', jsonb_build_object('checkout_id', p_checkout_id, 'payment_id', p_payment_id));
  SELECT count(*) INTO attempts FROM logs WHERE booking_id = b.id AND event = 'booking_payment_failed';
  RETURN jsonb_build_object('recorded', true, 'count', attempts);
END $$;

CREATE FUNCTION public.prepare_payment_recovery(p_booking_id uuid, p_business_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b bookings%ROWTYPE; s slots%ROWTYPE; result jsonb; credit numeric; expiry timestamptz; funding record;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND OR b.payment_failed_at IS NULL OR b.status NOT IN ('HELD', 'PENDING', 'PENDING PAYMENT')
      OR b.payment_status IN ('CAPTURED', 'MISMATCH_QUARANTINE') OR b.total_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This booking is no longer awaiting payment. Refresh the dashboard.');
  END IF;
  IF NULLIF(trim(b.email), '') IS NULL OR NULLIF(b.payment_url, '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Add a customer email and create a Yoco payment link in the booking first.');
  END IF;
  SELECT COALESCE(sum(amount), 0) INTO credit FROM voucher_reservations
    WHERE booking_id = b.id AND business_id = b.business_id AND status IN ('reserved', 'settled');
  IF abs(credit - COALESCE(b.voucher_amount_paid, 0)) > 0.01 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Voucher funding has expired. Review the booking before sending a payment link.');
  END IF;
  SELECT * INTO s FROM slots WHERE id = b.slot_id AND business_id = b.business_id FOR UPDATE;
  IF NOT FOUND OR s.status IN ('CLOSED', 'CANCELLED') OR s.start_time <= now() + interval '60 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This departure is no longer available. Review the booking first.');
  END IF;
  expiry := LEAST(now() + interval '24 hours', s.start_time - interval '60 minutes');
  SELECT LEAST(expiry, COALESCE(min(v.expires_at), expiry)) INTO expiry
    FROM voucher_reservations vr JOIN vouchers v ON v.id = vr.voucher_id
    WHERE vr.booking_id = b.id AND vr.status = 'reserved';
  -- Explicit operator follow-up renews its own seats; it never takes another hold's capacity.
  UPDATE holds SET expires_at = expiry WHERE booking_id = b.id AND slot_id = s.id
    AND status = 'ACTIVE' AND COALESCE(hold_type, 'BOOKING') NOT IN ('RESCHEDULE', 'ADD_GUESTS');
  result := create_hold_with_capacity_check(b.id, b.slot_id, b.qty, expiry);
  IF NOT COALESCE((result->>'success')::boolean, false) THEN
    RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = COALESCE(result->>'error', 'Reservation unavailable');
  END IF;
  FOR funding IN SELECT vr.voucher_id, vr.amount FROM voucher_reservations vr
      JOIN vouchers v ON v.id = vr.voucher_id WHERE vr.booking_id = b.id AND vr.status = 'reserved'
      ORDER BY v.id FOR UPDATE OF v LOOP
    result := reserve_voucher_amount(funding.voucher_id, b.id, b.business_id, funding.amount);
    IF NOT COALESCE((result->>'success')::boolean, false) OR (result->>'reserved')::numeric <> funding.amount THEN
      RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'Voucher funding is no longer available. Review the booking first.';
    END IF;
  END LOOP;
  UPDATE voucher_reservations SET expires_at = expiry WHERE booking_id = b.id AND status = 'reserved';
  UPDATE holds SET expires_at = expiry WHERE booking_id = b.id AND slot_id = s.id
    AND status = 'ACTIVE' AND COALESCE(hold_type, 'BOOKING') NOT IN ('RESCHEDULE', 'ADD_GUESTS');
  UPDATE bookings SET payment_deadline = expiry WHERE id = b.id;
  RETURN jsonb_build_object('ok', true, 'expires_at', expiry);
EXCEPTION WHEN SQLSTATE 'PZ001' THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END $$;

-- Preserve the failure history already captured by earlier webhook versions.
UPDATE bookings b SET payment_failed_at = latest.failed_at,
  payment_failure_reason = 'Payment was not completed'
FROM (SELECT booking_id, max(created_at) AS failed_at FROM logs
  WHERE event = 'booking_payment_failed' GROUP BY booking_id) latest
WHERE b.id = latest.booking_id;

REVOKE ALL ON FUNCTION public.record_booking_payment_failure(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_payment_recovery(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_booking_payment_failure(uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_payment_recovery(uuid, uuid) TO service_role;
COMMIT;
