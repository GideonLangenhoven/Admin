BEGIN;

-- Per-tenant Google Drive folder for guide photo uploads.
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS gdrive_photos_folder_id text,
  ADD COLUMN IF NOT EXISTS gdrive_photos_folder_url text;

-- Track guide check-ins with offline replay idempotency.
CREATE TABLE IF NOT EXISTS public.slot_check_ins (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  booking_id      uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  slot_id         uuid REFERENCES public.slots(id) ON DELETE SET NULL,
  actor_admin_id  uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  checked_in_at   timestamptz NOT NULL DEFAULT now(),
  client_event_id text,
  source          text DEFAULT 'guide-pwa',
  notes           text
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_check_in_client_event
  ON public.slot_check_ins (booking_id, client_event_id) WHERE client_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_check_in_slot
  ON public.slot_check_ins (slot_id, checked_in_at DESC);

ALTER TABLE public.slot_check_ins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS check_ins_admin ON public.slot_check_ins;
CREATE POLICY check_ins_admin ON public.slot_check_ins FOR ALL TO authenticated
  USING (business_id = ANY(current_business_ids()))
  WITH CHECK (business_id = ANY(current_business_ids()));

DROP POLICY IF EXISTS check_ins_service ON public.slot_check_ins;
CREATE POLICY check_ins_service ON public.slot_check_ins FOR ALL TO service_role
  USING (true) WITH CHECK (true);

REVOKE ALL ON public.slot_check_ins FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.slot_check_ins TO authenticated;
GRANT ALL ON public.slot_check_ins TO service_role;

-- trip_photos: ensure gdrive + upload metadata columns exist
ALTER TABLE public.trip_photos
  ADD COLUMN IF NOT EXISTS gdrive_file_id text,
  ADD COLUMN IF NOT EXISTS gdrive_view_url text,
  ADD COLUMN IF NOT EXISTS uploaded_by_admin_id uuid REFERENCES public.admin_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_trip_photos_slot
  ON public.trip_photos (slot_id, uploaded_at DESC);

-- Supabase Storage bucket for trip photos
INSERT INTO storage.buckets (id, name, public) VALUES ('trip-photos', 'trip-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS trip_photos_upload ON storage.objects;
CREATE POLICY trip_photos_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'trip-photos');

DROP POLICY IF EXISTS trip_photos_read ON storage.objects;
CREATE POLICY trip_photos_read ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'trip-photos');

COMMIT;
