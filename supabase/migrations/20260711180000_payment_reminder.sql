-- Payment Reminder feature.
-- A friendly pre-trip nudge for bookings that are happening soon but still unpaid:
-- messages the customer (WhatsApp + email) with their payment link and warns the
-- booking will be auto-cancelled a configurable number of hours before the trip
-- if payment isn't made. Admin can override per booking to let it proceed unpaid.
--
-- Per-booking override column:
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS allow_unpaid boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.bookings.allow_unpaid IS
  'Admin override: let this booking proceed without payment — the payment-reminder flow skips both the reminder and the auto-cancel for it.';

-- Tunable timing lives in businesses.automation_config (jsonb, no schema change):
--   payment_reminder_enabled       boolean  default true
--   payment_reminder_cancel_hours  integer  default 12   (hours before the trip to auto-cancel unpaid bookings)
-- Idempotency reuses the existing auto_messages (booking_id, type) unique key with
-- new types 'PAYMENT_REMINDER' and 'PAYMENT_CANCEL'.
