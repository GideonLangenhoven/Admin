-- Claire's guided demo is refreshed at sign-in, so its calendar always rolls
-- from the viewer's current day instead of going stale between demonstrations.
create or replace function public.refresh_claires_hiking_demo_dates(
  p_business_id uuid,
  p_now timestamptz default now()
)
returns date
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Africa/Johannesburg')::date;
begin
  if not exists (
    select 1
    from public.businesses
    where id = p_business_id
      and subdomain = 'claires-hiking'
  ) then
    return null;
  end if;

  with desired(id, day_offset, local_time) as (
    values
      ('c1a17e50-0000-4000-8000-000000000201'::uuid, -1, '07:00'::time),
      ('c1a17e50-0000-4000-8000-000000000202'::uuid, -1, '13:00'::time),
      ('c1a17e50-0000-4000-8000-000000000203'::uuid, 0, '17:30'::time),
      ('c1a17e50-0000-4000-8000-000000000204'::uuid, 0, '07:00'::time),
      ('c1a17e50-0000-4000-8000-000000000205'::uuid, -3, '09:00'::time),
      ('c1a17e50-0000-4000-8000-000000000206'::uuid, 6, '07:00'::time),
      ('c1a17e50-0000-4000-8000-000000000207'::uuid, 0, '09:00'::time),
      ('c1a17e50-0000-4000-8000-000000000208'::uuid, 0, '10:30'::time),
      ('c1a17e50-0000-4000-8000-000000000209'::uuid, -2, '17:30'::time),
      ('c1a17e50-0000-4000-8000-000000000210'::uuid, 1, '07:00'::time),
      ('c1a17e50-0000-4000-8000-000000000211'::uuid, 1, '09:30'::time),
      ('c1a17e50-0000-4000-8000-000000000212'::uuid, 1, '10:00'::time),
      ('c1a17e50-0000-4000-8000-000000000213'::uuid, 1, '17:30'::time),
      ('c1a17e50-0000-4000-8000-000000000214'::uuid, 2, '07:00'::time),
      ('c1a17e50-0000-4000-8000-000000000215'::uuid, 2, '16:30'::time),
      ('c1a17e50-0000-4000-8000-000000000216'::uuid, 3, '09:00'::time),
      ('c1a17e50-0000-4000-8000-000000000217'::uuid, 4, '07:00'::time),
      ('c1a17e50-0000-4000-8000-000000000218'::uuid, 4, '09:00'::time),
      ('c1a17e50-0000-4000-8000-000000000219'::uuid, 5, '10:00'::time),
      ('c1a17e50-0000-4000-8000-000000000220'::uuid, 6, '17:30'::time),
      ('c1a17e50-0000-4000-8000-000000000221'::uuid, 7, '08:00'::time),
      ('c1a17e50-0000-4000-8000-000000000222'::uuid, 8, '07:00'::time),
      ('c1a17e50-0000-4000-8000-000000000223'::uuid, 9, '10:00'::time),
      ('c1a17e50-0000-4000-8000-000000000224'::uuid, 10, '17:00'::time),
      ('c1a17e50-0000-4000-8000-000000000225'::uuid, 12, '09:00'::time),
      ('c1a17e50-0000-4000-8000-000000000226'::uuid, 14, '07:00'::time),
      ('c1a17e50-0000-4000-8000-000000000227'::uuid, 16, '09:00'::time),
      ('c1a17e50-0000-4000-8000-000000000228'::uuid, 18, '10:00'::time),
      ('c1a17e50-0000-4000-8000-000000000229'::uuid, 20, '17:00'::time),
      ('c1a17e50-0000-4000-8000-000000000230'::uuid, 22, '07:00'::time),
      ('c1a17e50-0000-4000-8000-000000000231'::uuid, 24, '09:00'::time),
      ('c1a17e50-0000-4000-8000-000000000232'::uuid, 26, '08:00'::time),
      ('c1a17e50-0000-4000-8000-000000000233'::uuid, 28, '10:00'::time),
      ('c1a17e50-0000-4000-8000-000000000234'::uuid, 30, '17:00'::time)
  )
  update public.slots as slot
  set start_time = ((v_today + desired.day_offset) + desired.local_time)
    at time zone 'Africa/Johannesburg'
  from desired
  where slot.id = desired.id
    and slot.business_id = p_business_id;

  with desired(id, day_offset, local_time) as (
    values
      ('c1a17e50-0000-4000-8000-000000000301'::uuid, -28, '08:00'::time),
      ('c1a17e50-0000-4000-8000-000000000302'::uuid, -24, '09:00'::time),
      ('c1a17e50-0000-4000-8000-000000000303'::uuid, -21, '09:00'::time),
      ('c1a17e50-0000-4000-8000-000000000304'::uuid, -12, '13:00'::time),
      ('c1a17e50-0000-4000-8000-000000000305'::uuid, -9, '12:00'::time),
      ('c1a17e50-0000-4000-8000-000000000306'::uuid, -7, '08:00'::time),
      ('c1a17e50-0000-4000-8000-000000000307'::uuid, -18, '09:00'::time),
      ('c1a17e50-0000-4000-8000-000000000308'::uuid, -2, '15:00'::time),
      ('c1a17e50-0000-4000-8000-000000000309'::uuid, -16, '11:00'::time),
      ('c1a17e50-0000-4000-8000-000000000310'::uuid, -15, '15:00'::time),
      ('c1a17e50-0000-4000-8000-000000000311'::uuid, -10, '08:00'::time),
      ('c1a17e50-0000-4000-8000-000000000312'::uuid, -8, '09:00'::time),
      ('c1a17e50-0000-4000-8000-000000000313'::uuid, -1, '10:00'::time),
      ('c1a17e50-0000-4000-8000-000000000314'::uuid, -7, '11:00'::time),
      ('c1a17e50-0000-4000-8000-000000000315'::uuid, -6, '15:00'::time),
      ('c1a17e50-0000-4000-8000-000000000316'::uuid, -6, '10:00'::time),
      ('c1a17e50-0000-4000-8000-000000000317'::uuid, -5, '11:00'::time),
      ('c1a17e50-0000-4000-8000-000000000318'::uuid, -5, '09:00'::time),
      ('c1a17e50-0000-4000-8000-000000000319'::uuid, -1, '12:00'::time),
      ('c1a17e50-0000-4000-8000-000000000320'::uuid, -4, '11:00'::time),
      ('c1a17e50-0000-4000-8000-000000000321'::uuid, -3, '13:00'::time),
      ('c1a17e50-0000-4000-8000-000000000322'::uuid, -5, '13:00'::time),
      ('c1a17e50-0000-4000-8000-000000000323'::uuid, -2, '16:00'::time),
      ('c1a17e50-0000-4000-8000-000000000324'::uuid, -6, '10:00'::time),
      ('c1a17e50-0000-4000-8000-000000000325'::uuid, -1, '11:00'::time),
      ('c1a17e50-0000-4000-8000-000000000326'::uuid, -8, '12:00'::time),
      ('c1a17e50-0000-4000-8000-000000000327'::uuid, -2, '17:00'::time),
      ('c1a17e50-0000-4000-8000-000000000328'::uuid, -7, '09:00'::time),
      ('c1a17e50-0000-4000-8000-000000000329'::uuid, -3, '10:00'::time),
      ('c1a17e50-0000-4000-8000-000000000330'::uuid, -6, '11:00'::time),
      ('c1a17e50-0000-4000-8000-000000000331'::uuid, -1, '12:00'::time),
      ('c1a17e50-0000-4000-8000-000000000332'::uuid, -5, '13:00'::time),
      ('c1a17e50-0000-4000-8000-000000000333'::uuid, -5, '14:00'::time),
      ('c1a17e50-0000-4000-8000-000000000334'::uuid, -1, '15:00'::time),
      ('c1a17e50-0000-4000-8000-000000000335'::uuid, -3, '14:00'::time),
      ('c1a17e50-0000-4000-8000-000000000336'::uuid, -7, '10:00'::time),
      ('c1a17e50-0000-4000-8000-000000000337'::uuid, -6, '12:00'::time),
      ('c1a17e50-0000-4000-8000-000000000338'::uuid, -4, '11:00'::time),
      ('c1a17e50-0000-4000-8000-000000000339'::uuid, -2, '13:00'::time),
      ('c1a17e50-0000-4000-8000-000000000340'::uuid, -1, '14:00'::time),
      ('c1a17e50-0000-4000-8000-000000000341'::uuid, -4, '10:00'::time),
      ('c1a17e50-0000-4000-8000-000000000342'::uuid, -5, '11:00'::time),
      ('c1a17e50-0000-4000-8000-000000000343'::uuid, -1, '16:00'::time),
      ('c1a17e50-0000-4000-8000-000000000344'::uuid, -3, '13:00'::time),
      ('c1a17e50-0000-4000-8000-000000000345'::uuid, -2, '14:00'::time),
      ('c1a17e50-0000-4000-8000-000000000346'::uuid, -4, '12:00'::time),
      ('c1a17e50-0000-4000-8000-000000000347'::uuid, -2, '16:00'::time),
      ('c1a17e50-0000-4000-8000-000000000348'::uuid, -1, '17:00'::time),
      ('c1a17e50-0000-4000-8000-000000000349'::uuid, -3, '11:00'::time),
      ('c1a17e50-0000-4000-8000-000000000350'::uuid, -1, '15:00'::time)
  )
  update public.bookings as booking
  set created_at = ((v_today + desired.day_offset) + desired.local_time)
    at time zone 'Africa/Johannesburg'
  from desired
  where booking.id = desired.id
    and booking.business_id = p_business_id;

  update public.bookings as booking
  set
    checked_in_at = case when booking.checked_in then slot.start_time - interval '1 hour' else null end,
    waiver_signed_at = case when booking.waiver_status = 'SIGNED' then slot.start_time - interval '1 hour' else null end
  from public.slots as slot
  where booking.slot_id = slot.id
    and booking.business_id = p_business_id
    and slot.business_id = p_business_id;

  update public.customers as customer
  set
    total_bookings = stats.total_bookings,
    total_spent = stats.total_spent,
    first_booking_at = stats.first_booking_at,
    last_booking_at = stats.last_booking_at,
    updated_at = now()
  from (
    select
      customer_id,
      count(*) filter (where status in ('PAID', 'CONFIRMED', 'COMPLETED'))::integer as total_bookings,
      coalesce(sum(total_amount) filter (where status in ('PAID', 'CONFIRMED', 'COMPLETED')), 0) as total_spent,
      min(created_at) filter (where status in ('PAID', 'CONFIRMED', 'COMPLETED')) as first_booking_at,
      max(created_at) filter (where status in ('PAID', 'CONFIRMED', 'COMPLETED')) as last_booking_at
    from public.bookings
    where business_id = p_business_id
      and customer_id is not null
    group by customer_id
  ) as stats
  where customer.id = stats.customer_id
    and customer.business_id = p_business_id;

  update public.invoices as invoice
  set
    tour_date = slot.start_time,
    created_at = booking.created_at
  from public.bookings as booking
  join public.slots as slot on slot.id = booking.slot_id
  where invoice.booking_id = booking.id
    and invoice.business_id = p_business_id
    and booking.business_id = p_business_id
    and slot.business_id = p_business_id;

  with desired(id, day_offset, local_time) as (
    values
      ('c1a17e50-0000-4000-8000-000000000501'::uuid, 0, '10:00'::time),
      ('c1a17e50-0000-4000-8000-000000000502'::uuid, 0, '09:00'::time),
      ('c1a17e50-0000-4000-8000-000000000503'::uuid, -1, '16:00'::time)
  )
  update public.conversations as conversation
  set
    updated_at = ((v_today + desired.day_offset) + desired.local_time) at time zone 'Africa/Johannesburg',
    last_activity_at = ((v_today + desired.day_offset) + desired.local_time) at time zone 'Africa/Johannesburg'
  from desired
  where conversation.id = desired.id
    and conversation.business_id = p_business_id;

  with desired(id, day_offset, local_time) as (
    values
      ('c1a17e50-0000-4000-8000-000000000601'::uuid, 0, '10:00'::time),
      ('c1a17e50-0000-4000-8000-000000000602'::uuid, 0, '09:00'::time),
      ('c1a17e50-0000-4000-8000-000000000603'::uuid, -1, '16:00'::time)
  )
  update public.chat_messages as message
  set created_at = ((v_today + desired.day_offset) + desired.local_time)
    at time zone 'Africa/Johannesburg'
  from desired
  where message.id = desired.id
    and message.business_id = p_business_id;

  with desired(id, day_offset, local_time) as (
    values
      ('c1a17e50-0000-4000-8000-000000000701'::uuid, -1, '11:00'::time),
      ('c1a17e50-0000-4000-8000-000000000702'::uuid, -12, '12:00'::time),
      ('c1a17e50-0000-4000-8000-000000000703'::uuid, -3, '18:00'::time)
  )
  update public.reviews as review
  set submitted_at = ((v_today + desired.day_offset) + desired.local_time)
    at time zone 'Africa/Johannesburg'
  from desired
  where review.id = desired.id
    and review.business_id = p_business_id;

  update public.vouchers
  set expires_at = ((v_today + 365) + time '12:00') at time zone 'Africa/Johannesburg'
  where business_id = p_business_id
    and id in (
      'c1a17e50-0000-4000-8000-000000000801'::uuid,
      'c1a17e50-0000-4000-8000-000000000802'::uuid
    );

  return v_today;
end;
$$;

revoke all on function public.refresh_claires_hiking_demo_dates(uuid, timestamptz) from public;
grant execute on function public.refresh_claires_hiking_demo_dates(uuid, timestamptz) to service_role;
