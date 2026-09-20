begin;

alter table public.admin_users
  add column if not exists read_only boolean not null default false;

comment on column public.admin_users.read_only is
  'Blocks dashboard writes and service side effects for shared demonstration accounts.';

create or replace function public.block_read_only_admin_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
      and read_only
      and not coalesce(suspended, false)
  ) then
    raise exception 'This demonstration account is read-only'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

-- RLS policies share current_business_ids() for reads and writes. One trigger
-- on each tenant table preserves those readable policies while making every
-- direct PostgREST/RPC mutation fail closed for a read-only administrator.
do $$
declare
  table_row record;
begin
  for table_row in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  loop
    execute format(
      'drop trigger if exists block_read_only_admin_write on %I.%I',
      table_row.schema_name,
      table_row.table_name
    );
    execute format(
      'create trigger block_read_only_admin_write before insert or update or delete on %I.%I for each row execute function public.block_read_only_admin_write()',
      table_row.schema_name,
      table_row.table_name
    );
  end loop;
end
$$;

-- Dashboard uploads use Storage directly, outside the public schema.
drop trigger if exists block_read_only_admin_write on storage.objects;
create trigger block_read_only_admin_write
before insert or update or delete on storage.objects
for each row execute function public.block_read_only_admin_write();

commit;
