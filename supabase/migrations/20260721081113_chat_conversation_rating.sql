ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS rating     smallint,
  ADD COLUMN IF NOT EXISTS rating_at  timestamptz,
  ADD COLUMN IF NOT EXISTS handled_by text;

DO $$ BEGIN
  ALTER TABLE public.conversations
    ADD CONSTRAINT conversations_rating_range CHECK (rating IS NULL OR rating BETWEEN 1 AND 5);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_rating
  ON public.conversations (rating_at DESC) WHERE rating IS NOT NULL;;
