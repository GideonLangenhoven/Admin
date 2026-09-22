begin;

-- The snapshot already proves the requested tenant with current_business_ids().
-- Run its internal reads as the function owner so the same RLS helper is not
-- re-evaluated across every joined table under load.
alter function public.get_operator_dashboard(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz
) security definer;

-- Keep the browser-facing arrival boundary at one database admission. The
-- caller identity, tenant, read-only flag and subscription are checked here;
-- the existing locked/idempotent mutation remains the only write primitive.
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

notify pgrst, 'reload schema';
commit;
