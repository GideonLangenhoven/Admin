create or replace function public.ck_before_landing_page_orders_write()
returns trigger
language plpgsql
as $$
begin
  if new.base_page_count is null or new.base_page_count < 1 then
    new.base_page_count := 1;
  end if;

  if new.extra_page_count is null or new.extra_page_count < 0 then
    new.extra_page_count := 0;
  end if;

  if new.hosting_fee_zar is null or new.hosting_fee_zar < 0 then
    new.hosting_fee_zar := 500;
  end if;

  if new.build_total_zar is null or new.build_total_zar <= 0 then
    new.build_total_zar := 3500 + (new.extra_page_count * 1500);
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.ck_after_landing_page_order_write()
returns trigger
language plpgsql
as $$
begin
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
    'LANDING_PAGE_ORDER',
    new.id,
    'ONE_OFF',
    'Landing page build (' || (new.base_page_count + new.extra_page_count) || ' page(s))',
    new.build_total_zar,
    case when new.status in ('PAID', 'ACTIVE') then 'PAID' else 'PENDING' end,
    public.ck_current_period_key(),
    jsonb_build_object('base_page_count', new.base_page_count, 'extra_page_count', new.extra_page_count)
  where not exists (
    select 1
    from public.billing_line_items li
    where li.source_type = 'LANDING_PAGE_ORDER'
      and li.source_id = new.id
      and li.kind = 'ONE_OFF'
  );

  if new.hosting_active then
    update public.billing_line_items
    set
      amount_zar = new.hosting_fee_zar,
      status = 'ACTIVE',
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('hosting_active', true)
    where source_type = 'LANDING_PAGE_ORDER'
      and source_id = new.id
      and kind = 'RECURRING';

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
      'LANDING_PAGE_ORDER',
      new.id,
      'RECURRING',
      'Landing page hosting (monthly)',
      new.hosting_fee_zar,
      'ACTIVE',
      public.ck_current_period_key(),
      jsonb_build_object('hosting_active', true)
    where not exists (
      select 1
      from public.billing_line_items li
      where li.source_type = 'LANDING_PAGE_ORDER'
        and li.source_id = new.id
        and li.kind = 'RECURRING'
    );
  else
    update public.billing_line_items
    set
      status = 'CANCELLED',
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('hosting_active', false)
    where source_type = 'LANDING_PAGE_ORDER'
      and source_id = new.id
      and kind = 'RECURRING'
      and status <> 'CANCELLED';
  end if;

  return null;
end;
$$;

drop trigger if exists ck_landing_page_orders_before_write on public.landing_page_orders;
create trigger ck_landing_page_orders_before_write
before insert or update on public.landing_page_orders
for each row
execute function public.ck_before_landing_page_orders_write();

drop trigger if exists ck_landing_page_orders_after_write on public.landing_page_orders;
create trigger ck_landing_page_orders_after_write
after insert or update of hosting_active, hosting_fee_zar, status, build_total_zar, extra_page_count, base_page_count
on public.landing_page_orders
for each row
execute function public.ck_after_landing_page_order_write();
