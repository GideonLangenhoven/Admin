-- Add attendance tracking columns to bookings
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS checked_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz;

-- Index for attendance reports
CREATE INDEX IF NOT EXISTS idx_bookings_checked_in
  ON public.bookings (checked_in, slot_id)
  WHERE checked_in = true;
