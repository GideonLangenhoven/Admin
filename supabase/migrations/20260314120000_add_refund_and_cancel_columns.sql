-- Add refund and cancellation tracking columns to bookings
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS yoco_checkout_id   text,
  ADD COLUMN IF NOT EXISTS refund_status       text,
  ADD COLUMN IF NOT EXISTS refund_amount       numeric,
  ADD COLUMN IF NOT EXISTS refund_notes        text,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at        timestamptz;

-- Add discount override columns to bookings (used by new-booking manual price override)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS discount_type    text,
  ADD COLUMN IF NOT EXISTS discount_percent numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS original_total   numeric,
  ADD COLUMN IF NOT EXISTS discount_notes   text;

-- Add booking_id to auto_messages if it doesn't exist yet
ALTER TABLE public.auto_messages
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL;

-- Index for efficient booking-level message lookups
CREATE INDEX IF NOT EXISTS idx_auto_messages_booking_id
  ON public.auto_messages (booking_id)
  WHERE booking_id IS NOT NULL;
