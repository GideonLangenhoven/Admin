-- R04/R07/R10. The storefront already pins its resolver to the anon role;
-- an authenticated public policy must not expose its broader column grants.
begin;

alter policy businesses_anon_select on public.businesses to anon;
alter policy reviews_anon_read on public.reviews to anon;
revoke select on public.reviews from anon;
grant select (id, business_id, tour_id, source, status, rating, comment,
  reviewer_name, reviewer_avatar_url, submitted_at, created_at)
  on public.reviews to anon;

create or replace function public.current_business_ids()
returns uuid[] language sql stable security definer
set search_path = public, pg_temp as $$
  with me as (
    select business_id, role from public.admin_users
    where user_id = auth.uid() and not coalesce(suspended, false)
  )
  select case when exists (select 1 from me where role = 'SUPER_ADMIN')
    then coalesce((select array_agg(id) from public.businesses), '{}'::uuid[])
    else coalesce((select array_agg(distinct business_id) from me
                   where business_id is not null), '{}'::uuid[])
  end
$$;

alter policy businesses_super_admin_all on public.businesses
  using (exists (select 1 from public.admin_users a
    where a.user_id = (select auth.uid()) and a.role = 'SUPER_ADMIN'
      and not coalesce(a.suspended, false)))
  with check (exists (select 1 from public.admin_users a
    where a.user_id = (select auth.uid()) and a.role = 'SUPER_ADMIN'
      and not coalesce(a.suspended, false)));

create or replace function public.protect_platform_business_fields()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  field_name text;
begin
  if auth.role() = 'service_role' or exists (
    select 1 from public.admin_users a where a.user_id = auth.uid()
      and a.role = 'SUPER_ADMIN' and not coalesce(a.suspended, false)
  ) then return new; end if;
  -- Unknown future platform fields can be added here without changing the
  -- operator-editable settings surface. JSON comparison also covers nulls.
  foreach field_name in array array[
    'subscription_status', 'suspension_reason', 'plan_id', 'max_admin_seats',
    'marketing_included_emails', 'marketing_overage_rate_zar',
    'ai_included_replies', 'ai_overage_rate_zar', 'monthly_price_zar',
    'extra_seat_price_zar', 'trial_ends_at'
  ] loop
    if to_jsonb(new) -> field_name is distinct from to_jsonb(old) -> field_name then
      raise exception 'Platform-managed business field: %', field_name using errcode = '42501';
    end if;
  end loop;
  return new;
end
$$;
create trigger protect_platform_business_fields before update on public.businesses
for each row execute function public.protect_platform_business_fields();

-- All callers of these bookkeeping/profile helpers are service-role workers.
-- Revoking both PUBLIC and explicit client grants closes inherited EXECUTE.
revoke execute on function public.upsert_customer(uuid, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.upsert_customer(uuid, text, text, text, boolean) to service_role;
revoke execute on function public.increment_marketing_monthly_usage(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.increment_marketing_monthly_usage(uuid, text, integer) to service_role;

commit;
