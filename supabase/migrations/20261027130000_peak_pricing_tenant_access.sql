begin;
-- H3: a SUPER_ADMIN acting in a tenant could not save peak pricing ("new row
-- violates row-level security policy for table peak_periods"). These policies
-- resolved the tenant through admin_users.business_id, which for a super-admin
-- is Platform Administration. Every other tenant table uses
-- current_business_ids(); these now do too, with an explicit WITH CHECK, and
-- for authenticated only (they also applied to anon).
--
-- chat_faq_entries, data_subject_requests and pii_anonymization_log used the
-- same admin_users.business_id pattern and move to the same helper.
--
-- Saving and removing a peak period now runs in one transaction (period,
-- per-tour prices and slot prices together), and slots created later inside a
-- stored period get its price, which the Pricing page already promised.

drop policy if exists peak_periods_tenant on public.peak_periods;
create policy peak_periods_tenant on public.peak_periods
  for all to authenticated
  using (business_id in (select unnest((select public.current_business_ids()))))
  with check (business_id in (select unnest((select public.current_business_ids()))));

drop policy if exists peak_period_prices_tenant on public.peak_period_prices;
create policy peak_period_prices_tenant on public.peak_period_prices
  for all to authenticated
  using (peak_period_id in (select p.id from public.peak_periods p
    where p.business_id in (select unnest((select public.current_business_ids())))))
  with check (exists (select 1 from public.peak_periods p
    join public.tours t on t.business_id = p.business_id
    where p.id = peak_period_prices.peak_period_id and t.id = peak_period_prices.tour_id
      and p.business_id in (select unnest((select public.current_business_ids())))));

drop policy if exists faq_tenant_rw on public.chat_faq_entries;
create policy faq_tenant_rw on public.chat_faq_entries
  for all to authenticated
  using (business_id in (select unnest((select public.current_business_ids()))))
  with check (business_id in (select unnest((select public.current_business_ids()))));

drop policy if exists dsr_tenant_read on public.data_subject_requests;
create policy dsr_tenant_read on public.data_subject_requests
  for select to authenticated
  using (business_id in (select unnest((select public.current_business_ids()))));

drop policy if exists pii_log_read on public.pii_anonymization_log;
create policy pii_log_read on public.pii_anonymization_log
  for select to authenticated
  using (business_id in (select unnest((select public.current_business_ids()))));

-- Highest priority wins; on equal priority the older period wins, as the
-- Pricing page did before.
create or replace function public.peak_period_slot_price(p_business_id uuid, p_tour_id uuid, p_day date)
returns numeric
language sql stable
set search_path = public, pg_temp
as $$
  select pp.price_per_person
  from public.peak_periods p
  join public.peak_period_prices pp on pp.peak_period_id = p.id and pp.tour_id = p_tour_id
  where p.business_id = p_business_id and p_day between p.start_date and p.end_date
  order by p.priority desc, p.created_at, p.id
  limit 1
$$;

-- Re-derives slot peak prices for business-local dates p_from..p_to. Manual
-- overrides are never touched. Slots that already have CONFIRMED or PAID
-- bookings keep their price (grandfathered) unless no period covers them any
-- more, which is how removing a period behaved before.
create or replace function public.refresh_peak_slot_prices(p_business_id uuid, p_from date, p_to date)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_price numeric;
  v_applied integer := 0;
  s record;
begin
  select coalesce(b.timezone, 'Africa/Johannesburg') into v_tz from public.businesses b where b.id = p_business_id;
  v_tz := coalesce(v_tz, 'Africa/Johannesburg');
  for s in
    select sl.id, sl.tour_id, sl.is_peak, (sl.start_time at time zone v_tz)::date as day,
      exists (select 1 from public.bookings bk where bk.slot_id = sl.id and bk.status in ('CONFIRMED', 'PAID')) as booked
    from public.slots sl
    where sl.business_id = p_business_id
      and sl.start_time >= (p_from::timestamp at time zone v_tz)
      and sl.start_time < ((p_to + 1)::timestamp at time zone v_tz)
      and not coalesce(sl.is_manually_overridden, false)
    for update of sl
  loop
    v_price := public.peak_period_slot_price(p_business_id, s.tour_id, s.day);
    if v_price is not null and not s.booked then
      update public.slots set is_peak = true, price_per_person_override = v_price, last_minute_at = null where id = s.id;
      v_applied := v_applied + 1;
    elsif v_price is null and coalesce(s.is_peak, false) then
      update public.slots set is_peak = false, price_per_person_override = null, last_minute_at = null where id = s.id;
    end if;
  end loop;
  return v_applied;
end $$;

-- p_prices: [{"tour_id": uuid, "price_per_person": number}]. Pass p_period_id
-- to edit an existing period.
create or replace function public.save_peak_period(
  p_business_id uuid, p_period_id uuid, p_label text, p_start date, p_end date,
  p_priority integer, p_prices jsonb)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_old_start date;
  v_old_end date;
begin
  if p_business_id is null or not (p_business_id = any (public.current_business_ids())) then
    return jsonb_build_object('ok', false, 'error', 'You do not have access to this business.');
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    return jsonb_build_object('ok', false, 'error', 'Choose an end date on or after the start date.');
  end if;
  if jsonb_typeof(coalesce(p_prices, '[]'::jsonb)) <> 'array' or exists (
      select 1 from jsonb_array_elements(coalesce(p_prices, '[]'::jsonb)) e
      where jsonb_typeof(e->'price_per_person') <> 'number' or (e->>'price_per_person')::numeric < 0) then
    return jsonb_build_object('ok', false, 'error', 'Enter a peak price of zero or more for every tour.');
  end if;

  if p_period_id is null then
    insert into public.peak_periods (business_id, label, start_date, end_date, priority)
    values (p_business_id, coalesce(nullif(trim(p_label), ''), p_start || ' to ' || p_end), p_start, p_end, coalesce(p_priority, 0))
    returning id into v_id;
  else
    select start_date, end_date into v_old_start, v_old_end
    from public.peak_periods where id = p_period_id and business_id = p_business_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'This peak period no longer exists. Refresh and try again.');
    end if;
    update public.peak_periods
    set label = coalesce(nullif(trim(p_label), ''), p_start || ' to ' || p_end),
        start_date = p_start, end_date = p_end, priority = coalesce(p_priority, 0)
    where id = p_period_id;
    delete from public.peak_period_prices where peak_period_id = p_period_id;
    v_id := p_period_id;
  end if;

  insert into public.peak_period_prices (peak_period_id, tour_id, price_per_person)
  select v_id, t.id, (e->>'price_per_person')::numeric
  from jsonb_array_elements(coalesce(p_prices, '[]'::jsonb)) e
  join public.tours t on t.id = (e->>'tour_id')::uuid and t.business_id = p_business_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'slots_updated',
    public.refresh_peak_slot_prices(p_business_id, least(p_start, coalesce(v_old_start, p_start)), greatest(p_end, coalesce(v_old_end, p_end))));
