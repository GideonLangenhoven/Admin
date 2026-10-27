begin;

alter table public.bookings add column if not exists arrival_approval_version bigint not null default 0;
create function public.advance_arrival_approval_version() returns trigger language plpgsql as $$
begin
 new.arrival_approval_version:=case when new.slot_id is distinct from old.slot_id then old.arrival_approval_version+1 else old.arrival_approval_version end;
 return new;
end $$;
create trigger advance_arrival_approval_version before update on public.bookings
 for each row execute function public.advance_arrival_approval_version();
revoke all on function public.advance_arrival_approval_version() from public,anon,authenticated;

create table public.booking_arrival_approvals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  booking_id uuid not null references public.bookings(id),
  slot_id uuid not null references public.slots(id),
  approval_version bigint not null,
  decision text not null check (decision in ('approve','revoke')),
  account_reference text not null check (length(trim(account_reference)) between 1 and 160),
  reason text not null check (length(trim(reason)) between 1 and 500),
  actor_admin_id uuid not null references public.admin_users(id),
  created_at timestamptz not null default clock_timestamp()
);
create index on public.booking_arrival_approvals(booking_id, created_at desc, id desc);
alter table public.booking_arrival_approvals enable row level security;
create policy arrival_approvals_read on public.booking_arrival_approvals for select to authenticated
  using (business_id = any(public.current_business_ids()));
revoke all on public.booking_arrival_approvals from public, anon, authenticated, service_role;
grant select on public.booking_arrival_approvals to authenticated, service_role;

create function public.guard_arrival_approval_history() returns trigger language plpgsql as $$
begin raise exception 'Arrival approval history is immutable' using errcode='42501'; end $$;
create trigger arrival_approval_history before update or delete on public.booking_arrival_approvals
  for each row execute function public.guard_arrival_approval_history();
revoke all on function public.guard_arrival_approval_history() from public,anon,authenticated;

