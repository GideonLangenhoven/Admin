-- Vouchers are operator-specific: a voucher may only be seen and redeemed in
-- the context of the tenant that issued it. Two gaps allowed cross-tenant use:
--
--   1. vouchers_anon_select matched on the code alone — any operator's booking
--      site could read (and therefore apply) another operator's voucher.
--   2. confirm_voucher_booking (zero-cash web confirmation) never compared the
--      supplied vouchers' business_id to the booking's — a fully-voucher-paid
--      booking at operator B could be confirmed and drained with operator A's
--      voucher.
--
-- Companion code changes: booking app sends x-tenant-business-id with every
-- voucher read; create-checkout validates voucher_amount_paid against ACTIVE
-- same-business vouchers; yoco-webhook scopes its deduction lookups.

BEGIN;

DROP POLICY IF EXISTS vouchers_anon_select ON public.vouchers;
CREATE POLICY vouchers_anon_select ON public.vouchers
  FOR SELECT TO anon, authenticated
  USING (
    upper(regexp_replace(code::text, '\s+', '', 'g')) =
      upper(regexp_replace(public.bt_request_header('x-voucher-code'), '\s+', '', 'g'))
    AND public.bt_request_header('x-voucher-code') <> ''
    AND business_id::text = public.bt_request_header('x-tenant-business-id')
  );

CREATE OR REPLACE FUNCTION public.confirm_voucher_booking(
  p_booking_id uuid,
  p_voucher_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bk           bookings%ROWTYPE;
  v_base         numeric;
  v_override     numeric;
  v_addons       numeric := 0;
  v_server_total numeric;
  v_available    numeric := 0;
  v_remaining    numeric;
  v_hold         jsonb;
  v_ded          jsonb;
  v_vid          uuid;
  v_bal          numeric;
  v_rem          numeric;
  v_code         text;
  v_remainders   jsonb := '[]'::jsonb;
  v_same_biz     boolean;
BEGIN
  -- Lock + guard. Only an unconfirmed booking may be confirmed; PAID is idempotent.
  SELECT * INTO v_bk FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_bk.status = 'PAID' THEN
    RETURN jsonb_build_object('ok', true, 'already_confirmed', true);
  END IF;
  IF v_bk.status NOT IN ('DRAFT', 'PENDING') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bad_status');
  END IF;

  -- Recompute the authoritative pre-voucher total (mirrors create-checkout).
  SELECT base_price_per_person INTO v_base FROM tours WHERE id = v_bk.tour_id;
  v_base := COALESCE(v_base, 0);
  IF v_bk.slot_id IS NOT NULL THEN
    SELECT price_per_person_override INTO v_override FROM slots WHERE id = v_bk.slot_id;
    IF v_override IS NOT NULL THEN v_base := v_override; END IF;
  END IF;
  v_server_total := v_base * COALESCE(v_bk.qty, 1);

  SELECT COALESCE(SUM(COALESCE(unit_price, 0) * COALESCE(qty, 0)), 0)
    INTO v_addons FROM booking_add_ons WHERE booking_id = p_booking_id;
  v_server_total := v_server_total + v_addons;

  -- Stored promo / admin discount, applied as create-checkout does.
  IF v_bk.discount_type = 'PERCENT' AND v_bk.discount_percent IS NOT NULL THEN
    v_server_total := v_server_total * (1 - v_bk.discount_percent / 100.0);
  ELSIF v_bk.discount_amount IS NOT NULL THEN
    v_server_total := v_server_total - v_bk.discount_amount;
  END IF;
  v_server_total := GREATEST(0, ROUND(v_server_total, 2));

  -- Pre-check coverage: lock the supplied ACTIVE, unexpired vouchers and sum
  -- their balances. Vouchers issued by a DIFFERENT operator are ignored —
  -- vouchers are only redeemable with the business that issued them.
  FOREACH v_vid IN ARRAY p_voucher_ids LOOP
    SELECT COALESCE(current_balance, value, 0) INTO v_bal
      FROM vouchers
     WHERE id = v_vid
       AND business_id = v_bk.business_id
       AND status = 'ACTIVE'
       AND (expires_at IS NULL OR expires_at > now())
     FOR UPDATE;
    IF FOUND THEN v_available := v_available + COALESCE(v_bal, 0); END IF;
  END LOOP;

  IF v_available + 0.01 < v_server_total THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_voucher',
                              'required', v_server_total, 'available', v_available);
  END IF;

  -- Reserve capacity before committing. Fails closed if the slot just filled up
  -- or is too close to start time — the customer sees a clean "spots taken".
  v_hold := create_hold_with_capacity_check(
    p_booking_id, v_bk.slot_id, COALESCE(v_bk.qty, 1), now() + interval '60 minutes'
  );
  IF NOT COALESCE((v_hold->>'success')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_capacity',
                              'message', v_hold->>'error');
  END IF;

  -- Drain vouchers in order up to the server total. Skip any voucher that does
  -- not belong to the booking's business — deduct_voucher_balance itself has no
  -- tenant check, so the guard must happen here.
  v_remaining := v_server_total;
  FOREACH v_vid IN ARRAY p_voucher_ids LOOP
    EXIT WHEN v_remaining <= 0;
    SELECT EXISTS (
      SELECT 1 FROM vouchers WHERE id = v_vid AND business_id = v_bk.business_id
    ) INTO v_same_biz;
    IF NOT v_same_biz THEN CONTINUE; END IF;
    v_ded := deduct_voucher_balance(v_vid, v_remaining);
    IF COALESCE((v_ded->>'success')::boolean, false) THEN
      v_remaining := v_remaining - (v_ded->>'deducted')::numeric;
      UPDATE vouchers SET redeemed_booking_id = p_booking_id WHERE id = v_vid;
      v_rem := (v_ded->>'remaining')::numeric;
      IF v_rem > 0 THEN
        SELECT code INTO v_code FROM vouchers WHERE id = v_vid;
        v_remainders := v_remainders || jsonb_build_object('code', v_code, 'remaining', v_rem);
      END IF;
    END IF;
  END LOOP;

  -- Coverage was pre-validated under lock; a shortfall here is impossible unless
  -- a helper misbehaved. Fail closed so nothing is half-committed.
  IF v_remaining > 0.01 THEN
    RAISE EXCEPTION 'voucher coverage shortfall after deduction: %', v_remaining;
  END IF;

  UPDATE bookings
     SET status = 'PAID', yoco_payment_id = 'VOUCHER_WEB'
   WHERE id = p_booking_id;

  RETURN jsonb_build_object('ok', true, 'total', v_server_total, 'remainders', v_remainders);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_voucher_booking(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_voucher_booking(uuid, uuid[]) TO anon, authenticated, service_role;

COMMIT;
