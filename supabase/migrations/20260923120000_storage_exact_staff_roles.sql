begin;

-- Storage uploads use these helpers independently of current_business_ids().
-- Keep the approved tenant and platform upload policy, but admit only persisted
-- staff roles. Qualify the table and put pg_temp last so caller-owned temporary
-- relations cannot replace the authority source inside SECURITY DEFINER code.
create or replace function public.storage_admin_business_ids()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select business_id::text from public.admin_users
  where user_id = auth.uid()
    and role in ('OPERATOR', 'ADMIN', 'MAIN_ADMIN', 'SUPER_ADMIN')
    and not coalesce(suspended, false);
$$;

create or replace function public.storage_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = auth.uid()
      and role = 'SUPER_ADMIN'
      and not coalesce(suspended, false)
  );
$$;

notify pgrst, 'reload schema';
commit;
