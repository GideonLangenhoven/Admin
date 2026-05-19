-- AN4: durable per-IP/per-endpoint rate-limit bucket. The booking-site
-- middleware enforces a coarse 100/min/IP across all /api/* routes using
-- an Upstash fallback, but Upstash is not provisioned on the booking
-- Vercel project, so the fallback is per-instance in-memory only. This
-- table + RPC give the sensitive endpoints (POPIA submit, review submit)
-- a true global rate-limit that survives Fluid Compute scale-out.

create table if not exists public.api_rate_limits (
  ip text not null,
  endpoint text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (ip, endpoint, window_start)
);

alter table public.api_rate_limits enable row level security;

revoke all on public.api_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.api_rate_limits to service_role;

create or replace function public.check_rate_limit(
  p_ip text,
  p_endpoint text,
  p_max integer
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  win timestamptz := date_trunc('minute', now());
  cur_count integer;
begin
  insert into public.api_rate_limits as r (ip, endpoint, window_start, count)
    values (p_ip, p_endpoint, win, 1)
    on conflict (ip, endpoint, window_start)
      do update set count = r.count + 1
    returning r.count into cur_count;

  if random() < 0.01 then
    delete from public.api_rate_limits where window_start < now() - interval '1 hour';
  end if;

  return cur_count <= p_max;
end $$;

revoke all on function public.check_rate_limit(text, text, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, text, integer) to service_role;
