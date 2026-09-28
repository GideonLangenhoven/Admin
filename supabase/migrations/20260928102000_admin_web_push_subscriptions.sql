-- Phone/browser push endpoints are device credentials. Only service-role API
-- routes may read or write them; admins manage their own endpoint through the
-- authenticated application route.
create table if not exists public.admin_web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  admin_user_id uuid not null references public.admin_users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists admin_web_push_subscriptions_business_idx
  on public.admin_web_push_subscriptions (business_id);

alter table public.admin_web_push_subscriptions enable row level security;
revoke all on public.admin_web_push_subscriptions from anon, authenticated;
