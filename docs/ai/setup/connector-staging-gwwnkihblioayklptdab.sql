-- PREPARED 8 OCTOBER 2026 FOR THE USER-CONFIRMED EMPTY TEST PROJECT ONLY.
-- Open https://supabase.com/dashboard/project/gwwnkihblioayklptdab/sql in SQL Editor.
-- Do not run in the live BookingTours project. No credentials or real customer data.
-- One transaction: any setup error rolls back all setup changes.
-- This installs test-only application tables and the existing MCP database contract.
-- Both providers stay disabled, and the gateway role has no login/password.

-- Empty Supabase project gwwnkihblioayklptdab, synthetic connector rehearsal only.
-- This is the minimum application schema for native owner login and MCP reads.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '55s';
do $$
begin
  if exists (select 1 from pg_catalog.pg_tables where schemaname = 'public')
    or exists (select 1 from pg_namespace where nspname = 'agent_private') then
    raise exception 'Setup stopped: this script requires an empty test project. Existing data was not changed.';
  end if;
  if to_regclass('auth.users') is null or to_regprocedure('auth.uid()') is null
    or to_regprocedure('auth.role()') is null then
    raise exception 'Setup stopped: Supabase Auth is not ready.';
  end if;
  if exists (select 1 from pg_roles where rolname in ('bookingtours_agent_owner','bookingtours_agent_gateway')) then
    raise exception 'Setup stopped: connector database roles already exist. Review the earlier setup first.';
  end if;
end $$;

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business_name text not null,
  operator_email text,
  subdomain text unique,
  timezone text not null default 'Africa/Johannesburg',
  subscription_status text not null default 'ACTIVE',
  logo_url text not null default '',
  booking_site_url text not null default '',
  yoco_test_mode boolean not null default true,
  max_admin_seats integer not null default 3,
  booking_custom_fields jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create table public.admin_users (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  user_id uuid unique references auth.users(id) on delete cascade,
  email text not null unique,
  name text not null,
  role text not null check (role in ('MAIN_ADMIN','ADMIN','OPERATOR','GUIDE','SUPER_ADMIN')),
  password_hash text,
  suspended boolean not null default false,
  read_only boolean not null default false,
  settings_permissions jsonb not null default '{}'::jsonb,
  must_set_password boolean not null default false,
  password_set_at timestamptz,
  onboarding_completed_at timestamptz not null default now(),
  help_chat_hidden boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.tours (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  name text not null,
  description text not null default '',
  base_price_per_person numeric(10,2) not null,
  duration_minutes integer not null default 90,
  default_capacity integer not null default 10,
  active boolean not null default true,
  hidden boolean not null default false,
  sort_order integer not null default 0,
  image_url text,
  confirmation_tagline text,
  last_minute_hours integer,
  last_minute_end_hours integer,
  last_minute_price numeric(10,2),
  created_at timestamptz not null default now()
);
create table public.slots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  tour_id uuid not null references public.tours(id),
  start_time timestamptz not null,
  capacity_total integer not null check (capacity_total > 0),
  booked integer not null default 0 check (booked >= 0),
  held integer not null default 0 check (held >= 0),
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED','CANCELLED')),
  created_at timestamptz not null default now(),
  unique (business_id,tour_id,start_time),
  check (booked + held <= capacity_total)
);
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  tour_id uuid not null references public.tours(id),
  slot_id uuid not null references public.slots(id),
  customer_name text not null,
  email text not null,
  phone text,
  qty integer not null check (qty > 0),
  unit_price numeric(10,2) not null,
  total_amount numeric(10,2) not null,
  total_captured numeric(10,2) not null default 0,
  status text not null default 'CONFIRMED',
  waiver_status text not null default 'PENDING',
  waiver_signed_at timestamptz,
  waiver_signed_name text,
  waiver_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.pending_reschedules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  old_slot_id uuid not null references public.slots(id),
  new_slot_id uuid not null references public.slots(id),
  status text not null default 'PENDING',
  created_at timestamptz not null default now()
);

-- Native sessions can read their own membership. No anonymous application reads.
alter table public.admin_users enable row level security;
create policy staging_self_membership on public.admin_users for select to authenticated
  using (user_id = (select auth.uid()));
create function public.current_business_ids() returns uuid[]
language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce(array_agg(business_id), '{}'::uuid[]) from public.admin_users
  where user_id = auth.uid() and not suspended
$$;
revoke all on function public.current_business_ids() from public, anon;
grant execute on function public.current_business_ids() to authenticated, service_role;
alter table public.businesses enable row level security;
create policy staging_business_read on public.businesses for select to authenticated
  using (id = any((select public.current_business_ids())::uuid[]));
do $$
declare relation text;
begin
  foreach relation in array array['tours','slots','bookings','pending_reschedules'] loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('create policy staging_owner_read on public.%I for select to authenticated using (business_id = any((select public.current_business_ids())::uuid[]))', relation);
  end loop;
  foreach relation in array array['businesses','admin_users','tours','slots','bookings','pending_reschedules'] loop
    execute format('revoke all on table public.%I from public, anon, authenticated', relation);
    execute format('grant select on table public.%I to authenticated', relation);
    execute format('grant all on table public.%I to service_role', relation);
  end loop;