create function public.approve_account_arrival(p_business_id uuid,p_booking_id uuid,p_decision text,p_account_reference text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor public.admin_users%rowtype; b public.bookings%rowtype;
begin
  select a.* into actor from public.admin_users a join public.businesses t on t.id=p_business_id
  where a.user_id=auth.uid() and not coalesce(a.suspended,false) and not coalesce(a.read_only,false)
    and a.role in ('ADMIN','MAIN_ADMIN','SUPER_ADMIN')
    and (a.business_id=p_business_id or a.role='SUPER_ADMIN')
    and (a.role='SUPER_ADMIN' or upper(coalesce(t.subscription_status,'')) in ('ACTIVE','TRIAL','PAST_DUE'))
  order by (a.business_id=p_business_id) desc,a.created_at,a.id limit 1;
  if actor.id is null then raise exception 'Admin approval required' using errcode='42501'; end if;
  if p_decision not in ('approve','revoke') or p_decision is null or coalesce(length(trim(p_account_reference)),0) not between 1 and 160
    or coalesce(length(trim(p_reason)),0) not between 1 and 500 then raise exception 'Reference and reason are required'; end if;
  select * into b from public.bookings where id=p_booking_id and business_id=p_business_id for update;
  if not found or b.status not in ('PAID','CONFIRMED','COMPLETED') or b.slot_id is null then
    raise exception 'Confirm the booking before approving arrival'; end if;
  insert into public.booking_arrival_approvals(business_id,booking_id,slot_id,approval_version,decision,account_reference,reason,actor_admin_id)
    values(p_business_id,b.id,b.slot_id,b.arrival_approval_version,p_decision,trim(p_account_reference),trim(p_reason),actor.id);
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.approve_account_arrival(uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.approve_account_arrival(uuid,uuid,text,text,text) to authenticated;

-- Only the current departure's latest explicit approval counts. A move invalidates it.
create function public.has_account_arrival_approval(p_business_id uuid,p_booking_id uuid,p_slot_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((select a.decision='approve' and a.slot_id=p_slot_id and a.approval_version=b.arrival_approval_version
 from public.booking_arrival_approvals a join public.bookings b on b.id=a.booking_id and b.business_id=a.business_id
 where a.business_id=p_business_id and a.booking_id=p_booking_id order by a.created_at desc,a.id desc limit 1),false)
$$;
revoke all on function public.has_account_arrival_approval(uuid,uuid,uuid) from public,anon,authenticated;

create function public.booking_arrival_payment_ready(p_business_id uuid,p_booking_id uuid,p_slot_id uuid,p_status text,p_total numeric,p_captured numeric)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select (auth.role()='service_role' or p_business_id=any(public.current_business_ids())) and
 p_status in ('PAID','CONFIRMED','COMPLETED') and (
   greatest(0,coalesce(p_total,0)-case when coalesce(p_captured,0)>0 then p_captured
      when p_status in ('PAID','COMPLETED') then coalesce(p_total,0) else 0 end)<=0.005
   or public.has_account_arrival_approval(p_business_id,p_booking_id,p_slot_id))
$$;
revoke all on function public.booking_arrival_payment_ready(uuid,uuid,uuid,text,numeric,numeric) from public,anon,authenticated;
grant execute on function public.booking_arrival_payment_ready(uuid,uuid,uuid,text,numeric,numeric) to authenticated,service_role;

CREATE OR REPLACE FUNCTION public.sync_booking_arrival_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  was_complete boolean := false;
  is_complete boolean;
  old_count integer := 0;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_user = 'authenticated'
        AND (COALESCE(NEW.arrived_count, 0) <> 0 OR COALESCE(NEW.checked_in, false)) THEN
      RAISE EXCEPTION 'Create the booking before recording arrivals'
        USING ERRCODE = '42501';
    END IF;
    NEW.arrived_count := CASE
      WHEN COALESCE(NEW.checked_in, false) THEN NEW.qty
      ELSE COALESCE(NEW.arrived_count, 0)
    END;
  ELSE
    was_complete := OLD.qty > 0 AND OLD.arrived_count = OLD.qty;
    old_count := OLD.arrived_count;

    -- Partial counts go through record_booking_arrival so they get stale-write
    -- protection and a caller-supplied replay id. Old authenticated clients may
    -- still toggle checked_in; that path is normalized and audited below.
    IF current_user = 'authenticated'
        AND NEW.arrived_count IS DISTINCT FROM OLD.arrived_count THEN
      RAISE EXCEPTION 'Use the check-in service to change the arrived count'
        USING ERRCODE = '42501';
    END IF;

    -- Attendance belongs to a departure. It never follows a booking move.
    IF NEW.slot_id IS DISTINCT FROM OLD.slot_id THEN
      NEW.arrived_count := 0;
    ELSIF NEW.arrived_count IS DISTINCT FROM OLD.arrived_count THEN
      -- arrived_count is authoritative for new writers.
      NULL;
    ELSIF NEW.checked_in IS DISTINCT FROM OLD.checked_in THEN
      -- Keep old boolean-only writers coherent during rollout.
      NEW.arrived_count := CASE WHEN NEW.checked_in THEN NEW.qty ELSE 0 END;
    ELSIF NEW.qty IS DISTINCT FROM OLD.qty THEN
      IF NEW.qty < OLD.arrived_count THEN
        RAISE EXCEPTION 'Guest quantity cannot be below the recorded arrived count (%)', OLD.arrived_count
          USING ERRCODE = '23514';
      END IF;
      -- A larger group does not manufacture new arrivals.
      NEW.arrived_count := OLD.arrived_count;
    END IF;
  END IF;

  IF NEW.arrived_count IS NULL
      OR NEW.arrived_count < 0
      OR NEW.arrived_count > NEW.qty THEN
    RAISE EXCEPTION 'Arrived count must be between 0 and booking quantity'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.arrived_count > old_count THEN
    IF NOT public.booking_arrival_payment_ready(NEW.business_id,NEW.id,NEW.slot_id,NEW.status,NEW.total_amount,NEW.total_captured) THEN
      RAISE EXCEPTION 'Record payment before checking in this booking'
        USING ERRCODE = '23514';
    END IF;
    IF COALESCE(NEW.waiver_status, '') <> 'SIGNED' THEN
      RAISE EXCEPTION 'A signed waiver is required before check-in'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  is_complete := NEW.qty > 0 AND NEW.arrived_count = NEW.qty;
  NEW.checked_in := is_complete;
  IF is_complete THEN
    IF TG_OP = 'INSERT' OR NOT was_complete OR NEW.checked_in_at IS NULL THEN
      NEW.checked_in_at := COALESCE(NEW.checked_in_at, now());
    END IF;
  ELSE
    NEW.checked_in_at := NULL;
  END IF;

  RETURN NEW;
END $$;


CREATE OR REPLACE FUNCTION public.record_booking_arrival(
  p_booking_id uuid,
  p_business_id uuid,
  p_actor_admin_id uuid,
  p_arrived_count integer,
  p_expected_arrived_count integer,
  p_client_event_id text,
  p_source text,
  p_notes text,
  p_slot_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  b public.bookings%ROWTYPE;
  target_count integer;
  previous_count integer;
  existing_event public.slot_check_ins%ROWTYPE;
  claimed_events integer;
BEGIN
  SELECT * INTO b
  FROM public.bookings
  WHERE id = p_booking_id AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'error', 'Booking not found');
  END IF;

  IF p_slot_id IS NOT NULL AND p_slot_id IS DISTINCT FROM b.slot_id THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'STALE_SLOT',
      'error', 'This booking moved to another departure. Refresh and try again.',
      'arrived_count', b.arrived_count, 'qty', b.qty, 'slot_id', b.slot_id
    );
  END IF;

  IF p_client_event_id IS NOT NULL THEN
    SELECT * INTO existing_event
    FROM public.slot_check_ins
    WHERE booking_id = b.id AND client_event_id = p_client_event_id;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', true, 'replay', true,
        'arrived_count', b.arrived_count, 'qty', b.qty,
        'checked_in', b.checked_in, 'checked_in_at', b.checked_in_at,
        'slot_id', b.slot_id
      );
    END IF;
  END IF;

  target_count := COALESCE(p_arrived_count, b.qty);
  previous_count := b.arrived_count;
  IF target_count < 0 OR target_count > b.qty THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'OUT_OF_RANGE',
      'error', format('Arrived count must be between 0 and %s.', b.qty),
      'arrived_count', b.arrived_count, 'qty', b.qty
    );
  END IF;

  IF p_expected_arrived_count IS NOT NULL
      AND p_expected_arrived_count IS DISTINCT FROM b.arrived_count THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'STALE',
      'error', 'Arrival count changed on another device. Review the latest count and try again.',
      'arrived_count', b.arrived_count, 'qty', b.qty,
      'checked_in', b.checked_in, 'checked_in_at', b.checked_in_at,
      'slot_id', b.slot_id
    );
  END IF;

  -- Resetting/correcting to zero is always possible. Recording arrivals keeps
  -- the established settled-booking and signed-waiver guard.
  IF target_count > b.arrived_count AND NOT public.booking_arrival_payment_ready(b.business_id,b.id,b.slot_id,b.status,b.total_amount,b.total_captured) THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'PAYMENT_REQUIRED',
      'error', 'Record the balance received or obtain admin account/reseller approval before arrival.',
      'arrived_count', b.arrived_count, 'qty', b.qty
    );
  END IF;

  IF target_count > b.arrived_count AND COALESCE(b.waiver_status, '') <> 'SIGNED' THEN
    RETURN jsonb_build_object(
      'ok', false, 'code', 'WAIVER_REQUIRED',
      'error', 'A signed waiver is required before check-in.',
      'arrived_count', b.arrived_count, 'qty', b.qty
    );
  END IF;

  UPDATE public.bookings
  SET arrived_count = target_count
  WHERE id = b.id
  RETURNING * INTO b;

  IF target_count IS DISTINCT FROM previous_count THEN
    -- The trigger wrote the immutable audit row in this transaction. The
    -- booking row lock serializes writers, so the exact before/after pair is
    -- unambiguous and can be enriched with the RPC's actor and replay id.
    UPDATE public.slot_check_ins SET
      actor_admin_id = p_actor_admin_id,
      client_event_id = NULLIF(left(COALESCE(p_client_event_id, ''), 160), ''),
      source = left(COALESCE(NULLIF(p_source, ''), 'admin'), 80),
      notes = NULLIF(left(COALESCE(p_notes, ''), 500), '')
    WHERE id = (
      SELECT id FROM public.slot_check_ins
      WHERE booking_id = b.id
        AND arrived_count_before = previous_count
        AND arrived_count_after = target_count
        AND client_event_id IS NULL
      ORDER BY checked_in_at DESC, id DESC
      LIMIT 1
      FOR UPDATE
    );
    GET DIAGNOSTICS claimed_events = ROW_COUNT;
    IF claimed_events <> 1 THEN RAISE EXCEPTION 'Arrival audit could not be attributed'; END IF;
  ELSE
    INSERT INTO public.slot_check_ins (
      business_id, booking_id, slot_id, actor_admin_id, checked_in_at,
      client_event_id, source, notes, arrived_count_before, arrived_count_after
    ) VALUES (
      b.business_id, b.id, b.slot_id, p_actor_admin_id, now(),
      NULLIF(left(COALESCE(p_client_event_id, ''), 160), ''),
      left(COALESCE(NULLIF(p_source, ''), 'admin'), 80),
      NULLIF(left(COALESCE(p_notes, ''), 500), ''),
      previous_count, target_count
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'replay', false,
    'arrived_count', b.arrived_count, 'qty', b.qty,
    'checked_in', b.checked_in, 'checked_in_at', b.checked_in_at,
    'slot_id', b.slot_id
  );
