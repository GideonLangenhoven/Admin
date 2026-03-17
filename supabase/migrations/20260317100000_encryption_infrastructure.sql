-- ============================================================
-- ENCRYPTION INFRASTRUCTURE
-- ============================================================
-- Fixes: "Could not find the function public.set_app_settings_encryption_key"
--
-- Root causes fixed here:
--   1. The app_private schema and its encrypt/decrypt helpers were never
--      created via a migration — they only lived in the team's heads.
--   2. The two-step pattern (set_app_settings_encryption_key RPC →
--      separate get/set_business_credentials RPC) is broken with
--      PostgREST transaction-mode connection pooling: the second call
--      can land on a different connection where the session GUC is gone.
--
-- Solution:
--   • Create the app_private schema and pgcrypto-backed helpers that
--     accept the encryption key as an explicit parameter (no GUC needed).
--   • Keep set_app_settings_encryption_key as a no-op stub so existing
--     callers don't crash while they're being updated.
--   • Recreate all credential RPCs with the key as an explicit parameter.
-- ============================================================

-- 1. pgcrypto — Supabase puts extensions in the "extensions" schema
create extension if not exists pgcrypto with schema extensions;

-- 2. app_private schema
create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to service_role;

-- 3. No-op stub — keeps old two-step callers from throwing
--    "function not found" while they are being updated.
create or replace function public.set_app_settings_encryption_key(p_value text)
returns void
language sql
security definer
set search_path = public, app_private, extensions
as $$ select null::void; $$;

revoke all on function public.set_app_settings_encryption_key(text) from public, anon, authenticated;
grant  execute on function public.set_app_settings_encryption_key(text) to service_role;

-- 4. Internal helpers — key is passed as an explicit parameter.
--    NULL/empty plaintext  → NULL ciphertext  (represents "not configured")
--    NULL ciphertext       → NULL plaintext

create or replace function app_private.encrypt_secret(p_value text, p_key text)
returns bytea
language plpgsql
security definer
set search_path = public, app_private, extensions
as $$
begin
  if p_value is null or p_value = '' then
    return null;
  end if;
  return extensions.pgp_sym_encrypt(p_value, p_key);
end;
$$;

create or replace function app_private.decrypt_secret(p_encrypted bytea, p_key text)
returns text
language plpgsql
security definer
set search_path = public, app_private, extensions
as $$
begin
  if p_encrypted is null then
    return null;
  end if;
  return extensions.pgp_sym_decrypt(p_encrypted, p_key);
end;
$$;

revoke all on function app_private.encrypt_secret(text, text)   from public, anon, authenticated;
revoke all on function app_private.decrypt_secret(bytea, text)  from public, anon, authenticated;
grant  execute on function app_private.encrypt_secret(text, text)   to service_role;
grant  execute on function app_private.decrypt_secret(bytea, text)  to service_role;

-- 5. Drop old credential RPCs (old signatures had no p_key param)
drop function if exists public.get_business_credentials(uuid);
drop function if exists public.set_business_credentials(uuid, text, text, text);
drop function if exists public.set_business_credentials(uuid, text, text, text, text);
drop function if exists public.set_wa_credentials(uuid, text, text);
drop function if exists public.set_yoco_credentials(uuid, text, text);

-- 6. get_business_credentials — single call, key as explicit param
create function public.get_business_credentials(p_business_id uuid, p_key text)
returns table (
  wa_token          text,
  wa_phone_id       text,
  yoco_secret_key   text,
  yoco_webhook_secret text
)
language sql
security definer
set search_path = public, app_private, extensions
as $$
  select
    app_private.decrypt_secret(b.wa_token_encrypted,            p_key),
    app_private.decrypt_secret(b.wa_phone_id_encrypted,         p_key),
    app_private.decrypt_secret(b.yoco_secret_key_encrypted,     p_key),
    app_private.decrypt_secret(b.yoco_webhook_secret_encrypted, p_key)
  from public.businesses b
  where b.id = p_business_id;
$$;

-- 7. set_business_credentials — key as 2nd param (used by onboarding)
create function public.set_business_credentials(
  p_business_id         uuid,
  p_key                 text,
  p_wa_token            text,
  p_wa_phone_id         text,
  p_yoco_secret_key     text,
  p_yoco_webhook_secret text default null
)
returns void
language plpgsql
security definer
set search_path = public, app_private, extensions
as $$
begin
  update public.businesses
  set
    wa_token_encrypted            = app_private.encrypt_secret(p_wa_token,            p_key),
    wa_phone_id_encrypted         = app_private.encrypt_secret(p_wa_phone_id,         p_key),
    yoco_secret_key_encrypted     = app_private.encrypt_secret(p_yoco_secret_key,     p_key),
    yoco_webhook_secret_encrypted = app_private.encrypt_secret(p_yoco_webhook_secret, p_key)
  where id = p_business_id;

  if not found then
    raise exception 'Business not found: %', p_business_id;
  end if;
end;
$$;

-- 8. Partial update — WhatsApp only (key as 2nd param)
create function public.set_wa_credentials(
  p_business_id  uuid,
  p_key          text,
  p_wa_token     text,
  p_wa_phone_id  text
)
returns void
language plpgsql
security definer
set search_path = public, app_private, extensions
as $$
begin
  update public.businesses
  set
    wa_token_encrypted    = app_private.encrypt_secret(p_wa_token,    p_key),
    wa_phone_id_encrypted = app_private.encrypt_secret(p_wa_phone_id, p_key)
  where id = p_business_id;

  if not found then
    raise exception 'Business not found: %', p_business_id;
  end if;
end;
$$;

-- 9. Partial update — Yoco only (key as 2nd param)
create function public.set_yoco_credentials(
  p_business_id         uuid,
  p_key                 text,
  p_yoco_secret_key     text,
  p_yoco_webhook_secret text
)
returns void
language plpgsql
security definer
set search_path = public, app_private, extensions
as $$
begin
  update public.businesses
  set
    yoco_secret_key_encrypted     = app_private.encrypt_secret(p_yoco_secret_key,     p_key),
    yoco_webhook_secret_encrypted = app_private.encrypt_secret(p_yoco_webhook_secret, p_key)
  where id = p_business_id;

  if not found then
    raise exception 'Business not found: %', p_business_id;
  end if;
end;
$$;

-- 10. Grants
revoke all on function public.get_business_credentials(uuid, text)             from public, anon, authenticated;
revoke all on function public.set_business_credentials(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.set_wa_credentials(uuid, text, text, text)       from public, anon, authenticated;
revoke all on function public.set_yoco_credentials(uuid, text, text, text)     from public, anon, authenticated;

grant execute on function public.get_business_credentials(uuid, text)             to service_role;
grant execute on function public.set_business_credentials(uuid, text, text, text, text, text) to service_role;
grant execute on function public.set_wa_credentials(uuid, text, text, text)       to service_role;
grant execute on function public.set_yoco_credentials(uuid, text, text, text)     to service_role;
