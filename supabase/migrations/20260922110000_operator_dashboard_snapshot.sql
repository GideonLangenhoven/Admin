begin;

-- The dashboard previously opened roughly eleven PostgREST requests at once.
-- On the base Micro compute tier, 500 active staff queued at the API/pool even
-- though the underlying statements remained fast. Keep the same data contract
-- in one RLS-preserving statement and index its tenant/time predicates.
create index if not exists idx_bookings_business_created_at
  on public.bookings (business_id, created_at desc);
create index if not exists idx_bookings_business_refund_action
  on public.bookings (business_id, refund_status)
  where refund_status in ('REQUESTED', 'REFUND_PENDING', 'MANUAL_EFT_REQUIRED', 'FAILED');
create index if not exists idx_slots_business_start_time
  on public.slots (business_id, start_time);
create index if not exists idx_conversations_business_status
  on public.conversations (business_id, status);
create index if not exists idx_booking_add_ons_booking_id
  on public.booking_add_ons (booking_id);

create or replace function public.get_operator_dashboard(
  p_business_id uuid,
  p_today_start timestamptz,
  p_tomorrow_start timestamptz,
  p_day_after timestamptz,
  p_week_ago timestamptz,
  p_month_start timestamptz,
  p_now timestamptz default now()
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with authorized as materialized (
    select b.id, b.timezone, b.weather_widget_locations
    from public.businesses b
    where b.id = p_business_id
      and (
        auth.role() = 'service_role'
        or p_business_id = any((select public.current_business_ids())::uuid[])
      )
  ),
  manifest_rows as materialized (
    select
      b.created_at,
      s.start_time,
      jsonb_build_object(
        'id', b.id,
        'business_id', b.business_id,
        'customer_name', b.customer_name,
        'phone', b.phone,
        'qty', b.qty,
        'total_amount', b.total_amount,
        'status', b.status,
        'slot_id', b.slot_id,
        'arrived_count', least(b.qty, greatest(0, coalesce(b.arrived_count, case when b.checked_in then b.qty else 0 end))),
        'checked_in', b.checked_in,
        'custom_fields', b.custom_fields,
        'slots', jsonb_build_object('start_time', s.start_time),
        'tours', jsonb_build_object('name', t.name),
        'add_ons', coalesce((
          select jsonb_agg(
            jsonb_build_object('name', ao.name, 'qty', bao.qty)
            order by ao.name, bao.id
          )
          from public.booking_add_ons bao
          join public.add_ons ao on ao.id = bao.add_on_id
          where bao.booking_id = b.id
        ), '[]'::jsonb)
      ) as item
    from authorized a
    join public.slots s on s.business_id = a.id
      and s.start_time >= p_today_start
      and s.start_time < p_day_after
    join public.bookings b on b.business_id = a.id and b.slot_id = s.id
    join public.tours t on t.id = b.tour_id and t.business_id = a.id
    where b.status in ('PAID', 'CONFIRMED', 'COMPLETED', 'PENDING')
  ),
  manifests as (
    select
      coalesce(jsonb_agg(item order by created_at)
        filter (where start_time < p_tomorrow_start), '[]'::jsonb) as today,
      coalesce(jsonb_agg(item order by created_at)
        filter (where start_time >= p_tomorrow_start), '[]'::jsonb) as tomorrow
    from manifest_rows
  ),
  refund_summary as (
    select count(b.id)::integer as count,
      coalesce(sum(b.refund_amount), 0) as total
    from authorized a
    left join public.bookings b on b.business_id = a.id
      and b.refund_status in ('REQUESTED', 'REFUND_PENDING', 'MANUAL_EFT_REQUIRED', 'FAILED')
  ),
  inbox_summary as (
    select count(c.id)::integer as count
    from authorized a
    left join public.conversations c on c.business_id = a.id and c.status = 'HUMAN'
  ),
  photo_summary as (
    select count(s.id)::integer as outstanding
    from authorized a
    join public.slots s on s.business_id = a.id
      and s.start_time > p_week_ago
      and s.start_time < p_now
      and s.booked > 0
    where not exists (
      select 1
      from public.trip_photos p
      where p.business_id = a.id
        and p.slot_id = s.id
        and p.uploaded_at > p_week_ago
    )
  ),
  revenue_rows as materialized (
    select b.created_at, b.total_amount
    from authorized a
    join public.bookings b on b.business_id = a.id
    where b.status in ('PAID', 'CONFIRMED', 'COMPLETED')
      and b.created_at >= least(p_month_start, p_week_ago)
      and b.created_at <= p_now
  ),
  revenue_days as (
    select (r.created_at at time zone a.timezone)::date as day,
      sum(r.total_amount) as total
    from revenue_rows r
    cross join authorized a
    group by 1
  ),
  revenue_summary as (
    select jsonb_build_object(
      'today', coalesce((select sum(total_amount) from revenue_rows where created_at >= p_today_start), 0),
      'week', coalesce((select sum(total_amount) from revenue_rows where created_at >= p_week_ago), 0),
      'month', coalesce((select sum(total_amount) from revenue_rows where created_at >= p_month_start), 0),
      'series', coalesce((
        select jsonb_agg(coalesce(r.total, 0) order by d.day)
        from authorized a
        cross join lateral generate_series(
          (p_month_start at time zone a.timezone)::date,
          (p_today_start at time zone a.timezone)::date,
          interval '1 day'
        ) as d(day)
        left join revenue_days r on r.day = d.day
      ), '[]'::jsonb)
    ) as value
  )
  select jsonb_build_object(
    'business_id', a.id,
    'weather_widget_locations', a.weather_widget_locations,
    'today_manifest', m.today,
    'tomorrow_manifest', m.tomorrow,
    'refund_count', r.count,
    'refund_total', r.total,
    'inbox_count', i.count,
    'photos_outstanding', p.outstanding,
    'revenue', rev.value
  )
  from authorized a
  cross join manifests m
  cross join refund_summary r
  cross join inbox_summary i
  cross join photo_summary p
  cross join revenue_summary rev
$$;

revoke all on function public.get_operator_dashboard(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.get_operator_dashboard(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz
) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
