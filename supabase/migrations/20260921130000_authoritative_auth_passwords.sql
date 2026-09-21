-- Supabase Auth becomes authoritative after a legacy account is linked. Setup
-- tokens use a short database claim lease so only one request may change Auth,
-- while a crashed request can be retried safely after its claim is released or
-- expires.
ALTER TABLE public.admin_users
  ALTER COLUMN password_hash DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS setup_token_claim_id uuid,
  ADD COLUMN IF NOT EXISTS setup_token_claimed_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_admin_setup_token(
  p_email text,
  p_token_hash text,
  p_claim_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target public.admin_users%ROWTYPE;
BEGIN
  SELECT * INTO target
  FROM public.admin_users
  WHERE lower(email) = lower(trim(p_email))
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'INVALID');
  END IF;

  IF target.setup_token_hash_used = p_token_hash
     AND target.password_set_at > now() - interval '5 minutes' THEN
    RETURN jsonb_build_object(
      'status', 'COMPLETED',
      'admin', jsonb_build_object('id', target.id, 'email', target.email, 'name', target.name)
    );
  END IF;

  IF target.setup_token_hash IS DISTINCT FROM p_token_hash
     OR target.setup_token_expires_at IS NULL
     OR target.setup_token_expires_at <= now() THEN
    RETURN jsonb_build_object('status', 'INVALID');
  END IF;

  IF target.setup_token_claim_id IS NOT NULL
     AND target.setup_token_claim_id <> p_claim_id
     AND target.setup_token_claimed_at > now() - interval '5 minutes' THEN
    RETURN jsonb_build_object('status', 'BUSY');
  END IF;

  UPDATE public.admin_users
  SET setup_token_claim_id = p_claim_id,
      setup_token_claimed_at = now()
  WHERE id = target.id;

  RETURN jsonb_build_object(
    'status', 'CLAIMED',
    'admin', jsonb_build_object(
      'id', target.id,
      'email', target.email,
      'name', target.name,
      'user_id', target.user_id,
      'business_id', target.business_id,
      'role', target.role
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_admin_setup_token(
  p_admin_id uuid,
  p_token_hash text,
  p_claim_id uuid,
  p_user_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.admin_users
  SET user_id = p_user_id,
      password_hash = NULL,
      password_set_at = now(),
      must_set_password = false,
      setup_token_hash = NULL,
      setup_token_hash_used = p_token_hash,
      setup_token_expires_at = NULL,
      setup_token_claim_id = NULL,
      setup_token_claimed_at = NULL
  WHERE id = p_admin_id
    AND setup_token_hash = p_token_hash
    AND setup_token_claim_id = p_claim_id
    AND setup_token_expires_at > now();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_admin_setup_token_claim(
  p_admin_id uuid,
  p_claim_id uuid
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH released AS (
    UPDATE public.admin_users
    SET setup_token_claim_id = NULL,
        setup_token_claimed_at = NULL
    WHERE id = p_admin_id
      AND setup_token_claim_id = p_claim_id
    RETURNING 1
  )
  SELECT EXISTS(SELECT 1 FROM released);
$$;

REVOKE ALL ON FUNCTION public.claim_admin_setup_token(text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_admin_setup_token(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_admin_setup_token_claim(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_admin_setup_token(text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_admin_setup_token(uuid, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_admin_setup_token_claim(uuid, uuid) TO service_role;
