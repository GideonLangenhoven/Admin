begin;
-- H2b: slots.booked and slots.held were counters that every writer had to keep
-- in step by hand. About a dozen paths changed a booking's status, qty or slot,
-- or a hold's status, without doing so (admin edit and refund, combo cancel,
-- payment auto-expire, the WhatsApp and rebook cancel handlers, the external
-- booking API), so live slots drifted. They are now recounted from the source
-- rows whenever a transaction that changed those rows commits:
--   booked = sum(qty) of bookings in PAID, CONFIRMED, COMPLETED
--   held   = sum(qty) of ACTIVE holds and ACTIVE OTA reservations
-- (ota_reservations has no trigger: the OTA RPCs add and subtract held
-- themselves when a reservation starts or ends, so it only has to be counted.)
-- The triggers are deferred, so functions that do their own arithmetic and
-- capacity checks behave exactly as before inside their transaction, and the
-- stored values are corrected at commit.

create or replace function public.sync_slot_counters(p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booked integer;
  v_held integer;
begin
  -- Lock first, then count in later statements. A concurrent transaction that
  -- changed this slot's rows has committed by the time the lock is ours, and
  -- each statement below takes a fresh snapshot, so its changes are counted.
  perform 1 from public.slots where id = p_slot_id for update;
  if not found then
    return;
  end if;
  select coalesce(sum(qty), 0) into v_booked from public.bookings
  where slot_id = p_slot_id and status in ('PAID', 'CONFIRMED', 'COMPLETED');
  select (select coalesce(sum(qty), 0) from public.holds where slot_id = p_slot_id and status = 'ACTIVE')
       + (select coalesce(sum(qty), 0) from public.ota_reservations where slot_id = p_slot_id and status = 'ACTIVE')
  into v_held;
  update public.slots set booked = v_booked, held = v_held
  where id = p_slot_id and (booked, held) is distinct from (v_booked, v_held);
end $$;

create or replace function public.sync_slot_counters_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op <> 'INSERT' then
    perform public.sync_slot_counters(old.slot_id);
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.slot_id is distinct from old.slot_id) then
    perform public.sync_slot_counters(new.slot_id);
  end if;
  return null;
end $$;

drop trigger if exists sync_slot_counters on public.bookings;
create constraint trigger sync_slot_counters
  after insert or delete on public.bookings
  deferrable initially deferred
  for each row execute function public.sync_slot_counters_trigger();
drop trigger if exists sync_slot_counters_on_change on public.bookings;
create constraint trigger sync_slot_counters_on_change
  after update of slot_id, status, qty on public.bookings
  deferrable initially deferred
  for each row
  when (old.slot_id is distinct from new.slot_id or old.status is distinct from new.status or old.qty is distinct from new.qty)
  execute function public.sync_slot_counters_trigger();

drop trigger if exists sync_slot_counters on public.holds;
create constraint trigger sync_slot_counters
  after insert or delete on public.holds
  deferrable initially deferred
  for each row execute function public.sync_slot_counters_trigger();
drop trigger if exists sync_slot_counters_on_change on public.holds;
create constraint trigger sync_slot_counters_on_change
  after update of slot_id, status, qty on public.holds
  deferrable initially deferred
  for each row
  when (old.slot_id is distinct from new.slot_id or old.status is distinct from new.status or old.qty is distinct from new.qty)
  execute function public.sync_slot_counters_trigger();

-- Edge functions call this after changing a booking, passing a delta. The
-- booking change is already counted, so applying the delta counted it twice.
-- It now recounts and ignores the deltas.
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
  if not exists (select 1 from public.slots where id = p_slot_id and business_id = p_business_id) then
    raise exception 'slot not found for business';
  end if;
  perform public.sync_slot_counters(p_slot_id);
  select * into updated_slot from public.slots where id = p_slot_id;
  return updated_slot;
end $$;

-- Slots whose stored counters differ from the source rows. p_from limits the
-- check to slots starting at or after that time.
-- ponytail: two index lookups per slot in range; group the aggregates if the
-- scheduled check over future slots gets slow.
create or replace function public.slot_counter_drift(p_from timestamptz default null)
returns table (slot_id uuid, business_id uuid, start_time timestamptz, capacity_total integer,
  booked integer, expected_booked integer, held integer, expected_held integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id, s.business_id, s.start_time, s.capacity_total, s.booked, b.qty, s.held, h.qty
  from public.slots s
  cross join lateral (select coalesce(sum(x.qty), 0)::integer as qty from public.bookings x
    where x.slot_id = s.id and x.status in ('PAID', 'CONFIRMED', 'COMPLETED')) b
  cross join lateral (select ((select coalesce(sum(x.qty), 0) from public.holds x
      where x.slot_id = s.id and x.status = 'ACTIVE')
    + (select coalesce(sum(o.qty), 0) from public.ota_reservations o
      where o.slot_id = s.id and o.status = 'ACTIVE'))::integer as qty) h
  where (p_from is null or s.start_time >= p_from)
    and (coalesce(s.booked, 0) <> b.qty or coalesce(s.held, 0) <> h.qty)
  order by s.start_time
$$;

-- The browser must not write the counters. Every other slots column stays
-- updatable by tenant admins, as before (RLS still scopes the rows).
revoke update on public.slots from authenticated;
grant update (id, business_id, tour_id, start_time, status, capacity_total, price_per_person_override,
  created_at, is_peak, is_manually_overridden, local_departure_time, image_url, last_minute_at, price_before_deal)
  on public.slots to authenticated;

-- increment_held has no callers and let any caller add to held on slots RLS
-- let them update.
revoke all on function public.increment_held(uuid, integer) from public, anon, authenticated;

revoke all on function public.sync_slot_counters(uuid) from public, anon, authenticated;
revoke all on function public.sync_slot_counters_trigger() from public, anon, authenticated;
revoke all on function public.slot_counter_drift(timestamptz) from public, anon, authenticated;
grant execute on function public.sync_slot_counters(uuid) to service_role;
grant execute on function public.slot_counter_drift(timestamptz) to service_role;
commit;