end $$;
grant usage on schema public to authenticated, service_role;
create function public.get_my_admin_onboarding()
returns table (onboarding_completed_at timestamptz, help_chat_hidden boolean)
language sql stable security invoker set search_path = public, pg_temp as $$
  select onboarding_completed_at, help_chat_hidden from public.admin_users where user_id = auth.uid()
$$;
revoke all on function public.get_my_admin_onboarding() from public, anon;
grant execute on function public.get_my_admin_onboarding() to authenticated;

-- Preserve the application's canonical capacity calculation, including held seats.
create function public.slot_available_capacity(p_slot_id uuid) returns integer
language sql stable security invoker set search_path = public, pg_temp as $$
  select greatest(s.capacity_total - coalesce(s.booked, 0) - coalesce(s.held, 0), 0)
  from public.slots s where s.id = p_slot_id
$$;
revoke all on function public.slot_available_capacity(uuid) from public, anon;
grant execute on function public.slot_available_capacity(uuid) to authenticated, service_role;

-- Keep the database administrator able to install and maintain the private schema.
-- This does not give the application gateway membership in any privileged role.
create role bookingtours_agent_owner nologin nosuperuser nobypassrls noinherit;
create role bookingtours_agent_gateway nologin nosuperuser nobypassrls noinherit;
do $$ begin
  execute format('grant bookingtours_agent_owner to %I with set true, inherit true', current_user);
end $$;

-- Source: supabase/migrations/20261003160000_agent_read_foundation.sql
-- SHA-256: 99dfbb1a6d0cb958bb9ab70591df530f59babc5f6ea96f4e63ee6b6e0974136c
-- Agent read foundation: additive schema, disabled grants by default.
-- Source from the tested local candidate; public application route remains closed.
-- No connection authorisation endpoint issues these grants or custom claims.
-- Owner-approved pilot policy: MAIN_ADMIN only; no staff or super-admin bypass.
-- Fixed seven-day maximum; renewing requires a new owner-approved grant.
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

-- Source: supabase/agent-mcp.local.sql
-- SHA-256: 3d39b2a373555d1181b85a9e791bfd8fd79cc0654bbb1e09742230797efe28cc
-- LOCAL CANDIDATE requiring release review, outside the production migration ledger.
-- Apply AFTER agent-foundation.local.sql in a disposable database only.
-- Production application and credential provisioning require a separate release.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='bookingtours_agent_owner') then
    create role bookingtours_agent_owner nologin nosuperuser nobypassrls noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname='bookingtours_agent_gateway') then
    create role bookingtours_agent_gateway nologin nosuperuser nobypassrls noinherit;
  end if;
  if exists (select 1 from pg_roles where rolname in ('bookingtours_agent_owner','bookingtours_agent_gateway')
    and (rolsuper or rolbypassrls or rolinherit))
    or exists(select 1 from pg_roles where rolname='bookingtours_agent_owner' and rolcanlogin)
    or pg_has_role('bookingtours_agent_gateway','authenticated','MEMBER')
    or pg_has_role('bookingtours_agent_gateway','service_role','MEMBER')
    or pg_has_role('bookingtours_agent_gateway','bookingtours_agent_owner','MEMBER') then
    raise exception 'Unsafe agent role configuration';
  end if;
end $$;
create schema agent_private authorization bookingtours_agent_owner;
revoke all on schema agent_private from public, anon, authenticated, service_role;
grant usage on schema agent_private to bookingtours_agent_gateway;
grant usage on schema public, auth to bookingtours_agent_owner;
grant execute on function auth.uid(), auth.role() to bookingtours_agent_owner;
grant select(id,deleted_at,banned_until) on auth.users to bookingtours_agent_owner;
grant select(id,business_id,user_id,role,suspended,read_only) on public.admin_users to bookingtours_agent_owner;
grant select(id,timezone,subscription_status) on public.businesses to bookingtours_agent_owner;
grant select(id,business_id) on public.tours to bookingtours_agent_owner;
grant select(id,business_id,tour_id,start_time,status,capacity_total,booked,held) on public.slots to bookingtours_agent_owner;
grant select(id,business_id,slot_id,status,waiver_status,total_amount,total_captured,qty,
  waiver_signed_at,waiver_signed_name,waiver_payload) on public.bookings to bookingtours_agent_owner;
grant select(id,business_id,status,old_slot_id,new_slot_id) on public.pending_reschedules to bookingtours_agent_owner;
grant execute on function public.slot_available_capacity(uuid), public.agent_read_observed_at(uuid,uuid,text),
  public.agent_departure_waiver_counts(uuid,uuid,uuid) to bookingtours_agent_owner;
alter table public.agent_connection_grants add column resource text;
grant select,insert,update,references on public.agent_connection_grants to bookingtours_agent_owner;
create policy agent_gateway_grants on public.agent_connection_grants to bookingtours_agent_owner
  using (true) with check (true);

