-- A durable claim prevents a repeated guide request from creating a second
-- Drive file after a lost provider or database response. Only the server's
-- service-role client may read or change these records.
BEGIN;
CREATE TABLE public.guide_photo_uploads (
  operation_id uuid PRIMARY KEY,
  -- Preserve reconciliation identifiers even if an operator, slot or staff
  -- account is later removed.
  business_id uuid NOT NULL,
  slot_id uuid NOT NULL,
  actor_admin_id uuid NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('uploading', 'uploaded', 'completed', 'rejected')),
  drive_file_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX guide_photo_uploads_reconcile_idx
  ON public.guide_photo_uploads (created_at)
  WHERE state IN ('uploading', 'uploaded');

ALTER TABLE public.guide_photo_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guide_photo_uploads FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.guide_photo_uploads TO service_role;
COMMIT;
