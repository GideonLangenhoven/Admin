-- CONNECTION LIST FIX: test project gwwnkihblioayklptdab only.
rollback;
begin;
do $$
declare
  definition text;
  before_acl aclitem[];
  old_query text := $old$select id,provider,scopes,enabled,created_at,expires_at,disconnected_at
      from public.agent_connection_grants where user_id=(p->>'user_id')::uuid and business_id=(p->>'business_id')::uuid
      order by created_at desc,id limit 50$old$;
  new_query text := $new$select connection.id,connection.provider,connection.scopes,connection.enabled,connection.created_at,connection.expires_at,connection.disconnected_at
      from public.agent_connection_grants as connection where connection.user_id=(p->>'user_id')::uuid and connection.business_id=(p->>'business_id')::uuid
      order by connection.created_at desc,connection.id limit 50$new$;
begin
  if current_user <> 'postgres' or obj_description(to_regnamespace('agent_private'),'pg_namespace') is distinct from
    'Synthetic connector staging only: Supabase project gwwnkihblioayklptdab. External providers disabled.' then
    raise exception 'Stopped: this is not the identified test project.';
  end if;
  select pg_get_functiondef(p.oid), p.proacl into definition, before_acl
  from pg_proc p
  where p.oid=to_regprocedure('agent_private.store(text,jsonb)')
    and p.prosecdef and pg_get_userbyid(p.proowner)='bookingtours_agent_owner';
  if definition is null then
    raise exception 'Stopped: the restricted function does not match the expected owner.';
  end if;
  if position(old_query in definition)>0 then
    execute replace(definition,old_query,new_query);
  elsif position(new_query in definition)=0 then
    raise exception 'Stopped: the function query differs from the tested correction.';
  end if;
  if not exists (select 1 from pg_proc p
    where p.oid=to_regprocedure('agent_private.store(text,jsonb)') and p.prosecdef
      and pg_get_userbyid(p.proowner)='bookingtours_agent_owner'
      and p.proacl is not distinct from before_acl) then
    raise exception 'Stopped: function owner or permissions changed.';
  end if;
end $$;
commit;

select
  position('connection.scopes' in pg_get_functiondef(to_regprocedure('agent_private.store(text,jsonb)')))>0 as connection_list_fixed,
  pg_get_userbyid(p.proowner)='bookingtours_agent_owner' as function_owner_preserved,
  (select count(*) from agent_private.providers where enabled) as enabled_connectors
from pg_proc p
where p.oid=to_regprocedure('agent_private.store(text,jsonb)');
