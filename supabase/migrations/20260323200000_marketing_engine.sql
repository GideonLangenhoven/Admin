-- Marketing Engine: contacts, templates, campaigns, and sending queue.
-- Provides a MailerLite-style bulk email system per business.

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
  source      text DEFAULT 'manual',  -- manual, booking_sync, import
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
  audience_filter jsonb DEFAULT '{}'::jsonb,  -- e.g. {"status":"active","tags":["kayak"]}
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
  email         text NOT NULL,       -- denormalised for fast dispatch (no join needed)
  first_name    text,                -- denormalised for template variable replacement
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
-- 6. Storage bucket for marketing assets (images, logos, etc.)
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
