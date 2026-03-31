-- Add what_to_bring and what_to_wear columns to businesses table.
-- These are used by the booking site to show guest preparation info.
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS what_to_bring text,
  ADD COLUMN IF NOT EXISTS what_to_wear text;
