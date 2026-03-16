# CapeKayak KPI Scorecard Playbook

## Purpose
Run a daily launch scorecard that combines ad platform data, sales outcomes, and in-product commercial metrics.

## Files
- Template CSV: `docs/launch/kpi-scorecard-template.csv`
- Product/billing SQL pack: `docs/launch/metrics-sql.md`

## Daily Scorecard Columns
- `date`
- `utm_source`
- `utm_campaign`
- `spend_zar`
- `clicks`
- `sessions`
- `demo_requests`
- `demos_booked`
- `demos_attended`
- `qualified_demos`
- `trials_started`
- `paid_new_customers`
- `new_mrr_zar`
- `setup_fee_revenue_zar`
- `topup_revenue_zar`
- `landing_build_revenue_zar`
- `landing_hosting_mrr_zar`
- `paid_bookings_count`
- `cpl_zar`
- `cac_zar`
- `demo_attendance_pct`
- `demo_to_paid_pct`
- `notes`

## Data Sources
- Ad platform exports:
  - Meta Ads Manager
  - Google Ads
  - LinkedIn Campaign Manager
- Sales source:
  - Demo calendar + CRM pipeline export
- Product/billing source:
  - Supabase SQL queries below

## SQL Mapping Queries

### 1) Daily paid booking events
```sql
select
  (pbe.created_at at time zone 'Africa/Johannesburg')::date as day,
  count(*) as paid_bookings_count
from paid_booking_events pbe
where (pbe.created_at at time zone 'Africa/Johannesburg')::date
  between :from_date and :to_date
group by 1
order by 1;
```

### 2) Daily top-up revenue and quota sold
```sql
select
  (coalesce(t.paid_at, t.created_at) at time zone 'Africa/Johannesburg')::date as day,
  count(*) as topup_orders_count,
  sum(t.amount_zar) as topup_revenue_zar,
  sum(t.extra_quota) as topup_extra_quota_sold
from topup_orders t
where t.status = 'PAID'
  and (coalesce(t.paid_at, t.created_at) at time zone 'Africa/Johannesburg')::date
    between :from_date and :to_date
group by 1
order by 1;
```

### 3) Daily landing page build revenue
```sql
select
  (l.created_at at time zone 'Africa/Johannesburg')::date as day,
  count(*) as landing_orders_count,
  sum(l.build_total_zar) as landing_build_revenue_zar
from landing_page_orders l
where l.status in ('ACTIVE', 'PAID')
  and (l.created_at at time zone 'Africa/Johannesburg')::date
    between :from_date and :to_date
group by 1
order by 1;
```

### 4) Active hosting MRR snapshot (run daily once)
```sql
select
  now() at time zone 'Africa/Johannesburg' as snapshot_time,
  count(*) as active_hosting_accounts,
  sum(l.hosting_fee_zar) as landing_hosting_mrr_zar
from landing_page_orders l
where l.hosting_active = true
  and l.status in ('ACTIVE', 'PAID');
```

### 5) Daily new active subscriptions by plan
```sql
select
  (s.created_at at time zone 'Africa/Johannesburg')::date as day,
  s.plan_id,
  count(*) as new_active_subscriptions
from subscriptions s
where s.status = 'ACTIVE'
  and (s.created_at at time zone 'Africa/Johannesburg')::date
    between :from_date and :to_date
group by 1, 2
order by 1, 2;
```

### 6) Daily setup fee payments (if marked paid)
```sql
select
  (bli.updated_at at time zone 'Africa/Johannesburg')::date as day,
  count(*) as setup_fee_payments,
  sum(bli.amount_zar) as setup_fee_revenue_zar
from billing_line_items bli
where bli.source_type = 'SETUP_FEE'
  and bli.kind = 'ONE_OFF'
  and bli.status = 'PAID'
  and (bli.updated_at at time zone 'Africa/Johannesburg')::date
    between :from_date and :to_date
group by 1
order by 1;
```

## Scorecard Formulas
- `cpl_zar = spend_zar / nullif(qualified_demos, 0)`
- `cac_zar = spend_zar / nullif(paid_new_customers, 0)`
- `demo_attendance_pct = demos_attended / nullif(demos_booked, 0)`
- `demo_to_paid_pct = paid_new_customers / nullif(demos_attended, 0)`

## Operating Cadence
- 08:30 daily: update prior-day scorecard.
- 08:45 daily: review spend, CPL, CAC, and demo pipeline quality.
- 17:00 daily: note actions in `notes` (paused ads, new creatives, follow-up gaps).

## Decision Rules
- Increase budget only if:
  - `demo_attendance_pct >= 70%`
  - `demo_to_paid_pct` trend is stable or improving over 5+ days
  - response SLA <24h is maintained
- Reduce or pause campaigns if:
  - qualified demos decline for 3 straight days
  - paid_new_customers = 0 while spend is rising for 5 straight days