-- Added policies apply ONLY to the restricted role. Existing Supabase session
-- policies/permissions are retained. RLS stays enabled; neither role bypasses it.
create policy agent_gateway_member on public.admin_users for select to bookingtours_agent_owner
  using (user_id=auth.uid() and business_id::text=current_setting('agent.business_id',true));
create policy agent_gateway_business on public.businesses for select to bookingtours_agent_owner
  using (id::text=current_setting('agent.business_id',true));
create policy agent_gateway_tour on public.tours for select to bookingtours_agent_owner
  using (business_id::text=current_setting('agent.business_id',true));
create policy agent_gateway_slot on public.slots for select to bookingtours_agent_owner
  using (business_id::text=current_setting('agent.business_id',true));
create policy agent_gateway_booking on public.bookings for select to bookingtours_agent_owner
  using (business_id::text=current_setting('agent.business_id',true));
create policy agent_gateway_pending on public.pending_reschedules for select to bookingtours_agent_owner
  using (business_id::text=current_setting('agent.business_id',true));
-- Restrictive policies also constrain any pre-existing policy TO PUBLIC.
create policy agent_gateway_member_bound on public.admin_users as restrictive for select to bookingtours_agent_owner
  using (user_id=auth.uid() and business_id::text=current_setting('agent.business_id',true));
create policy agent_gateway_business_bound on public.businesses as restrictive for select to bookingtours_agent_owner
  using (id::text=current_setting('agent.business_id',true));
create policy agent_gateway_tour_bound on public.tours as restrictive for select to bookingtours_agent_owner
  using (business_id::text=current_setting('agent.business_id',true));
create policy agent_gateway_slot_bound on public.slots as restrictive for select to bookingtours_agent_owner
  using (business_id::text=current_setting('agent.business_id',true));
create policy agent_gateway_booking_bound on public.bookings as restrictive for select to bookingtours_agent_owner
  using (business_id::text=current_setting('agent.business_id',true));
create policy agent_gateway_pending_bound on public.pending_reschedules as restrictive for select to bookingtours_agent_owner
  using (business_id::text=current_setting('agent.business_id',true));

set local role bookingtours_agent_owner;
create table agent_private.providers (
  provider text primary key check(provider in ('CHATGPT','MUSE')),
  enabled boolean not null default false,
  issuer text check(issuer ~ '^https://[^/]+$'),
  resource text unique check(resource ~ '^https://[^/]+/api/mcp/(chatgpt|muse)$'),
  pilot_businesses uuid[] not null default '{}'
);
insert into agent_private.providers(provider) values ('CHATGPT'),('MUSE');
create table agent_private.clients (
  id text primary key check(length(id) between 1 and 200),
  provider text not null references agent_private.providers(provider),
  resource text not null, redirects text[] not null check(cardinality(redirects) between 1 and 8),
  created_at timestamptz not null default statement_timestamp()
);
create table agent_private.requests (
  hash text primary key check(hash ~ '^[a-f0-9]{64}$'),
  client_id text not null references agent_private.clients(id),
  params jsonb not null, expires_at timestamptz not null default (statement_timestamp()+interval '10 minutes'),
  consumed_at timestamptz
);
create index agent_requests_expiry on agent_private.requests(expires_at);
create table agent_private.codes (
  hash text primary key check(hash ~ '^[a-f0-9]{64}$'),
  grant_id uuid not null references public.agent_connection_grants(id) on delete cascade,
  redirect_uri text not null, challenge text not null check(challenge ~ '^[A-Za-z0-9_-]{43}$'),
  expires_at timestamptz not null, consumed_at timestamptz,
  check(expires_at <= statement_timestamp()+interval '60 seconds')
);
create index agent_codes_expiry on agent_private.codes(expires_at);
create table agent_private.tokens (
  hash text primary key check(hash ~ '^[a-f0-9]{64}$'),
  refresh_hash text unique not null check(refresh_hash ~ '^[a-f0-9]{64}$'),
  grant_id uuid not null references public.agent_connection_grants(id) on delete cascade,
  scopes text[] not null check(cardinality(scopes) between 1 and 3
    and scopes <@ array['departures:read','availability:read','attention:read']::text[]),
  issued_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null, refresh_expires_at timestamptz not null,
  consumed_at timestamptz, revoked_at timestamptz,
  check(expires_at>issued_at and expires_at<=issued_at+interval '10 minutes'),
  check(refresh_expires_at>issued_at and refresh_expires_at<=issued_at+interval '168 hours')
);
create index agent_tokens_grant on agent_private.tokens(grant_id);
create index agent_tokens_expiry on agent_private.tokens(refresh_expires_at);
create table agent_private.quotas (key text primary key, window_start timestamptz not null, used integer not null);
-- Private tables are not in PostgREST's public schema and have no client grants.
-- RLS is explicitly enabled; their non-login owner alone owns/reads the state.
alter table agent_private.providers enable row level security;
alter table agent_private.clients enable row level security;
alter table agent_private.requests enable row level security;
alter table agent_private.codes enable row level security;
alter table agent_private.tokens enable row level security;
alter table agent_private.quotas enable row level security;

