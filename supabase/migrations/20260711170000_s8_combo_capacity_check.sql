-- S8 (stress-test follow-up): combo checkout (create-paysafe-checkout) reserved
-- capacity by incrementing slots.held with NO capacity check, so two concurrent
-- combo checkouts on the same slot could both succeed and overbook. Single
-- bookings are protected by create_hold_with_capacity_check (SELECT FOR UPDATE);
-- combo had no equivalent.
--
-- reserve_combo_capacity does an atomic check-and-increment: the capacity
-- predicate lives in the UPDATE's WHERE, so Postgres row-locks the slot and
-- concurrent callers serialize — the second sees the first's increment and is
-- rejected if it would exceed capacity. Returns true iff it reserved.

CREATE OR REPLACE FUNCTION public.reserve_combo_capacity(
  p_slot_id uuid,
  p_business_id uuid,
  p_qty integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ok boolean;
BEGIN
  UPDATE public.slots
    SET held = COALESCE(held, 0) + p_qty
    WHERE id = p_slot_id
      AND business_id = p_business_id
      AND (capacity_total - COALESCE(booked, 0) - COALESCE(held, 0)) >= p_qty
    RETURNING true INTO v_ok;
  RETURN COALESCE(v_ok, false);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_combo_capacity(uuid, uuid, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_combo_capacity(uuid, uuid, integer) TO service_role;
