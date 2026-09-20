BEGIN;
ALTER TABLE public.holds ADD COLUMN IF NOT EXISTS checkout_request jsonb;
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS checkout_request jsonb;
CREATE OR REPLACE FUNCTION public.save_checkout_request(p_booking_id uuid, p_hold_id uuid, p_voucher_id uuid, p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE saved jsonb; expected integer; b bookings%ROWTYPE; h holds%ROWTYPE; v vouchers%ROWTYPE;
BEGIN
  IF p_booking_id IS NOT NULL THEN
    SELECT * INTO b FROM bookings WHERE id = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Booking not found'); END IF;
    IF p_hold_id IS NOT NULL THEN
      SELECT * INTO h FROM holds WHERE id = p_hold_id AND booking_id = b.id FOR UPDATE;
      IF NOT FOUND OR h.status <> 'ACTIVE' OR h.expires_at <= now() THEN RETURN jsonb_build_object('ok', false, 'error', 'Reservation expired'); END IF;
      saved := h.checkout_request; expected := round((h.metadata->>'diff')::numeric * 100)::integer;
    ELSE
      IF b.status NOT IN ('HELD', 'PENDING', 'PENDING PAYMENT', 'CONFIRMED') THEN RETURN jsonb_build_object('ok', false, 'error', 'Booking is no longer awaiting payment'); END IF;
      saved := b.checkout_request; expected := b.expected_amount_cents;
    END IF;
  ELSE
    SELECT * INTO v FROM vouchers WHERE id = p_voucher_id FOR UPDATE;
    IF NOT FOUND OR v.status <> 'PENDING' THEN RETURN jsonb_build_object('ok', false, 'error', 'Voucher is no longer awaiting payment'); END IF;
    saved := v.checkout_request; expected := round(v.value * 100)::integer;
  END IF;
  IF saved IS NULL THEN
    IF expected IS NULL OR expected <= 0 OR expected IS DISTINCT FROM (p_request->'body'->>'amount')::integer THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Price changed. Please try again.');
    END IF;
    saved := p_request || jsonb_build_object('id', gen_random_uuid());
    IF p_hold_id IS NOT NULL THEN UPDATE holds SET checkout_request = saved WHERE id = p_hold_id;
    ELSIF p_booking_id IS NOT NULL THEN UPDATE bookings SET checkout_request = saved WHERE id = p_booking_id;
    ELSE UPDATE vouchers SET checkout_request = saved WHERE id = p_voucher_id;
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'request', saved);
END $$;
REVOKE ALL ON FUNCTION public.save_checkout_request(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_checkout_request(uuid, uuid, uuid, jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.protect_checkout_request()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() IN ('anon', 'authenticated') THEN
    NEW.checkout_request := CASE WHEN TG_OP = 'UPDATE' THEN OLD.checkout_request ELSE NULL END;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_checkout_request BEFORE INSERT OR UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.protect_checkout_request();
CREATE TRIGGER protect_checkout_request BEFORE INSERT OR UPDATE ON public.holds FOR EACH ROW EXECUTE FUNCTION public.protect_checkout_request();
CREATE TRIGGER protect_checkout_request BEFORE INSERT OR UPDATE ON public.vouchers FOR EACH ROW EXECUTE FUNCTION public.protect_checkout_request();
COMMIT;