create function agent_private.context(p_user uuid,p_business uuid,p_grant uuid default null,p_client text default null,p_exp timestamptz default null,p_scopes text[] default '{}')
returns void language plpgsql security invoker set search_path=pg_catalog,agent_private as $$
begin
  perform set_config('agent.business_id',p_business::text,true);
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claim.role','',true);
  -- INTERNAL DB context for the existing invoker aggregate, never a signed
  -- Supabase token. External audience is independently bound to HTTPS below.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_user,'role','authenticated',
    'client_id',p_client,'agent_grant_id',p_grant,'agent_resource','urn:bookingtours:agent-read',
    'exp',floor(extract(epoch from p_exp)),'scope',array_to_string(p_scopes,' '))::text,true);
end $$;
create function agent_private.owner_allowed(p_user uuid,p_business uuid)
returns boolean language plpgsql security invoker set search_path=pg_catalog,agent_private as $$
begin
  perform agent_private.context(p_user,p_business);
  return exists(select 1 from auth.users u join public.admin_users a on a.user_id=u.id
    join public.businesses b on b.id=a.business_id where u.id=p_user and b.id=p_business
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=statement_timestamp())
      and a.role='MAIN_ADMIN' and not a.suspended and not coalesce(a.read_only,false)
      and b.subscription_status in ('ACTIVE','TRIAL','PAST_DUE'));
end $$;
create function agent_private.active_grant(p_grant uuid,p_provider text,p_resource text)
returns public.agent_connection_grants language plpgsql security invoker set search_path=pg_catalog,agent_private as $$
declare g public.agent_connection_grants; c agent_private.providers;
begin
  select * into c from agent_private.providers where provider=p_provider;
  select * into g from public.agent_connection_grants where id=p_grant;
  if not coalesce(c.enabled,false) or c.resource is distinct from p_resource
    or g.id is null or g.provider is distinct from p_provider or g.resource is distinct from p_resource
    or not g.enabled or g.disconnected_at is not null or g.created_at>statement_timestamp()
    or g.expires_at<=statement_timestamp() or not(g.business_id=any(c.pilot_businesses))
    or g.role_at_consent<>'MAIN_ADMIN' or not agent_private.owner_allowed(g.user_id,g.business_id)
    or not exists(select 1 from agent_private.clients x where x.id=g.client_id and x.provider=g.provider and x.resource=g.resource)
  then raise exception 'CONNECTION_INACTIVE' using errcode='42501'; end if;
  return g;
end $$;
create function agent_private.token_access(p_hash text,p_provider text,p_resource text,p_scopes text[])
returns jsonb language plpgsql security invoker set search_path=pg_catalog,agent_private as $$
declare t agent_private.tokens; g public.agent_connection_grants; c agent_private.providers;
begin
  select * into t from agent_private.tokens where hash=p_hash;
  if t.hash is null or t.revoked_at is not null or t.issued_at>statement_timestamp()
    or t.expires_at<=statement_timestamp() then raise exception 'UNAUTHENTICATED' using errcode='28000'; end if;
  g:=agent_private.active_grant(t.grant_id,p_provider,p_resource);
  if cardinality(p_scopes)<1 or not(p_scopes <@ array['departures:read','availability:read','attention:read']::text[])
    or not(p_scopes <@ t.scopes) or not(t.scopes <@ g.scopes)
  then raise exception 'INSUFFICIENT_SCOPE' using errcode='42501'; end if;
  select * into c from agent_private.providers where provider=p_provider;
  perform agent_private.context(g.user_id,g.business_id,g.id,g.client_id,t.expires_at,t.scopes);
  return jsonb_build_object('sub',g.user_id,'business_id',g.business_id,'agent_grant_id',g.id,'client_id',g.client_id,
    'iss',c.issuer,'aud',c.resource,'role','agent_read','agent_resource',c.resource,
    'exp',floor(extract(epoch from t.expires_at)),'scope',array_to_string(t.scopes,' '));
end $$;
create function agent_private.quota(p_key text,p_limit integer)
returns boolean language plpgsql security invoker set search_path=pg_catalog,agent_private as $$
declare n integer; at timestamptz:=date_trunc('minute',statement_timestamp());
begin
  insert into agent_private.quotas as q values(p_key,at,1)
    on conflict(key) do update set window_start=at, used=case when q.window_start=at then q.used+1 else 1 end
    returning used into n;
  return n<=p_limit;
end $$;

