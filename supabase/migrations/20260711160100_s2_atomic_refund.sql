-- S2 (stress-test finding): the refund path was a read-modify-write on
-- total_refunded with no row lock and no DB backstop. Two concurrent refunds
-- both read the same total_refunded, both clamp on stale data, both call Yoco
-- -> double refund of real money. Fix: reserve-before-execute under a row lock,
-- plus a hard CHECK constraint.
--
-- reserve_refund locks the booking row, computes what is still refundable, and
-- atomically increments total_refunded by the reservable amount (clamped),
-- returning what it actually reserved. Callers reserve FIRST, then call Yoco for
-- exactly the reserved amount; on Yoco failure they release the reservation.
-- A second concurrent caller waits on the row lock, then sees the updated
-- total_refunded and can only reserve the remainder (or 0) -> never double-charges.

BEGIN;

CREATE OR REPLACE FUNCTION public.reserve_refund(
  p_booking_id uuid,
  p_amount numeric
)
RETURNS numeric  -- amount actually reserved (0 if nothing left)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_captured  numeric;
  v_refunded  numeric;
  v_reservable numeric;
  v_reserve   numeric;
BEGIN
  SELECT COALESCE(total_captured, total_amount, 0), COALESCE(total_refunded, 0)
    INTO v_captured, v_refunded
    FROM public.bookings
    WHERE id = p_booking_id
    FOR UPDATE;   -- serialize concurrent refunds on this booking

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking not found';
  END IF;

  v_reservable := v_captured - v_refunded;
  v_reserve := LEAST(GREATEST(p_amount, 0), GREATEST(v_reservable, 0));

  IF v_reserve <= 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.bookings
    SET total_refunded = v_refunded + v_reserve
    WHERE id = p_booking_id;

  RETURN v_reserve;
END;
$$;

-- Compensating release when the downstream Yoco refund fails after reserving.
CREATE OR REPLACE FUNCTION public.release_refund_reservation(
  p_booking_id uuid,
  p_amount numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.bookings
    SET total_refunded = GREATEST(0, COALESCE(total_refunded, 0) - GREATEST(p_amount, 0))
    WHERE id = p_booking_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_refund(uuid, numeric) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_refund_reservation(uuid, numeric) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_refund(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_refund_reservation(uuid, numeric) TO service_role;

-- Hard backstop: total_refunded can never exceed captured. Only enforced when
-- total_captured is known (legacy null-captured rows are left alone). NOT VALID
-- so it applies to new writes immediately without a full-table scan; VALIDATE
-- after confirming clean.
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_refund_ceiling
  CHECK (total_captured IS NULL OR COALESCE(total_refunded, 0) <= total_captured)
  NOT VALID;

ALTER TABLE public.bookings VALIDATE CONSTRAINT bookings_refund_ceiling;

COMMIT;
