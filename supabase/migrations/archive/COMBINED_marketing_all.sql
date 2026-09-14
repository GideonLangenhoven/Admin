-- =========================================================================
-- COMBINED MARKETING ENGINE MIGRATIONS
-- Run this entire script in Supabase SQL Editor (Dashboard → SQL Editor)
-- Order: 8 migrations combined sequentially
-- =========================================================================

-- =========================================================================
-- MIGRATION 1: 20260323200000_marketing_engine.sql
-- Core tables: contacts, templates, campaigns, queue, storage bucket
-- =========================================================================

---------------------------------------------------------------------------
-- 1. marketing_contacts
---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  email       text NOT NULL,
  first_name  text,
  last_name   text,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unsubscribed')),
  source      text DEFAULT 'manual',
  tags        text[] DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT unique_contact_per_business UNIQUE (business_id, email)
);

CREATE INDEX IF NOT EXISTS idx_marketing_contacts_business ON public.marketing_contacts (business_id);
CREATE INDEX IF NOT EXISTS idx_marketing_contacts_status   ON public.marketing_contacts (business_id, status);

ALTER TABLE public.marketing_contacts ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.marketing_contacts TO service_role;

CREATE POLICY marketing_contacts_service
  ON public.marketing_contacts FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY marketing_contacts_select_own
  ON public.marketing_contacts FOR SELECT
  USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

CREATE POLICY marketing_contacts_insert_own
  ON public.marketing_contacts FOR INSERT
  WITH CHECK (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

CREATE POLICY marketing_contacts_update_own
  ON public.marketing_contacts FOR UPDATE
  USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

CREATE POLICY marketing_contacts_delete_own
  ON public.marketing_contacts FOR DELETE
  USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));


---------------------------------------------------------------------------
-- 2. marketing_templates
---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name          text NOT NULL,
  category      text DEFAULT 'general',
  subject_line  text NOT NULL DEFAULT '',
  html_content  text NOT NULL DEFAULT '',
  editor_json   jsonb DEFAULT '[]'::jsonb,
  thumbnail_url text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_templates_business ON public.marketing_templates (business_id);

ALTER TABLE public.marketing_templates ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.marketing_templates TO service_role;

CREATE POLICY marketing_templates_service
  ON public.marketing_templates FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY marketing_templates_select_own
  ON public.marketing_templates FOR SELECT
  USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

CREATE POLICY marketing_templates_insert_own
  ON public.marketing_templates FOR INSERT
  WITH CHECK (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

CREATE POLICY marketing_templates_update_own
  ON public.marketing_templates FOR UPDATE
  USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

CREATE POLICY marketing_templates_delete_own
  ON public.marketing_templates FOR DELETE
  USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));


---------------------------------------------------------------------------
-- 3. marketing_campaigns
---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_campaigns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  template_id   uuid REFERENCES public.marketing_templates(id) ON DELETE SET NULL,
  name          text NOT NULL,
  subject_line  text NOT NULL DEFAULT '',
  audience_filter jsonb DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'sending', 'done', 'cancelled')),
  total_recipients int DEFAULT 0,
  total_sent       int DEFAULT 0,
  total_failed     int DEFAULT 0,
  scheduled_at  timestamptz,
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_business ON public.marketing_campaigns (business_id);
CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_status   ON public.marketing_campaigns (status);

ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.marketing_campaigns TO service_role;

CREATE POLICY marketing_campaigns_service
  ON public.marketing_campaigns FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY marketing_campaigns_select_own
  ON public.marketing_campaigns FOR SELECT
  USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

CREATE POLICY marketing_campaigns_insert_own
  ON public.marketing_campaigns FOR INSERT
  WITH CHECK (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

CREATE POLICY marketing_campaigns_update_own
  ON public.marketing_campaigns FOR UPDATE
  USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));


---------------------------------------------------------------------------
-- 4. marketing_queue
---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_queue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  campaign_id   uuid NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  contact_id    uuid NOT NULL REFERENCES public.marketing_contacts(id) ON DELETE CASCADE,
  email         text NOT NULL,
  first_name    text,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error_message text,
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_queue_dispatch
  ON public.marketing_queue (status, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_marketing_queue_campaign ON public.marketing_queue (campaign_id);
CREATE INDEX IF NOT EXISTS idx_marketing_queue_business ON public.marketing_queue (business_id);

ALTER TABLE public.marketing_queue ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.marketing_queue TO service_role;

CREATE POLICY marketing_queue_service
  ON public.marketing_queue FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY marketing_queue_select_own
  ON public.marketing_queue FOR SELECT
  USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));


