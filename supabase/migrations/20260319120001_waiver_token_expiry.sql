-- Add waiver token expiry column to bookings
-- Tokens expire after 7 days by default; admin users bypass this check in the Edge Function.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS waiver_token_expires_at timestamptz;

-- Backfill: set expiry for existing unsigned waivers to 7 days from now
-- (already-signed waivers don't need an expiry — the Edge Function blocks PII access after signing)
UPDATE bookings
  SET waiver_token_expires_at = now() + interval '7 days'
  WHERE waiver_token IS NOT NULL
    AND waiver_token_expires_at IS NULL
    AND waiver_status != 'SIGNED';

-- For future bookings: create a trigger to auto-set expiry when waiver_token is first populated
CREATE OR REPLACE FUNCTION set_waiver_token_expiry()
RETURNS trigger AS $$
BEGIN
  IF NEW.waiver_token IS NOT NULL
     AND OLD.waiver_token IS DISTINCT FROM NEW.waiver_token
     AND NEW.waiver_token_expires_at IS NULL THEN
    NEW.waiver_token_expires_at := now() + interval '7 days';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_waiver_token_expiry ON bookings;
CREATE TRIGGER trg_set_waiver_token_expiry
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION set_waiver_token_expiry();
