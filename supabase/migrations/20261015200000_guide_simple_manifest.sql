begin;

-- Guides see the operational roster through explicit projections, never office RLS grants.
create function public.guide_simple_day(p_date date) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare target uuid:=public.current_guide_business(); zone text; currency_code text; first_at timestamptz; last_at timestamptz; departures jsonb;
begin
 if target is null then raise exception 'Guide access denied' using errcode='42501'; end if;
 if p_date is null then raise exception 'Choose a date'; end if;
 select timezone,currency into zone,currency_code from public.businesses where id=target;
 first_at:=p_date::timestamp at time zone zone; last_at:=(p_date+1)::timestamp at time zone zone;
 select coalesce(jsonb_agg(item order by start_time,id),'[]'::jsonb) into departures from (
  select s.id,s.start_time,jsonb_build_object(
   'id',s.id,'tour_id',s.tour_id,'tour_name',t.name,'start_time',s.start_time,'status',s.status,
   'capacity_total',s.capacity_total,'available_capacity',null,'can_book',false,
   'booked_guests',coalesce(roster.pax,0),'arrived_guests',coalesce(roster.arrived,0),'settled_guests',0,
   'bookings',coalesce(roster.bookings,'[]'::jsonb)) item
  from public.slots s join public.tours t on t.id=s.tour_id and t.business_id=target
  left join lateral (
   select sum(b.qty)::integer pax,sum(b.arrived_count)::integer arrived,
    jsonb_agg(jsonb_build_object('id',b.id,'slot_id',s.id,'customer_name',b.customer_name,
     'email',b.email,'phone',b.phone,'qty',b.qty,'status',b.status,'waiver_status',b.waiver_status,
     'checked_in',b.checked_in,'checked_in_at',b.checked_in_at,'arrived_count',b.arrived_count,
     'total_amount',b.total_amount,'total_captured',b.total_captured,
     'unpaid_arrival_approved',public.has_account_arrival_approval(target,b.id,s.id)) order by b.created_at,b.id) bookings
   from public.bookings b where b.business_id=target and b.slot_id=s.id and
    (b.status in ('PAID','CONFIRMED','COMPLETED') or (b.status in ('PENDING','PENDING PAYMENT','HELD') and
     (b.allow_unpaid or b.payment_deadline is null or b.payment_deadline>now())))) roster on true
  where s.business_id=target and s.start_time>=first_at and s.start_time<last_at
   and s.status is distinct from 'CANCELLED' and (roster.pax>0 or exists(
    select 1 from public.trip_photos p where p.business_id=target and p.slot_id=s.id))
 ) rows;
 return jsonb_build_object('date',p_date,'currency',currency_code,'departures',departures,'unbooked_departures','[]'::jsonb);
end $$;
revoke all on function public.guide_simple_day(date) from public,anon,authenticated;
grant execute on function public.guide_simple_day(date) to authenticated;

alter table public.slot_check_ins add column actor_guide_id uuid references public.guide_accounts(id);

-- Preserve the payment and waiver checks used by the existing locked arrival transaction.
create or replace function public.booking_arrival_payment_ready(p_business_id uuid,p_booking_id uuid,p_slot_id uuid,p_status text,p_total numeric,p_captured numeric)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select (auth.role()='service_role' or p_business_id=any(public.current_business_ids()) or p_business_id=public.current_guide_business()) and
 p_status in ('PAID','CONFIRMED','COMPLETED') and (
   greatest(0,coalesce(p_total,0)-case when coalesce(p_captured,0)>0 then p_captured
      when p_status in ('PAID','COMPLETED') then coalesce(p_total,0) else 0 end)<=0.005
   or public.has_account_arrival_approval(p_business_id,p_booking_id,p_slot_id))
$$;

create function public.record_guide_booking_arrival(
 p_booking_id uuid,p_business_id uuid,p_arrived_count integer,p_expected_arrived_count integer,
 p_client_event_id text,p_source text,p_notes text,p_slot_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare target uuid:=public.current_guide_business(); guide_id uuid; result jsonb;
begin
 if target is null or target is distinct from p_business_id then
  return jsonb_build_object('ok',false,'code','UNAUTHORIZED','error','Guide access denied'); end if;
 if p_client_event_id is null or length(trim(p_client_event_id)) not between 1 and 160 then
  return jsonb_build_object('ok',false,'code','INVALID_EVENT','error','A valid event ID is required'); end if;
 select id into guide_id from public.guide_accounts where user_id=auth.uid() and business_id=target;
 result:=public.record_booking_arrival(p_booking_id,target,null,p_arrived_count,p_expected_arrived_count,
  p_client_event_id,'simple-guide',p_notes,p_slot_id);
 if result->>'ok'='true' and coalesce((result->>'replay')::boolean,false)=false then
  update public.slot_check_ins set actor_guide_id=guide_id
   where business_id=target and booking_id=p_booking_id and client_event_id=p_client_event_id;
 end if;
 return result;
end $$;
revoke all on function public.record_guide_booking_arrival(uuid,uuid,integer,integer,text,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.record_guide_booking_arrival(uuid,uuid,integer,integer,text,text,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