---------------------------------------------------------------------------
-- 5. Billing: add marketing_email_usage to businesses
---------------------------------------------------------------------------
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS marketing_email_usage int NOT NULL DEFAULT 0;


---------------------------------------------------------------------------
-- 6. Storage bucket for marketing assets
---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('marketing-assets', 'marketing-assets', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY marketing_assets_select
  ON storage.objects FOR SELECT
  USING (bucket_id = 'marketing-assets');

CREATE POLICY marketing_assets_insert
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'marketing-assets'
    AND auth.role() IN ('authenticated', 'service_role')
  );

CREATE POLICY marketing_assets_delete
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'marketing-assets'
    AND auth.role() IN ('authenticated', 'service_role')
  );


-- =========================================================================
-- MIGRATION 2: 20260323200100_marketing_dispatch_cron.sql
-- Schedule marketing-dispatch to run every minute via pg_cron
-- =========================================================================

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


-- =========================================================================
-- MIGRATION 3: 20260323200200_marketing_engine_v2.sql
-- Engagement tracking, unsubscribe tokens, bounce handling, analytics
-- =========================================================================

---------------------------------------------------------------------------
-- 1. Expand marketing_contacts with engagement + bounce fields
---------------------------------------------------------------------------
ALTER TABLE public.marketing_contacts
  ADD COLUMN IF NOT EXISTS bounce_status  text CHECK (bounce_status IN ('hard', 'soft', 'complaint')),
  ADD COLUMN IF NOT EXISTS bounced_at     timestamptz,
  ADD COLUMN IF NOT EXISTS total_received int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_opens    int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_clicks   int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_open_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_click_at  timestamptz,
  ADD COLUMN IF NOT EXISTS notes          text;

-- Allow bounced status
ALTER TABLE public.marketing_contacts DROP CONSTRAINT IF EXISTS marketing_contacts_status_check;
ALTER TABLE public.marketing_contacts ADD CONSTRAINT marketing_contacts_status_check
  CHECK (status IN ('active', 'unsubscribed', 'bounced'));

---------------------------------------------------------------------------
-- 2. Expand marketing_campaigns with analytics columns
---------------------------------------------------------------------------
ALTER TABLE public.marketing_campaigns
  ADD COLUMN IF NOT EXISTS total_opens        int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_clicks       int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_unsubscribes int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_bounces      int NOT NULL DEFAULT 0;

-- Allow scheduled + paused status
ALTER TABLE public.marketing_campaigns DROP CONSTRAINT IF EXISTS marketing_campaigns_status_check;
ALTER TABLE public.marketing_campaigns ADD CONSTRAINT marketing_campaigns_status_check
  CHECK (status IN ('draft', 'scheduled', 'pending', 'sending', 'paused', 'done', 'cancelled'));

---------------------------------------------------------------------------
-- 3. Expand marketing_queue with retry + tracking fields
---------------------------------------------------------------------------
ALTER TABLE public.marketing_queue
  ADD COLUMN IF NOT EXISTS resend_email_id text,
  ADD COLUMN IF NOT EXISTS retry_count     int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at   timestamptz;

-- Update partial index for dispatch
DROP INDEX IF EXISTS idx_marketing_queue_dispatch;
CREATE INDEX idx_marketing_queue_dispatch
  ON public.marketing_queue (status, created_at)
  WHERE status = 'pending';

-- Unique constraint to prevent duplicate queue entries per campaign+contact
ALTER TABLE public.marketing_queue
  ADD CONSTRAINT unique_queue_per_campaign_contact UNIQUE (campaign_id, contact_id);

---------------------------------------------------------------------------
-- 4. marketing_events — open/click/unsubscribe/bounce tracking
---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.marketing_campaigns(id) ON DELETE SET NULL,
  contact_id  uuid REFERENCES public.marketing_contacts(id) ON DELETE SET NULL,
  queue_id    uuid REFERENCES public.marketing_queue(id) ON DELETE SET NULL,
  event_type  text NOT NULL CHECK (event_type IN ('open', 'click', 'unsubscribe', 'bounce', 'complaint')),
  metadata    jsonb DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_events_campaign ON public.marketing_events (campaign_id, event_type);
