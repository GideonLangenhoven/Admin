-- Add unique constraints needed for idempotent upserts in auto-messages and confirm-booking

-- Prevents duplicate auto-messages (reminders, waivers, reviews) per booking
CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_messages_booking_type
  ON auto_messages (booking_id, type);

-- Prevents duplicate booking confirmation notifications
CREATE UNIQUE INDEX IF NOT EXISTS uq_logs_booking_event
  ON logs (booking_id, event)
  WHERE booking_id IS NOT NULL;

-- Add processing status to marketing_queue for dispatch locking
-- (no schema change needed — status column already exists as text)
