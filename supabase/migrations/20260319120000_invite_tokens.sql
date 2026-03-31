-- Single-use invite tokens replace the static ONBOARDING_INVITE_CODE.
-- Each token is a UUID, valid for 48 hours, and can only be used once.

create table if not exists public.invite_tokens (
  id uuid primary key default gen_random_uuid(),
  token uuid not null default gen_random_uuid() unique,
  created_by uuid references public.admin_users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '48 hours'),
  used_at timestamptz,
  used_by_email text,
  used_by_business_id uuid references public.businesses(id)
);

-- Index for fast token lookups during onboarding validation
create index if not exists idx_invite_tokens_token on public.invite_tokens(token);

-- Index for listing active/unused tokens in the admin UI
create index if not exists idx_invite_tokens_unused
  on public.invite_tokens(created_at desc)
  where used_at is null;

-- RLS
alter table public.invite_tokens enable row level security;

-- Only service role can access invite tokens (Edge Functions use service role key)
-- No public RLS policies needed since all access goes through Edge Functions.
