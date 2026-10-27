-- Read-only diagnostic for project gwwnkihblioayklptdab.
-- Lists the exact permissions that triggered REVIEW_REQUIRED.
-- No customer rows, function bodies, passwords, keys or tokens are returned.
with findings as (
  select 'TABLE_ACCESS' as finding,
    format('%I.%I', n.nspname, t.relname) as object_name,
    pg_get_userbyid(t.relowner) as owner_role,
    has_schema_privilege('bookingtours_agent_gateway', n.oid, 'USAGE') as schema_usage
  from pg_class t
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname in ('public','auth','storage','agent_private')
    and t.relkind in ('r','p','v','m','f')
    and (has_any_column_privilege('bookingtours_agent_gateway',t.oid,'SELECT,INSERT,UPDATE')
      or has_table_privilege('bookingtours_agent_gateway',t.oid,'DELETE,TRUNCATE'))
  union all
  select 'FUNCTION_ACCESS',
    format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
    pg_get_userbyid(p.proowner),
    has_schema_privilege('bookingtours_agent_gateway', n.oid, 'USAGE')
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef
    and n.nspname not in ('pg_catalog','information_schema')
    and has_function_privilege('bookingtours_agent_gateway',p.oid,'EXECUTE')
    and not (n.nspname = 'agent_private' and p.proname in ('store','read'))
)
select finding, object_name, owner_role, schema_usage,
  count(*) over () as total_matches
from findings
order by schema_usage desc, finding, object_name
limit 50;
