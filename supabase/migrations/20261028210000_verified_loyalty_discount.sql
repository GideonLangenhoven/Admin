-- Loyalty discounts for verified guests on every channel (owner decision 2026-10-28).
-- Verified = a WhatsApp number (Meta), or an email proven by the emailed My Bookings
-- code (booking site and web chat). History now matches the verified email as well as
-- the phone; the booking's discount is set server-side, never from the browser.
BEGIN;

DROP FUNCTION public.resolve_booking_discount(uuid, text, integer);
CREATE FUNCTION public.resolve_booking_discount(p_business_id uuid, p_phone text, p_qty integer, p_email text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p policies%ROWTYPE; rules jsonb; r jsonb; history jsonb; days_since numeric;
  best jsonb := '{"type":"","percent":0,"label":""}'; eligible boolean;
BEGIN
  IF p_qty IS NULL OR p_qty NOT BETWEEN 1 AND 50 THEN RETURN best; END IF;
  SELECT * INTO p FROM policies WHERE business_id = p_business_id;
  IF NOT FOUND THEN RETURN best; END IF;
  rules := COALESCE(p.booking_discount_rules, jsonb_build_array(
    jsonb_build_object('name','Loyalty discount','kind','frequency','enabled',true,'min_guests',1,
      'min_bookings',COALESCE(p.loyalty_bookings_threshold,2),'window_days',COALESCE(p.loyalty_period_days,30),'percent',COALESCE(p.loyalty_discount_percent,10)),
    jsonb_build_object('name','Group discount','kind','group','enabled',true,'min_guests',COALESCE(p.group_discount_min_qty,6),'percent',COALESCE(p.group_discount_percent,5))));
  history := customer_booking_history(p_business_id,p_phone,p_email);
  days_since := extract(epoch FROM (now() - (history->>'last_booking_at')::timestamptz)) / 86400;
  FOR r IN SELECT value FROM jsonb_array_elements(rules) LOOP
    IF (r->>'percent')::numeric NOT BETWEEN 0 AND 100 OR NOT (r->>'enabled')::boolean OR (r->>'percent')::numeric <= (best->>'percent')::numeric
        OR p_qty < (r->>'min_guests')::integer OR p_qty > COALESCE((r->>'max_guests')::integer,50) THEN CONTINUE; END IF;
    eligible := false;
    IF r->>'kind' = 'group' THEN eligible := true;
    ELSIF r->>'kind' = 'frequency' THEN
      eligible := (customer_booking_history(p_business_id,p_phone,p_email,now(),NULL,(r->>'window_days')::integer)->>'window_count')::integer >= (r->>'min_bookings')::integer;
    ELSIF r->>'kind' = 'recency' THEN
      eligible := days_since >= (r->>'min_days')::integer AND (r->>'max_days' IS NULL OR days_since < (r->>'max_days')::integer + 1);
    END IF;
    IF eligible THEN best := jsonb_build_object('type',CASE r->>'kind' WHEN 'group' THEN 'GROUP' WHEN 'frequency' THEN 'LOYALTY' ELSE 'RETURNING' END,
      'percent',(r->>'percent')::numeric,'label',r->>'name'); END IF;
  END LOOP;
  RETURN best;
END $$;
REVOKE ALL ON FUNCTION public.resolve_booking_discount(uuid,text,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_booking_discount(uuid,text,integer,text) TO service_role;

-- create-checkout calls this, before prepare_booking_checkout prices the booking, when the
-- guest proved their email. Only an unpriced, promo-free, non-manual booking under that
-- same email changes, and only to a better discount.
CREATE FUNCTION public.apply_verified_booking_discount(p_booking_id uuid, p_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b bookings%ROWTYPE; d jsonb; current_percent numeric;
BEGIN
  SELECT * INTO b FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR NULLIF(trim(p_email), '') IS NULL OR lower(trim(b.email)) IS DISTINCT FROM lower(trim(p_email))
      OR b.status NOT IN ('DRAFT', 'PENDING', 'HELD', 'PENDING PAYMENT') OR COALESCE(b.total_captured, 0) > 0
      OR NULLIF(trim(b.promo_code), '') IS NOT NULL OR b.discount_type = 'MANUAL'
      OR (b.checkout_priced_at IS NOT NULL AND (b.checkout_request IS NOT NULL OR (b.yoco_checkout_id IS NOT NULL AND b.payment_url IS NOT NULL))) THEN
    RETURN jsonb_build_object('applied', false);
  END IF;
  d := resolve_booking_discount(b.business_id, NULL, b.qty, p_email);
  current_percent := CASE WHEN b.discount_type = 'PERCENT' THEN COALESCE(b.discount_percent, 0) ELSE 0 END;
  IF (d->>'percent')::numeric <= current_percent THEN
    RETURN jsonb_build_object('applied', false);
  END IF;
  UPDATE bookings SET discount_type = 'PERCENT', discount_percent = (d->>'percent')::numeric, discount_amount = NULL,
    discount_notes = d->>'label' WHERE id = b.id;
  RETURN d || jsonb_build_object('applied', true);
END $$;
REVOKE ALL ON FUNCTION public.apply_verified_booking_discount(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_verified_booking_discount(uuid,text) TO service_role;

COMMIT;
