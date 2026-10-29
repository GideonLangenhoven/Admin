-- S5: two cron jobs called edge functions with no usable credential.
--   fetch-google-reviews-daily  sent no credentials at all; the function is now cron-only (service key required).
--   billing-enforcement-daily   carried a shared secret as a literal in cron.job.command (readable by anyone with
--                               database admin access); it now sends the vault service key like marketing-dispatch.
-- Deploy order: apply this migration BEFORE deploying the fetch-google-reviews function, or its next run gets a 401.
-- After this, rotate the old x-billing-key secret (the function still accepts it, see docs/security/OWNER_RUNBOOK.md).
-- Jobs that do not exist (fresh environments) are skipped.

DO $$
DECLARE
  v_job bigint;
BEGIN
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'fetch-google-reviews-daily';
  IF v_job IS NOT NULL THEN
    PERFORM cron.alter_job(
      job_id := v_job,
      command := $cmd$
        select net.http_post(
          url := 'https://ukdsrndqhsatjkmxijuj.supabase.co/functions/v1/fetch-google-reviews',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'apikey', (select btrim(decrypted_secret) from vault.decrypted_secrets where name = 'edge_jobs_service_role_key')
          ),
          body := '{}'::jsonb
        );
      $cmd$
    );
  END IF;

  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'billing-enforcement-daily';
  IF v_job IS NOT NULL THEN
    PERFORM cron.alter_job(
      job_id := v_job,
      command := $cmd$
        select net.http_post(
          url := 'https://ukdsrndqhsatjkmxijuj.supabase.co/functions/v1/billing-enforcement',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (select btrim(decrypted_secret) from vault.decrypted_secrets where name = 'edge_jobs_service_role_key'),
            'apikey', (select btrim(decrypted_secret) from vault.decrypted_secrets where name = 'edge_jobs_service_role_key')
          ),
          body := '{}'::jsonb
        );
      $cmd$
    );
  END IF;
END $$;
