create extension if not exists pgcrypto;

alter table public.bookings
  add column if not exists external_ref text;

alter table public.bookings
  add column if not exists external_source_details jsonb not null default '{}'::jsonb;

alter table public.bookings
  add column if not exists supplier_payment_status text;

alter table public.bookings
  add column if not exists supplier_settlement_status text;

alter table public.bookings
  add column if not exists supplier_payout_amount numeric;

alter table public.bookings
  add column if not exists supplier_commission_amount numeric;

create unique index if not exists bookings_external_ref_unique_idx
  on public.bookings (business_id, source, external_ref)
  where external_ref is not null;

create table if not exists public.external_booking_credentials (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  source text not null,
  api_key_hash text not null,
  api_key_last4 text,
  hmac_secret text,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists external_booking_credentials_business_source_unique_idx
  on public.external_booking_credentials (business_id, source);

create unique index if not exists external_booking_credentials_api_key_hash_unique_idx
  on public.external_booking_credentials (api_key_hash);

create table if not exists public.external_product_mappings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  source text not null,
  tour_id uuid not null references public.tours(id) on delete cascade,
  external_product_id text,
  external_product_code text,
  external_product_name text,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint external_product_mappings_identifier_required
    check (
      coalesce(
        nullif(btrim(external_product_id), ''),
        nullif(btrim(external_product_code), ''),
        nullif(btrim(external_product_name), '')
      ) is not null
    )
);

create unique index if not exists external_product_mappings_product_id_unique_idx
  on public.external_product_mappings (business_id, source, external_product_id)
  where external_product_id is not null;

create unique index if not exists external_product_mappings_product_code_unique_idx
  on public.external_product_mappings (business_id, source, external_product_code)
  where external_product_code is not null;

create index if not exists external_product_mappings_product_name_idx
  on public.external_product_mappings (business_id, source, lower(external_product_name))
  where external_product_name is not null;

create table if not exists public.external_webhook_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  source text not null,
  event_id text not null,
  action text,
  external_ref text,
  raw_payload jsonb not null default '{}'::jsonb,
  processed_status text not null default 'RECEIVED',
  http_status integer,
  response_body jsonb,
  retry_count integer not null default 0,
  last_error text,
  received_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz
);

create unique index if not exists external_webhook_events_source_event_unique_idx
  on public.external_webhook_events (business_id, source, event_id);

create index if not exists external_webhook_events_external_ref_idx
  on public.external_webhook_events (business_id, source, external_ref);

create index if not exists external_webhook_events_status_idx
  on public.external_webhook_events (business_id, processed_status, received_at desc);

create or replace function public.ck_seed_external_booking_credentials(
  p_source text,
  p_enable_hmac boolean default true
)
returns table (
  business_id uuid,
  source text,
  api_key text,
  hmac_secret text
)
language plpgsql
as $$
begin
  return query
  with candidates as (
    select
      b.id as business_id,
      upper(trim(p_source)) as source,
      'ckext_' || encode(gen_random_bytes(20), 'hex') as api_key,
      case when p_enable_hmac then encode(gen_random_bytes(32), 'hex') else null end as hmac_secret
    from public.businesses b
    where b.active = true
      and not exists (
        select 1
        from public.external_booking_credentials c
        where c.business_id = b.id
          and c.source = upper(trim(p_source))
      )
  ),
  inserted as (
    insert into public.external_booking_credentials (
      business_id,
      source,
      api_key_hash,
      api_key_last4,
      hmac_secret,
      active
    )
    select
      c.business_id,
      c.source,
      encode(digest(c.api_key, 'sha256'), 'hex'),
      right(c.api_key, 4),
      c.hmac_secret,
      true
    from candidates c
    returning business_id, source
  )
  select c.business_id, c.source, c.api_key, c.hmac_secret
  from candidates c
  inner join inserted i
    on i.business_id = c.business_id
   and i.source = c.source;
end;
$$;

create or replace function public.ck_external_check_availability(
  p_business_id uuid,
  p_tour_id uuid,
  p_date date default null,
  p_time time default null,
  p_qty integer default 1
)
returns jsonb
language plpgsql
as $$
declare
  v_qty integer := greatest(coalesce(p_qty, 1), 1);
  v_slots jsonb := '[]'::jsonb;
