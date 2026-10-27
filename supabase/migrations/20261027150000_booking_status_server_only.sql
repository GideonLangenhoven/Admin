-- H2 (go-live 2026-10-27): booking status and refund columns change only on
-- the server. RPCs and edge functions (owner or service_role) keep every
-- privilege; the browser keeps UPDATE on every other column.
--
-- The admin app moved its last direct writers in the same release: Refund &
-- cancel goes through process-refund, Edit booking has no status field,
-- vouchers go through apply_booking_voucher below (then manual-mark-paid when
-- fully covered), and declining a refund calls decline_refund_request below.
BEGIN;

REVOKE UPDATE ON public.bookings FROM authenticated, anon;

DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'bookings'
    AND column_name <> 'status' AND column_name NOT LIKE 'refund\_%';
  EXECUTE format('GRANT UPDATE (%s) ON public.bookings TO authenticated', cols);

  -- The booking site re-saves its own draft as PENDING (policy below); it
  -- never writes refund columns.
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'bookings'
    AND column_name NOT LIKE 'refund\_%';
  EXECUTE format('GRANT UPDATE (%s) ON public.bookings TO anon', cols);
END $$;

-- Was: any status except PAID/CONFIRMED/COMPLETED, so a guest could cancel
-- their own draft without the cancellation flow.
ALTER POLICY bookings_anon_update ON public.bookings
  WITH CHECK (
    status = ANY (ARRAY['DRAFT', 'PENDING'])
    AND (business_id)::text = (SELECT bt_request_header('x-tenant-business-id'))
    AND (id)::text = (SELECT bt_request_header('x-booking-id'))
    AND (waiver_token)::text = NULLIF((SELECT bt_request_header('x-booking-waiver-token')), '')
    AND (SELECT bt_request_header('x-booking-waiver-token')) <> ''
  );

-- Refund queue "Decline": the caller's tenants only (super-admins via
-- current_business_ids), and only while nothing is being paid out.
CREATE OR REPLACE FUNCTION public.decline_refund_request(p_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b bookings%ROWTYPE;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking_id AND business_id = ANY(current_business_ids()) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Booking not found'); END IF;
  IF b.refund_status IS DISTINCT FROM 'REQUESTED' AND b.refund_status IS DISTINCT FROM 'FAILED' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This refund is already being processed. Refresh the queue.');
  END IF;
  UPDATE bookings SET refund_status = 'DECLINED', refund_notes = 'Refund declined by admin' WHERE id = b.id;
  INSERT INTO logs(business_id, booking_id, event, payload)
    VALUES (b.business_id, b.id, 'refund_declined', jsonb_build_object('previous_status', b.refund_status, 'user_id', auth.uid()));
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.decline_refund_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_refund_request(uuid) TO authenticated, service_role;

-- Booking page "Apply code" with a voucher. Was three browser writes (deduct
-- the balance, then the booking total, then status PAID) that could half
-- happen, and never recorded the credit: Mark Paid then failed its voucher
-- check and a payment link repriced the booking to full price. Now one
-- transaction records it as settled credit, which both of those keep.
CREATE OR REPLACE FUNCTION public.apply_booking_voucher(p_booking_id uuid, p_voucher_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b bookings%ROWTYPE; v vouchers%ROWTYPE; balance numeric; trip numeric; cap numeric; take numeric;
BEGIN
  -- Same booking -> voucher -> reservation lock order as settlement.
  SELECT * INTO b FROM bookings WHERE id = p_booking_id AND business_id = ANY(current_business_ids())
    AND status IN ('PENDING', 'HELD', 'PENDING PAYMENT', 'CONFIRMED') FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Only unpaid bookings can take a voucher'); END IF;
  IF COALESCE(b.total_amount, 0) <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'Nothing is left to pay on this booking'); END IF;
  SELECT * INTO v FROM vouchers WHERE id = p_voucher_id AND business_id = b.business_id FOR UPDATE;
  IF NOT FOUND OR v.status <> 'ACTIVE' OR v.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This voucher is not active');
  END IF;
  IF EXISTS (SELECT 1 FROM voucher_reservations WHERE voucher_id = v.id AND booking_id = b.id AND status <> 'released') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This voucher is already on this booking');
  END IF;
  -- Balance not promised to another booking's open checkout.
  balance := COALESCE(v.current_balance, v.value, v.purchase_amount, 0) - (SELECT COALESCE(sum(amount), 0) FROM voucher_reservations
    WHERE voucher_id = v.id AND booking_id <> b.id AND status = 'reserved' AND expires_at > now());
  take := LEAST(balance, b.total_amount);
  IF v.type = 'FREE_TRIP' THEN
    -- Covers its guests' places, up to what was paid for the voucher if the trip now costs more.
    trip := COALESCE(b.unit_price, 0) * LEAST(COALESCE(v.pax_limit, 1), b.qty);
    cap := COALESCE(v.purchase_value, v.purchase_amount, balance);
    take := LEAST(take, CASE WHEN trip > cap THEN cap ELSE trip END);
  END IF;
  take := round(take, 2);
  IF take <= 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'This voucher has no balance left'); END IF;
  UPDATE vouchers SET current_balance = COALESCE(current_balance, value, purchase_amount, 0) - take,
    status = CASE WHEN COALESCE(current_balance, value, purchase_amount, 0) - take <= 0 THEN 'REDEEMED' ELSE status END,
    redeemed_at = CASE WHEN COALESCE(current_balance, value, purchase_amount, 0) - take <= 0 THEN now() ELSE redeemed_at END,
    redeemed_booking_id = b.id
    WHERE id = v.id;
  INSERT INTO voucher_reservations (voucher_id, booking_id, business_id, amount, status)
    VALUES (v.id, b.id, b.business_id, take, 'settled')
    ON CONFLICT (voucher_id, booking_id) DO UPDATE SET amount = EXCLUDED.amount, status = 'settled';
  UPDATE bookings SET total_amount = total_amount - take, voucher_code = v.code,
    voucher_amount_paid = COALESCE(voucher_amount_paid, 0) + take, discount_type = 'VOUCHER'
    WHERE id = b.id;
  INSERT INTO logs(business_id, booking_id, event, payload)
    VALUES (b.business_id, b.id, 'voucher_applied', jsonb_build_object('voucher_id', v.id, 'code', v.code, 'amount', take, 'user_id', auth.uid()));
  RETURN jsonb_build_object('ok', true, 'deducted', take, 'new_total', b.total_amount - take);
END $$;
REVOKE ALL ON FUNCTION public.apply_booking_voucher(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_booking_voucher(uuid, uuid) TO authenticated, service_role;

COMMIT;
