-- Add confirmation_sent_at column to bookings table.
-- Used as an atomic lock to prevent duplicate WhatsApp/email sends
-- when Yoco sends multiple concurrent webhook retries.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamptz;
