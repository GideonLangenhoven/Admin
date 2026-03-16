-- Add payment_deadline column for auto-cancel of unpaid bookings
ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS payment_deadline timestamptz;

-- Partial index for efficient auto-cancel queries
CREATE INDEX IF NOT EXISTS idx_bookings_payment_deadline
ON public.bookings (payment_deadline)
WHERE status IN ('PENDING', 'PENDING PAYMENT', 'HELD')
  AND payment_deadline IS NOT NULL;
