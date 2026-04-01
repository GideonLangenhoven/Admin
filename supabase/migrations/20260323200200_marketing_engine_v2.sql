-- Marketing Engine v2: engagement tracking, unsubscribe tokens, bounce handling,
-- retry logic, contact lifecycle, and campaign analytics columns.

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

-- Allow paused status
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

-- Update partial index for dispatch: pick pending items that are ready for retry
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
  metadata    jsonb DEFAULT '{}'::jsonb,  -- clicked_url, user_agent, bounce_reason, etc.
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
