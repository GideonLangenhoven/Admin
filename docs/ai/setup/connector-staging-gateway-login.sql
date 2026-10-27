-- RESTRICTED TEST LOGIN: project gwwnkihblioayklptdab only.
-- Replace the password placeholder privately; never commit a filled-in copy.
rollback;
begin;
set local password_encryption = 'scram-sha-256';

do $$
declare
  new_password text := 'REPLACE_WITH_A_NEW_RANDOM_PASSWORD';
  gateway record;
begin
  if obj_description(to_regnamespace('agent_private'), 'pg_namespace') is distinct from
    'Synthetic connector staging only: Supabase project gwwnkihblioayklptdab. External providers disabled.' then
    raise exception 'Stopped: this is not the identified connector test database.';
  end if;

  -- Alphanumeric passwords can be pasted into this connection URI unchanged.
  if new_password !~ '^[A-Za-z0-9]{32,128}$' then
    raise exception 'Replace the placeholder with a new random password: 32 to 128 letters and numbers.';
  end if;

  select * into gateway from pg_roles
  where rolname = 'bookingtours_agent_gateway';
  if not found or gateway.rolsuper or gateway.rolbypassrls or gateway.rolinherit
    or gateway.rolcreatedb or gateway.rolcreaterole or gateway.rolreplication
    or pg_has_role('bookingtours_agent_gateway','authenticated','MEMBER')
    or pg_has_role('bookingtours_agent_gateway','service_role','MEMBER')
    or pg_has_role('bookingtours_agent_gateway','bookingtours_agent_owner','MEMBER') then
    raise exception 'Stopped: the gateway role is missing or has elevated permissions.';
  end if;

  if exists (
    select 1 from pg_class t join pg_namespace n on n.oid=t.relnamespace
    where n.nspname in ('public','auth','storage','agent_private')
      and t.relkind in ('r','p','v','m','f')
      and (has_any_column_privilege('bookingtours_agent_gateway',t.oid,'SELECT,INSERT,UPDATE')
        or has_table_privilege('bookingtours_agent_gateway',t.oid,'DELETE,TRUNCATE'))
  ) or exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where p.prosecdef and n.nspname not in ('pg_catalog','information_schema')
      and has_function_privilege('bookingtours_agent_gateway',p.oid,'EXECUTE')
      and not (n.nspname='agent_private' and p.proname in ('store','read'))
  ) then
    raise exception 'Stopped: connector permissions need review. No login was changed.';
  end if;

  if not has_schema_privilege('bookingtours_agent_gateway','agent_private','USAGE')
    or not has_function_privilege('bookingtours_agent_gateway','agent_private.store(text,jsonb)','EXECUTE')
    or not has_function_privilege('bookingtours_agent_gateway','agent_private.read(text,text,text,text,jsonb)','EXECUTE') then
    raise exception 'Stopped: the restricted connector functions are unavailable.';
  end if;

  if exists (select 1 from agent_private.providers where enabled) then
    raise exception 'Stopped: this setup step requires both providers to remain disabled.';
  end if;

  begin
    execute format('alter role bookingtours_agent_gateway login password %L', new_password);
  exception when others then
    -- A raw ALTER ROLE error could include the password in its query context.
    raise exception 'Could not set the restricted gateway password. Return only this error and its code.'
      using errcode = sqlstate;
  end;
end $$;

commit;

select
  rolcanlogin as gateway_login_enabled,
  (select count(*) from agent_private.providers where enabled) as enabled_connectors
from pg_roles
where rolname = 'bookingtours_agent_gateway';
