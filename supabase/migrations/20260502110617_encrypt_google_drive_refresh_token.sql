BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.businesses WHERE google_drive_refresh_token IS NOT NULL) THEN
    RAISE EXCEPTION 'google_drive_refresh_token has non-NULL rows; rotate first (Prompt 11)';
  END IF;
END $$;

ALTER TABLE public.businesses DROP COLUMN google_drive_refresh_token;
ALTER TABLE public.businesses ADD COLUMN google_drive_refresh_token_encrypted bytea;

CREATE OR REPLACE FUNCTION public.get_gdrive_credentials(p_business_id uuid, p_key text)
RETURNS TABLE (refresh_token text, folder_id text, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    app_private.decrypt_secret(b.google_drive_refresh_token_encrypted, p_key),
    b.google_drive_folder_id,
    b.google_drive_email
  FROM public.businesses b
  WHERE b.id = p_business_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_gdrive_credentials(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_gdrive_credentials(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.set_gdrive_credentials(
  p_business_id   uuid,
  p_key           text,
  p_refresh_token text,
  p_folder_id     text DEFAULT NULL,
  p_email         text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private, extensions
AS $$
BEGIN
  UPDATE public.businesses
  SET
    google_drive_refresh_token_encrypted = app_private.encrypt_secret(p_refresh_token, p_key),
    google_drive_folder_id = COALESCE(p_folder_id, google_drive_folder_id),
    google_drive_email = COALESCE(p_email, google_drive_email)
  WHERE id = p_business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business not found: %', p_business_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_gdrive_credentials(uuid, text, text, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_gdrive_credentials(uuid, text, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;;
