-- Only the existing, payment-test-mode Kayak tenant receives this fixture.
-- Date-based IDs make retries and daily runs additive rather than moving guests.
create or replace function public.refresh_kayak_demo(
  p_business_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Africa/Johannesburg')::date;
  v_day date;
  v_tour record;
  v_slot public.slots%rowtype;
  v_customer_id uuid;
  v_customer_name text;
  v_email text;
  v_booking_id uuid;
  v_invoice_id uuid;
  v_qty integer;
  v_guest integer;
  v_created_at timestamptz;
  v_signed boolean;
  v_inserted integer;
  v_new_bookings integer := 0;
  v_new_slots integer := 0;
  v_names text[] := array[
    'Lerato Mokoena', 'Daniel Jacobs', 'Aisha Khan', 'Thabo Dlamini',
    'Emma Williams', 'Sipho Ndlovu', 'Mia Petersen', 'Noah Adams',
    'Zara Naidoo', 'Ben van Wyk', 'Nandi Khumalo', 'Oliver Smith'
  ];
begin
  if not exists (
    select 1 from public.businesses
    where id = p_business_id
      and id = '44ff11ab-c697-47de-9227-0ffa51db127c'::uuid
      and subdomain = 'kayak'
      and yoco_test_mode is true
  ) then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('kayak-demo:' || p_business_id::text, 0));

  -- The marketing sync already excludes anonymized.local addresses. These
  -- synthetic guests cannot enter marketing automations or receive messages.
  for v_guest in 1..array_length(v_names, 1) loop
    insert into public.customers(id, business_id, email, name, marketing_consent, notes)
    values (
      ('ca7a0de0-0000-4000-8000-' || lpad((900000000000 + v_guest)::text, 12, '0'))::uuid,
      p_business_id,
      'kayak-demo-' || lpad(v_guest::text, 2, '0') || '@anonymized.local',
      v_names[v_guest] || ' (demo)', false,
      'Synthetic Kayak demo guest. No messages or payments.'
    ) on conflict do nothing;
  end loop;

  for v_day in select v_today + n from generate_series(-28, 30) n loop
    for v_tour in
      select t.*, fixture.number, fixture.departure
      from (values
        ('96e07644-315b-4e96-8f36-bb070b665cf8'::uuid, 1, time '08:30'),
        ('33910bd3-6826-4ee4-9dcc-4fcfcaf9097b'::uuid, 2, time '17:30'),
        ('8dbdf290-7a45-4bd9-a07e-77f0176b41ed'::uuid, 3, time '12:00')
      ) fixture(id, number, departure)
      join public.tours t on t.id = fixture.id
      where t.business_id = p_business_id and t.active is true
        and not coalesce(t.hidden, false)
    loop
      insert into public.slots(id, business_id, tour_id, start_time, capacity_total, local_departure_time)
      values (
        ('ca7a0de0-0000-4000-8000-' || to_char(v_day, 'YYYYMMDD') || lpad((100 + v_tour.number)::text, 4, '0'))::uuid,
        p_business_id, v_tour.id,
        (v_day + v_tour.departure) at time zone 'Africa/Johannesburg',
        v_tour.default_capacity, v_tour.departure::text
      ) on conflict do nothing;
      get diagnostics v_inserted = row_count;
      v_new_slots := v_new_slots + v_inserted;

      if v_day > v_today + 14 then continue; end if;
      v_booking_id := ('ca7a0de0-0000-4000-8000-' || to_char(v_day, 'YYYYMMDD') || lpad((200 + v_tour.number)::text, 4, '0'))::uuid;
      if exists (select 1 from public.bookings where id = v_booking_id) then continue; end if;

      -- Lock the departure like checkout does, and never occupy a conflicting
      -- operator-created slot or take seats already booked/held by a visitor.
      select * into v_slot from public.slots
      where id = ('ca7a0de0-0000-4000-8000-' || to_char(v_day, 'YYYYMMDD') || lpad((100 + v_tour.number)::text, 4, '0'))::uuid
        and business_id = p_business_id and tour_id = v_tour.id and status = 'OPEN'
      for update;
      if not found then continue; end if;
      v_qty := 1 + mod(extract(doy from v_day)::integer + v_tour.number, 4);
      if v_slot.capacity_total - v_slot.booked - v_slot.held < v_qty then continue; end if;

      v_guest := 1 + mod(extract(doy from v_day)::integer * 3 + v_tour.number, array_length(v_names, 1));
      v_customer_id := ('ca7a0de0-0000-4000-8000-' || lpad((900000000000 + v_guest)::text, 12, '0'))::uuid;
      v_customer_name := v_names[v_guest] || ' (demo)';
      v_email := 'kayak-demo-' || lpad(v_guest::text, 2, '0') || '@anonymized.local';
      v_created_at := least(
        ((v_day - 7) + time '10:15') at time zone 'Africa/Johannesburg',
        p_now - interval '2 minutes'
      );
      v_signed := v_day < v_today or v_tour.number <> 3;
      v_invoice_id := ('ca7a0de0-0000-4000-8000-' || to_char(v_day, 'YYYYMMDD') || lpad((300 + v_tour.number)::text, 4, '0'))::uuid;

      insert into public.bookings (
        id, business_id, tour_id, slot_id, customer_id, customer_name, email,
        qty, unit_price, total_amount, original_total, total_captured, status,
        source, payment_status, payment_method, external_ref, external_source_details,
        created_at, completed_at, marketing_opt_in, whatsapp_booking_updates_opt_in,
        reminder_queued, thankyou_queued, review_prompted, confirmation_sent_at,
        waiver_status, waiver_signed_at, waiver_signed_name, waiver_payload,
        waiver_token_expires_at, checked_in, checked_in_at, arrived_count
      ) values (
        v_booking_id, p_business_id, v_tour.id, v_slot.id, v_customer_id, v_customer_name, v_email,
        v_qty, v_tour.base_price_per_person, v_qty * v_tour.base_price_per_person,
        v_qty * v_tour.base_price_per_person, v_qty * v_tour.base_price_per_person,
        case when v_day < v_today then 'COMPLETED' else 'CONFIRMED' end,
        'DEMO', 'CAPTURED', 'DEMO', 'KAYAK-DEMO:' || v_day::text || ':' || v_tour.number,
        jsonb_build_object('demo_fixture', 'kayak-daily-v1', 'demo_day', v_day, 'payment_collected', false),
        v_created_at,
        case when v_day < v_today then v_slot.start_time + make_interval(mins => v_tour.duration_minutes) end,
        false, false, true, true, true, v_created_at,
        case when v_signed then 'SIGNED' else 'PENDING' end,
        case when v_signed then least(v_created_at + interval '1 minute', p_now) end,
        case when v_signed then 'Demo guest' end,
        jsonb_build_object('demo_fixture', 'kayak-daily-v1'),
        v_slot.start_time + make_interval(mins => v_tour.duration_minutes),
        v_day < v_today,
        case when v_day < v_today then v_slot.start_time - interval '15 minutes' end,
        case when v_day < v_today then v_qty else 0 end
      );

      insert into public.invoices (
        id, business_id, booking_id, invoice_number, customer_name, customer_email,
        tour_name, tour_date, qty, unit_price, subtotal, total_amount,
        payment_method, payment_reference, status, created_at
      ) values (
        v_invoice_id, p_business_id, v_booking_id,
        'KAYAK-DEMO-' || to_char(v_day, 'YYYYMMDD') || '-' || v_tour.number,
        v_customer_name, v_email, v_tour.name, v_slot.start_time,
        v_qty, v_tour.base_price_per_person, v_qty * v_tour.base_price_per_person,
        v_qty * v_tour.base_price_per_person, 'DEMO', 'Synthetic demo; no payment collected', 'PAID', v_created_at
      );
      update public.bookings set invoice_id = v_invoice_id where id = v_booking_id;
      update public.slots set booked = booked + v_qty where id = v_slot.id;
      v_new_bookings := v_new_bookings + 1;
    end loop;
  end loop;

  -- Complete only our synthetic, still-confirmed departures. Operator edits
  -- such as cancellation/rescheduling are not reset by tomorrow's refresh.
  update public.bookings b
  set status = 'COMPLETED', completed_at = s.start_time + make_interval(mins => t.duration_minutes),
    waiver_status = 'SIGNED', waiver_signed_name = 'Demo guest',
    waiver_signed_at = coalesce(b.waiver_signed_at, s.start_time - interval '1 hour'),
    arrived_count = b.qty, checked_in = true, checked_in_at = s.start_time - interval '15 minutes'
  from public.slots s join public.tours t on t.id = s.tour_id
  where b.business_id = p_business_id and s.business_id = p_business_id
    and b.slot_id = s.id and b.tour_id = t.id
    and b.source = 'DEMO' and b.external_source_details->>'demo_fixture' = 'kayak-daily-v1'
    and b.id::text like 'ca7a0de0-0000-4000-8000-%'
    and b.status = 'CONFIRMED'
    and s.start_time + make_interval(mins => t.duration_minutes) < p_now;

  update public.customers c
  set total_bookings = stats.bookings, total_spent = stats.spent,
    first_booking_at = stats.first_at, last_booking_at = stats.last_at, updated_at = p_now
  from (
    select customer_id, count(*)::integer bookings, sum(total_amount) spent,
      min(created_at) first_at, max(created_at) last_at
    from public.bookings
    where business_id = p_business_id and status in ('PAID', 'CONFIRMED', 'COMPLETED')
    group by customer_id
  ) stats
  where c.id = stats.customer_id and c.business_id = p_business_id
    and c.id between 'ca7a0de0-0000-4000-8000-900000000001'::uuid
      and 'ca7a0de0-0000-4000-8000-900000000012'::uuid;

  return jsonb_build_object('day', v_today, 'new_bookings', v_new_bookings, 'new_slots', v_new_slots);
