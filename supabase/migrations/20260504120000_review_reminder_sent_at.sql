-- Add reminder_sent_at to reviews for 7-day review reminder nudge
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

-- Partial index: only PENDING reviews without a reminder (the query filter for the nudge)
CREATE INDEX IF NOT EXISTS idx_reviews_pending_no_reminder
  ON public.reviews (business_id, created_at)
  WHERE status = 'PENDING' AND reminder_sent_at IS NULL;

-- Dedicated daily cron at 09:23 UTC (11:23 SAST) for review reminder nudges
SELECT cron.schedule(
  'review-reminders-daily',
  '23 9 * * *',
  $$
  SELECT net.http_post(
    url     := current_setting('app.settings.supabase_url') || '/functions/v1/auto-messages',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type',  'application/json'
    ),
    body    := '{"action":"review_reminders"}'::jsonb,
    timeout_milliseconds := 30000
  ) AS request_id;
  $$
);
