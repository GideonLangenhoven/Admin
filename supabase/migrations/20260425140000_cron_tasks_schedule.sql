-- Schedule the cron-tasks edge function via pg_cron.
--
-- cron-tasks handles:
--   • Hold expiry / cleanup (with 5-min grace, skips paid bookings)
--   • Manual-booking deadline expiry
--   • Abandoned voucher cleanup
--   • Auto-tag marketing contacts
--   • Reminder dispatch (delegates to auto-messages)
--
-- Until this migration ran, those tasks were only triggered via the
-- Supabase dashboard's Function Scheduler (operator-managed). This
-- migration moves the schedule into version control so any environment
-- gets it automatically.
--
-- Frequency: every 5 minutes. Hold cleanup runs with a 5-min grace
-- window inside the function, so 5-min cadence is safe — any expired
-- hold is freed within ~10 min worst case (5 grace + up to 5 wait).

-- Idempotent: drop any prior schedule with the same name before adding.
SELECT cron.unschedule('cron-tasks-every-5-minutes')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cron-tasks-every-5-minutes');

SELECT cron.schedule(
  'cron-tasks-every-5-minutes',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.settings.supabase_url') || '/functions/v1/cron-tasks',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) AS request_id;
  $$
);
