-- Missing platform schema for the disposable CI database. Definitions checked
-- against the pre-release schema snapshot on 2026-09-13; no customer records.
create table public.plans (
  id text primary key, name text not null, monthly_price_zar integer not null,
  setup_fee_zar integer not null default 0, seat_limit integer not null,
  monthly_paid_booking_limit integer, uncapped_flag boolean not null default false,
  active boolean not null default true, extra_seat_price_zar integer not null default 500,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check ((uncapped_flag and monthly_paid_booking_limit is null) or
    (not uncapped_flag and monthly_paid_booking_limit is not null))
);
insert into plans(id,name,monthly_price_zar,seat_limit,uncapped_flag)
  values ('standard','Standard fixture',2000,1,true);
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  plan_id text not null references plans(id),
  period_start date not null, period_end date,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint subscriptions_status_check check(status in ('ACTIVE','INACTIVE','CANCELLED'))
);
create table public.billing_line_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  source_type text not null, source_id uuid,
  kind text not null check(kind in ('ONE_OFF','RECURRING')),
  description text not null, amount_zar integer not null,
  currency text not null default 'ZAR',
  status text not null default 'PENDING' check(status in ('PENDING','PAID','ACTIVE','CANCELLED')),
  period_key date, metadata jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index billing_line_items_source_unique on billing_line_items(source_type,source_id,kind);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(), actor_id uuid references admin_users(id),
  business_id uuid, action_type text not null, target_entity text, target_id uuid,
  before_state jsonb, after_state jsonb, created_at timestamptz not null default now(),
  metadata jsonb, actor_role text, actor_email text, ip_address text, user_agent text, source text
);
create table public.policies (
  business_id uuid primary key references businesses(id) on delete cascade,
  free_cancel_hours_before integer not null default 48,
  partial_refund_hours_before integer not null default 24,
  partial_refund_percent integer not null default 50,
  no_refund_within_hours integer not null default 24,
  reschedule_allowed_hours_before integer not null default 24,
  created_at timestamptz not null default now(), group_discount_min_qty integer default 6,
  group_discount_percent integer default 5, loyalty_bookings_threshold integer default 2,
  loyalty_period_days integer default 30, loyalty_discount_percent integer default 10
);
create table public.outbox (
  id uuid primary key default gen_random_uuid(), business_id uuid references businesses(id),
  booking_id uuid references bookings(id) on delete cascade,
  scheduled_for timestamptz not null, sent_at timestamptz, attempts integer default 0,
  created_at timestamptz default now(), phone text not null, message_type text not null,
  message_body text not null, status text default 'PENDING', error text
);
create table public.wa_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  booking_id uuid references bookings(id) on delete set null,
  created_at timestamptz not null default now(), to_phone text not null,
  kind text not null default 'text', template_name text, body text,
  status text not null, provider_message_id text, error text
);
-- Supabase auth owns the real session schema; only this relation is consumed
-- by the suspension transaction under test, and contains disposable IDs only.
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null);
