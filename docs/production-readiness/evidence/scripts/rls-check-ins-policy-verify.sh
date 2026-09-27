#!/bin/bash
# Finding C verification: plan shape + allowed/denied for check_ins_admin old vs hoisted.
set -e
WT=/private/tmp/candidate-assembly
SOCK=/private/tmp/capekayak-db-test-rls$RANDOM
PG=/opt/homebrew/opt/postgresql@17/bin
cd "$WT"
mkdir -p "$SOCK" && $PG/initdb -D "$SOCK" -U "$USER" --no-sync >/dev/null 2>&1
$PG/pg_ctl -D "$SOCK" start -o "-k $SOCK -h '' -p 55446" -l "$SOCK/log" >/dev/null 2>&1
trap "$PG/pg_ctl -D $SOCK stop -m fast >/dev/null 2>&1; rm -rf $SOCK" EXIT
P="$PG/psql -h $SOCK -p 55446 -U $USER -d postgres -q -v ON_ERROR_STOP=1"
$P -c "create database rlsdb" >/dev/null
$P -d rlsdb -f tests/fixtures/rollout-schema.sql >/dev/null
$P -d rlsdb -f tests/fixtures/rollout-policies.sql >/dev/null 2>&1 || true
$P -d rlsdb <<'SQL'
grant usage on schema public to anon, authenticated;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table if not exists public.slot_check_ins (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  slot_id uuid, actor_admin_id uuid,
  checked_in_at timestamptz not null default now(),
  client_event_id text, source text default 'guide-pwa', notes text
);
alter table public.slot_check_ins enable row level security;
drop policy if exists check_ins_admin on public.slot_check_ins;
create policy check_ins_admin on public.slot_check_ins for all to authenticated
  using (business_id = ANY(public.current_business_ids()))
  with check (business_id = ANY(public.current_business_ids()));
revoke all on public.slot_check_ins from public, anon, authenticated;
grant select, insert on public.slot_check_ins to authenticated; -- INSERT granted only to exercise WITH CHECK; production is SELECT-only + service RPC writes
-- fixtures: two tenants, one admin each, check-in rows
insert into public.businesses(id,name,operator_email) values
  ('00000000-0000-4000-8000-000000000001','A','a@fixture.invalid'),
  ('00000000-0000-4000-8000-000000000002','B','b@fixture.invalid');
insert into public.admin_users(id,email,password_hash,role,business_id,user_id) values
  ('00000000-0000-4000-8000-000000000011','a@fixture.invalid','','OPERATOR','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011'),
  ('00000000-0000-4000-8000-000000000012','b@fixture.invalid','','OPERATOR','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000012');
insert into public.bookings(id,business_id,tour_id,customer_name,email,qty,unit_price,total_amount,status) values
  ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','Ga','ga@fixture.invalid',1,100,100,'PAID'),
  ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','Gb','gb@fixture.invalid',1,100,100,'PAID');
insert into public.slot_check_ins(id,business_id,booking_id) values
  ('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000021'),
  ('00000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000021'),
  ('00000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000022');
SQL

plan() { # $1=label
  $P -d rlsdb -At -c "begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000011'; explain select * from public.slot_check_ins; commit;" | sed "s/^/  [$1] /"
}
echo "=== PLAN old (bare = ANY) ==="; plan old
$P -d rlsdb -f supabase/migrations/20260925120000_check_ins_policy_hoisted.sql >/dev/null
echo "=== PLAN new (hoisted subquery) ==="; plan new
echo "=== pg_policies render for baseline ==="
$P -d rlsdb -At -F'|' -c "select qual, with_check from pg_policies where policyname='check_ins_admin'"

echo "=== allowed/denied (as admin of tenant 1) ==="
$P -d rlsdb -At -c "begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000011';
  select 'visible_rows='||count(*) from public.slot_check_ins;
  insert into public.slot_check_ins(business_id,booking_id) values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000021');
  select 'own_tenant_insert=OK'; commit;" 2>&1 | sed 's/^/  /'
$P -d rlsdb -At -c "begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000011';
  insert into public.slot_check_ins(business_id,booking_id) values ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000022'); commit;" 2>&1 | head -1 | sed 's/^/  foreign_tenant_insert: /'
$P -d rlsdb -At -c "begin; set local role anon; select 'anon_rows='||count(*) from public.slot_check_ins; commit;" 2>&1 | head -1 | sed 's/^/  /'
