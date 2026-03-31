-- Filter out time slots that have already passed (e.g. 7am slot on today after 7am)
create or replace function public.list_available_slots(
  p_business_id uuid,
  p_range_start timestamptz,
  p_range_end timestamptz,
  p_tour_id uuid default null
)
returns table (
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
  available_capacity integer
)
language sql
stable
set search_path = public
as $$
  select
    s.id,
    s.start_time,
    s.capacity_total,
    coalesce(s.booked, 0) as booked,
    coalesce(s.held, 0) as held,
    s.status,
    s.tour_id,
    s.price_per_person_override,
    t.name as tour_name,
    t.base_price_per_person,
    public.slot_available_capacity(s.id) as available_capacity
  from public.slots s
  join public.tours t on t.id = s.tour_id
  where s.business_id = p_business_id
    and s.status = 'OPEN'
    and s.start_time >= p_range_start
    and s.start_time < p_range_end
    and s.start_time > now()
    and (p_tour_id is null or s.tour_id = p_tour_id)
  order by s.start_time asc
$$;