begin
  with candidate_slots as (
    select
      s.id,
      s.start_time,
      s.status,
      s.capacity_total,
      s.booked,
      coalesce(s.held, 0) as held,
      greatest(s.capacity_total - s.booked - coalesce(s.held, 0), 0) as available,
      (s.start_time at time zone 'Africa/Johannesburg') as local_start_time
    from public.slots s
    where s.business_id = p_business_id
      and s.tour_id = p_tour_id
      and s.status = 'OPEN'
      and s.start_time > timezone('utc', now())
      and (p_date is null or (s.start_time at time zone 'Africa/Johannesburg')::date = p_date)
      and (p_time is null or to_char(s.start_time at time zone 'Africa/Johannesburg', 'HH24:MI') = to_char(p_time, 'HH24:MI'))
      and greatest(s.capacity_total - s.booked - coalesce(s.held, 0), 0) >= v_qty
    order by s.start_time asc
    limit case when p_date is null then 20 else 500 end
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'slot_id', id,
        'start_time_utc', start_time,
        'start_time_local', to_char(local_start_time, 'Dy DD Mon YYYY HH24:MI'),
        'date', to_char(local_start_time::date, 'YYYY-MM-DD'),
        'time', to_char(local_start_time, 'HH24:MI'),
        'status', status,
        'capacity_total', capacity_total,
        'booked', booked,
        'held', held,
        'available', available
      )
      order by start_time asc
    ),
    '[]'::jsonb
  )
  into v_slots
  from candidate_slots;

  return jsonb_build_object(
    'success', true,
    'code', 'AVAILABILITY_OK',
    'has_availability', jsonb_array_length(v_slots) > 0,
    'slots', v_slots
  );
end;
$$;