-- Only this allowlisted state API is executable by the server credential.
-- Caller identity for consent/manage is validated by Supabase Auth in the app;
-- every state transition also independently checks current DB membership.
create function agent_private.store(p_action text,p jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,agent_private as $$
declare c agent_private.clients; r agent_private.requests; g public.agent_connection_grants;
  t agent_private.tokens; code agent_private.codes; cfg agent_private.providers; scopes text[]; at timestamptz;
begin
  -- Bounded opportunistic cleanup, security state only. Retain refresh hashes
  -- until their absolute expiry so replay detection remains effective.
  if p_action in ('request_create','token_save') then
    delete from agent_private.requests where hash in (select hash from agent_private.requests
      where expires_at<=statement_timestamp() order by expires_at limit 100);
    delete from agent_private.codes where hash in (select hash from agent_private.codes
      where expires_at<=statement_timestamp() order by expires_at limit 100);
    delete from agent_private.tokens where hash in (select hash from agent_private.tokens
      where refresh_expires_at<=statement_timestamp() order by refresh_expires_at limit 100);
  end if;
  if p_action='ready' then
    return to_jsonb(exists(select 1 from agent_private.providers where provider=p->>'provider'
      and enabled and issuer=p->>'issuer' and resource=p->>'resource' and cardinality(pilot_businesses)>0));
  elsif p_action='abuse_quota' then
    if p->>'key' !~ '^(oauth|mcp|manage):[a-f0-9]{64}$' then raise exception 'INVALID_INPUT'; end if;
    return to_jsonb(agent_private.quota(p->>'key',60));
  elsif p_action='register' then
    select * into cfg from agent_private.providers where provider=p->>'provider';
    if not coalesce(cfg.enabled,false) or cfg.resource is distinct from p->>'resource'
      or jsonb_array_length(p->'redirects') not between 1 and 8
    then raise exception 'INTEGRATION_DISABLED' using errcode='42501'; end if;
    insert into agent_private.clients(id,provider,resource,redirects)
      values(p->>'id',p->>'provider',p->>'resource',array(select jsonb_array_elements_text(p->'redirects')));
    return '{}'::jsonb;
  elsif p_action='client' then
    select * into c from agent_private.clients where id=p->>'id' and provider=p->>'provider' and resource=p->>'resource';
    select * into cfg from agent_private.providers where provider=p->>'provider';
    if c.id is null or not coalesce(cfg.enabled,false) or cfg.resource is distinct from c.resource then return null; end if;
    return jsonb_build_object('id',c.id,'redirectUris',c.redirects,'grants',array['authorization_code','refresh_token']);
  elsif p_action='request_create' then
    select * into c from agent_private.clients where id=p->'params'->>'client_id'
      and provider=p->>'provider' and resource=p->>'resource';
    if c.id is null or not(p->'params'->>'redirect_uri'=any(c.redirects)) then raise exception 'INVALID_CLIENT' using errcode='42501'; end if;
    insert into agent_private.requests(hash,client_id,params) values(p->>'hash',c.id,p->'params');
    return '{}'::jsonb;
  elsif p_action in ('request_get','request_take') then
    select * into r from agent_private.requests where hash=p->>'hash' for update;
    select * into c from agent_private.clients where id=r.client_id and provider=p->>'provider' and resource=p->>'resource';
    if c.id is null or r.consumed_at is not null or r.expires_at<=statement_timestamp() then return null; end if;
    if p_action='request_take' then update agent_private.requests set consumed_at=statement_timestamp() where hash=r.hash; end if;
    return r.params;
  elsif p_action='grant_create' then
    select * into cfg from agent_private.providers where provider=p->>'provider';
    select * into c from agent_private.clients where id=p->>'client_id' and provider=cfg.provider and resource=cfg.resource;
    scopes:=array(select jsonb_array_elements_text(p->'scopes'));
    if not coalesce(cfg.enabled,false) or cfg.resource is distinct from p->>'resource' or c.id is null
      or not((p->>'business_id')::uuid=any(cfg.pilot_businesses))
      or not('departures:read'=any(scopes)) or not(scopes <@ array['departures:read','availability:read','attention:read']::text[])
      or not agent_private.owner_allowed((p->>'user_id')::uuid,(p->>'business_id')::uuid)
    then raise exception 'FORBIDDEN' using errcode='42501'; end if;
    insert into public.agent_connection_grants(user_id,business_id,client_id,provider,role_at_consent,scopes,enabled,resource)
      values((p->>'user_id')::uuid,(p->>'business_id')::uuid,c.id,c.provider,'MAIN_ADMIN',scopes,true,c.resource) returning * into g;
    return jsonb_build_object('id',g.user_id,'grantId',g.id,'expiresAt',g.expires_at);
  elsif p_action='code_save' then
    g:=agent_private.active_grant((p->>'grant_id')::uuid,p->>'provider',p->>'resource');
    select * into c from agent_private.clients where id=g.client_id;
    if not(p->>'redirect_uri'=any(c.redirects)) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
    insert into agent_private.codes(hash,grant_id,redirect_uri,challenge,expires_at)
      values(p->>'hash',g.id,p->>'redirect_uri',p->>'challenge',least((p->>'expires_at')::timestamptz,g.expires_at));
    return '{}'::jsonb;
  elsif p_action in ('code_get','code_revoke') then
    select * into code from agent_private.codes where hash=p->>'hash' for update;
    if code.hash is null or code.consumed_at is not null or code.expires_at<=statement_timestamp() then return null; end if;
    g:=agent_private.active_grant(code.grant_id,p->>'provider',p->>'resource');
    select * into c from agent_private.clients where id=g.client_id;
    if p_action='code_revoke' then update agent_private.codes set consumed_at=statement_timestamp() where hash=code.hash; return 'true'::jsonb; end if;
    return jsonb_build_object('expiresAt',code.expires_at,'redirectUri',code.redirect_uri,
      'codeChallenge',code.challenge,'codeChallengeMethod','S256','scope',g.scopes,
      'client',jsonb_build_object('id',c.id),'user',jsonb_build_object('id',g.user_id,'grantId',g.id,'expiresAt',g.expires_at));
  elsif p_action='token_save' then
    g:=agent_private.active_grant((p->>'grant_id')::uuid,p->>'provider',p->>'resource');
    scopes:=array(select jsonb_array_elements_text(p->'scopes'));
    if g.client_id is distinct from p->>'client_id' or not(scopes <@ g.scopes) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
    insert into agent_private.tokens(hash,refresh_hash,grant_id,scopes,expires_at,refresh_expires_at)
      values(p->>'hash',p->>'refresh_hash',g.id,scopes,least((p->>'expires_at')::timestamptz,g.expires_at),
        least((p->>'refresh_expires_at')::timestamptz,g.expires_at)) returning * into t;
    return jsonb_build_object('accessTokenExpiresAt',t.expires_at,'refreshTokenExpiresAt',t.refresh_expires_at);
  elsif p_action in ('refresh_get','refresh_revoke') then
    select * into t from agent_private.tokens where refresh_hash=p->>'hash' for update;
    if t.hash is null then return null; end if;
    select * into g from public.agent_connection_grants where id=t.grant_id;
    if g.client_id is distinct from p->>'client_id' or g.provider is distinct from p->>'provider'
      or g.resource is distinct from p->>'resource' then return null; end if;
    -- A replay commits family revocation even though the token request fails.
    if t.consumed_at is not null then
      update public.agent_connection_grants set disconnected_at=coalesce(disconnected_at,statement_timestamp()),enabled=false where id=t.grant_id;
      update agent_private.tokens set revoked_at=coalesce(revoked_at,statement_timestamp()) where grant_id=t.grant_id;
      return null;
    end if;
    if t.revoked_at is not null or t.refresh_expires_at<=statement_timestamp() then return null; end if;
    g:=agent_private.active_grant(t.grant_id,p->>'provider',p->>'resource');
    if g.client_id is distinct from p->>'client_id' then return null; end if;
    if p_action='refresh_revoke' then update agent_private.tokens set consumed_at=statement_timestamp(),revoked_at=statement_timestamp() where hash=t.hash; return 'true'::jsonb; end if;
    return jsonb_build_object('refreshTokenExpiresAt',t.refresh_expires_at,'scope',t.scopes,
      'client',jsonb_build_object('id',g.client_id),'user',jsonb_build_object('id',g.user_id,'grantId',g.id,'expiresAt',g.expires_at));
  elsif p_action='authorize' then
    return agent_private.token_access(p->>'hash',p->>'provider',p->>'resource',array(select jsonb_array_elements_text(p->'scopes')));
  elsif p_action='read_quota' then
    perform agent_private.token_access(p->>'hash',p->>'provider',p->>'resource',array['departures:read']);
    select * into t from agent_private.tokens where hash=p->>'hash';
    select * into g from public.agent_connection_grants where id=t.grant_id;
    return to_jsonb(agent_private.quota('read:'||g.user_id||':'||g.business_id,30));
  elsif p_action='token_revoke' then
    select * into t from agent_private.tokens where hash=p->>'hash' or refresh_hash=p->>'hash' for update;
    select * into g from public.agent_connection_grants where id=t.grant_id;
    if g.id is not null and g.client_id=p->>'client_id' and g.provider=p->>'provider' and g.resource=p->>'resource' then
      update public.agent_connection_grants set enabled=false,disconnected_at=coalesce(disconnected_at,statement_timestamp()) where id=g.id;
      update agent_private.tokens set revoked_at=coalesce(revoked_at,statement_timestamp()) where grant_id=g.id;
    end if;
    return '{}'::jsonb;
  elsif p_action in ('connections','disconnect') then
    if p_action='disconnect' then
      update public.agent_connection_grants set enabled=false,disconnected_at=coalesce(disconnected_at,statement_timestamp())
        where id=(p->>'grant_id')::uuid and user_id=(p->>'user_id')::uuid and business_id=(p->>'business_id')::uuid returning * into g;
      if g.id is null then raise exception 'NOT_FOUND' using errcode='42501'; end if;
      update agent_private.tokens set revoked_at=coalesce(revoked_at,statement_timestamp()) where grant_id=g.id;
      return '{}'::jsonb;
    end if;
    if not agent_private.owner_allowed((p->>'user_id')::uuid,(p->>'business_id')::uuid) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
    return coalesce((select jsonb_agg(x) from (select id,provider,scopes,enabled,created_at,expires_at,disconnected_at
      from public.agent_connection_grants where user_id=(p->>'user_id')::uuid and business_id=(p->>'business_id')::uuid
      order by created_at desc,id limit 50) x),'[]'::jsonb);
  end if;
  raise exception 'UNSUPPORTED_OPERATION' using errcode='42501';
end $$;

-- Narrow data API: no arbitrary SQL, table, select, where, or URL arguments.
-- All object IDs are checked again here, even if the HTTP service checked them.
create function agent_private.read(p_hash text,p_provider text,p_resource text,p_action text,p jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,agent_private as $$
declare claims jsonb; g public.agent_connection_grants; required text[]:=array['departures:read'];
  business uuid; departure uuid; result jsonb; start_at timestamptz; end_at timestamptz;
  take integer; skip integer;
begin
  if p_action in ('bookings','pending','waivers') then required:=required||array['attention:read']; end if;
  if p_action='capacity' then required:=required||array['availability:read']; end if;
  claims:=agent_private.token_access(p_hash,p_provider,p_resource,required);
  business:=(claims->>'business_id')::uuid;
  if p->>'business_id' is not null and (p->>'business_id')::uuid<>business then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  select * into g from public.agent_connection_grants where id=(claims->>'agent_grant_id')::uuid;
  if p_action='member' then
    if p->>'user_id' is distinct from claims->>'sub' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
    select jsonb_build_object('id',a.id,'business_id',a.business_id,'role',a.role,'suspended',a.suspended) into result
      from public.admin_users a where a.user_id=g.user_id and a.business_id=business;
    return jsonb_build_object('data',result);
  elsif p_action='grant' then
    if p->>'id' is distinct from g.id::text or p->>'user_id' is distinct from g.user_id::text then raise exception 'FORBIDDEN' using errcode='42501'; end if;
    return jsonb_build_object('data',jsonb_build_object('id',g.id,'user_id',g.user_id,'business_id',business,
      'client_id',g.client_id,'provider',g.provider,'role_at_consent',g.role_at_consent,'scopes',g.scopes,
      'enabled',g.enabled,'created_at',g.created_at,'expires_at',g.expires_at,'disconnected_at',g.disconnected_at));
  elsif p_action='business' then
    if p->>'id' is distinct from business::text then raise exception 'FORBIDDEN' using errcode='42501'; end if;
    select jsonb_build_object('id',b.id,'timezone',b.timezone,'subscription_status',b.subscription_status) into result from public.businesses b where b.id=business;
    return jsonb_build_object('data',result);
  elsif p_action='tour' then
    select jsonb_build_object('id',id,'business_id',business_id) into result from public.tours where id=(p->>'id')::uuid and business_id=business;
    return jsonb_build_object('data',result);
  elsif p_action='departures' then
    start_at:=(p->>'start_at')::timestamptz; end_at:=(p->>'end_at')::timestamptz;
    take:=(p->>'take')::integer; skip:=(p->>'offset')::integer;
    if start_at is null or end_at is null or not isfinite(start_at) or not isfinite(end_at) or end_at<=start_at
      or end_at-start_at>interval '31 days' or take is null or take not between 2 and 51 or skip is null or skip not between 0 and 1000
    then raise exception 'QUERY_LIMIT' using errcode='22023'; end if;
    if p->>'tour_id' is not null and not exists(select 1 from public.tours where id=(p->>'tour_id')::uuid and business_id=business)
    then raise exception 'NOT_FOUND' using errcode='42501'; end if;
    return jsonb_build_object('data',coalesce((select jsonb_agg(x order by x.start_time,x.id) from
      (select id,business_id,tour_id,start_time,status from public.slots where business_id=business
        and start_time>=start_at and start_time<end_at and (p->>'tour_id' is null or tour_id=(p->>'tour_id')::uuid)
        order by start_time,id limit take offset skip) x),'[]'::jsonb));
  elsif p_action='clock' then
    if p->>'grant_id' is distinct from g.id::text then raise exception 'FORBIDDEN' using errcode='42501'; end if;
    return jsonb_build_object('data',public.agent_read_observed_at(business,g.id,p->>'scope'));
  end if;
  departure:=(p->>'departure_id')::uuid;
  if departure is null or not exists(select 1 from public.slots where id=departure and business_id=business)
  then return jsonb_build_object('data',null); end if;
  if p_action='departure' then
    select jsonb_build_object('id',id,'business_id',business_id,'start_time',start_time,'status',status) into result from public.slots where id=departure and business_id=business;
    return jsonb_build_object('data',result);
  elsif p_action='capacity' then return jsonb_build_object('data',public.slot_available_capacity(departure));
  elsif p_action='waivers' then
    return jsonb_build_object('data',public.agent_departure_waiver_counts(business,departure,g.id));
  elsif p_action='bookings' then
    with bounded as (select status,waiver_status,total_amount,total_captured from public.bookings where business_id=business and slot_id=departure order by id limit 501)
      select jsonb_build_object('data',coalesce(jsonb_agg(bounded),'[]'::jsonb),'count',count(*)) into result from bounded;
    return result;
  elsif p_action='pending' then
    if p->>'direction' not in ('old','new') then raise exception 'INVALID_INPUT'; end if;
    select jsonb_build_object('data',null,'count',count(*)) into result from
      (select id from public.pending_reschedules where business_id=business and status='PENDING'
        and case when p->>'direction'='old' then old_slot_id=departure else new_slot_id=departure end limit 501) x;
    return result;
  end if;
  raise exception 'UNSUPPORTED_OPERATION' using errcode='42501';
end $$;

-- A membership/role round-trip must not silently restore a previous consent.
-- This trigger changes only the corresponding agent security state.
create function agent_private.membership_changed()
returns trigger language plpgsql security definer set search_path=pg_catalog,agent_private as $$
begin
  if tg_op='DELETE' or new.user_id is distinct from old.user_id or new.business_id is distinct from old.business_id
    or new.role is distinct from old.role or new.suspended is distinct from old.suspended or new.read_only is distinct from old.read_only then
    update public.agent_connection_grants set enabled=false,disconnected_at=coalesce(disconnected_at,statement_timestamp())
      where user_id=old.user_id and business_id=old.business_id;
    update agent_private.tokens set revoked_at=coalesce(revoked_at,statement_timestamp()) where grant_id in
      (select id from public.agent_connection_grants where user_id=old.user_id and business_id=old.business_id);
  end if;
  return null;
end $$;
revoke all on all tables in schema agent_private from public,anon,authenticated,service_role,bookingtours_agent_gateway;
revoke all on all functions in schema agent_private from public,anon,authenticated,service_role,bookingtours_agent_gateway;
grant execute on function agent_private.store(text,jsonb),agent_private.read(text,text,text,text,jsonb) to bookingtours_agent_gateway;
alter default privileges in schema agent_private revoke execute on functions from public;
reset role;
create trigger agent_membership_changed after update of user_id,business_id,role,suspended,read_only or delete
  on public.admin_users for each row execute function agent_private.membership_changed();

-- All sample names, emails, bookings and amounts below are fictional.
insert into public.businesses (id,name,business_name,operator_email,subdomain)
values ('10000000-0000-4000-8000-000000000001','BookingTours Connector Test','BookingTours Connector Test',
  'connector-owner@example.invalid','connector-test');
insert into public.tours (id,business_id,name,description,base_price_per_person,duration_minutes,default_capacity,sort_order)
values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Mountain Trail Walk (TEST)',
   'Synthetic connector test activity. No real bookings or trips.',600,90,10,0),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Coastal Paddle (TEST)',
   'Synthetic connector test activity. No real bookings or trips.',450,120,8,1);
