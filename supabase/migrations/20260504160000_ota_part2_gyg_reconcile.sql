BEGIN;

-- ============================================================
-- OTA RECONCILIATION RUNS — drift detection per channel
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ota_reconciliation_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel           text NOT NULL,
  run_at            timestamptz NOT NULL DEFAULT now(),
  period_start      timestamptz NOT NULL,
  period_end        timestamptz NOT NULL,
  our_count         int NOT NULL DEFAULT 0,
  ota_count         int NOT NULL DEFAULT 0,
  matched           int NOT NULL DEFAULT 0,
  missing_locally   int NOT NULL DEFAULT 0,
  missing_on_ota    int NOT NULL DEFAULT 0,
  amount_mismatches int NOT NULL DEFAULT 0,
  status_mismatches int NOT NULL DEFAULT 0,
  drifts            jsonb NOT NULL DEFAULT '[]'::jsonb,
  status            text NOT NULL DEFAULT 'ok'
);

CREATE INDEX IF NOT EXISTS idx_recon_runs_biz_channel
  ON public.ota_reconciliation_runs (business_id, channel, run_at DESC);

-- RLS
ALTER TABLE public.ota_reconciliation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recon_admin ON public.ota_reconciliation_runs;
CREATE POLICY recon_admin ON public.ota_reconciliation_runs FOR ALL TO authenticated
  USING (business_id = ANY(current_business_ids()))
  WITH CHECK (business_id = ANY(current_business_ids()));

DROP POLICY IF EXISTS recon_service ON public.ota_reconciliation_runs;
CREATE POLICY recon_service ON public.ota_reconciliation_runs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

REVOKE ALL ON public.ota_reconciliation_runs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ota_reconciliation_runs TO authenticated;
GRANT ALL ON public.ota_reconciliation_runs TO service_role;

-- ============================================================
-- GYG AVAILABILITY SYNC CRON (minute :12)
-- ============================================================
SELECT cron.schedule(
  'gyg-availability-hourly',
  '12 * * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.settings.supabase_url') || '/functions/v1/getyourguide-availability-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- ============================================================
-- OTA RECONCILE NIGHTLY CRON (02:37 UTC)
-- ============================================================
SELECT cron.schedule(
  'ota-reconcile-nightly',
  '37 2 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.settings.supabase_url') || '/functions/v1/ota-reconcile',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

COMMIT;
