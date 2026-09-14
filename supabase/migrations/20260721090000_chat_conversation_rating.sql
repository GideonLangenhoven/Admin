-- Chat quality rating: at the end of a web chat the visitor rates 1-5 stars how
-- well it was handled. Stored on the conversation row (one rating per thread —
-- re-rating overwrites, which is fine for review purposes).
-- handled_by records whether a human was ever involved so super-admins can
-- compare bot vs human quality. No new table: conversations is already RLS'd
-- (conversations_tenant_* via current_business_ids()), so SUPER_ADMIN reads all
-- tenants' ratings with a plain query and no baseline change is needed.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS rating     smallint,
  ADD COLUMN IF NOT EXISTS rating_at  timestamptz,
  ADD COLUMN IF NOT EXISTS handled_by text;

DO $$ BEGIN
  ALTER TABLE public.conversations
    ADD CONSTRAINT conversations_rating_range CHECK (rating IS NULL OR rating BETWEEN 1 AND 5);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Super-admin review reads rated rows across all tenants, newest first.
CREATE INDEX IF NOT EXISTS idx_conversations_rating
  ON public.conversations (rating_at DESC) WHERE rating IS NOT NULL;