insert into public.slots (id,business_id,tour_id,start_time,capacity_total,booked,held,status)
values
  ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
   ((now() at time zone 'Africa/Johannesburg')::date + 1 + time '09:00') at time zone 'Africa/Johannesburg',10,5,1,'OPEN'),
  ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',
   ((now() at time zone 'Africa/Johannesburg')::date + 1 + time '14:00') at time zone 'Africa/Johannesburg',8,1,0,'OPEN'),
  ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
   ((now() at time zone 'Africa/Johannesburg')::date + 3 + time '09:00') at time zone 'Africa/Johannesburg',10,0,2,'OPEN'),
  ('30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',
   ((now() at time zone 'Africa/Johannesburg')::date + 3 + time '14:00') at time zone 'Africa/Johannesburg',8,0,0,'CLOSED');
insert into public.bookings (id,business_id,tour_id,slot_id,customer_name,email,qty,unit_price,total_amount,total_captured,
  status,waiver_status,waiver_signed_at,waiver_signed_name,waiver_payload)
values
  ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000001','Synthetic unpaid group','unpaid@example.invalid',3,600,1800,0,'CONFIRMED','PENDING',null,null,'{}'),
  ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000001','Synthetic paid group','paid@example.invalid',2,600,1200,1200,'CONFIRMED','SIGNED',
   now() - interval '1 hour','Synthetic test signer',
   '{"accept_risk":true,"participants":[{"name":"Synthetic participant A","dob":"1990-01-01","accepts_liability":true},{"name":"Synthetic participant B","dob":"1990-01-01","accepts_liability":true}]}'),
  ('40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',
   '30000000-0000-4000-8000-000000000002','Synthetic partial payment','partial@example.invalid',1,450,450,200,'CONFIRMED','PENDING',null,null,'{}');

