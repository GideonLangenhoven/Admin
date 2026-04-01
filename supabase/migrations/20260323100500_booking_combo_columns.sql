-- Add combo-related columns to bookings table
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS is_combo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS combo_booking_id uuid REFERENCES public.combo_bookings(id),
  ADD COLUMN IF NOT EXISTS payment_method text;

CREATE INDEX IF NOT EXISTS idx_bookings_combo_booking ON public.bookings (combo_booking_id) WHERE combo_booking_id IS NOT NULL;
