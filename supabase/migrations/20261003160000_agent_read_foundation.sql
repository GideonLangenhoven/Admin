-- Agent read foundation: additive schema, disabled grants by default.
-- Source from the tested local candidate; public application route remains closed.
-- No connection authorisation endpoint issues these grants or custom claims.
-- Owner-approved pilot policy: MAIN_ADMIN only; no staff or super-admin bypass.
-- Fixed seven-day maximum; renewing requires a new owner-approved grant.
begin;
create table public.agent_connection_grants (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null check (length(client_id) between 1 and 200),
  provider text not null check (provider in ('CHATGPT', 'MUSE')),
  role_at_consent text not null check (role_at_consent = 'MAIN_ADMIN'),
  scopes text[] not null check (cardinality(scopes) between 1 and 3
    and scopes <@ array['departures:read','availability:read','attention:read']::text[]),
  enabled boolean not null default false,
  expires_at timestamptz not null default (now() + interval '168 hours'),
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  constraint agent_grant_lifetime check (
    isfinite(created_at) and isfinite(expires_at) and expires_at > created_at
    and expires_at <= created_at + interval '168 hours'
  )
);

-- An existing grant cannot be extended or have its consent clock reset.
create function public.agent_grant_lifetime_immutable()
returns trigger language plpgsql security invoker
set search_path = public, pg_temp as $$
begin
  if new.created_at is distinct from old.created_at or new.expires_at is distinct from old.expires_at then
    raise exception 'Grant lifetime is immutable' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function public.agent_grant_lifetime_immutable() from public, anon, authenticated;
create trigger agent_grant_lifetime_immutable before update on public.agent_connection_grants
for each row execute function public.agent_grant_lifetime_immutable();
alter table public.agent_connection_grants enable row level security;
revoke all on public.agent_connection_grants from public, anon, authenticated;
grant select on public.agent_connection_grants to authenticated;
grant all on public.agent_connection_grants to service_role;
create policy agent_grant_own_read on public.agent_connection_grants for select to authenticated
  using (user_id = (select auth.uid()) and exists (
    select 1 from public.admin_users a where a.user_id = (select auth.uid())
      and a.business_id = agent_connection_grants.business_id and not a.suspended
      and a.role = 'MAIN_ADMIN'
  ));

-- Provides a DB observation timestamp AND a fresh object-independent grant
-- check. RLS remains in force for every subsequent slots/bookings read.
-- Ordinary Supabase sessions, service keys and cross-business IDs cannot pass.
create function public.agent_read_observed_at(p_business_id uuid, p_grant_id uuid, p_scope text)
returns timestamptz language plpgsql stable security invoker
set search_path = public, pg_temp as $$
declare claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
begin
  if auth.role() is distinct from 'authenticated'
    or claims->>'agent_resource' is distinct from 'urn:bookingtours:agent-read'
    or claims->>'agent_grant_id' is distinct from p_grant_id::text
    or p_scope is null or p_scope not in ('departures:read','availability:read','attention:read')
    or not coalesce(claims->>'exp' ~ '^[0-9]{1,12}$', false)
  then raise exception 'Agent access denied' using errcode='42501'; end if;
  if (claims->>'exp')::numeric <= extract(epoch from statement_timestamp()) then
    raise exception 'Agent access denied' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.agent_connection_grants g
    join public.admin_users a on a.user_id=g.user_id and a.business_id=g.business_id
    join public.businesses b on b.id=g.business_id
    where g.id=p_grant_id and g.business_id=p_business_id and g.user_id=auth.uid()
      and g.client_id=claims->>'client_id' and g.enabled
      and g.disconnected_at is null and g.created_at<=statement_timestamp() and g.expires_at>statement_timestamp()
      and a.role=g.role_at_consent and not a.suspended
      and a.role = 'MAIN_ADMIN'
      and b.subscription_status in ('ACTIVE','TRIAL','PAST_DUE')
      and array['departures:read',p_scope]::text[] <@ g.scopes
      and array['departures:read',p_scope]::text[] <@ string_to_array(claims->>'scope',' ')
  ) then raise exception 'Agent access denied' using errcode='42501'; end if;
  return statement_timestamp();
