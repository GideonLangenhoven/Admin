-- Ensure payment_deadline column exists on bookings (idempotent)
-- The column was originally added in 20260306100000_add_payment_deadline.sql
-- This migration is a no-op safety net.
ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS payment_deadline timestamptz;

-- Ensure index exists for efficient auto-cancel queries
CREATE INDEX IF NOT EXISTS idx_bookings_payment_deadline
ON public.bookings (payment_deadline)
WHERE status IN ('PENDING', 'PENDING PAYMENT', 'HELD')
  AND payment_deadline IS NOT NULL;
