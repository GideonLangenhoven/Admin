-- Schedule marketing-dispatch to run every minute via pg_cron.
-- Calls the Edge Function which processes up to 100 pending queue items per run.

SELECT cron.schedule(
  'marketing-dispatch-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url    := current_setting('app.settings.supabase_url') || '/functions/v1/marketing-dispatch',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body   := '{}'::jsonb
  ) AS request_id;
  $$
);
