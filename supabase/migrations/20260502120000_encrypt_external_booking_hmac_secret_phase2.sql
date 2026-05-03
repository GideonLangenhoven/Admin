-- Encrypt external_booking_credentials.hmac_secret at rest (Prompt 14, Phase 2: contract).
-- Drops the plaintext hmac_secret column after verifying all rows are encrypted.
-- DO NOT APPLY until edge function v41+ is live and verified via webhook.
-- Also updates the ck_seed_external_booking_credentials seeder function.

BEGIN;

-- ── Guard: every row with a plaintext secret must have an encrypted one ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.external_booking_credentials
    WHERE hmac_secret IS NOT NULL AND hmac_secret_encrypted IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot drop: encrypted column missing for some rows';
  END IF;
END $$;

-- ── Drop plaintext column ──
ALTER TABLE public.external_booking_credentials
  DROP COLUMN hmac_secret;

-- ── Update seeder function to use encrypted column ──
-- The seeder still generates the plaintext (returned to the admin for display)
-- but now stores it encrypted.  Requires p_key parameter.
CREATE OR REPLACE FUNCTION public.ck_seed_external_booking_credentials(
  p_source      text,
  p_key         text,
  p_enable_hmac boolean default true
)
RETURNS TABLE (
  business_id uuid,
  source      text,
  api_key     text,
  hmac_secret text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private, extensions
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT
      b.id AS business_id,
      upper(trim(p_source)) AS source,
      'ckext_' || encode(gen_random_bytes(20), 'hex') AS api_key,
      CASE WHEN p_enable_hmac THEN encode(gen_random_bytes(32), 'hex') ELSE NULL END AS hmac_secret
    FROM public.businesses b
    WHERE b.active = true
      AND NOT EXISTS (
        SELECT 1
        FROM public.external_booking_credentials c
        WHERE c.business_id = b.id
          AND c.source = upper(trim(p_source))
      )
  ),
  inserted AS (
    INSERT INTO public.external_booking_credentials (
      business_id,
      source,
      api_key_hash,
      api_key_last4,
      hmac_secret_encrypted,
      active
    )
    SELECT
      c.business_id,
      c.source,
      encode(digest(c.api_key, 'sha256'), 'hex'),
      right(c.api_key, 4),
      CASE WHEN c.hmac_secret IS NOT NULL
        THEN app_private.encrypt_secret(c.hmac_secret, p_key)
        ELSE NULL
      END,
      true
    FROM candidates c
    RETURNING business_id, source
  )
  SELECT c.business_id, c.source, c.api_key, c.hmac_secret
  FROM candidates c
  INNER JOIN inserted i
    ON i.business_id = c.business_id
   AND i.source = c.source;
END;
$$;

REVOKE ALL ON FUNCTION public.ck_seed_external_booking_credentials(text, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ck_seed_external_booking_credentials(text, text, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
