-- Supabase-managed Auth schema compatibility for test project gwwnkihblioayklptdab.
-- Uses existing SELECT column privileges; grants no Auth schema access or role membership.
rollback;
begin;
do $$
begin
  if current_user <> 'postgres' or obj_description(to_regnamespace('agent_private'),'pg_namespace') is distinct from
    'Synthetic connector staging only: Supabase project gwwnkihblioayklptdab. External providers disabled.' then
    raise exception 'Stopped: run this as postgres in the identified connector test project.';
  end if;
  if not has_column_privilege('bookingtours_agent_owner','auth.users','id','SELECT')
    or not has_column_privilege('bookingtours_agent_owner','auth.users','deleted_at','SELECT')
    or not has_column_privilege('bookingtours_agent_owner','auth.users','banned_until','SELECT') then
    raise exception 'Stopped: the required three Auth column permissions are missing.';
  end if;
end $$;

-- Names in auth are resolved when postgres creates the views. At read time,
-- security_invoker retains the restricted caller's column permissions and RLS.
create or replace view agent_private.auth_user_status
with (security_invoker = true, security_barrier = true) as
  select id, deleted_at, banned_until from auth.users where id = auth.uid();
create or replace view agent_private.request_identity
with (security_invoker = true, security_barrier = true) as
  select auth.uid() as user_id, auth.role() as user_role;
revoke all on agent_private.auth_user_status, agent_private.request_identity
  from public, anon, authenticated, service_role, bookingtours_agent_gateway;
grant select on agent_private.auth_user_status, agent_private.request_identity
  to bookingtours_agent_owner;

-- Preserve the existing checks, ownership and grants; replace only namespace lookups.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('agent_private.owner_allowed(uuid,uuid)'::regprocedure);
  if position('from auth.users u join public.admin_users a' in definition) > 0 then
    execute replace(definition,'from auth.users u join public.admin_users a',
      'from agent_private.auth_user_status u join public.admin_users a');
  elsif position('from agent_private.auth_user_status u join public.admin_users a' in definition) = 0 then
    raise exception 'Stopped: owner_allowed does not match the installed connector contract.';
  end if;
  definition := pg_get_functiondef('public.agent_read_observed_at(uuid,uuid,text)'::regprocedure);
  if position('auth.role()' in definition) > 0 and position('auth.uid()' in definition) > 0 then
    execute replace(replace(definition,'auth.role()',
      '(select user_role from agent_private.request_identity)'),
      'auth.uid()','(select user_id from agent_private.request_identity)');
  elsif position('agent_private.request_identity' in definition) = 0 then
    raise exception 'Stopped: the read observation function does not match the connector contract.';
  end if;
end $$;
commit;

select
  has_table_privilege('bookingtours_agent_owner','agent_private.auth_user_status','SELECT') as auth_status_view_ready,
  has_table_privilege('bookingtours_agent_owner','agent_private.request_identity','SELECT') as identity_view_ready,
  has_schema_privilege('bookingtours_agent_owner','auth','USAGE') as owner_has_auth_schema_access,
  has_any_column_privilege('bookingtours_agent_gateway','agent_private.auth_user_status','SELECT,INSERT,UPDATE') as gateway_can_access_auth_status,
  (select count(*) from agent_private.providers where enabled) as enabled_connectors;
