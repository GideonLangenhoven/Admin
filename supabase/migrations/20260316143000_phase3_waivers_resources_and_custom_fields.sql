alter table public.businesses
  add column if not exists booking_custom_fields jsonb not null default '[]'::jsonb;

alter table public.bookings
  add column if not exists custom_fields jsonb not null default '{}'::jsonb,
  add column if not exists waiver_status text not null default 'PENDING',
  add column if not exists waiver_token uuid not null default gen_random_uuid(),
  add column if not exists waiver_signed_at timestamptz,
  add column if not exists waiver_signed_name text,
  add column if not exists waiver_payload jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bookings_waiver_status_check'
      and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint bookings_waiver_status_check
      check (waiver_status in ('PENDING', 'SIGNED'));
  end if;
end
$$;

create unique index if not exists bookings_waiver_token_uidx
  on public.bookings(waiver_token);

create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  resource_type text not null default 'GENERAL',
  capacity_total integer not null check (capacity_total > 0),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists resources_business_id_idx
  on public.resources(business_id);

create table if not exists public.tour_resources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  tour_id uuid not null references public.tours(id) on delete cascade,
  resource_id uuid not null references public.resources(id) on delete cascade,
  units_per_guest integer not null default 1 check (units_per_guest > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(tour_id, resource_id)
);

create index if not exists tour_resources_business_id_idx
  on public.tour_resources(business_id);

create index if not exists tour_resources_tour_id_idx
  on public.tour_resources(tour_id);

create index if not exists tour_resources_resource_id_idx
  on public.tour_resources(resource_id);

alter table public.resources enable row level security;
alter table public.tour_resources enable row level security;

drop policy if exists resources_tenant_select on public.resources;
drop policy if exists resources_tenant_insert on public.resources;
drop policy if exists resources_tenant_update on public.resources;
drop policy if exists resources_tenant_delete on public.resources;

create policy resources_tenant_select
on public.resources
for select
to authenticated
using (business_id = any(public.current_business_ids()));

create policy resources_tenant_insert
on public.resources
for insert
to authenticated
with check (business_id = any(public.current_business_ids()));

create policy resources_tenant_update
on public.resources
for update
to authenticated
using (business_id = any(public.current_business_ids()))
with check (business_id = any(public.current_business_ids()));

create policy resources_tenant_delete
on public.resources
for delete
to authenticated
using (business_id = any(public.current_business_ids()));

drop policy if exists tour_resources_tenant_select on public.tour_resources;
drop policy if exists tour_resources_tenant_insert on public.tour_resources;
drop policy if exists tour_resources_tenant_update on public.tour_resources;
drop policy if exists tour_resources_tenant_delete on public.tour_resources;

create policy tour_resources_tenant_select
on public.tour_resources
for select
to authenticated
using (business_id = any(public.current_business_ids()));

create policy tour_resources_tenant_insert
on public.tour_resources
for insert
to authenticated
with check (business_id = any(public.current_business_ids()));

create policy tour_resources_tenant_update
on public.tour_resources
for update
to authenticated
using (business_id = any(public.current_business_ids()))
with check (business_id = any(public.current_business_ids()));

create policy tour_resources_tenant_delete
on public.tour_resources
for delete
to authenticated
using (business_id = any(public.current_business_ids()));

create or replace function public.slot_available_capacity(p_slot_id uuid)
returns integer
language sql
stable
set search_path = public
as $$
with target as (
  select
    s.id,
    s.business_id,
    s.capacity_total,
    coalesce(s.booked, 0) as booked,
    coalesce(s.held, 0) as held,
    s.start_time,
    s.status,
    t.id as tour_id,
    coalesce(t.duration_minutes, 0) as duration_minutes
  from public.slots s
  join public.tours t on t.id = s.tour_id
  where s.id = p_slot_id
),
direct_capacity as (
  select greatest(capacity_total - booked - held, 0) as available_capacity
  from target
),
resource_capacity as (
  select
    greatest(
      floor(
        greatest(
          r.capacity_total
          - coalesce(sum((coalesce(os.booked, 0) + coalesce(os.held, 0)) * tr2.units_per_guest), 0),
          0
        )::numeric
        / tr.units_per_guest
      )::integer,
      0
    ) as available_capacity
  from target
  join public.tour_resources tr
    on tr.tour_id = target.tour_id
   and tr.business_id = target.business_id
   and tr.active = true
  join public.resources r
    on r.id = tr.resource_id
   and r.business_id = target.business_id
   and r.active = true
  left join public.tour_resources tr2
    on tr2.resource_id = r.id
   and tr2.business_id = target.business_id
   and tr2.active = true
  left join public.tours ot
    on ot.id = tr2.tour_id
  left join public.slots os
    on os.tour_id = tr2.tour_id
   and os.business_id = target.business_id
   and os.status = 'OPEN'
   and os.start_time < target.start_time + make_interval(mins => target.duration_minutes)
   and target.start_time < os.start_time + make_interval(mins => coalesce(ot.duration_minutes, 0))
  group by r.id, r.capacity_total, tr.units_per_guest
)
select greatest(
  least(
    (select available_capacity from direct_capacity),
    coalesce((select min(available_capacity) from resource_capacity), (select available_capacity from direct_capacity))
  ),
  0
)
$$;

create or replace function public.slot_has_capacity(p_slot_id uuid, p_qty integer)
returns boolean
language sql
stable
set search_path = public
as $$
  select public.slot_available_capacity(p_slot_id) >= greatest(coalesce(p_qty, 0), 0)
$$;

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
    and (p_tour_id is null or s.tour_id = p_tour_id)
  order by s.start_time asc
$$;

grant execute on function public.slot_available_capacity(uuid) to authenticated, service_role;
grant execute on function public.slot_has_capacity(uuid, integer) to authenticated, service_role;
grant execute on function public.list_available_slots(uuid, timestamptz, timestamptz, uuid) to authenticated, service_role;
