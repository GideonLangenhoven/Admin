-- Add is_manually_overridden flag to slots table
-- Slots with this flag set to true are skipped by peak pricing apply/remove operations
ALTER TABLE slots ADD COLUMN IF NOT EXISTS is_manually_overridden boolean DEFAULT false;

-- Fix check_loyalty RPC to only count COMPLETED and PAID bookings
-- Previously it counted all bookings regardless of status, allowing exploitation
CREATE OR REPLACE FUNCTION check_loyalty(p_phone text, p_business_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COUNT(*)::integer
  FROM bookings
  WHERE phone = p_phone
    AND business_id = p_business_id
    AND status IN ('COMPLETED', 'PAID');
$$;
