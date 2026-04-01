-- Paysafe credential RPCs (follows encryption pattern from 20260317100000)

-- 1. set_paysafe_credentials — encrypt and store Paysafe keys
CREATE OR REPLACE FUNCTION public.set_paysafe_credentials(
  p_business_id              uuid,
  p_key                      text,
  p_paysafe_api_key          text,
  p_paysafe_api_secret       text,
  p_paysafe_account_id       text DEFAULT NULL,
  p_paysafe_linked_account_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private, extensions
AS $$
BEGIN
  UPDATE public.businesses
  SET
    paysafe_api_key_encrypted    = app_private.encrypt_secret(p_paysafe_api_key,    p_key),
    paysafe_api_secret_encrypted = app_private.encrypt_secret(p_paysafe_api_secret, p_key),
    paysafe_account_id           = COALESCE(p_paysafe_account_id, paysafe_account_id),
    paysafe_linked_account_id    = COALESCE(p_paysafe_linked_account_id, paysafe_linked_account_id)
  WHERE id = p_business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business not found: %', p_business_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_paysafe_credentials(uuid, text, text, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_paysafe_credentials(uuid, text, text, text, text, text) TO service_role;

-- 2. Update get_business_credentials to also return Paysafe fields
--    Drop the old signature first, then recreate with new return columns
DROP FUNCTION IF EXISTS public.get_business_credentials(uuid, text);

CREATE OR REPLACE FUNCTION public.get_business_credentials(p_business_id uuid, p_key text)
RETURNS TABLE (
  wa_token              text,
  wa_phone_id           text,
  yoco_secret_key       text,
  yoco_webhook_secret   text,
  paysafe_api_key       text,
  paysafe_api_secret    text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app_private, extensions
AS $$
  SELECT
    app_private.decrypt_secret(b.wa_token_encrypted,            p_key),
    app_private.decrypt_secret(b.wa_phone_id_encrypted,         p_key),
    app_private.decrypt_secret(b.yoco_secret_key_encrypted,     p_key),
    app_private.decrypt_secret(b.yoco_webhook_secret_encrypted, p_key),
    app_private.decrypt_secret(b.paysafe_api_key_encrypted,     p_key),
    app_private.decrypt_secret(b.paysafe_api_secret_encrypted,  p_key)
  FROM public.businesses b
  WHERE b.id = p_business_id;
$$;

REVOKE ALL ON FUNCTION public.get_business_credentials(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_business_credentials(uuid, text) TO service_role;