end $$;

create or replace function public.delete_peak_period(p_period_id uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_period public.peak_periods;
begin
  delete from public.peak_periods
  where id = p_period_id and business_id = any (public.current_business_ids())
  returning * into v_period;
  if v_period.id is null then
    return jsonb_build_object('ok', false, 'error', 'This peak period no longer exists. Refresh and try again.');
  end if;
  perform public.refresh_peak_slot_prices(v_period.business_id, v_period.start_date, v_period.end_date);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.apply_peak_price_to_new_slot()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_tz text;
  v_price numeric;
begin
  if new.price_per_person_override is not null or coalesce(new.is_manually_overridden, false) then
    return new;
  end if;
  select coalesce(b.timezone, 'Africa/Johannesburg') into v_tz from public.businesses b where b.id = new.business_id;
  v_price := public.peak_period_slot_price(new.business_id, new.tour_id,
    (new.start_time at time zone coalesce(v_tz, 'Africa/Johannesburg'))::date);
  if v_price is not null then
    new.price_per_person_override := v_price;
    new.is_peak := true;
  end if;
  return new;
end $$;

drop trigger if exists apply_peak_price_to_new_slot on public.slots;
create trigger apply_peak_price_to_new_slot
  before insert on public.slots
  for each row execute function public.apply_peak_price_to_new_slot();

revoke all on function public.peak_period_slot_price(uuid, uuid, date) from public, anon;
revoke all on function public.refresh_peak_slot_prices(uuid, date, date) from public, anon;
revoke all on function public.save_peak_period(uuid, uuid, text, date, date, integer, jsonb) from public, anon;
revoke all on function public.delete_peak_period(uuid) from public, anon;
revoke all on function public.apply_peak_price_to_new_slot() from public, anon, authenticated;
grant execute on function public.peak_period_slot_price(uuid, uuid, date) to authenticated, service_role;
grant execute on function public.refresh_peak_slot_prices(uuid, date, date) to authenticated, service_role;
grant execute on function public.save_peak_period(uuid, uuid, text, date, date, integer, jsonb) to authenticated, service_role;
grant execute on function public.delete_peak_period(uuid) to authenticated, service_role;
commit;