END $$;


-- Full and Simple consume identical records and status definitions, grouped by slot identity.
create function public.operator_departure_manifest(p_business_id uuid,p_range_start timestamptz,p_range_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not (auth.role()='service_role' or p_business_id=any(public.current_business_ids())) then
   raise exception 'Unauthorized' using errcode='42501'; end if;
 if p_range_start is null or p_range_end is null or p_range_end<=p_range_start or p_range_end-p_range_start>interval '7 days' then
   raise exception 'Invalid departure range'; end if;
 return (select coalesce(jsonb_agg(item order by start_time,slot_id,created_at,id),'[]'::jsonb) from (
   select b.id,b.slot_id,b.created_at,s.start_time,
    jsonb_build_object(
      'id',b.id,'business_id',b.business_id,'slot_id',s.id,'tour_id',s.tour_id,'created_at',b.created_at,
      'customer_name',b.customer_name,'email',b.email,'phone',b.phone,'qty',b.qty,'status',b.status,
      'total_amount',b.total_amount,'original_total',b.original_total,'total_captured',b.total_captured,
      'total_refunded',b.total_refunded,'refund_amount',b.refund_amount,'refund_processed_at',b.refund_processed_at,
      'voucher_amount_paid',b.voucher_amount_paid,'voucher_code',b.voucher_code,'payment_method',b.payment_method,
      'yoco_payment_id',b.yoco_payment_id,'payfast_m_payment_id',b.payfast_m_payment_id,'ota_channel',b.ota_channel,
      'allow_unpaid',b.allow_unpaid,'payment_deadline',b.payment_deadline,'waiver_status',b.waiver_status,
      'arrived_count',least(b.qty,greatest(0,coalesce(b.arrived_count,case when b.checked_in then b.qty else 0 end))),
      'checked_in',b.checked_in,'checked_in_at',b.checked_in_at,'custom_fields',b.custom_fields,
      'unpaid_arrival_approved',public.has_account_arrival_approval(b.business_id,b.id,s.id),
      'slots',jsonb_build_object('id',s.id,'start_time',s.start_time,'status',s.status),
      'tours',jsonb_build_object('name',t.name),
      'add_ons',coalesce((select jsonb_agg(jsonb_build_object('name',a.name,'qty',ba.qty) order by a.name,ba.id)
       from public.booking_add_ons ba join public.add_ons a on a.id=ba.add_on_id and a.business_id=p_business_id
       where ba.booking_id=b.id),'[]'::jsonb)) item
   from public.slots s join public.bookings b on b.slot_id=s.id and b.business_id=s.business_id
    join public.tours t on t.id=s.tour_id and t.business_id=s.business_id
   where s.business_id=p_business_id and s.start_time>=p_range_start and s.start_time<p_range_end
    and (b.status in ('PAID','CONFIRMED','COMPLETED') or
      (b.status in ('PENDING','PENDING PAYMENT','HELD') and
       (b.allow_unpaid or b.payment_deadline is null or b.payment_deadline>now())))
  ) rows);
end $$;
revoke all on function public.operator_departure_manifest(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.operator_departure_manifest(uuid,timestamptz,timestamptz) to authenticated,service_role;

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
security definer
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
  bounds as (
    select (p_now at time zone timezone)::date as day, timezone from authorized
  ),
  manifest_rows as materialized (
    select item, (item->'slots'->>'start_time')::timestamptz start_time, (item->>'created_at')::timestamptz created_at
    from bounds cross join lateral jsonb_array_elements(public.operator_departure_manifest(p_business_id,
       day::timestamp at time zone timezone,(day+2)::timestamp at time zone timezone)) item
  ),
  manifests as (
    select coalesce(jsonb_agg(item order by start_time,created_at,item->>'id')
      filter(where start_time<(select (day+1)::timestamp at time zone timezone from bounds)),'[]'::jsonb) today,
     coalesce(jsonb_agg(item order by start_time,created_at,item->>'id')
      filter(where start_time>=(select (day+1)::timestamp at time zone timezone from bounds)),'[]'::jsonb) tomorrow
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
      and b.created_at >= least(date_trunc('month',p_now at time zone a.timezone) at time zone a.timezone, p_now-interval '7 days')
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
      'today', coalesce((select sum(total_amount) from revenue_rows where created_at >= (select day::timestamp at time zone timezone from bounds)), 0),
      'week', coalesce((select sum(total_amount) from revenue_rows where created_at >= p_now-interval '7 days'), 0),
      'month', coalesce((select sum(total_amount) from revenue_rows where created_at >= (select date_trunc('month',day::timestamp) at time zone timezone from bounds)), 0),
      'series', coalesce((
        select jsonb_agg(coalesce(r.total, 0) order by d.day)
        from authorized a
        cross join lateral generate_series(
          date_trunc('month',p_now at time zone a.timezone)::date,
          (p_now at time zone a.timezone)::date,
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


notify pgrst,'reload schema';
commit;
