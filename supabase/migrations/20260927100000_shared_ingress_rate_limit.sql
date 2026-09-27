-- Separate additive shared ingress limiter; apply only after the six-file package.
begin;

create table public.ingress_rate_limits (
  bucket text not null check (bucket in (
    'api-ip', 'auth-ip', 'auth-input', 'setup-token-ip', 'setup-token-input',
    'setup-send-ip', 'setup-send-input', 'booking-api'
  )),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{32}$'),
  started_at timestamptz not null,
  expires_at timestamptz not null,
  attempts integer not null check (attempts > 0),
  primary key (bucket, key_hash)
);
create index ingress_rate_limits_expiry_idx on public.ingress_rate_limits (expires_at);
alter table public.ingress_rate_limits enable row level security;
revoke all on public.ingress_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.ingress_rate_limits to service_role;

create function public.check_ingress_rate_limit(
  p_bucket text,
  p_key_hash text,
  p_limit integer,
  p_window_ms integer
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
set lock_timeout = '250ms'
set statement_timeout = '1200ms'
as $$
declare
  v_now timestamptz;
  v_expires timestamptz;
  v_attempts integer;
  v_retry_ms integer;
begin
  if p_bucket is null or p_key_hash is null or p_limit is null or p_window_ms is null
    or p_bucket not in (
    'api-ip', 'auth-ip', 'auth-input', 'setup-token-ip', 'setup-token-input',
    'setup-send-ip', 'setup-send-input', 'booking-api'
  ) or p_key_hash !~ '^[0-9a-f]{32}$'
    or p_limit not between 1 and 4000
    or p_window_ms not in (60000, 900000) then
    raise exception 'invalid ingress limit configuration' using errcode = '22023';
  end if;

  -- Lock the key before reading time; concurrent first requests and expiry
  -- rollover share one fixed window without a race at the boundary.
  perform pg_advisory_xact_lock(hashtextextended(p_bucket || ':' || p_key_hash, 0));
  v_now := clock_timestamp();
  insert into public.ingress_rate_limits as r
    (bucket, key_hash, started_at, expires_at, attempts)
  values (p_bucket, p_key_hash, v_now, v_now + p_window_ms * interval '1 millisecond', 1)
  on conflict (bucket, key_hash) do update set
    started_at = case when r.expires_at <= v_now then v_now else r.started_at end,
    expires_at = case when r.expires_at <= v_now then v_now + p_window_ms * interval '1 millisecond' else r.expires_at end,
    attempts = case when r.expires_at <= v_now then 1 else least(r.attempts + 1, p_limit + 1) end
  returning attempts, expires_at into v_attempts, v_expires;

  -- One bounded, indexed cleanup batch on a new window; no unbounded scan or
  -- probabilistic sweep on the request path.
  if v_attempts = 1 then
    with expired as (
      select bucket, key_hash from public.ingress_rate_limits
      where expires_at < v_now - interval '1 hour'
      order by expires_at limit 32 for update skip locked
    )
    delete from public.ingress_rate_limits r using expired e
      where r.bucket = e.bucket and r.key_hash = e.key_hash;
  end if;

  v_retry_ms := case when v_attempts > p_limit then
    greatest(1, least(p_window_ms, ceil(extract(epoch from v_expires - clock_timestamp()) * 1000)::integer))
    else 0 end;
  return jsonb_build_object(
    'allowed', v_attempts <= p_limit,
    'limit', p_limit,
    'remaining', greatest(0, p_limit - v_attempts),
    'retry_after_ms', v_retry_ms
  );
end $$;
revoke all on function public.check_ingress_rate_limit(text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.check_ingress_rate_limit(text,text,integer,integer) to service_role;

notify pgrst, 'reload schema';
commit;
