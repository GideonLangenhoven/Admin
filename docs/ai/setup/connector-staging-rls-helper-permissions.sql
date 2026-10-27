-- Targeted correction for the reported finding in test project gwwnkihblioayklptdab.
-- Leaves the RLS event trigger and its function body unchanged.
begin;
do $$
begin
  if obj_description(to_regnamespace('agent_private'), 'pg_namespace') is distinct from
    'Synthetic connector staging only: Supabase project gwwnkihblioayklptdab. External providers disabled.' then
    raise exception 'Stopped: this is not the identified connector test database.';
  end if;
  if not exists (
    select 1 from pg_proc
    where oid = to_regprocedure('public.rls_auto_enable()')
      and prorettype = 'pg_catalog.event_trigger'::regtype
      and prosecdef and pg_get_userbyid(proowner) = 'postgres'
  ) then
    raise exception 'Stopped: the RLS helper does not match the reported event-trigger function.';
  end if;
end $$;

-- PUBLIC covers every database role, even a role marked NOINHERIT.
-- The event-trigger callback continues to run; the connector cannot call it.
revoke execute on function public.rls_auto_enable()
  from public, bookingtours_agent_gateway;
commit;

select
  has_function_privilege('bookingtours_agent_gateway','public.rls_auto_enable()','EXECUTE') as gateway_can_execute_rls_helper,
  exists (
    select 1 from pg_event_trigger
    where evtfoid = to_regprocedure('public.rls_auto_enable()') and evtenabled in ('O','A')
  ) as rls_trigger_enabled,
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
