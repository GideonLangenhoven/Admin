begin;

-- Replace the old signature so PostgREST cannot resolve an unscoped overload.
-- Default arguments keep existing service cron calls compatible.
drop function if exists public.claim_marketing_queue(integer, integer);
create or replace function public.claim_marketing_queue(
  p_limit integer default 50,
  p_max_retries integer default 3,
  p_business_id uuid default null
)
returns setof public.marketing_queue
language sql
security definer
set search_path = public, pg_temp
as $$
  with picked as (
    select q.id
    from public.marketing_queue q
    join public.businesses b on b.id = q.business_id
    join public.marketing_campaigns c on c.id = q.campaign_id and c.business_id = q.business_id
    join public.marketing_templates t on t.id = c.template_id and t.business_id = q.business_id
    join public.marketing_contacts k on k.id = q.contact_id and k.business_id = q.business_id
    where q.status = 'pending'
      and q.retry_count < p_max_retries
      and (q.next_retry_at is null or q.next_retry_at <= now())
      and (p_business_id is null or q.business_id = p_business_id)
      and upper(b.subscription_status) in ('ACTIVE', 'TRIAL', 'PAST_DUE')
      and c.status = 'sending'
    order by q.created_at, q.id
    limit greatest(1, least(coalesce(p_limit, 50), 500))
    for update of q skip locked
  )
  update public.marketing_queue q
  set status = 'processing', processing_started_at = now(), updated_at = now()
  from picked where q.id = picked.id
  returning q.*;
$$;
revoke all on function public.claim_marketing_queue(integer, integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_marketing_queue(integer, integer, uuid) to service_role;

-- A batch of paused tenants/automations must not consume every available
-- slot before an eligible operator's enrollment gets considered.
create or replace function public.claim_marketing_automation_enrollments(
  p_limit integer default 100,
  p_business_id uuid default null
)
returns setof public.marketing_automation_enrollments
language sql
security definer
set search_path = public, pg_temp
as $$
  with picked as (
    select e.id
    from public.marketing_automation_enrollments e
    join public.businesses b on b.id = e.business_id
    join public.marketing_automations a on a.id = e.automation_id and a.business_id = e.business_id
    join public.marketing_contacts k on k.id = e.contact_id and k.business_id = e.business_id
    where e.status = 'active' and e.next_action_at <= now()
      and (p_business_id is null or e.business_id = p_business_id)
      and upper(b.subscription_status) in ('ACTIVE', 'TRIAL', 'PAST_DUE')
      and a.status = 'active'
    order by e.next_action_at, e.id
    limit greatest(1, least(coalesce(p_limit, 100), 100))
    for update of e skip locked
  )
  update public.marketing_automation_enrollments e
  set next_action_at = now() + interval '15 minutes', updated_at = now()
  from picked where e.id = picked.id
  returning e.*;
$$;
revoke all on function public.claim_marketing_automation_enrollments(integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_marketing_automation_enrollments(integer, uuid) to service_role;

create index if not exists idx_marketing_queue_tenant_pending
  on public.marketing_queue(business_id, created_at, id) where status = 'pending';
create index if not exists idx_marketing_enrollments_tenant_due
  on public.marketing_automation_enrollments(business_id, next_action_at, id) where status = 'active';

notify pgrst, 'reload schema';
commit;
