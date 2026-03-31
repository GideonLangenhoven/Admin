-- Extend waiver token expiry: set waiver_token_expires_at to slot start_time + tour duration
-- instead of just slot start_time. This keeps the waiver signable until the trip actually ends.
-- Falls back to slot start_time + 3 hours if no duration is set on the tour.

CREATE OR REPLACE FUNCTION set_waiver_token_expiry()
RETURNS trigger AS $$
DECLARE
  v_slot_time timestamptz;
  v_duration int;
BEGIN
  IF NEW.waiver_token IS NOT NULL
     AND OLD.waiver_token IS DISTINCT FROM NEW.waiver_token
     AND NEW.waiver_token_expires_at IS NULL THEN

    -- Look up the slot start_time and tour duration for this booking
    SELECT s.start_time, coalesce(t.duration_minutes, 180)
      INTO v_slot_time, v_duration
      FROM slots s
      LEFT JOIN tours t ON t.id = s.tour_id
     WHERE s.id = NEW.slot_id;

    IF v_slot_time IS NOT NULL THEN
      -- Expire after the trip ends (slot_time + duration)
      NEW.waiver_token_expires_at := v_slot_time + make_interval(mins => v_duration);
    ELSE
      -- Fallback: 7 days from now (matches original behaviour)
      NEW.waiver_token_expires_at := now() + interval '7 days';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The trigger itself already exists (trg_set_waiver_token_expiry) and will
-- use the updated function automatically — no need to recreate it.

-- Backfill: update existing unsigned waiver expiries to use slot_time + duration
-- where the token hasn't expired yet
UPDATE bookings b
   SET waiver_token_expires_at = s.start_time + make_interval(mins => coalesce(t.duration_minutes, 180))
  FROM slots s
  LEFT JOIN tours t ON t.id = s.tour_id
 WHERE b.slot_id = s.id
   AND b.waiver_token IS NOT NULL
   AND b.waiver_status != 'SIGNED'
   AND b.waiver_token_expires_at IS NOT NULL
   AND s.start_time > now() - interval '1 day';
