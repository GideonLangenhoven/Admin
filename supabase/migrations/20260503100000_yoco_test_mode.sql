BEGIN;

-- 1. New columns
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS yoco_test_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS yoco_test_secret_key_encrypted bytea,
  ADD COLUMN IF NOT EXISTS yoco_test_webhook_secret_encrypted bytea;

COMMENT ON COLUMN public.businesses.yoco_test_mode IS
  'When true, create-checkout uses yoco_test_* keys and UIs show a TEST MODE banner.';

-- 2. Extend get_business_credentials to return test keys + flag
DROP FUNCTION IF EXISTS public.get_business_credentials(uuid, text);
CREATE FUNCTION public.get_business_credentials(p_business_id uuid, p_key text)
 RETURNS TABLE(
   wa_token text,
   wa_phone_id text,
   yoco_secret_key text,
   yoco_webhook_secret text,
   paysafe_api_key text,
   paysafe_api_secret text,
   yoco_test_mode boolean,
   yoco_test_secret_key text,
   yoco_test_webhook_secret text
 )
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'app_private', 'extensions'
AS $$
  SELECT
    app_private.decrypt_secret(b.wa_token_encrypted,                  p_key),
    app_private.decrypt_secret(b.wa_phone_id_encrypted,               p_key),
    app_private.decrypt_secret(b.yoco_secret_key_encrypted,           p_key),
    app_private.decrypt_secret(b.yoco_webhook_secret_encrypted,       p_key),
    app_private.decrypt_secret(b.paysafe_api_key_encrypted,           p_key),
    app_private.decrypt_secret(b.paysafe_api_secret_encrypted,        p_key),
    b.yoco_test_mode,
    app_private.decrypt_secret(b.yoco_test_secret_key_encrypted,      p_key),
    app_private.decrypt_secret(b.yoco_test_webhook_secret_encrypted,  p_key)
  FROM public.businesses b
  WHERE b.id = p_business_id;
$$;

-- 3. RPC to save test credentials + toggle
CREATE OR REPLACE FUNCTION public.set_yoco_test_credentials(
  p_business_id uuid,
  p_key text,
  p_test_secret_key text DEFAULT NULL,
  p_test_webhook_secret text DEFAULT NULL,
  p_test_mode boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app_private', 'extensions'
AS $$
begin
  update public.businesses
  set
    yoco_test_secret_key_encrypted     = CASE WHEN p_test_secret_key IS NOT NULL
      THEN app_private.encrypt_secret(p_test_secret_key, p_key)
      ELSE yoco_test_secret_key_encrypted END,
    yoco_test_webhook_secret_encrypted = CASE WHEN p_test_webhook_secret IS NOT NULL
      THEN app_private.encrypt_secret(p_test_webhook_secret, p_key)
      ELSE yoco_test_webhook_secret_encrypted END,
    yoco_test_mode = COALESCE(p_test_mode, yoco_test_mode)
  where id = p_business_id;

  if not found then
    raise exception 'Business not found: %', p_business_id;
  end if;
end;
$$;

COMMIT;
