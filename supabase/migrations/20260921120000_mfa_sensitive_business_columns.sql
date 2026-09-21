BEGIN;

-- Authenticated clients still need direct UPDATE for ordinary tenant settings,
-- but sensitive values must only be changed by the server boundaries that
-- verify a signed AAL2 session. Replace the table-wide grant with a generated
-- safe-column grant so existing non-sensitive settings remain usable.
REVOKE UPDATE ON TABLE public.businesses FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (
  bank_account_owner_encrypted,
  bank_account_number_encrypted,
  bank_account_type_encrypted,
  bank_name_encrypted,
  bank_branch_code_encrypted,
  wa_token_encrypted,
  wa_phone_id_encrypted,
  wa_phone_id_lookup,
  yoco_secret_key_encrypted,
  yoco_webhook_secret_encrypted,
  yoco_test_secret_key_encrypted,
  yoco_test_webhook_secret_encrypted,
  yoco_test_mode,
  yoco_webhook_status
) ON TABLE public.businesses FROM PUBLIC, anon, authenticated;

-- Remove inherited UPDATE authority as well. Supabase's runtime roles should
-- not currently inherit a writer role, but checking the membership graph here
-- keeps a future grant from silently reopening these columns.
DO $$
DECLARE inherited_role name;
BEGIN
  FOR inherited_role IN
    SELECT rolname
    FROM pg_roles
    WHERE rolname NOT IN ('postgres', 'service_role')
      AND (
        rolname IN ('anon', 'authenticated')
        OR pg_has_role('anon', oid, 'MEMBER')
        OR pg_has_role('authenticated', oid, 'MEMBER')
      )
  LOOP
    EXECUTE format('REVOKE UPDATE ON TABLE public.businesses FROM %I', inherited_role);
    EXECUTE format(
      'REVOKE UPDATE (bank_account_owner_encrypted, bank_account_number_encrypted, bank_account_type_encrypted, bank_name_encrypted, bank_branch_code_encrypted, wa_token_encrypted, wa_phone_id_encrypted, wa_phone_id_lookup, yoco_secret_key_encrypted, yoco_webhook_secret_encrypted, yoco_test_secret_key_encrypted, yoco_test_webhook_secret_encrypted, yoco_test_mode, yoco_webhook_status) ON TABLE public.businesses FROM %I',
      inherited_role
    );
  END LOOP;
END $$;

DO $$
DECLARE safe_columns text;
BEGIN
  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
    INTO safe_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'businesses'
    AND column_name <> ALL (ARRAY[
      'bank_account_owner_encrypted',
      'bank_account_number_encrypted',
      'bank_account_type_encrypted',
      'bank_name_encrypted',
      'bank_branch_code_encrypted',
      'wa_token_encrypted',
      'wa_phone_id_encrypted',
      'wa_phone_id_lookup',
      'yoco_secret_key_encrypted',
      'yoco_webhook_secret_encrypted',
      'yoco_test_secret_key_encrypted',
      'yoco_test_webhook_secret_encrypted',
      'yoco_test_mode',
      'yoco_webhook_status'
    ]);
  IF safe_columns IS NULL THEN RAISE EXCEPTION 'businesses safe-column inventory is empty'; END IF;
  EXECUTE 'GRANT UPDATE (' || safe_columns || ') ON TABLE public.businesses TO authenticated';
END $$;

