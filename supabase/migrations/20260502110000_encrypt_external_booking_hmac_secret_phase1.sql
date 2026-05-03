-- Encrypt external_booking_credentials.hmac_secret at rest (Prompt 14, Phase 1: expand).
-- Adds hmac_secret_encrypted bytea alongside the existing plaintext column.
-- Backfill happens via the edge function (SETTINGS_ENCRYPTION_KEY is only in env, not DB).
-- Phase 2 (contract) drops the plaintext column after verification.

BEGIN;

-- ── 1. Add encrypted column ──
ALTER TABLE public.external_booking_credentials
  ADD COLUMN hmac_secret_encrypted bytea;

-- ── 2. RPC: decrypt and return hmac_secret for a specific credential ──
CREATE OR REPLACE FUNCTION public.get_external_booking_credentials(
  p_credential_id uuid,
  p_key            text
)
RETURNS TABLE (hmac_secret text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app_private, extensions
AS $$
  SELECT app_private.decrypt_secret(c.hmac_secret_encrypted, p_key) AS hmac_secret
  FROM public.external_booking_credentials c
  WHERE c.id = p_credential_id;
$$;

REVOKE ALL ON FUNCTION public.get_external_booking_credentials(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_external_booking_credentials(uuid, text) TO service_role;

-- ── 3. RPC: encrypt and store hmac_secret ──
CREATE OR REPLACE FUNCTION public.set_external_booking_credentials(
  p_credential_id uuid,
  p_key            text,
  p_hmac_secret    text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private, extensions
AS $$
BEGIN
  UPDATE public.external_booking_credentials
  SET hmac_secret_encrypted = CASE
        WHEN p_hmac_secret IS NOT NULL
        THEN app_private.encrypt_secret(p_hmac_secret, p_key)
        ELSE NULL
      END
  WHERE id = p_credential_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credential not found: %', p_credential_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_external_booking_credentials(uuid, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_external_booking_credentials(uuid, text, text) TO service_role;

-- ── 4. Revoke anon access (defense in depth) ──
-- RLS already blocks anon (no anon policies), but table-level grants are overly broad.
-- No anon use case exists: edge function uses service_role, admin uses authenticated.
REVOKE ALL ON public.external_booking_credentials FROM anon;

NOTIFY pgrst, 'reload schema';

COMMIT;
