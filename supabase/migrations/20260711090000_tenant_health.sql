-- Migration: Tenant Health and Monitoring Infrastructure
-- Description: Creates the tenant_health table to store precomputed health checks for each tenant.
--              Includes a try_decrypt_secret helper function to safely check credentials decryptability.

BEGIN;

-- 1. Helper function to safely decrypt credentials and return a failure token instead of throwing an exception
CREATE OR REPLACE FUNCTION app_private.try_decrypt_secret(p_encrypted bytea, p_key text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private, extensions
AS $$
BEGIN
  IF p_encrypted IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN extensions.pgp_sym_decrypt(p_encrypted, p_key);
EXCEPTION WHEN OTHERS THEN
  RETURN 'DECRYPTION_FAILED';
END;
$$;

REVOKE ALL ON FUNCTION app_private.try_decrypt_secret(bytea, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.try_decrypt_secret(bytea, text) TO service_role;

-- 2. Tenant Health table
CREATE TABLE IF NOT EXISTS public.tenant_health (
  business_id   uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  health_status text NOT NULL DEFAULT 'green' CHECK (health_status IN ('green', 'yellow', 'red')),
  failing_checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Indexes for status filtering and ordering
CREATE INDEX IF NOT EXISTS idx_tenant_health_status ON public.tenant_health (health_status);
CREATE INDEX IF NOT EXISTS idx_tenant_health_updated_at ON public.tenant_health (updated_at);

-- Enable RLS
ALTER TABLE public.tenant_health ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies
CREATE POLICY tenant_health_service_all ON public.tenant_health FOR ALL TO service_role USING (true);

CREATE POLICY tenant_health_superadmin_select ON public.tenant_health
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users au
      WHERE au.id = auth.uid() AND au.role = 'SUPER_ADMIN'
    )
  );

GRANT ALL ON public.tenant_health TO service_role;
GRANT SELECT ON public.tenant_health TO authenticated;

COMMIT;
