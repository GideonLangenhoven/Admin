-- Ensure auto_messages has all expected columns
ALTER TABLE public.auto_messages
  ADD COLUMN IF NOT EXISTS business_id  uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS booking_id   uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS phone        text,
  ADD COLUMN IF NOT EXISTS type         text,
  ADD COLUMN IF NOT EXISTS created_at   timestamptz NOT NULL DEFAULT timezone('utc', now());

-- Index for fast booking-level lookups (safe if already exists)
CREATE INDEX IF NOT EXISTS idx_auto_messages_booking_id
  ON public.auto_messages (booking_id)
  WHERE booking_id IS NOT NULL;
