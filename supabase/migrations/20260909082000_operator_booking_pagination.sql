begin;

-- One global ordering/offset across ALL slots and unslotted bookings. The
-- previous browser loop applied an offset to each slot batch, then discarded
-- most results. SETOF bookings preserves the existing PostgREST embeds.
create or replace function public.list_operator_bookings(
  p_business_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_limit integer default 51,
  p_offset integer default 0
)
returns setof public.bookings
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select b.* from public.bookings b
  left join public.slots s on s.id = b.slot_id and s.business_id = b.business_id
  where b.business_id = p_business_id
    and (auth.role() = 'service_role' or p_business_id = any((select public.current_business_ids())::uuid[]))
    and (
      s.start_time between p_start and p_end
      or (b.slot_id is null
        and b.status in ('PAID','CONFIRMED','HELD','PENDING','PENDING PAYMENT')
        and b.created_at between p_start and p_end)
    )
  order by b.created_at, b.id
  limit greatest(1, least(coalesce(p_limit, 51), 1000))
  offset greatest(0, coalesce(p_offset, 0));
$$;
revoke all on function public.list_operator_bookings(uuid, timestamptz, timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.list_operator_bookings(uuid, timestamptz, timestamptz, integer, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
