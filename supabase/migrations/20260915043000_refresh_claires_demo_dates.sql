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
      ('c1a17e50-0000-4000-8000-000000000203'::uuid,  0, '17:30'::time),
      ('c1a17e50-0000-4000-8000-000000000204'::uuid,  0, '07:00'::time),
      ('c1a17e50-0000-4000-8000-000000000205'::uuid, -3, '09:00'::time),
      ('c1a17e50-0000-4000-8000-000000000206'::uuid,  6, '07:00'::time)
  )
  update public.slots as slot
  set start_time = ((v_today + desired.day_offset) + desired.local_time)
    at time zone 'Africa/Johannesburg'
  from desired
  where slot.id = desired.id
    and slot.business_id = p_business_id;

  with desired(id, day_offset, local_time) as (
    values
      ('c1a17e50-0000-4000-8000-000000000301'::uuid, -6, '08:00'::time),
      ('c1a17e50-0000-4000-8000-000000000302'::uuid, -5, '09:00'::time),
      ('c1a17e50-0000-4000-8000-000000000303'::uuid, -4, '10:00'::time),
      ('c1a17e50-0000-4000-8000-000000000304'::uuid, -2, '11:00'::time),
      ('c1a17e50-0000-4000-8000-000000000305'::uuid, -1, '12:00'::time),
      ('c1a17e50-0000-4000-8000-000000000306'::uuid, -1, '13:00'::time),
      ('c1a17e50-0000-4000-8000-000000000307'::uuid, -4, '14:00'::time),
      ('c1a17e50-0000-4000-8000-000000000308'::uuid, -6, '15:00'::time)
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
      ('c1a17e50-0000-4000-8000-000000000501'::uuid,  0, '10:00'::time),
      ('c1a17e50-0000-4000-8000-000000000502'::uuid,  0, '09:00'::time),
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
      ('c1a17e50-0000-4000-8000-000000000601'::uuid,  0, '10:00'::time),
      ('c1a17e50-0000-4000-8000-000000000602'::uuid,  0, '09:00'::time),
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
      ('c1a17e50-0000-4000-8000-000000000701'::uuid,  -1, '11:00'::time),
      ('c1a17e50-0000-4000-8000-000000000702'::uuid, -12, '12:00'::time),
      ('c1a17e50-0000-4000-8000-000000000703'::uuid,  -3, '18:00'::time)
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
