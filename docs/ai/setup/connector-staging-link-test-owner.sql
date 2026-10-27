-- Run AFTER creating connector-owner@example.invalid in Supabase Auth.
-- For test project gwwnkihblioayklptdab only; does not create/change a password.
begin;
do $$
declare
  test_user uuid;
  confirmed_at timestamptz;
  test_business constant uuid := '10000000-0000-4000-8000-000000000001';
begin
  if obj_description(to_regnamespace('agent_private'), 'pg_namespace') is distinct from
    'Synthetic connector staging only: Supabase project gwwnkihblioayklptdab. External providers disabled.' then
    raise exception 'Stopped: this is not the identified connector test database.';
  end if;wr
  select id, email_confirmed_at into test_user, confirmed_at from auth.users
  where lower(email) = 'connector-owner@example.invalid'
    and deleted_at is null and (banned_until is null or banned_until <= now());
  if test_user is null then
    raise exception 'Create connector-owner@example.invalid using Authentication > Users > Add user > Create new user first.';
  end if;
  if confirmed_at is null then
    raise exception 'The test email is not confirmed. Create this test account with Auto Confirm User enabled.';
  end if;
  if not exists (select 1 from public.businesses where id = test_business
    and business_name = 'BookingTours Connector Test') then
    raise exception 'Stopped: the sample business is missing.';
  end if;
  if exists (select 1 from public.admin_users
    where (user_id = test_user or lower(email) = 'connector-owner@example.invalid')
      and (user_id is distinct from test_user or business_id is distinct from test_business
        or role <> 'MAIN_ADMIN' or suspended or read_only or must_set_password)) then
    raise exception 'Stopped: an existing operator row conflicts with this test login. No permissions were changed.';
  end if;
  insert into public.admin_users
    (business_id,user_id,email,name,role,password_set_at,must_set_password,read_only)
  values
    (test_business,test_user,'connector-owner@example.invalid','Connector Test Owner','MAIN_ADMIN',now(),false,false)
  on conflict (user_id) do nothing;
  perform set_config('staging.connector_test_user_id',test_user::text,true);
end $$;

-- Test the actual restricted function owner's visibility before committing.
set local role bookingtours_agent_owner;
do $$
begin
  if not agent_private.owner_allowed(current_setting('staging.connector_test_user_id')::uuid,
    '10000000-0000-4000-8000-000000000001'::uuid) then
    raise exception 'The restricted connector owner cannot verify this Auth user. Database permissions need review; the operator link was not saved.';
  end if;
end $$;
reset role;
commit;

select a.email, a.role, b.business_name,
  a.user_id is not null as auth_user_linked,
  (select count(*) from agent_private.providers where enabled) as enabled_connectors
from public.admin_users a join public.businesses b on b.id = a.business_id
where a.email = 'connector-owner@example.invalid'
  and a.business_id = '10000000-0000-4000-8000-000000000001';
