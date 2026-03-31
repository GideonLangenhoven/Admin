-- Add subscription_status to businesses table to enforce billing compliance.
-- Values: ACTIVE (default), PAST_DUE, SUSPENDED
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'ACTIVE';

-- Add local_departure_time to slots for DST-safe slot generation.
-- Stores the intended local departure time (e.g. '2026-04-15T08:00') so that
-- UTC offsets can be recalculated near DST boundaries.
ALTER TABLE public.slots
  ADD COLUMN IF NOT EXISTS local_departure_time text;

-- Add suspended flag to admin_users for seat-limit downgrades.
ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS suspended boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.businesses.subscription_status IS 'ACTIVE | PAST_DUE | SUSPENDED — checked by AuthGate to block access when SUSPENDED';
COMMENT ON COLUMN public.slots.local_departure_time IS 'Local date+time (no timezone) for DST-safe recalculation of start_time UTC';
COMMENT ON COLUMN public.admin_users.suspended IS 'Set true when a plan downgrade exceeds the seat limit; blocks login';