CREATE OR REPLACE FUNCTION public.assert_sensitive_settings_actor(p_actor_id uuid, p_business_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE actor public.admin_users%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM public.admin_users WHERE id = p_actor_id;
  IF NOT FOUND OR actor.suspended OR coalesce(actor.read_only, false)
     OR actor.role NOT IN ('MAIN_ADMIN', 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'Protected settings actor is not authorized' USING ERRCODE = '42501';
  END IF;
  IF actor.role <> 'SUPER_ADMIN' AND actor.business_id IS DISTINCT FROM p_business_id THEN
    RAISE EXCEPTION 'Protected settings target is not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.businesses
    WHERE id = p_business_id AND subscription_status IN ('ACTIVE', 'TRIAL', 'PAST_DUE')
  ) THEN
    RAISE EXCEPTION 'Protected settings target is not active' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_sensitive_settings_actor(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_sensitive_settings_actor(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.set_sensitive_credentials_audited(
  p_business_id uuid,
  p_actor_id uuid,
  p_key text,
  p_section text,
  p_first_value text DEFAULT NULL,
  p_second_value text DEFAULT NULL,
  p_test_mode boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private, extensions
AS $$
DECLARE actor_business uuid;
BEGIN
  PERFORM public.assert_sensitive_settings_actor(p_actor_id, p_business_id);
  SELECT business_id INTO actor_business FROM public.admin_users WHERE id = p_actor_id;

  CASE p_section
    WHEN 'wa' THEN
      PERFORM public.set_wa_credentials(p_business_id, p_key, p_first_value, p_second_value);
    WHEN 'yoco' THEN
      PERFORM public.set_yoco_credentials(p_business_id, p_key, p_first_value, p_second_value);
    WHEN 'yoco_test' THEN
      PERFORM public.set_yoco_test_credentials(p_business_id, p_key, p_first_value, p_second_value, NULL);
    WHEN 'yoco_test_mode' THEN
      PERFORM public.set_yoco_test_credentials(p_business_id, p_key, NULL, NULL, p_test_mode);
    ELSE
      RAISE EXCEPTION 'Unknown protected credential section';
  END CASE;

  INSERT INTO public.audit_logs(actor_id, business_id, action_type, target_entity, target_id, after_state)
  VALUES (
    p_actor_id,
    p_business_id,
    'SENSITIVE_CREDENTIAL_CHANGED',
    'businesses',
    p_business_id,
    jsonb_build_object('outcome', 'success', 'section', p_section, 'assisted', actor_business IS DISTINCT FROM p_business_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.set_sensitive_credentials_audited(uuid, uuid, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_sensitive_credentials_audited(uuid, uuid, text, text, text, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.set_business_bank_details_audited(
  p_business_id uuid,
  p_actor_id uuid,
  p_key text,
  p_account_owner text DEFAULT NULL,
  p_account_number text DEFAULT NULL,
  p_account_type text DEFAULT NULL,
  p_bank_name text DEFAULT NULL,
  p_branch_code text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private, extensions
AS $$
DECLARE actor_business uuid;
BEGIN
  PERFORM public.assert_sensitive_settings_actor(p_actor_id, p_business_id);
  SELECT business_id INTO actor_business FROM public.admin_users WHERE id = p_actor_id;
  PERFORM public.set_business_bank_details(
    p_business_id, p_key, p_account_owner, p_account_number, p_account_type, p_bank_name, p_branch_code
  );
  INSERT INTO public.audit_logs(actor_id, business_id, action_type, target_entity, target_id, after_state)
  VALUES (
    p_actor_id,
    p_business_id,
    'BANK_DETAILS_CHANGED',
    'businesses',
    p_business_id,
    jsonb_build_object('outcome', 'success', 'assisted', actor_business IS DISTINCT FROM p_business_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.set_business_bank_details_audited(uuid, uuid, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_business_bank_details_audited(uuid, uuid, text, text, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.set_platform_bank_details_audited(
  p_actor_id uuid,
  p_key text,
  p_account_owner text DEFAULT NULL,
  p_account_number text DEFAULT NULL,
  p_account_type text DEFAULT NULL,
  p_bank_name text DEFAULT NULL,
  p_branch_code text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private, extensions
AS $$
DECLARE actor public.admin_users%ROWTYPE;
BEGIN
  SELECT * INTO actor FROM public.admin_users WHERE id = p_actor_id;
  IF NOT FOUND OR actor.role <> 'SUPER_ADMIN' OR actor.suspended OR coalesce(actor.read_only, false) THEN
    RAISE EXCEPTION 'Protected platform settings actor is not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM public.set_platform_bank_details(p_key, p_account_owner, p_account_number, p_account_type, p_bank_name, p_branch_code);
  INSERT INTO public.audit_logs(actor_id, business_id, action_type, target_entity, after_state)
  VALUES (p_actor_id, actor.business_id, 'PLATFORM_BANK_DETAILS_CHANGED', 'platform_settings', jsonb_build_object('outcome', 'success'));
END;
$$;
REVOKE ALL ON FUNCTION public.set_platform_bank_details_audited(uuid, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_platform_bank_details_audited(uuid, text, text, text, text, text, text) TO service_role;

-- The original onboarding RPC can link first credentials. Route it through an
-- atomic wrapper so the credential effect and its attribution either both
-- commit or both roll back. The Edge boundary performs the live AAL2 check.
CREATE OR REPLACE FUNCTION public.platform_onboard_business_audited(
  p_actor_id uuid,
  p_request_id uuid,
  p_business jsonb,
  p_admin jsonb,
  p_credentials jsonb,
  p_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  onboarded_business_id uuid;
  credential_sections jsonb := '[]'::jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_users
    WHERE id = p_actor_id AND role = 'SUPER_ADMIN' AND NOT suspended AND NOT coalesce(read_only, false)
  ) THEN
    RAISE EXCEPTION 'Onboarding actor is not authorized' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_credentials, '{}'::jsonb) <> '{}'::jsonb THEN
    IF (nullif(p_credentials->>'wa_token', '') IS NULL) <> (nullif(p_credentials->>'wa_phone_id', '') IS NULL)
       OR (nullif(p_credentials->>'yoco_secret_key', '') IS NULL) <> (nullif(p_credentials->>'yoco_webhook_secret', '') IS NULL) THEN
      RAISE EXCEPTION 'Credential pairs must be complete' USING ERRCODE = '22023';
    END IF;
    IF nullif(p_credentials->>'wa_token', '') IS NOT NULL THEN credential_sections := credential_sections || '"whatsapp"'::jsonb; END IF;
    IF nullif(p_credentials->>'yoco_secret_key', '') IS NOT NULL THEN credential_sections := credential_sections || '"yoco"'::jsonb; END IF;
  END IF;

  result := public.platform_onboard_business(p_actor_id, p_request_id, p_business, p_admin, coalesce(p_credentials, '{}'::jsonb), p_key);
  onboarded_business_id := (result->'business'->>'id')::uuid;
  IF jsonb_array_length(credential_sections) > 0 AND NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE actor_id = p_actor_id AND target_entity = 'businesses' AND target_id = onboarded_business_id
      AND action_type = 'SENSITIVE_CREDENTIAL_CHANGED'
      AND after_state->>'onboarding_request_id' = p_request_id::text
  ) THEN
    INSERT INTO public.audit_logs(actor_id, business_id, action_type, target_entity, target_id, after_state)
    VALUES (
      p_actor_id, onboarded_business_id, 'SENSITIVE_CREDENTIAL_CHANGED', 'businesses', onboarded_business_id,
      jsonb_build_object(
        'outcome', 'success', 'sections', credential_sections, 'assisted', true,
        'onboarding_request_id', p_request_id
      )
    );
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.platform_onboard_business(uuid, uuid, jsonb, jsonb, jsonb, text) FROM service_role;
REVOKE ALL ON FUNCTION public.platform_onboard_business_audited(uuid, uuid, jsonb, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_onboard_business_audited(uuid, uuid, jsonb, jsonb, jsonb, text) TO service_role;

-- Recovery status is authorization state, not an audit-log inference. Only
-- service-role functions may write or read it. The operation id prevents an
-- expired/slow recovery request from completing over a newer one.
CREATE TABLE IF NOT EXISTS public.mfa_recovery_state (
  admin_id uuid PRIMARY KEY REFERENCES public.admin_users(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.admin_users(id),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  status text NOT NULL CHECK (status IN ('PENDING', 'PARTIAL', 'COMPLETED')),
  verification_reference text NOT NULL CHECK (length(verification_reference) BETWEEN 5 AND 120),
  requested_factor_count integer NOT NULL DEFAULT 0 CHECK (requested_factor_count >= 0),
  deleted_count integer NOT NULL DEFAULT 0 CHECK (deleted_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  remaining_count integer CHECK (remaining_count IS NULL OR remaining_count >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mfa_recovery_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mfa_recovery_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mfa_recovery_state TO service_role;

CREATE OR REPLACE FUNCTION public.begin_mfa_recovery(
  p_actor_id uuid,
  p_admin_id uuid,
  p_business_id uuid,
  p_verification_reference text,
  p_requested_factor_count integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  actor public.admin_users%ROWTYPE;
  target public.admin_users%ROWTYPE;
  current_state public.mfa_recovery_state%ROWTYPE;
  next_operation uuid := gen_random_uuid();
BEGIN
  IF p_verification_reference !~ '^[A-Za-z0-9][A-Za-z0-9._:/#-]{4,119}$'
     OR coalesce(p_requested_factor_count, -1) < 0 THEN
    RAISE EXCEPTION 'Invalid recovery verification' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO actor FROM public.admin_users WHERE id = p_actor_id;
  SELECT * INTO target FROM public.admin_users WHERE id = p_admin_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recovery target not found' USING ERRCODE = '42501'; END IF;
  IF actor.id IS NULL OR actor.role <> 'SUPER_ADMIN' OR actor.suspended OR coalesce(actor.read_only, false) THEN
    RAISE EXCEPTION 'Recovery actor is not authorized' USING ERRCODE = '42501';
  END IF;
  IF target.business_id IS DISTINCT FROM p_business_id
     OR target.role NOT IN ('OPERATOR', 'ADMIN', 'MAIN_ADMIN')
     OR target.suspended OR coalesce(target.read_only, false) OR target.user_id IS NULL
     OR target.id = actor.id OR target.user_id = actor.user_id THEN
    RAISE EXCEPTION 'Recovery target is not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.businesses
    WHERE id = p_business_id AND subscription_status IN ('ACTIVE', 'TRIAL', 'PAST_DUE')
  ) THEN
    RAISE EXCEPTION 'Recovery target business is not active' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_admin_id::text, 0));
  SELECT * INTO current_state FROM public.mfa_recovery_state WHERE admin_id = p_admin_id FOR UPDATE;
  IF FOUND AND current_state.status = 'PENDING' AND current_state.lease_expires_at > now() THEN
    RAISE EXCEPTION 'Recovery is already in progress' USING ERRCODE = '55P03';
  END IF;

  INSERT INTO public.mfa_recovery_state(
    admin_id, operation_id, actor_id, business_id, status, verification_reference,
    requested_factor_count, deleted_count, failed_count, remaining_count,
    started_at, lease_expires_at, completed_at, updated_at
  ) VALUES (
    p_admin_id, next_operation, p_actor_id, p_business_id, 'PENDING', p_verification_reference,
    p_requested_factor_count, 0, 0, NULL, now(), now() + interval '90 seconds', NULL, now()
  )
  ON CONFLICT (admin_id) DO UPDATE SET
    operation_id = excluded.operation_id,
    actor_id = excluded.actor_id,
    business_id = excluded.business_id,
    status = excluded.status,
    verification_reference = excluded.verification_reference,
    requested_factor_count = excluded.requested_factor_count,
    deleted_count = 0,
    failed_count = 0,
    remaining_count = NULL,
    started_at = excluded.started_at,
    lease_expires_at = excluded.lease_expires_at,
    completed_at = NULL,
    updated_at = excluded.updated_at;

  INSERT INTO public.audit_logs(actor_id, business_id, action_type, target_entity, target_id, after_state)
  VALUES (
    p_actor_id, p_business_id, 'MFA_RECOVERY_STARTED', 'admin_users', p_admin_id,
    jsonb_build_object(
      'outcome', 'pending', 'verification_acknowledged', true,
      'verification_reference', p_verification_reference,
      'requested_factor_count', p_requested_factor_count,
      'operation_id', next_operation
    )
  );
  RETURN next_operation;
END;
$$;
REVOKE ALL ON FUNCTION public.begin_mfa_recovery(uuid, uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_mfa_recovery(uuid, uuid, uuid, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_mfa_recovery(
  p_operation_id uuid,
  p_actor_id uuid,
  p_admin_id uuid,
  p_business_id uuid,
  p_completed boolean,
  p_deleted_count integer,
  p_failed_count integer,
  p_remaining_count integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE state public.mfa_recovery_state%ROWTYPE;
BEGIN
  IF coalesce(p_deleted_count, -1) < 0 OR coalesce(p_failed_count, -1) < 0
     OR (p_remaining_count IS NOT NULL AND p_remaining_count < 0) THEN
    RAISE EXCEPTION 'Invalid recovery outcome' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO state FROM public.mfa_recovery_state WHERE admin_id = p_admin_id FOR UPDATE;
  IF NOT FOUND OR state.operation_id IS DISTINCT FROM p_operation_id
     OR state.actor_id IS DISTINCT FROM p_actor_id
     OR state.business_id IS DISTINCT FROM p_business_id
     OR state.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Recovery operation is no longer current' USING ERRCODE = '40001';
  END IF;
  IF p_completed IS DISTINCT FROM (p_failed_count = 0 AND p_remaining_count = 0) THEN
    RAISE EXCEPTION 'Recovery completion does not match factor outcome' USING ERRCODE = '22023';
  END IF;

  UPDATE public.mfa_recovery_state SET
    status = CASE WHEN p_completed THEN 'COMPLETED' ELSE 'PARTIAL' END,
    deleted_count = p_deleted_count,
    failed_count = p_failed_count,
    remaining_count = p_remaining_count,
    lease_expires_at = NULL,
    completed_at = CASE WHEN p_completed THEN now() ELSE NULL END,
    updated_at = now()
  WHERE admin_id = p_admin_id;

  INSERT INTO public.audit_logs(actor_id, business_id, action_type, target_entity, target_id, after_state)
  VALUES (
    p_actor_id, p_business_id,
    CASE WHEN p_completed THEN 'MFA_RECOVERY_COMPLETED' ELSE 'MFA_RECOVERY_PARTIAL' END,
    'admin_users', p_admin_id,
    jsonb_build_object(
      'outcome', CASE WHEN p_completed THEN 'success' ELSE 'partial' END,
      'deleted_count', p_deleted_count,
      'failed_count', p_failed_count,
      'remaining_count', p_remaining_count,
      'verification_reference', state.verification_reference,
      'operation_id', p_operation_id
    )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.finish_mfa_recovery(uuid, uuid, uuid, uuid, boolean, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_mfa_recovery(uuid, uuid, uuid, uuid, boolean, integer, integer, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
