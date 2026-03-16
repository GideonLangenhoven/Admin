alter table public.admin_users
  add column if not exists name text,
  add column if not exists password_set_at timestamptz,
  add column if not exists must_set_password boolean not null default true,
  add column if not exists setup_token_hash text,
  add column if not exists setup_token_expires_at timestamptz,
  add column if not exists invite_sent_at timestamptz;

create index if not exists idx_admin_users_setup_token_hash
  on public.admin_users (setup_token_hash)
  where setup_token_hash is not null;

update public.admin_users
set must_set_password = false,
    password_set_at = coalesce(password_set_at, created_at)
where coalesce(password_hash, '') <> '';

alter table public.bookings
  add column if not exists created_by_admin_name text,
  add column if not exists created_by_admin_email text;