comment on schema agent_private is 'Synthetic connector staging only: Supabase project gwwnkihblioayklptdab. External providers disabled.';
commit;

-- Return one short setup report; no passwords, API keys or Auth tokens are shown.
select 'TEST_DATABASE_INSTALLED' as result,
  'gwwnkihblioayklptdab' as intended_project,
  (select count(*) from public.tours) as test_tours,
  (select count(*) from public.slots) as test_departures,
  (select count(*) from public.bookings) as test_bookings,
  (select count(*) from agent_private.providers where enabled) as enabled_connectors,
  case when exists (
    select 1 from pg_class t join pg_namespace n on n.oid = t.relnamespace
    where n.nspname in ('public','auth','storage','agent_private') and t.relkind in ('r','p','v','m','f')
      and (has_any_column_privilege('bookingtours_agent_gateway',t.oid,'SELECT,INSERT,UPDATE')
        or has_table_privilege('bookingtours_agent_gateway',t.oid,'DELETE,TRUNCATE'))
  ) or exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef and n.nspname not in ('pg_catalog','information_schema')
      and has_function_privilege('bookingtours_agent_gateway',p.oid,'EXECUTE')
      and not (n.nspname = 'agent_private' and p.proname in ('store','read'))
  ) then 'REVIEW_REQUIRED' else 'PASS' end as gateway_privileges;