CREATE INDEX IF NOT EXISTS idx_marketing_events_contact  ON public.marketing_events (contact_id);
CREATE INDEX IF NOT EXISTS idx_marketing_events_business ON public.marketing_events (business_id, created_at);

ALTER TABLE public.marketing_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.marketing_events TO service_role;

CREATE POLICY marketing_events_service
  ON public.marketing_events FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY marketing_events_select_own
  ON public.marketing_events FOR SELECT
  USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));


---------------------------------------------------------------------------
-- 5. marketing_unsubscribe_tokens — signed tokens for one-click unsubscribe
---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_unsubscribe_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.marketing_campaigns(id) ON DELETE SET NULL,
  contact_id  uuid NOT NULL REFERENCES public.marketing_contacts(id) ON DELETE CASCADE,
  token       text UNIQUE NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_unsub_tokens_token ON public.marketing_unsubscribe_tokens (token);

ALTER TABLE public.marketing_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.marketing_unsubscribe_tokens TO service_role;

CREATE POLICY unsub_tokens_service
  ON public.marketing_unsubscribe_tokens FOR ALL
  USING (auth.role() = 'service_role');


-- =========================================================================
-- MIGRATION 4: 20260323200300_marketing_engine_v3_fixes.sql
-- Phone column, RLS policies, atomic counter RPCs, storage policy fix
-- =========================================================================

---------------------------------------------------------------------------
-- 1. Add phone column to marketing_contacts
---------------------------------------------------------------------------
ALTER TABLE public.marketing_contacts ADD COLUMN IF NOT EXISTS phone text;

---------------------------------------------------------------------------
-- 2. Add missing INSERT/UPDATE RLS policies on marketing_queue
---------------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'marketing_queue_insert_own' AND tablename = 'marketing_queue') THEN
    CREATE POLICY marketing_queue_insert_own
      ON public.marketing_queue FOR INSERT
      WITH CHECK (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'marketing_queue_update_own' AND tablename = 'marketing_queue') THEN
    CREATE POLICY marketing_queue_update_own
      ON public.marketing_queue FOR UPDATE
      USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));
  END IF;
END $$;

---------------------------------------------------------------------------
-- 3. Atomic counter increment RPCs to prevent race conditions
---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_campaign_counter(
  p_campaign_id uuid,
  p_column text,
  p_amount int DEFAULT 1
) RETURNS void AS $$
BEGIN
  IF p_column NOT IN ('total_sent', 'total_failed', 'total_opens', 'total_clicks', 'total_unsubscribes', 'total_bounces') THEN
    RAISE EXCEPTION 'Invalid column name: %', p_column;
  END IF;
  EXECUTE format(
    'UPDATE public.marketing_campaigns SET %I = COALESCE(%I, 0) + $1 WHERE id = $2',
    p_column, p_column
  ) USING p_amount, p_campaign_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.increment_campaign_counter TO service_role;

CREATE OR REPLACE FUNCTION public.increment_contact_counter(
  p_contact_id uuid,
  p_column text,
  p_amount int DEFAULT 1
) RETURNS void AS $$
BEGIN
  IF p_column NOT IN ('total_received', 'total_opens', 'total_clicks') THEN
    RAISE EXCEPTION 'Invalid column name: %', p_column;
  END IF;
  EXECUTE format(
    'UPDATE public.marketing_contacts SET %I = COALESCE(%I, 0) + $1 WHERE id = $2',
    p_column, p_column
  ) USING p_amount, p_contact_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.increment_contact_counter TO service_role;

---------------------------------------------------------------------------
-- 4. Fix storage policy to scope by business_id path
---------------------------------------------------------------------------
DROP POLICY IF EXISTS marketing_assets_insert ON storage.objects;
DROP POLICY IF EXISTS marketing_assets_delete ON storage.objects;

CREATE POLICY marketing_assets_insert
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'marketing-assets'
    AND (
      auth.role() = 'service_role'
      OR (
        auth.role() = 'authenticated'
        AND (storage.foldername(name))[1] IN (
          SELECT au.business_id::text FROM public.admin_users au WHERE au.id = auth.uid()
        )
      )
    )
  );

CREATE POLICY marketing_assets_delete
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'marketing-assets'
    AND (
      auth.role() = 'service_role'
      OR (
        auth.role() = 'authenticated'
        AND (storage.foldername(name))[1] IN (
          SELECT au.business_id::text FROM public.admin_users au WHERE au.id = auth.uid()
        )
      )
    )
  );


