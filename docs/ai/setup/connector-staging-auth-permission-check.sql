-- Read-only diagnosis of the reported auth-schema denial. No user data or credentials.
rollback;
select
  current_user as sql_role,
  pg_get_userbyid(n.nspowner) as auth_schema_owner,
  has_schema_privilege(current_user,n.oid,'USAGE WITH GRANT OPTION') as admin_can_grant_auth_usage,
  has_schema_privilege('bookingtours_agent_owner',n.oid,'USAGE') as owner_can_use_auth_schema,
  has_column_privilege('bookingtours_agent_owner',t.oid,'id','SELECT') as owner_can_read_user_id,
  has_column_privilege('bookingtours_agent_owner',t.oid,'deleted_at','SELECT') as owner_can_read_deleted_status,
  has_column_privilege('bookingtours_agent_owner',t.oid,'banned_until','SELECT') as owner_can_read_banned_status,
  has_column_privilege(current_user,t.oid,'id','SELECT WITH GRANT OPTION') as admin_can_grant_user_id_read
from pg_namespace n join pg_class t on t.relnamespace=n.oid
where n.nspname='auth' and t.relname='users';
