-- Prompt 24: Delete legacy cron jobs that call now-dead single-tenant functions.
--
-- jobid 7  (queue-reminders)        → called reminder-scheduler every 10 min
--            Superseded by cron-tasks → auto-messages chain.
-- jobid 8  (send-outbox)            → called outbox-send every 2 min
--            Outbox table confirmed EMPTY. No callers remain.
-- jobid 18 (cron-tasks-every-5-min) → called cron-tasks WITHOUT auth headers
--            Duplicate of jobid 21 which includes proper Authorization header.

SELECT cron.unschedule('queue-reminders');
SELECT cron.unschedule('send-outbox');
SELECT cron.unschedule('cron-tasks-every-5-min');