-- =========================================================================
-- MIGRATION 5: 20260324100000_marketing_billing.sql
-- Usage tracking, included allowances, overage rates
-- =========================================================================

-- 1. Add billing columns to businesses table
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS marketing_included_emails int NOT NULL DEFAULT 500;
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS marketing_overage_rate_zar numeric(10,2) NOT NULL DEFAULT 0.15;

-- 2. Monthly usage tracking table
CREATE TABLE IF NOT EXISTS public.marketing_usage_monthly (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  period text NOT NULL,
  emails_sent int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_id, period)
);

ALTER TABLE public.marketing_usage_monthly ENABLE ROW LEVEL SECURITY;

CREATE POLICY marketing_usage_monthly_service ON public.marketing_usage_monthly
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY marketing_usage_monthly_read_own ON public.marketing_usage_monthly
  FOR SELECT USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

-- 3. Atomic increment RPC for monthly usage
CREATE OR REPLACE FUNCTION public.increment_marketing_monthly_usage(
  p_business_id uuid,
  p_period text,
  p_amount int DEFAULT 1
) RETURNS void AS $$
BEGIN
  INSERT INTO public.marketing_usage_monthly (business_id, period, emails_sent)
  VALUES (p_business_id, p_period, p_amount)
  ON CONFLICT (business_id, period)
  DO UPDATE SET emails_sent = public.marketing_usage_monthly.emails_sent + p_amount,
                updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.increment_marketing_monthly_usage TO service_role;

-- 4. Atomic increment for businesses.marketing_email_usage
CREATE OR REPLACE FUNCTION public.increment_marketing_email_usage(
  p_business_id uuid,
  p_amount int DEFAULT 1
) RETURNS void AS $$
BEGIN
  UPDATE public.businesses
  SET marketing_email_usage = COALESCE(marketing_email_usage, 0) + p_amount
  WHERE id = p_business_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.increment_marketing_email_usage TO service_role;


-- =========================================================================
-- MIGRATION 6: 20260324100100_marketing_contact_inactive.sql
-- List Cleaning: add 'inactive' status and last_email_at tracking
-- =========================================================================

-- 1. Expand status CHECK to include 'inactive'
ALTER TABLE public.marketing_contacts DROP CONSTRAINT IF EXISTS marketing_contacts_status_check;
ALTER TABLE public.marketing_contacts ADD CONSTRAINT marketing_contacts_status_check
  CHECK (status IN ('active', 'unsubscribed', 'bounced', 'inactive'));

-- 2. Add last_email_at for tracking when we last sent to a contact
ALTER TABLE public.marketing_contacts ADD COLUMN IF NOT EXISTS last_email_at timestamptz;


-- =========================================================================
-- MIGRATION 7: 20260324100200_marketing_automations.sql
-- Automations: triggers, sequences, enrollments, logs
-- =========================================================================

---------------------------------------------------------------------------
-- 1. Automations table
---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  trigger_type text NOT NULL CHECK (trigger_type IN ('contact_added', 'tag_added', 'post_booking', 'date_field', 'manual')),
  trigger_config jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  enrolled_count int NOT NULL DEFAULT 0,
  completed_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketing_automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY marketing_automations_service ON public.marketing_automations
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY marketing_automations_select_own ON public.marketing_automations
  FOR SELECT USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

CREATE POLICY marketing_automations_insert_own ON public.marketing_automations
  FOR INSERT WITH CHECK (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

CREATE POLICY marketing_automations_update_own ON public.marketing_automations
  FOR UPDATE USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

CREATE POLICY marketing_automations_delete_own ON public.marketing_automations
  FOR DELETE USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

---------------------------------------------------------------------------
-- 2. Automation steps
---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_automation_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL REFERENCES public.marketing_automations(id) ON DELETE CASCADE,
  position int NOT NULL,
  step_type text NOT NULL CHECK (step_type IN ('send_email', 'delay', 'condition', 'generate_voucher')),
  config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketing_automation_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY marketing_automation_steps_service ON public.marketing_automation_steps
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY marketing_automation_steps_select_own ON public.marketing_automation_steps
  FOR SELECT USING (automation_id IN (
    SELECT id FROM public.marketing_automations WHERE business_id IN (
      SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()
    )
  ));

CREATE POLICY marketing_automation_steps_insert_own ON public.marketing_automation_steps
  FOR INSERT WITH CHECK (automation_id IN (
    SELECT id FROM public.marketing_automations WHERE business_id IN (
      SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()
    )
  ));

CREATE POLICY marketing_automation_steps_update_own ON public.marketing_automation_steps
  FOR UPDATE USING (automation_id IN (
    SELECT id FROM public.marketing_automations WHERE business_id IN (
      SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()
    )
  ));

CREATE POLICY marketing_automation_steps_delete_own ON public.marketing_automation_steps
  FOR DELETE USING (automation_id IN (
    SELECT id FROM public.marketing_automations WHERE business_id IN (
      SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()
    )
  ));

---------------------------------------------------------------------------
-- 3. Automation enrollments
---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_automation_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL REFERENCES public.marketing_automations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.marketing_contacts(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  current_step int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'exited', 'paused')),
  next_action_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(automation_id, contact_id)
);

