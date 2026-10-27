BEGIN;

CREATE FUNCTION public.booking_contact_phone(value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN normalized ~ '^[1-9][0-9]{6,14}$' THEN normalized ELSE NULL END
  FROM (SELECT CASE WHEN digits LIKE '00%' THEN substr(digits, 3)
    WHEN digits LIKE '0%' THEN '27' || substr(digits, 2) ELSE digits END AS normalized
    FROM (SELECT regexp_replace(COALESCE(value, ''), '[^0-9]', '', 'g') AS digits) clean) phones;
$$;
CREATE INDEX bookings_return_email_idx ON public.bookings(business_id, lower(trim(email)), created_at)
  WHERE status IN ('PAID', 'COMPLETED');
CREATE INDEX bookings_return_phone_idx ON public.bookings(business_id, public.booking_contact_phone(phone), created_at)
  WHERE status IN ('PAID', 'COMPLETED');

-- Internal history lookup. Never expose customer activity through public chat RPCs.
CREATE FUNCTION public.customer_booking_history(
  p_business_id uuid, p_phone text DEFAULT NULL, p_email text DEFAULT NULL,
  p_before timestamptz DEFAULT now(), p_exclude_booking_id uuid DEFAULT NULL, p_window_days integer DEFAULT 0
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('last_booking_at', max(b.created_at), 'booking_count', count(*),
    'window_count', count(*) FILTER (WHERE p_window_days = 0 OR b.created_at >= p_before - make_interval(days => p_window_days)))
  FROM bookings b WHERE b.business_id = p_business_id AND b.status IN ('PAID', 'COMPLETED')
    AND b.created_at < p_before AND b.id IS DISTINCT FROM p_exclude_booking_id
    AND ((NULLIF(trim(p_email), '') IS NOT NULL AND lower(trim(b.email)) = lower(trim(p_email)))
      OR (NULLIF(booking_contact_phone(p_phone), '') IS NOT NULL AND booking_contact_phone(b.phone) = booking_contact_phone(p_phone)));
$$;
REVOKE ALL ON FUNCTION public.customer_booking_history(uuid,text,text,timestamptz,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_booking_history(uuid,text,text,timestamptz,uuid,integer) TO service_role;

CREATE FUNCTION public.operator_booking_history(p_business_id uuid, p_booking_ids uuid[])
RETURNS TABLE(booking_id uuid, previous_booking_at timestamptz, previous_booking_count integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT COALESCE(p_business_id = ANY(current_business_ids()), false) THEN
    RAISE EXCEPTION 'Booking access denied' USING ERRCODE = '42501';
  END IF;
  IF cardinality(p_booking_ids) > 200 THEN RAISE EXCEPTION 'Too many bookings'; END IF;
  RETURN QUERY SELECT b.id, (history->>'last_booking_at')::timestamptz, (history->>'booking_count')::integer
    FROM bookings b CROSS JOIN LATERAL customer_booking_history(b.business_id,b.phone,b.email,b.created_at,b.id) history
    WHERE b.business_id = p_business_id AND b.id = ANY(p_booking_ids);
END $$;
REVOKE ALL ON FUNCTION public.operator_booking_history(uuid,uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.operator_booking_history(uuid,uuid[]) TO authenticated, service_role;

ALTER TABLE public.policies ADD COLUMN booking_discount_rules jsonb;
CREATE FUNCTION public.valid_booking_discount_rules(rules jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE r jsonb; n numeric;
BEGIN
  IF jsonb_typeof(rules) IS DISTINCT FROM 'array' OR jsonb_array_length(rules) > 20 THEN RETURN false; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(rules) LOOP
    IF jsonb_typeof(r) <> 'object' OR COALESCE(length(trim(r->>'name')),0) NOT BETWEEN 1 AND 80
        OR COALESCE(r->>'kind','') NOT IN ('frequency','recency','group')
        OR jsonb_typeof(r->'enabled') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
    n := (r->>'percent')::numeric;
    IF n IS NULL OR n <> trunc(n) OR n < 0 OR n > 100 THEN RETURN false; END IF;
    n := (r->>'min_guests')::numeric;
    IF n IS NULL OR n <> trunc(n) OR n NOT BETWEEN 1 AND 50 THEN RETURN false; END IF;
    IF r->>'max_guests' IS NOT NULL THEN
      n := (r->>'max_guests')::numeric;
      IF n <> trunc(n) OR n NOT BETWEEN (r->>'min_guests')::integer AND 50 THEN RETURN false; END IF;
    END IF;
    IF r->>'kind' = 'frequency' THEN
      n := (r->>'min_bookings')::numeric;
      IF n IS NULL OR n <> trunc(n) OR n NOT BETWEEN 1 AND 10000 THEN RETURN false; END IF;
      n := (r->>'window_days')::numeric;
      IF n IS NULL OR n <> trunc(n) OR n NOT BETWEEN 1 AND 3650 THEN RETURN false; END IF;
    ELSIF r->>'kind' = 'recency' THEN
      n := (r->>'min_days')::numeric;
      IF n IS NULL OR n <> trunc(n) OR n NOT BETWEEN 0 AND 36500 THEN RETURN false; END IF;
      IF r->>'max_days' IS NOT NULL THEN
        n := (r->>'max_days')::numeric;
        IF n <> trunc(n) OR n NOT BETWEEN (r->>'min_days')::integer AND 36500 THEN RETURN false; END IF;
      END IF;
    END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
ALTER TABLE public.policies ADD CONSTRAINT policies_booking_discount_rules_valid
  CHECK (booking_discount_rules IS NULL OR valid_booking_discount_rules(booking_discount_rules));

CREATE FUNCTION public.resolve_booking_discount(p_business_id uuid, p_phone text, p_qty integer)
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
  history := customer_booking_history(p_business_id,p_phone);
  days_since := extract(epoch FROM (now() - (history->>'last_booking_at')::timestamptz)) / 86400;
  FOR r IN SELECT value FROM jsonb_array_elements(rules) LOOP
    IF (r->>'percent')::numeric NOT BETWEEN 0 AND 100 OR NOT (r->>'enabled')::boolean OR (r->>'percent')::numeric <= (best->>'percent')::numeric
        OR p_qty < (r->>'min_guests')::integer OR p_qty > COALESCE((r->>'max_guests')::integer,50) THEN CONTINUE; END IF;
    eligible := false;
    IF r->>'kind' = 'group' THEN eligible := true;
    ELSIF r->>'kind' = 'frequency' THEN
      eligible := (customer_booking_history(p_business_id,p_phone,NULL,now(),NULL,(r->>'window_days')::integer)->>'window_count')::integer >= (r->>'min_bookings')::integer;
    ELSIF r->>'kind' = 'recency' THEN
      eligible := days_since >= (r->>'min_days')::integer AND (r->>'max_days' IS NULL OR days_since < (r->>'max_days')::integer + 1);
    END IF;
    IF eligible THEN best := jsonb_build_object('type',CASE r->>'kind' WHEN 'group' THEN 'GROUP' WHEN 'frequency' THEN 'LOYALTY' ELSE 'RETURNING' END,
      'percent',(r->>'percent')::numeric,'label',r->>'name'); END IF;
  END LOOP;
  RETURN best;
END $$;
REVOKE ALL ON FUNCTION public.resolve_booking_discount(uuid,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_booking_discount(uuid,text,integer) TO service_role;
COMMIT;
