BEGIN;

-- POPIA data subject request types and statuses
DO $$ BEGIN CREATE TYPE data_request_type AS ENUM ('ACCESS', 'DELETION', 'CORRECTION'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE data_request_status AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED', 'IN_REVIEW', 'FULFILLED', 'CANCELLED', 'REJECTED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS data_subject_requests (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id               uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id               uuid REFERENCES customers(id) ON DELETE SET NULL,
  email                     text NOT NULL,
  request_type              data_request_type NOT NULL,
  status                    data_request_status NOT NULL DEFAULT 'PENDING_CONFIRMATION',
  reason                    text,
  confirmation_token_hash   text,
  confirmation_expires_at   timestamptz,
  confirmed_at              timestamptz,
  scheduled_for             timestamptz,
  fulfilled_at              timestamptz,
  fulfilled_by              uuid REFERENCES admin_users(id),
  cancelled_at              timestamptz,
  cancellation_reason       text,
  export_url                text,
  export_expires_at         timestamptz,
  metadata                  jsonb DEFAULT '{}'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dsr_business_status ON data_subject_requests(business_id, status);
CREATE INDEX IF NOT EXISTS idx_dsr_scheduled ON data_subject_requests(scheduled_for) WHERE status = 'CONFIRMED';
CREATE INDEX IF NOT EXISTS idx_dsr_email ON data_subject_requests(lower(email));

ALTER TABLE data_subject_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dsr_tenant_read ON data_subject_requests;
CREATE POLICY dsr_tenant_read ON data_subject_requests FOR SELECT TO authenticated
  USING (business_id IN (
    SELECT au.business_id FROM admin_users au WHERE au.user_id = auth.uid() AND NOT au.suspended
  ));

DROP POLICY IF EXISTS dsr_service ON data_subject_requests;
CREATE POLICY dsr_service ON data_subject_requests FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Anonymization audit trail
CREATE TABLE IF NOT EXISTS pii_anonymization_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL,
  request_id        uuid REFERENCES data_subject_requests(id),
  customer_id       uuid,
  anonymized_token  text NOT NULL,
  affected_tables   jsonb NOT NULL,
  performed_by      uuid REFERENCES admin_users(id),
  performed_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pii_anonymization_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pii_log_read ON pii_anonymization_log;
CREATE POLICY pii_log_read ON pii_anonymization_log FOR SELECT TO authenticated
  USING (business_id IN (
    SELECT au.business_id FROM admin_users au WHERE au.user_id = auth.uid() AND NOT au.suspended
  ));

DROP POLICY IF EXISTS pii_log_service ON pii_anonymization_log;
CREATE POLICY pii_log_service ON pii_anonymization_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Add deleted_at to customers if missing
ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Anonymization RPC (service_role only)
CREATE OR REPLACE FUNCTION anonymize_customer(
  p_customer_id uuid,
  p_business_id uuid,
  p_request_id uuid,
  p_admin_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
  v_anon_email text;
  v_counts jsonb := '{}'::jsonb;
  v_count int;
BEGIN
  v_token := 'deleted-' || substring(encode(digest(p_customer_id::text || p_business_id::text, 'sha256'), 'hex') for 16);
  v_anon_email := v_token || '@anonymized.local';

  -- Anonymize customer row (keep id for FK integrity)
  UPDATE customers SET
    email = v_anon_email,
    name = 'Deleted Customer',
    phone = NULL,
    marketing_consent = false,
    date_of_birth = NULL,
    notes = NULL,
    deleted_at = now(),
    updated_at = now()
  WHERE id = p_customer_id AND business_id = p_business_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('customers', v_count);

  -- Anonymize bookings (preserve financial shell)
  UPDATE bookings SET
    customer_name = 'Deleted Customer',
    email = v_anon_email,
    phone = NULL,
    notes = NULL,
    updated_at = now()
  WHERE customer_id = p_customer_id AND business_id = p_business_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('bookings', v_count);

  -- Hard-delete marketing data
  DELETE FROM marketing_contacts WHERE email_lower = lower(
    (SELECT email FROM customers WHERE id = p_customer_id)
  ) AND business_id = p_business_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_counts := v_counts || jsonb_build_object('marketing_contacts', v_count);

  -- Log the anonymization
  INSERT INTO pii_anonymization_log (business_id, request_id, customer_id, anonymized_token, affected_tables, performed_by)
  VALUES (p_business_id, p_request_id, p_customer_id, v_token, v_counts, p_admin_id);

  -- Audit log
  INSERT INTO audit_logs (business_id, actor_id, action_type, target_entity, target_id, after_state)
  VALUES (p_business_id, p_admin_id, 'POPIA_ANONYMIZE', 'customers', p_customer_id, v_counts);

  RETURN v_counts;
END;
$$;

REVOKE EXECUTE ON FUNCTION anonymize_customer FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION anonymize_customer TO service_role;

COMMIT;