end;
$$;

revoke all on function public.refresh_kayak_demo(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.refresh_kayak_demo(uuid, timestamptz) to service_role;

-- Preserve the operator's identities, prices, capacities, photos and accounts.
update public.tours t set description = fixture.description
from (values
  ('96e07644-315b-4e96-8f36-bb070b665cf8'::uuid,
    'Start the day on the water. A two-hour morning paddle with coastal views and time to enjoy Cape Town from a different perspective. Choose a departure below and make the morning yours.'),
  ('33910bd3-6826-4ee4-9dcc-4fcfcaf9097b'::uuid,
    'Trade the afternoon rush for an evening on the water. This two-hour paddle follows the coast as the light softens, with the city and mountains as your backdrop. Sunset timing and routes depend on conditions.'),
  ('8dbdf290-7a45-4bd9-a07e-77f0176b41ed'::uuid,
    'Take the adventure onto land with a two-hour Table Mountain hike. Enjoy the mountain scenery and a fresh perspective on Cape Town. Bring comfortable walking shoes, water and a sun hat.')
) fixture(id, description)
where t.id = fixture.id and t.business_id = '44ff11ab-c697-47de-9227-0ffa51db127c'::uuid
  and exists (select 1 from public.businesses b where b.id = t.business_id and b.subdomain = 'kayak' and b.yoco_test_mode is true);

update public.businesses set
  hero_eyebrow = 'Cape Town · Ocean & mountain adventures',
  hero_title = 'A little salt air. A whole new perspective.',
  hero_subtitle = 'Morning paddles, sunset skies and mountain trails. Pick your adventure and find a departure that fits your day.',
  hero_image = 'https://ukdsrndqhsatjkmxijuj.supabase.co/storage/v1/object/public/email-images/44ff11ab-c697-47de-9227-0ffa51db127c/tours/1790664015501.jpg',
  color_bg = '#f4f5ef',
  what_to_bring = 'Water, sunscreen, a sun hat and a small waterproof bag for valuables. Bring comfortable walking shoes for the hike.',
  what_to_wear = 'Comfortable clothes suitable for the weather. For paddles, choose clothes you do not mind getting wet and bring a dry layer for afterwards.',
  footer_line_one = 'Cape Town, from a different perspective.',
  footer_line_two = 'Kayak demo experience · Payments run in test mode'
where id = '44ff11ab-c697-47de-9227-0ffa51db127c'::uuid and subdomain = 'kayak' and yoco_test_mode is true;

select public.refresh_kayak_demo('44ff11ab-c697-47de-9227-0ffa51db127c'::uuid);
select public.refresh_claires_hiking_demo_dates('af17838c-fdd6-4b84-97c0-1cea39db7c0a'::uuid);

-- pg_cron uses UTC: 22:07 is 00:07 the next day in South Africa.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'refresh-kayak-demo-daily') then
    perform cron.unschedule('refresh-kayak-demo-daily');
  end if;
  perform cron.schedule('refresh-kayak-demo-daily', '7 22 * * *',
    $command$select public.refresh_kayak_demo('44ff11ab-c697-47de-9227-0ffa51db127c'::uuid);$command$);
end;
$$;
