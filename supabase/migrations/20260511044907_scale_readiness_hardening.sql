-- Scale-readiness hardening for the 5k-user onboarding push.
--
-- Keep this migration transaction-free: CREATE INDEX CONCURRENTLY cannot run
-- inside an explicit transaction block.

-- Advisor-driven hot foreign-key indexes.
create index concurrently if not exists idx_bookings_slot_id
  on public.bookings(slot_id);

create index concurrently if not exists idx_bookings_tour_id
  on public.bookings(tour_id);

create index concurrently if not exists idx_bookings_invoice_id
  on public.bookings(invoice_id);

create index concurrently if not exists idx_holds_booking_id
  on public.holds(booking_id);

create index concurrently if not exists idx_holds_slot_id
  on public.holds(slot_id);

create index concurrently if not exists idx_invoices_booking_id
  on public.invoices(booking_id);

create index concurrently if not exists idx_invoices_business_id
  on public.invoices(business_id);

create index concurrently if not exists idx_chat_messages_business_id
  on public.chat_messages(business_id);

alter table public.marketing_queue
  add column if not exists processing_started_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.marketing_queue
  drop constraint if exists marketing_queue_status_check;

alter table public.marketing_queue
  add constraint marketing_queue_status_check
  check (status in ('pending', 'processing', 'sent', 'failed'));

create index concurrently if not exists idx_marketing_queue_status_retry_created
  on public.marketing_queue(status, next_retry_at, created_at)
  where status = 'pending';

create index concurrently if not exists idx_marketing_queue_campaign_id
  on public.marketing_queue(campaign_id);

create index concurrently if not exists idx_marketing_queue_contact_id
  on public.marketing_queue(contact_id);

-- SECURITY DEFINER views bypass caller RLS unless made invoker-safe.
do $$
begin
  if to_regclass('public.tour_review_stats') is not null then
    execute 'alter view public.tour_review_stats set (security_invoker = true)';
  end if;
end $$;

-- Guard against search_path hijacking in public functions. This does not change
-- function privileges; exposed SECURITY DEFINER RPCs still need a dedicated
-- compatibility refactor where browser-callable RPCs are split from privileged RPCs.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as regproc
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('alter function %s set search_path = public, pg_temp', fn.regproc);
  end loop;
end $$;

-- Atomic capacity adjustment used by Edge Functions that bypass RLS with the
-- service role. This removes read-then-write races around slots.booked/held.
create or replace function public.adjust_slot_capacity(
  p_slot_id uuid,
  p_business_id uuid,
  p_booked_delta integer default 0,
  p_held_delta integer default 0
)
returns public.slots
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated_slot public.slots;
begin
  update public.slots
  set
    booked = greatest(0, coalesce(booked, 0) + coalesce(p_booked_delta, 0)),
    held = greatest(0, coalesce(held, 0) + coalesce(p_held_delta, 0))
  where id = p_slot_id
    and business_id = p_business_id
  returning * into updated_slot;

  if updated_slot.id is null then
    raise exception 'slot not found for business';
  end if;

  return updated_slot;
end;
$$;

revoke all on function public.adjust_slot_capacity(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.adjust_slot_capacity(uuid, uuid, integer, integer) to service_role;

-- Atomic marketing queue claim. Concurrent dispatch invocations claim distinct
-- rows using row locks rather than select-then-update races.
create or replace function public.claim_marketing_queue(
  p_limit integer default 50,
  p_max_retries integer default 3
)
returns setof public.marketing_queue
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with picked as (
    select id
    from public.marketing_queue
    where status = 'pending'
      and retry_count < p_max_retries
      and (next_retry_at is null or next_retry_at <= now())
    order by created_at asc
    limit greatest(1, least(coalesce(p_limit, 50), 500))
    for update skip locked
  )
  update public.marketing_queue q
  set
    status = 'processing',
    processing_started_at = now(),
    updated_at = now()
  from picked
  where q.id = picked.id
  returning q.*;
end;
$$;

revoke all on function public.claim_marketing_queue(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_marketing_queue(integer, integer) to service_role;
