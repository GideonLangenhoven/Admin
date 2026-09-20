-- First-five-client release: enforce ownership inside elevated RPCs and keep
-- ordinary bookings/slots/customers in the same business even on direct writes.
BEGIN;

-- Storefront inserts use an anonymous client, including after customer sign-in.
-- An authenticated operator must use its own membership policy, so it cannot
-- insert trusted discounts into another business through the public policy.
ALTER POLICY bookings_anon_insert ON public.bookings TO anon;
DROP POLICY bookings_read ON public.bookings;
CREATE POLICY bookings_read ON public.bookings FOR SELECT TO anon, authenticated USING (
  ((SELECT bt_request_header('x-booking-id')) = id::text
    AND (SELECT bt_request_header('x-booking-waiver-token')) = waiver_token::text)
  OR customer_id IN (SELECT id FROM customers WHERE user_id = (SELECT auth.uid()))
  OR business_id = ANY((SELECT current_business_ids())::uuid[])
);
-- POST alone is not a read credential (GraphQL/RPC requests also use POST).
-- The storefront generates its random booking ID and independent waiver proof
-- before INSERT, so INSERT RETURNING follows the same capability as later reads.

CREATE UNIQUE INDEX IF NOT EXISTS tours_id_business_key ON public.tours(id, business_id);
CREATE UNIQUE INDEX IF NOT EXISTS slots_id_business_key ON public.slots(id, business_id);
CREATE UNIQUE INDEX IF NOT EXISTS slots_id_business_tour_key ON public.slots(id, business_id, tour_id);
CREATE UNIQUE INDEX IF NOT EXISTS bookings_id_business_key ON public.bookings(id, business_id);
CREATE UNIQUE INDEX IF NOT EXISTS customers_id_business_key ON public.customers(id, business_id);

ALTER TABLE public.slots DROP CONSTRAINT IF EXISTS slots_tour_id_fkey;
ALTER TABLE public.slots ADD CONSTRAINT slots_tour_id_fkey
  FOREIGN KEY (tour_id, business_id) REFERENCES public.tours(id, business_id) ON DELETE CASCADE;
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_tour_id_fkey;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_tour_id_fkey
  FOREIGN KEY (tour_id, business_id) REFERENCES public.tours(id, business_id);
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_slot_id_fkey;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_slot_id_fkey
  FOREIGN KEY (slot_id, business_id, tour_id) REFERENCES public.slots(id, business_id, tour_id) ON DELETE SET NULL (slot_id);
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_customer_id_fkey;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_customer_id_fkey
  FOREIGN KEY (customer_id, business_id) REFERENCES public.customers(id, business_id) ON DELETE SET NULL (customer_id);

ALTER TABLE public.holds ADD COLUMN IF NOT EXISTS business_id uuid;
UPDATE public.holds h SET business_id = b.business_id FROM public.bookings b
  WHERE h.booking_id = b.id AND h.business_id IS DISTINCT FROM b.business_id;
ALTER TABLE public.holds ALTER COLUMN business_id SET NOT NULL;
CREATE OR REPLACE FUNCTION public.set_hold_business()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  SELECT business_id INTO NEW.business_id FROM public.bookings WHERE id = NEW.booking_id;
  RETURN NEW;
END $$;
CREATE TRIGGER set_hold_business BEFORE INSERT OR UPDATE OF booking_id, business_id ON public.holds
  FOR EACH ROW EXECUTE FUNCTION public.set_hold_business();
ALTER TABLE public.holds DROP CONSTRAINT IF EXISTS holds_booking_id_fkey;
ALTER TABLE public.holds ADD CONSTRAINT holds_booking_id_fkey
  FOREIGN KEY (booking_id, business_id) REFERENCES public.bookings(id, business_id) ON DELETE CASCADE;
ALTER TABLE public.holds DROP CONSTRAINT IF EXISTS holds_slot_id_fkey;
ALTER TABLE public.holds ADD CONSTRAINT holds_slot_id_fkey
  FOREIGN KEY (slot_id, business_id) REFERENCES public.slots(id, business_id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.deduct_voucher_balance(p_voucher_id uuid, p_amount numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row vouchers%ROWTYPE; v_deducted numeric; v_new_balance numeric;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid amount', 'deducted', 0, 'remaining', 0);
  END IF;
  SELECT * INTO v_row FROM vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Voucher not found', 'deducted', 0, 'remaining', 0); END IF;
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT COALESCE(v_row.business_id = ANY(current_business_ids()), false) THEN
    RAISE EXCEPTION 'Voucher access denied' USING ERRCODE = '42501';
  END IF;
  IF v_row.status <> 'ACTIVE' OR (v_row.expires_at IS NOT NULL AND v_row.expires_at < now()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Voucher is not active', 'deducted', 0, 'remaining', COALESCE(v_row.current_balance, 0));
  END IF;
  v_new_balance := COALESCE(v_row.current_balance, v_row.value, v_row.purchase_amount, 0);
  IF v_new_balance <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'No balance remaining', 'deducted', 0, 'remaining', 0); END IF;
  v_deducted := LEAST(p_amount, v_new_balance);
  v_new_balance := v_new_balance - v_deducted;
  UPDATE vouchers SET current_balance = v_new_balance,
    status = CASE WHEN v_new_balance <= 0 THEN 'REDEEMED' ELSE status END,
    redeemed_at = CASE WHEN v_new_balance <= 0 THEN now() ELSE redeemed_at END
    WHERE id = p_voucher_id;
  RETURN jsonb_build_object('success', true, 'deducted', v_deducted, 'remaining', v_new_balance);
END $$;
REVOKE EXECUTE ON FUNCTION public.deduct_voucher_balance(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deduct_voucher_balance(uuid, numeric) TO authenticated, service_role;

-- Keep the tested capacity implementation; add the missing authenticated
-- ownership guard before its existing independent anonymous booking proof.
DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.create_hold_with_capacity_check(uuid,uuid,integer,timestamptz)'::regprocedure) INTO definition;
  IF position('IF auth.role() = ''anon''' in definition) = 0 THEN
    RAISE EXCEPTION 'Expected booking-proof capacity definition is missing';
  END IF;
  definition := replace(definition, 'IF auth.role() = ''anon''',
    'IF auth.role() = ''authenticated'' AND NOT COALESCE(b.business_id = ANY(current_business_ids()), false) THEN
       RAISE EXCEPTION ''Booking access denied'' USING ERRCODE = ''42501'';
     END IF;
     IF auth.role() = ''anon''');
  EXECUTE definition;
END $$;

CREATE OR REPLACE FUNCTION public.calculate_booking_refund(p_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b bookings%ROWTYPE; starts timestamptz; percent integer;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'booking not found'); END IF;
  IF auth.role() IS DISTINCT FROM 'service_role'
    AND NOT COALESCE(b.business_id = ANY(current_business_ids()), false)
    AND NOT EXISTS (SELECT 1 FROM customers WHERE id = b.customer_id AND business_id = b.business_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Booking access denied' USING ERRCODE = '42501';
  END IF;
  SELECT start_time INTO starts FROM slots WHERE id = b.slot_id AND business_id = b.business_id;
  percent := public.calculate_refund_percent(b.business_id, starts);
  RETURN jsonb_build_object('percent', percent, 'amount', round(COALESCE(b.total_amount, 0) * percent / 100.0, 2), 'tour_start', starts, 'now', now());
END $$;
REVOKE EXECUTE ON FUNCTION public.calculate_booking_refund(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_booking_refund(uuid) TO authenticated, service_role;
COMMIT;