create or replace function public.ck_external_create_booking(
  p_business_id uuid,
  p_tour_id uuid,
  p_slot_id uuid,
  p_source text,
  p_external_ref text,
  p_customer_name text default null,
  p_email text default null,
  p_phone text default null,
  p_qty integer default 1,
  p_total_amount numeric default 0,
  p_status text default 'PAID',
  p_supplier_payment_status text default null,
  p_supplier_settlement_status text default null,
  p_supplier_payout_amount numeric default null,
  p_supplier_commission_amount numeric default null,
  p_external_source_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_existing public.bookings%rowtype;
  v_booking public.bookings%rowtype;
  v_slot public.slots%rowtype;
  v_unit_price numeric;
begin
  if coalesce(p_qty, 0) < 1 then
    return jsonb_build_object('success', false, 'code', 'INVALID_QTY');
  end if;

  if p_external_ref is null or btrim(p_external_ref) = '' then
    return jsonb_build_object('success', false, 'code', 'MISSING_EXTERNAL_REF');
  end if;

  select *
  into v_existing
  from public.bookings
  where business_id = p_business_id
    and source = upper(p_source)
    and external_ref = p_external_ref
  limit 1;

  if found then
    return jsonb_build_object(
      'success', true,
      'code', 'ALREADY_EXISTS',
      'booking_id', v_existing.id,
      'status', v_existing.status,
      'slot_id', v_existing.slot_id,
      'qty', v_existing.qty
    );
  end if;

  update public.slots
  set booked = booked + p_qty
  where id = p_slot_id
    and business_id = p_business_id
    and tour_id = p_tour_id
    and status = 'OPEN'
    and (capacity_total - booked - coalesce(held, 0)) >= p_qty
  returning *
  into v_slot;

  if not found then
    if exists (
      select 1
      from public.slots
      where id = p_slot_id
        and business_id = p_business_id
        and tour_id = p_tour_id
    ) then
      if exists (
        select 1
        from public.slots
        where id = p_slot_id
          and business_id = p_business_id
          and tour_id = p_tour_id
          and status <> 'OPEN'
      ) then
        return jsonb_build_object('success', false, 'code', 'SLOT_CLOSED');
      end if;
      return jsonb_build_object('success', false, 'code', 'INSUFFICIENT_CAPACITY');
    end if;
    return jsonb_build_object('success', false, 'code', 'SLOT_NOT_FOUND');
  end if;

  v_unit_price := round(coalesce(p_total_amount, 0) / p_qty, 2);

  insert into public.bookings (
    business_id,
    tour_id,
    slot_id,
    customer_name,
    phone,
    email,
    qty,
    unit_price,
    total_amount,
    original_total,
    status,
    source,
    external_ref,
    supplier_payment_status,
    supplier_settlement_status,
    supplier_payout_amount,
    supplier_commission_amount,
    external_source_details
  )
  values (
    p_business_id,
    p_tour_id,
    p_slot_id,
    nullif(btrim(p_customer_name), ''),
    nullif(btrim(p_phone), ''),
    lower(nullif(btrim(p_email), '')),
    p_qty,
    v_unit_price,
    coalesce(p_total_amount, 0),
    coalesce(p_total_amount, 0),
    upper(coalesce(nullif(btrim(p_status), ''), 'PAID')),
    upper(p_source),
    p_external_ref,
    upper(nullif(btrim(p_supplier_payment_status), '')),
    upper(nullif(btrim(p_supplier_settlement_status), '')),
    p_supplier_payout_amount,
    p_supplier_commission_amount,
    coalesce(p_external_source_details, '{}'::jsonb)
  )
  returning *
  into v_booking;

  return jsonb_build_object(
    'success', true,
    'code', 'BOOKING_CREATED',
    'booking_id', v_booking.id,
    'status', v_booking.status,
    'slot_id', v_booking.slot_id,
    'qty', v_booking.qty
  );
exception
  when unique_violation then
    update public.slots
    set booked = greatest(0, booked - p_qty)
    where id = p_slot_id;

    select *
    into v_existing
    from public.bookings
    where business_id = p_business_id
      and source = upper(p_source)
      and external_ref = p_external_ref
    limit 1;

    if found then
      return jsonb_build_object(
        'success', true,
        'code', 'ALREADY_EXISTS',
        'booking_id', v_existing.id,
        'status', v_existing.status,
        'slot_id', v_existing.slot_id,
        'qty', v_existing.qty
      );
    end if;

    raise;
end;
$$;

create or replace function public.ck_external_cancel_booking(
  p_business_id uuid,
  p_source text,
  p_external_ref text,
  p_cancel_reason text default null,
  p_external_source_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_booking public.bookings%rowtype;
begin
  select *
  into v_booking
  from public.bookings
  where business_id = p_business_id
    and source = upper(p_source)
    and external_ref = p_external_ref
  for update;

  if not found then
    return jsonb_build_object('success', false, 'code', 'BOOKING_NOT_FOUND');
  end if;

  if v_booking.status = 'CANCELLED' then
    return jsonb_build_object(
      'success', true,
      'code', 'BOOKING_ALREADY_CANCELLED',
      'booking_id', v_booking.id
    );
  end if;

  if v_booking.status = 'HELD' then
    update public.slots
    set held = greatest(0, coalesce(held, 0) - v_booking.qty)
    where id = v_booking.slot_id;
  else
    update public.slots
    set booked = greatest(0, booked - v_booking.qty)
    where id = v_booking.slot_id;
  end if;

  update public.bookings
  set status = 'CANCELLED',
      cancellation_reason = coalesce(nullif(btrim(p_cancel_reason), ''), cancellation_reason, 'Cancelled by external source'),
      cancelled_at = timezone('utc', now()),
      external_source_details = coalesce(external_source_details, '{}'::jsonb) || coalesce(p_external_source_details, '{}'::jsonb)
  where id = v_booking.id;

  return jsonb_build_object(
    'success', true,
    'code', 'BOOKING_CANCELLED',
    'booking_id', v_booking.id
  );
end;
$$;

create or replace function public.ck_external_modify_booking(
  p_business_id uuid,
  p_source text,
  p_external_ref text,
  p_new_slot_id uuid default null,
  p_new_qty integer default null,
  p_customer_name text default null,
  p_email text default null,
  p_phone text default null,
  p_total_amount numeric default null,
  p_status text default null,
  p_supplier_payment_status text default null,
  p_supplier_settlement_status text default null,
  p_supplier_payout_amount numeric default null,
  p_supplier_commission_amount numeric default null,
  p_external_source_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_booking public.bookings%rowtype;
  v_target_slot public.slots%rowtype;
  v_target_slot_id uuid;
  v_target_qty integer;
  v_qty_delta integer;
  v_total_amount numeric;
begin
  select *
  into v_booking
  from public.bookings
  where business_id = p_business_id
    and source = upper(p_source)
    and external_ref = p_external_ref
  for update;

  if not found then
    return jsonb_build_object('success', false, 'code', 'BOOKING_NOT_FOUND');
  end if;

  if v_booking.status = 'CANCELLED' then
    return jsonb_build_object('success', false, 'code', 'BOOKING_CANCELLED');
  end if;

  v_target_slot_id := coalesce(p_new_slot_id, v_booking.slot_id);
  v_target_qty := coalesce(p_new_qty, v_booking.qty);
  v_total_amount := coalesce(p_total_amount, v_booking.total_amount, 0);

  if coalesce(v_target_qty, 0) < 1 then
    return jsonb_build_object('success', false, 'code', 'INVALID_QTY');
  end if;

  if v_target_slot_id = v_booking.slot_id then
    v_qty_delta := v_target_qty - v_booking.qty;

    if v_qty_delta > 0 then
      update public.slots
      set booked = booked + v_qty_delta
      where id = v_target_slot_id
        and business_id = p_business_id
        and status = 'OPEN'
        and (capacity_total - booked - coalesce(held, 0)) >= v_qty_delta
      returning *
      into v_target_slot;

      if not found then
        if exists (
          select 1
          from public.slots
          where id = v_target_slot_id
            and business_id = p_business_id
            and status <> 'OPEN'
        ) then
          return jsonb_build_object('success', false, 'code', 'NEW_SLOT_CLOSED');
        end if;
        return jsonb_build_object('success', false, 'code', 'INSUFFICIENT_CAPACITY');
      end if;
    elsif v_qty_delta < 0 then
      update public.slots
      set booked = greatest(0, booked + v_qty_delta)
      where id = v_target_slot_id
        and business_id = p_business_id
      returning *
      into v_target_slot;
    else
      select *
      into v_target_slot
      from public.slots
      where id = v_target_slot_id
        and business_id = p_business_id;
    end if;
  else
    update public.slots
    set booked = booked + v_target_qty
    where id = v_target_slot_id
      and business_id = p_business_id
      and status = 'OPEN'
      and (capacity_total - booked - coalesce(held, 0)) >= v_target_qty
    returning *
    into v_target_slot;

    if not found then
      if exists (
        select 1
        from public.slots
        where id = v_target_slot_id
          and business_id = p_business_id
          and status <> 'OPEN'
      ) then
        return jsonb_build_object('success', false, 'code', 'NEW_SLOT_CLOSED');
      end if;
      if exists (
        select 1
        from public.slots
        where id = v_target_slot_id
          and business_id = p_business_id
      ) then
        return jsonb_build_object('success', false, 'code', 'INSUFFICIENT_CAPACITY');
      end if;
      return jsonb_build_object('success', false, 'code', 'NEW_SLOT_NOT_FOUND');
    end if;

    update public.slots
    set booked = greatest(0, booked - v_booking.qty)
    where id = v_booking.slot_id;
  end if;

  update public.bookings
  set slot_id = v_target_slot_id,
      tour_id = coalesce(v_target_slot.tour_id, v_booking.tour_id),
      qty = v_target_qty,
      customer_name = coalesce(nullif(btrim(p_customer_name), ''), customer_name),
      email = coalesce(lower(nullif(btrim(p_email), '')), email),
      phone = coalesce(nullif(btrim(p_phone), ''), phone),
      total_amount = v_total_amount,
      original_total = coalesce(original_total, v_total_amount),
      unit_price = round(v_total_amount / v_target_qty, 2),
      status = coalesce(upper(nullif(btrim(p_status), '')), status),
      supplier_payment_status = coalesce(upper(nullif(btrim(p_supplier_payment_status), '')), supplier_payment_status),
      supplier_settlement_status = coalesce(upper(nullif(btrim(p_supplier_settlement_status), '')), supplier_settlement_status),
      supplier_payout_amount = coalesce(p_supplier_payout_amount, supplier_payout_amount),
      supplier_commission_amount = coalesce(p_supplier_commission_amount, supplier_commission_amount),
      external_source_details = coalesce(external_source_details, '{}'::jsonb) || coalesce(p_external_source_details, '{}'::jsonb)
  where id = v_booking.id
  returning *
  into v_booking;

  return jsonb_build_object(
    'success', true,
    'code', 'BOOKING_MODIFIED',
    'booking_id', v_booking.id,
    'status', v_booking.status,
    'slot_id', v_booking.slot_id,
    'tour_id', v_booking.tour_id,
    'qty', v_booking.qty,
    'total_amount', v_booking.total_amount,
    'start_time', v_target_slot.start_time
  );
end;
$$;
