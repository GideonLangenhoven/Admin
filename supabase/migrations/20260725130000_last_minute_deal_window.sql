-- Last-minute deals get a closing edge. Until now last_minute_hours only said
-- when the discount OPENS (N hours before departure) and it then ran all the
-- way to the departure. Operators need to stop discounting once the manifest,
-- gear and guides are committed, so the window is now [start, end):
--
--   last_minute_hours      deal opens this many hours before departure
--   last_minute_end_hours  deal closes this many hours before departure (0 = departure)
--
-- Closing restores the price the deal replaced, so a peak-priced slot does not
-- silently fall back to the tour base price.

ALTER TABLE public.tours
  ADD COLUMN IF NOT EXISTS last_minute_end_hours integer;

ALTER TABLE public.slots
  ADD COLUMN IF NOT EXISTS price_before_deal numeric;

-- The window has to be a window. NULL end = legacy "runs to departure".
ALTER TABLE public.tours DROP CONSTRAINT IF EXISTS tours_last_minute_window_chk;
ALTER TABLE public.tours ADD CONSTRAINT tours_last_minute_window_chk
  CHECK (
    last_minute_end_hours IS NULL
    OR (last_minute_hours IS NOT NULL
        AND last_minute_end_hours >= 0
        AND last_minute_end_hours < last_minute_hours)
  );

CREATE OR REPLACE FUNCTION public.apply_last_minute_deals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_opened integer; v_closed integer;
BEGIN
  -- Open: unsold seats inside the window drop to the deal price.
  UPDATE public.slots s
     SET price_before_deal = s.price_per_person_override,
         price_per_person_override = t.last_minute_price,
         last_minute_at = now()
    FROM public.tours t
   WHERE t.id = s.tour_id
     AND t.business_id = s.business_id
     AND t.last_minute_price IS NOT NULL
     AND t.last_minute_hours IS NOT NULL
     -- ponytail: stamped once and left alone, so editing last_minute_price
     -- only affects slots not yet inside the window. Drop this line (and key
     -- off price instead) if operators need live re-pricing of active deals.
     AND s.last_minute_at IS NULL
     AND s.status = 'OPEN'
     -- NULL end keeps the old behaviour: the deal runs right up to departure.
     AND s.start_time > now() + make_interval(hours => COALESCE(t.last_minute_end_hours, 0))
     AND s.start_time <= now() + make_interval(hours => t.last_minute_hours)
     AND COALESCE(s.booked, 0) + COALESCE(s.held, 0) < s.capacity_total
     -- never raise a price: skip slots already cheaper than the deal
     AND COALESCE(s.price_per_person_override, t.base_price_per_person) > t.last_minute_price;
  GET DIAGNOSTICS v_opened = ROW_COUNT;

  -- Close: past the cut-off the slot goes back to whatever it was priced at
  -- before the deal (NULL = the tour's base price).
  UPDATE public.slots s
     SET price_per_person_override = s.price_before_deal,
         price_before_deal = NULL,
         last_minute_at = NULL
    FROM public.tours t
   WHERE t.id = s.tour_id
     AND t.business_id = s.business_id
     AND s.last_minute_at IS NOT NULL
     AND t.last_minute_end_hours IS NOT NULL
     -- Departed slots keep the price they actually sold at: history, not config.
     AND s.start_time > now()
     AND s.start_time <= now() + make_interval(hours => t.last_minute_end_hours)
     -- A hold means someone is mid-checkout on the quoted deal price, and
     -- create-checkout recomputes the total from this column at pay time.
     -- Closing under them would charge more than the page showed, so wait the
     -- hold out (15 min) instead.
     AND COALESCE(s.held, 0) = 0;
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  RETURN v_opened + v_closed;
END;
$$;

-- Cron-only. Supabase's default EXECUTE grant is to PUBLIC (anon/authenticated
-- inherit it), so revoke there and re-grant to the one role that calls this.
REVOKE EXECUTE ON FUNCTION public.apply_last_minute_deals() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_last_minute_deals() TO service_role;
