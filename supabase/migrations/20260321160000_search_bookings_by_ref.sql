create or replace function search_bookings_by_ref(p_business_id uuid, p_ref text)
returns table(id uuid) language sql stable security definer as $$
  select b.id
  from bookings b
  where b.business_id = p_business_id
    and b.id::text ilike p_ref || '%'
  limit 20;
$$;
