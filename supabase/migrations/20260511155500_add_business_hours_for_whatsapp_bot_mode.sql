-- Add the business-hours field consumed by the WhatsApp bot mode toggle.
-- Null means no hours are configured yet; OUTSIDE_HOURS treats that as inside hours.
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS business_hours jsonb;

COMMENT ON COLUMN public.businesses.business_hours IS
  'Weekly business-hours schedule used by WhatsApp OUTSIDE_HOURS bot mode. Null means not configured.';
