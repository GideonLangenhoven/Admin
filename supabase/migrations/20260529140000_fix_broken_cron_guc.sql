-- F6 fix: six pg_cron jobs invoked their Edge Functions via
--   current_setting('app.settings.supabase_url') / current_setting('app.settings.service_role_key')
-- but those GUCs were never set in this project. current_setting() throws
--   ERROR: unrecognized configuration parameter "app.settings.supabase_url"
-- before the HTTP request is even built, so the functions were NEVER invoked
-- (cron-tasks alone failed 9,800+ consecutive times). Affected:
--   cron-tasks (holds cleanup, booking expiry, voucher cleanup, reminder dispatch),
--   fetch-google-reviews, auto-messages (review/waiver reminders),
--   viator/getyourguide availability sync, ota-reconcile.
--
-- The already-working marketing crons use a literal project URL and no
-- Authorization header (the target functions are verify_jwt=false, so no JWT is
-- required). We match that proven pattern. We deliberately do NOT store the
-- service_role key as a DB GUC: project policy keeps that key in edge-function
-- env vars only, and verify_jwt=false means it is not needed here.
--
-- cron.schedule() upserts by job name, so re-scheduling replaces the command.

SELECT cron.schedule('cron-tasks-every-5-minutes', '*/5 * * * *', $$
  SELECT net.http_post(
    url := 'https://ukdsrndqhsatjkmxijuj.supabase.co/functions/v1/cron-tasks',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$$);

SELECT cron.schedule('fetch-google-reviews-daily', '17 3 * * *', $$
  SELECT net.http_post(
    url := 'https://ukdsrndqhsatjkmxijuj.supabase.co/functions/v1/fetch-google-reviews',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$$);

SELECT cron.schedule('review-reminders-daily', '23 9 * * *', $$
  SELECT net.http_post(
    url := 'https://ukdsrndqhsatjkmxijuj.supabase.co/functions/v1/auto-messages',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$$);

SELECT cron.schedule('viator-availability-hourly', '7 * * * *', $$
  SELECT net.http_post(
    url := 'https://ukdsrndqhsatjkmxijuj.supabase.co/functions/v1/viator-availability-sync',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$$);

SELECT cron.schedule('gyg-availability-hourly', '12 * * * *', $$
  SELECT net.http_post(
    url := 'https://ukdsrndqhsatjkmxijuj.supabase.co/functions/v1/getyourguide-availability-sync',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$$);

SELECT cron.schedule('ota-reconcile-nightly', '37 2 * * *', $$
  SELECT net.http_post(
    url := 'https://ukdsrndqhsatjkmxijuj.supabase.co/functions/v1/ota-reconcile',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
$$);
