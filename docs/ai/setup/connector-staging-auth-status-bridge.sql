-- Project-guarded Auth status bridge for gwwnkihblioayklptdab.
-- The managed Auth table retains RLS; only the current identity's three status fields are projected.
rollback;
begin;
do $$
begin
  if current_user <> 'postgres' or obj_description(to_regnamespace('agent_private'),'pg_namespace') is distinct from
    'Synthetic connector staging only: Supabase project gwwnkihblioayklptdab. External providers disabled.' then
    raise exception 'Stopped: run this in the identified test project as postgres.';
  end if;
end $$;

-- postgres already has managed Auth access. This private, security-barrier view
-- applies a current-identity filter and exposes no email, password or token fields.
create or replace view agent_private.auth_user_status
with (security_invoker = false, security_barrier = true) as
  select id, deleted_at, banned_until from auth.users where id = auth.uid();
revoke all on agent_private.auth_user_status
  from public, anon, authenticated, service_role, bookingtours_agent_gateway;
grant select on agent_private.auth_user_status to bookingtours_agent_owner;
commit;

select
  (select relrowsecurity from pg_class where oid='auth.users'::regclass) as auth_rls_still_enabled,
  not has_any_column_privilege('bookingtours_agent_gateway','agent_private.auth_user_status','SELECT,INSERT,UPDATE') as gateway_direct_access_blocked,
  not has_table_privilege('bookingtours_agent_owner','agent_private.auth_user_status','INSERT,UPDATE,DELETE') as status_writes_blocked,
  (select count(*) from agent_private.providers where enabled) as enabled_connectors;
