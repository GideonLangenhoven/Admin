-- Capture explicit Terms acceptance at booking time (POPIA / consumer-protection
-- audit trail). NULL = legacy/not captured; a timestamp = the moment the customer
-- ticked "I accept the Terms" on the booking form.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN public.bookings.terms_accepted_at IS 'When the customer explicitly accepted the Terms on the booking form. NULL = legacy/not captured.';
