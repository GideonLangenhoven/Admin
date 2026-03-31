-- Add total_captured and total_refunded columns to bookings for accurate partial refund math
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS total_captured numeric DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS total_refunded numeric DEFAULT 0;

-- Backfill total_captured from total_amount for existing bookings that have been paid
UPDATE bookings
SET total_captured = COALESCE(total_amount, 0)
WHERE status IN ('PAID', 'CONFIRMED', 'COMPLETED', 'CANCELLED')
  AND total_captured = 0
  AND COALESCE(total_amount, 0) > 0;

-- Backfill total_refunded from refund_amount for bookings already refunded
UPDATE bookings
SET total_refunded = COALESCE(refund_amount, 0)
WHERE refund_status = 'REFUNDED'
  AND total_refunded = 0
  AND COALESCE(refund_amount, 0) > 0;