ALTER TABLE public.marketing_automation_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY marketing_automation_enrollments_service ON public.marketing_automation_enrollments
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY marketing_automation_enrollments_select_own ON public.marketing_automation_enrollments
  FOR SELECT USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

---------------------------------------------------------------------------
-- 4. Automation logs
---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_automation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid REFERENCES public.marketing_automation_enrollments(id) ON DELETE SET NULL,
  automation_id uuid NOT NULL REFERENCES public.marketing_automations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.marketing_contacts(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  step_position int,
  step_type text,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketing_automation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY marketing_automation_logs_service ON public.marketing_automation_logs
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY marketing_automation_logs_select_own ON public.marketing_automation_logs
  FOR SELECT USING (business_id IN (SELECT au.business_id FROM public.admin_users au WHERE au.id = auth.uid()));

---------------------------------------------------------------------------
-- 5. Atomic counter RPC for automations
---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_automation_counter(
  p_automation_id uuid,
  p_column text,
  p_amount int DEFAULT 1
) RETURNS void AS $$
BEGIN
  IF p_column NOT IN ('enrolled_count', 'completed_count') THEN
    RAISE EXCEPTION 'Invalid column name: %', p_column;
  END IF;
  EXECUTE format(
    'UPDATE public.marketing_automations SET %I = COALESCE(%I, 0) + $1 WHERE id = $2',
    p_column, p_column
  ) USING p_amount, p_automation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.increment_automation_counter TO service_role;

---------------------------------------------------------------------------
-- 6. Indexes for performance
---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_marketing_automations_business ON public.marketing_automations(business_id);
CREATE INDEX IF NOT EXISTS idx_marketing_automation_steps_automation ON public.marketing_automation_steps(automation_id, position);
CREATE INDEX IF NOT EXISTS idx_marketing_automation_enrollments_next ON public.marketing_automation_enrollments(status, next_action_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_marketing_automation_enrollments_automation ON public.marketing_automation_enrollments(automation_id);
CREATE INDEX IF NOT EXISTS idx_marketing_automation_logs_enrollment ON public.marketing_automation_logs(enrollment_id);


-- =========================================================================
-- MIGRATION 8: 20260324100300_marketing_date_fields.sql
-- Date fields for contacts: birthday/anniversary triggers
-- =========================================================================

-- 1. Add date fields to marketing_contacts
ALTER TABLE public.marketing_contacts ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE public.marketing_contacts ADD COLUMN IF NOT EXISTS anniversary_date date;

-- 2. Indexes for date-based trigger queries (month+day matching)
CREATE INDEX IF NOT EXISTS idx_marketing_contacts_dob
  ON public.marketing_contacts (business_id, date_of_birth)
  WHERE date_of_birth IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketing_contacts_anniversary
  ON public.marketing_contacts (business_id, anniversary_date)
  WHERE anniversary_date IS NOT NULL;


-- =========================================================================
-- DONE! All 8 marketing migrations applied.
-- Tables created: marketing_contacts, marketing_templates, marketing_campaigns,
--   marketing_queue, marketing_events, marketing_unsubscribe_tokens,
--   marketing_usage_monthly, marketing_automations, marketing_automation_steps,
--   marketing_automation_enrollments, marketing_automation_logs
-- RPCs created: increment_campaign_counter, increment_contact_counter,
--   increment_marketing_monthly_usage, increment_marketing_email_usage,
--   increment_automation_counter
-- Storage bucket: marketing-assets
-- =========================================================================
