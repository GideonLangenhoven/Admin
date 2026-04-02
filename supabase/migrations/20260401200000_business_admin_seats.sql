-- Add max_admin_seats directly to businesses table
-- Super admin can set this per business, replacing the plan-based seat limit
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS max_admin_seats INTEGER NOT NULL DEFAULT 3;
