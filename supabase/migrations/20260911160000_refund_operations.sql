-- Durable provider attempts: pending/unknown responses keep their reservation.
BEGIN;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS refund_request_id uuid;
CREATE TABLE IF NOT EXISTS public.refund_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  booking_id uuid NOT NULL REFERENCES public.bookings(id),
  request_id uuid NOT NULL,
  source_business_id uuid NOT NULL REFERENCES public.businesses(id),
  checkout_id text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'ZAR',
  mode text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  provider_id text,
  error text,
  keep_booking boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refund_operations_checkout_idx ON public.refund_operations(checkout_id);
CREATE INDEX IF NOT EXISTS refund_operations_booking_idx ON public.refund_operations(booking_id, request_id);
ALTER TABLE public.refund_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.refund_operations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.refund_operations TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_refund_request(
  p_booking_id uuid, p_business_id uuid, p_amount numeric, p_sources jsonb, p_keep_booking boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b bookings%ROWTYPE; source jsonb; v_request_id uuid; remaining numeric; take numeric; prior numeric; legacy_refunded numeric; result jsonb;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Booking not found'); END IF;
  IF b.refund_request_id IS NOT NULL AND b.refund_status IN ('REFUND_PENDING', 'REFUNDED', 'MANUAL_EFT_REQUIRED') THEN
    SELECT jsonb_agg(to_jsonb(r)) INTO result FROM refund_operations r WHERE r.request_id = b.refund_request_id AND r.booking_id = b.id;
    RETURN jsonb_build_object('ok', true, 'operations', result, 'request_id', b.refund_request_id, 'reused', true);
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR jsonb_typeof(p_sources) <> 'array' THEN RETURN jsonb_build_object('ok', false, 'error', 'Invalid refund'); END IF;
  remaining := LEAST(round(p_amount, 2), GREATEST(0, COALESCE(NULLIF(b.total_captured, 0), b.total_amount) - COALESCE(b.total_refunded, 0)));
  IF remaining <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'Nothing left to refund'); END IF;
  v_request_id := gen_random_uuid();
  legacy_refunded := GREATEST(0, COALESCE(b.total_refunded, 0) - COALESCE((SELECT sum(amount) FROM refund_operations WHERE booking_id = b.id AND status <> 'FAILED'), 0));
  FOR source IN SELECT value FROM jsonb_array_elements(p_sources) LOOP
    SELECT COALESCE(sum(amount), 0) INTO prior FROM refund_operations WHERE booking_id = b.id AND checkout_id = source->>'checkout_id' AND status <> 'FAILED';
    take := LEAST(remaining, GREATEST(0, (source->>'captured')::numeric - prior - legacy_refunded));
    legacy_refunded := GREATEST(0, legacy_refunded - GREATEST(0, (source->>'captured')::numeric - prior));
    IF take > 0 THEN
      INSERT INTO refund_operations(business_id, booking_id, request_id, source_business_id, checkout_id, amount, mode, keep_booking)
        VALUES(b.business_id, b.id, v_request_id, COALESCE((source->>'business_id')::uuid, b.business_id), source->>'checkout_id', take, source->>'mode', p_keep_booking);
      remaining := remaining - take;
    END IF;
    EXIT WHEN remaining = 0;
  END LOOP;
  IF remaining > 0 THEN RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = 'Refund exceeds the recorded checkout payments. Please reconcile the payment first.'; END IF;
  IF NOT p_keep_booking AND b.status <> 'CANCELLED' THEN
    result := cancel_booking_transaction(b.id, b.business_id, 'Refund requested by operator', true, false);
    IF NOT COALESCE((result->>'ok')::boolean, false) THEN RAISE EXCEPTION USING ERRCODE = 'PZ001', MESSAGE = result->>'error'; END IF;
  END IF;
  UPDATE bookings SET total_captured = COALESCE(NULLIF(b.total_captured, 0), b.total_amount),
    total_refunded = COALESCE(b.total_refunded, 0) + (SELECT sum(amount) FROM refund_operations WHERE refund_operations.request_id = v_request_id AND booking_id = b.id),
    refund_request_id = v_request_id, refund_status = 'REFUND_PENDING' WHERE id = b.id;
  SELECT jsonb_agg(to_jsonb(r)) INTO result FROM refund_operations r WHERE r.request_id = v_request_id AND r.booking_id = b.id;
  RETURN jsonb_build_object('ok', true, 'operations', result, 'request_id', v_request_id);
EXCEPTION WHEN SQLSTATE 'PZ001' THEN RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END $$;
REVOKE ALL ON FUNCTION public.reserve_refund_request(uuid, uuid, numeric, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_refund_request(uuid, uuid, numeric, jsonb, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_refund_operation(
  p_operation_id uuid, p_status text, p_provider_id text DEFAULT NULL, p_error text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r refund_operations%ROWTYPE; next_status text;
BEGIN
  SELECT * INTO r FROM refund_operations WHERE id = p_operation_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Refund not found'); END IF;
  PERFORM id FROM bookings WHERE id = r.booking_id FOR UPDATE;
  SELECT * INTO r FROM refund_operations WHERE id = p_operation_id FOR UPDATE;
  IF p_status NOT IN ('PENDING', 'SUCCEEDED', 'FAILED') THEN RETURN jsonb_build_object('ok', false, 'error', 'Invalid refund status'); END IF;
  IF r.status <> 'PENDING' THEN RETURN jsonb_build_object('ok', true, 'already', r.status, 'booking_id', r.booking_id); END IF;
  UPDATE refund_operations SET status = p_status, provider_id = COALESCE(p_provider_id, provider_id), error = p_error, updated_at = now() WHERE id = r.id;
  IF p_status = 'FAILED' THEN UPDATE bookings SET total_refunded = GREATEST(0, COALESCE(total_refunded, 0) - r.amount) WHERE id = r.booking_id; END IF;
  SELECT CASE WHEN bool_or(status = 'PENDING') THEN 'REFUND_PENDING' WHEN bool_or(status = 'FAILED') THEN 'FAILED' ELSE 'REFUNDED' END
    INTO next_status FROM refund_operations WHERE request_id = r.request_id AND booking_id = r.booking_id;
  UPDATE bookings SET refund_status = next_status, refund_error = p_error,
    refund_processed_at = CASE WHEN next_status = 'REFUNDED' THEN now() ELSE refund_processed_at END
    WHERE id = r.booking_id AND refund_request_id = r.request_id;
  RETURN jsonb_build_object('ok', true, 'booking_id', r.booking_id, 'refund_status', next_status);
END $$;
REVOKE ALL ON FUNCTION public.finish_refund_operation(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_refund_operation(uuid, text, text, text) TO service_role;
COMMIT;
