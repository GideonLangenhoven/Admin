alter table public.businesses
  add column if not exists yoco_webhook_secret_encrypted bytea;

drop function if exists public.set_business_credentials(uuid, text, text, text);

create or replace function public.set_business_credentials(
  p_business_id uuid,
  p_wa_token text,
  p_wa_phone_id text,
  p_yoco_secret_key text,
  p_yoco_webhook_secret text default null
)
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_catalog, extensions
as $$
begin
  update public.businesses
  set
    wa_token_encrypted = app_private.encrypt_secret(p_wa_token),
    wa_phone_id_encrypted = app_private.encrypt_secret(p_wa_phone_id),
    yoco_secret_key_encrypted = app_private.encrypt_secret(p_yoco_secret_key),
    yoco_webhook_secret_encrypted = app_private.encrypt_secret(p_yoco_webhook_secret)
  where id = p_business_id;

  if not found then
    raise exception 'Business not found: %', p_business_id;
  end if;
end;
$$;

create or replace function public.get_business_credentials(p_business_id uuid)
returns table (
  wa_token text,
  wa_phone_id text,
  yoco_secret_key text,
  yoco_webhook_secret text
)
language sql
security definer
set search_path = public, app_private, pg_catalog, extensions
as $$
  select
    app_private.decrypt_secret(b.wa_token_encrypted) as wa_token,
    app_private.decrypt_secret(b.wa_phone_id_encrypted) as wa_phone_id,
    app_private.decrypt_secret(b.yoco_secret_key_encrypted) as yoco_secret_key,
    app_private.decrypt_secret(b.yoco_webhook_secret_encrypted) as yoco_webhook_secret
  from public.businesses b
  where b.id = p_business_id
$$;

revoke all on function public.set_business_credentials(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.get_business_credentials(uuid) from public, anon, authenticated;

grant execute on function public.set_business_credentials(uuid, text, text, text, text) to service_role;
grant execute on function public.get_business_credentials(uuid) to service_role;

with ranked_plans as (
  select
    id,
    row_number() over (order by monthly_price_zar asc, id asc) as plan_rank
  from public.plans
  where active = true
)
update public.plans p
set
  seat_limit = case ranked_plans.plan_rank
    when 1 then 1
    when 2 then 2
    else 3
  end,
  monthly_paid_booking_limit = null,
  uncapped_flag = true
from ranked_plans
where p.id = ranked_plans.id;
