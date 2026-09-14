CREATE OR REPLACE FUNCTION public.reserve_refund(p_booking_id uuid, p_amount numeric)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_captured numeric; v_refunded numeric; v_reservable numeric; v_reserve numeric;
BEGIN
  SELECT COALESCE(total_captured, total_amount, 0), COALESCE(total_refunded, 0)
    INTO v_captured, v_refunded
    FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'booking not found'; END IF;
  v_reservable := v_captured - v_refunded;
  v_reserve := LEAST(GREATEST(p_amount, 0), GREATEST(v_reservable, 0));
  IF v_reserve <= 0 THEN RETURN 0; END IF;
  UPDATE public.bookings SET total_refunded = v_refunded + v_reserve WHERE id = p_booking_id;
  RETURN v_reserve;
END; $$;

CREATE OR REPLACE FUNCTION public.release_refund_reservation(p_booking_id uuid, p_amount numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.bookings
    SET total_refunded = GREATEST(0, COALESCE(total_refunded, 0) - GREATEST(p_amount, 0))
    WHERE id = p_booking_id;
END; $$;

REVOKE ALL ON FUNCTION public.reserve_refund(uuid, numeric) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_refund_reservation(uuid, numeric) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_refund(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_refund_reservation(uuid, numeric) TO service_role;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_refund_ceiling
  CHECK (total_captured IS NULL OR COALESCE(total_refunded, 0) <= total_captured) NOT VALID;
ALTER TABLE public.bookings VALIDATE CONSTRAINT bookings_refund_ceiling;;
