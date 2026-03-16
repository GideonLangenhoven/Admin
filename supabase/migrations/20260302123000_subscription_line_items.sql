create or replace function public.ck_after_subscription_write()
returns trigger
language plpgsql
as $$
declare
  v_plan record;
begin
  if new.status <> 'ACTIVE' then
    return null;
  end if;

  select id, name, monthly_price_zar, setup_fee_zar
  into v_plan
  from public.plans
  where id = new.plan_id;

  if v_plan.id is null then
    return null;
  end if;

  insert into public.billing_line_items (
    business_id,
    source_type,
    source_id,
    kind,
    description,
    amount_zar,
    status,
    period_key,
    metadata
  )
  select
    new.business_id,
    'SUBSCRIPTION',
    new.id,
    'RECURRING',
    v_plan.name || ' plan subscription',
    v_plan.monthly_price_zar,
    'ACTIVE',
    coalesce(new.period_start, public.ck_current_period_key()),
    jsonb_build_object('plan_id', v_plan.id)
  where not exists (
    select 1
    from public.billing_line_items li
    where li.source_type = 'SUBSCRIPTION'
      and li.source_id = new.id
      and li.kind = 'RECURRING'
  );

  insert into public.billing_line_items (
    business_id,
    source_type,
    source_id,
    kind,
    description,
    amount_zar,
    status,
    period_key,
    metadata
  )
  select
    new.business_id,
    'SETUP_FEE',
    null,
    'ONE_OFF',
    'Platform setup fee',
    v_plan.setup_fee_zar,
    'PENDING',
    coalesce(new.period_start, public.ck_current_period_key()),
    jsonb_build_object('plan_id', v_plan.id)
  where not exists (
    select 1
    from public.billing_line_items li
    where li.business_id = new.business_id
      and li.source_type = 'SETUP_FEE'
      and li.kind = 'ONE_OFF'
  );

  return null;
end;
$$;

drop trigger if exists ck_subscriptions_after_write on public.subscriptions;
create trigger ck_subscriptions_after_write
after insert on public.subscriptions
for each row
execute function public.ck_after_subscription_write();

insert into public.billing_line_items (
  business_id,
  source_type,
  source_id,
  kind,
  description,
  amount_zar,
  status,
  period_key,
  metadata
)
select
  s.business_id,
  'SUBSCRIPTION',
  s.id,
  'RECURRING',
  p.name || ' plan subscription',
  p.monthly_price_zar,
  case when s.status = 'ACTIVE' then 'ACTIVE' else 'PENDING' end,
  coalesce(s.period_start, public.ck_current_period_key()),
  jsonb_build_object('plan_id', p.id)
from public.subscriptions s
join public.plans p on p.id = s.plan_id
where s.status = 'ACTIVE'
  and not exists (
    select 1
    from public.billing_line_items li
    where li.source_type = 'SUBSCRIPTION'
      and li.source_id = s.id
      and li.kind = 'RECURRING'
  );

insert into public.billing_line_items (
  business_id,
  source_type,
  source_id,
  kind,
  description,
  amount_zar,
  status,
  period_key,
  metadata
)
select
  s.business_id,
  'SETUP_FEE',
  null,
  'ONE_OFF',
  'Platform setup fee',
  3500,
  'PENDING',
  coalesce(min(s.period_start), public.ck_current_period_key()),
  '{}'::jsonb
from public.subscriptions s
group by s.business_id
having not exists (
  select 1
  from public.billing_line_items li
  where li.business_id = s.business_id
    and li.source_type = 'SETUP_FEE'
    and li.kind = 'ONE_OFF'
);
