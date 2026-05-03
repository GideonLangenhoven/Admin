-- Encrypt 5 plaintext bank columns on public.businesses at rest (Prompt 15).
-- Clean cutover: all 5 columns are NULL on every row, so drop-and-replace.
-- Follows the same pattern as Prompt 12 (google_drive_refresh_token).
-- New _encrypted columns inherit NO grants from anon (column-level grants
-- from Prompt 10 don't auto-extend to new columns).

BEGIN;

-- ── Guard: refuse to run if any bank column has data ──
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.businesses
    WHERE bank_account_owner IS NOT NULL
       OR bank_account_number IS NOT NULL
       OR bank_account_type IS NOT NULL
       OR bank_name IS NOT NULL
       OR bank_branch_code IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot clean-cutover: one or more bank columns have non-NULL data';
  END IF;
END $$;

-- ── Drop 5 plaintext columns ──
ALTER TABLE public.businesses DROP COLUMN bank_account_owner;
ALTER TABLE public.businesses DROP COLUMN bank_account_number;
ALTER TABLE public.businesses DROP COLUMN bank_account_type;
ALTER TABLE public.businesses DROP COLUMN bank_name;
ALTER TABLE public.businesses DROP COLUMN bank_branch_code;

-- ── Add 5 encrypted bytea columns ──
ALTER TABLE public.businesses ADD COLUMN bank_account_owner_encrypted bytea;
ALTER TABLE public.businesses ADD COLUMN bank_account_number_encrypted bytea;
ALTER TABLE public.businesses ADD COLUMN bank_account_type_encrypted bytea;
ALTER TABLE public.businesses ADD COLUMN bank_name_encrypted bytea;
ALTER TABLE public.businesses ADD COLUMN bank_branch_code_encrypted bytea;

-- ── RPC: decrypt and return all bank details for a business ──
CREATE OR REPLACE FUNCTION public.get_business_bank_details(
  p_business_id uuid,
  p_key         text
)
RETURNS TABLE (
  account_owner  text,
  account_number text,
  account_type   text,
  bank_name      text,
  branch_code    text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    app_private.decrypt_secret(b.bank_account_owner_encrypted, p_key),
    app_private.decrypt_secret(b.bank_account_number_encrypted, p_key),
    app_private.decrypt_secret(b.bank_account_type_encrypted, p_key),
    app_private.decrypt_secret(b.bank_name_encrypted, p_key),
    app_private.decrypt_secret(b.bank_branch_code_encrypted, p_key)
  FROM public.businesses b
  WHERE b.id = p_business_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_business_bank_details(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_business_bank_details(uuid, text) TO service_role;

-- ── RPC: encrypt and store bank details for a business ──
CREATE OR REPLACE FUNCTION public.set_business_bank_details(
  p_business_id    uuid,
  p_key            text,
  p_account_owner  text DEFAULT NULL,
  p_account_number text DEFAULT NULL,
  p_account_type   text DEFAULT NULL,
  p_bank_name      text DEFAULT NULL,
  p_branch_code    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private, extensions
AS $$
BEGIN
  UPDATE public.businesses
  SET
    bank_account_owner_encrypted  = CASE WHEN p_account_owner  IS NOT NULL THEN app_private.encrypt_secret(p_account_owner,  p_key) ELSE NULL END,
    bank_account_number_encrypted = CASE WHEN p_account_number IS NOT NULL THEN app_private.encrypt_secret(p_account_number, p_key) ELSE NULL END,
    bank_account_type_encrypted   = CASE WHEN p_account_type   IS NOT NULL THEN app_private.encrypt_secret(p_account_type,   p_key) ELSE NULL END,
    bank_name_encrypted           = CASE WHEN p_bank_name      IS NOT NULL THEN app_private.encrypt_secret(p_bank_name,      p_key) ELSE NULL END,
    bank_branch_code_encrypted    = CASE WHEN p_branch_code    IS NOT NULL THEN app_private.encrypt_secret(p_branch_code,    p_key) ELSE NULL END
  WHERE id = p_business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business not found: %', p_business_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_business_bank_details(uuid, text, text, text, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_business_bank_details(uuid, text, text, text, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
