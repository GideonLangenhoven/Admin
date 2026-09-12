CREATE OR REPLACE FUNCTION public.apply_last_minute_deals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_opened integer; v_closed integer;
BEGIN
  UPDATE public.slots s
     SET price_before_deal = CASE WHEN s.last_minute_at IS NULL
                                  THEN s.price_per_person_override
                                  ELSE s.price_before_deal END,
         price_per_person_override = t.last_minute_price,
         last_minute_at = COALESCE(s.last_minute_at, now())
    FROM public.tours t
   WHERE t.id = s.tour_id
     AND t.business_id = s.business_id
     AND t.last_minute_price IS NOT NULL
     AND t.last_minute_hours IS NOT NULL
     AND s.status = 'OPEN'
     AND s.start_time > now() + make_interval(hours => COALESCE(t.last_minute_end_hours, 0))
     AND s.start_time <= now() + make_interval(hours => t.last_minute_hours)
     AND COALESCE(s.booked, 0) + COALESCE(s.held, 0) < s.capacity_total
     AND COALESCE(s.price_before_deal, t.base_price_per_person) > t.last_minute_price
     AND s.price_per_person_override IS DISTINCT FROM t.last_minute_price;
  GET DIAGNOSTICS v_opened = ROW_COUNT;

  UPDATE public.slots s
     SET price_per_person_override = s.price_before_deal,
         price_before_deal = NULL,
         last_minute_at = NULL
    FROM public.tours t
   WHERE t.id = s.tour_id
     AND t.business_id = s.business_id
     AND s.last_minute_at IS NOT NULL
     AND s.start_time > now()
     AND COALESCE(s.held, 0) = 0
     AND NOT (
       t.last_minute_price IS NOT NULL
       AND t.last_minute_hours IS NOT NULL
       AND s.status = 'OPEN'
       AND s.start_time > now() + make_interval(hours => COALESCE(t.last_minute_end_hours, 0))
       AND s.start_time <= now() + make_interval(hours => t.last_minute_hours)
       AND COALESCE(s.booked, 0) + COALESCE(s.held, 0) < s.capacity_total
       AND COALESCE(s.price_before_deal, t.base_price_per_person) > t.last_minute_price
     );
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  RETURN v_opened + v_closed;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_last_minute_deals() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_last_minute_deals() TO service_role;;
