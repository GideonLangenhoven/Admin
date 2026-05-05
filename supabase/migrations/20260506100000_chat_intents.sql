BEGIN;

DO $$ BEGIN CREATE TYPE chat_intent AS ENUM (
  'BOOKING_QUESTION', 'BOOKING_MODIFY', 'REFUND_REQUEST', 'WEATHER_CONCERN',
  'LOGISTICS', 'COMPLAINT', 'MARKETING_OPTOUT', 'OTHER'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Message-level intent classification
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS intent text,
  ADD COLUMN IF NOT EXISTS intent_confidence numeric(3,2),
  ADD COLUMN IF NOT EXISTS auto_replied boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS classification_model text,
  ADD COLUMN IF NOT EXISTS classification_ms int,
  ADD COLUMN IF NOT EXISTS sender_type text;

-- Conversation-level: dominant intent for routing
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS current_intent text,
  ADD COLUMN IF NOT EXISTS priority text DEFAULT 'NORMAL',
  ADD COLUMN IF NOT EXISTS last_classified_at timestamptz;

DO $$ BEGIN
  ALTER TABLE conversations
    ADD CONSTRAINT conversations_priority_check
    CHECK (priority IN ('LOW','NORMAL','HIGH'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_priority_intent
  ON conversations(business_id, priority, current_intent)
  WHERE status IN ('HUMAN', 'AGENT_PENDING');

-- Tenant FAQ bank for auto-replies
CREATE TABLE IF NOT EXISTS chat_faq_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  intent          text NOT NULL,
  question_pattern text NOT NULL,
  match_keywords  text[] NOT NULL,
  answer          text NOT NULL,
  enabled         boolean NOT NULL DEFAULT true,
  use_count       int NOT NULL DEFAULT 0,
  last_used_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_faq_business_intent ON chat_faq_entries(business_id, intent) WHERE enabled = true;

ALTER TABLE chat_faq_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS faq_tenant_rw ON chat_faq_entries;
CREATE POLICY faq_tenant_rw ON chat_faq_entries FOR ALL TO authenticated
  USING (business_id IN (
    SELECT au.business_id FROM admin_users au WHERE au.user_id = auth.uid() AND NOT au.suspended
  ))
  WITH CHECK (business_id IN (
    SELECT au.business_id FROM admin_users au WHERE au.user_id = auth.uid() AND NOT au.suspended
  ));

DROP POLICY IF EXISTS faq_service ON chat_faq_entries;
CREATE POLICY faq_service ON chat_faq_entries FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Reporting view
CREATE OR REPLACE VIEW chat_intent_daily AS
SELECT
  business_id,
  date_trunc('day', created_at)::date AS day,
  intent,
  count(*) AS message_count,
  count(*) FILTER (WHERE auto_replied) AS auto_replied_count,
  avg(intent_confidence)::numeric(3,2) AS avg_confidence
FROM chat_messages
WHERE intent IS NOT NULL AND direction = 'IN'
GROUP BY 1, 2, 3;

GRANT SELECT ON chat_intent_daily TO authenticated, service_role;

COMMIT;
