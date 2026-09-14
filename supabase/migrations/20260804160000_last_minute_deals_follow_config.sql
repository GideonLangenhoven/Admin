-- Last-minute deals now follow the tour's current configuration instead of
-- being stamped once and left alone.
--
-- The previous version opened a deal only when slots.last_minute_at was NULL
-- and closed one only when the departure had crossed the cut-off. Nothing ever
-- reacted to the operator editing the tour, so a slot kept whatever price it
-- was stamped with, forever. Observed live: Morning Kayak was configured at
-- R450 over a 24-hour window, while 13 slots — some 48 hours out — were still
-- advertising R300 from an earlier configuration, including on the storefront's
-- "leaving soon at a reduced rate" strip.
--
-- The rule is now a single definition of "qualifies", applied in both
-- directions, so the discounted set is always exactly the set that should be
-- discounted at this moment:
--
--   * the tour has a deal configured, and
--   * the slot is OPEN with unsold seats, and
--   * departure is inside the opening window, and
--   * departure has not yet crossed the cut-off, and
--   * the deal is genuinely a discount on the pre-deal price
--
-- Two guarantees are kept from the original: a departed slot keeps the price it
-- actually sold at (history, not configuration), and a slot with a live hold is
-- left alone, because someone is mid-checkout on the quoted price and
-- create-checkout recomputes the total from this column at payment time.
CREATE OR REPLACE FUNCTION public.apply_last_minute_deals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_opened integer; v_closed integer;
BEGIN
  -- Open or re-price. Re-pricing is why last_minute_at IS NULL is gone: an
  -- already-stamped slot whose price no longer matches the tour is corrected
  -- in place. price_before_deal is captured only on the FIRST stamp, otherwise
  -- a second pass would overwrite the true original with the deal price and
  -- the slot could never be restored.
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
     -- NULL end keeps the old behaviour: the deal runs right up to departure.
     AND s.start_time > now() + make_interval(hours => COALESCE(t.last_minute_end_hours, 0))
     AND s.start_time <= now() + make_interval(hours => t.last_minute_hours)
     AND COALESCE(s.booked, 0) + COALESCE(s.held, 0) < s.capacity_total
     -- Never price above what the slot cost before any deal. Compared against
     -- price_before_deal, not the current override, so raising a deal from
     -- R300 to R450 still applies while R450 stays below the R600 base.
     AND COALESCE(s.price_before_deal, t.base_price_per_person) > t.last_minute_price
     -- Only touch rows that are actually wrong, so the row count means something.
     AND s.price_per_person_override IS DISTINCT FROM t.last_minute_price;
  GET DIAGNOSTICS v_opened = ROW_COUNT;

  -- Close every stamped slot that no longer qualifies: the deal was removed
  -- from the tour, the window was shortened, the slot sold out, it was closed,
  -- or it crossed the cut-off. Restores whatever it was priced at beforehand
  -- (NULL = the tour's base price).
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
GRANT  EXECUTE ON FUNCTION public.apply_last_minute_deals() TO service_role;