end $$;
revoke all on function public.agent_read_observed_at(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.agent_read_observed_at(uuid,uuid,text) to authenticated;

-- Read interface: aggregate recorded per-person acceptance, never return
-- names, DOBs, tokens, guardian details or documents. Not legal certification.
-- Uses the existing booking-site payload shape; legacy SIGNED alone is unknown.
create function public.agent_departure_waiver_counts(p_business_id uuid, p_departure_id uuid, p_grant_id uuid)
returns jsonb language plpgsql stable security invoker
set search_path = public, pg_temp as $$
declare
  observed_at timestamptz;
  business_zone text;
  booking record;
  participant jsonb;
  birth_date date;
  signed_date date;
  booking_count integer := 0;
  outstanding integer := 0;
  unknown_result jsonb := jsonb_build_object('outstanding_waiver_participants', null, 'reason', 'missing_or_unknown_data');
  limited_result jsonb := jsonb_build_object('outstanding_waiver_participants', null, 'reason', 'incomplete_or_query_limit');
begin
  observed_at := public.agent_read_observed_at(p_business_id, p_grant_id, 'attention:read');
  if not exists (select 1 from public.slots where id=p_departure_id and business_id=p_business_id) then
    raise exception 'Agent access denied' using errcode='42501';
  end if;
  select timezone into business_zone from public.businesses where id=p_business_id;
  -- The extra row detects truncation without an unbounded count/payload export.
  for booking in
    select status, qty, waiver_status, waiver_signed_at, waiver_signed_name,
      case when waiver_status='SIGNED' then waiver_payload else null end as payload
    from public.bookings where business_id=p_business_id and slot_id=p_departure_id
    order by id limit 501
  loop
    booking_count := booking_count + 1;
    if booking_count > 500 then return limited_result; end if;
    if booking.status in ('CANCELLED','EXPIRED') then continue; end if;
    if booking.status is null or booking.status not in ('DRAFT','PENDING','PENDING PAYMENT','HELD','PAID','CONFIRMED','COMPLETED')
      or booking.qty is null or booking.qty <= 0 then return unknown_result; end if;
    -- Read limits only: do not change which quantities the booking flow allows.
    if booking.qty > 1000 then return limited_result; end if;
    if booking.waiver_status='PENDING' then
      outstanding := outstanding + booking.qty;
      continue;
    end if;
    if booking.waiver_status is distinct from 'SIGNED'
      or booking.waiver_signed_at is null or not isfinite(booking.waiver_signed_at) or booking.waiver_signed_at > observed_at
      or nullif(btrim(booking.waiver_signed_name),'') is null
      or jsonb_typeof(booking.payload) is distinct from 'object'
      or octet_length(booking.payload::text) > 65536
      or booking.payload->'accept_risk' is distinct from 'true'::jsonb
      or jsonb_typeof(booking.payload->'participants') is distinct from 'array'
      then return unknown_result; end if;
    if jsonb_array_length(booking.payload->'participants') <> booking.qty
      or not exists (select 1 from pg_timezone_names where name=business_zone)
      then return unknown_result; end if;
    signed_date := (booking.waiver_signed_at at time zone business_zone)::date;
    for participant in select value from jsonb_array_elements(booking.payload->'participants') loop
      if jsonb_typeof(participant) is distinct from 'object'
        or jsonb_typeof(participant->'name') is distinct from 'string' or nullif(btrim(participant->>'name'),'') is null
        or jsonb_typeof(participant->'dob') is distinct from 'string' or not coalesce(participant->>'dob' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',false)
        or jsonb_typeof(participant->'accepts_liability') is distinct from 'boolean'
        then return unknown_result; end if;
      begin
        birth_date := (participant->>'dob')::date;
      exception when invalid_datetime_format or datetime_field_overflow then return unknown_result;
      end;
      if birth_date > signed_date then return unknown_result; end if;
      -- Same calendar-age rule as the form, evaluated at signing in the business
      -- zone. The form's original browser zone/identity checks are not recorded.
      if extract(year from signed_date)-extract(year from birth_date)
        - (case when to_char(signed_date,'MM-DD') < to_char(birth_date,'MM-DD') then 1 else 0 end) < 18 then
        if booking.payload->'guardian_consent' is distinct from 'true'::jsonb
          or jsonb_typeof(booking.payload->'guardian_name') is distinct from 'string' or nullif(btrim(booking.payload->>'guardian_name'),'') is null
          or jsonb_typeof(booking.payload->'guardian_id_number') is distinct from 'string' or nullif(btrim(booking.payload->>'guardian_id_number'),'') is null
          or jsonb_typeof(booking.payload->'guardian_signature') is distinct from 'string' or nullif(btrim(booking.payload->>'guardian_signature'),'') is null
          then return unknown_result; end if;
      end if;
      if participant->'accepts_liability'='false'::jsonb then outstanding := outstanding + 1; end if;
    end loop;
  end loop;
  return jsonb_build_object('outstanding_waiver_participants',outstanding,'reason',null);
end $$;
revoke all on function public.agent_departure_waiver_counts(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.agent_departure_waiver_counts(uuid,uuid,uuid) to authenticated;
commit;
