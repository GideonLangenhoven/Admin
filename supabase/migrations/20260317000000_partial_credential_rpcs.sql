-- Partial credential update RPCs
-- Allows updating WhatsApp or Yoco credentials independently
-- without accidentally clearing the other integration's secrets.
-- Both functions require set_app_settings_encryption_key() to have been
-- called first to prime the session encryption context (same pattern as
-- the existing set_business_credentials RPC).

-- ── WhatsApp only ──────────────────────────────────────────────────────────
create or replace function public.set_wa_credentials(
  p_business_id        uuid,
  p_wa_token           text,
  p_wa_phone_id        text
)
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_catalog, extensions
as $$
begin
  update public.businesses
  set
    wa_token_encrypted    = app_private.encrypt_secret(p_wa_token),
    wa_phone_id_encrypted = app_private.encrypt_secret(p_wa_phone_id)
  where id = p_business_id;

  if not found then
    raise exception 'Business not found: %', p_business_id;
  end if;
end;
$$;

grant execute on function public.set_wa_credentials(uuid, text, text) to service_role;
revoke execute on function public.set_wa_credentials(uuid, text, text) from anon, authenticated;

-- ── Yoco only ──────────────────────────────────────────────────────────────
create or replace function public.set_yoco_credentials(
  p_business_id           uuid,
  p_yoco_secret_key       text,
  p_yoco_webhook_secret   text
)
returns void
language plpgsql
security definer
set search_path = public, app_private, pg_catalog, extensions
as $$
begin
  update public.businesses
  set
    yoco_secret_key_encrypted       = app_private.encrypt_secret(p_yoco_secret_key),
    yoco_webhook_secret_encrypted   = app_private.encrypt_secret(p_yoco_webhook_secret)
  where id = p_business_id;

  if not found then
    raise exception 'Business not found: %', p_business_id;
  end if;
end;
$$;

grant execute on function public.set_yoco_credentials(uuid, text, text) to service_role;
revoke execute on function public.set_yoco_credentials(uuid, text, text) from anon, authenticated;
