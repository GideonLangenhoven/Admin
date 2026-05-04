BEGIN;

-- ============================================================
-- OTA INTEGRATIONS — Per-tenant, per-channel config
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ota_integrations (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id               uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel                   text NOT NULL CHECK (channel IN ('VIATOR','GETYOURGUIDE','KLOOK','EXPEDIA','AIRBNB')),
  enabled                   boolean NOT NULL DEFAULT false,
  test_mode                 boolean NOT NULL DEFAULT true,
  api_key_encrypted         bytea,
  api_secret_encrypted      bytea,
  webhook_secret_encrypted  bytea,
  config_json               jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at              timestamptz,
  last_sync_status          text,
  last_sync_error           text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ota_integration_channel_per_business
  ON public.ota_integrations (business_id, channel);

-- ============================================================
-- OTA PRODUCT MAPPINGS — our tour ↔ OTA product code
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ota_product_mappings (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id             uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel                 text NOT NULL,
  tour_id                 uuid NOT NULL REFERENCES public.tours(id) ON DELETE CASCADE,
  external_product_code   text NOT NULL,
  external_option_code    text,
  default_markup_pct      numeric(5,2) DEFAULT 0,
  enabled                 boolean NOT NULL DEFAULT true,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ota_mapping_unique
  ON public.ota_product_mappings (business_id, channel, external_product_code, COALESCE(external_option_code, ''));
CREATE INDEX IF NOT EXISTS idx_ota_mapping_tour
  ON public.ota_product_mappings (tour_id, channel);

-- ============================================================
-- BOOKINGS — OTA metadata columns
-- ============================================================
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS ota_channel text,
  ADD COLUMN IF NOT EXISTS ota_external_booking_id text,
  ADD COLUMN IF NOT EXISTS ota_net_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS ota_gross_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS ota_metadata jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_ota_external
  ON public.bookings (ota_channel, ota_external_booking_id)
  WHERE ota_external_booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_ota_channel
  ON public.bookings (ota_channel) WHERE ota_channel IS NOT NULL;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.ota_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ota_int_admin ON public.ota_integrations;
CREATE POLICY ota_int_admin ON public.ota_integrations FOR ALL TO authenticated
  USING (business_id = ANY(current_business_ids()))
  WITH CHECK (business_id = ANY(current_business_ids()));

DROP POLICY IF EXISTS ota_int_service ON public.ota_integrations;
CREATE POLICY ota_int_service ON public.ota_integrations FOR ALL TO service_role
  USING (true) WITH CHECK (true);

ALTER TABLE public.ota_product_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ota_map_admin ON public.ota_product_mappings;
CREATE POLICY ota_map_admin ON public.ota_product_mappings FOR ALL TO authenticated
  USING (business_id = ANY(current_business_ids()))
  WITH CHECK (business_id = ANY(current_business_ids()));

DROP POLICY IF EXISTS ota_map_service ON public.ota_product_mappings;
CREATE POLICY ota_map_service ON public.ota_product_mappings FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Revoke anon from new tables (they hold sensitive config)
REVOKE ALL ON public.ota_integrations FROM anon;
REVOKE ALL ON public.ota_product_mappings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ota_integrations TO authenticated;
GRANT ALL ON public.ota_integrations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ota_product_mappings TO authenticated;
GRANT ALL ON public.ota_product_mappings TO service_role;

-- ============================================================
-- CREDENTIAL RPCs — matches existing encrypt/decrypt pattern
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_ota_credentials(
  p_business_id     uuid,
  p_key             text,
  p_channel         text,
  p_api_key         text,
  p_api_secret      text DEFAULT NULL,
  p_webhook_secret  text DEFAULT NULL,
  p_test_mode       boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private, extensions
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_key IS NULL OR length(p_key) < 32 THEN
    RAISE EXCEPTION 'encryption key too short';
  END IF;

  INSERT INTO public.ota_integrations (business_id, channel, test_mode,
    api_key_encrypted, api_secret_encrypted, webhook_secret_encrypted)
  VALUES (p_business_id, upper(p_channel), p_test_mode,
    app_private.encrypt_secret(p_api_key, p_key),
    app_private.encrypt_secret(p_api_secret, p_key),
    app_private.encrypt_secret(p_webhook_secret, p_key))
  ON CONFLICT (business_id, channel) DO UPDATE SET
    test_mode = EXCLUDED.test_mode,
    api_key_encrypted = EXCLUDED.api_key_encrypted,
    api_secret_encrypted = EXCLUDED.api_secret_encrypted,
    webhook_secret_encrypted = EXCLUDED.webhook_secret_encrypted,
    updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_ota_credentials(uuid, text, text, text, text, text, boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_ota_credentials(uuid, text, text, text, text, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.get_ota_credentials(
  p_business_id uuid,
  p_key         text,
  p_channel     text
) RETURNS TABLE (
  api_key        text,
  api_secret     text,
  webhook_secret text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app_private, extensions
AS $$
  SELECT
    app_private.decrypt_secret(o.api_key_encrypted,         p_key),
    app_private.decrypt_secret(o.api_secret_encrypted,      p_key),
    app_private.decrypt_secret(o.webhook_secret_encrypted,  p_key)
  FROM public.ota_integrations o
  WHERE o.business_id = p_business_id AND o.channel = upper(p_channel);
$$;

REVOKE ALL ON FUNCTION public.get_ota_credentials(uuid, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ota_credentials(uuid, text, text) TO service_role;

-- ============================================================
-- HOURLY AVAILABILITY SYNC CRON
-- ============================================================
SELECT cron.schedule(
  'viator-availability-hourly',
  '7 * * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.settings.supabase_url') || '/functions/v1/viator-availability-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

COMMIT;
