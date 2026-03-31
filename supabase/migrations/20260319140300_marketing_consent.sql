-- Add marketing_opt_in column to bookings table
-- NULL = legacy/not asked, true = opted in, false = opted out
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS marketing_opt_in boolean DEFAULT NULL;

COMMENT ON COLUMN public.bookings.marketing_opt_in IS 'Marketing consent: NULL = legacy/not asked, true = opted in, false = opted out via STOP/UNSUBSCRIBE';
