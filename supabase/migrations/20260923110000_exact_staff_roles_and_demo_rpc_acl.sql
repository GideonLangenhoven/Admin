begin;

-- Tenant RLS and the optimized dashboard/booking RPCs all use this helper.
-- Keep read-only staff visible for browsing; the write trigger enforces demo
-- restrictions separately. Unknown roles have no tenant authority.
create or replace function public.current_business_ids()
returns uuid[] language sql stable security definer
set search_path = public, pg_temp as $$
  with me as (
    select business_id, role from public.admin_users
    where user_id = auth.uid() and not coalesce(suspended, false)
      and role in ('OPERATOR', 'ADMIN', 'MAIN_ADMIN', 'SUPER_ADMIN')
  )
  select case when exists (select 1 from me where role = 'SUPER_ADMIN')
    then coalesce((select array_agg(id) from public.businesses), '{}'::uuid[])
    else coalesce((select array_agg(distinct business_id) from me
                   where business_id is not null), '{}'::uuid[])
  end
$$;

alter policy platform_public_settings_super_admin_all on public.platform_public_settings
  using (exists (select 1 from public.admin_users a
    where a.user_id = (select auth.uid()) and a.role = 'SUPER_ADMIN'
      and not coalesce(a.suspended, false) and not coalesce(a.read_only, false)))
  with check (exists (select 1 from public.admin_users a
    where a.user_id = (select auth.uid()) and a.role = 'SUPER_ADMIN'
      and not coalesce(a.suspended, false) and not coalesce(a.read_only, false)));

-- Preserve the locked arrival primitive and its established tenant,
-- subscription, read-only and support admission while denying unknown roles.
create or replace function public.record_authenticated_booking_arrival(
  p_booking_id uuid,
  p_business_id uuid,
  p_arrived_count integer,
  p_expected_arrived_count integer,
  p_client_event_id text,
  p_source text,
  p_notes text,
  p_slot_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid;
  caller_role text;
  subscription_status text;
begin
  select a.id, a.role, b.subscription_status
  into caller_id, caller_role, subscription_status
  from public.admin_users a
  join public.businesses b on b.id = p_business_id
  where a.user_id = auth.uid()
    and a.role in ('OPERATOR', 'ADMIN', 'MAIN_ADMIN', 'SUPER_ADMIN')
    and not coalesce(a.suspended, false)
    and not coalesce(a.read_only, false)
    and (a.business_id = p_business_id or a.role = 'SUPER_ADMIN')
  order by (a.business_id = p_business_id) desc, a.created_at, a.id
  limit 1;

  if caller_id is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'error', 'Unauthorized');
  end if;

  if caller_role <> 'SUPER_ADMIN'
      and upper(coalesce(subscription_status, '')) not in ('ACTIVE', 'TRIAL', 'PAST_DUE') then
    return jsonb_build_object(
      'ok', false,
      'code', 'SUBSCRIPTION_REQUIRED',
      'error', 'An active subscription is required'
    );
  end if;

  return public.record_booking_arrival(
    p_booking_id,
    p_business_id,
    caller_id,
    p_arrived_count,
    p_expected_arrived_count,
    p_client_event_id,
    p_source,
    p_notes,
    p_slot_id
  );
end
$$;

revoke all on function public.record_authenticated_booking_arrival(
  uuid, uuid, integer, integer, text, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.record_authenticated_booking_arrival(
  uuid, uuid, integer, integer, text, text, text, uuid
) to authenticated;

-- Earlier migrations revoked PUBLIC but left explicit client EXECUTE grants.
revoke execute on function public.refresh_claires_hiking_demo_dates(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.refresh_claires_hiking_demo_dates(uuid, timestamptz)
  to service_role;

notify pgrst, 'reload schema';
commit;
