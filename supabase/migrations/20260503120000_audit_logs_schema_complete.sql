-- Audit log schema completion + triggers on security-critical tables
-- Idempotent: safe to re-run
BEGIN;

-- Add columns missing from the original audit_logs table
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS actor_role    text,
  ADD COLUMN IF NOT EXISTS actor_email   text,
  ADD COLUMN IF NOT EXISTS metadata      jsonb,
  ADD COLUMN IF NOT EXISTS ip_address    text,
  ADD COLUMN IF NOT EXISTS user_agent    text,
  ADD COLUMN IF NOT EXISTS source        text;

-- business_id was NOT NULL but triggers for cross-tenant ops may need NULL
ALTER TABLE public.audit_logs ALTER COLUMN business_id DROP NOT NULL;

-- Composite index for the /audit-log page's main query
CREATE INDEX IF NOT EXISTS idx_audit_logs_business_created
  ON public.audit_logs (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action_entity
  ON public.audit_logs (action_type, target_entity);

-- SUPER_ADMIN select policy (MAIN_ADMIN already covered by audit_logs_select_own_business)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='audit_logs' AND policyname='audit_logs_select_super_admin'
  ) THEN
    CREATE POLICY "audit_logs_select_super_admin"
      ON public.audit_logs FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.admin_users
          WHERE user_id = auth.uid() AND role = 'SUPER_ADMIN' AND suspended IS NOT TRUE
        )
      );
  END IF;
END $$;

-- ── Trigger: admin_users changes ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._audit_admin_users_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_logs (business_id, action_type, target_entity, target_id, before_state, after_state, source)
  VALUES (
    COALESCE(NEW.business_id, OLD.business_id),
    TG_OP::text,
    'admin_users',
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN
      (row_to_json(OLD)::jsonb) - 'password_hash' - 'setup_token_hash'
    END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN
      (row_to_json(NEW)::jsonb) - 'password_hash' - 'setup_token_hash'
    END,
    'trigger'
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS audit_admin_users ON public.admin_users;
CREATE TRIGGER audit_admin_users
  AFTER INSERT OR UPDATE OR DELETE ON public.admin_users
  FOR EACH ROW EXECUTE FUNCTION public._audit_admin_users_changes();

-- ── Trigger: businesses changes (strip all encrypted columns) ───────────
CREATE OR REPLACE FUNCTION public._audit_businesses_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before jsonb;
  v_after  jsonb;
BEGIN
  v_before := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN
    (row_to_json(OLD)::jsonb)
      - 'wa_token_encrypted' - 'wa_phone_id_encrypted'
      - 'yoco_secret_key_encrypted' - 'yoco_webhook_secret_encrypted'
      - 'yoco_test_secret_key_encrypted' - 'yoco_test_webhook_secret_encrypted'
      - 'paysafe_api_key_encrypted' - 'paysafe_api_secret_encrypted'
      - 'bank_account_number_encrypted' - 'bank_account_owner_encrypted'
      - 'bank_account_type_encrypted' - 'bank_branch_code_encrypted'
      - 'bank_name_encrypted' - 'google_drive_refresh_token_encrypted'
  END;
  v_after := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN
    (row_to_json(NEW)::jsonb)
      - 'wa_token_encrypted' - 'wa_phone_id_encrypted'
      - 'yoco_secret_key_encrypted' - 'yoco_webhook_secret_encrypted'
      - 'yoco_test_secret_key_encrypted' - 'yoco_test_webhook_secret_encrypted'
      - 'paysafe_api_key_encrypted' - 'paysafe_api_secret_encrypted'
      - 'bank_account_number_encrypted' - 'bank_account_owner_encrypted'
      - 'bank_account_type_encrypted' - 'bank_branch_code_encrypted'
      - 'bank_name_encrypted' - 'google_drive_refresh_token_encrypted'
  END;

  INSERT INTO public.audit_logs (business_id, action_type, target_entity, target_id, before_state, after_state, source)
  VALUES (
    COALESCE(NEW.id, OLD.id),
    TG_OP::text,
    'businesses',
    COALESCE(NEW.id, OLD.id),
    v_before,
    v_after,
    'trigger'
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS audit_businesses ON public.businesses;
CREATE TRIGGER audit_businesses
  AFTER INSERT OR UPDATE OR DELETE ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public._audit_businesses_changes();

COMMIT;
