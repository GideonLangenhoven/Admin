-- Add refund_error column to bookings to store Yoco/refund failure messages
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_error text;
