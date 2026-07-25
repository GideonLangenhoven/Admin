-- Last-minute deals: operator sets a cutoff (hours before departure) and a
-- fixed discounted price per person. A cron stamps the existing
-- slots.price_per_person_override so every price path (booking site, bots,
-- widget, admin, and the server-side check in create-checkout) picks it up
-- without any new pricing logic.

ALTER TABLE public.tours
  ADD COLUMN IF NOT EXISTS last_minute_hours integer,
  ADD COLUMN IF NOT EXISTS last_minute_price numeric;

ALTER TABLE public.slots
  ADD COLUMN IF NOT EXISTS last_minute_at timestamptz;

-- Deal lookups (storefront banner) are always "upcoming + stamped"
CREATE INDEX IF NOT EXISTS idx_slots_last_minute
  ON public.slots (business_id, start_time)
  WHERE last_minute_at IS NOT NULL;

-- Applies every operator's last-minute rule in one statement. Called by
-- cron-tasks (service role) every 5 minutes.
CREATE OR REPLACE FUNCTION public.apply_last_minute_deals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.slots s
     SET price_per_person_override = t.last_minute_price,
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
     AND s.start_time > now()
     AND s.start_time <= now() + make_interval(hours => t.last_minute_hours)
     AND COALESCE(s.booked, 0) + COALESCE(s.held, 0) < s.capacity_total
     -- never raise a price: skip slots already cheaper than the deal
     AND COALESCE(s.price_per_person_override, t.base_price_per_person) > t.last_minute_price;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Cron-only. Supabase's default EXECUTE grant is to PUBLIC (anon/authenticated
-- inherit it), so revoke there and re-grant to the one role that calls this.
REVOKE EXECUTE ON FUNCTION public.apply_last_minute_deals() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_last_minute_deals() TO service_role;

-- Admin reschedule previews need to know a slot is discounted so they quote
-- the same price rebook-booking charges (base price, not the deal price).
DROP FUNCTION IF EXISTS public.list_available_slots(uuid, timestamptz, timestamptz, uuid);

CREATE FUNCTION public.list_available_slots(
  p_business_id uuid,
  p_range_start timestamptz,
  p_range_end timestamptz,
  p_tour_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  start_time timestamptz,
  capacity_total integer,
  booked integer,
  held integer,
  status text,
  tour_id uuid,
  price_per_person_override numeric,
  tour_name text,
  base_price_per_person numeric,
  available_capacity integer,
  last_minute_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    s.id,
    s.start_time,
    s.capacity_total,
    COALESCE(s.booked, 0) AS booked,
    COALESCE(s.held, 0) AS held,
    s.status,
    s.tour_id,
    s.price_per_person_override,
    t.name AS tour_name,
    t.base_price_per_person,
    public.slot_available_capacity(s.id) AS available_capacity,
    s.last_minute_at
  FROM public.slots s
  JOIN public.tours t ON t.id = s.tour_id
  WHERE s.business_id = p_business_id
    AND s.status = 'OPEN'
    AND s.start_time >= p_range_start
    AND s.start_time < p_range_end
    AND s.start_time > now()
    AND (p_tour_id IS NULL OR s.tour_id = p_tour_id)
  ORDER BY s.start_time ASC
$$;

GRANT EXECUTE ON FUNCTION public.list_available_slots(uuid, timestamptz, timestamptz, uuid) TO authenticated, service_role;
