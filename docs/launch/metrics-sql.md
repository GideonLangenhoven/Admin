# Launch KPI Queries

## Current Period Usage by Business
```sql
select
  uc.business_id,
  uc.period_key,
  uc.paid_bookings_count,
  uc.topup_quota_count,
  s.plan_id
from usage_counters uc
left join subscriptions s
  on s.business_id = uc.business_id
 and s.status = 'ACTIVE'
where uc.period_key = date_trunc('month', now() at time zone 'Africa/Johannesburg')::date
order by uc.paid_bookings_count desc;
```

## Cap-Reached Businesses
```sql
with snap as (
  select
    b.id as business_id,
    x.*
  from businesses b
  cross join lateral ck_usage_snapshot(b.id) x
)
select
  business_id,
  plan_id,
  paid_bookings_count,
  total_quota,
  remaining
from snap
where uncapped_flag = false
  and coalesce(remaining, 0) <= 0;
```

## Top-up Revenue (Current Period)
```sql
select
  period_key,
  count(*) as orders,
  sum(amount_zar) as topup_revenue_zar,
  sum(extra_quota) as purchased_booking_quota
from topup_orders
where status = 'PAID'
  and period_key = date_trunc('month', now() at time zone 'Africa/Johannesburg')::date
group by period_key;
```

## Landing Page Add-on Revenue
```sql
select
  sum(build_total_zar) as build_revenue_zar,
  sum(case when hosting_active then hosting_fee_zar else 0 end) as monthly_hosting_mrr_zar
from landing_page_orders
where status in ('ACTIVE', 'PAID');
```

## Duplicate-Safe Top-up Check
```sql
select
  yoco_payment_id,
  count(*) as rows_per_payment
from topup_orders
where yoco_payment_id is not null
group by yoco_payment_id
having count(*) > 1;
```

## Hosting Cancellation Verification
```sql
select
  source_id as landing_page_order_id,
  status,
  amount_zar,
  updated_at
from billing_line_items
where source_type = 'LANDING_PAGE_ORDER'
  and kind = 'RECURRING'
order by updated_at desc
limit 50;
```
